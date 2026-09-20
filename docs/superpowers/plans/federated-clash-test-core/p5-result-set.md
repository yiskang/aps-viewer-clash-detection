# Result Set — Phase P5 Implementation Plan

**Goal:** Build the durable half of the engine: turn a finished run's raw material (unit outcomes, ledger, aggregated diagnostics, provenance inputs) into one canonical, sealed, deep-frozen `ResultSet`; derive the run's three axes and the single normative no-clash claim predicate from it; validate any set that comes back from an untrusted store or caller before a single field of it is exposed; and keep sealed sets inside a hard resident bound with an in-memory `ResultStore` whose `put` is atomic across the durable `modelKey → modelVersion` index and whose `get` refuses an oversized set before any object graph exists. Every externally observable safety invariant of spec §8.3, §11, §12.5, §13 is carried by a named test; the remote ambiguous-commit protocol is deliberately not.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints in full. Phase-specific constraints, copied verbatim from the spec:

- "A Result Set is **sealed exactly once**, at the transition into a terminal state, and is immutable afterwards — **enforced, not merely promised**" (§13.3).
- "A sealed Result Set must round-trip through `structuredClone` and `JSON.stringify/parse` with **semantic equality** … Forbidden anywhere inside it: `Model` or any Viewer object, functions, `THREE` objects, `Map`/`Set`, `undefined` values, and non-finite numbers" (§13.4).
- "**`mode` is the sole persisted discriminator; there is no `type` field.**" (§11.1, errata E1).
- "*an engine never produces a set it cannot read.*" (§13.6, producer/reader invariant R21-2).
- "validation proves a set is well-formed and self-consistent, **not that it is authentic**" (§13.6, residual trust boundary).
- "**Native `structuredClone` is not used**" on external input; capture is the descriptor-based algorithm of §5.3 generalized to the Result Set (§13.6).
- "Persistence failure **never alters the run's outcome**. The Result Set is sealed *before* the persistence attempt." (§13.5)
- "`results = ∅` is part of the single normative predicate (R19-2)" and "`canClaimNoClashes(…)` returns `true` only when `unqualified` is true" (§8.3).
- Defaults and ceilings come from `clashtest/options.js` only (master Global Constraints; spec §17.1 governs values). No number in this phase's code or tests is hard-coded.

---

## Phase interface summary

Every export of P5. Later phases consume these names and must not re-implement them.

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `SCHEMA_VERSION` | `clashtest/results/resultSet.js` | `1` | The `ResultSet.schemaVersion` this build writes (§13.6). |
| `projectUnitPairs` | `clashtest/results/resultSet.js` | `(unitOutcome, ctx) → ClashResult[]` | Projects one `UnitOutcome.pairs[]` (library orientation, `type`) into canonical-ordered `ClashResult[]` (`mode`, re-keyed evidence, flags). |
| `compareResults` | `clashtest/results/resultSet.js` | `(a, b) → number` | Canonical total order by `PairId` (§11.3). |
| `createResultAccumulator` | `clashtest/results/resultSet.js` | `(ctx) → {canAdmitUnit(unitOutcome) → {admissible: boolean, reason?: 'result-cap'}, addUnit(unitOutcome) → {accepted, reason?, added?}, size() → number, toArray() → ClashResult[]}` | Cross-unit merge with the whole-unit `maxResultsPerRun` boundary rule and the §11.4 reconciliation rules. **`addUnit` is transactional** — a refusal (`{accepted:false, reason:'result-cap'}`) has **no** side effect of any kind: nothing is merged, `size()` is unchanged, and no flag is raised on an already-merged result. **`canAdmitUnit(unitOutcome)` is the same admission test with no mutation at all** and is what P6 calls *before* committing a unit to the diagnostic aggregator and statistics accumulator (P6 re-verification Critical 4: P6 currently aggregates first and cannot roll back). Both are named tests; see *Cross-file needs* at the end of this file. `ctx.unitPlanRank` is a **required** `Map<unitId, number>` (or any `{get(unitId) → number\|undefined}`): §11.4 rule 2's "lowest `unitId` **in plan order**" is resolved by this explicit rank, **never** by comparing `unitId` strings (`'1.10' < '1.2'` lexically, which is the wrong plan order). P6 builds it from `plan.units` order; an unranked unit ranks `Number.MAX_SAFE_INTEGER` (fail-last, deterministic). |
| `deriveRunOutcome` | `clashtest/results/resultSet.js` | `({status, freshness, ledger, diagnostics, results, reasons}) → RunOutcome` | Derives `coverage`, `integrity`, `environmentSensitive(+Causes)` (§8.3); `status`/`freshness`/`reasons` are supplied by P6. `coverage: 'full'` requires **every leaf `evaluated` AND `scopeProof: 'equal'`** — the exact predicate `validateResultSet` re-checks (§13.6 R21-2: an engine never produces a set it cannot read). |
| `buildResultSet` | `clashtest/results/resultSet.js` | `(parts) → ResultSet` (unsealed draft, plain data) | Assembles §13.1 structure incl. the pre-resolution-seal shape. `digests: null`, `sealed: false`. |
| `sealResultSet` | `clashtest/results/resultSet.js` | `(draft, {slicer}) → Promise<ResultSet>` | Computes `digests`, sets `sealed: true`, deep-freezes in slices through P0's `deepFreezeSliced`. **Sealed exactly once, enforced (§13.3):** a value that is not a fresh draft (`sealed !== false`, or `digests !== null`) is rejected with a **programmer error** — `TypeError` carrying the stable `code: 'ERR_RESULT_SET_NOT_DRAFT'` — never a spec error class, because no §18 error names this case and it can only arise from an engine bug. |
| `pairSetDigestInput` / `ledgerDigestInput` | `clashtest/results/resultSet.js` | `(results) → array` / `(ledger, runOptions) → object` | The exact digested projections (§13.1). `ledgerDigestInput` **excludes `secondaryCauses`** (spec §16.7: "secondary causes are diagnostic and excluded from `ledgerDigest`"), `attempts` and `durationMs`. |
| `freshnessStateOf` | `clashtest/results/claim.js` | `(freshness: Freshness \| string \| null \| undefined) → 'current'\|'stale'\|'unverifiable'\|null` | **Added by reconciliation (row N19; resolves P6 contradiction C1).** The one adapter between the two shapes spec §8.3 and §16.4 use for freshness. Returns `value.state` for a `{state, reasons}` object, the value itself for one of the three bare strings, and **`null` for anything else — including `undefined`, `null`, a wrong-shaped object, or an unrecognized string** (fail-closed: §8.3 requires the claim to be `false` when freshness "is absent or not `current`"). Consumed by P6 (A16) and by both claim helpers below. |
| `assessNoClashClaim` | `clashtest/results/claim.js` | `(resultSet, currentFreshness: Freshness \| string) → {allowed, unqualified, qualifiers, exclusions, proofMethod}` | The ONE normative claim predicate (§8.3). Pure; does not validate its argument. **Accepts either shape**, reading it through `freshnessStateOf` exactly once; the conjunct is `freshnessStateOf(currentFreshness) === 'current'`. When the argument is a `Freshness` object its `reasons[]` are appended to `qualifiers` so a `stale`/`unverifiable` refusal is explainable (§16.4 "with reasons"). **The digest-version rule is a conjunct HERE** (review Critical 2 / question 2): `digests.digestVersion === DIGEST_VERSION` — an unknown or absent version means the engine cannot verify the pair set or ledger under its own semantics, so the claim is refused with a `{kind:'digest-version', reason:'unknown-digest-version'}` qualifier. This predicate is the **normative owner** of the rule; P6's read-time freshness may *additionally* return `unverifiable` for the same input, which is a second, independent refusal path, never a substitute (cross-file note below). |
| `canClaimNoClashes` | `clashtest/results/claim.js` | `(resultSet, currentFreshness: Freshness \| string) → boolean` | `assessNoClashClaim(...).unqualified`. Same either-shape rule. |
| `getPairStatus` | `clashtest/results/status.js` | `(resultSet, pairId) → {required, coveringUnitId, unitOutcome, roots, caveats, verdict, reason?}` | §12.5 pair-level view incl. the normative taint rule. **P5 is the sole owner** (duplicate-ownership D4); P8 re-exports, never re-implements. `required` is `null` when the verdict is `undetermined`. |
| `getElementStatus` | `clashtest/results/status.js` | `(resultSet, elementRef) → {inRequiredPairSpace, coverage, caveats, gapCauses}` | §12.5 element-level view. Same sole ownership. |
| `createStatusReader` | `clashtest/results/status.js` | `(resultSet) → {pairStatus(pairId), elementStatus(ref), ledger: LedgerModel}` | **Moved here from P8 by reconciliation (D4).** Builds the per-set indexes once so a derivation over ~10⁵ results does not pay the per-call build. **Build is `O(units + rows + results)`; every lookup is `O(1)` amortized or bounded by the answer's own size** — never `O(units)` per call (review Important 2). See *Status-reader complexity contract* under Task P5.6. `getPairStatus`/`getElementStatus` are one-shot wrappers over it, memoized in a `WeakMap` **only for frozen sets** (a mutable set is re-read every call, so a reader can never answer stale). P8's `groupBy`/`filter`/`summarize`/`compare` consume this, not their own reader. |
| `buildStatusReaderSteps` | `clashtest/results/status.js` | `function*(resultSet) → StatusReader` | **Moved here from P8 (D4).** The same build as a generator (one `yield` per indexed record) so a derivation can slice it through P0's slicer (`const p = slicer.tick('status'); if (p) await p;`). `createStatusReader` is the drained form of this generator — one implementation, two drivers. |
| `readLedger` | `clashtest/results/status.js` | `function*(resultSet) → LedgerModel` | **Moved here from P8's `derive/ledgerReader.js` (D4).** The **only** function that knows the sealed ledger's physical layout — and P5 is the phase that pins that layout (see *Shapes this phase pins* below), so the reader and the schema stay in one place. `LedgerModel = {units, leaves, unitsById, byModel: Map<modelKey, {ownerToRoot: Map<dbId, rootDbId>, rootCls: Map<rootDbId, "A'"\|'C'\|"B'">, unreachable, hierarchy}>, planningGaps, pairSpaceTotal, emptyOperand}` — runtime-only `Map`s over the frozen arrays, never persisted. `rootCls` is the R2 per-root class marker (`'C'` = the root is in `A ∩ B`), the one thing that makes hierarchy-internal element status complete rather than bounded by `hierarchyInternal.examples`. P8 imports it. |
| `TYPES` / `SCHEMA_ROWS` | `clashtest/results/resultSetSchema.js` | `Map<typeName, TypeSpec>` / `Array<{type, field, path, spec}>` | The **closed structural schema of record** for the sealed Result Set (review Critical 3): presence, nullability, primitive type, enum, numeric bounds and safe-integer-ness, uniqueness, per-field string cap, array-vs-object, literal (`sealed === true`, `schemaVersion`, `placementVerified === false`) and digest-string syntax, with one issue code each. `SCHEMA_ROWS` is the flattened form the negative tests iterate, so a new schema row **cannot** be added without a negative test appearing for it. |
| `isOpenPath` | `clashtest/results/resultSetSchema.js` | `(pathSegments: readonly string[]) → boolean` | True exactly at an unknown field of one of §13.6's five **open** types. Consumed by `captureResultSet` as P0's `openFieldBudget.isOpenPath` **and** by the validator's defensive re-check — one definition of "unknown", used by both. |
| `checkShapeAndUnknownFields` | `clashtest/results/resultSetSchema.js` | `(set, add, limits) → void` | The table-driven structural validator. Runs as the **first** phase of `validateResultSetSteps`, before every cross-field check, so no later phase can traverse a value whose shape it has not established. |
| `validateResultSet` | `clashtest/results/validateResultSet.js` | `(set, {limits}) → {ok: boolean, issues: {path, code}[]}` | The **schema and semantic** validator of §13.6, run on an **already-captured copy only** (review question 1). **It is not an untrusted-input boundary and must never be handed a raw caller/store object**: `captureResultSet`/`readResultSet` are the one boundary, and they hand this function a detached, plain-data, accessor-free, acyclic, depth- and size-bounded copy. Because it traverses properties directly, a raw hostile object would invoke getters — exactly what capture exists to prevent. It therefore asserts a **cheap O(1) precondition** on entry (plain object, `Object.getPrototypeOf(set) === Object.prototype`, and no accessor among the root's own descriptors) and throws `TypeError{code:'ERR_UNCAPTURED_INPUT'}` if it fails — a programmer error, never a §18 class. Pure and synchronous; drains the generator below. |
| `validateResultSetSteps` | `clashtest/results/validateResultSet.js` | `function*(set, {limits}) → yields after each phase, returns {ok, issues}` | Sliceable form for read-through. |
| `captureResultSet` | `clashtest/results/validateResultSet.js` | `(raw, {limits, runId?, migrations?}) → ResultSet` (synchronous; throws `UnsupportedSchemaVersionError` \| `CorruptResultSetError` \| `ResultSetTooLargeError`) | Capture-first detached copy (§13.6), built on P0's **`captureData`** (N4/N29). **`runId` is an explicit diagnostic parameter defaulting to `null` — it is never read off `raw`** (reading any property of the untrusted argument before capture would invoke an attacker-controlled getter, which §13.6 forbids absolutely). `migrations` is consulted only by the root gate, to decide whether an older `schemaVersion` is admissible, and only for a version that is `Number.isInteger(v) && v >= 1 && v < SCHEMA_VERSION` (review Important 1 — a registered migration must never widen the set of *valid* schema versions). **It passes P0's `openFieldBudget`, so the §13.6 64 KiB unknown-field budget is charged DURING the traversal, before the offending value is copied** (review Critical 1). |
| `applyMigration` | `clashtest/results/validateResultSet.js` | `(captured, migrations, {runId}) → ResultSet` | The **single-hop** migration dispatcher: one lookup keyed by the *source* version, whose entry must return a set at `SCHEMA_VERSION`. No chaining through intermediate versions (§13.6 registers migrations per `(type, fromVersion)`). Exported so the dispatcher is directly testable while the real table is empty. |
| `readResultSet` | `clashtest/results/validateResultSet.js` | `(raw, {limits, migrations?, slicer, runId?}) → Promise<ResultSet>` | capture → version → migrate → re-validate → freeze; every failure is a **rejected promise** (§13.6 R19-1). The capture is synchronous, **before the first `await`**. |
| `validateResultSetSummary` | `clashtest/results/validateResultSet.js` | `(summary, {limits}) → {ok, issues}` | Closed `ResultSetSummary` shape for listings (§13.5). |
| `createInMemoryResultStore` | `clashtest/results/InMemoryResultStore.js` | `({now?}) → ResultStore` | Reference `put`/`get`/`list`/`delete`/`tombstoneTest`/`isTombstoned`. |
| `createResidencyManager` | `clashtest/results/residency.js` | `({limits, resultStore, now, onPersistence}) → ResidencyManager` | Slot accounting, classes, retain/release/discard, persistence attempts. |
| `createReadCoordinator` | `clashtest/results/residency.js` | `({limits}) → {reserveSync() → slot, acquire() → Promise<slot>, inUse() → number}` | Read slots: synchronous reserve-or-reject for raw sets, FIFO for by-id reads. |

`ResidencyManager` surface (all synchronous unless stated): `reserveRunSlot(runId)`, `releaseRunSlot(runId)`, `reservationHeld(runId) → boolean`, `admitSealedSet(runId, resultSet)`, `beginPersist(runId, {persist}) → Promise<PersistenceOutcome>`, `getPersistenceState(runId) → PersistenceSnapshot|null`, `retryPersist(runId) → Promise<PersistenceOutcome>`, `retainResultSet(runId) → {release()}`, `releaseResultSet(runId, {acknowledgeUnsaved})`, `discardRun(runId) → Promise<void>`, `getResident(runId) → ResultSet|null`, `touch(runId)`, `retentionReport() → object`, `drainForDispose() → {droppedUnsaved, persistenceInFlight}`.

**`admitSealedSet` is atomic and exception-safe** (P6 re-verification finding 8 / its question 1, which P5 owns). It **either** fully converts the run's reservation into a resident entry and returns, **or** throws having changed *nothing*: no slot moved, no entry created or removed, no counter altered. Every validation it performs (unknown/absent reservation, a `runId` already resident, a non-sealed or non-frozen argument) happens **before** the first mutation; after the first mutation the only remaining steps are infallible map writes. **Observer/callback errors are swallowed and isolated inside residency** — `onPersistence` and any future observer is invoked inside `try { … } catch { /* isolated */ }` **after** the state transition is complete, so a throwing observer can never turn a completed admission into an apparent failure (that is the exact scenario P6's recovery path mis-handles). P6 may therefore treat a throw from `admitSealedSet` as "the reservation is still a reservation" without guessing, and **`reservationHeld(runId)`** lets its recovery path confirm that rather than infer it: `true` while the run holds an unconverted slot, `false` once the set is resident, once the slot is released, and for an unknown id (it never throws).

**Lease tokens are one-shot** (review Important 4). `retainResultSet(runId)` returns a **fresh** `{release()}` whose `release()` decrements the entry's outstanding-lease count **exactly once**; every later call on that same token is a **no-op** (no second decrement, no throw), including after the resident entry has been evicted, released or discarded. Two independent leases on one set are two independent tokens and require two releases. The count is therefore an exact count of live leases and a double release can never make a still-retained set evictable.

**Eviction order is true LRU, not seal order.** Every resident entry carries `lastTouchedAt` (from the injected `now()`) and a monotonic `touchSeq` (a manager-wide counter, incremented on every touch). `makeRoom` evicts the `evictable` entry with the smallest `(lastTouchedAt, touchSeq)` pair — the sequence number is the tie-break, so a fake clock that never advances still gives a total, deterministic order. **The operations that touch a set** (all of them, in one private `touch(runId)`): `admitSealedSet`, `getResident`, `retainResultSet`, the `release()` returned by it, `beginPersist`/`retryPersist` on settle, and the public `touch(runId)`. `retentionReport()`, `getPersistenceState` and `drainForDispose` deliberately do **not** touch — reporting must not change eviction order.

**Deep freeze is P0's.** P5 exports no freeze helper: `deepFreezeSliced(value, slicer)` and `isDeepFrozen(value)` come from P0 `clashtest/util/capture.js` (reconciliation N4), and the slicer argument is the slicer **object**, not `{slicer}`. `sealResultSet` and `readResultSet` are its only callers here.

### Shapes this phase pins (the sealed JSON schema of record)

The spec fixes the *meaning* of the ledger but never its exact JSON; `validateResultSet` cannot be written against an unpinned shape, so P5 pins it and P3/P6 must emit exactly this (reconciliation item, see *Gates and open items*).

```js
/** @typedef {Object} Ledger
 *  @property {boolean} planExists
 *  @property {number}  pairSpaceTotal            Σ pairSpaceWeight over leaf units; 0 when no plan
 *  @property {boolean} emptyOperand
 *  @property {UnitRecord[]} units
 *  @property {Array<{modelKey: string, owners: Array<{rootDbId: number, ownerDbIds: number[],
 *                    cls: 'A'|'B'|'C'}>}>} rootOwners                    `cls` = the root's planning class (R2 / OPEN-2 option a),
 *                                                                         the three `ROOT_CLASS` literals P3 emits (P3 summary row
 *                                                                         `ROOT_CLASS = {A_ONLY:'A', B_ONLY:'B', BOTH:'C'}`);
 *                                                                         'C' = the root is in A ∩ B. Persisted AND digested.
 *  @property {Array<{selectionRole: 'A'|'B', modelKey: string|null, cause: string, dbIds: number[]}>} unresolvedSelections
 *  @property {Array<{modelKey: string, ownerDbIds: number[], mixedOwnerDbIds: number[],
 *                    unattributable: {notLoaded: number, ownerUnresolvable: number}}>} unreachablePopulation
 *  @property {Array<{modelKey: string, rootCount: number, ownerCount: number,
 *                    examples: Array<{rootDbId: number, ownerDbIds: number[]}>}>} hierarchyInternal
 *  @property {Array<{phase: string, cause: string}>} planningGaps        the §6.6.2 cause enum.
 *                                                                         CLOSED at two fields: P3's run-scoped
 *                                                                         `PlanResult.planningGaps[]` may also carry a
 *                                                                         `detail` (the §5.6.5 first-20 offenders, §6.6
 *                                                                         dbIds); `toLedgerRecord()` projects it away,
 *                                                                         and `ledger.recordPlanningGap({phase, cause})`
 *                                                                         (P3) is the only writer P6 calls. If `detail`
 *                                                                         must ever become durable the field is added
 *                                                                         HERE first — P3 never widens the row itself.
 *  @property {string[]} exclusions                                        declared exclusions
 *  @property {Array<{code: string, modelKey?: string}>} warnings
 *  @property {boolean} budgetExhausted
 *  @property {string|null} firstRefusalUnitId
 */
/** @typedef {Object} UnitRecord
 *  @property {string} unitId
 *  @property {'leaf'|'split'} kind                                        `split` records are superseded by their leaves
 *  @property {string|null} parentUnitId
 *  @property {string} sourceModelKey
 *  @property {number[]} sourceRootDbIds
 *  @property {Array<{modelKey: string, scope: 'model'|'roots', rootDbIds?: number[]}>} targets
 *  @property {'evaluated'|'failed'|'skipped'|'discarded'|'not-run'|'split'} outcome
 *  @property {string|null} cause                                          a §8.3 cause
 *  @property {string[]} secondaryCauses
 *  @property {string|null} capacityKind                                   CapacityExceededError.kind, when cause = 'capacity-exceeded'
 *  @property {string|null} capDetail                                      'ledger-records' | 'unit-records' | null
 *  @property {'equal'|'drift'|'unverifiable'|'not-checked'} scopeProof
 *  @property {number} pairSpaceWeight
 *  @property {Array<{kind: 'element'|'target-model'|'unit', modelKey: string|null, dbId: number|null,
 *                    reason: string, occurrences: number}>} taints        exact, per unit (§12.2.1)
 *  @property {number} attempts                                            NOT digested
 *  @property {number} durationMs                                          NOT digested
 */
```

`pairSpaceTotal` and `emptyOperand` live on the **ledger** (§8.3 names them as claim inputs without saying where; the ledger is the coverage-accounting authority and both are digested).

**`rootOwners[].owners[].cls` is a schema decision, not an implementation detail** (master §8, ruling **OPEN-2 option (a)**; controller ruling R2). It is required, validated (`cls` must be one of P3's three `ROOT_CLASS` literals **`'A'` / `'B'` / `'C'`** — `root-cls-invalid`; the primed spellings `A'` / `B'` are P3's *internal plan-table* class keys and never reach the wire) and **inside `ledgerDigest`**, so a writer that omits it produces a set no reader accepts. It exists because `getElementStatus` must decide "is this owner inside a hierarchy-internal (`A ∩ B`) root?" for *every* element, and the `hierarchyInternal` table's `examples` array is capped at 20 — deriving the element view from it silently under-reports caveats. **Cross-file:** P3 emits it on every `rootOwners` row; P8 reads it only through `readLedger` (its `rootCls` map).

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `clashtest/results/resultSet.js` | Create | Pair projection (`mode`, evidence re-keying, `-0` normalization), canonical ordering, §11.4 reconciliation, the whole-unit result cap, `RunOutcome` derivation, draft assembly, digests, sealing through **P0's** `deepFreezeSliced` (P5 owns no freeze helper). |
| `clashtest/results/claim.js` | Create | `assessNoClashClaim` / `canClaimNoClashes` / `freshnessStateOf` — the single normative predicate and the single freshness-shape adapter; pure, no validation, no I/O. |
| `clashtest/results/status.js` | Create | `getPairStatus` / `getElementStatus` / `createStatusReader` / `buildStatusReaderSteps` / `readLedger` — the shared normative taint rule (§12.5) and the sealed-ledger layout reader. **Now in the master §2 module map** (reconciliation). Sole owner; P8 re-exports. |
| `clashtest/results/resultSetSchema.js` | Create | **The CLOSED structural schema of record** (review Critical 3): one declarative `TYPES` table covering every durable type and field of the sealed Result Set, the derived `OPEN_TYPE_FIELDS` / `isOpenPath` (shared by capture's unknown-field budget and by validation, so "what is unknown" has exactly one definition), the per-field `STRING_CAPS`, and the table-driven `checkShapeAndUnknownFields`. `SCHEMA_ROWS` is the same table flattened for the mutation-generating negative tests, so schema and tests cannot drift. |
| `clashtest/results/validateResultSet.js` | Create | `captureResultSet` (over P0's `captureData`), the single-hop `applyMigration`, `nodeCeilingError`, `validateResultSetSteps`/`validateResultSet`, `readResultSet`, `validateResultSetSummary`. |
| `clashtest/results/InMemoryResultStore.js` | Create | Reference `ResultStore`: canonical-JSON durable form, atomic `put` over the identity index + tombstones, byte-guarded `get`, keyset `list`, `delete`, `tombstoneTest`/`isTombstoned`. |
| `clashtest/results/residency.js` | Create | Slot accounting (`active + resident ≤ maxResidentResultSets`), resident classes, retain/release/discard, persistence attempt state machine, read coordinator. |
| `clashtest/errors.js` | Modify (P0-owned) | Add any §18 error P0 did not ship, specifically `PersistenceOutcomeUnknownError`. Errors keep their single home; P5 never creates a second error module. |
| `test/clashtest/support/resultSetFixtures.mjs` | Create (shared support) | `makeFakeRun(kind)` → the raw material of a run in each of the **five** terminal shapes (`completed-clean`, `completed-with-gaps`, `cancelled-pre-resolution`, `failed`, `invalidated`); `makeSealedSet(kind)`; `claimableSet()` (the **empty-results** completed-clean shape the claim truth table flips one conjunct at a time); `widePlan(unitCount)` (a valid sealed set with `unitCount` leaf units over two models and a fixed 50 results, so the status-reader complexity test probes identically at every size); `fakeSlicer()` in P0's `tick(label?)` shape. |
| `test/clashtest/support/schemaMutations.mjs` | Create (shared support) | `schemaMutations(set)` — walks a valid sealed set **with the production `TYPES` table** and emits one `{path, code, apply}` per violation class per reachable field. Test-only machinery, but derived from the schema, so a schema row and its negative test cannot drift. |
| `test/clashtest/support/resultStoreConformance.mjs` | Create (shared support) | `runResultStoreConformance(makeStore, {label})` — the port conformance suite every host store must pass. |
| `test/clashtest/results/*.test.mjs` | Create | One file per task, named in *Verification / acceptance*. |

---

### Task P5.1: `ClashResult` projection, canonical order, reconciliation

**Files**
- Create: `clashtest/results/resultSet.js`
- Test: `test/clashtest/results/resultSet.merge.test.mjs`

**Interfaces**

*Consumes* (**RECONCILED** against P1's and P4's interface summaries; producer wins — reconciliation rows N13, N14):
- `identity/ids.js` (P1), **production imports**: `comparePairIds(p, q) → -1|0|1` (spec §11.3 canonical result order — P5 does not re-derive it from `compareElementRefs`); **`makePairId(mode, x, y) → PairId`** — arity 3 with the **mode first** (it derives the semantics itself and, for `containment`, keeps `x` = contained/source and `y` = container/target); `makeResultId(testId, semanticDigest, pairId) → string`; `elementRefKey(ref) → string` (row N12 — the one `Map`/`Set` key encoding for an `ElementRef`; P5 invents none).
- `identity/ids.js` (P1), **test-only import**: **`pairSemanticsOf(mode) → 'ordered'|'unordered'`** (the reconciled spelling; there is no `pairSemanticsForMode`). P5's production code never maps mode → semantics — `makePairId` does it, in the one place §4.5 allows — so the name appears only in the P5.1 integration test that asserts the projection's orientation agrees with P1's own mapping.
- `execution/UnitExecutor.js`: `UnitOutcome` per spec §11.2 — `pairs[] = {source, target, type, witness?, distance?, clearance?}` in **library orientation** (P4).
- `options.js`: `RUN_OPTION_DEFAULTS.maxResultsPerRun` (P0).

*Produces:* `SCHEMA_VERSION`, `projectUnitPairs`, `compareResults`, `createResultAccumulator`.

**Accumulator context (`ctx`).** `{mode, testId, semanticDigest, maxResultsPerRun, unitPlanRank, unreachableOwners, mixedOwners}`. `unitPlanRank` is the explicit §11.4-rule-2 plan order (see the *Phase interface summary*); `unreachableOwners` / `mixedOwners` are `Map<modelKey, Set<dbId>>` built from **plan data**, never from the unit.

- [ ] **Step 1: Write the failing projection/ordering test.**
```js
// test/clashtest/results/resultSet.merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectUnitPairs, compareResults, createResultAccumulator } from '../../../clashtest/results/resultSet.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';

const ref = (modelKey, dbId) => ({ modelKey, dbId });
// Plan order is EXPLICIT (§11.4 rule 2): never a lexical unitId compare.
const rank = (...unitIds) => new Map(unitIds.map((id, i) => [id, i]));
const ctx = (over = {}) => ({
  mode: 'volume-overlap', testId: 'T1', semanticDigest: 'sha256:abc',
  maxResultsPerRun: RUN_OPTION_DEFAULTS.maxResultsPerRun,
  unitPlanRank: rank('u1', 'u2', 'u3'),
  unreachableOwners: new Map(), mixedOwners: new Map(), ...over,
});

test('projection carries mode, never type, and normalizes -0', () => {
  const out = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'volume-overlap',
      witness: { kind: 'surface-crossing', point: [-0, 1, 2] } }],
  }, ctx());
  assert.equal(out.length, 1);
  assert.equal(out[0].mode, 'volume-overlap');
  assert.equal('type' in out[0], false);
  assert.deepEqual(out[0].pair, { first: ref('MA', 1), second: ref('MB', 9) });   // unordered: lesser first
  assert.deepEqual(out[0].evaluatedAs, { source: ref('MB', 9), target: ref('MA', 1) });
  assert.equal(Object.is(out[0].evidence.witness.point[0], 0), true);             // -0 → 0
  assert.equal(out[0].unitId, 'u1');
});

test('clearance evidence is re-keyed to first/second by PairId, not by library role', () => {
  const [r] = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'clearance',
      distance: 0.25, clearance: 1, witness: { sourcePoint: [9, 9, 9], targetPoint: [1, 1, 1] } }],
  }, ctx({ mode: 'clearance' }));
  assert.deepEqual(r.evidence.closestPoints, { first: [1, 1, 1], second: [9, 9, 9] });
  assert.equal(r.evidence.distance, 0.25);
});

test('containment keeps library orientation (ordered semantics) and empty evidence', () => {
  const [r] = projectUnitPairs({
    unitId: 'u1', pairs: [{ source: ref('MB', 9), target: ref('MA', 1), type: 'containment' }],
  }, ctx({ mode: 'containment' }));
  assert.deepEqual(r.pair, { first: ref('MB', 9), second: ref('MA', 1) });        // contained first
  assert.deepEqual(r.evidence, {});
});

test('accumulator sorts across units and applies the whole-unit result cap', () => {
  const acc = createResultAccumulator(ctx({ maxResultsPerRun: 2 }));
  assert.deepEqual(acc.addUnit({ unitId: 'u2', pairs: [
    { source: ref('MB', 9), target: ref('MA', 2), type: 'volume-overlap', witness: null }] }),
    { accepted: true, added: 1 });
  assert.deepEqual(acc.addUnit({ unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null },
    { source: ref('MA', 1), target: ref('MB', 9), type: 'volume-overlap', witness: null }] }),
    { accepted: false, reason: 'result-cap' });                                   // whole unit refused
  assert.deepEqual(acc.toArray().map((r) => r.unitId), ['u2']);                   // nothing partially merged
  assert.equal(acc.toArray()[0].flags.witnessUnavailable, true);
});

// P6 re-verification Critical 4: P6 needs to know BEFORE it commits a unit to the diagnostic
// aggregator and statistics accumulator, neither of which can be rolled back.
test('canAdmitUnit answers the same as addUnit and mutates nothing', () => {
  const acc = createResultAccumulator(ctx({ maxResultsPerRun: 2 }));
  const fits = { unitId: 'u2', pairs: [
    { source: ref('MB', 9), target: ref('MA', 2), type: 'volume-overlap', witness: null }] };
  const overflows = { unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null },
    { source: ref('MA', 1), target: ref('MB', 9), type: 'volume-overlap', witness: null }] };

  assert.deepEqual(acc.canAdmitUnit(fits), { admissible: true });
  assert.equal(acc.size(), 0, 'the probe merged nothing');
  acc.addUnit(fits);
  assert.equal(acc.size(), 1);

  // Repeated probes are idempotent and never mutate — P6 may call it as often as it likes.
  const before = JSON.stringify(acc.toArray());
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(acc.canAdmitUnit(overflows), { admissible: false, reason: 'result-cap' });
  }
  assert.equal(acc.size(), 1);
  assert.equal(JSON.stringify(acc.toArray()), before, 'no flag, no result, nothing changed');

  // …and the refusal from addUnit itself is equally side-effect-free (transactional).
  assert.deepEqual(acc.addUnit(overflows), { accepted: false, reason: 'result-cap' });
  assert.equal(acc.size(), 1);
  assert.equal(JSON.stringify(acc.toArray()), before);

  // The two always agree, including on a unit whose pairs are all DUPLICATES (no additions, so it
  // is admissible even at the cap) — the case where a "count the pairs" shortcut would diverge.
  const dupes = createResultAccumulator(ctx({ maxResultsPerRun: 1 }));
  dupes.addUnit(fits);
  assert.deepEqual(dupes.canAdmitUnit({ ...fits, unitId: 'u3' }), { admissible: true });
  assert.deepEqual(dupes.addUnit({ ...fits, unitId: 'u3' }), { accepted: true, added: 0 });
});

test('canonical order is by PairId only and duplicates reconcile to canonical orientation', () => {
  const acc = createResultAccumulator(ctx());
  acc.addUnit({ unitId: 'u1', pairs: [{ source: ref('MA', 1), target: ref('MB', 7),
    type: 'volume-overlap', witness: { kind: 'containment', point: [0, 0, 0] } }] });
  acc.addUnit({ unitId: 'u2', pairs: [{ source: ref('MB', 7), target: ref('MA', 1),
    type: 'volume-overlap', witness: { kind: 'containment', point: [0, 0, 0] } }] });
  const [only] = acc.toArray();
  assert.equal(acc.size(), 1);
  assert.deepEqual(only.evaluatedAs.source, ref('MA', 1));                        // rule 2: source === pair.first
  assert.equal(only.flags.duplicateEvidenceConflict, undefined);
  assert.equal(compareResults(only, only), 0);
});

test('a duplicate whose evidence disagrees is flagged', () => {
  const acc = createResultAccumulator(ctx({ mode: 'clearance' }));
  const p = (d) => ({ source: ref('MA', 1), target: ref('MB', 7), type: 'clearance',
    distance: d, clearance: 1, witness: { sourcePoint: [0, 0, 0], targetPoint: [d, 0, 0] } });
  acc.addUnit({ unitId: 'u1', pairs: [p(0.25)] });
  acc.addUnit({ unitId: 'u2', pairs: [p(0.5)] });
  assert.equal(acc.toArray()[0].flags.duplicateEvidenceConflict, true);
});

test('flags record unreachable and mixed owners from plan data, never from the unit', () => {
  const [r] = projectUnitPairs({ unitId: 'u1', pairs: [
    { source: ref('MA', 1), target: ref('MB', 950), type: 'volume-overlap', witness: null }] },
    ctx({ unreachableOwners: new Map([['MB', new Set([950])]]),
          mixedOwners: new Map([['MA', new Set([1])]]) }));
  assert.equal(r.flags.unreachableOwner, true);
  assert.equal(r.flags.mixedOwnerProvenance, true);
});

test('duplicate reconciliation uses the supplied plan rank, not a lexical unitId compare', () => {
  // '1.10' < '1.2' lexically but is LATER in plan order: the rank map is the only authority.
  const pairs = [{ source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null }];
  const order = [['1.2', '1.10'], ['1.10', '1.2']];               // both settlement orders, same answer
  for (const [firstSettled, secondSettled] of order) {
    const acc = createResultAccumulator(ctx({ unitPlanRank: rank('1.2', '1.10') }));
    acc.addUnit({ unitId: firstSettled, pairs });
    acc.addUnit({ unitId: secondSettled, pairs });
    assert.equal(acc.size(), 1);
    assert.equal(acc.toArray()[0].unitId, '1.2', `${firstSettled} then ${secondSettled}`);
  }
});

test('an unranked unit loses to every ranked one and ties break deterministically', () => {
  const pairs = [{ source: ref('MA', 1), target: ref('MB', 7), type: 'volume-overlap', witness: null }];
  const acc = createResultAccumulator(ctx({ unitPlanRank: rank('u5') }));
  acc.addUnit({ unitId: 'unknown-unit', pairs });
  acc.addUnit({ unitId: 'u5', pairs });
  assert.equal(acc.toArray()[0].unitId, 'u5');
});
```
Plus one file that imports **P1's real module** rather than a fixture, so a rename in `identity/ids.js` breaks P5 at test time and not at integration time:
```js
// test/clashtest/results/resultSet.identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePairId, pairSemanticsOf, makeResultId, comparePairIds, elementRefKey } from '../../../clashtest/identity/ids.js';
import { projectUnitPairs } from '../../../clashtest/results/resultSet.js';

const ref = (modelKey, dbId) => ({ modelKey, dbId });
const ctx = (mode) => ({ mode, testId: 'T1', semanticDigest: `sha256:${'a'.repeat(64)}`,
  maxResultsPerRun: 10, unitPlanRank: new Map([['u1', 0]]), unreachableOwners: new Map(), mixedOwners: new Map() });

test('the projection uses P1 exactly: makePairId(mode, x, y) and P1 ids', () => {
  for (const mode of ['volume-overlap', 'surface-intersection', 'containment', 'clearance']) {
    const p = { source: ref('MB', 9), target: ref('MA', 1), type: mode,
      ...(mode === 'clearance' ? { distance: 1, clearance: 2, witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] } } : { witness: null }) };
    const [r] = projectUnitPairs({ unitId: 'u1', pairs: [p] }, ctx(mode));
    const expected = makePairId(mode, p.source, p.target);
    assert.deepEqual(r.pair, expected, mode);
    assert.equal(r.resultId, makeResultId('T1', `sha256:${'a'.repeat(64)}`, expected), mode);
    // P1's own mode -> semantics mapping predicts the orientation; P5 stores no semantics value.
    const ordered = pairSemanticsOf(mode) === 'ordered';
    assert.equal(r.pair.first.modelKey === p.source.modelKey && r.pair.first.dbId === p.source.dbId, ordered, mode);
    assert.equal('pairSemantics' in r, false, mode);
  }
});

test('P5 sorts with P1 comparePairIds and keys with P1 elementRefKey', () => {
  const a = makePairId('volume-overlap', ref('MA', 1), ref('MB', 7));
  const b = makePairId('volume-overlap', ref('MA', 2), ref('MB', 7));
  assert.equal(comparePairIds(a, b) < 0, true);
  assert.notEqual(elementRefKey(ref('MA', 1)), elementRefKey(ref('MA', 11)));
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/resultSet.merge.test.mjs test/clashtest/results/resultSet.identity.test.mjs` → `Cannot find module '.../clashtest/results/resultSet.js'`.
- [ ] **Step 3: Write the minimal implementation.**
```js
// clashtest/results/resultSet.js
import { comparePairIds, makePairId, makeResultId } from '../identity/ids.js';

export const SCHEMA_VERSION = 1;
const UNRANKED = Number.MAX_SAFE_INTEGER;                          // an unplanned unit sorts last, deterministically

const zero = (n) => (n === 0 ? 0 : n);                 // -0 → 0 (§13.4)
const point = (p) => [zero(p[0]), zero(p[1]), zero(p[2])];
const sameRef = (a, b) => a.modelKey === b.modelKey && a.dbId === b.dbId;
const has = (index, ref) => index.get(ref.modelKey)?.has(ref.dbId) === true;

export function compareResults(a, b) {
  return comparePairIds(a.pair, b.pair);                 // §11.3 order lives in P1, in one place
}

function projectEvidence(mode, p, pairId) {
  switch (mode) {
    case 'volume-overlap':
      return { witness: p.witness ? { kind: p.witness.kind, point: point(p.witness.point) } : null };
    case 'clearance': {
      const sp = point(p.witness.sourcePoint);
      const tp = point(p.witness.targetPoint);
      const sourceIsFirst = sameRef(p.source, pairId.first);
      return { distance: zero(p.distance), clearance: zero(p.clearance),
               closestPoints: sourceIsFirst ? { first: sp, second: tp } : { first: tp, second: sp } };
    }
    default:                                            // surface-intersection, containment
      return {};
  }
}

export function projectUnitPairs(unitOutcome, ctx) {
  const out = [];
  for (const p of unitOutcome.pairs) {
    // P1 row N13: mode FIRST, arity 3. P5 never computes or passes a pairSemantics value.
    const pair = makePairId(ctx.mode, p.source, p.target);
    const evidence = projectEvidence(ctx.mode, p, pair);
    const flags = {};
    if (ctx.mode === 'volume-overlap' && evidence.witness === null) flags.witnessUnavailable = true;
    if (has(ctx.unreachableOwners, pair.first) || has(ctx.unreachableOwners, pair.second)) flags.unreachableOwner = true;
    if (has(ctx.mixedOwners, pair.first) || has(ctx.mixedOwners, pair.second)) flags.mixedOwnerProvenance = true;
    out.push({
      resultId: makeResultId(ctx.testId, ctx.semanticDigest, pair),
      pair, mode: ctx.mode,
      evaluatedAs: { source: p.source, target: p.target },
      evidence, flags, unitId: unitOutcome.unitId,
    });
  }
  out.sort(compareResults);
  return out;
}

// §11.4 rule 2: canonical orientation wins, else the lowest unit IN PLAN ORDER.
// Plan order is the supplied rank index, NEVER a lexical unitId compare ('1.10' < '1.2' is wrong).
const planRankOf = (ctx, unitId) => ctx.unitPlanRank?.get(unitId) ?? UNRANKED;

function reconcile(kept, incoming, ctx) {
  const keptCanonical = sameRef(kept.evaluatedAs.source, kept.pair.first);
  const incomingCanonical = sameRef(incoming.evaluatedAs.source, incoming.pair.first);
  const conflict = !evidenceAgrees(ctx.mode, kept.evidence, incoming.evidence);
  let winner = kept;
  if (!keptCanonical && incomingCanonical) winner = incoming;
  else if (keptCanonical === incomingCanonical
           && planRankOf(ctx, incoming.unitId) < planRankOf(ctx, kept.unitId)) winner = incoming;
  if (conflict) winner = { ...winner, flags: { ...winner.flags, duplicateEvidenceConflict: true } };
  return winner;
}

function evidenceAgrees(mode, a, b) {
  if (mode === 'clearance') return a.distance === b.distance;
  if (mode === 'volume-overlap') return (a.witness?.kind ?? null) === (b.witness?.kind ?? null);
  return true;                                          // surface-intersection / containment carry no evidence
}

export function createResultAccumulator(ctx) {
  const byResultId = new Map();
  let merged = [];

  /** The projection and the cap test, with NO mutation of any accumulator state. Both entry points
   *  below go through it, so `canAdmitUnit` and `addUnit` can never disagree about admissibility. */
  function project(unitOutcome) {
    const produced = projectUnitPairs(unitOutcome, ctx);
    const additions = [];
    const replacements = [];
    for (const r of produced) {
      const prev = byResultId.get(r.resultId);
      if (prev === undefined) additions.push(r);
      else replacements.push(reconcile(prev, r, ctx));
    }
    // Whole-unit boundary rule (§17.1 maxResultsPerRun): refuse the unit entirely, merge nothing.
    const admissible = merged.length + additions.length <= ctx.maxResultsPerRun;
    return { admissible, additions, replacements };
  }

  return {
    /** P6 re-verification Critical 4: P6 must know whether a unit will be admitted BEFORE it
     *  commits that unit to the diagnostic aggregator and the statistics accumulator, because
     *  neither of those can be rolled back. Pure: it mutates nothing, here or downstream. */
    canAdmitUnit(unitOutcome) {
      const { admissible } = project(unitOutcome);
      return admissible ? { admissible: true } : { admissible: false, reason: 'result-cap' };
    },

    /** TRANSACTIONAL: a refusal has no side effect of any kind — `size()`, the merged array and
     *  every already-merged result's flags are exactly as they were. */
    addUnit(unitOutcome) {
      const { admissible, additions, replacements } = project(unitOutcome);
      if (!admissible) return { accepted: false, reason: 'result-cap' };
      for (const r of replacements) byResultId.set(r.resultId, r);
      for (const r of additions) byResultId.set(r.resultId, r);
      merged = [...byResultId.values()].sort(compareResults);
      return { accepted: true, added: additions.length };
    },
    size: () => merged.length,
    toArray: () => merged,
  };
}
```
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/resultSet.merge.test.mjs test/clashtest/results/resultSet.identity.test.mjs` → 10 + 2 = 12 passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): project unit pairs into canonical ClashResults (P5.1)`

---

### Task P5.2: `RunOutcome` derivation and the normative claim predicate

**Files**
- Modify: `clashtest/results/resultSet.js` (add `deriveRunOutcome`)
- Create: `clashtest/results/claim.js`
- Test: `test/clashtest/results/resultSet.outcome.test.mjs`, `test/clashtest/results/claim.test.mjs`

**Interfaces**

*Consumes* (**RECONCILED**; producer wins — rows N20/D3 and N19/N32):
- the `Ledger`/`UnitRecord` shapes pinned above.
- **A finished `DiagnosticsSummary`** — P4 `execution/diagnostics.js` owns *all* aggregation (duplicate-ownership **D3**); P5 aggregates nothing and never constructs an aggregator. P6 drives `createDiagnosticAggregator(...)` and passes `snapshot()`'s result straight into `deriveRunOutcome`. The fields P5 reads are exactly `{completenessAffectingUpperBound, unclassifiedOccurrences, geometryReadinessOccurrences}`; the block P5 stores verbatim is `{diagnostics, truncated, total, completenessAffectingCount, unclassifiedOccurrences, completenessAffectingUpperBound, countsByReason, omittedReasonOccurrences, geometryReadinessOccurrences}`. There is **no** `retained` field and no `toBlock()`.
- `status`, `reasons` from P6 `run/settlement.js`; `freshness` as the **bare state string** stored on `RunOutcome` (§8.3), which P6 derives from its `Freshness` object (row N32, contradiction C1).

*Produces:* `deriveRunOutcome`, `freshnessStateOf`, `assessNoClashClaim`, `canClaimNoClashes`.

**The freshness two-shape rule (row N19, resolving P6's C1 — controller ruling R3).** `getFreshness` (P6) returns the frozen object `Freshness = {state: 'current'|'stale'|'unverifiable', reasons: string[]}` (§16.4, "stale **with reasons**"); `RunOutcome.freshness` stores the bare `state` (§8.3, and it is what gets digested). `freshnessStateOf` is the **one** adapter between them, and each claim helper calls it **exactly once**. It is fail-closed by construction: anything it does not recognize — `undefined`, `null`, a wrong-shaped object, an object whose `state` is not one of the three literals, an unrecognized string — is `null`, and `null` is not `'current'`, so the claim is `false` (§8.3: "absent or not `current`"). When the argument is an object, its `reasons` are appended to `qualifiers` so a refusal is explainable; only string entries are appended (a malformed `reasons` is ignored, never thrown over).

- [ ] **Step 1: Write the failing outcome-derivation test.**
```js
// test/clashtest/results/resultSet.outcome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRunOutcome } from '../../../clashtest/results/resultSet.js';
import { emptyDiagnostics, ledgerWith, unit } from '../../support/resultSetFixtures.mjs';

const base = { status: 'completed', freshness: 'current', results: [], reasons: [] };

test('coverage is full only for a plan with no planning gap and all leaves evaluated AND scope-equal', () => {
  const full = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u0', 'split'), unit('u1a', 'evaluated')] }) });
  assert.equal(full.coverage, 'full');
  const gapped = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u2', 'failed', { cause: 'capacity-exceeded' })] }) });
  assert.equal(gapped.coverage, 'partial');
  const preplan = deriveRunOutcome({ ...base, status: 'failed', diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ planExists: false, units: [], planningGaps: [{ phase: 'queued', cause: 'test-unavailable' }] }) });
  assert.equal(preplan.coverage, 'partial');                       // never vacuously full
});

// R21-2: the writer's `full` predicate must be the reader's. `validateResultSet` rejects
// `coverage: 'full'` unless every leaf is BOTH `evaluated` and `scopeProof: 'equal'`.
test('an evaluated leaf whose scope was not proven equal is never full coverage', () => {
  for (const proof of ['drift', 'unverifiable', 'not-checked']) {
    const o = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
      ledger: ledgerWith({ units: [unit('u1', 'evaluated'), unit('u2', 'evaluated', { scopeProof: proof })] }) });
    assert.equal(o.coverage, 'partial', proof);
  }
  // a `split` parent is superseded by its leaves and is not checked at all
  const ok = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(),
    ledger: ledgerWith({ units: [unit('u0', 'split', { scopeProof: 'not-checked' }), unit('u0a', 'evaluated')] }) });
  assert.equal(ok.coverage, 'full');
});

test('integrity is caveated by the upper bound or a duplicate-evidence conflict', () => {
  const diag = { ...emptyDiagnostics(), unclassifiedOccurrences: 3, completenessAffectingUpperBound: 3 };
  assert.equal(deriveRunOutcome({ ...base, diagnostics: diag, ledger: ledgerWith({}) }).integrity, 'caveated');
  const dup = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(), ledger: ledgerWith({}),
    results: [{ flags: { duplicateEvidenceConflict: true } }] });
  assert.equal(dup.integrity, 'caveated');
});

test('environmentSensitiveCauses are exact, ascending, and drive the boolean', () => {
  const o = deriveRunOutcome({ ...base, diagnostics: { ...emptyDiagnostics(), geometryReadinessOccurrences: 1 },
    ledger: ledgerWith({ units: [
      unit('u1', 'failed', { cause: 'capacity-exceeded', capacityKind: 'bucket-capacity' }),
      unit('u2', 'failed', { cause: 'stale-placement' })] }) });
  assert.deepEqual(o.environmentSensitiveCauses, ['bucket-capacity', 'geometry-readiness', 'placement-contention']);
  assert.equal(o.environmentSensitive, true);
  const clean = deriveRunOutcome({ ...base, diagnostics: emptyDiagnostics(), ledger: ledgerWith({}) });
  assert.deepEqual(clean.environmentSensitiveCauses, []);
  assert.equal(clean.environmentSensitive, false);
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/resultSet.outcome.test.mjs` → `deriveRunOutcome is not a function` (and the fixture module is missing).
- [ ] **Step 3: Write `deriveRunOutcome` plus the fixture helpers it needs.**
```js
// clashtest/results/resultSet.js (addition)
const ENVIRONMENT_CAUSES = ['bucket-capacity', 'geometry-readiness', 'placement-contention'];

export function deriveRunOutcome({ status, freshness, ledger, diagnostics, results = [], reasons = [] }) {
  const leaves = ledger.units.filter((u) => u.outcome !== 'split');
  // §12.5 / §13.6 (3): a plan exists, no planning gap, and EVERY leaf is `evaluated` AND
  // `scopeProof: 'equal'`. This is verbatim the predicate `validateResultSet` re-checks (R21-2).
  const coverage = ledger.planExists === true
    && ledger.planningGaps.length === 0
    && leaves.length > 0
    && leaves.every((u) => u.outcome === 'evaluated' && u.scopeProof === 'equal')
    ? 'full' : 'partial';
  const duplicateConflict = results.some((r) => r.flags?.duplicateEvidenceConflict === true);
  const integrity = diagnostics.completenessAffectingUpperBound > 0 || duplicateConflict ? 'caveated' : 'clean';
  const causes = new Set();
  for (const u of leaves) {
    if (u.capacityKind === 'bucket-capacity') causes.add('bucket-capacity');
    if (u.outcome === 'failed' && u.cause === 'stale-placement') causes.add('placement-contention');
  }
  if (diagnostics.geometryReadinessOccurrences > 0 || diagnostics.unclassifiedOccurrences > 0) causes.add('geometry-readiness');
  const environmentSensitiveCauses = ENVIRONMENT_CAUSES.filter((c) => causes.has(c));
  return {
    status, coverage, integrity, freshness,
    environmentSensitive: environmentSensitiveCauses.length > 0,
    environmentSensitiveCauses,
    reasons: [...reasons].sort(),
  };
}
```
The fixture module gains `emptyDiagnostics()` — P4's `DiagnosticsSummary` with every counter at 0, **`diagnostics: []`** and `truncated: false` (the array field is `diagnostics`, not `retained`; row N20) — `ledgerWith(over)` (the pinned `Ledger` with `planExists: true`, `pairSpaceTotal: 10`, empty tables) and `unit(id, outcome, over)`, whose defaults are `{cause: null, secondaryCauses: [], capacityKind: null, capDetail: null, scopeProof: 'equal', pairSpaceWeight: 1, taints: [], attempts: 1, durationMs: 0}` — a `split` record defaults `scopeProof: 'not-checked'`.
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/resultSet.outcome.test.mjs` → 4 passing.
- [ ] **Step 5: Write the failing claim truth-table test.**
```js
// test/clashtest/results/claim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessNoClashClaim, canClaimNoClashes, freshnessStateOf } from '../../../clashtest/results/claim.js';
import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { claimableSet } from '../../support/resultSetFixtures.mjs';

// Each row flips exactly ONE conjunct of the §8.3 predicate on a set that is otherwise claimable.
const FLIPS = [
  ['status',                (s) => { s.outcome.status = 'cancelled'; }],
  ['coverage',              (s) => { s.outcome.coverage = 'partial'; }],
  ['integrity',             (s) => { s.outcome.integrity = 'caveated'; }],
  ['pairSpaceTotal',        (s) => { s.ledger.pairSpaceTotal = 0; }],
  ['emptyOperand',          (s) => { s.ledger.emptyOperand = true; }],
  ['unresolvedSelections',  (s) => { s.ledger.unresolvedSelections = [{ selectionRole: 'A', modelKey: 'MA', cause: 'element-unresolvable', dbIds: [4] }]; }],
  ['unreachablePopulation', (s) => { s.ledger.unreachablePopulation = [{ modelKey: 'MA', ownerDbIds: [9], mixedOwnerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }]; }],
  ['hierarchyInternal',     (s) => { s.ledger.hierarchyInternal = [{ modelKey: 'MA', rootCount: 1, ownerCount: 3, examples: [] }]; }],
  ['results',               (s) => { s.results = [{ resultId: 'r', flags: {} }]; }],
  // Review Critical 2 — the digest-version conjunct, flipped ALONE on an otherwise claimable set.
  ['digestVersion',         (s) => { s.digests = { ...s.digests, digestVersion: 99 }; }],
];

test('every conjunct flipped alone blocks the claim', () => {
  for (const [name, flip] of FLIPS) {
    const set = claimableSet();
    flip(set);
    assert.equal(assessNoClashClaim(set, 'current').allowed, false, `${name} must block`);
    assert.equal(canClaimNoClashes(set, 'current'), false, `${name} must block the boolean`);
  }
});

test('freshness is a required argument and only "current" passes', () => {
  const set = claimableSet();
  assert.equal(assessNoClashClaim(set, 'current').allowed, true);
  assert.equal(canClaimNoClashes(set, 'current'), true);
  for (const f of [undefined, null, 'stale', 'unverifiable']) {
    assert.equal(assessNoClashClaim(set, f).allowed, false);
    assert.equal(canClaimNoClashes(set, f), false);
  }
});

// --- row N19 / contradiction C1: the two freshness shapes ------------------------------------
test('freshnessStateOf reads both shapes and is null for everything else', () => {
  for (const s of ['current', 'stale', 'unverifiable']) {
    assert.equal(freshnessStateOf(s), s);
    assert.equal(freshnessStateOf({ state: s, reasons: [] }), s);
    assert.equal(freshnessStateOf(Object.freeze({ state: s, reasons: Object.freeze(['r']) })), s);
  }
  const REJECTED = [undefined, null, '', 'CURRENT', 'fresh', 0, 1, true, [], ['current'],
    {}, { state: null }, { state: 'nope', reasons: [] }, { State: 'current' },
    { state: 'current', reasons: 'not-an-array' }, () => 'current', new Map()];
  for (const bad of REJECTED) assert.equal(freshnessStateOf(bad), null, String(bad));
  assert.equal(freshnessStateOf({ state: 'current', reasons: 'not-an-array' }), null);  // shape is all-or-nothing
});

test('the claim helpers accept the Freshness OBJECT P6 and P7 actually pass', () => {
  const set = claimableSet();
  assert.equal(assessNoClashClaim(set, { state: 'current', reasons: [] }).allowed, true);
  assert.equal(canClaimNoClashes(set, { state: 'current', reasons: [] }), true);
  for (const f of [{ state: 'stale', reasons: ['modelVersion changed'] },
                   { state: 'unverifiable', reasons: ['enumerator absent'] },
                   { state: 'bogus', reasons: [] }, { reasons: [] }]) {
    assert.equal(assessNoClashClaim(set, f).allowed, false, f.state);
    assert.equal(canClaimNoClashes(set, f), false, f.state);
  }
});

test('an object freshness contributes its reasons to qualifiers, so a refusal is explainable (§16.4)', () => {
  const set = claimableSet();
  const a = assessNoClashClaim(set, { state: 'stale', reasons: ['modelVersion changed', 'placementGeneration moved'] });
  assert.equal(a.allowed, false);
  assert.deepEqual(a.qualifiers, [
    { kind: 'freshness', state: 'stale', reason: 'modelVersion changed' },
    { kind: 'freshness', state: 'stale', reason: 'placementGeneration moved' },
  ]);
  assert.deepEqual(assessNoClashClaim(set, 'stale').qualifiers, []);            // a bare string carries none
  assert.deepEqual(assessNoClashClaim(set, { state: 'current', reasons: [] }).qualifiers, []);
  // a malformed reasons list is ignored, never thrown over, and never blocks reading `state`
  const m = assessNoClashClaim(set, { state: 'stale', reasons: [1, null, 'ok', { x: 1 }] });
  assert.deepEqual(m.qualifiers, [{ kind: 'freshness', state: 'stale', reason: 'ok' }]);
});

test('the sealed outcome.freshness is never substituted for the argument', () => {
  const set = claimableSet();
  set.outcome.freshness = 'current';
  assert.equal(canClaimNoClashes(set, 'stale'), false);
});

test('a recorded acceptance allows a QUALIFIED claim only', () => {
  const set = claimableSet();
  set.ledger.hierarchyInternal = [{ modelKey: 'MA', rootCount: 1, ownerCount: 3, examples: [] }];
  set.provenance.libraryExclusions = ['hierarchy-internal'];
  assert.equal(assessNoClashClaim(set, 'current').allowed, false);        // unaccepted default fails closed
  set.provenance.hierarchyInternalAcceptance = { recordRef: 'rec-7' };
  const a = assessNoClashClaim(set, 'current');
  assert.equal(a.allowed, true);
  assert.equal(a.unqualified, false);
  assert.deepEqual(a.qualifiers, [{ kind: 'hierarchy-internal-accepted', recordRef: 'rec-7', rootCount: 1, ownerCount: 3 }]);
  assert.deepEqual(a.exclusions, ['hierarchy-internal']);
  assert.equal(a.proofMethod, 'bracketed-digest');
  assert.equal(canClaimNoClashes(set, 'current'), false);                 // the boolean never licenses it
});

// --- review Critical 2: the claim predicate OWNS the digest-version rule ----------------------
test('an unknown digestVersion blocks the claim on an otherwise claimable EMPTY-results set', () => {
  // The earlier draft asserted this on the `positives` fixture, whose non-empty `results` already
  // blocked the claim — so it proved nothing. This set is claimable on every OTHER conjunct.
  const base = claimableSet();
  assert.deepEqual(base.results, [], 'the fixture must be the empty-results completed-clean shape');
  assert.equal(assessNoClashClaim(base, 'current').allowed, true, 'baseline is claimable');
  assert.equal(base.digests.digestVersion, DIGEST_VERSION);

  for (const bad of [99, 0, -1, 1.5, '1', null, undefined, Number.NaN]) {
    const set = claimableSet();
    set.digests = { ...set.digests, digestVersion: bad,
                    pairSetDigest: `sha256:${'0'.repeat(64)}`, ledgerDigest: `sha256:${'0'.repeat(64)}` };
    const a = assessNoClashClaim(set, 'current');
    assert.equal(a.allowed, false, `digestVersion ${String(bad)} must block`);
    assert.equal(canClaimNoClashes(set, 'current'), false, String(bad));
    assert.ok(a.qualifiers.some((q) => q.reason === 'unknown-digest-version'),
      `the refusal must be explainable: ${JSON.stringify(a.qualifiers)}`);
  }

  // Absent or malformed `digests` fails the same way — fail-closed, never a thrown TypeError.
  for (const digests of [undefined, null, {}, 'sha256:x', []]) {
    const set = claimableSet();
    set.digests = digests;
    assert.equal(assessNoClashClaim(set, 'current').allowed, false, String(digests));
  }
});

test('non-empty results are a valid positive result, never a claim', () => {
  const set = claimableSet();
  set.results = [{ resultId: 'r1', flags: {} }, { resultId: 'r2', flags: {} }];
  set.provenance.hierarchyInternalAcceptance = { recordRef: 'rec-7' };
  assert.equal(assessNoClashClaim(set, 'current').allowed, false);
});
```
- [ ] **Step 6: Run it and see it fail.** `node --test test/clashtest/results/claim.test.mjs` → module `claim.js` not found.
- [ ] **Step 7: Write `claim.js` (the whole predicate in one place).**
```js
// clashtest/results/claim.js
import { DIGEST_VERSION } from '../util/canonical.js';    // P0 owns the number; P5 never restates it

export const FRESHNESS_STATES = Object.freeze(['current', 'stale', 'unverifiable']);

/** Row N19 / P6 contradiction C1: the ONE adapter between §8.3's bare enum and §16.4's
 *  `{state, reasons}` object. Fail-closed: anything unrecognized is `null`, and `null` is
 *  not `'current'`, so an absent or malformed freshness can never license a claim. */
export function freshnessStateOf(freshness) {
  if (typeof freshness === 'string') return FRESHNESS_STATES.includes(freshness) ? freshness : null;
  if (freshness === null || typeof freshness !== 'object' || Array.isArray(freshness)) return null;
  const { state, reasons } = freshness;
  if (!FRESHNESS_STATES.includes(state)) return null;
  if (reasons !== undefined && !Array.isArray(reasons)) return null;   // malformed shape ⇒ unrecognized
  return state;
}

/** The `reasons[]` of a `Freshness` object, as claim qualifiers (§16.4 "stale WITH reasons").
 *  A bare string carries none. Non-string entries are skipped, never thrown over. */
function freshnessQualifiers(freshness, state) {
  if (state === null || freshness === null || typeof freshness !== 'object') return [];
  const reasons = Array.isArray(freshness.reasons) ? freshness.reasons : [];
  return reasons.filter((r) => typeof r === 'string').map((reason) => ({ kind: 'freshness', state, reason }));
}

/** The ONE normative claim predicate of spec §8.3. Pure: it does NOT validate its argument
 *  (§13.6 residual trust boundary) and does NOT recompute freshness.
 *  `currentFreshness` is EITHER a `Freshness` object or a bare state string (row N19). */
export function assessNoClashClaim(resultSet, currentFreshness) {
  const freshnessState = freshnessStateOf(currentFreshness);        // called exactly once per helper
  const outcome = resultSet?.outcome ?? {};
  const ledger = resultSet?.ledger ?? {};
  const provenance = resultSet?.provenance ?? {};
  const hierarchy = ledger.hierarchyInternal ?? [];
  const acceptance = provenance.hierarchyInternalAcceptance ?? null;
  // Review Critical 2: THIS predicate owns the digest-version rule. An unknown `digestVersion`
  // means the engine cannot verify the pair set or ledger under its own semantics (§13.6: "not
  // compared … never `current`-claimable"), so it cannot be the basis of a no-clash claim. Absent
  // or malformed `digests` fails the same way — fail-closed by construction, like freshness.
  const knownDigestVersion = resultSet?.digests?.digestVersion === DIGEST_VERSION;
  const conjuncts = {
    completed: outcome.status === 'completed',
    full: outcome.coverage === 'full',
    clean: outcome.integrity === 'clean',
    current: freshnessState === 'current',
    knownDigestVersion,
    nonEmptyPairSpace: Number.isSafeInteger(ledger.pairSpaceTotal) && ledger.pairSpaceTotal > 0,
    notEmptyOperand: ledger.emptyOperand !== true,
    noUnresolvedSelections: (ledger.unresolvedSelections ?? []).length === 0,
    noUnreachablePopulation: (ledger.unreachablePopulation ?? []).length === 0,
    hierarchyClearOrAccepted: hierarchy.length === 0 || acceptance !== null,
    noResults: (resultSet?.results ?? []).length === 0,
  };
  const allowed = Object.values(conjuncts).every(Boolean);
  const unqualified = allowed && hierarchy.length === 0;
  const qualifiers = [];
  if (allowed && hierarchy.length > 0) {
    qualifiers.push({
      kind: 'hierarchy-internal-accepted',
      recordRef: acceptance.recordRef,
      rootCount: hierarchy.reduce((n, e) => n + e.rootCount, 0),
      ownerCount: hierarchy.reduce((n, e) => n + e.ownerCount, 0),
    });
  }
  if (!knownDigestVersion) {
    qualifiers.push({ kind: 'digest-version', reason: 'unknown-digest-version',
                      digestVersion: resultSet?.digests?.digestVersion ?? null });
  }
  qualifiers.push(...freshnessQualifiers(currentFreshness, freshnessState));
  return {
    allowed, unqualified, qualifiers,
    exclusions: [...(provenance.libraryExclusions ?? [])],
    proofMethod: provenance.scopeProof?.method ?? null,
  };
}

export function canClaimNoClashes(resultSet, currentFreshness) {
  return assessNoClashClaim(resultSet, currentFreshness).unqualified;
}
```
- [ ] **Step 8: Run both files and see them pass.** `node --test test/clashtest/results/resultSet.outcome.test.mjs test/clashtest/results/claim.test.mjs` → 4 + 9 = 13 passing.
- [ ] **Step 9: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): derive run outcome axes and the no-clash claim predicate (P5.2)`

---

### Task P5.3: Draft assembly, digests, sealing and deep freeze

**Files**
- Modify: `clashtest/results/resultSet.js`
- Test: `test/clashtest/results/resultSet.seal.test.mjs`

**Interfaces**

*Consumes* (**RECONCILED** against P0's interface summary — rows N3/N5 (digest helpers), N6 (slicer), N4 (freeze)):
- `util/canonical.js` (P0): `canonicalJson(value) → string`; **`digestCanonical(value) → 'sha256:<hex>'` — value-taking and synchronous** (there is no `digestOf`, no `digestSync(text)`); `DIGEST_VERSION` (the `digests.digestVersion` P5 records — P5 does not restate the number).
- `util/slicer.js` (P0): `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, …}) → {tick(label?), yieldNow(label?), forEach, sortSliced, stats}`. **The yield point is `tick(label?)`, never `step()`**; it returns `undefined` when not due and a Promise when it is, so every call site is `const p = slicer.tick('seal'); if (p) await p;` — awaiting unconditionally would add a microtask per node.
- `util/capture.js` (P0): **`deepFreezeSliced(value, slicer) → Promise<value>`** and `isDeepFrozen(value)`. The second argument is the **slicer object itself**, not `{slicer}`. P5 writes no freeze of its own.

*Produces:* `buildResultSet`, `sealResultSet`, `pairSetDigestInput`, `ledgerDigestInput`.

- [ ] **Step 1: Write the failing sealing test.**
```js
// test/clashtest/results/resultSet.seal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultSet, sealResultSet, ledgerDigestInput } from '../../../clashtest/results/resultSet.js';
import { fakeSlicer, runParts } from '../../support/resultSetFixtures.mjs';

test('a sealed set is frozen all the way down and JSON round-trips with semantic equality', async () => {
  const set = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  assert.equal(set.sealed, true);
  assert.equal(Object.isFrozen(set), true);
  assert.equal(Object.isFrozen(set.ledger.units[0]), true);
  assert.equal(Object.isFrozen(set.results), true);
  assert.throws(() => { 'use strict'; set.outcome.coverage = 'full'; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(set)), structuredClone(set));
});

test('pre-resolution seal has null definition, null digest fields and a planning gap only', async () => {
  const set = await sealResultSet(buildResultSet(runParts('cancelled-pre-resolution')), { slicer: fakeSlicer() });
  assert.equal(set.definition, null);
  assert.deepEqual(set.testRef, { testId: 'T1', revision: null, semanticDigest: null });
  assert.deepEqual(set.ledger.units, []);
  assert.equal(set.ledger.pairSpaceTotal, 0);
  assert.equal(set.outcome.coverage, 'partial');
  assert.ok(set.outcome.reasons.includes('planning:cancelled'));
});

test('ledgerDigest excludes timings, attempts, secondaryCauses and the admission baseline', () => {
  const parts = runParts();
  const a = ledgerDigestInput(parts.ledger, parts.runOptions);
  parts.ledger.units[0].attempts = 7;
  parts.ledger.units[0].durationMs = 999;
  // §16.7: "secondary causes are diagnostic and EXCLUDED from ledgerDigest" — which of them a
  // real timing race exposes varies, while the primary cause is a function of the recorded facts.
  parts.ledger.units[0].secondaryCauses = ['model-evicted', 'scope-unverifiable'];
  assert.deepEqual(ledgerDigestInput(parts.ledger, parts.runOptions), a);
  assert.equal(JSON.stringify(a).includes('secondaryCauses'), false);
});

test('two settlements differing ONLY in observed secondary causes seal to the same ledgerDigest', async () => {
  // AC-21: the same facts in different callback orders must not change the digest.
  const PERMUTATIONS = [[], ['model-evicted'], ['model-evicted', 'scope-unverifiable'],
    ['scope-unverifiable', 'model-evicted'], ['cancel-requested', 'model-evicted', 'stale-placement']];
  const digests = new Set();
  for (const secondaryCauses of PERMUTATIONS) {
    const parts = runParts();
    parts.ledger.units[0] = { ...parts.ledger.units[0], cause: 'capacity-exceeded', secondaryCauses };
    const sealed = await sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
    digests.add(sealed.digests.ledgerDigest);
    assert.deepEqual(sealed.ledger.units[0].secondaryCauses, secondaryCauses);   // still RECORDED, just not digested
  }
  assert.equal(digests.size, 1);
});

test('the per-root cls marker IS digested (R2: it is schema, not decoration)', async () => {
  const parts = runParts();
  const a = await sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
  const moved = runParts();
  moved.ledger.rootOwners[0].owners[0].cls = 'C';                 // was 'A'
  const b = await sealResultSet(buildResultSet(moved), { slicer: fakeSlicer() });
  assert.notEqual(a.digests.ledgerDigest, b.digests.ledgerDigest);
});

test('a set is sealed exactly once — resealing is a programmer error, not a spec error', async () => {
  const sealed = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  await assert.rejects(sealResultSet(sealed, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
  // a draft that already carries digests is equally refused (a half-sealed object is never completed)
  const halfSealed = { ...buildResultSet(runParts()), digests: { digestVersion: 1, pairSetDigest: 'sha256:x', ledgerDigest: 'sha256:y' } };
  await assert.rejects(sealResultSet(halfSealed, { slicer: fakeSlicer() }),
    (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT');
  for (const bad of [null, undefined, 'set', { sealed: true, digests: null }]) {
    await assert.rejects(sealResultSet(bad, { slicer: fakeSlicer() }),
      (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_DRAFT', String(bad));
  }
  assert.equal(Object.isFrozen(sealed), true);                    // the original is untouched
});

test('digests change with discrete content and are stable under key order', async () => {
  const a = await sealResultSet(buildResultSet(runParts()), { slicer: fakeSlicer() });
  const reordered = runParts();
  reordered.ledger = { units: reordered.ledger.units, ...reordered.ledger };
  const b = await sealResultSet(buildResultSet(reordered), { slicer: fakeSlicer() });
  assert.equal(a.digests.ledgerDigest, b.digests.ledgerDigest);
  assert.equal(a.digests.pairSetDigest, b.digests.pairSetDigest);
  const changed = runParts();
  changed.results[0].flags = { witnessUnavailable: true };
  const c = await sealResultSet(buildResultSet(changed), { slicer: fakeSlicer() });
  assert.notEqual(a.digests.pairSetDigest, c.digests.pairSetDigest);
  assert.equal(a.digests.digestVersion, 1);
});

test('the freeze is sliced, not recursive: a 40-deep, 50k-node set seals without stack overflow', async () => {
  const slicer = fakeSlicer();
  const set = await sealResultSet(buildResultSet(runParts('wide')), { slicer });
  assert.equal(Object.isFrozen(set), true);
  assert.ok(slicer.ticks > 1, 'freeze ticked more than once');
  assert.ok(slicer.yields >= 1, 'and yielded at least once');
});
```
`fakeSlicer()` (in `resultSetFixtures.mjs`) is P0's **`tick(label?)`** shape, not `step()`: it counts `ticks`, returns `undefined` until a configurable `yieldEvery` (default 64) and then a resolved Promise, counting `yields`. It is the same contract `createSlicer` gives, so swapping in the real slicer changes nothing.
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/resultSet.seal.test.mjs` → `buildResultSet is not a function`.
- [ ] **Step 3: Write the implementation.**
```js
// clashtest/results/resultSet.js (addition)
import { DIGEST_VERSION, digestCanonical } from '../util/canonical.js';
import { deepFreezeSliced } from '../util/capture.js';          // P0 owns the one sliced deep freeze (N4)

const SIZING_OPTION_KEYS = ['broadPhase', 'maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit',
  'maxTargetModelsPerUnit', 'maxTargetFragmentsPerUnit', 'maxUnitsPerRun', 'maxResultsPerRun',
  'maxPlacementRetries', 'maxPlanReferences', 'maxLedgerRecords', 'maxPairsPerOutcome',
  'maxDiagnosticsPerOutcome', 'maxDistinctReasons', 'maxElementTaintsPerUnit'];

// Excludes `attempts` and `durationMs` (§13.1: timings are wall-clock and load-dependent) and
// `secondaryCauses` (§16.7: "diagnostic and excluded from ledgerDigest" — which of them a real
// timing race exposes varies, so including them would break AC-21's digest equality across
// callback schedulings; the primary `cause` is a pure function of the recorded facts).
const DIGESTED_UNIT_KEYS = ['unitId', 'kind', 'parentUnitId', 'sourceModelKey', 'sourceRootDbIds',
  'targets', 'outcome', 'cause', 'capacityKind', 'capDetail', 'scopeProof',
  'pairSpaceWeight', 'taints'];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const flagNames = (flags) => Object.keys(flags).filter((k) => flags[k] === true).sort();

export const pairSetDigestInput = (results) => results.map((r) => [r.resultId, flagNames(r.flags)]);

export function ledgerDigestInput(ledger, runOptions) {
  return {
    planExists: ledger.planExists, pairSpaceTotal: ledger.pairSpaceTotal,
    emptyOperand: ledger.emptyOperand,
    units: ledger.units.map((u) => pick(u, DIGESTED_UNIT_KEYS)),
    rootOwners: ledger.rootOwners, unresolvedSelections: ledger.unresolvedSelections,
    unreachablePopulation: ledger.unreachablePopulation, hierarchyInternal: ledger.hierarchyInternal,
    planningGaps: ledger.planningGaps, exclusions: ledger.exclusions, warnings: ledger.warnings,
    budgetExhausted: ledger.budgetExhausted, firstRefusalUnitId: ledger.firstRefusalUnitId,
    sizingOptions: pick(runOptions, SIZING_OPTION_KEYS),
  };
}

export function buildResultSet(parts) {
  const { runId, testRef, definition, derivedFromRunId = null, outcome, provenance, ledger,
          results, diagnostics, statistics } = parts;
  return { schemaVersion: SCHEMA_VERSION, runId, testRef, definition, derivedFromRunId,
           outcome, provenance, ledger, results, diagnostics, statistics,
           digests: null, sealed: false };
}

/** §13.3: "sealed exactly once … enforced, not merely promised". A non-draft is an engine bug,
 *  not a data error, so it is a plain programmer error with a stable code — never a §18 class
 *  (no spec error names this case, and giving it one would invite callers to handle it). */
const NOT_A_DRAFT = 'ERR_RESULT_SET_NOT_DRAFT';
function assertDraft(draft) {
  const bad = draft === null || typeof draft !== 'object' ? 'not an object'
    : draft.sealed !== false ? 'already sealed'
    : draft.digests !== null ? 'already carries digests'
    : null;
  if (bad === null) return;
  const err = new TypeError(`sealResultSet: ${bad}; a Result Set is sealed exactly once (spec §13.3)`);
  err.code = NOT_A_DRAFT;
  throw err;
}

export async function sealResultSet(draft, { slicer }) {
  assertDraft(draft);
  // Build the final immutable object FIRST; `sealed: true` is set on the new object only, so a
  // failure here leaves the draft exactly as it was and no half-sealed set can escape (R10).
  const set = { ...draft,
    digests: { digestVersion: DIGEST_VERSION,
      pairSetDigest: digestCanonical(pairSetDigestInput(draft.results)),
      ledgerDigest: digestCanonical(ledgerDigestInput(draft.ledger, draft.provenance.runOptions)) },
    sealed: true };
  await deepFreezeSliced(set, slicer);              // P0's helper; the slicer object, not {slicer}
  return set;
}
```
`canonicalJson` (inside `digestCanonical`) sorts keys, so the reordered-ledger case produces the same digest; `pairSetDigestInput` covers only `(resultId, flags)`, so float evidence never enters a digest.
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/resultSet.seal.test.mjs` → 9 passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): assemble, digest and seal Result Sets (P5.3)`

---

### Task P5.4: Capture-first, schema version and structural validation

**Files**
- Create: `clashtest/results/validateResultSet.js`
- Test: `test/clashtest/results/validateResultSet.capture.test.mjs`

**Interfaces**

*Consumes* (**RECONCILED** against P0's interface summary and its design note 2 / Gates item 3 — rows N4 and N29; there is no `captureDetached` and no `CaptureError`):
- `util/capture.js` (P0): **`captureData(root, opts) → {ok: true, value, nodes} | {ok: false, issues: {path, code, message}[], issuesTruncated, gate?}`**. It **returns, never throws** for a data problem (only a `TypeError` when `opts.maxNodes` is missing), so `captureResultSet` is the adapter that turns a result object into the §18 error class. `opts` are exactly P0's: `maxNodes` (required), `maxDepth`, `maxIssues`, `maxStringLength`, `maxKeyLength`, `maxArrayLength`, `stringLimitFor(pointer)`, `arrayLimitFor(pointer)`, `rootGate {key, check}`. Paths are **JSON pointers** (`/ledger/units/3/taints`). `CAPTURE_CODES` are `accessor`, `symbol-key`, `sparse-array`, `array-extra-key`, `not-plain`, `cyclic`, `unreadable`, `depth`, `too-many-nodes`, `string-too-long`, `array-too-long`, `gated`.
- `options.js` (P0): `RUN_OPTION_CEILINGS`, `ENGINE_LIMIT_CEILINGS` (the §17.1.1 hard maxima — **there is no `SCHEMA_CEILINGS` export**), `SCHEMA_MAX_NODES`, and the reader's own `limits.maxCapturedNodes`.
- `errors.js` (P0): `CorruptResultSetError{runId, issues}`, `ResultSetTooLargeError{runId}`, `UnsupportedSchemaVersionError{type, schemaVersion, supported}` — all constructed with **one object argument** (row N1).

*Produces:* `captureResultSet`, `applyMigration`, and the structural phase of `validateResultSetSteps`.

**The two-ceiling mapping on P0's one ceiling** (P0 design note 2 / P0 *Gates* item 3, which asked P5 to state it). Spec §13.6 distinguishes a **data-format** ceiling `SCHEMA_MAX_NODES` (exceeding it ⇒ `CorruptResultSetError`, because no conforming writer can produce such a set) from an **operational** reader limit `maxCapturedNodes ≤ SCHEMA_MAX_NODES` (exceeding it ⇒ `ResultSetTooLargeError`: "valid, not corrupt"). `captureData` has one `maxNodes`, so P5 calls it with `maxNodes = min(limits.maxCapturedNodes, SCHEMA_MAX_NODES)` and maps the single `too-many-nodes` issue by **which ceiling actually bit**: `limits.maxCapturedNodes >= SCHEMA_MAX_NODES` ⇒ the schema ceiling bit ⇒ `CorruptResultSetError`; otherwise the reader's own limit bit first ⇒ `ResultSetTooLargeError`. Both fail closed; the only loss is that a set beyond `SCHEMA_MAX_NODES` read by an engine with a *smaller* limit is labelled "too large" rather than "corrupt" — the conservative direction, since the reader refuses it either way.

**The 64 KiB unknown-field budget is charged DURING capture, before allocation** (review Critical 1; the earlier deviation — "charged on the captured copy because P0 has no such option" — is **withdrawn**, and the reason it was wrong is worth stating: the node ceiling is not a byte bound, so 100,000 individually legal 4 KiB strings under an open `ledger.futureData` sit far below `maxCapturedNodes` and would allocate ≈ 400 MB before a post-hoc check rejected them, defeating the whole point of §13.6's "rejected as soon as the traversal reaches it, before the rest is copied").

P0 has added the option this needs (**confirmed against P0's current interface summary, not assumed**):

```js
/** @typedef {Object} OpenFieldBudget
 *  @property {(pathSegments: readonly string[]) => boolean} isOpenPath   true at an OPEN-type path;
 *                                                the budget then also covers everything BELOW it
 *  @property {number} maxBytes                   the §13.6 unknown-field budget
 */
```

**The contract P5 relies on, as P0 states it.** A value is *open* if `isOpenPath` is true for its own path **or its parent is open** (the predicate is not consulted below an open path). Every open value is charged to **one** cumulative counter **before it is copied**: a string by its UTF-8 byte length (a code-unit scan of the string already read from the descriptor — no copy, and a string longer in UTF-16 units than the remaining budget is refused without even being scanned), each **property key** of an open object by its UTF-8 length (charged *before* that property's descriptor is read), a number/boolean/`null` by 8 bytes, and each open object/array **container** by 8 bytes (so nested empty containers cannot dodge the budget). Closed values are never charged. Exceeding `maxBytes` stops capture at once with the single issue `unknown-field-bytes@<pointer of the offending value>`: **no later descriptor is read and nothing later is copied**.

`captureData` also now returns **`nodes` on failure** — exactly the number of values copied when capture stopped — and `openFieldBytes`, the running total. That is what makes the allocation guarantee *assertable* rather than merely stated, and P5's test below asserts on both.

**What P5 supplies.** `isOpenPath` comes straight from the **closed structural-schema table** of Task P5.5: a path is open exactly when its parent is one of §13.6's open types (`ResultSet` top level, `ledger`, `provenance`, `outcome`, `diagnostics`) **and** its last segment is not a documented field of that type. The **root itself is never open** (`pathSegments.length === 0 ⇒ false`) — without that guard the whole set would be inside budget scope, and every conforming set would be refused. Every closed type's unknown field is an error (`unknown-field-closed-type`), never a budgeted byte.

`maxBytes` is §13.6's 64 KiB. Like `MAX_DEPTH = 64` and `MAX_ISSUES = 20` — and unlike a §17.1 default — this is a **data-format** constant, not a G-CAL-gated tunable, so P5 declares `UNKNOWN_FIELD_BYTES = 64 * 1024` in `resultSetSchema.js` beside the schema it belongs to, and passes `limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES`. If P0 later adds the engine-limit key (**X2**), P5 picks it up with no code change and every test keeps reading the value from `limits`, never from a literal.

`captureResultSet` maps the new capture code the same way it maps every other non-`too-many-nodes` code: `unknown-field-bytes` ⇒ `CorruptResultSetError{runId, issues}` (§13.6: "else `CorruptResultSetError`, never preserved"). The **post-capture** `unknown-field-bytes` rule in Task P5.5 survives only as a **defensive re-check** on the captured copy — it must never be the only enforcement point, and a set that reaches it over budget is an engine bug (capture should have refused it), which is why the rule table now marks it as such.

**`schemaVersion` handling** (review question 4; spec §13.6: "a reader rejects a version greater than it understands with `UnsupportedSchemaVersionError`; lower versions go through a registered migration"; "a missing or throwing migration is `migration-failed`"). The root gate admits `v === SCHEMA_VERSION` **or** a `v` the supplied `migrations` table knows; every rejection is then classified from `gate.value`, before any other property of `raw` is read:

| Observed `schemaVersion` | Error | Why |
|---|---|---|
| integer `> SCHEMA_VERSION` | `UnsupportedSchemaVersionError{type: 'ResultSet', schemaVersion, supported: SCHEMA_VERSION}` | §13.6's literal rule; the only case it names. |
| integer in `[1, SCHEMA_VERSION)` with no registered migration | `CorruptResultSetError` issue `{path: '/schemaVersion', code: 'migration-failed'}` | §13.6: "a missing … migration is `migration-failed`". (**Unreachable while `SCHEMA_VERSION === 1`** — the range is empty. Named so a v2 does not have to invent it.) |
| integer in `[1, SCHEMA_VERSION)` **with** a registered migration | none — `applyMigration` runs | Single-hop; output must be at `SCHEMA_VERSION` and is re-validated. |
| absent, non-integer, `< 1`, or any non-number | `CorruptResultSetError` issue `{path: '/schemaVersion', code: 'invalid-schema-version'}` | The spec is silent; this is the same code P2 uses for a definition's non-`1` non-integer version (register **S-P2-3**), so the two persisted types answer alike. Recorded as a P5 decision. |
| `0`, `-3`, `1.5`, `'1'` … **even with a migration registered under that exact key** | `CorruptResultSetError` issue `{path: '/schemaVersion', code: 'invalid-schema-version'}` | **Review Important 1.** Registering a migration must never widen the set of *valid* schema versions: a configuration mistake that registers key `0` would otherwise make malformed version-zero data look like a supported historical schema. The admissibility test is `Number.isInteger(v) && v >= 1 && v < SCHEMA_VERSION && migrations.has(v)` — **the range check first, the table second**. |

**Migrations are single-hop** (review question 3): the table is `Map<fromVersion, (set) => set>` and every entry migrates **directly to `SCHEMA_VERSION`**; `applyMigration` does exactly one lookup and then requires `migrated.schemaVersion === SCHEMA_VERSION`. No chaining, so no ordering or cycle question exists. The real table is **empty** (only v1 exists), which is why `applyMigration` is exported and the wiring is proven with an injected fake migration rather than with production data.

**Migration admissibility is a range check *and* a table lookup** (review Important 1). One named predicate, used by the root gate and by `applyMigration` alike:

```js
const migratableFrom = (v, migrations) =>
  Number.isInteger(v) && v >= 1 && v < SCHEMA_VERSION && migrations.has(v);
```

Because `SCHEMA_VERSION === 1` makes `[1, SCHEMA_VERSION)` empty, **no real migration is reachable in this build**, and the earlier draft's "register a migration for version `0` and watch it be accepted" test was not merely weak — it asserted the defect. It is replaced by two tests that are both reachable and correct: (a) version `0` with a migration registered under key `0` is **refused** as `invalid-schema-version` (the range check wins); (b) `applyMigration`'s **dispatch** is exercised as a pure function with an **injected higher current version**, i.e. `applyMigration(captured, migrations, {runId, currentVersion: 2})`, so the single-hop contract (one lookup; missing/throwing/non-conforming ⇒ `migration-failed`) is proven without pretending an invalid version is valid. `currentVersion` defaults to `SCHEMA_VERSION` and exists **only** so the dispatcher is testable while the real table is empty; production never passes it.

- [ ] **Step 1: Write the failing capture test.**
```js
// test/clashtest/results/validateResultSet.capture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureResultSet, applyMigration, nodeCeilingError, validateResultSet, SCHEMA_VERSION } from '../../../clashtest/results/validateResultSet.js';
import { isOpenPath, UNKNOWN_FIELD_BYTES } from '../../../clashtest/results/resultSetSchema.js';
import { captureData } from '../../../clashtest/util/capture.js';       // the P5<->P0 seam, directly
import { CorruptResultSetError, ResultSetTooLargeError, UnsupportedSchemaVersionError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS, RUN_OPTION_CEILINGS, SCHEMA_MAX_NODES } from '../../../clashtest/options.js';
import { sealedSet } from '../../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;
const corruptWith = (code) => (e) => e instanceof CorruptResultSetError && e.issues.some((i) => i.code === code);

test('capture detaches: mutating the source afterwards cannot change the capture', async () => {
  const raw = structuredClone(await sealedSet());
  const captured = captureResultSet(raw, { limits });
  raw.outcome.coverage = 'full';
  raw.results.push({ resultId: 'forged' });
  assert.equal(captured.outcome.coverage, 'partial');
  assert.equal(captured.results.length, 0);
});

test('schemaVersion is read first and an unsupported value throws before anything else is read', async () => {
  const raw = structuredClone(await sealedSet());
  const read = [];
  const spied = new Proxy({ ...raw, schemaVersion: SCHEMA_VERSION + 1 },
    { get(t, k) { read.push(k); return t[k]; }, ownKeys(t) { read.push('#ownKeys'); return Reflect.ownKeys(t); } });
  assert.throws(() => captureResultSet(spied, { limits }),
    (e) => e instanceof UnsupportedSchemaVersionError && e.schemaVersion === SCHEMA_VERSION + 1
        && e.supported === SCHEMA_VERSION && e.type === 'ResultSet');
  assert.equal(read.includes('results'), false, 'no other property was reached');
});

test('a missing, non-integer or sub-1 schemaVersion is invalid-schema-version, not "unsupported"', async () => {
  const base = structuredClone(await sealedSet());
  for (const bad of [undefined, null, 0, -1, 1.5, '1', true, NaN, {}]) {
    const raw = { ...base };
    if (bad === undefined) delete raw.schemaVersion; else raw.schemaVersion = bad;
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('invalid-schema-version'), String(bad));
  }
});

// Review Important 1: registering a migration must NEVER widen the set of valid versions.
test('an invalid schemaVersion stays invalid even with a migration registered under that key', async () => {
  const base = structuredClone(await sealedSet());
  for (const bad of [0, -1, 1.5]) {
    const raw = { ...base, schemaVersion: bad };
    const migrations = new Map([[bad, (s) => ({ ...s, schemaVersion: SCHEMA_VERSION })]]);
    assert.throws(() => captureResultSet(raw, { limits, migrations }),
      corruptWith('invalid-schema-version'), `${bad} must stay invalid`);
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('invalid-schema-version'), String(bad));
  }
  // …and the current version is admitted with no table at all.
  assert.equal(captureResultSet({ ...base }, { limits }).schemaVersion, SCHEMA_VERSION);
});

// `[1, SCHEMA_VERSION)` is EMPTY while SCHEMA_VERSION === 1, so the dispatcher is proven as a pure
// function with an INJECTED higher current version — never by pretending version 0 is valid.
test('applyMigration is single-hop: one lookup, output must already be at the current version', () => {
  const captured = { schemaVersion: 1, results: [] };
  const opts = { runId: 'r', currentVersion: 2 };                              // injected, test-only
  const good = new Map([[1, (s) => ({ ...s, schemaVersion: 2 })]]);
  assert.equal(applyMigration(captured, good, opts).schemaVersion, 2);
  for (const table of [new Map(),                                              // missing
                       new Map([[1, () => { throw new Error('boom'); }]]),     // throwing
                       new Map([[1, (s) => s]]),                               // output still at 1: no chaining
                       new Map([[1, () => null]])]) {
    assert.throws(() => applyMigration(captured, table, opts), corruptWith('migration-failed'));
  }
  // The default current version is SCHEMA_VERSION, and a source version outside [1, current) is
  // never dispatched at all — not even to a registered entry.
  assert.throws(() => applyMigration({ schemaVersion: 0 }, new Map([[0, (s) => s]]), { runId: 'r' }),
    corruptWith('invalid-schema-version'));
});

test('accessors are rejected without ever invoking the getter — including runId and schemaVersion', async () => {
  const base = structuredClone(await sealedSet());
  for (const key of ['results', 'runId']) {
    const raw = structuredClone(base);
    let invoked = 0;
    Object.defineProperty(raw, key, { get() { invoked += 1; return []; }, configurable: true, enumerable: true });
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith('accessor'), key);
    assert.equal(invoked, 0, key);
  }
  // `runId` is a parameter, never read off the untrusted argument: a throwing getter cannot fire.
  const hostile = structuredClone(base);
  Object.defineProperty(hostile, 'runId', { get() { throw new Error('side effect'); }, configurable: true, enumerable: true });
  assert.throws(() => captureResultSet(hostile, { limits, runId: 'diagnostic-id' }),
    (e) => e instanceof CorruptResultSetError && e.runId === 'diagnostic-id');
});

test('cyclic, non-plain, symbol-keyed and sparse inputs are corrupt, never partially copied', async () => {
  const cases = [
    ['cyclic', (s) => { s.ledger.self = s.ledger; }],
    ['not-plain', (s) => { s.statistics.m = new Map(); }],
    ['not-plain', (s) => { s.statistics.n = Number.POSITIVE_INFINITY; }],
    ['not-plain', (s) => { s.statistics.f = () => 1; }],
    ['not-plain', (s) => { s.statistics.u = undefined; }],
    ['symbol-key', (s) => { s.ledger[Symbol('x')] = 1; }],
    ['sparse-array', (s) => { s.results = Array.from({ length: 3 }); }],
    ['array-extra-key', (s) => { s.results.tag = 'x'; }],
    ['depth', (s) => { let v = 1; for (let i = 0; i < 70; i++) v = { c: v }; s.ledger.deep = v; }],
  ];
  for (const [code, mutate] of cases) {
    const raw = structuredClone(await sealedSet());
    mutate(raw);
    assert.throws(() => captureResultSet(raw, { limits }), corruptWith(code), code);
  }
});

test('issues carry a path and a code and never a value or a message (§13.6)', async () => {
  const raw = structuredClone(await sealedSet());
  raw.provenance.secretToken = 'hunter2';
  raw.provenance.bad = new Map();
  try {
    captureResultSet(raw, { limits });
    assert.fail('expected a corrupt set');
  } catch (e) {
    assert.ok(e.issues.length > 0 && e.issues.length <= 20);
    for (const i of e.issues) assert.deepEqual(Object.keys(i).sort(), ['code', 'path']);
    assert.equal(JSON.stringify(e.issues).includes('hunter2'), false);
  }
});

test('a nested array over its §17.1.1 schema ceiling is corrupt', async () => {
  const raw = structuredClone(await sealedSet());
  raw.results = Array.from({ length: RUN_OPTION_CEILINGS.maxResultsPerRun + 1 }, (_, i) => ({ resultId: `r${i}`, flags: {} }));
  assert.throws(() => captureResultSet(raw, { limits }), corruptWith('array-too-long'));
});

test('the ONE node ceiling maps to two errors by which ceiling actually bit', async () => {
  const valid = structuredClone(await sealedSet('many-results'));
  // End to end: a reader limit below the schema ceiling ⇒ "valid, but too large for THIS reader".
  assert.throws(() => captureResultSet(valid, { limits: { ...limits, maxCapturedNodes: 16 } }), ResultSetTooLargeError);
  // The other branch needs a set above SCHEMA_MAX_NODES (16M+ nodes), which no test may allocate,
  // so the mapping itself is the pure function and both branches are asserted on it directly.
  assert.ok(nodeCeilingError({ maxCapturedNodes: SCHEMA_MAX_NODES }, 'r', [{ path: '/results', code: 'too-many-nodes' }])
    instanceof CorruptResultSetError);
  assert.ok(nodeCeilingError({ maxCapturedNodes: SCHEMA_MAX_NODES - 1 }, 'r', [{ path: '/results', code: 'too-many-nodes' }])
    instanceof ResultSetTooLargeError);
});

// --- review Critical 1: the 64 KiB budget is charged DURING capture, before allocation ----------
test('the unknown-field budget is charged mid-traversal: later values are never copied', async () => {
  const CHUNK = 4 * 1024;                                    // each value is individually legal
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;     // never a literal here
  const overAt = Math.ceil(budget / CHUNK);                  // the index whose copy crosses it
  const raw = structuredClone(await sealedSet());
  // An OPEN type (`ledger`) with an unknown field far below every node/array/string ceiling: this
  // is the review's own scenario — ~100k individually legal 4 KiB strings, ≈ 400 MB if copied.
  raw.ledger.futureData = Array.from({ length: overAt * 50 }, () => 'x'.repeat(CHUNK));

  const err = assert.throws(() => captureResultSet(raw, { limits }), corruptWith('unknown-field-bytes'));
  const hit = err.issues.find((i) => i.code === 'unknown-field-bytes');
  // Charged DURING capture ⇒ the issue names the element that crossed the budget, near the start.
  // Charged AFTER capture ⇒ it would name the whole field, and every string would be in memory.
  const index = Number(hit.path.split('/').pop());
  assert.ok(Number.isInteger(index), `expected an element path, got ${hit.path}`);
  assert.ok(index <= overAt, `refused at element ${index}, expected <= ${overAt}`);
  assert.ok(index < raw.ledger.futureData.length / 2, 'the tail was never reached');
});

test('P0 reports exactly how many values were copied before the budget refusal', async () => {
  // The direct P5↔P0 seam: `captureResultSet` maps the failure to an error and drops the counters,
  // so the ALLOCATION bound itself is asserted on `captureData`'s own `nodes` — which P0 defines as
  // "values actually copied before capture stopped".
  const CHUNK = 4 * 1024;
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;
  const overAt = Math.ceil(budget / CHUNK);
  const raw = structuredClone(await sealedSet());
  raw.ledger.futureData = Array.from({ length: overAt * 50 }, () => 'x'.repeat(CHUNK));

  const r = captureData(raw, {
    maxNodes: limits.maxCapturedNodes, maxDepth: 64, maxIssues: 20,
    openFieldBudget: { isOpenPath, maxBytes: budget },
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === 'unknown-field-bytes'));
  assert.ok(r.openFieldBytes <= budget + CHUNK, 'the counter stopped at the boundary');
  // The whole point: `nodes` is bounded by what fits in the budget plus the set's own fields —
  // NOT by the ~200k-element array. A post-capture check would have copied every one of them.
  assert.ok(r.nodes < overAt * 2 + 1_000,
    `copied ${r.nodes} values; the budget admits about ${overAt}`);
  assert.ok(r.nodes < raw.ledger.futureData.length / 10, 'the tail was never copied');
});

test('unknown fields in open types are budgeted together; a closed type never budgets at all', async () => {
  const budget = limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES;
  // Just under, spread across three open types: accepted, preserved verbatim (§13.6).
  const under = structuredClone(await sealedSet());
  const third = Math.floor(budget / 3) - 64;                 // leave room for the keys themselves
  under.ledger.a = 'x'.repeat(third);
  under.provenance.b = 'y'.repeat(third);
  under.outcome.c = 'z'.repeat(third);
  assert.equal(captureResultSet(under, { limits }).ledger.a.length, third);

  // Just over, same three fields: refused.
  const over = structuredClone(await sealedSet());
  over.ledger.a = 'x'.repeat(budget);
  over.provenance.b = 'y'.repeat(128);
  assert.throws(() => captureResultSet(over, { limits }), corruptWith('unknown-field-bytes'));

  // A CLOSED type's unknown field is not a budget question — it is rejected outright by validation,
  // and capture never charges it against the open-field budget.
  const closed = structuredClone(await sealedSet('positives'));
  closed.results[0].futureField = 'small';
  const captured = captureResultSet(closed, { limits });     // capture itself allows it through
  assert.ok(validateResultSet(captured, { limits }).issues.some((i) => i.code === 'unknown-field-closed-type'));
});

test('native structuredClone is never used on external input', async () => {
  const raw = structuredClone(await sealedSet());
  const real = globalThis.structuredClone;
  let called = 0;
  globalThis.structuredClone = (...a) => { called += 1; return real(...a); };
  try { captureResultSet(raw, { limits }); } finally { globalThis.structuredClone = real; }
  assert.equal(called, 0);
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/validateResultSet.capture.test.mjs` → module not found.
- [ ] **Step 3: Write `captureResultSet` and `applyMigration`.**
```js
// clashtest/results/validateResultSet.js
import { captureData } from '../util/capture.js';
import { isOpenPath, checkShapeAndUnknownFields, UNKNOWN_FIELD_BYTES } from './resultSetSchema.js';
import { RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS, SCHEMA_MAX_NODES } from '../options.js';
import { CorruptResultSetError, ResultSetTooLargeError, UnsupportedSchemaVersionError } from '../errors.js';
import { SCHEMA_VERSION } from './resultSet.js';

export { SCHEMA_VERSION };
const MAX_ISSUES = 20;                                // §13.6: the first 20 {path, code}, never a value
const MAX_DEPTH = 64;                                 // §13.6 — a data-format property, not a §17.1 default
const MAX_STRING_LENGTH = 4096;                       // §13.5.2 field caps: the largest of them
const MAX_KEY_LENGTH = 256;
const NO_MIGRATIONS = new Map();

// JSON-pointer shape → §17.1.1 hard maximum. These are DATA-FORMAT ceilings: never the reading
// engine's configured run options (§13.6: "a valid set produced under a larger configuration must
// not become corrupt under a smaller one"), and never the set's self-reported options.
const ARRAY_CEILINGS = new Map([
  ['/results', RUN_OPTION_CEILINGS.maxResultsPerRun],
  ['/ledger/units', RUN_OPTION_CEILINGS.maxUnitsPerRun],
  ['/ledger/units/#/taints', RUN_OPTION_CEILINGS.maxElementTaintsPerUnit],
  ['/diagnostics/diagnostics', RUN_OPTION_CEILINGS.maxRetainedDiagnostics],
  ['/provenance/models', 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection],   // §13.5's 2x summary ceiling
]);
const DEFAULT_ARRAY_CEILING = RUN_OPTION_CEILINGS.maxLedgerRecords;
const pointerShape = (pointer) => pointer.replace(/\/\d+(?=\/|$)/g, '/#');
const arrayLimitFor = (pointer) => ARRAY_CEILINGS.get(pointerShape(pointer)) ?? DEFAULT_ARRAY_CEILING;

const corrupt = (runId, issues) => new CorruptResultSetError({ runId,
  issues: issues.slice(0, MAX_ISSUES).map(({ path, code }) => ({ path, code })) });   // drop `message`: it may quote a value

function schemaVersionError(value, runId) {
  if (Number.isInteger(value) && value > SCHEMA_VERSION) {
    return new UnsupportedSchemaVersionError({ type: 'ResultSet', schemaVersion: value, supported: SCHEMA_VERSION });
  }
  const code = Number.isInteger(value) && value >= 1 && value < SCHEMA_VERSION
    ? 'migration-failed'                              // a known older version with no registered migration
    : 'invalid-schema-version';                       // absent, non-integer, < 1, or not a number at all
  return corrupt(runId, [{ path: '/schemaVersion', code }]);
}

/** Review Important 1: the RANGE decides admissibility; the table only decides whether an already
 *  admissible older version can actually be converted. Registering a migration under key `0` (or
 *  `1.5`, or `'1'`) must NOT make that version valid. `currentVersion` is injectable for the pure
 *  dispatcher test only — production always uses SCHEMA_VERSION. */
const migratableFrom = (v, migrations, currentVersion = SCHEMA_VERSION) =>
  Number.isInteger(v) && v >= 1 && v < currentVersion && migrations.has(v);

/** Capture-first (§13.6). `runId` is an explicit DIAGNOSTIC parameter: nothing is ever read off
 *  `raw` before the descriptor-based traversal, so no accessor on untrusted input can fire. */
export function captureResultSet(raw, { limits, runId = null, migrations = NO_MIGRATIONS } = {}) {
  const result = captureData(raw, {
    maxNodes: Math.min(limits.maxCapturedNodes, SCHEMA_MAX_NODES),
    maxDepth: MAX_DEPTH,
    maxIssues: MAX_ISSUES,
    maxStringLength: MAX_STRING_LENGTH,
    maxKeyLength: MAX_KEY_LENGTH,
    maxArrayLength: DEFAULT_ARRAY_CEILING,
    arrayLimitFor,
    // §13.6's 64 KiB unknown-field budget, charged DURING the traversal and BEFORE the offending
    // value is copied (review Critical 1). `isOpenPath` is derived from the ONE closed schema
    // table in this module, so "what is unknown" has a single definition (P5.5).
    openFieldBudget: { isOpenPath, maxBytes: limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES },
    // Fixed key order: `schemaVersion` is read FIRST and a value this build cannot handle stops
    // the capture before any other property is reached (P0 rootGate).
    rootGate: { key: 'schemaVersion',
                check: (v) => v === SCHEMA_VERSION || migratableFrom(v, migrations) },
  });
  if (result.ok === true) return result.value;
  if (result.gate !== undefined) throw schemaVersionError(result.gate.value, runId);
  if (result.issues.some((i) => i.code === 'too-many-nodes')) throw nodeCeilingError(limits, runId, result.issues);
  throw corrupt(runId, result.issues);                 // incl. `unknown-field-bytes` (§13.6)
}

/** ONE ceiling, two meanings (P0 design note 2). At or above `SCHEMA_MAX_NODES` the DATA is out of
 *  format — no conforming writer can produce it — so it is corrupt; below it only this reader is
 *  too small, which §13.6 requires to be "valid, not corrupt". Pure, so both branches are testable
 *  without allocating a 16-million-node object. */
export function nodeCeilingError(limits, runId, issues) {
  return limits.maxCapturedNodes < SCHEMA_MAX_NODES
    ? new ResultSetTooLargeError({ runId })
    : corrupt(runId, issues);
}

/** Single-hop migration dispatch (§13.6, registered per `(type, fromVersion)`). One lookup; the
 *  entry must return a set already at SCHEMA_VERSION. A missing, throwing or non-conforming
 *  migration is `migration-failed`. The real table is empty while SCHEMA_VERSION === 1. */
export function applyMigration(captured, migrations, { runId }) {
  const migrate = migrations.get(captured.schemaVersion);
  const failed = () => corrupt(runId, [{ path: '/schemaVersion', code: 'migration-failed' }]);
  if (typeof migrate !== 'function') throw failed();
  let migrated;
  try { migrated = migrate(captured); } catch { throw failed(); }   // the thrown value never escapes
  if (migrated === null || typeof migrated !== 'object' || migrated.schemaVersion !== SCHEMA_VERSION) throw failed();
  return migrated;
}
```
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/validateResultSet.capture.test.mjs` → 13 passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): capture-first detached Result Set reads (P5.4)`

---

### Task P5.5: `validateResultSet` — unknown fields, cross-field invariants, order, digests

**Files**
- Modify: `clashtest/results/validateResultSet.js`
- Test: `test/clashtest/results/validateResultSet.invariants.test.mjs`

**Interfaces**

*Consumes* (**RECONCILED**):
- `definition/validate.js` (P2): `validateTest(definition, {limits}) → {issues, issuesTruncated}` — the **pure** validator, run on the already-captured embedded definition. P5 never calls P2's `captureAndValidate` (that is the entry point for a *caller-supplied* definition, and this one is already inside a captured copy; row N29).
- `identity/ids.js` (P1): `makeResultId`, `comparePairIds`, `elementRefKey`.
- `resultSet.js` (P5.3): `pairSetDigestInput`, `ledgerDigestInput`, `SCHEMA_VERSION`.
- `util/canonical.js` (P0): `digestCanonical`, `canonicalJson` (the unknown-field byte count is over canonical JSON, exactly as §14.5 counts annotation bytes).
- `util/capture.js` (P0): `deepFreezeSliced(value, slicer)` — **P0's**, not a P5 export (N4).
- `util/slicer.js` (P0): the slicer's yield point is **`tick(label?)`**, never `step()` (N6).

*Produces:* `validateResultSetSteps`, `validateResultSet`, `readResultSet`, `validateResultSetSummary`.

### The closed structural schema (review Critical 3)

The earlier draft delegated `checkShapeAndUnknownFields` to an unwritten helper and its rule table covered mainly unknown fields and cross-field relationships. That is not enough for untrusted input: `sealed: false`, `outcome.status: 42`, a negative `dbId`, duplicate `provenance.models` rows and `ledger.units: null` all had **no rule and no issue code**, so different implementers would accept different stored formats and malformed values would reach digest, status and claim code that assumes valid arrays and objects.

So P5 pins a **closed structural schema** — every durable type, every field — as a declarative table, and the validator is a generic walk over it. The table is the single source for three consumers that would otherwise drift apart: the validator, the capture-time `isOpenPath`, and the negative tests.

**Issue codes.** One per violation class, so a code identifies *what kind* of thing is wrong without quoting a value: `missing-field` · `null-not-allowed` · `type-invalid` (wrong primitive type) · `container-invalid` (array where an object is declared, or the reverse) · `enum-invalid` · `number-out-of-range` (non-safe-integer where an integer is declared, or outside the declared bounds; a **non-finite** number is `type-invalid`, not this) · `string-too-long` (over the field's own cap) · `array-too-long` (over the field's §17.1.1 ceiling) · `array-length-invalid` (a fixed-length array, e.g. a 3-vector) · `duplicate-key` (with the specific spellings `duplicate-result-id`, `duplicate-unit-id`, `duplicate-model-key`, `duplicate-root-dbid`) · `literal-invalid`, specialised to **`not-sealed`** for `sealed !== true` · `digest-syntax-invalid` · `unknown-field-closed-type` · `root-cls-invalid` (kept as its own code: R2 makes it a schema decision with its own history) · `unknown-field-bytes` (defensive re-check only — capture owns it).

**The types, in one table.** Each row is *field → declaration*; `†` marks a type §13.6 declares **open** (unknown fields preserved, budgeted, excluded from digests), every other type is **closed** (an unknown field is `unknown-field-closed-type`).

| Type | Fields (declaration) |
|---|---|
| `ResultSet` † | `schemaVersion` = literal `SCHEMA_VERSION` · `runId` string(id) · `testRef` `TestRef` · `definition` `Definition`\|null, **delegated** · `derivedFromRunId` string(id)\|null · `outcome` `RunOutcome` · `provenance` `Provenance` · `ledger` `Ledger` · `results` `ClashResult[]` ≤ `RUN_OPTION_CEILINGS.maxResultsPerRun`, unique by `resultId` · `diagnostics` `Diagnostics` · `statistics` free-form object · `digests` `Digests` · `sealed` = literal `true` (`not-sealed`) |
| `TestRef` | `testId` string(id) · `revision` int ≥ 1 \| null · `semanticDigest` digest \| null |
| `RunOutcome` † | `status` enum(`completed`,`failed`,`cancelled`,`invalidated`) · `coverage` enum(`full`,`partial`) · `integrity` enum(`clean`,`caveated`) · `freshness` enum(`current`,`stale`,`unverifiable`) · `environmentSensitive` bool · `environmentSensitiveCauses` enum(`ENVIRONMENT_CAUSES`)[] unique · `reasons` string(reason)[] |
| `Provenance` † | `registrySessionId` string(id) · `libraryVersion` string(libraryVersion)\|null · `broadPhase` enum(`tlas`,`linear`) · `determinismClass` enum(`deterministic`,`time-sensitive`) · `runOptions` free-form object · `models` `ProvenanceModel[]` ≤ `2 × ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection`, **unique by `modelKey`** · `scopeProof` `ScopeProof` · `admissionBaseline` `AdmissionBaseline[]` unique by `modelKey` · `hierarchyInternalAcceptance` `Acceptance`\|null · `libraryExclusions` string(reason)[] unique · `placementVerified` = literal `false` · `environment` `Environment` (optional) · `startedAt`/`finishedAt` string(timestamp) |
| `ProvenanceModel` | `modelKey` string(modelKey) · `modelVersion` string(modelVersion) · `scopeKinds` enum(`model`,`elements`)[] unique · `elementCount` int ≥ 0 · `scopeDigests` `ScopeDigests` · `bindingGeneration`/`placementGeneration` int ≥ 0 |
| `ScopeDigests` | `population` `{count: int ≥ 0, digest}`\|null · `roots` `{dbId, subtreeDigest: digest}[]` unique by `dbId` |
| `ScopeProof` | `method` = literal `'bracketed-digest'` · `digestVersion` = literal `DIGEST_VERSION` |
| `AdmissionBaseline` | `modelKey` string(modelKey) · `epochInstanceCount` int ≥ 0 |
| `Acceptance` | `recordRef` string(id) |
| `Environment` | `viewerVersion`/`userAgent` string(environmentField), both optional |
| `Ledger` † | `planExists` bool · `pairSpaceTotal` int ≥ 0 · `emptyOperand` bool · `units` `UnitRecord[]` ≤ `RUN_OPTION_CEILINGS.maxUnitsPerRun`, unique by `unitId` · `rootOwners` `RootOwners[]` unique by `modelKey` · `unresolvedSelections` `UnresolvedSelection[]` · `unreachablePopulation` `UnreachablePopulation[]` unique by `modelKey` · `hierarchyInternal` `HierarchyInternal[]` unique by `modelKey` · `planningGaps` `PlanningGap[]` · `exclusions` string(reason)[] unique · `warnings` `Warning[]` · `budgetExhausted` bool · `firstRefusalUnitId` string(id)\|null |
| `UnitRecord` | `unitId` string(id) · `kind` enum(`leaf`,`split`) · `parentUnitId` string(id)\|null · `sourceModelKey` string(modelKey) · `sourceRootDbIds` dbId[] unique · `targets` `UnitTarget[]` unique by `modelKey` · `outcome` enum(`evaluated`,`failed`,`skipped`,`discarded`,`not-run`,`split`) · `cause` string(reason)\|null · `secondaryCauses` string(reason)[] unique · `capacityKind` string(reason)\|null · `capDetail` enum(`ledger-records`,`unit-records`)\|null · `scopeProof` enum(`equal`,`drift`,`unverifiable`,`not-checked`) · `pairSpaceWeight` int ≥ 0 · `taints` `Taint[]` ≤ `RUN_OPTION_CEILINGS.maxElementTaintsPerUnit` · `attempts` int ≥ 0 · `durationMs` int ≥ 0 |
| `UnitTarget` | `modelKey` string(modelKey) · `scope` enum(`model`,`roots`) · `rootDbIds` dbId[] unique (optional) |
| `Taint` | `kind` enum(`element`,`target-model`,`unit`) · `modelKey` string(modelKey)\|null · `dbId` dbId\|null · `reason` string(reason) · `occurrences` int ≥ 1 |
| `RootOwners` | `modelKey` string(modelKey) · `owners` `RootOwnerRow[]` **unique by `rootDbId`** |
| `RootOwnerRow` | `rootDbId` dbId · `ownerDbIds` dbId[] unique · `cls` enum(`A`,`B`,`C`) → **`root-cls-invalid`** |
| `UnresolvedSelection` | `selectionRole` enum(`A`,`B`) · `modelKey` string(modelKey)\|null · `cause` string(reason) · `dbIds` dbId[] unique |
| `UnreachablePopulation` | `modelKey` string(modelKey) · `ownerDbIds` dbId[] unique · `mixedOwnerDbIds` dbId[] unique · `unattributable` `{notLoaded: int ≥ 0, ownerUnresolvable: int ≥ 0}` |
| `HierarchyInternal` | `modelKey` string(modelKey) · `rootCount`/`ownerCount` int ≥ 0 · `examples` `{rootDbId, ownerDbIds: dbId[]}[]` ≤ `HIERARCHY_EXAMPLES_CAP` |
| `PlanningGap` | `phase` string(reason) · `cause` string(reason) |
| `Warning` | `code` string(reason) · `modelKey` string(modelKey) (optional) |
| `ClashResult` | `resultId` string(id) · `pair` `PairId` · `mode` enum(`CLASH_MODES`, imported from P1) · `evaluatedAs` `{source: ElementRef, target: ElementRef}` · `evidence` per-mode (below) · `flags` `Flags` · `unitId` string(id) |
| `PairId` | `first`/`second` `ElementRef` |
| `ElementRef` | `modelKey` string(modelKey) · `dbId` dbId |
| `Flags` | `witnessUnavailable` · `unreachableOwner` · `mixedOwnerProvenance` · `duplicateEvidenceConflict` — each `true`-only literal, all optional, **closed** (this is the row that catches errata E1's `type`) |
| `VolumeEvidence` | `witness` `{kind: string(reason), point: number[3]}`\|null |
| `ClearanceEvidence` | `distance`/`clearance` finite number · `closestPoints` `{first: number[3], second: number[3]}` |
| `EmptyEvidence` | *(no fields — any key is `unknown-field-closed-type`)* |
| `Diagnostics` † | `diagnostics` `NormalizedDiagnostic[]` ≤ `RUN_OPTION_CEILINGS.maxRetainedDiagnostics` · `countsByReason` count-map ≤ `RUN_OPTION_CEILINGS.maxDistinctReasons` keys, each value int ≥ 0 · `total`, `completenessAffectingCount`, `omittedReasonOccurrences`, `unclassifiedOccurrences`, `completenessAffectingUpperBound`, `geometryReadinessOccurrences` int ≥ 0 · `truncated` bool |
| `NormalizedDiagnostic` | §12.2: `scope` enum(`fragment`,`pair`) · `reason` string(reason) · `completenessAffecting` bool · `attribution` enum(`element`,`target-model`,`unit`) · `fragment` `DiagFragment` (optional) · `fragments` `{first: DiagFragment, second: DiagFragment}` (optional) · `ambiguousModelId` bool (optional) · `occurrences` int ≥ 1 · `unitIds` string(id)[] ≤ `RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic` unique |
| `DiagFragment` | `modelKey` string(modelKey)\|null · `dbId` dbId\|null · `fragId` int ≥ 0 · `role` enum(`source`,`target`) (optional) |
| `Digests` | `digestVersion` int ≥ 1 (**not** pinned to `DIGEST_VERSION` — §13.6 makes an unknown version *valid but unverifiable*; the **claim predicate** refuses it, see Critical 2) · `pairSetDigest`/`ledgerDigest` digest |

Three deliberate non-rows, each with its reason:

1. **`definition`** is `delegated` — P2's `validateTest` is the schema of record for a `ClashTestDefinition` (`definition-invalid`), and re-declaring it here would create exactly the second copy of a closed schema that §13.6's "closed at every nesting level" rule exists to keep singular.
2. **`statistics`, `provenance.runOptions` and `diagnostics.countsByReason`** are *documented* fields with undocumented (or open-ended) contents: §12.6 calls `statistics` "aggregated, informational". They are checked as plain objects (`countsByReason` additionally as a bounded count-map) and their contents are bounded by the capture node ceiling — **not** by the unknown-field budget, because they are documented fields, not unknown ones. `isOpenPath` returns `false` inside them, which is what makes that statement true rather than merely intended.
3. **Digest strings** are `/^sha256:[0-9a-f]{64}$/` (§5.4's format), not merely "a string" — the syntax check is what stops a malformed digest reaching `checkDigests` and being reported as a content mismatch.

**Where the numbers come from.** Array ceilings are read from P0's `RUN_OPTION_CEILINGS` / `ENGINE_LIMIT_CEILINGS` (§17.1.1) and **never** from the reading engine's configured run options (§13.6: "a valid set produced under a larger configuration must not become corrupt under a smaller one"). The **per-field string caps** are a P5-owned, spec-derived table by P0's own ruling ("there is no schema-wide string-length ceiling in the spec; a per-path `stringLimitFor` is P5's own table" — P0 *Not exported from `options.js`*), so `STRING_CAPS` lives in `resultSetSchema.js` beside the fields it caps, sourced from §13.5.2: `modelKey`/`modelVersion` 1,024, `libraryVersion` 256, `environmentField` 512, plus P5's own `id`/`reason`/`timestamp`/`default` caps. Like `MAX_DEPTH = 64` and `MAX_ISSUES = 20`, these are **data-format** constants, not G-CAL-gated §17.1 defaults, which is why they are not in `options.js`. `HIERARCHY_EXAMPLES_CAP = 20` is the same kind of constant (§13.1's bounded `examples`).

**Validation rule table** (each row is one `{path, code}` issue; the first 20 are reported, never a value). The **structural** phase above runs **first and in full**; the rows below are the cross-field, linkage, order and digest phases that may then assume a well-shaped set:

| Phase | Rule | `code` |
|---|---|---|
| **structural** | every row of the closed structural schema above (presence, nullability, primitive type, enum, numeric bounds/safe-integer, uniqueness, per-field string cap, array ceiling/fixed length, array-vs-object, literal, digest syntax) | `missing-field`, `null-not-allowed`, `type-invalid`, `container-invalid`, `enum-invalid`, `number-out-of-range`, `string-too-long`, `array-too-long`, `array-length-invalid`, `duplicate-*`, `literal-invalid`, `not-sealed`, `digest-syntax-invalid`, `root-cls-invalid` |
| open/closed | unknown field in `ResultSet` top level / `ledger` / `provenance` / `outcome` / `diagnostics` is preserved verbatim and excluded from digests | — (accepted) |
| open/closed | the unknown fields of those open types total **> the §13.6 budget** of canonical JSON — **a defensive re-check only.** Capture charges this budget mid-traversal and refuses before the offending value is copied (P5.4); a set that reaches the validator over budget therefore means *capture did not run* or has a bug, and the code is raised so that fact is visible rather than silent | `unknown-field-bytes` |
| open/closed | unknown field in `definition`, `ClashResult`, `ResultId`, `PairId`, `ElementRef`, or any other closed type of the schema table | `unknown-field-closed-type` |
| open/closed | embedded `definition` fails `validateTest` | `definition-invalid` |
| open/closed | a `ledger.rootOwners[].owners[]` row whose `cls` is absent or not `'A'` / `'B'` / `'C'` (R2 — the marker is schema, and a writer that omits it produces a set no reader accepts) | `root-cls-invalid` |
| cross-field | `definition === null ⇎ testRef.semanticDigest === null` | `definition-digest-mismatch` |
| cross-field | `coverage: 'full'` with no plan, a planning gap, **no leaf unit at all**, or a leaf that is not `evaluated` / not `scopeProof: 'equal'` — verbatim the predicate `deriveRunOutcome` applies (R21-2) | `coverage-not-full` |
| cross-field | `status: 'completed'` carrying a fatal cause (`world-disposed`, `internal-error`, `result-cap`), any planning gap, an input-change cause (`input-changed`, `scope-drift`) or `cancel-requested` | `completed-with-fatal-cause` |
| cross-field | `status: 'completed'` with a **non-fatal** unit gap (`capacity-exceeded`, `extraction-limit`, `object-tree-unavailable`, `stale-placement`, `unit-cap`, `target-too-large`, `model-evicted`, `skipped:*`, `discarded:scope-unverifiable`) and `coverage: 'partial'` | — (accepted) |
| cross-field | `emptyOperand: true` with `pairSpaceTotal > 0`, or `pairSpaceTotal ≠ Σ leaf pairSpaceWeight` | `pair-space-inconsistent` |
| cross-field | a result owner in neither `rootOwners` nor (with `flags.unreachableOwner`) that model's `unreachablePopulation.ownerDbIds` | `owner-not-in-ledger` |
| cross-field | `flags.unreachableOwner` on a pair whose owners are both root owners | `unreachable-flag-invalid` |
| cross-field | `resultId ≠ makeResultId(testRef.testId, testRef.semanticDigest, pair)` | `result-id-mismatch` |
| linkage (R21-4) | `unitId` names no unit, a `split` parent, or a non-`evaluated` / non-`equal` unit | `result-unit-invalid` |
| linkage (R21-4) | the unit's source/target ranges do not cover the result's root pair | `result-unit-coverage` |
| linkage (R21-4) | `evaluatedAs.source.modelKey ≠ unit.sourceModelKey`, or `evaluatedAs` names refs other than the result's two | `evaluated-as-mismatch` |
| linkage (R21-4) | `result.mode ≠ definition.mode`, or the evidence shape does not match `mode` | `mode-mismatch` |
| linkage | `provenance.models` misses a `modelKey` the results or ledger mention | `model-not-in-provenance` |
| order | `results` not strictly ascending by `PairId`, or a duplicate `resultId` | `result-order` / `duplicate-result-id` |
| digests | recomputed `pairSetDigest`/`ledgerDigest` ≠ recorded | `digest-mismatch` |
| digests | unknown `digests.digestVersion` | — (not compared; set is `unverifiable` for comparison, never `current`-claimable) |

- [ ] **Step 1: Write the failing invariant test.**
```js
// test/clashtest/results/validateResultSet.invariants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResultSet, readResultSet } from '../../../clashtest/results/validateResultSet.js';
import { SCHEMA_ROWS, UNKNOWN_FIELD_BYTES } from '../../../clashtest/results/resultSetSchema.js';
import { schemaMutations } from '../../support/schemaMutations.mjs';
import { canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { CorruptResultSetError, ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { sealedSet, fakeSlicer, resealed } from '../../support/resultSetFixtures.mjs';

const limits = ENGINE_LIMIT_DEFAULTS;

test('an engine-produced set validates unchanged', async () => {
  assert.deepEqual(validateResultSet(await sealedSet('completed-with-gaps'), { limits }), { ok: true, issues: [] });
});

// --- review Critical 3: EVERY structural-schema row gets a negative test, generated from the
// --- table itself, so a new field cannot be added without its negative test appearing. ---------
test('every reachable structural-schema row rejects its own violation', async () => {
  for (const kind of ['positives', 'schema-corpus']) {
    const valid = structuredClone(await sealedSet(kind));
    assert.equal(validateResultSet(valid, { limits }).ok, true, `${kind} must start valid`);

    const mutations = [...schemaMutations(valid)];
    assert.ok(mutations.length > 0);
    for (const { path, code, apply } of mutations) {
      const broken = apply(structuredClone(valid));
      const { ok, issues } = validateResultSet(broken, { limits });
      assert.equal(ok, false, `${kind} ${path} → ${code} must be rejected`);
      assert.ok(issues.some((i) => i.code === code),
        `${kind} ${path}: expected ${code}, got ${JSON.stringify(issues)}`);
      assert.ok(issues.every((i) => Object.keys(i).sort().join() === 'code,path'), 'no values in issues');
      assert.ok(issues.length <= 20);
    }
  }
});

// The anti-drift assertion: a declared field that no fixture reaches is a field no negative test
// covers, so it must be named here deliberately rather than discovered later by an attacker.
// `schema-corpus` exists solely to carry every OPTIONAL branch (see the fixture table in P5.9).
test('every declared schema field is reachable in the fixture corpus, or explicitly waived', async () => {
  const corpus = await Promise.all(['positives', 'schema-corpus'].map((k) => sealedSet(k)));
  for (const set of corpus) {
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, 'the corpus must be valid');
  }
  const reached = new Set(corpus.flatMap((s) => [...schemaMutations(s)].map((m) => `${m.type}.${m.field}`)));
  // Waived, each with a reason: `definition` is delegated to P2's `validateTest`; the other four
  // are documented fields with no declared inner shape, so there is no row to violate.
  const WAIVED = new Set(['ResultSet.definition', 'ResultSet.statistics', 'Provenance.runOptions',
    'Diagnostics.countsByReason', 'ClashResult.evidence']);
  const missing = SCHEMA_ROWS
    .map((r) => `${r.type}.${r.field}`)
    .filter((k) => !reached.has(k) && !WAIVED.has(k));
  assert.deepEqual(missing, [], `unreachable schema rows: ${missing.join(', ')}`);
});

// The five examples the review named, asserted by hand as a readability anchor on the generator.
test('the named malformed-value examples each get their own code', async () => {
  const CASES = [
    ['not-sealed',          (s) => { s.sealed = false; }],
    ['type-invalid',        (s) => { s.outcome.status = 42; }],
    ['number-out-of-range', (s) => { s.results[0].pair.first.dbId = -1; }],
    ['duplicate-model-key', (s) => { s.provenance.models.push({ ...s.provenance.models[0] }); }],
    ['null-not-allowed',    (s) => { s.ledger.units = null; }],
    ['container-invalid',   (s) => { s.ledger.units = { 0: s.ledger.units[0] }; }],
    ['missing-field',       (s) => { delete s.outcome.coverage; }],
    ['enum-invalid',        (s) => { s.ledger.units[0].scopeProof = 'maybe'; }],
    ['digest-syntax-invalid', (s) => { s.digests.pairSetDigest = 'sha256:nope'; }],
    ['array-length-invalid', (s) => { s.results[0].evidence.witness.point = [0, 1]; }],
    ['string-too-long',     (s) => { s.provenance.models[0].modelKey = 'm'.repeat(2048); }],
    ['literal-invalid',     (s) => { s.provenance.placementVerified = true; }],
  ];
  for (const [code, mutate] of CASES) {
    const set = structuredClone(await sealedSet('positives'));
    mutate(set);
    assert.ok(validateResultSet(set, { limits }).issues.some((i) => i.code === code),
      `${code}: ${JSON.stringify(validateResultSet(set, { limits }).issues)}`);
  }
});

// Review question 1: the validator is not the untrusted boundary, and says so loudly.
test('validateResultSet refuses an uncaptured object instead of traversing it', async () => {
  const captured = structuredClone(await sealedSet('positives'));
  let invoked = 0;
  const hostile = { ...captured };
  Object.defineProperty(hostile, 'ledger', { get() { invoked += 1; return {}; }, enumerable: true, configurable: true });
  assert.throws(() => validateResultSet(hostile, { limits }),
    (e) => e instanceof TypeError && e.code === 'ERR_UNCAPTURED_INPUT');
  assert.equal(invoked, 0, 'the getter was never invoked');
  for (const bad of [null, undefined, [], 'set', Object.create({ ledger: {} })]) {
    assert.throws(() => validateResultSet(bad, { limits }),
      (e) => e instanceof TypeError && e.code === 'ERR_UNCAPTURED_INPUT', String(bad));
  }
  assert.equal(validateResultSet(captured, { limits }).ok, true);   // a captured copy passes
});

const CORRUPTIONS = [
  ['coverage-not-full',        (s) => { s.outcome.coverage = 'full'; }],
  ['completed-with-fatal-cause', (s) => { s.ledger.units[0].cause = 'internal-error'; }],
  ['definition-digest-mismatch', (s) => { s.definition = null; }],
  ['owner-not-in-ledger',      (s) => { s.results[0].pair.second.dbId = 424242; }],
  ['result-order',             (s) => { s.results.reverse(); }],
  ['duplicate-result-id',      (s) => { s.results.push({ ...s.results[0] }); }],
  ['result-unit-invalid',      (s) => { s.results[0].unitId = 'no-such-unit'; }],
  ['evaluated-as-mismatch',    (s) => { s.results[0].evaluatedAs = { source: s.results[0].pair.second, target: s.results[0].pair.first }; }],
  ['mode-mismatch',            (s) => { s.results[0].mode = 'containment'; }],
  ['unknown-field-closed-type', (s) => { s.results[0].type = 'volume-overlap'; }],   // errata E1: `type` is unknown
  ['unreachable-flag-invalid', (s) => { s.results[0].flags = { unreachableOwner: true }; }],
  ['definition-invalid',      (s) => { s.definition.selections.A.entries = []; }],          // fails P2 validateTest
  ['result-id-mismatch',      (s) => { s.results[0].resultId = `${s.results[0].resultId}x`; }],
  // --- rows the earlier draft claimed but never exercised (review Important 4) ------------------
  ['pair-space-inconsistent', (s) => { s.ledger.emptyOperand = true; }],                  // emptyOperand with pairSpaceTotal > 0
  ['pair-space-inconsistent', (s) => { s.ledger.pairSpaceTotal += 1; }],                  // ≠ Σ leaf pairSpaceWeight
  ['result-unit-coverage',    (s) => { s.ledger.units[0].sourceRootDbIds = [999]; }],     // unit no longer covers its own result
  ['result-unit-coverage',    (s) => { s.ledger.units[0].targets = [{ modelKey: 'MB', scope: 'roots', rootDbIds: [4242] }]; }],
  ['model-not-in-provenance', (s) => { s.provenance.models = s.provenance.models.filter((m) => m.modelKey !== 'MB'); }],
  ['coverage-not-full',       (s) => { s.outcome.coverage = 'full'; s.ledger.units = s.ledger.units.filter((u) => u.kind === 'split'); }],
  ['root-cls-invalid',        (s) => { delete s.ledger.rootOwners[0].owners[0].cls; }],
  ['root-cls-invalid',        (s) => { s.ledger.rootOwners[0].owners[0].cls = 'X'; }],
  // the DEFENSIVE re-check (capture owns the real enforcement — P5.4); no literal budget here
  ['unknown-field-bytes',     (s) => { s.ledger.futureField = 'x'.repeat((limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES) + 1); }],
];

test('each corruption is rejected with its own code, even when digests are recomputed consistently', async () => {
  for (const [code, mutate] of CORRUPTIONS) {
    const set = await resealed(mutate, 'positives');          // re-digested so digests agree
    const { ok, issues } = validateResultSet(set, { limits });
    assert.equal(ok, false, code);
    assert.ok(issues.some((i) => i.code === code), `${code}: got ${JSON.stringify(issues)}`);
    assert.ok(issues.every((i) => !('value' in i)), 'no values in issues');
    assert.ok(issues.length <= 20);
  }
});

test('a tampered digest is caught', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.results[0].flags = { witnessUnavailable: true };
  assert.ok(validateResultSet(set, { limits }).issues.some((i) => i.code === 'digest-mismatch'));
});

test('an unknown digestVersion is NOT compared and never reported as a mismatch', async () => {
  // §13.6: "a digestVersion the engine does not know is not compared and the set is treated as
  // unverifiable for comparison, never current-claimable" — it is not a corruption finding.
  const set = structuredClone(await sealedSet('positives'));
  set.digests = { ...set.digests, digestVersion: 99, pairSetDigest: 'sha256:' + '0'.repeat(64) };
  const { ok, issues } = validateResultSet(set, { limits });
  assert.equal(ok, true, 'valid-but-unverifiable is NOT a corruption finding');
  assert.deepEqual(issues, []);
  // The refusal is the CLAIM PREDICATE's, not the validator's (review Critical 2). The conjunct
  // itself is proven on an empty-results claimable set in `claim.test.mjs`; asserting it here on
  // `positives` would prove nothing, because its non-empty results already block the claim.
  const clean = structuredClone(await sealedSet('completed-clean'));
  assert.deepEqual(clean.results, []);
  assert.equal(canClaimNoClashes(clean, 'current'), true);
  clean.digests = { ...clean.digests, digestVersion: 99 };
  assert.equal(canClaimNoClashes(clean, 'current'), false, 'an unverifiable digest is never claimable');
  assert.equal(validateResultSet(clean, { limits }).ok, true, 'and still not corrupt');
});

test('the defensive unknown-field re-check is charged over ALL open types together, not per field', async () => {
  // Enforcement lives in CAPTURE (P5.4, review Critical 1). This asserts only that the validator's
  // backstop sums the same way — one budget across every open type, never one budget per field.
  const third = Math.floor((limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES) / 3) - 64;
  const under = await resealed((s) => {
    s.ledger.a = 'x'.repeat(third); s.provenance.b = 'y'.repeat(third);
  }, 'positives');
  assert.equal(validateResultSet(under, { limits }).ok, true);
  const over = await resealed((s) => {
    s.ledger.a = 'x'.repeat(third); s.provenance.b = 'y'.repeat(third); s.outcome.c = 'z'.repeat(third + 256);
  }, 'positives');
  assert.ok(validateResultSet(over, { limits }).issues.some((i) => i.code === 'unknown-field-bytes'));
});

test('completed-with-gaps keeps its non-fatal causes and reasons on read-back', async () => {
  const GAPS = [['failed', 'capacity-exceeded'], ['failed', 'extraction-limit'], ['failed', 'object-tree-unavailable'],
    ['failed', 'stale-placement'], ['failed', 'unit-cap'], ['not-run', 'target-too-large'],
    ['failed', 'model-evicted'], ['skipped', 'model-evicted'], ['discarded', 'scope-unverifiable']];
  for (const [outcome, cause] of GAPS) {
    const set = await resealed((s) => { s.ledger.units[1] = { ...s.ledger.units[1], outcome, cause, scopeProof: 'not-checked' }; s.outcome.coverage = 'partial'; }, 'completed-with-gaps');
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] }, `${outcome}:${cause}`);
  }
});

test('unreachableOwner positives stay valid on readback', async () => {
  const set = await sealedSet('unreachable-positive');
  assert.equal(validateResultSet(set, { limits }).ok, true);
  const broken = await resealed((s) => { s.ledger.unreachablePopulation[0].ownerDbIds = []; }, 'unreachable-positive');
  assert.ok(validateResultSet(broken, { limits }).issues.some((i) => i.code === 'owner-not-in-ledger'));
});

test('an open-type unknown field survives verbatim with equal digests', async () => {
  const set = await resealed((s) => { s.ledger.futureField = { a: 1 }; s.vendorNote = 'ok'; }, 'positives');
  assert.equal(validateResultSet(set, { limits }).ok, true);
  const read = await readResultSet(structuredClone(set), { limits, slicer: fakeSlicer() });
  assert.deepEqual(read.ledger.futureField, { a: 1 });
  assert.equal(read.vendorNote, 'ok');
  assert.equal(read.digests.ledgerDigest, set.digests.ledgerDigest);
});

test('readResultSet rejects (never throws synchronously) and freezes what it returns', async () => {
  const bad = structuredClone(await sealedSet('positives'));
  bad.results.reverse();
  const p = readResultSet(bad, { limits, slicer: fakeSlicer() });
  assert.ok(p instanceof Promise);
  await assert.rejects(p, CorruptResultSetError);
  const big = structuredClone(await sealedSet('many-results'));
  await assert.rejects(readResultSet(big, { limits: { ...limits, maxCapturedNodes: 16 }, slicer: fakeSlicer() }), ResultSetTooLargeError);
  const good = await readResultSet(structuredClone(await sealedSet('positives')), { limits, slicer: fakeSlicer() });
  assert.equal(Object.isFrozen(good.results[0]), true);
});

test('a forged but self-consistent set is accepted (documented limit)', async () => {
  const forged = await resealed((s) => { s.provenance.libraryVersion = 'forged'; }, 'positives');
  assert.equal(validateResultSet(forged, { limits }).ok, true);
});
```
The generator that makes the first of those tests table-driven rather than hand-written:
```js
// test/clashtest/support/schemaMutations.mjs
import { TYPES, STRING_CAPS, EVIDENCE_BY_MODE } from '../../../clashtest/results/resultSetSchema.js';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const specOf = (of) => (typeof of === 'string' ? { kind: 'object', of } : of);
const at = (root, path) => path.split('/').slice(1).reduce((o, k) => o?.[k], root);
const setAt = (root, path, value) => {
  const keys = path.split('/').slice(1);
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], root);
  parent[keys[keys.length - 1]] = value;
  return root;
};
const deleteAt = (root, path) => {
  const keys = path.split('/').slice(1);
  const parent = keys.slice(0, -1).reduce((o, k) => o[k], root);
  delete parent[keys[keys.length - 1]];
  return root;
};
const put = (path, value) => (clone) => setAt(clone, path, value);

/** One violation per class, per DECLARED field, at every place that field actually occurs in
 *  `set`. Because it reads the production `TYPES` table, a new schema row automatically produces
 *  new mutations — the two cannot drift. */
export function* schemaMutations(set) {
  yield* walk(set, 'ResultSet', '');
}

function* walk(value, typeName, path) {
  const type = TYPES.get(typeName);
  for (const [name, spec] of Object.entries(type.fields)) {
    const at2 = `${path}/${name}`;
    if (!(name in value)) continue;                       // not reachable in this fixture
    if (spec.delegated === true) continue;
    if (spec.free === true) {
      // `evidence` is declared free because its shape is PER-MODE and the schema's `custom` hook
      // checks it. The generator must descend with that same per-mode type, or every evidence row
      // would look unreachable and the anti-drift test would waive real coverage.
      if (type.custom === 'evidenceByMode' && name === 'evidence'
          && EVIDENCE_BY_MODE[value.mode] !== undefined) {
        yield* walk(value[name], EVIDENCE_BY_MODE[value.mode], at2);
      }
      continue;
    }
    yield* mutationsFor(typeName, name, spec, at2, value[name]);
    yield* descend(value[name], spec, at2);
  }
}

function* descend(value, spec, path) {
  if (spec.kind === 'object' && isPlain(value) && spec.free !== true) yield* walk(value, spec.of, path);
  if (spec.kind === 'array' && Array.isArray(value)) {
    const item = specOf(spec.of);
    for (let i = 0; i < value.length; i += 1) yield* descend(value[i], item, `${path}/${i}`);
  }
}

function* mutationsFor(type, field, spec, path, value) {
  const row = (code, apply) => ({ type, field, path, code, apply });
  if (spec.optional !== true) yield row(spec.missingCode ?? 'missing-field', (c) => deleteAt(c, path));
  if (spec.nullable !== true) yield row('null-not-allowed', put(path, null));
  switch (spec.kind) {
    case 'literal':
      yield row(spec.code ?? 'literal-invalid', put(path, typeof spec.value === 'boolean' ? !spec.value : '~'));
      break;
    case 'boolean':
      yield row('type-invalid', put(path, 'true'));
      break;
    case 'number':
      yield row('type-invalid', put(path, String(value ?? 1)));
      yield row('type-invalid', put(path, Number.NaN));      // non-finite is a TYPE failure, not a bound one
      if (spec.integer === true) {
        yield row('number-out-of-range', put(path, 1.5));
        yield row('number-out-of-range', put(path, (spec.min ?? 0) - 1));
        yield row('number-out-of-range', put(path, Number.MAX_SAFE_INTEGER + 2));
      }
      break;
    case 'string':
      yield row('type-invalid', put(path, 42));
      if (spec.values !== undefined) yield row(spec.code ?? 'enum-invalid', put(path, '~no-such-value~'));
      else if (spec.pattern !== undefined) yield row(spec.code ?? 'digest-syntax-invalid', put(path, 'sha256:nope'));
      else yield row('string-too-long', put(path, 'x'.repeat(STRING_CAPS[spec.cap] + 1)));
      break;
    case 'object':
      yield row('container-invalid', put(path, []));
      break;
    case 'array':
      yield row('container-invalid', put(path, {}));
      if (spec.exact !== undefined) yield row('array-length-invalid', put(path, Array(spec.exact + 1).fill(0)));
      else if (spec.max !== undefined && spec.max < 5_000) {
        // Only for ceilings small enough to materialise; the large ones are covered by the
        // `arrayLimitFor` capture test instead (see P5.4), which refuses before allocation.
        yield row('array-too-long', put(path, Array.from({ length: spec.max + 1 }, () => value?.[0] ?? 0)));
      }
      if ((spec.uniqueBy !== undefined || spec.unique === true) && Array.isArray(value) && value.length > 0) {
        yield row(spec.uniqueCode ?? 'duplicate-key',
          put(path, [...value, isPlain(value[0]) ? { ...value[0] } : value[0]]));
      }
      break;
    default:
      break;
  }
}
```
Two properties of this generator are worth stating, because they are what make the coverage claim real: it yields **nothing** for a field a fixture does not contain (which the second test turns into a failure rather than a silent gap), and it never needs to know a *code* by hand — every code comes from the same `spec` the validator reads, including `spec.missingCode` and `spec.uniqueCode`.

**Verified by execution, not by reading.** The schema table, the walk and this generator were extracted to a scratch directory with tiny stubs for `options.js` and the fixtures, and run. That run found three real defects in the first draft of this plan, all now fixed above: (1) a deleted `cls` reported `missing-field`, silently retiring the documented `root-cls-invalid` code the rule table promises for an *absent* marker — hence `missingCode`; (2) the generator expected `number-out-of-range` for `NaN` while the validator classifies non-finite as `type-invalid` — the validator is right and the generator and the code list were corrected; (3) `evidence` is declared free-form, so the generator skipped it entirely and all five evidence rows *looked* unreachable — it now descends with the same per-mode type the `custom` hook uses. Final scratch result: **171 schema rows, 1,578 generated mutations, every one caught, 0 unreachable rows**.

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/validateResultSet.invariants.test.mjs` → `validateResultSet is not a function`.
- [ ] **Step 3a: Write the closed schema module.** This is the table, its two derived views, and the generic walk — no rule is written twice.
```js
// clashtest/results/resultSetSchema.js — the CLOSED structural schema of the sealed Result Set.
import { RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS } from '../options.js';
import { DIGEST_VERSION } from '../util/canonical.js';
import { CLASH_MODES } from '../identity/ids.js';                 // P1 is the sole home of the mode list
import { SCHEMA_VERSION, ENVIRONMENT_CAUSES } from './resultSet.js';

// Per-field string caps (§13.5.2). P0's summary assigns this table to P5 ("there is no schema-wide
// string-length ceiling in the spec"), so it lives beside the fields it caps. Data-format
// constants, like MAX_DEPTH and MAX_ISSUES — NOT G-CAL-gated §17.1 defaults.
export const STRING_CAPS = Object.freeze({
  modelKey: 1024, modelVersion: 1024, libraryVersion: 256, environmentField: 512,
  id: 256, reason: 256, timestamp: 64, digest: 128, default: 1024,
});
export const HIERARCHY_EXAMPLES_CAP = 20;                          // §13.1: the bounded examples list
export const UNKNOWN_FIELD_BYTES = 64 * 1024;                      // §13.6's budget — a DATA-FORMAT
                                                                   // constant, like MAX_DEPTH = 64,
                                                                   // not a G-CAL-gated §17.1 default
                                                                   // (overridden by limits if P0
                                                                   // ever adds the key — need X2)
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;                    // §5.4 digest format
const MAX_DBID = Number.MAX_SAFE_INTEGER;

// --- declaration helpers -----------------------------------------------------------------------
const str  = (cap = 'default', o = {}) => ({ kind: 'string', cap, ...o });
const enm  = (values, o = {}) => ({ kind: 'string', cap: 'reason', values: new Set(values), ...o });
const int  = (o = {}) => ({ kind: 'number', integer: true, min: 0, max: MAX_SAFE, ...o });
const num  = (o = {}) => ({ kind: 'number', ...o });
const bool = (o = {}) => ({ kind: 'boolean', ...o });
const obj  = (of, o = {}) => ({ kind: 'object', of, ...o });
const arr  = (of, o = {}) => ({ kind: 'array', of, ...o });
const lit  = (value, o = {}) => ({ kind: 'literal', value, ...o });
const free = (o = {}) => ({ kind: 'object', free: true, ...o });   // documented, contents open-ended
const digest = (o = {}) => ({ kind: 'string', cap: 'digest', pattern: DIGEST_PATTERN,
                              code: 'digest-syntax-invalid', ...o });
const dbId = (o = {}) => int({ min: 0, ...o });
const point3 = () => arr(num(), { exact: 3 });
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const ids = (o = {}) => arr(dbId(), { max: RUN_OPTION_CEILINGS.maxPlanReferences, unique: true, ...o });

/** Every durable type of the sealed Result Set. `open: true` is exactly §13.6's five open types. */
export const TYPES = new Map(Object.entries({
  ResultSet: { open: true, fields: {
    schemaVersion: lit(SCHEMA_VERSION),
    runId: str('id'),
    testRef: obj('TestRef'),
    definition: obj('Definition', { nullable: true, delegated: true }),   // P2's validateTest owns it
    derivedFromRunId: str('id', { nullable: true }),
    outcome: obj('RunOutcome'),
    provenance: obj('Provenance'),
    ledger: obj('Ledger'),
    results: arr('ClashResult', { max: RUN_OPTION_CEILINGS.maxResultsPerRun,
                                  uniqueBy: (r) => r.resultId, uniqueCode: 'duplicate-result-id' }),
    diagnostics: obj('Diagnostics'),
    statistics: free(),                                             // §12.6 informational
    digests: obj('Digests'),
    sealed: lit(true, { code: 'not-sealed' }),                      // §13.3
  } },
  TestRef: { fields: {
    testId: str('id'),
    revision: int({ min: 1, nullable: true }),
    semanticDigest: digest({ nullable: true }),
  } },
  RunOutcome: { open: true, fields: {
    status: enm(['completed', 'failed', 'cancelled', 'invalidated']),   // terminal statuses only
    coverage: enm(['full', 'partial']),
    integrity: enm(['clean', 'caveated']),
    freshness: enm(['current', 'stale', 'unverifiable']),
    environmentSensitive: bool(),
    environmentSensitiveCauses: arr(enm(ENVIRONMENT_CAUSES), { max: ENVIRONMENT_CAUSES.length,
                                                              uniqueBy: (c) => c }),
    reasons: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (r) => r }),
  } },
  Provenance: { open: true, fields: {
    registrySessionId: str('id'),
    libraryVersion: str('libraryVersion', { nullable: true }),
    broadPhase: enm(['tlas', 'linear']),
    determinismClass: enm(['deterministic', 'time-sensitive']),
    runOptions: free(),
    models: arr('ProvenanceModel', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                     uniqueBy: (m) => m.modelKey, uniqueCode: 'duplicate-model-key' }),
    scopeProof: obj('ScopeProof'),
    admissionBaseline: arr('AdmissionBaseline', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                                  uniqueBy: (a) => a.modelKey, uniqueCode: 'duplicate-model-key' }),
    hierarchyInternalAcceptance: obj('Acceptance', { nullable: true }),
    libraryExclusions: arr(str('reason'), { max: STRING_CAPS.id, uniqueBy: (e) => e }),
    placementVerified: lit(false),                                  // §13.2: deliberate and permanent
    environment: obj('Environment', { optional: true }),
    startedAt: str('timestamp'),
    finishedAt: str('timestamp'),
  } },
  ProvenanceModel: { fields: {
    modelKey: str('modelKey'), modelVersion: str('modelVersion'),
    scopeKinds: arr(enm(['model', 'elements']), { max: 2, uniqueBy: (k) => k }),
    elementCount: int(),
    scopeDigests: obj('ScopeDigests'),
    bindingGeneration: int(), placementGeneration: int(),
  } },
  ScopeDigests: { fields: {
    population: obj('Population', { nullable: true }),
    roots: arr('RootDigest', { max: ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                               uniqueBy: (r) => r.dbId, uniqueCode: 'duplicate-root-dbid' }),
  } },
  Population: { fields: { count: int(), digest: digest() } },
  RootDigest: { fields: { dbId: dbId(), subtreeDigest: digest() } },
  ScopeProof: { fields: { method: lit('bracketed-digest'), digestVersion: lit(DIGEST_VERSION) } },
  AdmissionBaseline: { fields: { modelKey: str('modelKey'), epochInstanceCount: int() } },
  Acceptance: { fields: { recordRef: str('id') } },
  Environment: { fields: { viewerVersion: str('environmentField', { optional: true }),
                           userAgent: str('environmentField', { optional: true }) } },
  Ledger: { open: true, fields: {
    planExists: bool(), pairSpaceTotal: int(), emptyOperand: bool(),
    units: arr('UnitRecord', { max: RUN_OPTION_CEILINGS.maxUnitsPerRun,
                               uniqueBy: (u) => u.unitId, uniqueCode: 'duplicate-unit-id' }),
    rootOwners: arr('RootOwners', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                    uniqueBy: (e) => e.modelKey, uniqueCode: 'duplicate-model-key' }),
    unresolvedSelections: arr('UnresolvedSelection', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    unreachablePopulation: arr('UnreachablePopulation', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                                          uniqueBy: (u) => u.modelKey, uniqueCode: 'duplicate-model-key' }),
    hierarchyInternal: arr('HierarchyInternal', { max: 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                                  uniqueBy: (h) => h.modelKey, uniqueCode: 'duplicate-model-key' }),
    planningGaps: arr('PlanningGap', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    exclusions: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (e) => e }),
    warnings: arr('Warning', { max: RUN_OPTION_CEILINGS.maxLedgerRecords }),
    budgetExhausted: bool(),
    firstRefusalUnitId: str('id', { nullable: true }),
  } },
  UnitRecord: { fields: {
    unitId: str('id'), kind: enm(['leaf', 'split']), parentUnitId: str('id', { nullable: true }),
    sourceModelKey: str('modelKey'), sourceRootDbIds: ids(),
    targets: arr('UnitTarget', { max: RUN_OPTION_CEILINGS.maxTargetModelsPerUnit,
                                 uniqueBy: (t) => t.modelKey, uniqueCode: 'duplicate-model-key' }),
    outcome: enm(['evaluated', 'failed', 'skipped', 'discarded', 'not-run', 'split']),
    cause: str('reason', { nullable: true }),
    secondaryCauses: arr(str('reason'), { max: RUN_OPTION_CEILINGS.maxLedgerRecords, uniqueBy: (c) => c }),
    capacityKind: str('reason', { nullable: true }),
    capDetail: enm(['ledger-records', 'unit-records'], { nullable: true }),
    scopeProof: enm(['equal', 'drift', 'unverifiable', 'not-checked']),
    pairSpaceWeight: int(),
    taints: arr('Taint', { max: RUN_OPTION_CEILINGS.maxElementTaintsPerUnit }),
    attempts: int(), durationMs: int(),
  } },
  UnitTarget: { fields: { modelKey: str('modelKey'), scope: enm(['model', 'roots']),
                          rootDbIds: ids({ optional: true }) } },
  Taint: { fields: { kind: enm(['element', 'target-model', 'unit']),
                     modelKey: str('modelKey', { nullable: true }), dbId: dbId({ nullable: true }),
                     reason: str('reason'), occurrences: int({ min: 1 }) } },
  RootOwners: { fields: { modelKey: str('modelKey'),
                          owners: arr('RootOwnerRow', { max: ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection,
                                                        uniqueBy: (r) => r.rootDbId,
                                                        uniqueCode: 'duplicate-root-dbid' }) } },
  // R2: `cls` reports its OWN code for an ABSENT field too (`missingCode`), because the rule
  // table says "absent or not 'A'/'B'/'C' ⇒ root-cls-invalid" — a generic `missing-field` there
  // would silently retire a documented code. Caught by running the generated suite.
  RootOwnerRow: { fields: { rootDbId: dbId(), ownerDbIds: ids(),
                            cls: enm(['A', 'B', 'C'], { code: 'root-cls-invalid',
                                                        missingCode: 'root-cls-invalid' }) } },
  UnresolvedSelection: { fields: { selectionRole: enm(['A', 'B']),
                                   modelKey: str('modelKey', { nullable: true }),
                                   cause: str('reason'), dbIds: ids() } },
  UnreachablePopulation: { fields: { modelKey: str('modelKey'), ownerDbIds: ids(),
                                     mixedOwnerDbIds: ids(), unattributable: obj('Unattributable') } },
  Unattributable: { fields: { notLoaded: int(), ownerUnresolvable: int() } },
  HierarchyInternal: { fields: { modelKey: str('modelKey'), rootCount: int(), ownerCount: int(),
                                 examples: arr('HierarchyExample', { max: HIERARCHY_EXAMPLES_CAP }) } },
  HierarchyExample: { fields: { rootDbId: dbId(), ownerDbIds: ids() } },
  PlanningGap: { fields: { phase: str('reason'), cause: str('reason') } },
  Warning: { fields: { code: str('reason'), modelKey: str('modelKey', { optional: true }) } },
  ClashResult: { custom: 'evidenceByMode', fields: {
    resultId: str('id'), pair: obj('PairId'), mode: enm(CLASH_MODES),
    evaluatedAs: obj('EvaluatedAs'),
    evidence: free(),                                  // shape is per-mode; `custom` checks it
    flags: obj('Flags'), unitId: str('id'),
  } },
  PairId: { fields: { first: obj('ElementRef'), second: obj('ElementRef') } },
  EvaluatedAs: { fields: { source: obj('ElementRef'), target: obj('ElementRef') } },
  ElementRef: { fields: { modelKey: str('modelKey'), dbId: dbId() } },
  Flags: { fields: { witnessUnavailable: lit(true, { optional: true }),
                     unreachableOwner: lit(true, { optional: true }),
                     mixedOwnerProvenance: lit(true, { optional: true }),
                     duplicateEvidenceConflict: lit(true, { optional: true }) } },
  VolumeEvidence: { fields: { witness: obj('Witness', { nullable: true }) } },
  Witness: { fields: { kind: str('reason'), point: point3() } },
  ClearanceEvidence: { fields: { distance: num(), clearance: num(),
                                 closestPoints: obj('ClosestPoints') } },
  ClosestPoints: { fields: { first: point3(), second: point3() } },
  EmptyEvidence: { fields: {} },                       // containment / surface-intersection
  Diagnostics: { open: true, fields: {
    diagnostics: arr('NormalizedDiagnostic', { max: RUN_OPTION_CEILINGS.maxRetainedDiagnostics }),
    countsByReason: free({ counts: true, maxKeys: RUN_OPTION_CEILINGS.maxDistinctReasons }),
    total: int(), completenessAffectingCount: int(), omittedReasonOccurrences: int(),
    unclassifiedOccurrences: int(), completenessAffectingUpperBound: int(),
    geometryReadinessOccurrences: int(), truncated: bool(),
  } },
  NormalizedDiagnostic: { fields: {                    // §12.2
    scope: enm(['fragment', 'pair']), reason: str('reason'), completenessAffecting: bool(),
    attribution: enm(['element', 'target-model', 'unit']),
    fragment: obj('DiagFragment', { optional: true }),
    fragments: obj('DiagFragmentPair', { optional: true }),
    ambiguousModelId: bool({ optional: true }),
    occurrences: int({ min: 1 }),
    unitIds: arr(str('id'), { max: RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic, uniqueBy: (u) => u }),
  } },
  DiagFragmentPair: { fields: { first: obj('DiagFragment'), second: obj('DiagFragment') } },
  DiagFragment: { fields: { modelKey: str('modelKey', { nullable: true }), dbId: dbId({ nullable: true }),
                            fragId: int(), role: enm(['source', 'target'], { optional: true }) } },
  Digests: { fields: {
    // NOT pinned to DIGEST_VERSION: §13.6 makes an unknown version valid-but-unverifiable. The
    // CLAIM predicate refuses it (review Critical 2); the validator must not call it corrupt.
    digestVersion: int({ min: 1 }),
    pairSetDigest: digest(), ledgerDigest: digest(),
  } },
}));

export const EVIDENCE_BY_MODE = Object.freeze({
  'volume-overlap': 'VolumeEvidence', clearance: 'ClearanceEvidence',
  'surface-intersection': 'EmptyEvidence', containment: 'EmptyEvidence',
});

// --- the two derived views ---------------------------------------------------------------------
const fieldNames = (typeName) => new Set(Object.keys(TYPES.get(typeName).fields));

/** §13.6's five OPEN types, keyed by their JSON-pointer parent path ('' = the ResultSet root). */
export const OPEN_TYPE_FIELDS = new Map([
  ['', fieldNames('ResultSet')], ['ledger', fieldNames('Ledger')],
  ['provenance', fieldNames('Provenance')], ['outcome', fieldNames('RunOutcome')],
  ['diagnostics', fieldNames('Diagnostics')],
]);

/** A path is OPEN when its parent is one of those five types and its last segment is not a
 *  documented field of that type. Everything BELOW an open path is in budget scope too (P0 applies
 *  that half, and does not consult this predicate there). Inside a documented-but-free-form field
 *  (`statistics`, `runOptions`, `countsByReason`) this is false: those are documented fields, not
 *  unknown ones — their cost is bounded by the node ceiling instead. */
export function isOpenPath(pathSegments) {
  // The ROOT is never open. Without this the ResultSet itself would enter budget scope and every
  // conforming set would be refused — P0 passes `[]` for the root.
  if (pathSegments.length === 0) return false;
  const parent = pathSegments.slice(0, -1).join('/');
  const known = OPEN_TYPE_FIELDS.get(parent);
  return known !== undefined && !known.has(pathSegments[pathSegments.length - 1]);
}

/** Flattened for the negative tests: one row per declared field. A new row here without a matching
 *  generated mutation is a test failure, which is what keeps schema and tests from drifting. */
export const SCHEMA_ROWS = Object.freeze([...TYPES].flatMap(([type, def]) =>
  Object.entries(def.fields).map(([field, spec]) => Object.freeze({ type, field, spec }))));

// --- the generic walk ----------------------------------------------------------------------------
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const specOf = (of) => (typeof of === 'string' ? { kind: 'object', of } : of);

function checkValue(value, spec, path, ctx) {
  if (value === null) { if (spec.nullable !== true) ctx.add(path, 'null-not-allowed'); return; }
  switch (spec.kind) {
    case 'literal':
      if (value !== spec.value) ctx.add(path, spec.code ?? 'literal-invalid');
      return;
    case 'boolean':
      if (typeof value !== 'boolean') ctx.add(path, 'type-invalid');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) { ctx.add(path, 'type-invalid'); return; }
      if (spec.integer === true && !Number.isSafeInteger(value)) { ctx.add(path, 'number-out-of-range'); return; }
      if (value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity)) ctx.add(path, 'number-out-of-range');
      return;
    case 'string':
      if (typeof value !== 'string') { ctx.add(path, 'type-invalid'); return; }
      if (spec.values !== undefined && !spec.values.has(value)) { ctx.add(path, spec.code ?? 'enum-invalid'); return; }
      if (spec.pattern !== undefined && !spec.pattern.test(value)) { ctx.add(path, spec.code ?? 'digest-syntax-invalid'); return; }
      if (value.length > STRING_CAPS[spec.cap]) ctx.add(path, 'string-too-long');
      return;
    case 'object':
      if (!isPlain(value)) { ctx.add(path, 'container-invalid'); return; }
      if (spec.free === true) { if (spec.counts === true) checkCountMap(value, spec, path, ctx); return; }
      checkObject(value, spec.of, path, ctx);
      return;
    case 'array': {
      if (!Array.isArray(value)) { ctx.add(path, 'container-invalid'); return; }
      if (spec.exact !== undefined && value.length !== spec.exact) { ctx.add(path, 'array-length-invalid'); return; }
      if (spec.max !== undefined && value.length > spec.max) { ctx.add(path, 'array-too-long'); return; }
      const item = specOf(spec.of);
      const key = spec.uniqueBy ?? (spec.unique === true ? (v) => v : null);
      const seen = key === null ? null : new Set();
      for (let i = 0; i < value.length; i += 1) {
        const at = `${path}/${i}`;
        checkValue(value[i], item, at, ctx);
        if (seen === null || value[i] === null || value[i] === undefined) continue;
        const k = key(value[i]);
        if (seen.has(k)) ctx.add(at, spec.uniqueCode ?? 'duplicate-key'); else seen.add(k);
      }
      return;
    }
    default:
      ctx.add(path, 'type-invalid');
  }
}

function checkCountMap(value, spec, path, ctx) {          // countsByReason: bounded int map
  const keys = Object.keys(value);
  if (keys.length > spec.maxKeys) { ctx.add(path, 'array-too-long'); return; }
  for (const k of keys) checkValue(value[k], { kind: 'number', integer: true, min: 0, max: MAX_SAFE },
                                   `${path}/${k}`, ctx);
}

function checkObject(value, typeName, path, ctx) {
  const type = TYPES.get(typeName);
  const fields = type.fields;
  for (const [name, spec] of Object.entries(fields)) {
    const at = `${path}/${name}`;
    if (!(name in value)) { if (spec.optional !== true) ctx.add(at, spec.missingCode ?? 'missing-field'); continue; }
    if (spec.delegated === true) continue;                // the embedded definition: P2 owns it
    checkValue(value[name], spec, at, ctx);
  }
  for (const name of Object.keys(value)) {
    if (name in fields) continue;
    if (type.open === true) { ctx.openBytes += unknownFieldBytes(name, value[name]); continue; }
    ctx.add(`${path}/${name}`, 'unknown-field-closed-type');
  }
  if (type.custom === 'evidenceByMode') {
    const evidenceType = EVIDENCE_BY_MODE[value.mode];  // an unknown mode is already `enum-invalid`
    if (evidenceType !== undefined) {
      checkValue(value.evidence, { kind: 'object', of: evidenceType }, `${path}/evidence`, ctx);
    }
  }
}

/** UTF-8 byte length by code-unit scan — the same measure P0's capture charges, and deliberately
 *  NOT `Buffer.byteLength` (P5 runs in the browser too; `Buffer` is Node-only). A lone surrogate
 *  counts as 3, matching P0's stated rule. P0 keeps this internal, so P5 has its own copy of the
 *  four-line function rather than an invented import; a divergence is caught by the shared
 *  budget-boundary test below. */
function utf8Length(s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length
             && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}

/** The SAME accounting P0 applies during capture — key + container/primitive/string — so the
 *  defensive re-check and the capture-time charge can never disagree about what a field costs.
 *  (A `canonicalJson`-based sum would have been a different, larger number.) */
function unknownFieldBytes(key, value) {
  let bytes = utf8Length(key);
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') { bytes += utf8Length(v); continue; }
    if (v === null || typeof v !== 'object') { bytes += 8; continue; }   // number, boolean, null
    bytes += 8;                                                          // the container itself
    if (Array.isArray(v)) { for (const item of v) stack.push(item); continue; }
    for (const k of Object.keys(v)) { bytes += utf8Length(k); stack.push(v[k]); }
  }
  return bytes;
}

/** The FIRST phase of validation (review Critical 3). It establishes the shape every later phase
 *  assumes, so it runs in full before any cross-field check traverses an array or an object. */
export function checkShapeAndUnknownFields(set, add, limits) {
  const ctx = { add, openBytes: 0 };
  checkObject(set, 'ResultSet', '', ctx);
  // DEFENSIVE re-check only: capture already charged this budget mid-traversal and refused before
  // copying the offending value (P5.4). Reaching it here means capture did not run.
  if (ctx.openBytes > (limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES)) add('', 'unknown-field-bytes');
}
```
`canonicalJson` is imported from P0's `util/canonical.js`; `Buffer.byteLength` is the same UTF-8 measure capture uses, so the defensive re-check and the capture-time charge cannot disagree on what a field costs.

- [ ] **Step 3b: Implement the generator validator and `readResultSet`.**
```js
// clashtest/results/validateResultSet.js (addition)
const MAX_ISSUES = 20;
const FATAL_CAUSES = new Set(['world-disposed', 'internal-error', 'result-cap']);
const INPUT_CHANGE_CAUSES = new Set(['input-changed', 'scope-drift', 'cancel-requested']);

/** Review question 1, answered: `validateResultSet` is NOT an untrusted-input boundary. It reads
 *  properties directly, so a raw hostile object would invoke getters — the exact thing capture
 *  exists to prevent. `captureResultSet`/`readResultSet` are the one boundary; this is the cheap
 *  O(1) precondition that makes the rule enforced rather than merely documented. */
const UNCAPTURED = 'ERR_UNCAPTURED_INPUT';
function assertCaptured(set) {
  const ok = set !== null && typeof set === 'object' && !Array.isArray(set)
    && Object.getPrototypeOf(set) === Object.prototype
    && Object.values(Object.getOwnPropertyDescriptors(set)).every((d) => 'value' in d);
  if (ok) return;
  const err = new TypeError('validateResultSet: argument must be a captured copy (spec §13.6); '
    + 'call captureResultSet/readResultSet at the untrusted boundary');
  err.code = UNCAPTURED;
  throw err;
}

export function* validateResultSetSteps(set, { limits }) {
  assertCaptured(set);                                  // O(1): root descriptors only
  const issues = [];
  const add = (path, code) => { if (issues.length < MAX_ISSUES) issues.push({ path, code }); };

  // The structural phase runs FIRST and in full (review Critical 3): no later phase may traverse
  // an array or an object whose shape has not been established.
  yield; checkShapeAndUnknownFields(set, add, limits);
  yield; checkCrossField(set, add);
  yield; checkResultLinkage(set, add);
  yield; checkOrderAndUniqueness(set, add);
  yield; checkDigests(set, add);
  return { ok: issues.length === 0, issues };
}

export function validateResultSet(set, options) {
  const it = validateResultSetSteps(set, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

export async function readResultSet(raw, { limits, migrations = NO_MIGRATIONS, slicer, runId = null }) {
  // Synchronous, BEFORE the first await (§13.6 R19-1) — and `runId` is the caller's diagnostic id,
  // never read off `raw`. Everything below is a rejected promise because this function is async.
  const captured = captureResultSet(raw, { limits, runId, migrations });
  const migrated = captured.schemaVersion === SCHEMA_VERSION
    ? captured
    : applyMigration(captured, migrations, { runId });   // single hop; output is re-validated below
  const it = validateResultSetSteps(migrated, { limits });
  let step = it.next();
  while (!step.done) {
    const p = slicer.tick('validate');                   // P0's yield point: undefined unless due
    if (p !== undefined) await p;
    step = it.next();
  }
  if (!step.value.ok) throw corrupt(runId, step.value.issues);
  await deepFreezeSliced(migrated, slicer);              // P0's helper; the slicer object itself
  return migrated;
}
```
`checkShapeAndUnknownFields` is the table-driven walk of Step 3a — it enforces **every** row of the closed structural schema (including `rootOwners[].owners[].cls` → `root-cls-invalid` and `sealed === true` → `not-sealed`) and re-sums the open types' unknown-field bytes defensively. `checkCrossField` implements the table above row by row (including `coverage: 'full'` ⇒ at least one leaf and every leaf `evaluated` ∧ `scopeProof: 'equal'`, and `pairSpaceTotal === Σ leaf pairSpaceWeight`). `checkResultLinkage` builds one `Map<unitId, UnitRecord>` and one `Map<modelKey, Map<dbId, rootDbId>>` from `ledger.rootOwners`, then checks each result in canonical order in a single pass — including **range coverage**: both owners' roots must be inside the covering unit's `sourceRootDbIds` / `targets[].rootDbIds` (or a `scope: 'model'` target, or, for an `unreachableOwner`-flagged result, that model's `unreachablePopulation.ownerDbIds`). `checkDigests` skips the comparison entirely when `digests.digestVersion !== DIGEST_VERSION`.
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/validateResultSet.invariants.test.mjs` → 14 passing (the `CORRUPTIONS` table covers 22 rows, and the generated structural suite covers one mutation per violation class per reachable schema field).
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): untrusted-read validation of Result Sets (P5.5)`

---

### Task P5.6: Pair- and element-level status (the taint rule)

**Files**
- Create: `clashtest/results/status.js`
- Test: `test/clashtest/results/status.test.mjs`

**Interfaces**

*Consumes:*
- the sealed `ResultSet` (P5.3) and the `Ledger`/`UnitRecord` shapes this phase pins — including the R2 per-root **`cls`** marker.
- `identity/ids.js` (P1): **`elementRefKey(ref) → string`** (row N12 — the one `ElementRef` key encoding; P5 does not invent a second one, which is exactly the collision N12 was added to prevent).
- `execution/diagnostics.js` (P4): **`isCompletenessAffecting(reason) → boolean`** — the ONE completeness predicate (P4's summary; the non-affecting set is exactly `{'witness-unavailable'}`). P5 imports it rather than restating the literal, so §12.3's carve-out has one home.

*Produces:* `getPairStatus`, `getElementStatus`, `createStatusReader`, `buildStatusReaderSteps`, `readLedger` — **all five** (duplicate-ownership **D4**; P8 creates neither `derive/status.js` nor `derive/ledgerReader.js`).

**Decision (asked for by the brief):** §12.5's pair/element views read *only* the sealed ledger, are purely synchronous (spec §13.6: "the purely synchronous helpers (`getPairStatus`, `getElementStatus` …) yield nowhere and need no capture"), and AC-20(c) — a P5 acceptance criterion — asserts `getPairStatus(101,102) = not-required, reason hierarchy-internal`. They therefore belong to the **seal side (P5)**, not to P8's sliced derivation machinery. P8 consumes them; P8 owns everything that needs a scheduler (facets, `groupBy`, `filter`, `compareResultSets`).

**Status-reader complexity contract (review Important 2).** The earlier draft said the reader "builds indexes once", but every `pairStatus` then ran `ledger.leaves.find(...)` and `sideOf` scanned each candidate's `targets[]` — so a P8 derivation over ~100,000 results against ~10,000 leaf units would have done up to a *billion* unit checks, exactly the cost the reader abstraction exists to remove. The contract is now explicit and tested:

| | Cost | How |
|---|---|---|
| **Build** | `O(units + rootOwner rows + results)` | one pass per record; every index below is filled in that pass and never rebuilt |
| **`pairStatus(pairId)`** | `O(1)` amortised, bounded | the covering leaf unit is found through `sourceRoots[modelKey][rootDbId]` — a **bounded** candidate list (§6.3's three-cell decomposition is an *exact cover*, so at most one leaf unit covers a given root pair; splitting gives a small fan-out) — and each candidate's target coverage is a single `Map`/`Set` lookup, never an array scan |
| **`elementStatus(ref)`** | `O(units that actually touch the element)` | the union of `sourceRoots`, `targetRoots` and `wholeModelTargets` for that `(modelKey, root)`; this is bounded by the answer's own size, which for an element inside a whole-model target legitimately *is* every unit targeting that model |

The four indexes, all built in the single pass: `sourceRoots: Map<modelKey, Map<rootDbId, UnitRecord[]>>` · `targetRoots: Map<modelKey, Map<rootDbId, UnitRecord[]>>` · `wholeModelTargets: Map<modelKey, UnitRecord[]>` · `unitScope: Map<unitId, {sourceRoots: Set<dbId>, targets: Map<modelKey, {whole, roots: Set<dbId>}>}>` — the last one is what makes `sideOf` `O(1)` instead of an `Array.includes` over `sourceRootDbIds` and a `.some()` over `targets[]`.

**Three readings this task pins** (each would otherwise be decided twice, or not at all):
1. **`required: null` for `undetermined`.** §12.5 declares `required: boolean` and defines no value for the `undetermined` verdict (register **S-P8-4**). `null` is "we cannot say", which is what the verdict means; `false` would assert the pair is *not* required, a claim the ledger does not support. `not-required` and every covered/gap verdict keep their booleans.
2. **Hierarchy-internal comes from the root table's `cls`, never from `hierarchyInternal.examples`.** The examples array is capped at 20 rows, so an element view derived from it silently under-reports caveats on large models. `readLedger` indexes `rootOwners[].owners[].cls` and `'C'` (a root in `A ∩ B`) is the test. This is exactly why R2 puts the marker in the persisted, digested schema.
3. **A benign `witness-unavailable` is reported but does not downgrade the verdict** (register **S-P4-4**, handed over by P4). Taint rule 1 fires on any `element` entry naming an owner; §12.3 and README M2.1 carve `witness-unavailable` out as *not* completeness-affecting. P4 records the table unfiltered (it is the evidence base and the ledger); **the filter lives only in the verdict**, at rule 1: the entry is still listed in `caveats[]`, but a pair whose only taint is benign stays `covered-clean`. Rules 2–3 need no filter: §12.2.1's structural classifier attributes a diagnostic naming both operands to `element`, so `witness-unavailable` cannot arrive as a `target-model` or `unit` taint.

- [ ] **Step 1: Write the failing status test.**
```js
// test/clashtest/results/status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPairStatus, getElementStatus, createStatusReader, buildStatusReaderSteps, readLedger }
  from '../../../clashtest/results/status.js';
import { sealedSet, pairOf, widePlan } from '../../support/resultSetFixtures.mjs';

test('a clean covered pair is covered-clean', async () => {
  const set = await sealedSet('positives');
  const s = getPairStatus(set, pairOf('MA', 1, 'MB', 7));
  assert.equal(s.verdict, 'covered-clean');
  assert.equal(s.required, true);
  assert.equal(s.coveringUnitId, 'u1');
  assert.equal(s.unitOutcome, 'evaluated');
  assert.deepEqual(s.caveats, []);
});

const TAINTS = [
  ['element',      (s) => { s.ledger.units[0].taints.push({ kind: 'element', modelKey: 'MA', dbId: 1, reason: 'clearance-invalid-transform', occurrences: 1 }); }],
  ['target-model', (s) => { s.ledger.units[0].taints.push({ kind: 'target-model', modelKey: 'MB', dbId: null, reason: 'fragment-not-loaded', occurrences: 2 }); }],
  ['unit',         (s) => { s.ledger.units[0].taints.push({ kind: 'unit', modelKey: null, dbId: null, reason: 'taint-overflow', occurrences: 1 }); }],
  ['mixed-owner',  (s) => { s.ledger.unreachablePopulation.push({ modelKey: 'MA', ownerDbIds: [], mixedOwnerDbIds: [1], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }); }],
  ['unattributable', (s) => { s.ledger.unreachablePopulation.push({ modelKey: 'MB', ownerDbIds: [], mixedOwnerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 0 } }); }],
  ['stale-seal',   (s) => { s.outcome.freshness = 'stale'; }],
];

test('every taint-rule clause alone makes the pair covered-caveated', async () => {
  for (const [label, taint] of TAINTS) {
    const set = structuredClone(await sealedSet('positives'));
    taint(set);
    const s = getPairStatus(set, pairOf('MA', 1, 'MB', 7));
    assert.equal(s.verdict, 'covered-caveated', label);
    assert.ok(s.caveats.length > 0, label);
    assert.ok(s.caveats.every((c) => ['element', 'target-model', 'unit'].includes(c.attribution)), label);
  }
});

test('a target-model taint only caveats a WHOLE-MODEL target scope', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.ledger.units[0].targets = [{ modelKey: 'MB', scope: 'roots', rootDbIds: [7] }];
  set.ledger.units[0].taints.push({ kind: 'target-model', modelKey: 'MB', dbId: null, reason: 'fragment-not-loaded', occurrences: 1 });
  assert.equal(getPairStatus(set, pairOf('MA', 1, 'MB', 7)).verdict, 'covered-clean');
});

test('a benign witness-unavailable taint is REPORTED but does not downgrade the verdict', async () => {
  // Register S-P4-4 / Gates item 6: §12.2.1 records the table unfiltered; the filter lives here.
  const set = structuredClone(await sealedSet('positives'));
  set.ledger.units[0].taints.push({ kind: 'element', modelKey: 'MA', dbId: 1, reason: 'witness-unavailable', occurrences: 4 });
  const s = getPairStatus(set, pairOf('MA', 1, 'MB', 7));
  assert.equal(s.verdict, 'covered-clean');                                  // benign ⇒ still clean
  assert.deepEqual(s.caveats, [{ reason: 'witness-unavailable', count: 4, attribution: 'element' }]);

  // one benign + one completeness-affecting ⇒ caveated, and BOTH are listed
  const mixed = structuredClone(set);
  mixed.ledger.units[0].taints.push({ kind: 'element', modelKey: 'MB', dbId: 7, reason: 'geometry-not-yet-available', occurrences: 1 });
  const m = getPairStatus(mixed, pairOf('MA', 1, 'MB', 7));
  assert.equal(m.verdict, 'covered-caveated');
  assert.deepEqual(m.caveats.map((c) => c.reason), ['witness-unavailable', 'geometry-not-yet-available']);
});

test('not-required, gap and undetermined verdicts — and `required` is null only for undetermined', async () => {
  const hier = await sealedSet('hierarchy-internal');
  const h = getPairStatus(hier, pairOf('MA', 101, 'MA', 102));
  assert.equal(h.verdict, 'not-required');
  assert.equal(h.required, false);
  assert.equal(h.reason, 'hierarchy-internal');
  assert.ok(h.caveats.some((c) => c.reason === 'hierarchy-internal'));

  const unreachable = await sealedSet('unreachable-positive');
  const u = getPairStatus(unreachable, pairOf('MA', 200, 'MB', 950));
  assert.equal(u.verdict, 'not-required');
  assert.equal(u.required, false);

  const gapped = await sealedSet('completed-with-gaps');
  const g = getPairStatus(gapped, pairOf('MA', 2, 'MB', 9));
  assert.equal(g.verdict, 'gap');
  assert.equal(g.required, true);

  // §12.5 declares `required: boolean` but defines NO value for `undetermined`: P5 pins `null`
  // ("we cannot say"), never `false` (which would assert the pair is not required).
  const foreign = getPairStatus(await sealedSet('positives'), pairOf('MA', 777, 'MB', 7));
  assert.equal(foreign.verdict, 'undetermined');
  assert.equal(foreign.required, null);
  assert.deepEqual(foreign.roots, { first: null, second: 7 });
});

test('a mixed owner is REQUIRED and caveated, never not-required (§12.5, taint rule 6)', async () => {
  const set = structuredClone(await sealedSet('positives'));
  set.ledger.unreachablePopulation.push({ modelKey: 'MA', ownerDbIds: [], mixedOwnerDbIds: [1],
    unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  const s = getPairStatus(set, pairOf('MA', 1, 'MB', 7));
  assert.equal(s.required, true);
  assert.equal(s.verdict, 'covered-caveated');
});

// ---- the three reader exports moved here from P8 (D4) ----------------------------------------
test('createStatusReader answers the same as the one-shot helpers, building the index once', async () => {
  const set = await sealedSet('positives');
  const reader = createStatusReader(set);
  assert.deepEqual(reader.pairStatus(pairOf('MA', 1, 'MB', 7)), getPairStatus(set, pairOf('MA', 1, 'MB', 7)));
  assert.deepEqual(reader.elementStatus({ modelKey: 'MA', dbId: 1 }), getElementStatus(set, { modelKey: 'MA', dbId: 1 }));
});

test('buildStatusReaderSteps yields while it builds and returns the same reader', async () => {
  const set = await sealedSet('positives');
  const it = buildStatusReaderSteps(set);
  let yields = 0;
  let step = it.next();
  while (!step.done) { yields += 1; step = it.next(); }
  assert.ok(yields > 0, 'a derivation can slice the build');
  assert.deepEqual(step.value.pairStatus(pairOf('MA', 1, 'MB', 7)).verdict, 'covered-clean');
});

test('a frozen set reuses its index; a mutable set is never answered from a stale one', async () => {
  const frozen = await sealedSet('positives');
  assert.equal(Object.isFrozen(frozen), true);
  assert.deepEqual(getPairStatus(frozen, pairOf('MA', 1, 'MB', 7)),
                   getPairStatus(frozen, pairOf('MA', 1, 'MB', 7)), 'repeated answers agree');

  // Index reuse is a performance property and is invisible for a frozen set — which is exactly why
  // it is only ever applied to frozen sets. A MUTABLE set must be re-read on every call:
  const mutable = structuredClone(frozen);
  assert.equal(getPairStatus(mutable, pairOf('MA', 1, 'MB', 7)).verdict, 'covered-clean');
  mutable.ledger.units[0].outcome = 'failed';
  mutable.ledger.units[0].cause = 'capacity-exceeded';
  assert.equal(getPairStatus(mutable, pairOf('MA', 1, 'MB', 7)).verdict, 'gap', 'no stale cached index');
});

// --- review Important 2: the reader's complexity is an acceptance criterion, not a claim -------
// A counting instrument, not a proxy: `Map.prototype.get` / `Set.prototype.has` are patched for the
// duration and restored. Same technique as the `JSON.parse` and `structuredClone` spies elsewhere.
const ops = { count: 0 };
function withOpCounting(fn) {
  const mapGet = Map.prototype.get, setHas = Set.prototype.has, incl = Array.prototype.includes;
  Map.prototype.get = function (k) { ops.count += 1; return mapGet.call(this, k); };
  Set.prototype.has = function (k) { ops.count += 1; return setHas.call(this, k); };
  Array.prototype.includes = function (v) { ops.count += 1; return incl.call(this, v); };
  try { return fn(); } finally {
    Map.prototype.get = mapGet; Set.prototype.has = setHas; Array.prototype.includes = incl;
  }
}

test('reader build is linear in units and lookup cost does not grow with the unit count', async () => {
  // `widePlan(unitCount)` produces a valid sealed set with `unitCount` leaf units over the same two
  // models, and 50 results spread across them — so the PROBES are identical at both sizes.
  const measure = async (unitCount) => {
    const set = await widePlan(unitCount);
    const probes = set.results.slice(0, 50).map((r) => r.pair);
    let reader;
    const build = withOpCounting(() => { const b = ops.count; reader = createStatusReader(set); return ops.count - b; });
    const lookup = withOpCounting(() => { const b = ops.count; for (const p of probes) reader.pairStatus(p); return ops.count - b; });
    return { build, lookup };
  };
  const small = await measure(200);
  const large = await measure(2_000);                       // 10x the units, identical probes

  // Build is O(units + rows + results): 10x the units costs ~10x, never ~100x.
  assert.ok(large.build < small.build * 20,
    `build scaled super-linearly: ${small.build} -> ${large.build}`);
  // Lookup is O(1)/bounded: 10x the units must NOT make 50 lookups measurably more expensive.
  // The old `leaves.find(...)` reader would have gone up by ~10x here.
  assert.ok(large.lookup < small.lookup * 1.5,
    `lookup scaled with the unit count: ${small.lookup} -> ${large.lookup}`);
  assert.ok(large.lookup < large.build, 'a lookup must cost far less than the build it reuses');
});

test('elementStatus visits only the units that touch the element', async () => {
  const set = await widePlan(2_000);
  const reader = createStatusReader(set);
  const e = reader.elementStatus({ modelKey: 'MA', dbId: set.ledger.rootOwners[0].owners[0].rootDbId });
  // The fixture puts each root in exactly one unit, so the element's coverage comes from one unit.
  assert.equal(e.coverage, 'full');
  assert.equal(e.gapCauses.length, 0);
  const lookup = withOpCounting(() => {
    const b = ops.count; reader.elementStatus({ modelKey: 'MA', dbId: 999_999 }); return ops.count - b;
  });
  assert.ok(lookup < 50, `a miss must not scan 2,000 units: ${lookup} ops`);
});

test('readLedger exposes the per-root cls marker P8 needs (R2), not a bounded examples list', async () => {
  const set = await sealedSet('hierarchy-internal');
  const it = readLedger(set);
  let step = it.next();
  while (!step.done) step = it.next();
  const model = step.value.byModel.get('MA');
  assert.equal(model.rootCls.get(100), 'C');                     // the A ∩ B root
  assert.equal(model.ownerToRoot.get(101), 100);
  assert.equal(model.ownerToRoot.get(102), 100);
  assert.equal(step.value.leaves.every((u) => u.outcome !== 'split'), true);
});

test('element status reports hierarchy-internal from cls even beyond the 20 bounded examples', async () => {
  const set = structuredClone(await sealedSet('hierarchy-internal'));
  set.ledger.hierarchyInternal[0].examples = [];                 // the bounded list is EMPTY …
  const e = getElementStatus(set, { modelKey: 'MA', dbId: 101 });
  assert.ok(e.caveats.some((c) => c.reason === 'hierarchy-internal'), '… and the caveat still appears');
});

test('element status reports unit-level taints and gap causes', async () => {
  const set = structuredClone(await sealedSet('completed-with-gaps'));
  const e = getElementStatus(set, { modelKey: 'MA', dbId: 2 });
  assert.equal(e.inRequiredPairSpace, true);
  assert.equal(e.coverage, 'partial');
  assert.deepEqual(e.gapCauses, ['capacity-exceeded']);
  const mixed = structuredClone(await sealedSet('positives'));
  mixed.ledger.unreachablePopulation.push({ modelKey: 'MA', ownerDbIds: [], mixedOwnerDbIds: [1], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  assert.ok(getElementStatus(mixed, { modelKey: 'MA', dbId: 1 }).caveats.some((c) => c.reason === 'mixed-owner-provenance'));
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/status.test.mjs` → module not found.
- [ ] **Step 3: Implement `status.js` with the normative taint rule.**
```js
// clashtest/results/status.js — the ONE §12.5 taint rule and the ONE sealed-ledger reader (D4)
import { elementRefKey } from '../identity/ids.js';              // P1 row N12: one key encoding
import { isCompletenessAffecting } from '../execution/diagnostics.js';  // P4: the ONE predicate

const ROOT_CLASSES = new Set(['A', 'B', 'C']);   // P3's ROOT_CLASS literals (R2): A = A' \ B, B = B' \ A, C = A n B
const caveat = (reason, attribution, count = 1) => ({ reason, count, attribution });
const pairKey = (pair) => `${elementRefKey(pair.first)}|${elementRefKey(pair.second)}`;

/** The ONLY function that knows the sealed ledger's physical layout. One `yield` per indexed
 *  record so a derivation can slice it; `createStatusReader` drains it synchronously. */
export function* readLedger(resultSet) {
  const ledger = resultSet.ledger ?? {};
  const byModel = new Map();
  const model = (modelKey) => {
    let m = byModel.get(modelKey);
    if (m === undefined) {
      m = { ownerToRoot: new Map(), rootCls: new Map(), unreachable: null, hierarchy: null };
      byModel.set(modelKey, m);
    }
    return m;
  };
  for (const entry of ledger.rootOwners ?? []) {
    const m = model(entry.modelKey);
    for (const row of entry.owners) {
      m.rootCls.set(row.rootDbId, ROOT_CLASSES.has(row.cls) ? row.cls : null);   // R2 per-root class
      m.ownerToRoot.set(row.rootDbId, row.rootDbId);            // a root owns itself
      for (const dbId of row.ownerDbIds) m.ownerToRoot.set(dbId, row.rootDbId);
      yield;
    }
  }
  for (const u of ledger.unreachablePopulation ?? []) { model(u.modelKey).unreachable = u; yield; }
  for (const h of ledger.hierarchyInternal ?? []) { model(h.modelKey).hierarchy = h; yield; }
  const unitsById = new Map();
  const leaves = [];
  for (const u of ledger.units ?? []) {
    unitsById.set(u.unitId, u);
    if (u.outcome !== 'split') leaves.push(u);                  // a split parent is superseded
    yield;
  }
  return { units: ledger.units ?? [], leaves, unitsById, byModel,
           planningGaps: ledger.planningGaps ?? [], pairSpaceTotal: ledger.pairSpaceTotal ?? 0,
           emptyOperand: ledger.emptyOperand === true };
}

export function* buildStatusReaderSteps(resultSet) {
  const ledger = yield* readLedger(resultSet);
  const index = yield* indexUnitsSteps(ledger.leaves);        // O(units + target rows), once
  const resultByPair = new Map();
  for (const r of resultSet.results ?? []) { resultByPair.set(pairKey(r.pair), r); yield; }
  return makeReader(resultSet, ledger, resultByPair, index);  // total build: O(units + rows + results)
}

export function createStatusReader(resultSet) {
  const it = buildStatusReaderSteps(resultSet);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

// Index reuse: only a FROZEN set may be cached — a mutable one must be re-read every call, or a
// reader could answer from a stale index (a correctness bug, not a performance one).
const READER_CACHE = new WeakMap();
function readerFor(resultSet) {
  if (!Object.isFrozen(resultSet)) return createStatusReader(resultSet);
  let reader = READER_CACHE.get(resultSet);
  if (reader === undefined) { reader = createStatusReader(resultSet); READER_CACHE.set(resultSet, reader); }
  return reader;
}

export const getPairStatus = (resultSet, pairId) => readerFor(resultSet).pairStatus(pairId);
export const getElementStatus = (resultSet, elementRef) => readerFor(resultSet).elementStatus(elementRef);

// --- the unit indexes (review Important 2) -----------------------------------------------------
// Built ONCE, in O(units + target rows). After this, no lookup ever scans the unit list, the
// `sourceRootDbIds` array or the `targets` array again.
const EMPTY = Object.freeze([]);
const push1 = (map, k, v) => { const l = map.get(k); if (l === undefined) map.set(k, [v]); else l.push(v); };
const push2 = (map, k1, k2, v) => {
  let inner = map.get(k1);
  if (inner === undefined) { inner = new Map(); map.set(k1, inner); }
  push1(inner, k2, v);
};
const listAt = (map, k1, k2) => map.get(k1)?.get(k2) ?? EMPTY;

export function* indexUnitsSteps(leaves) {
  const sourceRoots = new Map(), targetRoots = new Map(), wholeModelTargets = new Map();
  const unitScope = new Map();
  for (const u of leaves) {
    for (const root of u.sourceRootDbIds) push2(sourceRoots, u.sourceModelKey, root, u);
    const targets = new Map();
    for (const t of u.targets) {
      const whole = t.scope === 'model';
      targets.set(t.modelKey, { whole, roots: new Set(whole ? [] : t.rootDbIds ?? []) });
      if (whole) push1(wholeModelTargets, t.modelKey, u);
      else for (const root of t.rootDbIds ?? []) push2(targetRoots, t.modelKey, root, u);
    }
    unitScope.set(u.unitId, { sourceRoots: new Set(u.sourceRootDbIds), targets });
    yield;
  }
  return { sourceRoots, targetRoots, wholeModelTargets, unitScope };
}

/** Both O(1): one Map lookup plus one Set membership test. */
const coversSource = (index, unit, modelKey, root) =>
  unit.sourceModelKey === modelKey && index.unitScope.get(unit.unitId).sourceRoots.has(root);
const targetScope = (index, unit, modelKey) => index.unitScope.get(unit.unitId).targets.get(modelKey);
const coversTarget = (index, unit, modelKey, root) => {
  const s = targetScope(index, unit, modelKey);
  return s !== undefined && (s.whole || s.roots.has(root));
};
/** Which side of `unit` this (modelKey, root) is on — `null` when the unit does not touch it. */
const sideOf = (index, unit, modelKey, root) =>
  coversSource(index, unit, modelKey, root) ? 'source'
  : coversTarget(index, unit, modelKey, root) ? 'target' : null;
const wholeModelTarget = (index, unit, modelKey) => targetScope(index, unit, modelKey)?.whole === true;

/** The covering leaf unit, without scanning the unit list. Candidates are the units that carry
 *  (mA, rA) on their SOURCE side — a bounded list, because §6.3's decomposition is an exact cover
 *  — and each candidate's target side is tested in O(1). */
function findCoveringUnit(index, mA, rA, mB, rB) {
  for (const u of listAt(index.sourceRoots, mA, rA)) if (coversTarget(index, u, mB, rB)) return u;
  for (const u of listAt(index.sourceRoots, mB, rB)) if (coversTarget(index, u, mA, rA)) return u;
  return undefined;
}

/** Only the units that actually touch this (modelKey, root) — never all leaves. */
function unitsTouching(index, modelKey, root) {
  const seen = new Set();
  const out = [];
  for (const u of listAt(index.sourceRoots, modelKey, root)) { seen.add(u.unitId); out.push(u); }
  for (const list of [listAt(index.targetRoots, modelKey, root),
                      index.wholeModelTargets.get(modelKey) ?? EMPTY]) {
    for (const u of list) { if (seen.has(u.unitId)) continue; seen.add(u.unitId); out.push(u); }
  }
  return out;
}

function makeReader(resultSet, ledger, resultByPair, index) {
  const outcome = resultSet.outcome ?? {};
  const of = (modelKey) => ledger.byModel.get(modelKey) ?? null;
  const rootOf = (ref) => of(ref.modelKey)?.ownerToRoot.get(ref.dbId) ?? null;

  function pairStatus(pairId) {
    const roots = { first: rootOf(pairId.first), second: rootOf(pairId.second) };
    const base = { required: false, coveringUnitId: null, unitOutcome: null, roots, caveats: [] };

    for (const side of ['first', 'second']) {                   // unreachable-only owner ⇒ outside P
      const ref = pairId[side];
      if (roots[side] === null && of(ref.modelKey)?.unreachable?.ownerDbIds.includes(ref.dbId) === true) {
        return { ...base, caveats: [caveat('unreachable-only-owner', 'element')],
                 verdict: 'not-required', reason: 'unreachable-only-owner' };
      }
    }
    // §12.5: `undetermined` ONLY when an owner is absent from `rootOwners`. `required` is `null`
    // here — the spec defines no boolean for this verdict and "not required" would be a claim.
    if (roots.first === null || roots.second === null) {
      return { ...base, required: null, verdict: 'undetermined', reason: 'owner-not-in-ledger' };
    }
    if (pairId.first.modelKey === pairId.second.modelKey && roots.first === roots.second) {
      return { ...base, caveats: [caveat('hierarchy-internal', 'element')],
               verdict: 'not-required', reason: 'hierarchy-internal' };
    }

    const unit = findCoveringUnit(index, pairId.first.modelKey, roots.first,
                                  pairId.second.modelKey, roots.second);   // bounded, never O(units)
    if (unit === undefined) return { ...base, required: true, verdict: 'gap', reason: 'unit-not-found' };
    if (unit.outcome !== 'evaluated') {
      return { ...base, required: true, coveringUnitId: unit.unitId, unitOutcome: unit.outcome,
               verdict: 'gap', reason: unit.cause ?? unit.outcome };
    }

    const targetModelKey = coversSource(index, unit, pairId.first.modelKey, roots.first)
      ? pairId.second.modelKey : pairId.first.modelKey;
    const caveats = [];
    let affecting = 0;                                          // caveats that actually downgrade
    const note = (c, downgrades) => { caveats.push(c); if (downgrades) affecting += 1; };

    for (const t of unit.taints) {
      if (t.kind === 'element'
          && [pairId.first, pairId.second].some((r) => r.modelKey === t.modelKey && r.dbId === t.dbId)) {
        // rule 1 — ALWAYS reported; only a completeness-affecting reason downgrades (S-P4-4).
        note(caveat(t.reason, 'element', t.occurrences), isCompletenessAffecting(t.reason));
      }
      if (t.kind === 'target-model' && t.modelKey === targetModelKey
          && wholeModelTarget(index, unit, targetModelKey)) {
        note(caveat(t.reason, 'target-model', t.occurrences), true);                         // rule 2
      }
      if (t.kind === 'unit') note(caveat(t.reason, 'unit', t.occurrences), true);            // rule 3
    }
    if (resultByPair.get(pairKey(pairId))?.flags?.duplicateEvidenceConflict === true) {
      note(caveat('duplicate-evidence-conflict', 'element'), true);                          // rule 4
    }
    if (outcome.freshness !== 'current') note(caveat('stale-at-seal', 'unit'), true);        // rule 5
    const seenModels = new Set();
    for (const side of ['first', 'second']) {                                            // rules 6, 7
      const ref = pairId[side];
      const entry = of(ref.modelKey)?.unreachable ?? null;
      if (entry?.mixedOwnerDbIds.includes(ref.dbId) === true) {
        note(caveat('mixed-owner-provenance', 'element'), true);
      }
      if (!seenModels.has(ref.modelKey)) {                      // rule 7 is per MODEL, not per side
        seenModels.add(ref.modelKey);
        const u = entry?.unattributable ?? null;
        if (u !== null && u.notLoaded + u.ownerUnresolvable > 0) {
          note(caveat('unattributable-unreachable-population', 'target-model'), true);
        }
      }
    }
    return { required: true, coveringUnitId: unit.unitId, unitOutcome: unit.outcome, roots, caveats,
             verdict: affecting === 0 ? 'covered-clean' : 'covered-caveated' };
  }

  function elementStatus(elementRef) {
    const root = rootOf(elementRef);
    const entry = of(elementRef.modelKey)?.unreachable ?? null;
    const caveats = [];
    const gapCauses = new Set();
    let inUnits = 0;
    let evaluated = 0;
    // Only the units that touch this element — bounded by the answer, never O(leaves).
    for (const u of root === null ? EMPTY : unitsTouching(index, elementRef.modelKey, root)) {
      const side = sideOf(index, u, elementRef.modelKey, root);
      if (side === null) continue;
      inUnits += 1;
      if (u.outcome === 'evaluated') evaluated += 1;
      else if (u.cause !== null) gapCauses.add(u.cause);
      for (const t of u.taints) {
        if (t.kind === 'element' && t.modelKey === elementRef.modelKey && t.dbId === elementRef.dbId) {
          caveats.push(caveat(t.reason, 'element', t.occurrences));
        }
        if (t.kind === 'unit' && side === 'source') caveats.push(caveat(t.reason, 'unit', t.occurrences));
        if (t.kind === 'target-model' && side === 'target' && t.modelKey === elementRef.modelKey
            && wholeModelTarget(index, u, elementRef.modelKey)) {
          caveats.push(caveat(t.reason, 'target-model', t.occurrences));
        }
      }
    }
    if (entry?.mixedOwnerDbIds.includes(elementRef.dbId) === true) {
      caveats.push(caveat('mixed-owner-provenance', 'element'));
    }
    // R2: complete for EVERY element, from the digested per-root class — never from the bounded
    // `hierarchyInternal.examples` list, which is capped at 20 rows and would under-report.
    if (root !== null && of(elementRef.modelKey)?.rootCls.get(root) === 'C') {
      caveats.push(caveat('hierarchy-internal', 'element'));
    }
    const coverage = inUnits === 0 ? 'none' : evaluated === inUnits ? 'full' : 'partial';
    return { inRequiredPairSpace: root !== null, coverage, caveats, gapCauses: [...gapCauses].sort() };
  }

  return { pairStatus, elementStatus, ledger };
}
```
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/status.test.mjs` → 14 passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): pair and element status over the sealed ledger (P5.6)`

---

### Task P5.7: `InMemoryResultStore` and the store conformance suite

**Files**
- Create: `clashtest/results/InMemoryResultStore.js`
- Create: `test/clashtest/support/resultStoreConformance.mjs`
- Test: `test/clashtest/results/InMemoryResultStore.test.mjs`

**Interfaces**

*Consumes:* `util/canonical.js` → `canonicalJson` (P0); `errors.js` → `RunIdConflictError`, `IdentityConflictError`, `TestDeletedError`, `ResultSetTooLargeError`, `CorruptListingError`, `InvalidOptionsError` (P0); `validateResultSet.js` → `validateResultSetSummary` (P5.5).

*Produces:* `createInMemoryResultStore`, `runResultStoreConformance(makeStore, {label})`.

**Durable form (simplification, stated):** the reference store keeps each set as its **canonical JSON string** plus a precomputed `serializedBytes`. This is simpler than §13.3's suggested `structuredClone`-on-write-and-read, gives strictly stronger copy semantics (nothing is shared by reference in either direction), and is the only shape in which the §13.6 byte guard can genuinely "reject without materializing the value" — the size is checked against the string before `JSON.parse` is ever called. The observable contract (copy on write and on read, atomic create-only `put`, byte-guarded `get`) is unchanged.

- [ ] **Step 1: Write the failing store test (the conformance suite plus reference-only cases).**
```js
// test/clashtest/results/InMemoryResultStore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { runResultStoreConformance } from '../../support/resultStoreConformance.mjs';
import { ResultSetTooLargeError, RunIdConflictError, IdentityConflictError, TestDeletedError, InvalidOptionsError } from '../../../clashtest/errors.js';
import { sealedSet, withRunId, withModels } from '../../support/resultSetFixtures.mjs';

runResultStoreConformance(() => createInMemoryResultStore(), { label: 'InMemoryResultStore' });

test('put is create-only: identical content is idempotent, different content conflicts', async () => {
  const store = createInMemoryResultStore();
  const set = await sealedSet('positives');
  await store.put(set);
  await store.put(structuredClone(set));                                   // idempotent
  await assert.rejects(store.put(await withRunId(set.runId, 'completed-with-gaps')), RunIdConflictError);
  assert.equal((await store.get(set.runId)).outcome.coverage, set.outcome.coverage);
});

test('the identity index is atomic across runIds and survives delete', async () => {
  const store = createInMemoryResultStore();
  const a = await withModels([['M1', 'v1'], ['M2', 'v1']], 'positives');
  const b = await withModels([['M2', 'v2'], ['M3', 'v1']], 'positives');
  await store.put(a);
  await assert.rejects(store.put(b), IdentityConflictError);
  assert.equal(await store.get(b.runId), null);                            // nothing inserted
  await store.put(await withModels([['M3', 'v1']], 'positives'));          // M3 was never claimed by the failed put
  await store.delete(a.runId);
  await assert.rejects(store.put(await withModels([['M1', 'v9']], 'positives')), IdentityConflictError);
});

test('tombstoneTest blocks new inserts, is idempotent and survives delete', async () => {
  const store = createInMemoryResultStore();
  const first = await sealedSet('positives');
  await store.put(first);
  await store.tombstoneTest(first.testRef.testId);
  await store.tombstoneTest(first.testRef.testId);
  assert.equal(await store.isTombstoned(first.testRef.testId), true);
  await assert.rejects(store.put(await withRunId('run-new', 'positives')), TestDeletedError);
  await store.put(structuredClone(first));                                 // identical re-put still succeeds
  assert.ok(await store.get(first.runId));
  await store.delete(first.runId);
  assert.equal(await store.isTombstoned(first.testRef.testId), true);
});

test('get refuses an oversized set before any object graph exists', async () => {
  const store = createInMemoryResultStore();
  const set = await sealedSet('positives');
  await store.put(set);
  const realParse = JSON.parse;
  let parses = 0;
  JSON.parse = (...a) => { parses += 1; return realParse(...a); };
  try {
    await assert.rejects(store.get(set.runId, { maxBytes: 10 }), ResultSetTooLargeError);
    assert.equal(parses, 0);
  } finally { JSON.parse = realParse; }
});

test('put and get copy in both directions, and the LISTING agrees with get (review Important 3)', async () => {
  const store = createInMemoryResultStore();
  const set = structuredClone(await sealedSet('positives'));
  await store.put(set);

  const before = { get: await store.get(set.runId), list: (await store.list({})).summaries[0] };

  // Mutate every nested field the summary is built from — the exact reference leak the review
  // found: `testRef` and `digests` were retained by reference, so `list()` would follow the
  // caller's mutation while `get()` kept the stored content.
  set.outcome.coverage = 'full';
  set.testRef.testId = 'HIJACKED';
  set.digests.ledgerDigest = `sha256:${'f'.repeat(64)}`;
  set.provenance.models[0].modelVersion = 'v999';
  set.provenance.models.push({ ...set.provenance.models[0], modelKey: 'INJECTED' });
  set.provenance.startedAt = '1999-01-01T00:00:00.000Z';
  set.provenance.finishedAt = '1999-01-01T00:00:01.000Z';
  set.ledger.pairSpaceTotal = 99_999;
  set.results.push({ resultId: 'injected', flags: {} });

  const afterGet = await store.get(set.runId);
  const afterList = (await store.list({})).summaries[0];
  assert.deepEqual(afterGet, before.get, 'get must not follow the caller');
  assert.deepEqual(afterList, before.list, 'and list must not either');
  assert.equal(afterList.testRef.testId, before.get.testRef.testId, 'the two views agree');
  assert.equal(afterList.digests.ledgerDigest, afterGet.digests.ledgerDigest);
  assert.equal(afterList.counts.results, afterGet.results.length);
  assert.equal(afterList.models.length, afterGet.provenance.models.length);

  // …and mutating what the store HANDS BACK changes nothing either, in both directions.
  afterGet.outcome.coverage = 'full';
  afterGet.testRef.testId = 'HIJACKED';
  afterList.digests.ledgerDigest = `sha256:${'0'.repeat(64)}`;
  afterList.models.push({ modelKey: 'X', modelVersion: 'v1' });
  assert.deepEqual(await store.get(set.runId), before.get);
  assert.deepEqual((await store.list({})).summaries[0], before.list);
});

test('list rejects bad options', async () => {
  const store = createInMemoryResultStore();
  for (const bad of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { cursor: 'nope' }, { cursor: 'v9:x' }, { unknown: 1 }]) {
    await assert.rejects(store.list(bad), InvalidOptionsError);
  }
});
```
```js
// test/clashtest/support/resultStoreConformance.mjs  (excerpt — the parts every host store must pass)
export function runResultStoreConformance(makeStore, { label }) {
  test(`${label}: keyset paging never duplicates or skips an item present throughout`, async () => {
    const store = makeStore();
    for (const id of ['r1', 'r3', 'r5', 'r7']) await store.put(await withRunId(id, 'positives'));
    const seen = [];
    let cursor;
    do {
      const page = await store.list({ limit: 2, cursor });
      seen.push(...page.summaries.map((s) => s.runId));
      cursor = page.next;
      if (cursor) { await store.put(await withRunId('r0', 'positives')); await store.delete('r9'); }
    } while (cursor);
    assert.deepEqual(seen, ['r1', 'r3', 'r5', 'r7']);                      // code-unit order, exactly once each
  });

  test(`${label}: an offset-paging store is caught as non-conforming`, async () => {
    await assert.rejects(async () => runKeysetProbe(makeOffsetStore()), /non-conforming/);
  });

  test(`${label}: summaries are header-only, closed and validated`, async () => {
    const store = makeStore();
    const set = await sealedSet('positives');
    await store.put(set);
    const [s] = (await store.list({})).summaries;
    assert.deepEqual(Object.keys(s).sort(), ['coverage', 'counts', 'digests', 'environmentSensitive', 'finishedAt',
      'integrity', 'models', 'runId', 'serializedBytes', 'startedAt', 'status', 'testRef'].sort());
    assert.ok(Number.isSafeInteger(s.serializedBytes) && s.serializedBytes >= 0);
    assert.equal('results' in s, false);
  });

  test(`${label}: a page with any invalid entry is rejected whole`, async () => {
    const store = makeStore({ corruptPage: true });                        // duplicate modelKey in models[]
    await assert.rejects(store.list({}), CorruptListingError);
  });

  test(`${label}: the byte guard rejects before materializing`, async () => { /* JSON.parse spy, as above */ });

  // --- review question 3: the port requires LINEARIZABILITY across concurrent calls, so the
  // --- conformance suite must actually interleave them. The suite was sequential throughout.
  //
  // The linearizability expectation, stated precisely: for any set of concurrently issued
  // operations there exists ONE total order, consistent with the real-time order of
  // non-overlapping operations, in which every operation's result is the result it would have had
  // run alone in that order. Concretely, for the three races below:
  //   (a) N concurrent `put`s of DIFFERENT content under the SAME runId — exactly one resolves,
  //       every other rejects `RunIdConflictError`, and the stored content is the winner's; no
  //       partially-inserted set is ever observable.
  //   (b) N concurrent `put`s of the SAME content under the same runId — ALL resolve (create-only
  //       and idempotent for identical content, §13.5), and the set is stored exactly once.
  //   (c) a `put` concurrent with `tombstoneTest(testId)` — the outcome may be either order, but
  //       it must be ONE of them: either the put linearizes first (it resolves AND the tombstone
  //       is set afterwards AND a LATER new put rejects TestDeletedError), or the tombstone
  //       linearizes first (the put rejects TestDeletedError AND nothing was inserted). The
  //       forbidden outcome is the mixed one: a rejected put that nevertheless stored something,
  //       or a resolved put whose set is absent.
  test(`${label}: concurrent puts of the same runId linearize to exactly one winner`, async () => {
    const store = makeStore();
    const KINDS = ['positives', 'completed-clean', 'completed-with-gaps', 'unreachable-positive'];
    const rivals = await Promise.all(KINDS.map((k) => withRunId('run-x', k)));   // same id, 4 contents
    const settled = await Promise.allSettled(rivals.map((s) => store.put(s)));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, 'exactly one writer wins');
    assert.ok(settled.filter((r) => r.status === 'rejected')
      .every((r) => r.reason instanceof RunIdConflictError), 'every loser sees RunIdConflictError');
    const stored = await store.get('run-x');
    assert.ok(rivals.some((s) => s.outcome.coverage === stored.outcome.coverage),
      'the stored content is one whole rival, never a blend');
    assert.equal((await store.list({})).summaries.filter((s) => s.runId === 'run-x').length, 1);
  });

  test(`${label}: concurrent identical puts are all idempotent successes`, async () => {
    const store = makeStore();
    const set = await withRunId('run-y', 'positives');
    const settled = await Promise.allSettled(
      [0, 1, 2, 3, 4].map(() => store.put(structuredClone(set))));
    assert.ok(settled.every((r) => r.status === 'fulfilled'), JSON.stringify(settled));
    assert.equal((await store.list({})).summaries.filter((s) => s.runId === 'run-y').length, 1);
  });

  test(`${label}: a put racing tombstoneTest lands on ONE side, never in between`, async () => {
    // Both interleavings are exercised by issuing them in both orders within one tick.
    for (const tombstoneFirst of [false, true]) {
      const store = makeStore();
      const set = await withRunId(`run-${tombstoneFirst}`, 'positives');
      const testId = set.testRef.testId;
      const calls = tombstoneFirst
        ? [store.tombstoneTest(testId), store.put(set)]
        : [store.put(set), store.tombstoneTest(testId)];
      const [, putResult] = tombstoneFirst
        ? await Promise.allSettled(calls)
        : [...await Promise.allSettled(calls)].reverse();

      assert.equal(await store.isTombstoned(testId), true, 'the tombstone always lands');
      const stored = await store.get(set.runId);
      if (putResult.status === 'fulfilled') {
        assert.ok(stored !== null, 'a resolved put must be visible (no lost write)');
      } else {
        assert.ok(putResult.reason instanceof TestDeletedError, String(putResult.reason));
        assert.equal(stored, null, 'a rejected put must have inserted nothing (no partial write)');
      }
      // Whichever way it linearized, a NEW insertion for that testId is refused from now on.
      await assert.rejects(store.put(await withRunId('later-run', 'positives')), TestDeletedError);
    }
  });

  // The reference store passes the three races trivially, because its whole check-and-insert runs
  // before its first `await` — which is exactly the property under test. So the suite also proves
  // it can FAIL a store that does not have that property, the same way the keyset probe proves it
  // can fail an offset-paging store. Without this, the three races above would be unfalsifiable.
  test(`${label}: a store that awaits between check and insert is caught as non-conforming`, async () => {
    const racy = makeYieldingStore();                 // one `await null` between the conflict check
    const rivals = await Promise.all([                // and the insert — a classic TOCTOU backend
      withRunId('run-z', 'positives'), withRunId('run-z', 'completed-clean')]);
    const settled = await Promise.allSettled(rivals.map((s) => racy.put(s)));
    assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 2,
      'the double-write is the defect this probe must expose');
    await assert.rejects(async () => runLinearizabilityProbe(makeYieldingStore), /non-conforming/);
  });
}
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/InMemoryResultStore.test.mjs` → module not found.
- [ ] **Step 3: Implement the store.**
```js
// clashtest/results/InMemoryResultStore.js
import { canonicalJson } from '../util/canonical.js';
import { validateResultSetSummary } from './validateResultSet.js';
import { RunIdConflictError, IdentityConflictError, TestDeletedError, TestArchivedError,
         ResultSetTooLargeError, CorruptListingError, InvalidOptionsError } from '../errors.js';

const LIST_DEFAULT_LIMIT = 100, LIST_MAX_LIMIT = 1000, CURSOR_PREFIX = 'v1:';
const byteLength = (s) => new TextEncoder().encode(s).length;

export function createInMemoryResultStore() {
  const sets = new Map();            // runId → {canonical, bytes, summary}
  const identity = new Map();        // modelKey → modelVersion
  const tombstones = new Set();

  // Review Important 3: the summary is built from the PARSED CANONICAL COPY, never from the
  // caller's object. Building it from `resultSet` kept `testRef`, `digests` and the model rows by
  // reference, so a caller mutating its own set after `put` changed future `list()` results while
  // `get()` still returned the stored content — the two store views would disagree.
  const summarize = (set, bytes) => ({
    runId: set.runId, testRef: set.testRef, status: set.outcome.status, coverage: set.outcome.coverage,
    integrity: set.outcome.integrity, environmentSensitive: set.outcome.environmentSensitive,
    counts: { results: set.results.length, units: set.ledger.units.length, pairSpaceTotal: set.ledger.pairSpaceTotal },
    serializedBytes: bytes, digests: set.digests,
    models: set.provenance.models.map((m) => ({ modelKey: m.modelKey, modelVersion: m.modelVersion })),
    startedAt: set.provenance.startedAt, finishedAt: set.provenance.finishedAt,
  });

  return {
    // NOTE: everything below runs BEFORE the first await, so the check-and-insert is one
    // indivisible step for every concurrent caller (§13.5 atomic AND linearizable).
    async put(resultSet, { signal } = {}) {
      const canonical = canonicalJson(resultSet);
      const existing = sets.get(resultSet.runId);
      if (existing !== undefined) {
        if (existing.canonical === canonical) return;                  // idempotent identical re-put
        throw new RunIdConflictError({ runId: resultSet.runId });
      }
      if (tombstones.has(resultSet.testRef.testId)) throw new TestDeletedError({ testId: resultSet.testRef.testId });
      for (const m of resultSet.provenance.models) {                   // check EVERY key before claiming ANY
        const claimed = identity.get(m.modelKey);
        if (claimed !== undefined && claimed !== m.modelVersion) {
          throw new IdentityConflictError({ modelKey: m.modelKey, claimed, offered: m.modelVersion });
        }
      }
      for (const m of resultSet.provenance.models) identity.set(m.modelKey, m.modelVersion);
      const bytes = byteLength(canonical);
      // The parse is the detach: every field of the summary — `testRef`, `digests`, the model rows,
      // the timestamps — comes from a graph the caller has no reference to (review Important 3).
      sets.set(resultSet.runId, { canonical, bytes, summary: summarize(JSON.parse(canonical), bytes) });
    },

    async tombstoneTest(testId) { tombstones.add(testId); },
    async isTombstoned(testId) { return tombstones.has(testId); },

    async get(runId, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
      const record = sets.get(runId);
      if (record === undefined) return null;
      if (record.bytes > maxBytes) throw new ResultSetTooLargeError({ runId });   // before any parse
      return JSON.parse(record.canonical);
    },

    async list({ testId, limit = LIST_DEFAULT_LIMIT, cursor, ...unknown } = {}) {
      if (Object.keys(unknown).length > 0) throw new InvalidOptionsError({ issues: [{ path: 'list', code: 'unknown-key' }] });
      if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX_LIMIT) {
        throw new InvalidOptionsError({ issues: [{ path: 'limit', code: 'out-of-range' }] });
      }
      let after = null;
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || !cursor.startsWith(CURSOR_PREFIX)) {
          throw new InvalidOptionsError({ issues: [{ path: 'cursor', code: 'bad-cursor' }] });
        }
        after = cursor.slice(CURSOR_PREFIX.length);
      }
      const keys = [...sets.keys()].sort()                             // code-unit order, unique tie-breaker
        .filter((k) => (after === null || k > after) && (testId === undefined || sets.get(k).summary.testRef.testId === testId));
      const page = keys.slice(0, limit).map((k) => structuredClone(sets.get(k).summary));
      const issues = page.flatMap((s) => validateResultSetSummary(s, {}).issues).slice(0, 20);
      if (issues.length > 0) throw new CorruptListingError({ issues });  // reject the page whole
      return keys.length > limit
        ? { summaries: page, next: CURSOR_PREFIX + page[page.length - 1].runId }
        : { summaries: page };
    },

    async delete(runId) { sets.delete(runId); },                       // identity index is NEVER cleared
  };
}
```
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/InMemoryResultStore.test.mjs` → conformance suite + 6 reference tests passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): in-memory ResultStore with byte guard and conformance suite (P5.7)`

---

### Task P5.8: Residency, slots and the persistence attempt state machine

**Files**
- Create: `clashtest/results/residency.js`
- Test: `test/clashtest/results/residency.test.mjs`

**Interfaces**

*Consumes:* `options.js` → `ENGINE_LIMIT_DEFAULTS.{maxResidentResultSets, maxQueuedRuns, maxConcurrentStoreReads, maxQueuedStoreReads}` (P0); `errors.js` → `ResultCapacityError`, `ResultSetRetainedError`, `UnsavedResultSetError`, `ResultNotResidentError`, `ReadCapacityError`, `RunNotTerminalError`, `PersistenceOutcomeUnknownError` (P0, added by this phase if absent).

*Produces:* `createResidencyManager`, `createReadCoordinator`.

*Consumed by:* P6 (`run/Run.js` wires `done`/`persisted`/the `'persistence'` event to `onPersistence`; the one-shot promise contract is P6's, the *state* is P5's) and P7 (`retentionReport`, `dispose`).

- [ ] **Step 1: Write the failing residency test.**
```js
// test/clashtest/results/residency.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResidencyManager, createReadCoordinator } from '../../../clashtest/results/residency.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { ResultCapacityError, ResultSetRetainedError, UnsavedResultSetError, ResultNotResidentError, ReadCapacityError, PersistenceOutcomeUnknownError } from '../../../clashtest/errors.js';
import { sealedSet, withRunId } from '../../support/resultSetFixtures.mjs';

const mgr = (over = {}) => createResidencyManager({
  limits: { maxResidentResultSets: 2, maxQueuedRuns: 1, maxConcurrentStoreReads: 1, maxQueuedStoreReads: 2 },
  resultStore: createInMemoryResultStore(), now: () => Date.now(), onPersistence: () => {}, ...over });

test('slots count active runs plus resident sets and refuse rather than queue', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.reserveRunSlot('b');
  assert.throws(() => m.reserveRunSlot('c'), ResultCapacityError);
  const e = (() => { try { m.reserveRunSlot('c'); } catch (err) { return err; } })();
  assert.deepEqual(e.active, ['a', 'b']);
  assert.equal(e.cap, 2);
  m.admitSealedSet('a', await withRunId('a', 'positives'));           // sealing never needs a NEW slot
  assert.equal(m.retentionReport().slotsInUse, 2);
});

test('a saved set is evictable LRU; held and retained sets never are', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  assert.equal(m.getPersistenceState('a').state, 'saved');
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });                       // skipped ⇒ held
  m.reserveRunSlot('c');                                               // evicts 'a', the only evictable set
  assert.equal(m.getResident('a'), null);
  assert.equal(m.getPersistenceState('a'), null);                      // nonresident ⇒ null, never a throw
  assert.equal(m.getResident('b') !== null, true);
});

test('eviction is by last TOUCH, not by seal order: a touched older set survives', async () => {
  const clock = { t: 0, now() { return this.t; } };
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => clock.now(), onPersistence: () => {} });
  for (const id of ['old', 'new']) {
    clock.t += 10;
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });                 // both saved ⇒ both evictable
  }
  clock.t += 10;
  m.touch('old');                                                // 'old' sealed first but is used often
  m.reserveRunSlot('third');                                     // needs room for one
  assert.equal(m.getResident('old') !== null, true, 'the touched set survived');
  assert.equal(m.getResident('new'), null, 'the least recently touched one went');
});

test('a stopped clock still gives a total eviction order (sequence tie-break)', async () => {
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1, onPersistence: () => {} });  // time never moves
  for (const id of ['a', 'b']) {
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });
  }
  m.touch('a');
  m.reserveRunSlot('c');
  assert.equal(m.getResident('a') !== null, true);
  assert.equal(m.getResident('b'), null);
});

test('reporting never changes eviction order', async () => {
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1, onPersistence: () => {} });
  for (const id of ['a', 'b']) {
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });
  }
  m.retentionReport(); m.getPersistenceState('a');               // must NOT pin 'a'
  m.reserveRunSlot('c');
  assert.equal(m.getResident('a'), null, "'a' was still the least recently touched");
});

test('retain/release/discard are the only ways a set leaves', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const lease = m.retainResultSet('a');
  assert.throws(() => m.releaseResultSet('a', {}), ResultSetRetainedError);
  lease.release();
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });
  assert.throws(() => m.releaseResultSet('b', {}), UnsavedResultSetError);
  m.releaseResultSet('b', { acknowledgeUnsaved: true });
  assert.equal(m.getResident('b'), null);
  m.releaseResultSet('b', { acknowledgeUnsaved: true });                // idempotent no-op
  assert.throws(() => m.retainResultSet('b'), ResultNotResidentError);
});

test('an ambiguous store outcome settles failed/ambiguous and retryPersist is idempotent', async () => {
  const store = createInMemoryResultStore();
  const set = await withRunId('a', 'positives');
  let first = true;
  const flaky = { ...store, async put(s, o) { await store.put(s, o); if (first) { first = false; throw new PersistenceOutcomeUnknownError(); } } };
  const m = mgr({ resultStore: flaky });
  m.reserveRunSlot('a'); m.admitSealedSet('a', set);
  const outcome = await m.beginPersist('a', { persist: true });
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.error.ambiguous, true);
  assert.equal(m.getPersistenceState('a').state, 'failed');             // held: never auto-evicted
  const retry = await m.retryPersist('a');                              // the set already committed
  assert.equal(retry.state, 'saved');                                   // idempotent create-only put
  assert.equal(m.getPersistenceState('a').attempt, 2);
});

test('persistence state never changes the sealed set and is reported once per attempt', async () => {
  const seen = [];
  const m = mgr({ onPersistence: (e) => seen.push(e) });
  m.reserveRunSlot('a');
  const set = await withRunId('a', 'positives');
  m.admitSealedSet('a', set);
  await m.beginPersist('a', { persist: true });
  assert.deepEqual(seen.map((e) => [e.runId, e.state, e.attempt]), [['a', 'saved', 1]]);
  assert.equal(Object.isFrozen(m.getResident('a')), true);
  assert.equal('persistence' in m.getResident('a'), false);
});

// --- review Important 4: lease tokens are one-shot --------------------------------------------
test('a double release decrements once: the set stays retained and unevictable', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const clientA = m.retainResultSet('a');
  const clientB = m.retainResultSet('a');            // two INDEPENDENT leases on one set
  clientA.release();
  clientA.release();                                 // the naive counter would now read 0
  clientA.release();
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').leases, 1, 'exactly one decrement');
  assert.throws(() => m.releaseResultSet('a', {}), ResultSetRetainedError, "B's lease is still live");
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').class, 'retained');

  // The eviction path agrees: 'a' must NOT be the victim while B holds it. 'b' is deliberately
  // HELD (`persist: false`), because a SAVED 'b' would simply be evicted and prove nothing —
  // the refusal only exercises the retained set when NOTHING is evictable.
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });     // skipped ⇒ held ⇒ never auto-evictable
  assert.throws(() => m.reserveRunSlot('c'), ResultCapacityError, 'nothing evictable: refuse');
  assert.equal(m.getResident('a') !== null, true, 'the retained set survived');
  assert.equal(m.getResident('b') !== null, true, 'and the held set was never dropped');

  clientB.release();                                 // now, and only now, 'a' is evictable
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').class, 'evictable');
});

test('eviction between releases, and a release after explicit removal, are both safe', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const lease = m.retainResultSet('a');
  lease.release();                                   // 'a' becomes evictable …
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: true });
  m.reserveRunSlot('c');                             // … and is evicted here
  assert.equal(m.getResident('a'), null);
  lease.release();                                   // a spent token on an evicted entry: no-op
  assert.equal(m.getResident('b') !== null, true, 'the surviving set is untouched');

  // A release after an EXPLICIT removal is equally inert, and cannot corrupt a re-admitted runId.
  const m2 = mgr();
  m2.reserveRunSlot('x'); m2.admitSealedSet('x', await withRunId('x', 'positives'));
  await m2.beginPersist('x', { persist: true });
  const stale = m2.retainResultSet('x');
  stale.release();
  m2.releaseResultSet('x', {});
  assert.equal(m2.getResident('x'), null);
  m2.reserveRunSlot('x'); m2.admitSealedSet('x', await withRunId('x', 'positives'));
  await m2.beginPersist('x', { persist: true });
  stale.release();                                   // the OLD token, against a NEW entry
  assert.equal(m2.retentionReport().sets.find((s) => s.runId === 'x').class, 'evictable',
    'the stale token did not drive the new entry negative');
  const fresh = m2.retainResultSet('x');
  assert.equal(m2.retentionReport().sets.find((s) => s.runId === 'x').class, 'retained');
  fresh.release();
});

// --- P6 re-verification finding 8 (P5-owned): admitSealedSet is atomic and exception-safe -------
test('admitSealedSet either converts the reservation fully or changes nothing', async () => {
  const set = await withRunId('a', 'positives');

  // (1) failure BEFORE any mutation — no reservation at all.
  const m1 = mgr();
  assert.throws(() => m1.admitSealedSet('a', set), ResultNotResidentError);
  assert.equal(m1.reservationHeld('a'), false);
  assert.equal(m1.getResident('a'), null);
  assert.equal(m1.retentionReport().slotsInUse, 0, 'no slot was consumed by the failure');

  // (2) failure before mutation WITH a reservation held — the reservation must survive intact.
  const m2 = mgr();
  m2.reserveRunSlot('a');
  assert.equal(m2.reservationHeld('a'), true);
  for (const bad of [null, undefined, {}, { sealed: false }, 'set']) {
    assert.throws(() => m2.admitSealedSet('a', bad),
      (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_SEALED', String(bad));
    assert.equal(m2.reservationHeld('a'), true, `${String(bad)}: reservation still held`);
    assert.equal(m2.getResident('a'), null);
    assert.equal(m2.retentionReport().slotsInUse, 1, 'exactly one slot, still the reservation');
  }
  m2.admitSealedSet('a', set);                       // and it still works afterwards
  assert.equal(m2.reservationHeld('a'), false, 'converted: no longer a reservation');
  assert.equal(m2.getResident('a') !== null, true);
  assert.equal(m2.retentionReport().slotsInUse, 1, 'the slot was CONVERTED, never doubled');

  // (3) failure AFTER the internal mutation is impossible by construction — a second admission of
  // an already-resident id is refused in the validation phase and leaves the resident entry alone.
  assert.throws(() => m2.admitSealedSet('a', set), ResultNotResidentError);
  assert.equal(m2.getResident('a') !== null, true, 'the resident entry is untouched');
  assert.equal(m2.retentionReport().slotsInUse, 1);
});

test('a throwing observer never turns a completed admission into a failure', async () => {
  const thrown = [];
  const m = createResidencyManager({
    limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1,
    onPersistence: (e) => { thrown.push(e); throw new Error('observer exploded'); },
  });
  m.reserveRunSlot('a');
  m.admitSealedSet('a', await withRunId('a', 'positives'));   // must NOT throw
  assert.equal(m.getResident('a') !== null, true, 'the set is resident');
  assert.equal(m.reservationHeld('a'), false, 'and the reservation was converted');
  assert.ok(thrown.length > 0, 'the observer really did run and really did throw');

  // The same isolation on the persistence path: the attempt still settles and is still reported.
  const outcome = await m.beginPersist('a', { persist: true });
  assert.equal(outcome.state, 'saved');
  assert.equal(m.getPersistenceState('a').state, 'saved');
});

test('reservationHeld answers P6 recovery without guessing, and never throws', async () => {
  const m = mgr();
  assert.equal(m.reservationHeld('unknown'), false);
  m.reserveRunSlot('a');
  assert.equal(m.reservationHeld('a'), true);
  m.releaseRunSlot('a');
  assert.equal(m.reservationHeld('a'), false, 'released ⇒ false');
  m.reserveRunSlot('b');
  m.admitSealedSet('b', await withRunId('b', 'positives'));
  assert.equal(m.reservationHeld('b'), false, 'resident ⇒ false, not a reservation any more');
});

test('read slots: raw-set reservations reject immediately, by-id reads queue FIFO', async () => {
  const c = createReadCoordinator({ limits: { maxConcurrentStoreReads: 1, maxQueuedStoreReads: 1 } });
  const held = c.reserveSync();
  assert.throws(() => c.reserveSync(), ReadCapacityError);
  const queued = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError);                 // queue depth 1 exceeded
  held.release();
  (await queued).release();
  assert.equal(c.inUse(), 0);
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/residency.test.mjs` → module not found.
- [ ] **Step 3: Implement `residency.js`.** Core rules, in code:
```js
// clashtest/results/residency.js (core)
const classOf = (entry) => entry.leases > 0 ? 'retained'
  : entry.persistence.state === 'saved' ? 'evictable' : 'held';

export function createResidencyManager({ limits, resultStore, now, onPersistence }) {
  const active = new Map();      // runId → true (slot held by a run in flight)
  const resident = new Map();    // runId → {resultSet, sealedAt, lastTouchedAt, touchSeq,
                                 //          leases, persistence, writeInFlight}
  const slots = () => active.size + resident.size;

  const snapshot = (e) => ({ state: e.persistence.state, timedOut: false, attempt: e.persistence.attempt,
                             ...(e.persistence.error ? { error: e.persistence.error } : {}) });

  // True LRU: least-recently-TOUCHED, not least-recently-sealed. `touchSeq` is a manager-wide
  // monotonic counter, so a fake clock that never advances still gives a total, deterministic
  // order — and so `touch(runId)` has a defined effect, which the spec's "evictable LRU" requires.
  let touchSeq = 0;
  const touch = (runId) => {
    const e = resident.get(runId);
    if (e === undefined) return false;
    e.lastTouchedAt = now();
    e.touchSeq = ++touchSeq;
    return true;
  };
  const lessRecent = (a, b) => a.lastTouchedAt !== b.lastTouchedAt
    ? a.lastTouchedAt < b.lastTouchedAt : a.touchSeq < b.touchSeq;

  function makeRoom() {
    if (slots() < limits.maxResidentResultSets) return;
    let lru = null;
    for (const [runId, e] of resident) {
      if (classOf(e) !== 'evictable') continue;
      if (lru === null || lessRecent(e, resident.get(lru))) lru = runId;
    }
    if (lru === null) {
      throw new ResultCapacityError({ cap: limits.maxResidentResultSets, active: [...active.keys()],
        retained: [...resident].filter(([, e]) => classOf(e) === 'retained').map(([id]) => id),
        held: [...resident].filter(([, e]) => classOf(e) === 'held').map(([id, e]) => ({ runId: id, persistence: e.persistence.state })) });
    }
    resident.delete(lru);
  }

  async function attempt(runId, entry) {
    entry.persistence = { state: 'pending', attempt: entry.persistence.attempt + 1, error: null };
    entry.writeInFlight = true;
    try {
      await resultStore.put(entry.resultSet, { signal: entry.abort.signal });
      entry.persistence = { ...entry.persistence, state: 'saved', error: null };
    } catch (err) {
      // G-REMOTE narrowing: an UNKNOWN outcome settles `failed` with cause `ambiguous`; there is no
      // reconciliation read in this build (master §1.2). `put` is create-only and idempotent, so
      // `retryPersist` is safe whichever the truth was.
      const ambiguous = err instanceof PersistenceOutcomeUnknownError;
      entry.persistence = { ...entry.persistence, state: 'failed',
        error: { name: err.name, message: err.message, ...(ambiguous ? { ambiguous: true } : {}) } };
    } finally { entry.writeInFlight = false; }
    const outcome = snapshot(entry);
    onPersistence({ runId, ...outcome });
    return outcome;
  }
  // --- observer isolation (P6 re-verification finding 8) ---------------------------------------
  // Every observer call goes through here, ALWAYS after the state transition is complete. A
  // throwing observer can never turn a completed operation into an apparent failure.
  const notify = (event) => { try { onPersistence(event); } catch { /* isolated, by contract */ } };

  // --- reservations --------------------------------------------------------------------------
  const reservationHeld = (runId) => active.has(runId);      // never throws, incl. for unknown ids

  /** ATOMIC AND EXCEPTION-SAFE (P6 re-verification finding 8 / its question 1). Everything that
   *  can fail runs BEFORE the first mutation; after it, only infallible map writes remain. So the
   *  caller's rule is simple and needs no guessing: it either fully converted the reservation, or
   *  it threw and `reservationHeld(runId)` is still true. */
  function admitSealedSet(runId, resultSet) {
    // ---- validation phase: no state has been touched yet ----
    if (!active.has(runId)) throw new ResultNotResidentError({ runId });
    if (resident.has(runId)) throw new ResultNotResidentError({ runId });   // double admission
    if (resultSet === null || typeof resultSet !== 'object' || resultSet.sealed !== true) {
      const err = new TypeError('admitSealedSet: only a sealed Result Set may become resident');
      err.code = 'ERR_RESULT_SET_NOT_SEALED';
      throw err;
    }
    const entry = {                                 // built fully before anything is published
      resultSet, sealedAt: now(), lastTouchedAt: now(), touchSeq: ++touchSeq, leases: 0,
      persistence: { state: 'pending', attempt: 0, error: null },
      writeInFlight: false, abort: new AbortController(),
    };
    // ---- mutation phase: infallible from here ----
    active.delete(runId);                           // sealing converts the run's OWN slot, so this
    resident.set(runId, entry);                     // pair never needs `makeRoom` (§13.5.2)
    // ---- observers: after the transition, isolated ----
    notify({ runId, state: entry.persistence.state, attempt: 0, timedOut: false });
  }

  // --- retain leases are ONE-SHOT (review Important 4) -----------------------------------------
  // Each call mints a FRESH token that decrements exactly once. A second `release()` on the same
  // token is a no-op — never a second decrement — so a double release can never under-count live
  // leases and make a still-retained set evictable.
  function retainResultSet(runId) {
    const entry = resident.get(runId);
    if (entry === undefined) throw new ResultNotResidentError({ runId });
    if (entry.persistence.state !== 'saved') throw new UnsavedResultSetError({ runId });
    entry.leases += 1;
    touch(runId);
    let spent = false;                              // the whole one-shot rule, in one flag
    return { release() {
      if (spent) return;                            // idempotent: later calls do nothing
      spent = true;
      entry.leases -= 1;                            // the entry, even if no longer resident:
      touch(runId);                                 // the count it guards is the entry's own
    } };
  }
}
```
Three consequences of the token holding `entry` rather than `runId` are worth naming, because each is a test below: a token released **after** its entry was evicted or discarded decrements the (now unreferenced) entry and touches nothing — it cannot corrupt a *new* entry that later reuses the same `runId`; two independent leases need two releases; and `classOf` reads `entry.leases > 0`, so the count is exact at every moment.

**Verified by execution.** These three functions plus `makeRoom`/`classOf` were extracted to scratch with stub errors and run against the five tests below. That run corrected one of them: the "a retained set is never the eviction victim" case originally made the *other* resident set `saved`, so `reserveRunSlot` simply evicted **that** set and never reached the refusal — proving nothing about the retained one. The other set must be `held` for the refusal to be the thing under test. **5 / 5 checks pass** after the correction.
**Which operations touch a set** (each calls the private `touch(runId)` above, exactly once): `admitSealedSet` (admission is a use), `getResident`, `retainResultSet` **and** the `release()` it returns, `beginPersist` and `retryPersist` when the attempt settles, and the public `touch(runId)`. Deliberately **not** touching: `retentionReport()`, `getPersistenceState` and `drainForDispose` — reporting must never change eviction order, or a Panel that polls the report would pin whatever it looked at last. `releaseResultSet`/`discardRun` remove the entry, so touching is moot.

`beginPersist(runId, {persist})` settles `{state: 'skipped', reason: persist === false ? 'persist-false' : 'no-store'}` immediately when there is no store or `persist === false`. `retryPersist` is legal **only** from `failed`: a nonresident id throws `ResultNotResidentError`, and a resident set in any other state throws `InvalidOptionsError{issues:[{path:'runId',code:'not-failed'}]}` (see *Gates and open items* item 6 — the spec names no error for this case). `discardRun(runId)` chains `resultStore.delete(runId)` after any in-flight write settles and frees the slot only then. `createReadCoordinator` is a counter plus a FIFO array: `reserveSync()` returns a slot or throws `ReadCapacityError{limit}`; `acquire()` returns the slot immediately, queues up to `maxQueuedStoreReads`, else rejects `ReadCapacityError{limit}`.
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/residency.test.mjs` → 14 passing.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `feat(clashtest): resident bound and persistence attempt state (P5.8)`

---

### Task P5.9: Writer → reader round trip across all five terminal shapes

**Files**
- Modify: `test/clashtest/support/resultSetFixtures.mjs` (the fake-run builder gains all five shapes)
- Test: `test/clashtest/results/roundTrip.test.mjs`

**Interfaces**

*Consumes:* every P5 export plus `options.js` defaults. No production code is added by this task — it is the phase's acceptance harness and may only *reveal* defects in P5.1–P5.8.

- [ ] **Step 1: Write the failing round-trip test.**
```js
// test/clashtest/results/roundTrip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createResidencyManager } from '../../../clashtest/results/residency.js';
import { readResultSet, validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { assessNoClashClaim, canClaimNoClashes } from '../../../clashtest/results/claim.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { sealFakeRun, fakeSlicer } from '../../support/resultSetFixtures.mjs';

const KINDS = ['completed-clean', 'completed-with-gaps', 'cancelled-pre-resolution', 'failed', 'invalidated'];
const limits = ENGINE_LIMIT_DEFAULTS;

test('put → evict → read → validate preserves the claim outcome for every terminal shape', async () => {
  for (const kind of KINDS) {
    const store = createInMemoryResultStore();
    const m = createResidencyManager({ limits: { ...limits, maxResidentResultSets: 1 }, resultStore: store,
      now: () => 1, onPersistence: () => {} });
    const sealed = await sealFakeRun(kind);
    m.reserveRunSlot(sealed.runId);
    m.admitSealedSet(sealed.runId, sealed);
    assert.equal((await m.beginPersist(sealed.runId, { persist: true })).state, 'saved', kind);
    const before = assessNoClashClaim(sealed, 'current');

    m.releaseResultSet(sealed.runId, {});                              // evict the saved copy
    assert.equal(m.getResident(sealed.runId), null, kind);

    const raw = await store.get(sealed.runId, { maxBytes: limits.maxStoredResultBytes });
    const read = await readResultSet(raw, { limits, slicer: fakeSlicer() });
    assert.deepEqual(validateResultSet(read, { limits }), { ok: true, issues: [] }, kind);
    assert.deepEqual(assessNoClashClaim(read, 'current'), before, kind);
    assert.equal(canClaimNoClashes(read, 'current'), canClaimNoClashes(sealed, 'current'), kind);
    assert.deepEqual(read.digests, sealed.digests, kind);
    assert.equal(Object.isFrozen(read), true, kind);
    assert.equal(JSON.stringify(read.results), JSON.stringify(sealed.results), kind);
  }
});

test('only the clean completed shape can ever claim', async () => {
  for (const kind of KINDS) {
    const sealed = await sealFakeRun(kind);
    assert.equal(canClaimNoClashes(sealed, 'current'), kind === 'completed-clean', kind);
  }
});

test('a deep scan of every sealed shape finds no forbidden value', async () => {
  for (const kind of KINDS) {
    const stack = [await sealFakeRun(kind)];
    while (stack.length) {
      const v = stack.pop();
      if (v === null) continue;
      if (typeof v === 'number') { assert.ok(Number.isFinite(v), kind); continue; }
      if (typeof v === 'function' || v instanceof Map || v instanceof Set) assert.fail(`${kind}: forbidden value`);
      if (typeof v !== 'object') continue;
      for (const k of Object.keys(v)) { assert.notEqual(v[k], undefined, `${kind}.${k}`); stack.push(v[k]); }
    }
  }
});

test('a forged set with recomputed digests is still rejected on its semantics', async () => {
  const sealed = await sealFakeRun('completed-clean');
  const forged = structuredClone(sealed);
  forged.ledger.units[0].outcome = 'failed';                            // coverage still says full
  await assert.rejects(readResultSet(forged, { limits, slicer: fakeSlicer() }),
    (e) => e.name === 'CorruptResultSetError' && e.issues.some((i) => i.code === 'coverage-not-full'));
});
```
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/results/roundTrip.test.mjs` → the fixture builder lacks `sealFakeRun` for the five shapes.
- [ ] **Step 3: Extend the fixture builder.** `sealFakeRun(kind)` drives the real pipeline — `createResultAccumulator` over fake `UnitOutcome`s → `deriveRunOutcome` → `buildResultSet` → `sealResultSet` — so the fixtures are *produced*, never hand-written:

| kind | status | ledger | results | claim |
|---|---|---|---|---|
| `completed-clean` | `completed` | plan, 2 evaluated leaves, `pairSpaceTotal: 12`, no gaps/taints | `[]` | allowed |
| `completed-with-gaps` | `completed` | 1 evaluated leaf + 1 `failed:capacity-exceeded` leaf, `coverage: partial` | 1 positive from the evaluated leaf | blocked (`coverage`) |
| `cancelled-pre-resolution` | `cancelled` | `planExists: false`, `units: []`, planning gap `{phase: 'queued', cause: 'cancelled'}`, `definition: null`, `testRef.semanticDigest: null` | `[]` | blocked (`status`, `coverage`, `pairSpaceTotal`) |
| `failed` | `failed` | planning gap `{phase: 'planning', cause: 'plan-too-large'}` | `[]` | blocked (`status`) |
| `invalidated` | `invalidated` | 1 evaluated leaf retained + 1 `discarded:scope-drift` leaf, `freshness: 'stale'` at seal | 1 positive | blocked (`status`, `coverage`) |

**Plus one non-terminal fixture kind, `schema-corpus`** (added by the review Critical 3 remediation; not one of the five terminal shapes and not part of `KINDS`). Its only job is to make **every optional branch of the structural schema reachable**, so the anti-drift test in P5.5 has nothing to waive but the four genuinely shapeless fields. It is a valid `completed` set that additionally carries: `provenance.hierarchyInternalAcceptance` and `provenance.environment` (both optional), a non-empty `libraryExclusions`, `ledger.unresolvedSelections`, `ledger.unreachablePopulation` (with `mixedOwnerDbIds` and a non-zero `unattributable`), `ledger.hierarchyInternal` with a non-empty `examples`, `ledger.planningGaps`, `ledger.warnings` (with the optional `modelKey`), `ledger.exclusions`, a result carrying **all four** `flags`, a **second result in `clearance` mode** (the other evidence shape, so `ClearanceEvidence`/`ClosestPoints` are reachable), and a **`scope: 'pair'` diagnostic** carrying `fragments` and `ambiguousModelId`. Verified in scratch: with `positives` + `schema-corpus`, **171 schema rows, 1,578 generated mutations, 0 unreachable rows, every mutation caught**.

- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/results/roundTrip.test.mjs` → 4 tests passing, each looping over all **five** `KINDS` (the count of `test(...)` blocks and the count of terminal shapes are different numbers; the earlier draft conflated them).
- [ ] **Step 5: Run the whole phase and the repository suite.** `node --test test/clashtest/results/*.test.mjs` then `npm test` — both green, no server, no credentials, no network.
- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).** `test(clashtest): writer→reader round trip across terminal shapes (P5.9)`

---

## Verification / acceptance for P5

Run from the repository root. Each line is a named test file and the spec AC it carries.

- [ ] `node --test test/clashtest/results/resultSet.merge.test.mjs` — projection carries `mode` and never `type` (errata E1–E3), evidence re-keying, `-0` normalization, canonical order, whole-unit result cap, reconciliation by explicit plan rank. **AC-11** (serialization/`-0`), **AC-4** partition-independence inputs.
- [ ] `node --test test/clashtest/results/resultSet.identity.test.mjs` — the projection against **P1's real `identity/ids.js`**: `makePairId(mode, x, y)` arity and orientation for all four modes, `makeResultId`, `comparePairIds`, `elementRefKey`, and that no `pairSemantics` value is ever stored. A rename in P1 fails here, not at integration.
- [ ] `node --test test/clashtest/results/resultSet.outcome.test.mjs` — the three axes and `environmentSensitiveCauses`. **AC-19** (epoch-cache state recorded as an explicit cause), **AC-10** (integrity from the diagnostics upper bound).
- [ ] `node --test test/clashtest/results/resultSet.seal.test.mjs` — deep freeze, structured-clone/JSON semantic equality, digest scope and stability, pre-resolution seal. **AC-11** (immutability, serialization).
- [ ] `node --test test/clashtest/results/claim.test.mjs` — the conjunct-by-conjunct truth table, required `currentFreshness`, `results = ∅` (R19-2), acceptance ⇒ qualified-only, and the **digest-version conjunct on an empty-results, otherwise-claimable set** (review Critical 2). **AC-8**, **AC-20**.
- [ ] `node --test test/clashtest/results/status.test.mjs` — the **reader complexity acceptance test** (linear build, lookup cost independent of the unit count, `elementStatus` visiting only the units that touch the element), the seven taint-rule clauses, the benign-`witness-unavailable` filter (reported, not downgrading), `not-required` for hierarchy-internal and unreachable-only owners, `undetermined` with `required: null` for a foreign owner, a mixed owner still *required*, all five exports (`createStatusReader`, `buildStatusReaderSteps`, `readLedger`), frozen-only index reuse, and hierarchy-internal element status from the persisted `cls` with an empty `examples` list. **AC-17**, **AC-20(c)**.
- [ ] `node --test test/clashtest/results/validateResultSet.capture.test.mjs` — capture-first detachment, `schemaVersion` first, accessor/symbol/cyclic/not-plain/hole rejection with no getter invoked, schema ceiling vs reader limit, migration admissibility as a **range check** (an invalid version stays invalid with a migration registered; the dispatcher proven with an injected higher current version), the unknown-field budget **charged mid-traversal so the tail is never copied**, no native `structuredClone`. **AC-11** (untrusted read, capture-first).
- [ ] `node --test test/clashtest/results/validateResultSet.invariants.test.mjs` — the **generated structural-schema suite** (one mutation per violation class per reachable field, plus the anti-drift reachability assertion), the named malformed-value examples, the uncaptured-input precondition, every cross-field rule-table row, completed-with-gaps round trip (R20-3), result↔leaf-unit linkage (R21-4), `unreachableOwner` positives (R14-1), open-field preservation, rejection as a *rejected promise*, forged-set limit. **AC-11**.
- [ ] `node --test test/clashtest/results/InMemoryResultStore.test.mjs` — create-only idempotent `put`, all-or-nothing identity index across runIds, tombstone reservation, byte guard with no materialization, copy-on-write/read **with `get` and `list` agreeing after the caller mutates `testRef`/`digests`/model rows/timestamps**, keyset listing and cursor validation, the conformance suite (incl. the deliberately non-conforming offset store, the **concurrent `put`/`tombstoneTest` linearizability races** and the yielding store that must fail them, and the non-materializing byte guard). **AC-11**, **AC-16** (identity).
- [ ] `node --test test/clashtest/results/residency.test.mjs` — slot accounting, LRU eviction of `evictable` only, `held`/`retained` never evicted, nonresident `getPersistenceState = null`, ambiguous ⇒ `failed`+`ambiguous`, idempotent `retryPersist`, read-slot reserve-or-reject, **one-shot lease tokens** (double release, two independent leases, eviction between releases, release after explicit removal), **`admitSealedSet` atomicity** (failure before mutation with and without a reservation, refused double admission, throwing observer) and **`reservationHeld`**. **AC-16**, **AC-11** (persistence states).
- [ ] `node --test test/clashtest/results/roundTrip.test.mjs` — produce → persist → evict → read → validate with an identical claim outcome for all five shapes; forged/corrupt rejected; no forbidden value anywhere. **AC-11**, **AC-15** prerequisite (the T3 live acceptance reuses these fixtures in P7).
- [ ] `npm test` — the full repository suite is green from a clean checkout.
- [ ] `docs/handoffs/latest.md` updated from the verified final state (project CLAUDE.md), reporting branch, HEAD and git status.

### Validation-rule traceability

One row per row of the **Validation rule table** (P5.5) plus the two writer-side invariants a reader re-checks, each naming the test that carries it. A rule with no named test is a rule that is not verified — this table exists so that claim is checkable rather than asserted.

| Rule / `code` | Named test |
|---|---|
| **every structural-schema row** (`missing-field`, `null-not-allowed`, `type-invalid`, `container-invalid`, `enum-invalid`, `number-out-of-range`, `string-too-long`, `array-too-long`, `array-length-invalid`, `duplicate-*`, `literal-invalid`, `not-sealed`, `digest-syntax-invalid`) | `validateResultSet.invariants` — *every reachable structural-schema row rejects its own violation* (generated from `TYPES`) + *every declared schema field is reachable* (anti-drift) + *the named malformed-value examples each get their own code* |
| `validateResultSet` is not the untrusted boundary | `validateResultSet.invariants` — *validateResultSet refuses an uncaptured object instead of traversing it* |
| unknown field in an open type preserved verbatim, digests unchanged | `validateResultSet.invariants` — *an open-type unknown field survives verbatim with equal digests* |
| `unknown-field-bytes` charged **during capture**, before allocation | `validateResultSet.capture` — *the unknown-field budget is charged mid-traversal: later values are never copied* + *unknown fields in open types are budgeted together; a closed type never budgets at all* |
| `unknown-field-bytes` defensive re-check on the copy | `validateResultSet.invariants` — *the defensive unknown-field re-check is charged over ALL open types together* (+ the `CORRUPTIONS` row) |
| migration admissibility is a range check, not a table lookup | `validateResultSet.capture` — *an invalid schemaVersion stays invalid even with a migration registered under that key* + *applyMigration is single-hop* (injected higher current version) |
| digest-version conjunct of the claim predicate | `claim` — *an unknown digestVersion blocks the claim on an otherwise claimable EMPTY-results set* (+ the `FLIPS` row) + `validateResultSet.invariants` — *an unknown digestVersion is NOT compared* |
| status-reader build `O(units + rows + results)`, lookup `O(1)`/bounded | `status` — *reader build is linear in units and lookup cost does not grow with the unit count* + *elementStatus visits only the units that touch the element* |
| store summary built from the canonical copy (`get` and `list` agree) | `InMemoryResultStore` — *put and get copy in both directions, and the LISTING agrees with get* |
| `put` / `tombstoneTest` linearizability under concurrency | `resultStoreConformance` — *concurrent puts of the same runId linearize to exactly one winner* · *concurrent identical puts are all idempotent successes* · *a put racing tombstoneTest lands on ONE side* · *a store that awaits between check and insert is caught as non-conforming* |
| lease tokens are one-shot | `residency` — *a double release decrements once* + *eviction between releases, and a release after explicit removal, are both safe* |
| `admitSealedSet` is atomic, exception-safe and observer-isolated; `reservationHeld` | `residency` — *admitSealedSet either converts the reservation fully or changes nothing* + *a throwing observer never turns a completed admission into a failure* + *reservationHeld answers P6 recovery without guessing* |
| `addUnit` is transactional; `canAdmitUnit` is non-mutating | `resultSet.merge` — *canAdmitUnit answers the same as addUnit and mutates nothing* |
| `unknown-field-closed-type` | `CORRUPTIONS` row (`results[0].type`, errata E1) |
| `definition-invalid` | `CORRUPTIONS` row (embedded definition mutated to fail `validateTest`) |
| `root-cls-invalid` | `CORRUPTIONS` rows (absent `cls`; `cls: 'X'`) |
| `definition-digest-mismatch` | `CORRUPTIONS` row |
| `coverage-not-full` (no plan / gap / no leaf / non-`evaluated` / non-`equal` leaf) | `CORRUPTIONS` rows + `resultSet.outcome` — *an evaluated leaf whose scope was not proven equal* + `roundTrip` — *a forged set with recomputed digests* |
| `completed-with-fatal-cause` | `CORRUPTIONS` row |
| non-fatal unit gaps accepted with `coverage: 'partial'` | `validateResultSet.invariants` — *completed-with-gaps keeps its non-fatal causes* (all 9 gap kinds) |
| `pair-space-inconsistent` | `CORRUPTIONS` rows (`emptyOperand` with `pairSpaceTotal > 0`; `pairSpaceTotal ≠ Σ` leaf weight) |
| `owner-not-in-ledger` | `CORRUPTIONS` row + *unreachableOwner positives stay valid on readback* |
| `unreachable-flag-invalid` | `CORRUPTIONS` row |
| `result-id-mismatch` | `CORRUPTIONS` row (`resultId` rewritten) |
| `result-unit-invalid` | `CORRUPTIONS` row (`unitId: 'no-such-unit'`) |
| `result-unit-coverage` | `CORRUPTIONS` rows (source roots moved; target roots moved) |
| `evaluated-as-mismatch` | `CORRUPTIONS` row |
| `mode-mismatch` | `CORRUPTIONS` row |
| `model-not-in-provenance` | `CORRUPTIONS` row (`provenance.models` filtered) |
| `result-order` / `duplicate-result-id` | `CORRUPTIONS` rows |
| `digest-mismatch` | `validateResultSet.invariants` — *a tampered digest is caught* |
| unknown `digestVersion` not compared, set never claimable | `validateResultSet.invariants` — *an unknown digestVersion is NOT compared* |
| issues are `{path, code}` only, ≤ 20, never a value | `CORRUPTIONS` assertions + `validateResultSet.capture` — *issues carry a path and a code* |
| capture-first / schema-version classification / node ceilings / migration | `validateResultSet.capture` (10 named tests) |
| sealed exactly once | `resultSet.seal` — *a set is sealed exactly once* |
| `secondaryCauses` excluded from `ledgerDigest` | `resultSet.seal` — *two settlements differing ONLY in observed secondary causes* |
| `cls` included in `ledgerDigest` | `resultSet.seal` — *the per-root cls marker IS digested* |
| §12.5 taint rules 1–7, `required: null`, witness filter, `cls` element status | `status.test.mjs` (12 named tests) |
| §11.4 rule 2 plan order | `resultSet.merge` — *duplicate reconciliation uses the supplied plan rank* |
| LRU touch semantics | `residency` — *eviction is by last TOUCH* / *a stopped clock still gives a total order* / *reporting never changes eviction order* |

**Not verified here (owner named):** AC-12 memory/stall measurement (P7 harness + G-CAL); the remote ambiguous-commit reconciliation loop, `reconcileTimeoutMs` and detached remote disposal (excluded, master §1.2/G-REMOTE); annotation snapshots inside the resident bound (§14.5, excluded); `done`/`persisted`/`'persistence'`-event one-shot promise wiring (P6 consumes P5's state).

## Spec coverage

| Spec § | Task |
|---|---|
| §8.3 `RunOutcome` (coverage/integrity/environmentSensitive) | P5.2 |
| §8.3 claim predicate, `assessNoClashClaim`/`canClaimNoClashes`, qualifiers/exclusions/proofMethod, `hierarchyInternalAcceptance` default `null`, OQ-19 standing policy | P5.2 |
| §11.1 `ClashResult` incl. `mode` (E1), evidence shapes, flags | P5.1 |
| §11.2 `UnitOutcome` consumption (library orientation → projection) | P5.1 |
| §11.3 canonical ordering | P5.1, P5.5 |
| §11.4 reconciliation rules 1–4 | P5.1 |
| §12.5 three axes, statement matrix, `getPairStatus`/`getElementStatus`, taint rule 1–7 | P5.2, P5.6 |
| §13.1 structure, digests, pre-resolution seal | P5.3 |
| §13.2 provenance incl. `admissionBaseline` (recorded, not digested), `scopeProof.method`, `placementVerified: false` | P5.3 |
| §13.3 immutability, deep freeze, copy-on-write/read | P5.3, P5.7 |
| §13.4 serialization rules | P5.3, P5.9 |
| §13.5 `ResultStore` port: atomic `put`, identity index, tombstone, `get`/byte guard, listing contract, `delete` | P5.7 |
| §13.5.1 persistence states, attempt numbering, `retryPersist` | P5.8 |
| §13.5.2 resident bound, classes, retain/release/discard, nonresident results, read slots | P5.8 |
| §13.6 capture-first, schema evolution, open/closed types, `validateResultSet`, producer/reader invariant, `ResultSetTooLargeError` predicate | P5.4, P5.5 |
| §17.1/§17.1.1 defaults and ceilings (via P0 `options.js` only — E6–E9) | all tasks |

## Gates and open items

**Master gates that touch this phase**

| Gate | Effect on P5 |
|---|---|
| **G-CAL** (AC-12 calibration) | Blocks *freezing* the ceilings used in P5.4/P5.5 (`maxCapturedNodes`, `maxStoredResultBytes`, `SCHEMA_MAX_NODES` and the run defaults they cross-constrain). P5 ships them as provisional values **read from `clashtest/options.js`**; no P5 test hard-codes a number, so recalibration changes one table, not this phase. The producer/reader invariant check itself is not gated. |
| **G-OQ16** (hierarchy acceptance) | Blocks nothing in P5. P5.2 tests *both* branches (`null` ⇒ claim blocked; `{recordRef}` ⇒ `allowed ∧ ¬unqualified`). |
| **G-OQ19** (bracketed proof) | Non-gating. `proofMethod` is read from `provenance.scopeProof.method` and never computed here. |
| **G-REMOTE** (remote persistence) | The reason P5.8 implements only the local transactional path. |
| **G-LEDGER-CLS** (OPEN-2) | **Resolved** by master §8 ruling **option (a)** / controller ruling R2: the per-root `cls` marker is persisted **and digested** on `ledger.rootOwners[].owners[]`. P5 pins it in the schema (*Shapes this phase pins*), validates it (`root-cls-invalid`) and digests it; P3 emits it; P8 reads it only through `readLedger`. The bounded-`examples` fallback (option c) is **dropped** and no longer appears anywhere in this file. |

**Controller rulings applied in this file.** **R1/OPEN-1** (`startRun` throws synchronously; only Promise-returning entry points reject) — no change was needed: P5.8's `reserveRunSlot` is synchronous and throws `ResultCapacityError`, and `readResultSet` is the Promise-returning path that rejects. **R2/OPEN-2** — the `cls` marker, above. **R3** — `Freshness = {state, reasons}`, `freshnessStateOf`, reasons appended to `qualifiers` (P5.2). **R4** — `secondaryCauses` excluded from `ledgerDigest` (P5.3); the ascending tie-break that *produces* the list is P6's `classifyUnitSettlement`, and P5 only records and never re-derives it. **R10** — `sealResultSet` builds the final immutable object before setting `sealed: true`, so a failed seal leaves no half-sealed set; the terminal internal-error fallback that still settles `done` once is P6's, over P5's unchanged surface.

**Narrowing recorded (per the brief, master §1.2):** `PersistenceOutcomeUnknownError` ships as a typed class and is treated as `failed` with `error.ambiguous: true`; `retryPersist` is idempotent because `put` is create-only. **Not implemented in this phase:** the single reconciliation read, `reconcileTimeoutMs`, and detached-remote disposal (`error.disposed`). The store conformance suite carries a documented note stating that a remote backend is outside the memory/settlement guarantee until that follow-up package lands. **Follow-up package:** "remote persistence reconciliation" — owner: the persistence design named in master §1.2; entry criteria: G-REMOTE answered "remote in v1".

**Left to implementers (with reasons)**

1. The exact internal index structures in `status.js` and `validateResultSet.js` (arrays vs. `Map`s built per call vs. memoized on a `WeakMap`) — pure performance, no observable difference; the sets are bounded by the schema ceilings. *Reason:* the right choice depends on AC-12's measured sizes.
2. Slice granularity inside `readResultSet` and the status-reader build (work items per `slicer.tick()`) — bounded by `sliceBudgetMs`; *reason:* it is a scheduling tuning parameter, and P0 owns the slicer (and `deepFreezeSliced` itself).
3. The issue *ordering* within the first 20 `{path, code}` entries — the spec fixes the count and the absence of values, not the order. *Reason:* over-fixing it would make the validator's internal phase order an external contract.
4. Whether `validateResultSetSummary` shares code with `validateResultSet`'s structural phase — an internal factoring decision.

### Cross-file needs (this remediation pass)

Everything below is a change **another phase file must make**. This pass edits only `p5-result-set.md`, so each is listed here rather than applied. Each names the exact identifier P5's code now depends on.

| # | Owner | Exact name / shape P5 depends on | Why |
|---|---|---|---|
| **X1** | **P0** `util/capture.js` | **✅ LANDED — verified against P0's current *Phase interface summary* at the end of this pass, not assumed.** `captureData` takes `opts.openFieldBudget = {isOpenPath: (pathSegments: readonly string[]) => boolean, maxBytes: number}`; `'unknown-field-bytes'` is in `CAPTURE_CODES`; the result carries **`nodes` on failure** (values actually copied) and `openFieldBytes`. P5 now depends on exactly these names. **The one thing P5 needs P0 to keep:** the issue path is the *offending value's* pointer (`unknown-field-bytes@/ledger/futureData/15`), not the field's — the allocation test asserts on that index. | Review **Critical 1**. |
| **X1a** | **P0** `util/capture.js` | Also landed: `nodes` on the `{ok:false}` result. P5's second allocation test asserts on it directly (`r.nodes < overAt * 2 + 1000`), so the memory bound is **measured**, not inferred. | — |
| **X2** | **P0** `options.js` | *Optional.* `ENGINE_LIMIT_DEFAULTS.maxUnknownFieldBytes` / `ENGINE_LIMIT_CEILINGS.maxUnknownFieldBytes` in `ENGINE_LIMIT_KEYS`. **Not blocking:** §13.6's 64 KiB is a data-format constant (like `MAX_DEPTH = 64`), so P5 declares `UNKNOWN_FIELD_BYTES` in `resultSetSchema.js` and reads `limits.maxUnknownFieldBytes ?? UNKNOWN_FIELD_BYTES`. If P0 adds the key, P5 and every test pick it up with no change. | Keeps the one number in one place if it ever becomes tunable. |
| **X2a** | **P0** `util/canonical.js` | *Optional.* Export the internal UTF-8 `utf8Length(s)` (code-unit scan) that capture charges with. P5 currently carries its own four-line copy for the defensive re-check, because P0 keeps it internal. | Two copies of a byte measure is a (small, tested) drift risk. |
| **X3** | **P0** `options.js` | Confirm `RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic` and `RUN_OPTION_CEILINGS.maxDistinctReasons` are exported (the structural schema caps `NormalizedDiagnostic.unitIds` and `countsByReason` with them). | Review **Critical 3**: every array ceiling in the schema table comes from P0, never from a literal. |
| **X4** | **P6** `run/freshness.js` | `getFreshness` **may additionally** return `state: 'unverifiable'` with reason `unknown-digest-version` when `digests.digestVersion !== DIGEST_VERSION`. This is a **second, independent** refusal path — the normative owner of the rule is P5's `assessNoClashClaim` conjunct, and P6 must not treat its own check as the only one. | Review **Critical 2** / question 2: one component must own it normatively; P5 does. |
| **X5** | **P7** traceability | The **engine-bound** claim path (`engine.canClaimNoClashes` / `engine.assessNoClashClaim`) needs its own named test that an unknown `digestVersion` blocks the claim end to end. P5 proves the standalone helper; P7 owns the wiring. | Review **Critical 2** asks for both paths; only the standalone one is P5's to test. |
| **X6** | **P6** `run/Run.js` (P6.5 `applyUnitResult`) | Call **`resultAccumulator.canAdmitUnit(unitOutcome)`** *before* `diagnosticAggregator.addUnit(...)` and `statisticsAccumulator.add(...)`, and skip all three on `{admissible:false, reason:'result-cap'}`. `addUnit`'s own refusal is transactional, so the fallback is safe either way — but only `canAdmitUnit` lets P6 avoid the un-rollbackable aggregation it currently performs first. | P6 re-verification **Critical 4**. |
| **X7** | **P6** `run/Run.js` (sealing recovery) | `admitSealedSet` is **atomic and exception-safe** and its observers are isolated, so a throw means the reservation was **not** converted; confirm with **`reservationHeld(runId)`** rather than inferring. P6's A14 row should name both guarantees. | P6 re-verification finding 8 and its question 1, which P5 owns. |
| **X8** | **P8** | `derive/*` consumes `createStatusReader`'s new complexity contract (build `O(units + rows + results)`, lookup `O(1)`/bounded) and must not rebuild a reader per query. `indexUnitsSteps` is P5-internal; P8 uses the reader. | Review **Important 2**: the whole point is that a ~10⁵-result derivation pays the build once. |

**Cross-phase reconciliation.** P5's consumed interfaces were checked against P1's and P4's summaries and corrected producer-wins (rows N13, N14); P5 gained two exports it did not have and two consumers needed — `freshnessStateOf` (N19, resolving P6's contradiction C1) and the `results/status.js` reader/ledger surface moved here from P8 (duplicate-ownership D4). Register: [`interface-reconciliation.md`](interface-reconciliation.md).

**Spec items reported, not resolved**

1. **§11.4 rule 2 is partly unreachable as written.** It says duplicate records that "disagree on hit/miss" keep the positive and set `flags.duplicateEvidenceConflict`. A *miss* produces no record in `UnitOutcome.pairs`, so two records can only ever disagree on *evidence*, never on hit/miss; the absent-vs-present case is indistinguishable from "the pair was scheduled once". P5.1 therefore raises the flag on disagreeing evidence (clearance `distance`, `volume-overlap` witness kind) and records this as the implemented reading. **Report only — no redesign.**
2. **§13.3 vs. §13.6 on the reference store's copy mechanism.** §13.3 says the in-memory reference store "uses `structuredClone` both ways"; §13.6 requires the same store to reject an oversized set "without materializing the value" and forbids native `structuredClone` on external input. A `structuredClone`-based store necessarily materializes before it can measure. P5.7 stores the canonical JSON string instead, which satisfies both observable requirements. **Report only.**
3. **`pairSpaceTotal` / `emptyOperand` have no declared home.** §8.3 makes both claim conjuncts and §13.6 requires them "consistent", but §13.1 lists neither on `RunOutcome` and §9.1 has `pairSpaceTotal` only on `RunProgress`. P5 pins both on the **ledger** (digested). If P6 prefers them on `RunOutcome`, the claim predicate and the validator must move together — one reconciliation point.
4. **Ledger/UnitRecord JSON shape is pinned by P5, not by the spec.** `validateResultSet` cannot exist without it. P3 (plan tables) and P6 (run-time records) must emit exactly the shape in *Phase interface summary*; the controller should reconcile this against P3/P6's Produces blocks before implementation starts.
5. **`results/status.js` — RESOLVED by reconciliation (duplicate-ownership D4); now in the master §2 module map.** P8's `p8-derivations.md` had independently planned `getPairStatus`/`getElementStatus`/`createStatusReader`/`buildStatusReaderSteps` in `derive/status.js` and the ledger-layout reader in `derive/ledgerReader.js`. **P5 is the single owner of all five**, because (a) P5 is the phase that *pins the sealed ledger's JSON shape* (item 4 above), so the layout and its only reader belong together; (b) the §12.5 taint rule is normative and feeds the §8.3 claim predicate — a second copy inside a deferrable phase is exactly the drift AC-20(c) exists to prevent; and (c) P8 is deferrable while AC-17/AC-20(c) are core acceptance criteria. P8 re-exports `getPairStatus`/`getElementStatus` publicly and consumes `createStatusReader`/`buildStatusReaderSteps`/`readLedger` internally; it re-implements none of them. Two consequences for **this** phase's tasks, both already covered by Task P5.6 and `test/clashtest/results/status.test.mjs` (the seven taint-rule clauses, `not-required` for hierarchy-internal and unreachable-only owners, `undetermined` for a foreign owner): P5.6 additionally exports the two reader builders (index-once, then answer; a `WeakMap` cache only for frozen sets) and `readLedger`, and its test file additionally pins the two P8 behaviors that would otherwise be lost in the move — **`required: null` for an `undetermined` pair** (spec §12.5 gives `required: boolean` with no value defined for `undetermined`; `null` is P5's pinned reading) and **hierarchy-internal detection from the root tables rather than from the bounded `hierarchyInternal.examples` list** (the examples array is capped at 20, so an element-level caveat derived from it would silently under-report).
6. **Taint rule 1 vs. a benign `witness-unavailable` — RESOLVED here, as P4 hands it over** (P4 *Gates and open items* spec item 4; reconciliation register S-P4-4). §12.2.1 builds the per-unit taint table with **no** completeness filter, and §12.5 taint rule 1 then makes a pair `covered-caveated` if the unit has any `element` entry naming either owner — so read literally, the one reason §12.3 and README M2.1 carve out as *not* completeness-affecting would still block a clean absence. P4 correctly records the table unfiltered (it is the evidence base for later rules and for the ledger). **`results/status.js` applies the filter at rule 1**: a taint entry whose `reason` satisfies `isCompletenessAffecting(reason) === false` — i.e. exactly `'witness-unavailable'` — does not by itself downgrade `covered-clean` to `covered-caveated`. It is still reported in `caveats[]` so the Panel can show it. Nothing is dropped from the ledger; the filter lives only in the verdict. Task P5.6's test file pins both halves (entry present in `caveats`, verdict still `covered-clean`). This is a **plan-level resolution of an under-specification, not a spec change.**
7. **`retryPersist` on a non-`failed` resident set** has no specified error (§13.5.1 names only the legal source state, and §13.5.2 names `ResultNotResidentError` only for nonresident ids). P5.8 throws `InvalidOptionsError{issues:[{path:'runId',code:'not-failed'}]}`; if P7's facade prefers a different error, it is a one-line change in `residency.js`.

---

## Conformance check

Mechanical, re-runnable evidence that no superseded cross-phase identifier survives in this file's **executable** content. Every name below is either a "consumer-assumed" spelling from the reconciliation register's name table that P5 (or a sibling phase) once used, or an identifier the P5 internal Codex review named as stale.

Run from the repository root. The commands are given as indented blocks, not fenced ones, deliberately: the check extracts this file's fenced code and a fenced command would then grep itself.

**Step 1 — extract only the fenced code blocks.** The prose deliberately *names* the dead spellings, in the form "there is no `X`", as an anti-regression marker, so a raw file grep would hit those sentences and prove nothing:

    FILE=docs/superpowers/plans/federated-clash-test-core/p5-result-set.md
    awk '/^```/{f=!f;next} f' "$FILE" > /tmp/p5-code.txt

**Step 2 — grep that code for every superseded name:**

    grep -n -E "$(cat <<'PAT'
pairSemanticsForMode|captureDetached|CaptureError|softMaxNodes|unknownFieldByteBudget|onRootKey|SCHEMA_CEILINGS|maxStringCodeUnits|maxEntriesPerSelection2x|digestOf\(|digestSync|slicer\.step|createResultSetDraft|mergeUnit|startPersistence|handBackUnsaved|attachSealed|aggregateDiagnostics|readDiagnostics|buildScopeExpect|ownKeysOf|readOwnValue|prototypeIsPlain|toBlock|compareElementRefs|binding\.dead|diagnostics\.retained|array-ceiling|node-ceiling|soft-node-ceiling|extra-array-key
PAT
)" /tmp/p5-code.txt

**Result: no match (`grep` exit status 1).**

**One name was removed from the pattern by this pass, deliberately: `recordPlanningGap`.** Re-running the check revealed it as a live hit — inside the `Ledger` typedef, where P5 names `ledger.recordPlanningGap({phase, cause})` as the only writer of the sealed `planningGaps`. That is **correct**, not stale: the reconciliation addendum (§C) promoted it to a real, owned **P3** export, so it stopped being a superseded spelling and the pattern had simply not been updated. The earlier "no match" claim in this file was therefore inaccurate for that one name; it is accurate now. What each *remaining* name was, and what replaced it:

| Superseded name | Register row / review finding | Replacement now used here |
|---|---|---|
| `pairSemanticsForMode` | **N14** | `pairSemanticsOf` (test-only; production passes the mode to `makePairId`) |
| `makePairId(source, target, semantics)` | **N13** | `makePairId(mode, x, y)` — checked separately in Step 3 |
| `compareElementRefs` for result order | review Critical 1 | `comparePairIds` (P1 owns the §11.3 order) |
| `digestOf`, `digestSync` | **N3**, **N5** | `digestCanonical(value)` — synchronous, value-taking |
| `slicer.step()` | **N6** | `slicer.tick(label?)`, awaited only when it returns a Promise |
| `captureDetached`, `CaptureError`, `softMaxNodes`, `unknownFieldByteBudget`, `onRootKey` | **N4** / **N29**, review Critical 4 | `captureData(root, opts)` returning a result object; `rootGate`; **`openFieldBudget: {isOpenPath, maxBytes}`** for the unknown-field budget (P0 addition — the earlier "charged in validation" deviation is withdrawn, re-verification Critical 1) |
| `SCHEMA_CEILINGS`, `maxStringCodeUnits`, `maxEntriesPerSelection2x` | P0's real `options.js` exports (**N33**) | `RUN_OPTION_CEILINGS`, `ENGINE_LIMIT_CEILINGS`, `2 × ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection`, a stated `MAX_STRING_LENGTH` |
| `array-ceiling`, `node-ceiling`, `soft-node-ceiling`, `extra-array-key`, the `hole` code | **N4** (`CAPTURE_CODES`) | `array-too-long`, `too-many-nodes`, `array-extra-key`, `sparse-array` |
| `createResultSetDraft`, `mergeUnit`, `recordPlanningGap` | **N21** | `createResultAccumulator` + `buildResultSet` |
| `startPersistence`, `handBackUnsaved`, `attachSealed` | **N23**, **N24** | `beginPersist`, `drainForDispose`, `admitSealedSet` |
| `aggregateDiagnostics`, `readDiagnostics`, `toBlock()`, `diagnostics.retained` | **N20** / **D3** | a finished `DiagnosticsSummary` with `diagnostics` / `truncated`; P5 aggregates nothing |
| `buildScopeExpect` | **D1** | never referenced here — P3 owns the expectation and `checkScopeBracket` |
| `ownKeysOf`, `readOwnValue`, `prototypeIsPlain` | **N4** | internal guarantees of `captureData`, not exports |
| `binding.dead` | **N10** | never referenced here — P5 never sees a `Binding` |

`ResultCapacityError`'s own `retained:` field is **not** in the pattern: it is P0's declared typed field (`retained: runId[]`), not the superseded diagnostics field, which is why the pattern spells the dead one `diagnostics.retained`.

**Step 3 — the three shape checks a name grep cannot make:**

    grep -n "makePairId(" /tmp/p5-code.txt | grep -vE "makePairId\((ctx\.mode|mode|'[a-z-]+')"
    grep -n -A4 "DIGESTED_UNIT_KEYS" /tmp/p5-code.txt | grep secondaryCauses
    grep -n "deepFreezeSliced" /tmp/p5-code.txt

**Results.** (1) **No match** — every `makePairId` call site passes the **mode first**, either `ctx.mode` or a mode literal in the P1 integration test. (2) **No match** — `DIGESTED_UNIT_KEYS` no longer contains `secondaryCauses` (spec §16.7: "excluded from `ledgerDigest`"). (3) Three matches, all correct: the import from `util/capture.js`, and the calls `deepFreezeSliced(set, slicer)` and `deepFreezeSliced(migrated, slicer)` — **the P5-owned export of that name is gone**, so P0 keeps sole ownership (N4) and the argument is the slicer object, not `{slicer}`.

**Step 3b — the six checks this remediation pass added** (each is a one-line grep over the same extracted code, and each corresponds to a finding of the P5 re-verification review):

    # C1 — the unknown-field budget is charged at CAPTURE, and only re-checked in validation
    grep -c "openFieldBudget" /tmp/p5-code.txt                       # expect >= 1
    grep -n "unknown-field-bytes" /tmp/p5-code.txt | grep -i "defensive\|openBytes >"  # the re-check
    # C2 — the claim predicate carries the digest-version conjunct
    grep -n "DIGEST_VERSION" /tmp/p5-code.txt | grep -n "knownDigestVersion\|import"
    # C3 — the validator never delegates to an unwritten helper
    grep -n "checkShapeAndUnknownFields" /tmp/p5-code.txt            # declared AND defined here
    # I1 — no bare `migrations.has(v)` gate survives (the range check is on the SAME line,
    #      so this greps for the check, not for the helper's name one line above)
    grep -nE "migrations\.has\(" /tmp/p5-code.txt | grep -v "Number.isInteger"
    # I2 — no per-call scan of the leaf list survives in the status reader
    grep -nE "ledger\.leaves\.(find|filter|some)\(" /tmp/p5-code.txt
    # I4 — the residency section defines retain/admit rather than describing them
    grep -nE "^\s*(function admitSealedSet|function retainResultSet)" /tmp/p5-code.txt

**Results (actually run, not asserted).** `openFieldBudget` 2 · `knownDigestVersion` 3 · `export function checkShapeAndUnknownFields` 1 · `function admitSealedSet` / `function retainResultSet` 2 — all as stated. Checks 5 and 6 are **no match**, which is their passing condition: both `migrations.has(` sites carry the full range check on the same line, and no `ledger.leaves.find|filter|some(` survives in the status reader. (The first draft of check 5 filtered on `migratableFrom`, which sits on the *previous* line, so it reported two false positives; the probe above is the corrected one.) The two phrases the prose still contains — "there is no `digestOf`" and the superseded-name table's `unknownFieldByteBudget` row — are explanatory, live outside the fenced code, and are therefore invisible to this extraction by construction.

**Step 4 — producer summaries re-read for this pass** (the authority for each consumed name; ranged reads of the `## Phase interface summary` sections, not whole files): **P0** — `errors.js` conventions and fields, `options.js` (`RUN_OPTION_*`/`ENGINE_LIMIT_*`, `SCHEMA_MAX_NODES`), `util/capture.js` (`captureData`, `CAPTURE_CODES`, `deepFreezeSliced`), `util/canonical.js` (`digestCanonical`, `DIGEST_VERSION`), `util/slicer.js` (`tick`), design notes 1–3 and *Gates* items 1/3. **P1** — `identity/ids.js` (`makePairId`, `pairSemanticsOf`, `comparePairIds`, `makeResultId`, `elementRefKey`). **P3** — the plan/ledger surface and its cross-phase paragraph (`rootOwners`, `ownerClassOf`, `rootOfOwner`, `POPULATION_CLASS`). **P4** — `UnitOutcome`, `DiagnosticsSummary`, `isCompletenessAffecting`, `TaintEntry`. **P6** — *Consumed interfaces* rows **A12–A16** (everything P6 calls on P5). **P8** — the five moved status names and its sealed-ledger view. Register: [`interface-reconciliation.md`](interface-reconciliation.md); rulings: master §8 and §9.
