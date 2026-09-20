# Derivations (status readers, facets, groupBy, filter, summarize, compare) — Phase P8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Commits only on explicit user authorization.

**Goal:** Give the sealed Result Set an asynchronous, abortable, bounded, deterministic read-side: the built-in facets, `groupBy`, `filter`, `summarize` (§14.1–§14.4, §14.6) and `compareResultSets` (§15.2, §15.4), all exposed only as methods of a per-context `DerivationContext` (`createDerivationContext`, later bound as `engine.derivations`). The pure pair/element status readers (spec §12.5) are **P5's** (`results/status.js`, duplicate-ownership D4); this phase only consumes them and re-exports the two public names. **P8 is DEFERRABLE**: it is not on the critical path, core Definition of Done (master §5) does not require it, and it never blocks P7. The annotation layer (§14.5, `engine.annotate`, snapshot compatibility checks) is **excluded**; attribute facets (`attrFirst|attrSecond|attrEither:<name>`) always report `unavailable` in P8 behind one seam (Task P8.3).

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints. Phase-specific ones, copied from the spec:

- **Pure derivations over a sealed Result Set (§14.1):** no UI, no state, no Group By presentation; nothing here touches `collision/`, `three`, the Viewer or a store.
- **Asynchronous and sliced (§14.4):** `summarize`, `groupBy`, `filter`, `compareResultSets` return Promises, run in deadline-aware slices over the injected `now`/`yieldToScheduler`, and offer **no synchronous form**. Each accepts an optional `signal`, checked at every slice boundary; abort rejects `DerivationAbortedError` with **no partial result** and stops all further slices and allocation.
- **Per-context concurrency (§14.4, R17-4):** at most `maxConcurrentDerivations` (provisional 2) run at once **per context**; a further call rejects `DerivationBusyError{limit}` immediately (never queues). No module-global state; a standalone call without a context is not part of the API. The slot is taken **before** any raw Result Set is captured (R21-3).
- **Bounds before allocation (§14.4):** `maxFacetsPerGroupBy` (4), `maxFilterClauses` (32), `maxGroupMemberships` (1,000,000; count incremental, before allocation ⇒ `GroupingTooLargeError{limit, observed}`, no partial grouping), `maxComparisonEntries` (2,000,000 ⇒ `ComparisonTooLargeError{limit, observed}`, no partial comparison). A repeated facet id with equal params is `InvalidOptionsError`.
- **Closed options (§18, R19-4):** every options object (context options, `limits`, per-method options, facet specs, filter clauses) is closed — an unknown key is `InvalidOptionsError`.
- **Range safety (R15-5):** a derived bucket index must be a safe integer, else `FacetRangeError{facetId}` with no partial grouping; never `null`, never saturated.
- **Fail-closed comparison (§15.4):** `PairId` is the join key, never `ResultId`; a `pairSemantics` change makes the sets `incomparable` (nothing joined); a pair is `resolved`/`added` only when the *other* set covers it **cleanly** (`getPairStatus` verdict `covered-clean`); everything else lands in an `unverified` class. The weaker determinism class of the two sets wins.
- **Capture first (§13.6):** every raw Result Set entering a derivation is captured synchronously, before the returned Promise's first `await`, as one detached engine-owned copy (P5's `captureResultSet(raw, {limits})`, which is built on P0's `captureData`). Derivation methods do **not** run the full `validateResultSet` (spec §13.6: "they only derive from it, never claim").

---

## Phase interface summary

All paths repo-relative; every export is new in P8 unless marked *(consumed)*.

| Name | Module | Signature | Meaning |
|---|---|---|---|
| *(consumed)* `getPairStatus` | **P5 `clashtest/results/status.js`** | `(resultSet, pairId:{first,second}) → PairStatus` | Sync, pure. §12.5 pair level: `{required:boolean\|null, coveringUnitId:string\|null, unitOutcome:string\|null, roots:{first:{modelKey,dbId}\|null, second:…}, caveats:{reason,count,attribution}[], verdict:'covered-clean'\|'covered-caveated'\|'gap'\|'not-required'\|'undetermined', reason?:string}`. **OWNED BY P5 — duplicate-ownership D4.** P8 re-exports it publicly (Task P8.8) and consumes it internally; **P8 does not implement it.** |
| *(consumed)* `getElementStatus` | **P5 `clashtest/results/status.js`** | `(resultSet, elementRef) → {inRequiredPairSpace, coverage:'full'\|'partial'\|'none', caveats, gapCauses:string[]}` | Sync, pure. §12.5 element level, same taint tables. Same sole ownership (D4). |
| *(consumed)* `createStatusReader` | **P5 `clashtest/results/status.js`** | `(resultSet) → {pairStatus(pairId), elementStatus(ref), ledger: LedgerModel}` | Sync build; indexes built once; `WeakMap`-cached for frozen sets. `reader.ledger` is the `LedgerModel` `readLedger` returns (`{units, leaves, unitsById, byModel, planningGaps, pairSpaceTotal, emptyOperand}`); `summarize` reads its `leaves` and `planningGaps`. **Moved to P5 by reconciliation** so there is exactly one implementation of the normative §12.5 taint rule. |
| *(consumed)* `buildStatusReaderSteps` | **P5 `clashtest/results/status.js`** | `function*(resultSet) → StatusReader` | Same build as a generator (one `yield` per item) so P8's derivations can slice it through `drive`. Moved to P5 with the reader. |
| *(consumed)* `readLedger` | **P5 `clashtest/results/status.js`** | `function*(resultSet) → LedgerModel` | The **only** function that knows the sealed ledger's physical layout — and **P5 is the phase that pins that layout**, so the two live together (D4). P8 imports it (only P8.1's consumer test drains it directly). The "Sealed-ledger layout" block below is a restatement of P5's pinned schema — the parts P8's fixtures must emit, including the per-root `cls` marker on `rootOwners` rows — and P5's `Ledger`/`UnitRecord` typedefs are the authority. |
| `createDerivationContext` | `clashtest/derive/context.js` | `({limits?, yieldToScheduler?, now?} = {}) → DerivationContext` | Public. Closed options; `limits` ⊆ derivation limits (§17.1.1 validated via P0). |
| `DerivationContext` | `clashtest/derive/context.js` | `{ summarize(rs,{signal?}), groupBy(rs, facets,{annotations?,signal?}), filter(rs, clauses,{annotations?,signal?}), compareResultSets(base,next,{signal?,distanceTolerance?,pointTolerance?}={}) }` | Every method returns a Promise. Exactly these four own keys. |
| `createContextInternal` | `clashtest/derive/context.js` | `(options, hooks:{capture?, assertOpen?, runners?}) → DerivationContext` | **Internal** (not re-exported from `index.js`): test seam and the engine-binding entry (Task P8.8). |
| `DERIVATION_LIMIT_KEYS` | `clashtest/derive/context.js` | `string[]` | `maxConcurrentDerivations, maxFacetsPerGroupBy, maxFilterClauses, maxGroupMemberships, maxComparisonEntries, sliceBudgetMs, aggregationSliceMaxItems`. |
| `parseFacetSpec` | `clashtest/derive/facets.js` | `(spec:string\|{facet,size?,width?}, path?) → Facet` | `Facet = {facetId, params, multiValued, numeric, attr:null\|{which,name}, needsReader, values(result, env)→any[]}`. |
| `compareFacetValues` | `clashtest/derive/facets.js` | `(a,b) → number` | §14.3 group order: numbers numeric, strings by code unit, arrays lexicographic, refs by element order, `null` last. |
| `resolveAttributes` | `clashtest/derive/attributeSeam.js` | `(resultSet, annotations, names) → {available:false, reason} \| {available:true, get(ref,name)}` | The single annotation seam. P8: always `available:false`. |
| `runGroupBy` / `groupByRunner` | `clashtest/derive/groupBy.js` | `runGroupBy({set, parsed, attrs, env, probe?}) → Promise<GroupingResult>` | `GroupingResult = {facets:[{facetId,params,multiValued}], unavailable:[{facetId,reason}], total, memberships, groups:Group[]}`; `Group = {groupId, path:string[], facetId, params, value, count, members?:resultId[], children?:Group[]}`. |
| `clauseHolds` / `filterRunner` | `clashtest/derive/filter.js` | `clauseHolds(op, values, operand) → boolean` | Existential truth rules of §14.4. Filter result `{matches:resultId[], count, total, unavailable}`. |
| `summarizeRunner` | `clashtest/derive/summarize.js` | runner (see P8.2 contract) | Result: see Task P8.6. |
| `compareRunner` | `clashtest/derive/compare.js` | runner | Result is the spec's `Comparison` (§15.4). |
| *(consumed)* `COMPARE_TOLERANCE_DEFAULTS` | **P0 `clashtest/options.js`** | `{distanceTolerance:1e-6, pointTolerance:1e-6}` (frozen) | **Owned by P0** (controller ruling on OPEN-4: the master's single-defaults rule is read strictly). `derive/compare.js` imports it; P8 defines **no** local copy, and tests import it rather than restating `1e-6`. |
| `drive`, `assertCanonicalResultOrder` | `clashtest/derive/steps.js` | see Task P8.2 | Async sliced generator driver (one `gate.tick()` per yielded step) and the canonical-order guard. There is no sync driver: the only synchronous consumer was the status reader, which is P5's. |
| `invalid`, `assertClosed`, `isAbortSignal`, `isJsonValue` | `clashtest/derive/validate.js` | see Task P8.2 | Closed-options helpers; `invalid(code, path) → InvalidOptionsError`. |
| *(consumed)* `runners` registry | `clashtest/derive/runners.js` | `{summarize, groupBy, filter, compare}` | Only file a later task edits to register a derivation. |

Public re-exports (Task P8.8): `clashtest/derive/index.js` exports `createDerivationContext` and **re-exports** `getPairStatus`, `getElementStatus` from P5's `results/status.js` (re-export lines, not a module). `clashtest/index.js` gains **only** `createDerivationContext` — P7 already exports the two status names there, sourced from P5, and a second `export` of the same name would be a duplicate-export `SyntaxError`.

**Engine-bound vs standalone (binding is Task P8.8, after P7).**

| Item | Standalone | Engine-bound |
|---|---|---|
| `getPairStatus`, `getElementStatus` | yes (spec §14.4: "stay standalone") | no |
| `createDerivationContext` | yes | — |
| `summarize`, `groupBy`, `filter`, `compareResultSets` | only through a context a caller creates | **`engine.derivations`** = the engine's own context: engine `now`, `yieldToScheduler`, the engine's already-validated derivation limits, and `EngineDisposedError` after `dispose()` |
| `engine.annotate`, attribute snapshots | — | **excluded (follow-up)** |

Binding adds exactly one key, `derivations`, to the engine object and changes no other key. **P7 ships the core engine WITHOUT `derivations` and pins its absence in `test/clashtest/engine/exports.test.mjs` (controller ruling on OPEN-3), so Task P8.8 legitimately edits that one P7 test** (stated explicitly there).

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `clashtest/derive/validate.js` | Create | closed-options helpers |
| `clashtest/derive/steps.js` | Create | async sliced generator driver, canonical-order guard |
| ~~`clashtest/derive/ledgerReader.js`~~ | **Not created** | **Implemented in P5 `results/status.js` (`readLedger`); this phase only consumes it** (duplicate-ownership D4). |
| ~~`clashtest/derive/status.js`~~ | **Not created** | **Implemented in P5 `results/status.js` (`getPairStatus`, `getElementStatus`, `createStatusReader`, `buildStatusReaderSteps`); this phase only consumes it** (D4). The two public names are re-exported from `derive/index.js` in Task P8.8 — a re-export line, not a module. Task P8.1 pins that neither file exists. |
| `clashtest/derive/context.js` | Create | context, limits, slots, gate, capture-first, method dispatch |
| `clashtest/derive/runners.js` | Create + edit ×4 | registry of derivations |
| `clashtest/derive/facets.js` | Create | facet registry, value lists, range safety, ordering |
| `clashtest/derive/attributeSeam.js` | Create | the annotation seam (unavailable in P8) |
| `clashtest/derive/groupBy.js`, `filter.js`, `summarize.js`, `compare.js` | Create | the four derivations |
| `clashtest/derive/index.js` | Create | public exports |
| `clashtest/engine.js`, `clashtest/index.js` | Modify (P8.8, after P7) | bind `engine.derivations` (one import + one key); `index.js` gains `createDerivationContext` only |
| `test/clashtest/engine/exports.test.mjs` | **Modify (P8.8) — a P7-owned test** | flips the two P7 absence pins for `createDerivationContext` / `engine.derivations` to presence pins; nothing else in it changes |
| `test/clashtest/derive/support/makeResultSet.mjs`, `harness.mjs` | Create | P8-local fixtures; `makeResultSet` emits **P5's pinned ledger shape** (no dependency on P5 *sealing*) |
| `test/clashtest/derive/*.test.mjs`, `test/clashtest/engine/derivations.test.mjs` | Create | one file per task |

## Consumed interfaces (from earlier phases)

Every row below was checked against the producing phase's `## Phase interface summary` and against [`interface-reconciliation.md`](interface-reconciliation.md); **producer wins**. No row is "Assumed" any more except where the last column says so.

| From | Name | Signature used | Status |
|---|---|---|---|
| P0 `errors.js` | `InvalidOptionsError, DerivationBusyError, DerivationAbortedError, GroupingTooLargeError, ComparisonTooLargeError, FacetRangeError, CorruptResultSetError, EngineDisposedError` | **N1: every class takes ONE object argument** — `new XError({...typedFields, message?, cause?})`. `new InvalidOptionsError({issues:[{path,code,message}], reason?})` (exposes `.issues`, `.reason`), `new DerivationBusyError({limit})`, `new GroupingTooLargeError({limit, observed})`, `new ComparisonTooLargeError({limit, observed})`, `new FacetRangeError({facetId})`, `new CorruptResultSetError({runId, issues})`, `new DerivationAbortedError({})`, `new EngineDisposedError({})`. `derive/validate.js`'s `invalid(code, path)` builds `new InvalidOptionsError({issues:[{path, code, message: code}]})`. | Reconciled |
| P0 `options.js` | `resolveEngineLimits(input) → frozen ResolvedLimits` | Validates a (possibly partial) limits object per §17.1.1, fills defaults, throws `InvalidOptionsError`. The seven derivation limit keys (`maxConcurrentDerivations`, `maxFacetsPerGroupBy`, `maxFilterClauses`, `maxGroupMemberships`, `maxComparisonEntries`, `sliceBudgetMs`, `aggregationSliceMaxItems`) are all in P0's `ENGINE_LIMIT_SPECS`. | Reconciled |
| P0 `options.js` | `COMPARE_TOLERANCE_DEFAULTS` | `{distanceTolerance:1e-6, pointTolerance:1e-6}` frozen; **added to P0 by the controller's OPEN-4 ruling** (another agent is editing P0 to export it). `derive/compare.js` imports it. | Reconciled (P0 edit pending — see the report's cross-file needs) |
| P5 `results/validateResultSet.js` | `captureResultSet(raw, {limits}) → ResultSet` | **N29: P5's, not P0's.** Synchronous; throws `UnsupportedSchemaVersionError` / `CorruptResultSetError` / `ResultSetTooLargeError`. Takes the **resolved engine limits object** (`{limits}`), not `{maxCapturedNodes}`. It captures; it does **not** validate cross-field invariants. | Reconciled |
| P0 `util/canonical.js` | `canonicalJson(value) → string` | sorted keys, no whitespace (§5.4). | Reconciled |
| P0 `util/slicer.js` | `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery?, spanRecorder?, afterYield?}) → {tick(label?), yieldNow(label?), forEach(list, fn, opts?), sortSliced(list, compare, opts?), stats()}` | **N6: the yield point is `tick(label?)`** — returns `undefined` when not due, else a Promise. P0 exports **no** default clock and **no** default scheduler; an omitted `now` / `yieldToScheduler` simply defaults inside `createSlicer`, so P8 passes the caller's (possibly `undefined`) values straight through. | Reconciled |
| P1 `identity/ids.js` | `compareElementRefs(a,b)`, `comparePairIds(a,b)`, `pairSemanticsOf(mode) → 'ordered'\|'unordered'` | element order = `modelKey` code units, then `dbId`; `comparePairIds` = first then second. P8 does **not** call `elementRefKey` (it was added to P1 by N12 for P5's reader; P8's group ids use `canonicalJson`). | Reconciled |
| P5 `results/status.js` | `getPairStatus(resultSet, pairId)`, `getElementStatus(resultSet, elementRef)`, `createStatusReader(resultSet) → {pairStatus(pairId), elementStatus(ref), ledger: LedgerModel}`, `buildStatusReaderSteps(resultSet)` (generator returning that reader, one `yield` per indexed record), `readLedger(resultSet)` (generator returning `LedgerModel = {units, leaves, unitsById, byModel, planningGaps, pairSpaceTotal, emptyOperand}`) | **D4: P5 is the sole owner**; P8 consumes `buildStatusReaderSteps` (sliced through `drive`) inside `groupBy`/`filter`/`summarize`/`compare`, and re-exports `getPairStatus`/`getElementStatus`. The **only** ledger access in a derivation is `reader.ledger` (`summarize` reads `leaves` and `planningGaps`); P8 never touches `rootOwners`/`cls`/unit ranges and never calls `readLedger` from a derivation (the reader already did). `PairStatus.verdict ∈ {'covered-clean','covered-caveated','gap','not-required','undetermined'}` is the only pair-status field P8 branches on. **Assumed of P5's `LedgerModel` (one row, cross-file need):** `leaves[]` are the non-`split` `UnitRecord`s (`outcome`, `cause`, `pairSpaceWeight` readable) and `planningGaps[]` are `{phase, cause}`. | Reconciled |
| P5 `results/claim.js` | `freshnessStateOf(freshness) → 'current'\|'stale'\|'unverifiable'\|null` | **N19.** Not called by P8: a Result Set's `outcome.freshness` is the **bare state** (§8.3), which is all a derivation reads (`summarize` labels it `freshnessAtSeal: true`). The live `Freshness` object `{state, reasons[]}` (P6 `getFreshness`, §16.4) never enters a derivation; if a future derivation needs one, adapt with `freshnessStateOf`, never a string compare. | Reconciled |
| P5 sealed `ResultSet` | field layout of §13.1 and the pinned `Ledger` / `UnitRecord` typedefs (see below) | The `RunOutcome` fields (`status`, `coverage`, `integrity`, `freshness`, `environmentSensitive`), `provenance.*`, `definition`, `testRef`, `diagnostics`, and per-unit scalars `outcome`, `cause`, `pairSpaceWeight` and `planningGaps[].cause`, **read only through `reader.ledger`** (`summarize`). The root/owner/target layout, `cls` and unit ranges are **never** read by P8 code. | Reconciled |
| P7 engine (`createClashTestEngine`) | the engine literal, the resolved-limits local, `now`, `yieldToScheduler`, the engine's dispose guard | **OPEN-3 ruling:** the core engine ships **without** a `derivations` key and pins its absence; Task P8.8 adds the key **additively** using values already in scope inside `createClashTestEngine` (P7.2's sketch: `effectiveLimits`, `now`, `yieldToScheduler`, and the `alive()` guard that throws `EngineDisposedError`). No new public accessor is added. | Reconciled (P8.8 edits a P7 test) |

**Sealed-ledger layout — P5 PINS IT; P8 does not read it.** `readLedger` (and `reader.ledger`, its result) is the only access path — P5's `rootCls` map is where `cls` surfaces — and P5's `Ledger` / `UnitRecord` typedefs in `p5-result-set.md` are the authority. This block is a **restatement of the parts P8's fixtures must emit** (so P5's reader accepts them), nothing more:

```text
ledger.planExists, pairSpaceTotal, emptyOperand, budgetExhausted, firstRefusalUnitId, exclusions[], warnings[], unresolvedSelections[]
ledger.rootOwners : [{ modelKey, owners: [{ rootDbId, ownerDbIds:number[] /*ascending*/, cls: 'A'|'B'|'C' }] }]
                    // OPEN-2 ruling (controller, option a): the per-ROOT class marker `cls` is persisted and DIGESTED on the rootOwners rows.
                    // P3 emits it; P5 pins it and digests it; only P5's readLedger reads it. cls === 'C' marks a root in A∩B.
ledger.units      : [{ unitId, kind:'leaf'|'split', parentUnitId, sourceModelKey, sourceRootDbIds:number[],
                       targets:[{ modelKey, scope:'model'|'roots', rootDbIds? }],
                       outcome:'evaluated'|'failed'|'skipped'|'discarded'|'not-run'|'split', cause:string|null, secondaryCauses:[],
                       capacityKind, capDetail, scopeProof, pairSpaceWeight,
                       taints:[{ kind:'element'|'target-model'|'unit', modelKey:string|null, dbId:number|null, reason, occurrences }], attempts, durationMs }]
ledger.unreachablePopulation : [{ modelKey, ownerDbIds, mixedOwnerDbIds, unattributable:{ notLoaded, ownerUnresolvable } }]
ledger.hierarchyInternal     : [{ modelKey, rootCount, ownerCount, examples:[{rootDbId, ownerDbIds}] /* bounded: first 20 */ }]
ledger.planningGaps          : [{ phase, cause }]
```

Hierarchy-internal detection at element level is therefore made **from the per-root `cls` marker**, in P5's reader; the bounded `hierarchyInternal.examples` is a run-level *report* only and is never the source for an element view (the earlier "first-20 examples fallback" and its under-reporting limitation are **removed**). A unit with `kind: 'split'` is superseded by its leaves and ignored by every derivation.

---

### Task P8.1: Fixtures, and consuming the P5 status reader

> **SCOPE — reconciliation duplicate-ownership D4 ([`interface-reconciliation.md`](interface-reconciliation.md)).** `readLedger`, `createStatusReader`, `buildStatusReaderSteps`, `getPairStatus` and `getElementStatus` are **implemented in P5 `clashtest/results/status.js`; this phase only consumes them.** P5 owns them because P5 pins the sealed ledger's JSON shape, because the §12.5 taint rule is normative input to the §8.3 claim predicate, and because AC-17 and AC-20(c) are **core** acceptance criteria while P8 is deferrable. The §12.5 verdict semantics (the seven taint-rule clauses, `not-required`, `undetermined`, `required: null`, hierarchy-internal detection) are asserted in **P5's** `test/clashtest/results/status.test.mjs` (Task P5.6 and Gates items 5–6) and are **not** re-asserted here. **P8.1 therefore implements nothing under `clashtest/`.**
>
> **What this task delivers:** the two P8-local fixture builders (independent of P5's *sealer*, but emitting **P5's pinned ledger shape**, including the per-root `cls` marker), and one thin consumer test that pins the import path, the fixture-to-reader shape agreement, and the absence of any second copy of the reader in `derive/`.

**Files:**
- Create: `test/clashtest/derive/support/makeResultSet.mjs`, `test/clashtest/derive/support/harness.mjs`
- Test: `test/clashtest/derive/status.consumer.test.mjs`
- Create under `clashtest/`: **nothing** (no `derive/status.js`, no `derive/ledgerReader.js`).

**Interfaces:**
- Consumes (P5 `results/status.js`): `readLedger`, `createStatusReader`, `buildStatusReaderSteps`, `getPairStatus`, `getElementStatus`. Consumes P5's pinned `Ledger` / `UnitRecord` typedefs as the shape the fixture must emit.
- Produces: the two fixture builders only.
- **Ordering:** P8.1's test cannot pass until P5 Task P5.6 (`results/status.js`) exists; that is a P5-before-P8 ordering the master graph already requires. Until then Step 3's failure is `ERR_MODULE_NOT_FOUND: clashtest/results/status.js`.

- [ ] **Step 1: Write the P8-local fixture builder** (a plain-data set in P5's ledger layout; deliberately independent of P5 sealing — `sealed: true` and the digests are placeholders, because no derivation validates or re-digests).

```js
// test/clashtest/derive/support/makeResultSet.mjs
const rid = (testId, digest, a, b) => JSON.stringify([testId, digest, a[0], a[1], b[0], b[1]]); // spec §4.4 form
const refCmp = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
const asc = (xs) => [...xs].sort((x, y) => x - y);
// input target forms: {modelKey, whole:true} | {modelKey, roots:[dbId]}  ->  P5 UnitRecord.targets[]
const scopeOf = (t) => (t.whole ? { modelKey: t.modelKey, scope: 'model' } : { modelKey: t.modelKey, scope: 'roots', rootDbIds: asc(t.roots) });

/** models: [{modelKey, modelVersion, cls?, roots:[{dbId, ownerDbIds, cls?}]}]
 *          `cls` is the per-ROOT class marker persisted on the ledger's rootOwners rows ('A'|'B'|'C', default 'A' — P3's ROOT_CLASS literals, R2);
 *          a model-level `cls` is only a default for its roots.
 *  units:  [{unitId, outcome?, cause?, source:{modelKey, roots:[dbId]}, targets:[{modelKey, whole:true}|{modelKey, roots:[dbId]}],
 *            taints?, pairSpaceWeight?, scopeProof?}]      outcome:'split' => kind:'split' (superseded parent)
 *  results:[{pair:[[mk,db],[mk,db]], unitId, evidence?, flags?}]  (sorted into canonical order here) */
export function makeResultSet(spec = {}) {
  const {
    runId = 'run-1', testId = 't1', semanticDigest = 'sha256:aaa', mode = 'volume-overlap', clearance,
    models = [{ modelKey: 'M', modelVersion: 'v1', roots: [{ dbId: 100, ownerDbIds: [100, 105] }, { dbId: 200, ownerDbIds: [200] }, { dbId: 300, ownerDbIds: [300] }] }],
    units = [], results = [], unreachable = [], freshness = 'current', status = 'completed', coverage = 'full', integrity = 'clean',
    environmentSensitive = false, determinismClass = 'deterministic', registrySessionId = 'sess-1', placementGeneration = 0,
    libraryVersion = '1.0.0', diagnostics = {}, scopeDigests = {}, planningGaps = [], definitionOverrides = {},
  } = spec;
  const rootOwners = models.map((m) => ({ modelKey: m.modelKey,
    owners: m.roots.map((r) => ({ rootDbId: r.dbId, ownerDbIds: asc(r.ownerDbIds), cls: r.cls ?? m.cls ?? 'A' })) }));
  const hierarchyInternal = rootOwners.flatMap((row) => {
    const hier = row.owners.filter((o) => o.cls === 'C' && o.ownerDbIds.length >= 2);
    return hier.length === 0 ? [] : [{ modelKey: row.modelKey, rootCount: hier.length, ownerCount: hier.reduce((n, o) => n + o.ownerDbIds.length, 0),
      examples: hier.slice(0, 20).map((o) => ({ rootDbId: o.rootDbId, ownerDbIds: o.ownerDbIds.slice(0, 8) })) }]; // bounded, exactly as P3 emits it
  });
  const ledgerUnits = units.map((u) => {
    const outcome = u.outcome ?? 'evaluated';
    return { unitId: u.unitId, kind: outcome === 'split' ? 'split' : 'leaf', parentUnitId: null,
      sourceModelKey: u.source.modelKey, sourceRootDbIds: asc(u.source.roots), targets: u.targets.map(scopeOf),
      outcome, cause: u.cause ?? null, secondaryCauses: [], capacityKind: null, capDetail: null,
      scopeProof: u.scopeProof ?? 'equal', pairSpaceWeight: u.pairSpaceWeight ?? 1,
      taints: (u.taints ?? []).map((t) => ({ modelKey: null, dbId: null, ...t })), attempts: 1, durationMs: 0 };
  });
  const clashResults = results
    .map((r) => {
      const [a, b] = [...r.pair].sort(refCmp);
      return { resultId: rid(testId, semanticDigest, a, b), pair: { first: { modelKey: a[0], dbId: a[1] }, second: { modelKey: b[0], dbId: b[1] } },
        mode, evaluatedAs: { source: { modelKey: a[0], dbId: a[1] }, target: { modelKey: b[0], dbId: b[1] } },
        evidence: r.evidence ?? (mode === 'clearance' ? { distance: 0.04, clearance: clearance ?? 0.05, closestPoints: { first: [0, 0, 0], second: [0.04, 0, 0] } }
          : mode === 'volume-overlap' ? { witness: { kind: 'surface-crossing', point: [1, 2, 3] } } : {}),
        flags: r.flags ?? {}, unitId: r.unitId ?? units[0]?.unitId ?? 'u0' };
    })
    .sort((x, y) => refCmp([x.pair.first.modelKey, x.pair.first.dbId], [y.pair.first.modelKey, y.pair.first.dbId])
      || refCmp([x.pair.second.modelKey, x.pair.second.dbId], [y.pair.second.modelKey, y.pair.second.dbId]));
  return {
    schemaVersion: 1, runId, testRef: { testId, revision: 1, semanticDigest },
    definition: { schemaVersion: 1, testId, revision: 1, name: 'n', mode, ...(mode === 'clearance' ? { clearance } : {}),
      selectionA: { entries: [{ kind: 'model', modelKey: models[0].modelKey }] }, selectionB: { entries: [{ kind: 'model', modelKey: models[0].modelKey }] }, ...definitionOverrides },
    derivedFromRunId: null,
    outcome: { status, environmentSensitive, environmentSensitiveCauses: [], coverage, integrity, freshness, reasons: [] }, // freshness = the BARE state (§8.3)
    provenance: { registrySessionId, libraryVersion, determinismClass, placementVerified: false,
      models: models.map((m) => ({ modelKey: m.modelKey, modelVersion: m.modelVersion, placementGeneration, scopeDigests: scopeDigests[m.modelKey] ?? { population: null, roots: [] } })) },
    ledger: { planExists: true, pairSpaceTotal: ledgerUnits.filter((u) => u.kind === 'leaf').reduce((n, u) => n + u.pairSpaceWeight, 0), emptyOperand: false,
      units: ledgerUnits, rootOwners, unresolvedSelections: [], unreachablePopulation: unreachable.map((u) => ({ ...u })), hierarchyInternal,
      planningGaps, exclusions: [], warnings: [], budgetExhausted: false, firstRefusalUnitId: null },
    results: clashResults,
    diagnostics: { total: 0, countsByReason: {}, completenessAffectingUpperBound: 0, omittedReasonOccurrences: 0, unclassifiedOccurrences: 0, ...diagnostics },
    statistics: {}, digests: { digestVersion: 1, pairSetDigest: 'sha256:p', ledgerDigest: 'sha256:l' }, sealed: true,
  };
}

/** Convenience: one evaluated unit u1 (source root 100 vs targets 200,300) over the default model M. */
export const U1 = { unitId: '1.0', source: { modelKey: 'M', roots: [100] }, targets: [{ modelKey: 'M', roots: [200, 300] }] };
```

```js
// test/clashtest/derive/support/harness.mjs  — fake clock + scheduler spy (P8-local; P0's createFakeClock has no hold()/releaseAll())
export function makeHarness({ tickMs = 0 } = {}) {
  let t = 0; let holding = false; const waiters = [];
  const h = {
    yields: 0, onYield: null,
    now: () => (t += tickMs),
    yieldToScheduler() {
      h.yields += 1; h.onYield?.(h.yields);
      return holding ? new Promise((r) => waiters.push(r)) : Promise.resolve();
    },
    hold() { holding = true; },
    releaseAll() { holding = false; for (const r of waiters.splice(0)) r(); },
  };
  return h;
}
```

- [ ] **Step 2: Write the thin consumer test** (`test/clashtest/derive/status.consumer.test.mjs`) — import surface, "no second copy", fixture/reader shape agreement, and the `cls` marker. Nothing here restates a §12.5 rule.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger, createStatusReader, buildStatusReaderSteps, getPairStatus, getElementStatus } from '../../../clashtest/results/status.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const pair = (a, b) => ({ first: { modelKey: 'M', dbId: a }, second: { modelKey: 'M', dbId: b } });
const drain = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };

test('D4: the status surface is P5\'s; P8 ships no second copy of the reader or the ledger layout reader', async () => {
  for (const f of [readLedger, createStatusReader, buildStatusReaderSteps, getPairStatus, getElementStatus]) assert.equal(typeof f, 'function');
  await assert.rejects(import('../../../clashtest/derive/status.js'), { code: 'ERR_MODULE_NOT_FOUND' });
  await assert.rejects(import('../../../clashtest/derive/ledgerReader.js'), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('P8 fixtures are a set P5\'s reader answers for; one-shot, indexed and generator forms agree', () => {
  const set = makeResultSet({ units: [U1] });
  const one = getPairStatus(set, pair(100, 200));
  assert.equal(one.verdict, 'covered-clean');
  assert.deepEqual(createStatusReader(set).pairStatus(pair(100, 200)), one);
  assert.deepEqual(drain(buildStatusReaderSteps(set)).pairStatus(pair(100, 200)), one);
  assert.equal(getElementStatus(set, { modelKey: 'M', dbId: 100 }).coverage, 'full');
  assert.equal(getPairStatus(makeResultSet({ units: [{ ...U1, outcome: 'failed', cause: 'unit-cap' }] }), pair(100, 200)).verdict, 'gap');
  const model = drain(readLedger(set));                                         // readLedger is a generator that drains to the LedgerModel ...
  assert.deepEqual(model.leaves.map((u) => u.unitId), ['1.0']);                   // ... whose `leaves` (what summarize reads) are the non-split units
  assert.deepEqual(createStatusReader(set).ledger.leaves.map((u) => u.unitId), ['1.0']);   // and the reader exposes the same model as `reader.ledger`
});

test('OPEN-2: hierarchy-internal element caveats follow the per-root `cls` marker on rootOwners rows, not the bounded examples', () => {
  const roots = Array.from({ length: 25 }, (_, i) => ({ dbId: 1000 + 10 * i, cls: 'C', ownerDbIds: [1000 + 10 * i, 1001 + 10 * i] }));
  const set = makeResultSet({ models: [{ modelKey: 'M', modelVersion: 'v1', roots: [{ dbId: 1, ownerDbIds: [1] }, ...roots] }],
    units: [{ unitId: 'u', source: { modelKey: 'M', roots: [1] }, targets: [{ modelKey: 'M', whole: true }] }] });
  assert.deepEqual(set.ledger.rootOwners[0].owners.slice(0, 2).map((o) => o.cls), ['A', 'C']);    // the marker is on the digested rows
  assert.equal(set.ledger.hierarchyInternal[0].examples.length, 20);                                // the report is bounded ...
  const last = roots[24];                                                                            // ... so this root is NOT among the examples
  assert.ok(!set.ledger.hierarchyInternal[0].examples.some((e) => e.rootDbId === last.dbId));
  assert.ok(getElementStatus(set, { modelKey: 'M', dbId: last.ownerDbIds[1] }).caveats.some((c) => c.reason === 'hierarchy-internal'));
});
```

- [ ] **Step 3: Run it; expect failure** — `node --test test/clashtest/derive/status.consumer.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/results/status.js` until P5.6 lands. (The two `assert.rejects(import(...))` cases pass as soon as the fixtures exist; they can only start failing if someone adds a second copy.)

- [ ] **Step 4: Run passing** (after P5.6) — the same command → 3 passing. If the third fails, the defect is in P5's reader or in the shape the fixture emits (`rootOwners[].owners[].cls`); reconcile against P5's `Ledger` typedef, not by editing a reader here.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git add test/clashtest/derive && git commit -m "test(clashtest): derive fixtures and P5 status-reader consumer test (P8.1)"`.

---

### Task P8.2: `DerivationContext` — limits, slots, gate, capture-first, closed options

**Files:**
- Create: `clashtest/derive/validate.js`, `clashtest/derive/steps.js`, `clashtest/derive/context.js`, `clashtest/derive/runners.js`
- Test: `test/clashtest/derive/context.test.mjs`

**Interfaces:**
- Consumes (all reconciled, table above): `resolveEngineLimits` (P0 `options.js`); `InvalidOptionsError`, `DerivationBusyError`, `DerivationAbortedError`, `CorruptResultSetError`, `EngineDisposedError` (P0 `errors.js`, one-object-argument constructors); **`captureResultSet(raw, {limits})` (P5 `results/validateResultSet.js`)**; `createSlicer` with its **`tick()`** yield point (P0 `util/slicer.js`); `comparePairIds` (P1). P0 exports no default clock or scheduler: an omitted `now` / `yieldToScheduler` is forwarded as `undefined` and defaults inside `createSlicer`.
- Produces: `createDerivationContext`, `createContextInternal`, `DERIVATION_LIMIT_KEYS`, `drive`, `assertCanonicalResultOrder`, `invalid`, `assertClosed`, `isAbortSignal`, `isJsonValue`, the **runner contract**: `{ optionKeys:string[], prepare(args, callOptions, limits) → plan /*sync; throws InvalidOptionsError*/, run(plan, capturedSets, env) → Promise }` with `env = {limits, gate, annotations}` and `gate = {check(), tick() → undefined | Promise}` (`gate.tick()` is P8's wrapper: abort check, then P0's `slicer.tick()`).

Mechanism note: the spec's scheduler/slot machinery is over-specified for a first cut; the simplest mechanism preserving the observable invariants is one `active` counter per context, a slot taken in the same synchronous prefix as capture (an `async` function runs synchronously to its first `await`), `try/finally` release, and one gate that checks `signal.aborted` on every item plus after every yield.

- [ ] **Step 1: Write the failing test** (`context.test.mjs`). It uses a fake runner registered through the `hooks.runners` seam so P8.2 is testable before any real derivation exists.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDerivationContext, createContextInternal } from '../../../clashtest/derive/context.js';
import { drive } from '../../../clashtest/derive/steps.js';
import { InvalidOptionsError, DerivationBusyError, DerivationAbortedError, EngineDisposedError } from '../../../clashtest/errors.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const many = (n) => makeResultSet({ units: [U1], results: Array.from({ length: n }, (_, i) => ({ pair: [['M', 100], ['M', 200 + i]] })) });
// A runner that sweeps every result through the gate, so slicing/abort/slots are observable.
const sweep = { optionKeys: ['signal'], prepare: () => ({}),
  async run(_p, [set], { gate }) { let n = 0; for (const _ of set.results) { const p = gate.tick(); if (p) await p; n += 1; } return n; } };
const ctxWith = (limits, h, hooks = {}) => createContextInternal({ limits: { aggregationSliceMaxItems: 2, ...limits }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() },
  { runners: { summarize: sweep, groupBy: sweep, filter: sweep, compare: sweep }, ...hooks });

test('closed options: unknown keys are InvalidOptionsError at every level', async () => {
  assert.throws(() => createDerivationContext({ bogus: 1 }), InvalidOptionsError);
  assert.throws(() => createDerivationContext({ limits: { maxResidentResultSets: 4 } }), InvalidOptionsError); // an engine limit, but not a derivation limit
  assert.throws(() => createDerivationContext({ limits: { maxConcurrentDerivations: 0 } }), InvalidOptionsError); // §17.1.1 validation via P0
  await assert.rejects(ctxWith({}, makeHarness()).summarize(many(1), { nope: true }), InvalidOptionsError);
  await assert.rejects(ctxWith({}, makeHarness()).summarize(many(1), { signal: {} }), InvalidOptionsError);
});

test('the context exposes exactly the four derivations', () => {
  assert.deepEqual(Object.keys(createDerivationContext()).sort(), ['compareResultSets', 'filter', 'groupBy', 'summarize']);
  // (that `derive/index.js` and `clashtest/index.js` export no free-standing derivation is asserted in P8.8)
});

test('sliced execution with a fake scheduler: yields between slices of aggregationSliceMaxItems', async () => {
  const h = makeHarness(); const ctx = ctxWith({}, h);
  assert.equal(await ctx.summarize(many(10)), 10);
  assert.ok(h.yields >= 4 && h.yields <= 10, `yields=${h.yields}`); // 10 items / 2 per slice
});

test('sliced execution honours the time budget on an injected clock', async () => {
  const h = makeHarness({ tickMs: 5 }); // every now() read advances 5 ms > sliceBudgetMs (4)
  const ctx = createContextInternal({ limits: { aggregationSliceMaxItems: 100000 }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, { runners: { summarize: sweep, groupBy: sweep, filter: sweep, compare: sweep } });
  await ctx.summarize(many(200));
  assert.ok(h.yields >= 1, 'a time-exhausted slice must yield');
});

test('DerivationBusyError is immediate, never queues; slot is per context; freed on completion', async () => {
  const h = makeHarness(); const a = ctxWith({ maxConcurrentDerivations: 1 }, h); const b = ctxWith({ maxConcurrentDerivations: 8 }, h);
  h.hold();
  const first = a.summarize(many(10));
  await assert.rejects(a.summarize(many(1)), (e) => e instanceof DerivationBusyError && e.limit === 1);
  const others = Array.from({ length: 8 }, () => b.summarize(many(10)));      // eighth on the other context is fine
  await assert.rejects(b.summarize(many(1)), DerivationBusyError);            // the ninth is not
  h.releaseAll(); await Promise.all([first, ...others]);
  assert.equal(await a.summarize(many(1)), 1);                                // slot was released
});

test('R21-3: the slot is taken BEFORE capture; a busy context never captures', async () => {
  const h = makeHarness(); let captures = 0;
  const ctx = ctxWith({ maxConcurrentDerivations: 1 }, h, { capture: (raw) => { captures += 1; return structuredClone(raw); } });
  h.hold(); const first = ctx.summarize(many(10)); assert.equal(captures, 1);
  await assert.rejects(ctx.summarize(many(10)), DerivationBusyError); assert.equal(captures, 1);
  h.releaseAll(); await first;
});

test('capture-first: mutating the caller object right after the call cannot change the result', async () => {
  const h = makeHarness(); const set = many(6); const p = ctxWith({}, h).summarize(set);
  set.results.length = 0;                       // synchronous mutation after the call, before any await resumes
  assert.equal(await p, 6);
});

test('abort mid-derivation: DerivationAbortedError, stops within a slice, frees the slot', async () => {
  const h = makeHarness(); const ac = new AbortController(); const ctx = ctxWith({ maxConcurrentDerivations: 1 }, h);
  h.onYield = (n) => { if (n === 2) ac.abort(); };
  await assert.rejects(ctx.summarize(many(100), { signal: ac.signal }), DerivationAbortedError);
  assert.ok(h.yields <= 3, `stopped promptly, yields=${h.yields}`);
  h.onYield = null; assert.equal(await ctx.summarize(many(2)), 2);
});

test('an already-aborted signal rejects before taking a slot or capturing', async () => {
  let captures = 0; const ac = new AbortController(); ac.abort();
  const ctx = ctxWith({}, makeHarness(), { capture: (r) => { captures += 1; return r; } });
  await assert.rejects(ctx.summarize(many(1), { signal: ac.signal }), DerivationAbortedError); assert.equal(captures, 0);
});

test('assertOpen hook (engine binding): a disposed engine rejects EngineDisposedError', async () => {
  const ctx = ctxWith({}, makeHarness(), { assertOpen: () => { throw new EngineDisposedError({}); } });
  await assert.rejects(ctx.summarize(many(1)), EngineDisposedError);
});

test('drive(): a generator step that yields to the gate can be aborted', async () => {
  const ac = new AbortController(); const gate = { check() { if (ac.signal.aborted) throw new DerivationAbortedError({}); }, tick() { ac.abort(); this.check(); } };
  await assert.rejects(drive((function* () { yield; yield; })(), gate), DerivationAbortedError);
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/context.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/derive/context.js`.

- [ ] **Step 3: Implement `validate.js`, `steps.js`, `runners.js`.**

```js
// clashtest/derive/validate.js
import { InvalidOptionsError } from '../errors.js';
export const invalid = (code, path) => new InvalidOptionsError({ issues: [{ path, code, message: code }] });
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
export function assertClosed(obj, allowed, path) {
  if (!isPlainObject(obj)) throw invalid('not-an-object', path);
  const bad = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (bad.length) throw new InvalidOptionsError({ issues: bad.map((k) => ({ path: `${path}.${k}`, code: 'unknown-key', message: 'unknown-key' })) });
}
export const isAbortSignal = (s) => s !== null && typeof s === 'object' && typeof s.aborted === 'boolean' && typeof s.addEventListener === 'function';
export function isJsonValue(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  return isPlainObject(v) && Object.values(v).every(isJsonValue);
}
```

```js
// clashtest/derive/steps.js
import { CorruptResultSetError } from '../errors.js';
import { comparePairIds } from '../identity/ids.js';
/** Async driver: one gate tick per yielded step (a step is one work item). Drives P5's `buildStatusReaderSteps` (one `yield` per record) as well as P8's own step generators. */
export async function drive(it, gate) {
  for (;;) { const r = it.next(); if (r.done) return r.value; const p = gate.tick(); if (p !== undefined) await p; }
}
/** §13.1/§11.3: results are strictly ascending by PairId. A raw (unvalidated) set that is not is refused, never reordered. */
export function* assertCanonicalResultOrder(results, runId) {
  for (let i = 1; i < results.length; i++) {
    if (comparePairIds(results[i - 1].pair, results[i].pair) >= 0) throw new CorruptResultSetError({ runId, issues: [{ path: `results[${i}]`, code: 'order' }] });
    yield;
  }
}
```

```js
// clashtest/derive/runners.js — the only file a later task edits (one import + one entry per derivation)
export const DEFAULT_RUNNERS = {};
```

- [ ] **Step 4: Implement `context.js`.**

```js
// clashtest/derive/context.js
import { DerivationBusyError, DerivationAbortedError, CorruptResultSetError } from '../errors.js';
import { resolveEngineLimits } from '../options.js';
import { captureResultSet } from '../results/validateResultSet.js';   // P5's (N29), not a P0 util
import { createSlicer } from '../util/slicer.js';
import { assertClosed, invalid, isAbortSignal } from './validate.js';
import { DEFAULT_RUNNERS } from './runners.js';

export const DERIVATION_LIMIT_KEYS = Object.freeze(['maxConcurrentDerivations', 'maxFacetsPerGroupBy', 'maxFilterClauses',
  'maxGroupMemberships', 'maxComparisonEntries', 'sliceBudgetMs', 'aggregationSliceMaxItems']);

export function assertDerivable(set) {
  const bad = (path) => { throw new CorruptResultSetError({ runId: typeof set?.runId === 'string' ? set.runId : null, issues: [{ path, code: 'not-derivable' }] }); };
  if (set === null || typeof set !== 'object') bad('');
  for (const k of ['results', 'ledger', 'provenance', 'outcome']) if (set[k] === null || typeof set[k] !== 'object') bad(k);
  if (!Array.isArray(set.results)) bad('results');
  if (!Array.isArray(set.ledger.units)) bad('ledger');   // top-level container only; every other ledger field is P5's reader's business (a malformed one surfaces as CorruptResultSetError via invoke's TypeError/RangeError mapping)
}

function createGate(slicer, signal) {
  const check = () => { if (signal && signal.aborted) throw new DerivationAbortedError({}); };
  return { check, tick() { check(); const p = slicer.tick(); return p === undefined ? undefined : p.then(check); } };
}

export function createDerivationContext(options = {}) { return createContextInternal(options, {}); }

export function createContextInternal(options = {}, hooks = {}) {
  assertClosed(options, ['limits', 'yieldToScheduler', 'now'], 'options');
  const rawLimits = options.limits ?? {};
  assertClosed(rawLimits, DERIVATION_LIMIT_KEYS, 'options.limits');
  const all = resolveEngineLimits(rawLimits); // §17.1.1 defaults + validation live in P0, not here
  const limits = Object.freeze(Object.fromEntries(DERIVATION_LIMIT_KEYS.map((k) => [k, all[k]])));
  const { now, yieldToScheduler } = options;                       // possibly undefined: createSlicer defaults them (P0 exports no defaults)
  const capture = hooks.capture ?? ((raw) => captureResultSet(raw, { limits: all }));   // P5: {limits} = the resolved engine limits
  const runners = hooks.runners ?? DEFAULT_RUNNERS;
  let active = 0; // per context; never module-global

  async function invoke(name, rawSets, callOptions, args) {
    // Everything up to the first `await` runs synchronously: validation, slot, capture (R19-1, R21-3).
    hooks.assertOpen?.();
    const runner = runners[name];
    const opts = callOptions ?? {};
    assertClosed(opts, runner.optionKeys, `${name}.options`);
    const { signal } = opts;
    if (signal !== undefined && !isAbortSignal(signal)) throw invalid('bad-signal', `${name}.options.signal`);
    const plan = runner.prepare(args, opts, limits);                // sync closed-schema/bounds validation
    if (signal?.aborted) throw new DerivationAbortedError({});
    if (active >= limits.maxConcurrentDerivations) throw new DerivationBusyError({ limit: limits.maxConcurrentDerivations });
    active += 1;                                                    // slot BEFORE capture
    try {
      const sets = rawSets.map((raw) => { const s = capture(raw); assertDerivable(s); return s; });
      const slicer = createSlicer({ now, yieldToScheduler, sliceBudgetMs: limits.sliceBudgetMs, maxItemsPerSlice: limits.aggregationSliceMaxItems });
      const env = { limits, gate: createGate(slicer, signal), annotations: opts.annotations };
      try { return await runner.run(plan, sets, env); }
      catch (e) { // a captured-but-unvalidated set with a malformed ledger surfaces as TypeError/RangeError: refuse, do not guess
        if (e instanceof TypeError || e instanceof RangeError) throw new CorruptResultSetError({ runId: sets[0]?.runId ?? null, issues: [{ path: 'ledger', code: 'malformed' }] });
        throw e;
      }
    } finally { active -= 1; }
  }

  return Object.freeze({
    summarize: (resultSet, o) => invoke('summarize', [resultSet], o, {}),
    groupBy: (resultSet, facets, o) => invoke('groupBy', [resultSet], o, { facets }),
    filter: (resultSet, clauses, o) => invoke('filter', [resultSet], o, { clauses }),
    compareResultSets: (base, next, o = {}) => invoke('compare', [base, next], o, {}),
  });
}
```

Note (error mapping): `invoke` is `async`, so a synchronous `InvalidOptionsError`/`EngineDisposedError` becomes a **rejected Promise**, keeping the "one shape" rule of §13.6; `createDerivationContext` itself throws synchronously (constructor-time validation, like `createClashTestEngine`).

Note (capture limits): standalone, the context's capture uses the limits it resolved from its own (derivation-only) `limits` option, i.e. P0's default reader limits for everything else. **Engine-bound** (Task P8.8) the engine passes a `capture` hook that supplies the *engine's* resolved limits instead, so `maxCapturedNodes` is the engine's, not the default.

- [ ] **Step 5: Run passing** — `node --test test/clashtest/derive/context.test.mjs` → all pass.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): derivation context with slots, gate, capture-first (P8.2)"`.

---

### Task P8.3: Facets and the attribute seam

§14.2 built-in facets, §14.3 value ordering, R15-5 range safety; attribute facets go through one seam and are `unavailable` in P8.

**Files:**
- Create: `clashtest/derive/facets.js`, `clashtest/derive/attributeSeam.js`
- Test: `test/clashtest/derive/facets.test.mjs`

**Interfaces:**
- Consumes: `canonicalJson` (P0), `compareElementRefs` (P1), `invalid`, `isPlainObject` (P8.2), `FacetRangeError` (P0), the `StatusReader` P5's `buildStatusReaderSteps` returns, supplied by the derivation runner as `env.reader` (the `caveated` facet is its only user).
- Produces: `parseFacetSpec`, `compareFacetValues`, `resolveAttributes`, `Facet`.

Facet spec forms (closed): a string for parameterless facets and attribute facets (`'mode'`, `'element'`, `'attrEither:level'`), or `{facet:'locationCell', size}` / `{facet:'distanceBucket', width}` (size/width finite > 0, else `InvalidOptionsError`). `facetId` is the string form (`'locationCell'`, `'attrEither:level'`); `params` is `{}` / `{size}` / `{width}`.

- [ ] **Step 1: Write the failing test.**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFacetSpec, compareFacetValues } from '../../../clashtest/derive/facets.js';
import { resolveAttributes } from '../../../clashtest/derive/attributeSeam.js';
import { InvalidOptionsError, FacetRangeError } from '../../../clashtest/errors.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const R = (over = {}) => makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]], ...over }] }).results[0];
const clr = (distance, p1 = [0, 0, 0], p2 = [0, 0, 0]) => ({ distance, clearance: 0.5, closestPoints: { first: p1, second: p2 } });
const vals = (spec, r, env = {}) => parseFacetSpec(spec).values(r, env);

test('facet specs are closed and validated', () => {
  for (const bad of ['nope', 'locationCell', { facet: 'locationCell' }, { facet: 'locationCell', size: 0 }, { facet: 'locationCell', size: NaN },
    { facet: 'locationCell', size: Infinity }, { facet: 'distanceBucket', width: -1 }, { facet: 'mode', extra: 1 }, { facet: 'locationCell', size: 1, width: 1 }, 42, null]) {
    assert.throws(() => parseFacetSpec(bad), InvalidOptionsError, JSON.stringify(bad));
  }
  const f = parseFacetSpec({ facet: 'locationCell', size: 2 });
  assert.deepEqual([f.facetId, f.params, f.multiValued, f.numeric], ['locationCell', { size: 2 }, false, false]);
  assert.equal(parseFacetSpec('element').multiValued, true);
  assert.equal(parseFacetSpec('attrEither:level').multiValued, true);
  assert.equal(parseFacetSpec({ facet: 'distanceBucket', width: 1 }).numeric, true);
});

test('single- and multi-valued built-ins', () => {
  const r = R();
  assert.deepEqual(vals('mode', r), ['volume-overlap']);
  assert.deepEqual(vals('pairModels', r), [['M', 'M']]);
  assert.deepEqual(vals('crossModel', r), [false]);
  assert.deepEqual(vals('elementFirst', r), [{ modelKey: 'M', dbId: 100 }]);
  assert.deepEqual(vals('element', r), [{ modelKey: 'M', dbId: 100 }, { modelKey: 'M', dbId: 200 }]);
  assert.deepEqual(vals('caveated', r, { reader: { pairStatus: () => ({ verdict: 'covered-caveated' }) } }), [true]);
});

test('locationCell: negative and boundary coordinates floor; -0 normalizes; no location is null', () => {
  const at = (p) => R({ evidence: { witness: { kind: 'surface-crossing', point: p } } });
  const cell = (r, size = 1) => vals({ facet: 'locationCell', size }, r)[0];
  assert.deepEqual(cell(at([-0.5, 1, -1])), [-1, 1, -1]);
  assert.deepEqual(cell(at([-0, 0, 0.999999])), [0, 0, 0]);
  assert.deepEqual(cell(at([2, 4, 6]), 2), [1, 2, 3]);
  assert.equal(Object.is(cell(at([-0, 0, 0]))[0], 0), true);
  assert.equal(cell(R({ evidence: { witness: null } })), null);
  const clrR = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(1, [0, 0, 0], [2, 2, 2]) }] }).results[0];
  assert.deepEqual(cell(clrR), [1, 1, 1]); // midpoint
  assert.notEqual(canonicalJson(['locationCell', { size: 1 }, null]), canonicalJson(['locationCell', { size: 1 }, [0, 0, 0]]));
});

test('R15-5: unsafe / non-finite buckets are FacetRangeError, never null or saturated', () => {
  const far = R({ evidence: { witness: { kind: 'surface-crossing', point: [1e30, 0, 0] } } });
  assert.throws(() => vals({ facet: 'locationCell', size: 1e-300 }, far), (e) => e instanceof FacetRangeError && e.facetId === 'locationCell');
  assert.throws(() => vals({ facet: 'locationCell', size: 1 }, far), FacetRangeError); // 1e30 is finite but not a safe integer
  const d = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(Number.MAX_VALUE) }] }).results[0];
  assert.throws(() => vals({ facet: 'distanceBucket', width: 1e-300 }, d), FacetRangeError);
});

test('distanceBucket is clearance-only', () => {
  const d = makeResultSet({ mode: 'clearance', clearance: 0.5, units: [U1], results: [{ pair: [['M', 100], ['M', 200]], evidence: clr(0.26) }] }).results[0];
  assert.deepEqual(vals({ facet: 'distanceBucket', width: 0.1 }, d), [2]);
  assert.deepEqual(vals({ facet: 'distanceBucket', width: 0.1 }, R()), [null]);
});

test('compareFacetValues: numbers numeric, strings by code unit, arrays lexicographic, refs by element order, null last', () => {
  const sorted = (xs) => [...xs].sort(compareFacetValues);
  assert.deepEqual(sorted([10, 9, -1, null, 2]), [-1, 2, 9, 10, null]);
  assert.deepEqual(sorted(['b', 'B', 'a', null]), ['B', 'a', 'b', null]);
  assert.deepEqual(sorted([[1, 2, 3], [1, 2], [0, 9, 9], null]), [[0, 9, 9], [1, 2], [1, 2, 3], null]);
  assert.deepEqual(sorted([{ modelKey: 'b', dbId: 1 }, { modelKey: 'a', dbId: 2 }, { modelKey: 'a', dbId: 1 }]).map((r) => `${r.modelKey}${r.dbId}`), ['a1', 'a2', 'b1']);
  assert.deepEqual(sorted([true, false]), [false, true]);
});

test('attribute facets: unavailable (not an error) with no snapshot; the seam is the single replacement point', () => {
  const set = makeResultSet({ units: [U1] });
  assert.deepEqual(resolveAttributes(set, undefined, ['level']), { available: false, reason: 'annotation-absent' });
  assert.equal(resolveAttributes(set, { any: 'snapshot' }, ['level']).available, false); // annotation layer is out of P8 scope
  const f = parseFacetSpec('attrFirst:level');
  assert.equal(f.attr.name, 'level');
  const attrs = { available: true, get: (ref, name) => (ref.dbId === 100 ? `L-${name}` : null) };
  assert.deepEqual(f.values(R(), { attrs }), ['L-level']);
  assert.deepEqual(parseFacetSpec('attrEither:level').values(R(), { attrs }), ['L-level', null]);
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/facets.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/derive/facets.js`.

- [ ] **Step 3: Implement `attributeSeam.js` and `facets.js`.**

```js
// clashtest/derive/attributeSeam.js
// The single seam for the excluded annotation layer (§14.5). A follow-up replaces this body with the four compatibility
// checks (runId, semanticDigest, every provenance.models[*].modelVersion, referenced names) and returns {available:true, get}.
export function resolveAttributes(_resultSet, annotations, _names) {
  if (annotations === undefined || annotations === null) return { available: false, reason: 'annotation-absent' };
  return { available: false, reason: 'annotation-layer-not-implemented' };
}
```

```js
// clashtest/derive/facets.js
import { FacetRangeError } from '../errors.js';
import { compareElementRefs } from '../identity/ids.js';
import { assertClosed, invalid, isPlainObject } from './validate.js';

function safeBucket(x, size, facetId) {
  const q = Math.floor(x / size);
  if (!Number.isSafeInteger(q)) throw new FacetRangeError({ facetId }); // covers Infinity/NaN and > 2^53
  return q + 0;                                                        // -0 -> 0
}
function locationPoint(r) {
  const ev = r.evidence;
  if (r.mode === 'volume-overlap') return ev?.witness?.point ?? null;
  if (r.mode === 'clearance' && ev?.closestPoints) { const { first: a, second: b } = ev.closestPoints; return [0, 1, 2].map((i) => a[i] / 2 + b[i] / 2); }
  return null;
}
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

const single = (facetId, fn, extra = {}) => ({ facetId, params: {}, multiValued: false, numeric: false, attr: null, needsReader: false, values: (r, env) => [fn(r, env)], ...extra });
const BUILTIN = {
  mode: () => single('mode', (r) => r.mode),
  pairModels: () => single('pairModels', (r) => [r.pair.first.modelKey, r.pair.second.modelKey]),
  crossModel: () => single('crossModel', (r) => r.pair.first.modelKey !== r.pair.second.modelKey),
  elementFirst: () => single('elementFirst', (r) => r.pair.first),
  elementSecond: () => single('elementSecond', (r) => r.pair.second),
  element: () => ({ ...single('element', null), multiValued: true, values: (r) => [r.pair.first, r.pair.second] }),
  caveated: () => single('caveated', (r, env) => env.reader.pairStatus(r.pair).verdict === 'covered-caveated', { needsReader: true }),
};
const PARAM = {
  locationCell: { key: 'size', make: (size) => single('locationCell', (r) => { const p = locationPoint(r); return p === null ? null : p.map((c) => safeBucket(c, size, 'locationCell')); }, { params: { size } }) },
  distanceBucket: { key: 'width', make: (width) => single('distanceBucket', (r) => (r.mode === 'clearance' ? safeBucket(r.evidence.distance, width, 'distanceBucket') : null), { params: { width }, numeric: true }) },
};

function attrFacet(which, name, path) {
  if (name.length === 0 || name.length > 128) throw invalid('bad-attribute-name', path);
  const facetId = `attr${which[0].toUpperCase()}${which.slice(1)}:${name}`;
  const get = (ref, env) => env.attrs.get(ref, name) ?? null;
  const values = which === 'first' ? (r, env) => [get(r.pair.first, env)] : which === 'second' ? (r, env) => [get(r.pair.second, env)]
    : (r, env) => [get(r.pair.first, env), get(r.pair.second, env)];
  return { facetId, params: {}, multiValued: which === 'either', numeric: true, attr: { which, name }, needsReader: false, values };
}

export function parseFacetSpec(spec, path = 'facet') {
  if (typeof spec === 'string') {
    const m = /^attr(First|Second|Either):([\s\S]+)$/.exec(spec);
    if (m) return attrFacet(m[1].toLowerCase(), m[2], path);
    if (Object.hasOwn(BUILTIN, spec)) return BUILTIN[spec]();
    throw invalid(Object.hasOwn(PARAM, spec) ? 'missing-param' : 'unknown-facet', path);
  }
  if (!isPlainObject(spec) || typeof spec.facet !== 'string') throw invalid('bad-facet', path);
  const p = PARAM[spec.facet];
  if (p) { assertClosed(spec, ['facet', p.key], path); if (!pos(spec[p.key])) throw invalid('bad-param', `${path}.${p.key}`); return p.make(spec[p.key]); }
  assertClosed(spec, ['facet'], path);
  return parseFacetSpec(spec.facet, path);
}

export function compareFacetValues(a, b) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (Array.isArray(a)) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const c = compareFacetValues(a[i], b[i]); if (c) return c; } return a.length - b.length; }
  if (typeof a === 'object') return compareElementRefs(a, b);
  if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
```

(Order for booleans and element refs is not stated in §14.3; the choices above — `false` before `true`, refs by element order — are recorded in Open items.)

- [ ] **Step 4: Run passing** — `node --test test/clashtest/derive/facets.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): built-in facets and attribute seam (P8.3)"`.

---

### Task P8.4: `groupBy` — group identity, determinism, bounds

§14.3 (GroupId, ordering, partition vs cover), §14.4 bounds. Registers `groupBy` in `runners.js`.

**Files:**
- Create: `clashtest/derive/groupBy.js`; Modify: `clashtest/derive/runners.js`
- Test: `test/clashtest/derive/groupBy.test.mjs`

**Interfaces:**
- Consumes: `parseFacetSpec`, `compareFacetValues` (P8.3), `resolveAttributes` (P8.3), `buildStatusReaderSteps` (**P5 `results/status.js`**), `drive`, `assertCanonicalResultOrder` (P8.2), `GroupingTooLargeError`, `canonicalJson`.
- Produces: `runGroupBy`, `groupByRunner` (`optionKeys ['annotations','signal']`).

Mechanism: one pass in canonical result order; per result the (deduplicated) value lists are computed, the number of facet paths `Π|list|` is added to a running membership count **before** that result is placed (over `maxGroupMemberships` ⇒ throw, tree discarded). Group ids: `groupId = canonicalJson([facetId, params, value])` (§14.3); `path` = the ancestor `groupId`s plus its own (a group's identity is its path). Values equal within one result's list are collapsed (a result is in a group once).

- [ ] **Step 1: Write the failing test.**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { runGroupBy } from '../../../clashtest/derive/groupBy.js';
import { parseFacetSpec } from '../../../clashtest/derive/facets.js';
import { InvalidOptionsError, GroupingTooLargeError, FacetRangeError, DerivationAbortedError, DerivationBusyError, CorruptResultSetError } from '../../../clashtest/errors.js';
import { makeResultSet } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2, 3, 4].map((d) => ({ dbId: d, ownerDbIds: [d] })) },
  { modelKey: 'B', modelVersion: 'v', roots: [1, 2].map((d) => ({ dbId: d, ownerDbIds: [d] })) }];
const unit = { unitId: 'u', source: { modelKey: 'A', roots: [1, 2, 3, 4] }, targets: [{ modelKey: 'B', whole: true }, { modelKey: 'A', roots: [1, 2, 3, 4] }] };
const P = (a, b) => ({ pair: [a, b] });
const pairs = [P(['A', 1], ['B', 1]), P(['A', 1], ['B', 2]), P(['A', 2], ['B', 1]), P(['A', 3], ['A', 4])];
const mk = (over = {}) => makeResultSet({ models, units: [unit], results: pairs, ...over });
const ctx = (h = makeHarness(), limits = {}) => createContextInternal({ limits, now: h.now, yieldToScheduler: () => h.yieldToScheduler() });
// (context.js resolves DEFAULT_RUNNERS; this task registers groupBy there — see Step 3.)
const gb = (set, facets, o) => ctx().groupBy(set, facets, o);

test('single-valued facets PARTITION; multi-valued facets COVER (counts asserted accordingly)', async () => {
  const set = mk();
  const byCross = await gb(set, ['crossModel']);
  assert.equal(byCross.groups.reduce((n, g) => n + g.count, 0), set.results.length);
  const byEl = await gb(set, ['element']);
  assert.equal(byEl.facets[0].multiValued, true);
  assert.equal(byEl.groups.reduce((n, g) => n + g.count, 0), 2 * set.results.length); // covers, not partitions
  assert.equal(byEl.memberships, 2 * set.results.length);
});

test('groups are ordered by value, members in canonical result order, null last', async () => {
  const set = mk();
  const g = await gb(set, ['crossModel']);
  assert.deepEqual(g.groups.map((x) => x.value), [false, true]);
  assert.deepEqual(g.groups[1].members, set.results.filter((r) => r.pair.first.modelKey !== r.pair.second.modelKey).map((r) => r.resultId));
  const loc = await gb(mk({ results: [{ pair: [['A', 1], ['B', 1]], evidence: { witness: null } }, { pair: [['A', 3], ['A', 4]], evidence: { witness: { kind: 'surface-crossing', point: [5, 0, 0] } } }] }), [{ facet: 'locationCell', size: 1 }]);
  assert.deepEqual(loc.groups.map((x) => x.value), [[5, 0, 0], null]);
});

test('GroupId is canonical JSON of [facetId, params, value], stable across contexts and reruns; nested identity is the path', async () => {
  const set = mk();
  const a = await gb(set, ['mode', 'crossModel']); const b = await gb(structuredClone(set), ['mode', 'crossModel']);
  assert.deepEqual(a, b);
  const top = a.groups[0]; const leaf = top.children[0];
  assert.equal(top.groupId, JSON.stringify(['mode', {}, 'volume-overlap']));
  assert.deepEqual(leaf.path, [top.groupId, leaf.groupId]);
});

test('determinism: the same logical set built from a shuffled construction order groups identically', async () => {
  const shuffled = mk({ results: [pairs[3], pairs[1], pairs[0], pairs[2]] });
  assert.deepEqual(await gb(shuffled, ['element']), await gb(mk(), ['element']));
});

test('a raw set whose results are NOT in canonical order is refused, never silently reordered', async () => {
  const set = mk(); set.results.reverse();
  await assert.rejects(gb(set, ['mode']), CorruptResultSetError);
});

test('element-ref collision vectors never alias: group ids embed values via canonical JSON, never by delimiter concatenation', async () => {
  const set = makeResultSet({ models: [{ modelKey: 'a:1', modelVersion: 'v', roots: [{ dbId: 2, ownerDbIds: [2] }] }, { modelKey: 'a', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }, { dbId: 9, ownerDbIds: [9] }] }],
    units: [{ unitId: 'u', source: { modelKey: 'a', roots: [1] }, targets: [{ modelKey: 'a:1', whole: true }, { modelKey: 'a', roots: [9] }] }],
    results: [P(['a', 1], ['a:1', 2]), P(['a', 9], ['a', 1])] });
  const g = await gb(set, ['element']);
  const ids = g.groups.map((x) => x.groupId);
  assert.equal(g.groups.length, 3);                       // {a,1}, {a,9}, {a:1,2} stay three distinct groups
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(JSON.stringify(['element', {}, { dbId: 2, modelKey: 'a:1' }])));   // ids embed values via canonical JSON, never by delimiter concatenation
});

test('unavailable attribute facets: omitted from the levels and listed; built-ins unaffected; never an error', async () => {
  const g = await gb(mk(), ['mode', 'attrEither:level', 'attrFirst:cat']);
  assert.deepEqual(g.facets.map((f) => f.facetId), ['mode']);
  assert.deepEqual(g.unavailable.map((u) => u.facetId), ['attrEither:level', 'attrFirst:cat']);
  assert.equal(g.unavailable[0].reason, 'annotation-absent');
  assert.equal(g.groups.length, 1);
});

test('attribute facets when a resolver IS available (internal path; the seam replacement is the follow-up)', async () => {
  const set = mk(); const attrs = { available: true, get: (ref, name) => (ref.modelKey === 'A' ? 'L1' : 'L2') };
  const parsed = ['attrEither:level'].map((f) => parseFacetSpec(f));
  const env = { limits: { maxGroupMemberships: 1000 }, gate: { tick() {}, check() {} } };
  const g = await runGroupBy({ set, parsed, attrs, env });
  assert.deepEqual(g.groups.map((x) => [x.value, x.count]), [['L1', 4], ['L2', 3]]); // {L1} for AA, {L1,L2} for AB: dedup within a result
});

test('range safety: FacetRangeError, no partial grouping', async () => {
  const set = mk({ results: [{ pair: [['A', 1], ['B', 1]], evidence: { witness: { kind: 'surface-crossing', point: [1e30, 0, 0] } } }] });
  await assert.rejects(gb(set, [{ facet: 'locationCell', size: 1e-300 }]), FacetRangeError);
});

test('bounds: facets > max, repeated facet, no facets => InvalidOptionsError', async () => {
  const c = ctx(makeHarness(), { maxFacetsPerGroupBy: 2 });
  await assert.rejects(c.groupBy(mk(), ['mode', 'crossModel', 'element']), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), ['mode', 'mode']), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), []), InvalidOptionsError);
  await assert.rejects(c.groupBy(mk(), ['mode'], { extra: 1 }), InvalidOptionsError);
});

test('GroupingTooLargeError comes from the incremental count BEFORE allocation, with no partial grouping', async () => {
  const probe = { allocated: 0, onMembership() { this.allocated += 1; } };
  const parsed = ['element', 'attrEither:x'].map((f) => parseFacetSpec(f)); // two DISTINCT multi-valued facets
  const attrs = { available: true, get: (ref) => `v${ref.dbId}` };
  const env = { limits: { maxGroupMemberships: 10 }, gate: { tick() {}, check() {} } };
  const big = mk();                                                       // 4 results x 4 facet paths (2 elements x 2 attribute values) = 16 > 10
  await assert.rejects(runGroupBy({ set: big, parsed, attrs, env, probe }), (e) => e instanceof GroupingTooLargeError && e.limit === 10 && e.observed > 10);
  assert.ok(probe.allocated <= 10, `allocated ${probe.allocated} <= limit`);
  const single = await runGroupBy({ set: big, parsed: [parseFacetSpec('mode')], attrs, env });   // same size, single-valued: succeeds
  assert.equal(single.memberships, big.results.length);
});

test('sliced + abort + busy through the context', async () => {
  const h = makeHarness(); const many = mk({ results: Array.from({ length: 4 }, (_, i) => P(['A', i + 1], ['B', 1])) });
  const c = ctx(h, { aggregationSliceMaxItems: 1, maxConcurrentDerivations: 2 });
  await c.groupBy(many, ['mode']); assert.ok(h.yields >= 3);
  const ac = new AbortController(); const start = h.yields; h.onYield = (n) => n === start + 1 && ac.abort();
  await assert.rejects(c.groupBy(many, ['mode'], { signal: ac.signal }), DerivationAbortedError);
  h.onYield = null; h.hold(); const t = [c.groupBy(many, ['mode']), c.groupBy(many, ['mode'])];
  await assert.rejects(c.groupBy(many, ['mode']), DerivationBusyError);
  h.releaseAll(); await Promise.all(t);
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/groupBy.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/derive/groupBy.js`.

- [ ] **Step 3: Implement `groupBy.js` and register it.**

```js
// clashtest/derive/groupBy.js
import { GroupingTooLargeError } from '../errors.js';
import { canonicalJson } from '../util/canonical.js';
import { parseFacetSpec, compareFacetValues } from './facets.js';
import { resolveAttributes } from './attributeSeam.js';
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { invalid } from './validate.js';

const uniqueValues = (list) => { const seen = new Map(); for (const v of list) { const key = canonicalJson(v); if (!seen.has(key)) seen.set(key, { key, value: v }); } return [...seen.values()]; };

function place(container, li, lists, levels, resultId, idx, path, probe) {
  const last = li === levels.length - 1;
  for (const { key, value } of lists[li]) {
    let node = container.get(key);
    if (!node) {
      const groupId = canonicalJson([levels[li].facetId, levels[li].params, value]);
      node = { value, groupId, path: [...path, groupId], count: 0, seen: -1, kids: last ? null : new Map(), members: last ? [] : null };
      container.set(key, node);
    }
    if (node.seen !== idx) { node.seen = idx; node.count += 1; }   // an inner node reached by several paths counts the result once
    if (last) { node.members.push(resultId); probe?.onMembership(); } else place(node.kids, li + 1, lists, levels, resultId, idx, node.path, probe);
  }
}
function finalize(container, levels, depth) {
  return [...container.values()].sort((a, b) => compareFacetValues(a.value, b.value)).map((n) => {
    const out = { groupId: n.groupId, path: n.path, facetId: levels[depth].facetId, params: levels[depth].params, value: n.value, count: n.count };
    if (n.members) out.members = n.members; else out.children = finalize(n.kids, levels, depth + 1);
    return out;
  });
}

export async function runGroupBy({ set, parsed, attrs, env, probe = null }) {
  const { gate, limits } = env;
  await drive(assertCanonicalResultOrder(set.results, set.runId), gate);
  const unavailable = []; const levels = [];
  for (const f of parsed) (f.attr && !attrs.available ? unavailable.push({ facetId: f.facetId, reason: attrs.reason }) : levels.push(f));
  const fenv = { attrs, reader: levels.some((l) => l.needsReader) ? await drive(buildStatusReaderSteps(set), gate) : null };
  const root = new Map(); let memberships = 0;
  for (let i = 0; i < set.results.length && levels.length; i++) {
    const r = set.results[i];
    const lists = levels.map((l) => uniqueValues(l.values(r, fenv)));       // FacetRangeError propagates: no partial grouping
    const product = lists.reduce((n, l) => n * l.length, 1);                // derived membership records for this result
    if (memberships + product > limits.maxGroupMemberships) throw new GroupingTooLargeError({ limit: limits.maxGroupMemberships, observed: memberships + product });
    memberships += product;                                                  // counted BEFORE allocating them
    place(root, 0, lists, levels, r.resultId, i, [], probe);
    const p = gate.tick(); if (p !== undefined) await p;
  }
  return { facets: levels.map(({ facetId, params, multiValued }) => ({ facetId, params, multiValued })), unavailable, total: set.results.length, memberships,
    groups: levels.length ? finalize(root, levels, 0) : [] };
}

export const attrNames = (parsed) => parsed.filter((f) => f.attr).map((f) => f.attr.name);
export const groupByRunner = {
  optionKeys: ['annotations', 'signal'],
  prepare({ facets }, _opts, limits) {
    if (!Array.isArray(facets) || facets.length < 1) throw invalid('facets-required', 'facets');
    if (facets.length > limits.maxFacetsPerGroupBy) throw invalid('too-many-facets', 'facets');
    const parsed = facets.map((f, i) => parseFacetSpec(f, `facets[${i}]`));
    const seen = new Set();
    for (const p of parsed) { const k = canonicalJson([p.facetId, p.params]); if (seen.has(k)) throw invalid('redundant-facet', 'facets'); seen.add(k); }
    return { parsed };
  },
  run: ({ parsed }, [set], env) => runGroupBy({ set, parsed, attrs: resolveAttributes(set, env.annotations, attrNames(parsed)), env }),
};
```

```js
// clashtest/derive/runners.js
import { groupByRunner } from './groupBy.js';
export const DEFAULT_RUNNERS = { groupBy: groupByRunner };
```

- [ ] **Step 4: Run passing** — `node --test test/clashtest/derive/groupBy.test.mjs test/clashtest/derive/context.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): groupBy with bounded memberships (P8.4)"`.

---

### Task P8.5: `filter` — existential truth rules

§14.4 conjunction of `{facet, op, value}`; AC-13 truth tables.

**Files:** Create `clashtest/derive/filter.js`; Modify `runners.js`; Test `test/clashtest/derive/filter.test.mjs`.

**Interfaces:** Consumes `parseFacetSpec`, `resolveAttributes`, `attrNames` (P8.4), `canonicalJson`, `isJsonValue`, `assertClosed`, `invalid`, `buildStatusReaderSteps` (P5 `results/status.js`), `drive`. Produces `clauseHolds`, `filterRunner` (`optionKeys ['annotations','signal']`); result `{matches:resultId[], count, total, unavailable:[{facetId,reason}]}`.

Clause validation (all `InvalidOptionsError`): closed keys `facet|op|value`; `op` ∈ the 8; `isNull`/`notNull` take **no** `value`; `eq` needs a JSON value; `in` an array of JSON values; `lt/lte/gt/gte` a finite number **and** a facet whose `numeric` is true (built-ins: only `distanceBucket`; attribute facets are data-dependent numeric) — `locationCell` (array-valued), `mode`, `element`, … reject. Clauses ≤ `maxFilterClauses`. A clause on an unavailable (attribute) facet is **false for every result** and the facet is listed in `unavailable`.

- [ ] **Step 1: Write the failing test.**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clauseHolds } from '../../../clashtest/derive/filter.js';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { InvalidOptionsError } from '../../../clashtest/errors.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

// [op, value list, operand, expected] — the §14.4 truth rules (existential over the value list; null never satisfies eq/in/ordering)
const T = [
  ['eq', ['a'], 'a', true], ['eq', ['a', 'b'], 'b', true], ['eq', ['a', 'b'], 'c', false], ['eq', [null], null, false], ['eq', [], 'a', false],
  ['eq', [[1, 2, 3]], [1, 2, 3], true], ['eq', [[1, 2, 3]], [1, 2, 4], false],                       // whole-array canonical-JSON equality
  ['in', ['a'], ['a', 'b'], true], ['in', ['c'], ['a', 'b'], false], ['in', [null], [null, 'a'], false], ['in', ['a', 'z'], ['z'], true], ['in', [[0, 0, 0]], [[0, 0, 0]], true],
  ['lt', [1, 5], 2, true], ['lt', [5], 2, false], ['lt', [null], 2, false], ['lt', ['x', 1], 2, true], ['lt', ['x'], 2, false], ['lte', [2], 2, true],
  ['gt', [3, null], 2, true], ['gt', [2], 2, false], ['gte', [2], 2, true], ['gte', [], 0, false],
  ['isNull', [null], undefined, true], ['isNull', [], undefined, true], ['isNull', [null, 'a'], undefined, false], ['isNull', ['a'], undefined, false],
  ['notNull', [null, 'a'], undefined, true], ['notNull', [null], undefined, false], ['notNull', [], undefined, false],
];
for (const [op, values, operand, expected] of T) test(`clauseHolds ${op} ${JSON.stringify(values)} ${JSON.stringify(operand)} => ${expected}`, () => assert.equal(clauseHolds(op, values, operand), expected));

test('isNull and notNull are exact complements over every value list', () => {
  for (const values of [[], [null], [null, null], ['a'], [null, 'a'], [0], [[1, 2, 3]]]) assert.notEqual(clauseHolds('isNull', values), clauseHolds('notNull', values));
});

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2, 3].map((d) => ({ dbId: d, ownerDbIds: [d] })) }, { modelKey: 'B', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }] }];
const unit = { unitId: 'u', source: { modelKey: 'A', roots: [1, 2, 3] }, targets: [{ modelKey: 'B', whole: true }, { modelKey: 'A', roots: [1, 2, 3] }] };
const clr = (d) => ({ distance: d, clearance: 0.5, closestPoints: { first: [0, 0, 0], second: [d, 0, 0] } });
const set = makeResultSet({ mode: 'clearance', clearance: 0.5, models, units: [unit],
  results: [{ pair: [['A', 1], ['B', 1]], evidence: clr(0.05) }, { pair: [['A', 1], ['A', 2]], evidence: clr(0.15) }, { pair: [['A', 2], ['A', 3]], evidence: clr(0.35) }] });
const ctx = (limits = {}) => createContextInternal({ limits }, {});
// canonical order of `set.results`: 0=(A1,A2) d0.15, 1=(A1,B1) d0.05, 2=(A2,A3) d0.35
const ids = (...i) => i.map((k) => set.results[k].resultId);

test('filter: conjunction, ordering on distanceBucket, eq/in on crossModel and element, isNull on locationCell', async () => {
  const f = (clauses) => ctx().filter(set, clauses);
  assert.deepEqual((await f([{ facet: 'crossModel', op: 'eq', value: true }])).matches, ids(1));
  assert.deepEqual((await f([{ facet: { facet: 'distanceBucket', width: 0.1 }, op: 'gte', value: 1 }, { facet: 'crossModel', op: 'eq', value: false }])).matches, ids(0, 2));   // buckets 1 (0.15) and 3 (0.35); the cross-model 0.05 is bucket 0
  assert.deepEqual((await f([{ facet: 'element', op: 'eq', value: { modelKey: 'A', dbId: 3 } }])).matches, ids(2)); // existential over the two members
  assert.deepEqual((await f([{ facet: { facet: 'locationCell', size: 1 }, op: 'in', value: [[0, 0, 0]] }])).matches, ids(0, 1, 2)); // every midpoint lies in cell [0,0,0]
  assert.deepEqual((await f([])).matches, ids(0, 1, 2));                                                                  // empty conjunction
  const r = await f([{ facet: 'mode', op: 'eq', value: 'clearance' }]); assert.equal(r.count, 3); assert.equal(r.total, 3);
});

test('unavailable facets: the clause is FALSE for every result (never ignored) and is reported', async () => {
  const r = await ctx().filter(set, [{ facet: 'mode', op: 'eq', value: 'clearance' }, { facet: 'attrFirst:level', op: 'eq', value: 'L1' }]);
  assert.deepEqual(r.matches, []);
  assert.deepEqual(r.unavailable, [{ facetId: 'attrFirst:level', reason: 'annotation-absent' }]);
  const n = await ctx().filter(set, [{ facet: 'attrFirst:level', op: 'isNull' }]);              // still false, not "everything is null"
  assert.deepEqual(n.matches, []);
});

test('clause validation is closed and bounded', async () => {
  const bad = [
    [{ facet: 'mode', op: 'lt', value: 1 }], [{ facet: { facet: 'locationCell', size: 1 }, op: 'gt', value: 0 }], [{ facet: 'element', op: 'gte', value: 1 }],
    [{ facet: 'mode', op: 'isNull', value: 1 }], [{ facet: 'mode', op: 'eq' }], [{ facet: 'mode', op: 'in', value: 'x' }], [{ facet: 'mode', op: 'like', value: 'x' }],
    [{ facet: 'mode', op: 'eq', value: NaN }], [{ facet: 'mode', op: 'eq', value: 'x', extra: 1 }], [{ op: 'eq', value: 1 }], [{ facet: { facet: 'distanceBucket', width: 1 }, op: 'lt', value: Infinity }],
  ];
  for (const c of bad) await assert.rejects(ctx().filter(set, c), InvalidOptionsError, JSON.stringify(c));
  await assert.rejects(ctx({ maxFilterClauses: 2 }).filter(set, Array.from({ length: 3 }, () => ({ facet: 'mode', op: 'notNull' }))), InvalidOptionsError);
  await assert.rejects(ctx().filter(set, 'nope'), InvalidOptionsError);
});

test('filter is sliced and abortable', async () => {
  const h = makeHarness(); const c = createContextInternal({ limits: { aggregationSliceMaxItems: 1 }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, {});
  await c.filter(set, [{ facet: 'mode', op: 'notNull' }]); assert.ok(h.yields >= 2);
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/filter.test.mjs` → module not found.

- [ ] **Step 3: Implement `filter.js`; register.**

```js
// clashtest/derive/filter.js
import { canonicalJson } from '../util/canonical.js';
import { parseFacetSpec } from './facets.js';
import { resolveAttributes } from './attributeSeam.js';
import { attrNames } from './groupBy.js';
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { assertClosed, invalid, isJsonValue } from './validate.js';

const OPS = ['eq', 'in', 'lt', 'lte', 'gt', 'gte', 'isNull', 'notNull'];
const ORDERING = ['lt', 'lte', 'gt', 'gte'];
const num = (x) => typeof x === 'number';

/** §14.4 (R16 Q2): existential over the facet's value list; a null value never satisfies eq/in/ordering. */
export function clauseHolds(op, values, operand) {
  const nonNull = values.filter((x) => x !== null);
  switch (op) {
    case 'eq': { if (operand === null) return false; const k = canonicalJson(operand); return nonNull.some((x) => canonicalJson(x) === k); }
    case 'in': { const ks = new Set(operand.filter((s) => s !== null).map((s) => canonicalJson(s))); return nonNull.some((x) => ks.has(canonicalJson(x))); }
    case 'lt': return nonNull.some((x) => num(x) && x < operand);
    case 'lte': return nonNull.some((x) => num(x) && x <= operand);
    case 'gt': return nonNull.some((x) => num(x) && x > operand);
    case 'gte': return nonNull.some((x) => num(x) && x >= operand);
    case 'isNull': return nonNull.length === 0;
    case 'notNull': return nonNull.length > 0;
    default: throw new Error(`unreachable op ${op}`);
  }
}

function parseClause(c, i) {
  const path = `clauses[${i}]`;
  assertClosed(c, ['facet', 'op', 'value'], path);
  if (c.facet === undefined) throw invalid('facet-required', `${path}.facet`);
  if (!OPS.includes(c.op)) throw invalid('bad-op', `${path}.op`);
  const facet = parseFacetSpec(c.facet, `${path}.facet`);
  const has = Object.hasOwn(c, 'value');
  if (c.op === 'isNull' || c.op === 'notNull') { if (has) throw invalid('value-forbidden', `${path}.value`); }
  else if (!has) throw invalid('value-required', `${path}.value`);
  else if (c.op === 'eq' && !isJsonValue(c.value)) throw invalid('bad-value', `${path}.value`);
  else if (c.op === 'in' && !(Array.isArray(c.value) && isJsonValue(c.value))) throw invalid('bad-value', `${path}.value`);
  else if (ORDERING.includes(c.op)) {
    if (!facet.numeric) throw invalid('ordering-on-non-numeric-facet', `${path}.op`);
    if (!Number.isFinite(c.value)) throw invalid('bad-value', `${path}.value`);
  }
  return { facet, op: c.op, value: c.value };
}

export const filterRunner = {
  optionKeys: ['annotations', 'signal'],
  prepare({ clauses }, _opts, limits) {
    if (!Array.isArray(clauses)) throw invalid('clauses-required', 'clauses');
    if (clauses.length > limits.maxFilterClauses) throw invalid('too-many-clauses', 'clauses');
    return { clauses: clauses.map(parseClause) };
  },
  async run({ clauses }, [set], env) {
    const { gate } = env;
    await drive(assertCanonicalResultOrder(set.results, set.runId), gate);
    const attrs = resolveAttributes(set, env.annotations, attrNames(clauses.map((c) => c.facet)));
    const dead = clauses.filter((c) => c.facet.attr && !attrs.available);
    const unavailable = [...new Map(dead.map((c) => [c.facet.facetId, { facetId: c.facet.facetId, reason: attrs.reason }])).values()];
    const matches = [];
    if (dead.length === 0) {
      const fenv = { attrs, reader: clauses.some((c) => c.facet.needsReader) ? await drive(buildStatusReaderSteps(set), gate) : null };
      for (const r of set.results) {
        if (clauses.every((c) => clauseHolds(c.op, c.facet.values(r, fenv), c.value))) matches.push(r.resultId);
        const p = gate.tick(); if (p !== undefined) await p;
      }
    }
    return { matches, count: matches.length, total: set.results.length, unavailable };
  },
};
```

```js
// clashtest/derive/runners.js (complete file at this step)
import { groupByRunner } from './groupBy.js';
import { filterRunner } from './filter.js';
export const DEFAULT_RUNNERS = { groupBy: groupByRunner, filter: filterRunner };
```

(`filter` with an unavailable clause yields zero matches by construction — a conjunction with a constant-false clause — without evaluating the rest; the `unavailable` field is what tells the consumer "could not evaluate".)

- [ ] **Step 4: Run passing** — `node --test test/clashtest/derive/filter.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): filter derivation with truth rules (P8.5)"`.

---

### Task P8.6: `summarize`

§14.6: exact totals for a Panel header.

**Files:** Create `clashtest/derive/summarize.js`; Modify `runners.js`; Test `test/clashtest/derive/summarize.test.mjs`.

**Interfaces:** Consumes `buildStatusReaderSteps` (P5 `results/status.js`), `drive`. Produces `summarizeRunner` (`optionKeys ['signal']`), result:

```text
{ runId, status, environmentSensitive,
  axes: { coverage, integrity, freshness, freshnessAtSeal: true },
  totalResults, resultsByMode:[{mode,count}], resultsByPairModels:[{pairModels:[a,b],count}],
  resultsByCrossModel:{crossModel,sameModel}, resultsCaveated,
  unitOutcomes:[{outcome,cause,count}], planningGaps:[{cause,count}], gapWeight,
  caveats:{ total, completenessAffectingUpperBound, omittedReasonOccurrences, unclassifiedOccurrences, countsByReason /* verbatim */ } }
```
All arrays sorted by their key (deterministic). `gapWeight` = Σ `pairSpaceWeight` of leaf units whose outcome is not `evaluated` (a `kind: 'split'` parent is superseded and excluded). `summarize` reads the ledger **only through `reader.ledger`** (P5's `LedgerModel`): `leaves` (already excludes `split` parents) for the unit outcomes and `gapWeight`, and `planningGaps` for the gap causes; it never reads the root/owner/target layout. `axes.freshness` is the value **at seal** and is labelled so.

- [ ] **Step 1: Write the failing test.**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2].map((d) => ({ dbId: d, ownerDbIds: [d] })) }, { modelKey: 'B', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }] }];
const units = [
  { unitId: 'u1', source: { modelKey: 'A', roots: [1] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 5 },
  { unitId: 'u2', outcome: 'failed', cause: 'capacity-exceeded', source: { modelKey: 'A', roots: [2] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 7 },
  { unitId: 'u3', outcome: 'split', source: { modelKey: 'A', roots: [1, 2] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 100 },
];
const c = () => createContextInternal({}, {});

test('summarize: exact totals, deterministic ordering, gap weight ignores split parents', async () => {
  const set = makeResultSet({ models, units, coverage: 'partial', integrity: 'caveated', freshness: 'stale',
    results: [{ pair: [['A', 1], ['B', 1]] }, { pair: [['A', 1], ['A', 2]] }],
    diagnostics: { total: 9, countsByReason: { 'fragment-not-loaded': 4 }, completenessAffectingUpperBound: 4, omittedReasonOccurrences: 5 } });
  const s = await c().summarize(set);
  assert.equal(s.totalResults, 2);
  assert.deepEqual(s.resultsByMode, [{ mode: 'volume-overlap', count: 2 }]);
  assert.deepEqual(s.resultsByPairModels, [{ pairModels: ['A', 'A'], count: 1 }, { pairModels: ['A', 'B'], count: 1 }]);
  assert.deepEqual(s.resultsByCrossModel, { crossModel: 1, sameModel: 1 });
  assert.deepEqual(s.unitOutcomes, [{ outcome: 'evaluated', cause: null, count: 1 }, { outcome: 'failed', cause: 'capacity-exceeded', count: 1 }]);
  assert.equal(s.gapWeight, 7);
  assert.deepEqual(s.axes, { coverage: 'partial', integrity: 'caveated', freshness: 'stale', freshnessAtSeal: true });
  assert.equal(s.caveats.total, 9); assert.deepEqual(s.caveats.countsByReason, { 'fragment-not-loaded': 4 }); assert.equal(s.caveats.omittedReasonOccurrences, 5);
});

test('summarize: caveated results use the pair-level verdict; planning gaps counted; empty set is exact', async () => {
  const set = makeResultSet({ models, units: [{ ...units[0], taints: [{ kind: 'unit', modelKey: null, reason: 'taint-overflow', occurrences: 1 }] }], results: [{ pair: [['A', 1], ['B', 1]] }] });
  assert.equal((await c().summarize(set)).resultsCaveated, 1);
  const gap = makeResultSet({ models, units: [], planningGaps: [{ phase: 'planning', cause: 'plan-too-large' }], coverage: 'partial', status: 'failed' });
  const s = await c().summarize(gap);
  assert.deepEqual(s.planningGaps, [{ cause: 'plan-too-large', count: 1 }]); assert.equal(s.totalResults, 0); assert.deepEqual(s.resultsByMode, []);
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/summarize.test.mjs` → `summarizeRunner`/runner not registered (`TypeError: Cannot read properties of undefined (reading 'optionKeys')`).

- [ ] **Step 3: Implement and register.**

```js
// clashtest/derive/summarize.js
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive } from './steps.js';

const sortedRows = (map, mk) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => mk(v));
const bump = (map, key, seed) => { const e = map.get(key); if (e) e.count += 1; else map.set(key, { ...seed, count: 1 }); };

export const summarizeRunner = {
  optionKeys: ['signal'],
  prepare: () => ({}),
  async run(_plan, [set], { gate }) {
    const reader = await drive(buildStatusReaderSteps(set), gate);
    const byMode = new Map(); const byPair = new Map(); let cross = 0; let caveated = 0;
    for (const r of set.results) {
      bump(byMode, r.mode, { mode: r.mode });
      const pm = [r.pair.first.modelKey, r.pair.second.modelKey]; bump(byPair, JSON.stringify(pm), { pairModels: pm });
      if (pm[0] !== pm[1]) cross += 1;
      if (reader.pairStatus(r.pair).verdict === 'covered-caveated') caveated += 1;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    const { leaves, planningGaps } = reader.ledger;                        // P5 LedgerModel: leaf units only (split parents are superseded), and the planning gaps
    const outcomes = new Map(); let gapWeight = 0;
    for (const u of leaves) {
      bump(outcomes, `${u.outcome}\u0000${u.cause ?? ''}`, { outcome: u.outcome, cause: u.cause ?? null });
      if (u.outcome !== 'evaluated') gapWeight += u.pairSpaceWeight ?? 0;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    const gaps = new Map(); for (const g of planningGaps ?? []) bump(gaps, g.cause, { cause: g.cause });
    const d = set.diagnostics ?? {};
    return {
      runId: set.runId, status: set.outcome.status, environmentSensitive: !!set.outcome.environmentSensitive,
      axes: { coverage: set.outcome.coverage, integrity: set.outcome.integrity, freshness: set.outcome.freshness, freshnessAtSeal: true },
      totalResults: set.results.length,
      resultsByMode: sortedRows(byMode, (v) => v),
      resultsByPairModels: sortedRows(byPair, (v) => v),
      resultsByCrossModel: { crossModel: cross, sameModel: set.results.length - cross },
      resultsCaveated: caveated,
      unitOutcomes: sortedRows(outcomes, (v) => v), planningGaps: sortedRows(gaps, (v) => v), gapWeight,
      caveats: { total: d.total ?? 0, completenessAffectingUpperBound: d.completenessAffectingUpperBound ?? 0, omittedReasonOccurrences: d.omittedReasonOccurrences ?? 0,
        unclassifiedOccurrences: d.unclassifiedOccurrences ?? 0, countsByReason: structuredClone(d.countsByReason ?? {}) },
    };
  },
};
```

```js
// clashtest/derive/runners.js (complete file at this step)
import { groupByRunner } from './groupBy.js';
import { filterRunner } from './filter.js';
import { summarizeRunner } from './summarize.js';
export const DEFAULT_RUNNERS = { summarize: summarizeRunner, groupBy: groupByRunner, filter: filterRunner };
```

- [ ] **Step 4: Run passing** — `node --test test/clashtest/derive/summarize.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): summarize derivation (P8.6)"`.

---

### Task P8.7: `compareResultSets`

§15.2, §15.4: fail-closed comparison, pair-semantics gate, unverified classes, determinism metadata, bounds.

**Files:** Create `clashtest/derive/compare.js`; Modify `runners.js`; Test `test/clashtest/derive/compare.test.mjs`.

**Interfaces:**
- Consumes: `buildStatusReaderSteps` (**P5 `results/status.js`**; indexes built once per side), `drive`, `assertCanonicalResultOrder` (P8.2), `comparePairIds`, `pairSemanticsOf` (P1), `canonicalJson`, `ComparisonTooLargeError`, `invalid`, and **`COMPARE_TOLERANCE_DEFAULTS` from P0 `clashtest/options.js`** (controller ruling on OPEN-4; P8 defines no local copy).
- Produces: `compareRunner` (`optionKeys ['signal','distanceTolerance','pointTolerance']`), `changedFieldsOf`, and the spec's `Comparison`.

Simplest mechanism preserving the observable invariants (stated per the brief): the spec's "equal `pairSetDigest` short-circuit" is **not** implemented — a recorded digest of an unvalidated raw set is caller data and short-circuiting on it would trust it; the full O(n+m) merge already yields the identical observable output (and evidence is compared by tolerance regardless). Entry counting includes **every** classified entry (`unchanged` included) plus `identityConflicts`. `timeSensitive: true` is added to `added` and `resolved` entries only (spec text) — see Open items.

`changedFields` names (implementer choice, spec gives only `'mode'`/`'clearance'`): `'mode'` if modes differ (then nothing else is compared); else `'clearance'` if both are `clearance` and `evidence.clearance` differs (nothing else compared); else any of `'distance'` (tolerance), `'closestPoints'` / `'witnessPoint'` (point tolerance, per component), `'witnessKind'`, `'flags'` (any of the four flags).

- [ ] **Step 1: Write the failing test** (truth table for every class + gate + bounds + tolerances + extreme numerics).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { changedFieldsOf } from '../../../clashtest/derive/compare.js';
import { getPairStatus } from '../../../clashtest/results/status.js';     // P5's (D4) — the reference implementation below classifies through it
import { COMPARE_TOLERANCE_DEFAULTS } from '../../../clashtest/options.js';   // P0's; the test never restates 1e-6
import { InvalidOptionsError, ComparisonTooLargeError, DerivationAbortedError, DerivationBusyError, CorruptResultSetError } from '../../../clashtest/errors.js';
import { makeResultSet } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const roots = [100, 200, 300, 400, 500].map((d) => ({ dbId: d, ownerDbIds: [d] }));
const models = [{ modelKey: 'M', modelVersion: 'v1', roots }];
const cover = (targets, extra = {}) => ({ unitId: '1.0', source: { modelKey: 'M', roots: [100] }, targets: [{ modelKey: 'M', roots: targets }], ...extra });
const pr = (b, extra = {}) => ({ pair: [['M', 100], ['M', b]], ...extra });
const mk = (over) => makeResultSet({ models, ...over });
const ctx = (limits = {}, h = makeHarness()) => createContextInternal({ limits, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, {});
const cmp = (a, b, o) => ctx().compareResultSets(a, b, o);
const ids = (list) => list.map((e) => e.pairId.second.dbId);

test('class truth table: unchanged / changed / added / addedUnverifiedBase / resolved / removedUnverifiedNext', async () => {
  // base: results 200 (stays), 300 (evidence changes), 400 (resolved: gone in next, next covers it cleanly)
  //       base covers 200,300,400 but NOT 500 (unit targets exclude it)
  const base = mk({ units: [cover([200, 300, 400])], results: [pr(200), pr(300, { evidence: { witness: { kind: 'surface-crossing', point: [1, 1, 1] } } }), pr(400)] });
  // next: 200 same, 300 point moved, 500 new (base did NOT cover it => addedUnverifiedBase), 200..: next covers 200,300,400,500 cleanly
  const next = mk({ semanticDigest: 'sha256:bbb', units: [cover([200, 300, 400, 500])], results: [pr(200), pr(300, { evidence: { witness: { kind: 'surface-crossing', point: [1, 1, 2] } } }), pr(500)] });
  const c = await cmp(base, next);
  assert.equal(c.incomparable, null);
  assert.deepEqual(ids(c.unchanged), [200]);
  assert.deepEqual(c.changed.map((e) => [e.pairId.second.dbId, e.changedFields]), [[300, ['witnessPoint']]]);
  assert.deepEqual(ids(c.resolved), [400]);
  assert.deepEqual(ids(c.addedUnverifiedBase), [500]);
  assert.deepEqual(c.added, []); assert.deepEqual(c.removedUnverifiedNext, []);
  assert.equal(c.resolved[0].baseResultId, base.results.find((r) => r.pair.second.dbId === 400).resultId);
  assert.equal(c.unchanged[0].baseResultId === c.unchanged[0].nextResultId, false); // semanticDigest differs => different ResultIds, same PairId join
});

test('added (base covered cleanly) and removedUnverifiedNext (next did not cover cleanly)', async () => {
  const base = mk({ units: [cover([200, 300, 400])], results: [pr(300)] });
  const next = mk({ units: [cover([200, 300], { taints: [{ kind: 'unit', modelKey: null, reason: 'diagnostic-overflow', occurrences: 1 }] })], results: [pr(200)] });
  const c = await cmp(base, next);
  assert.deepEqual(ids(c.added), [200]);                    // base covered 200 cleanly
  assert.deepEqual(ids(c.removedUnverifiedNext), [300]);    // next's covering unit is tainted: absence proves nothing
  assert.deepEqual(c.resolved, []);
  const gapNext = mk({ units: [cover([200, 300], { outcome: 'failed', cause: 'unit-cap' })], results: [] });
  assert.deepEqual(ids((await cmp(base, gapNext)).removedUnverifiedNext), [300]);                       // gap => unverified
  const notCovered = mk({ units: [cover([200])], results: [] });
  assert.deepEqual(ids((await cmp(base, notCovered)).removedUnverifiedNext), [300]);                    // 300 never asked in next => gap => unverified
});

test('unattributable diagnostic / mixed owner never yields resolved or added', async () => {
  const base = mk({ units: [cover([200, 300])], results: [pr(300)] });
  const nextTaint = mk({ units: [{ ...cover([200, 300]), targets: [{ modelKey: 'M', whole: true }], taints: [{ kind: 'target-model', modelKey: 'M', reason: 'fragment-not-loaded', occurrences: 1 }] }], results: [] });
  const c = await cmp(base, nextTaint);
  assert.deepEqual(c.resolved, []); assert.deepEqual(ids(c.removedUnverifiedNext), [300]);
  const mixed = mk({ units: [cover([200, 300])], results: [], unreachable: [{ modelKey: 'M', ownerDbIds: [300], mixedOwnerDbIds: [300], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }] });
  assert.deepEqual((await cmp(base, mixed)).resolved, []);
});

test('pair-semantics gate: containment <-> volume-overlap is incomparable in BOTH directions; nothing is joined', async () => {
  const contain = mk({ mode: 'containment', semanticDigest: 'sha256:c', units: [cover([200])], results: [pr(200, { evidence: {} })] });
  const overlap = mk({ mode: 'volume-overlap', semanticDigest: 'sha256:v', units: [cover([200])], results: [pr(200)] });
  for (const [a, b, ba, bb] of [[contain, overlap, 'ordered', 'unordered'], [overlap, contain, 'unordered', 'ordered']]) {
    const c = await cmp(a, b);
    assert.deepEqual(c.incomparable, { reason: 'pair-semantics-changed', base: ba, next: bb });
    for (const k of ['unchanged', 'changed', 'added', 'addedUnverifiedBase', 'resolved', 'removedUnverifiedNext']) assert.deepEqual(c[k], [], k);
  }
});

test('gate still reports identityConflicts; a modelVersion mismatch is a conflict, classified nowhere else', async () => {
  const base = mk({ units: [cover([200])], results: [pr(200)] });
  const other = makeResultSet({ models: [{ ...models[0], modelVersion: 'v2' }], units: [cover([200])], results: [pr(200)] });
  const c = await cmp(base, other);
  assert.deepEqual(ids(c.identityConflicts), [200]);
  for (const k of ['unchanged', 'changed', 'added', 'resolved', 'addedUnverifiedBase', 'removedUnverifiedNext']) assert.deepEqual(c[k], [], k);
  assert.equal(c.comparability.sameModelVersions, false);
  const gated = await cmp(mk({ mode: 'containment', units: [cover([200])], results: [pr(200, { evidence: {} })] }), other);
  assert.deepEqual(ids(gated.identityConflicts), [200]);
});

test('ordered class: swapped selections keep the sets comparable and add the orientation note; unordered modes still join across a mode change', async () => {
  const sel = (id) => ({ entries: [{ kind: 'elements', modelKey: 'M', dbIds: [id] }] });
  const c1 = mk({ mode: 'containment', semanticDigest: 'sha256:1', definitionOverrides: { selectionA: sel(100), selectionB: sel(200) }, units: [cover([200])], results: [pr(200, { evidence: {} })] });
  const c2 = mk({ mode: 'containment', semanticDigest: 'sha256:2', definitionOverrides: { selectionA: sel(200), selectionB: sel(100) }, units: [cover([200])], results: [] });
  const c = await cmp(c1, c2);
  assert.equal(c.incomparable, null);
  assert.ok(c.comparability.notes.includes('containment-orientation-reversed'));
  assert.deepEqual(ids(c.resolved), [200]);                     // the converse question is reported through the ordinary classes, verified via getPairStatus
  const vo = mk({ semanticDigest: 'sha256:vo', units: [cover([200])], results: [pr(200)] });
  const cl = mk({ mode: 'clearance', clearance: 0.05, semanticDigest: 'sha256:cl', units: [cover([200])], results: [pr(200)] });
  const j = await cmp(vo, cl);
  assert.equal(j.incomparable, null); assert.deepEqual(j.changed.map((e) => e.changedFields), [['mode']]);
});

test('clearance 0.05 -> 0.10: same pair is changed(["clearance"]) carrying pairId and BOTH ResultIds, never added+removed', async () => {
  const a = mk({ mode: 'clearance', clearance: 0.05, semanticDigest: 'sha256:a', units: [cover([200])], results: [pr(200)] });
  const b = mk({ mode: 'clearance', clearance: 0.1, semanticDigest: 'sha256:b', units: [cover([200])], results: [{ ...pr(200), evidence: { distance: 0.04, clearance: 0.1, closestPoints: { first: [0, 0, 0], second: [0.04, 0, 0] } } }] });
  const c = await cmp(a, b);
  assert.equal(c.changed.length, 1); assert.deepEqual(c.changed[0].changedFields, ['clearance']);
  assert.notEqual(c.changed[0].baseResultId, c.changed[0].nextResultId);
  assert.deepEqual([c.added, c.resolved, c.addedUnverifiedBase, c.removedUnverifiedNext], [[], [], [], []]);
});

test('equal pairSetDigest does not hide evidence: 0.0417 vs 0.0470 is changed; tolerance boundary and extreme numerics', async () => {
  const d = (v) => ({ distance: v, clearance: 0.5, closestPoints: { first: [0, 0, 0], second: [0, 0, 0] } });
  const mkc = (v) => mk({ mode: 'clearance', clearance: 0.5, units: [cover([200])], results: [pr(200, { evidence: d(v) })] });
  assert.equal((await cmp(mkc(0.0417), mkc(0.047))).changed.length, 1);
  assert.equal((await cmp(mkc(1), mkc(1.5), { distanceTolerance: 0.5 })).unchanged.length, 1);   // |Δ| == tol is unchanged (<=)
  assert.equal((await cmp(mkc(1), mkc(1.5), { distanceTolerance: 0.25 })).changed.length, 1);
  const tol = { ...COMPARE_TOLERANCE_DEFAULTS };
  assert.deepEqual(changedFieldsOf(mkc(Number.MAX_VALUE).results[0], mkc(-Number.MAX_VALUE).results[0], null, null, tol), ['distance']); // a-b overflows to Infinity: still "changed"
  assert.deepEqual(changedFieldsOf(mkc(Number.MAX_VALUE).results[0], mkc(Number.MAX_VALUE).results[0], null, null, tol), []);
  assert.deepEqual(changedFieldsOf(mkc(0).results[0], mkc(-0).results[0], null, null, tol), []);
});

test('options are closed and validated; timeSensitive marking and both determinism classes recorded (weaker wins)', async () => {
  const a = mk({ units: [cover([200])], results: [pr(200)] }); const b = mk({ units: [cover([200])], results: [] });
  for (const bad of [{ bogus: 1 }, { distanceTolerance: -1 }, { pointTolerance: NaN }, { distanceTolerance: Infinity }, { signal: 3 }]) await assert.rejects(cmp(a, b, bad), InvalidOptionsError, JSON.stringify(bad));
  const ts = mk({ mode: 'surface-intersection', determinismClass: 'time-sensitive', semanticDigest: 'sha256:ts', units: [cover([200])], results: [] });
  const c = await cmp(a, ts);
  assert.deepEqual([c.comparability.baseDeterminismClass, c.comparability.nextDeterminismClass, c.comparability.determinismClass], ['deterministic', 'time-sensitive', 'time-sensitive']);
  assert.equal(c.resolved[0].timeSensitive, true);
  assert.ok(c.comparability.notes.includes('time-sensitive:next'));
  const c2 = await cmp(ts, a); assert.equal(c2.comparability.determinismClass, 'time-sensitive'); assert.ok(c2.comparability.notes.includes('time-sensitive:base'));
  assert.equal('timeSensitive' in (await cmp(a, b)).resolved[0], false);
});

test('comparability: sameDefinition/ModelVersions/Enumeration/LibraryVersion, placement, environment and scope notes', async () => {
  const same = await cmp(mk({ units: [cover([200])] }), mk({ units: [cover([200])] }));
  assert.deepEqual([same.comparability.sameDefinition, same.comparability.sameModelVersions, same.comparability.sameEnumeration, same.comparability.sameLibraryVersion, same.comparability.placement], [true, true, true, true, 'same-generation']);
  const diff = await cmp(mk({ registrySessionId: 's1', libraryVersion: null, environmentSensitive: true, scopeDigests: { M: { population: { count: 1, digest: 'x' }, roots: [] } } }),
    mk({ registrySessionId: 's2', libraryVersion: '1', scopeDigests: { M: { population: { count: 2, digest: 'y' }, roots: [] } } }));
  assert.equal(diff.comparability.sameLibraryVersion, null); assert.equal(diff.comparability.placement, 'unverifiable'); assert.equal(diff.comparability.sameEnumeration, false);
  for (const n of ['environment-sensitive:base', 'scope-digest-mismatch:M']) assert.ok(diff.comparability.notes.includes(n), n);
  const moved = await cmp(mk({ placementGeneration: 0 }), mk({ placementGeneration: 1 })); assert.equal(moved.comparability.placement, 'unverifiable');
});

test('bounds: ComparisonTooLargeError from the incremental count, no partial output; shared slots; abort; slicing; a raw unordered set is corrupt', async () => {
  const big = (n) => mk({ units: [cover([200, 300, 400, 500])], results: [200, 300, 400, 500].slice(0, n).map((b) => pr(b)) });
  await assert.rejects(ctx({ maxComparisonEntries: 3 }).compareResultSets(big(4), big(4)), (e) => e instanceof ComparisonTooLargeError && e.limit === 3 && e.observed === 4);
  const h = makeHarness(); const c = ctx({ maxConcurrentDerivations: 1, aggregationSliceMaxItems: 1 }, h);
  h.hold(); const first = c.compareResultSets(big(4), big(4));
  await assert.rejects(c.compareResultSets(big(1), big(1)), DerivationBusyError); h.releaseAll(); await first;
  const ac = new AbortController(); const start = h.yields; h.onYield = (n) => n === start + 2 && ac.abort();
  await assert.rejects(c.compareResultSets(big(4), big(4), { signal: ac.signal }), DerivationAbortedError); assert.ok(h.yields >= start + 2);
  const bad = big(4); bad.results.reverse();
  await assert.rejects(cmp(bad, big(4)), CorruptResultSetError);
});

test('matches a synchronous reference implementation on randomized set pairs (seeded), and is index-only (no per-pair ledger scan)', async () => {
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let round = 0; round < 25; round++) {
    const pick = () => [200, 300, 400, 500].filter(() => rnd() < 0.5);
    const covers = () => [200, 300, 400, 500].filter(() => rnd() < 0.75);
    const build = (dg) => { const found = pick(); return mk({ semanticDigest: dg, units: [cover(covers())], results: found.map((b) => pr(b)) }); };
    const A = build('sha256:x'); const B = build('sha256:y');
    const got = await cmp(A, B);   // reference below: classify with the public getPairStatus
    const inA = new Set(A.results.map((r) => r.pair.second.dbId)); const inB = new Set(B.results.map((r) => r.pair.second.dbId));
    const exp = { resolved: [], removedUnverifiedNext: [], added: [], addedUnverifiedBase: [] };
    for (const b of [200, 300, 400, 500]) {
      const pair = { first: { modelKey: 'M', dbId: 100 }, second: { modelKey: 'M', dbId: b } };
      if (inA.has(b) && !inB.has(b)) exp[getPairStatus(B, pair).verdict === 'covered-clean' ? 'resolved' : 'removedUnverifiedNext'].push(b);
      if (!inA.has(b) && inB.has(b)) exp[getPairStatus(A, pair).verdict === 'covered-clean' ? 'added' : 'addedUnverifiedBase'].push(b);
    }
    for (const k of Object.keys(exp)) assert.deepEqual(ids(got[k]), exp[k], `${k} round ${round}`);
  }
});
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/derive/compare.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/derive/compare.js`.

- [ ] **Step 3: Implement `compare.js`; register.**

```js
// clashtest/derive/compare.js
import { ComparisonTooLargeError } from '../errors.js';
import { comparePairIds, pairSemanticsOf } from '../identity/ids.js';
import { canonicalJson } from '../util/canonical.js';
import { COMPARE_TOLERANCE_DEFAULTS } from '../options.js';   // P0 owns it (OPEN-4); no local definition here
import { buildStatusReaderSteps } from '../results/status.js';   // P5 (D4)
import { drive, assertCanonicalResultOrder } from './steps.js';
import { invalid } from './validate.js';
const near = (a, b, tol) => a === b || Math.abs(a - b) <= tol;              // a-b overflowing to Infinity is "not near", i.e. changed
const nearPoint = (p, q, tol) => (p === null || q === null ? p === q : p.every((v, i) => near(v, q[i], tol)));
const FLAGS = ['witnessUnavailable', 'duplicateEvidenceConflict', 'unreachableOwner', 'mixedOwnerProvenance'];

export function changedFieldsOf(a, b, _defA, _defB, tol) {
  if (a.mode !== b.mode) return ['mode'];
  if (a.mode === 'clearance' && a.evidence.clearance !== b.evidence.clearance) return ['clearance'];
  const f = [];
  if (a.mode === 'clearance') {
    if (!near(a.evidence.distance, b.evidence.distance, tol.distanceTolerance)) f.push('distance');
    const [p, q] = [a.evidence.closestPoints, b.evidence.closestPoints];
    if (!nearPoint(p.first, q.first, tol.pointTolerance) || !nearPoint(p.second, q.second, tol.pointTolerance)) f.push('closestPoints');
  } else if (a.mode === 'volume-overlap') {
    const [w, v] = [a.evidence.witness, b.evidence.witness];
    if (w === null || v === null) { if (w !== v) f.push('witnessKind'); }
    else { if (w.kind !== v.kind) f.push('witnessKind'); if (!nearPoint(w.point, v.point, tol.pointTolerance)) f.push('witnessPoint'); }
  }
  if (FLAGS.some((k) => !!a.flags?.[k] !== !!b.flags?.[k])) f.push('flags');
  return f;
}

const weaker = (x, y) => (x === 'deterministic' && y === 'deterministic' ? 'deterministic' : 'time-sensitive'); // unknown => weaker
const cls = (s) => (s.provenance.determinismClass === 'deterministic' ? 'deterministic' : 'time-sensitive');
const modelMap = (s) => new Map(s.provenance.models.map((m) => [m.modelKey, m]));

function comparabilityOf(base, next, conflictKeys) {
  const notes = []; const bm = modelMap(base); const nm = modelMap(next);
  let sameEnumeration = bm.size === nm.size; let sameVersions = bm.size === nm.size; let sameGen = base.provenance.registrySessionId === next.provenance.registrySessionId;
  for (const [k, m] of bm) {
    const n = nm.get(k); if (!n) { sameEnumeration = false; sameVersions = false; continue; }
    if (m.modelVersion !== n.modelVersion) sameVersions = false;
    else if (canonicalJson(m.scopeDigests) !== canonicalJson(n.scopeDigests)) { sameEnumeration = false; notes.push(`scope-digest-mismatch:${k}`); }
    if (m.placementGeneration !== n.placementGeneration) sameGen = false;
  }
  const bc = cls(base); const nc = cls(next); const dc = weaker(bc, nc);
  if (bc === 'time-sensitive') notes.push('time-sensitive:base');
  if (nc === 'time-sensitive') notes.push('time-sensitive:next');
  if (base.outcome.environmentSensitive) notes.push('environment-sensitive:base');
  if (next.outcome.environmentSensitive) notes.push('environment-sensitive:next');
  const lv = base.provenance.libraryVersion; const nv = next.provenance.libraryVersion;
  if (lv == null || nv == null) notes.push('library-version-unverified');
  const semB = base.testRef.semanticDigest; const semN = next.testRef.semanticDigest;
  return { sameDefinition: semB != null && semB === semN, sameModelVersions: sameVersions && conflictKeys.size === 0, sameEnumeration,
    sameLibraryVersion: lv == null || nv == null ? null : lv === nv, baseDeterminismClass: bc, nextDeterminismClass: nc, determinismClass: dc,
    placement: sameGen ? 'same-generation' : 'unverifiable', notes };
}

export const compareRunner = {
  optionKeys: ['signal', 'distanceTolerance', 'pointTolerance'],
  prepare(_args, opts) {
    const tol = { ...COMPARE_TOLERANCE_DEFAULTS };
    for (const k of ['distanceTolerance', 'pointTolerance']) if (opts[k] !== undefined) {
      if (!Number.isFinite(opts[k]) || opts[k] < 0) throw invalid('bad-tolerance', `options.${k}`);
      tol[k] = opts[k];
    }
    return { tol };
  },
  async run({ tol }, [base, next], { gate, limits }) {
    const bm = modelMap(base); const nm = modelMap(next);
    const conflictKeys = new Set([...bm].filter(([k, m]) => nm.has(k) && nm.get(k).modelVersion !== m.modelVersion).map(([k]) => k));
    const comparability = comparabilityOf(base, next, conflictKeys);
    await drive(assertCanonicalResultOrder(base.results, base.runId), gate);
    await drive(assertCanonicalResultOrder(next.results, next.runId), gate);
    const semB = base.definition ? pairSemanticsOf(base.definition.mode) : null; const semN = next.definition ? pairSemanticsOf(next.definition.mode) : null;
    const gated = semB !== null && semN !== null && semB !== semN;
    const out = { comparability, incomparable: gated ? { reason: 'pair-semantics-changed', base: semB, next: semN } : null,
      unchanged: [], changed: [], added: [], addedUnverifiedBase: [], resolved: [], removedUnverifiedNext: [], identityConflicts: [] };
    if (base.definition && next.definition && base.definition.mode === 'containment' && next.definition.mode === 'containment'
      && canonicalJson(base.definition.selectionA) === canonicalJson(next.definition.selectionB) && canonicalJson(base.definition.selectionB) === canonicalJson(next.definition.selectionA)
      && canonicalJson(base.definition.selectionA) !== canonicalJson(base.definition.selectionB)) comparability.notes.push('containment-orientation-reversed');
    const [baseReader, nextReader] = gated ? [null, null] : [await drive(buildStatusReaderSteps(base), gate), await drive(buildStatusReaderSteps(next), gate)]; // indexes built ONCE per side
    const ts = comparability.determinismClass === 'time-sensitive';
    let entries = 0;
    const push = (list, entry) => { entries += 1; if (entries > limits.maxComparisonEntries) throw new ComparisonTooLargeError({ limit: limits.maxComparisonEntries, observed: entries }); list.push(entry); };
    const conflict = (pair) => conflictKeys.has(pair.first.modelKey) || conflictKeys.has(pair.second.modelKey);
    const A = base.results; const B = next.results; let i = 0; let j = 0;
    while (i < A.length || j < B.length) {
      const a = A[i]; const b = B[j];
      const c = a === undefined ? 1 : b === undefined ? -1 : comparePairIds(a.pair, b.pair);
      const pair = (c <= 0 ? a : b).pair;
      if (conflict(pair)) push(out.identityConflicts, { pairId: pair });
      else if (!gated) {
        if (c === 0) {
          const fields = changedFieldsOf(a, b, base.definition, next.definition, tol);
          if (fields.length === 0) push(out.unchanged, { pairId: pair, baseResultId: a.resultId, nextResultId: b.resultId });
          else push(out.changed, { pairId: pair, baseResultId: a.resultId, nextResultId: b.resultId, changedFields: fields });
        } else if (c < 0) {
          const clean = nextReader.pairStatus(pair).verdict === 'covered-clean';
          push(clean ? out.resolved : out.removedUnverifiedNext, { pairId: pair, baseResultId: a.resultId, ...(clean && ts ? { timeSensitive: true } : {}) });
        } else {
          const clean = baseReader.pairStatus(pair).verdict === 'covered-clean';
          push(clean ? out.added : out.addedUnverifiedBase, { pairId: pair, nextResultId: b.resultId, ...(clean && ts ? { timeSensitive: true } : {}) });
        }
      }
      if (c <= 0) i += 1; if (c >= 0) j += 1;
      const p = gate.tick(); if (p !== undefined) await p;
    }
    return out;
  },
};
```

```js
// clashtest/derive/runners.js (final, complete file)
import { summarizeRunner } from './summarize.js';
import { groupByRunner } from './groupBy.js';
import { filterRunner } from './filter.js';
import { compareRunner } from './compare.js';
export const DEFAULT_RUNNERS = { summarize: summarizeRunner, groupBy: groupByRunner, filter: filterRunner, compare: compareRunner };
```

- [ ] **Step 4: Run passing** — `node --test test/clashtest/derive/compare.test.mjs` plus the whole P8 folder: `node --test test/clashtest/derive/`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): compareResultSets (P8.7)"`.

---

### Task P8.8: Public exports and `engine.derivations` binding (AFTER P7)

Blocked by P7 (not by any gate). Small and **additive**: it adds one key to P7's engine object and edits exactly one P7 test.

**Ruling applied (OPEN-3).** The core engine ships **without** `derivations` (and without `annotate`), and P7's `test/clashtest/engine/exports.test.mjs` **pins their absence** (`engine.derivations === undefined`, `api.createDerivationContext === undefined`). **Task P8.8 therefore legitimately edits that P7-owned test**: it flips those two absence assertions to presence assertions and touches nothing else in it (the `annotate`, `compareResultSets` and no-side-effect assertions stay). This is a deliberate, stated edit of another phase's test, not a drift; the commit for P8.8 must include it, and if P8.8 is never scheduled the P7 test stays as written.

**Files:**
- Create: `clashtest/derive/index.js`
- Modify: `clashtest/index.js` (one export line), `clashtest/engine.js` (one import block, one key)
- Modify (P7-owned test): `test/clashtest/engine/exports.test.mjs`
- Test: `test/clashtest/engine/derivations.test.mjs`

**Interfaces:**
- Consumes: **P7's `createClashTestEngine`** (`clashtest/engine.js`), inside which `effectiveLimits` (= P0 `resolveEngineLimits(limits)`), `now`, `yieldToScheduler` and the dispose guard `alive()` (throws `EngineDisposedError`) are already in scope (P7.2's sketch; if P7 named them differently, use P7's names — no new accessor is added to the public engine). **P5** `captureResultSet(raw, {limits})` and `getPairStatus`/`getElementStatus` (`results/status.js`). P0's `createFakeWorld`, `createFakeEnumerator` from `test/clashtest/support/index.mjs`.
- Produces: `engine.derivations` — a `DerivationContext` created once at construction via `createContextInternal({limits: pick(effectiveLimits, DERIVATION_LIMIT_KEYS), now, yieldToScheduler}, {assertOpen: alive, capture: (raw) => captureResultSet(raw, {limits: effectiveLimits})})`. The `capture` hook passes the engine's **whole resolved limits object** (P5's signature is `{limits}`, not `{maxCapturedNodes}`), so the engine's own `maxCapturedNodes` applies rather than the default.

Engine-bound scope, exactly: `engine.derivations.{summarize, groupBy, filter, compareResultSets}`. `getPairStatus`, `getElementStatus` and `createDerivationContext` stay standalone. **Not bound:** `engine.annotate`, `attributeSource`-backed snapshots (annotation follow-up).

- [ ] **Step 1: Write the failing test.**

```js
// test/clashtest/engine/derivations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import * as pkg from '../../../clashtest/index.js';
import * as p5Status from '../../../clashtest/results/status.js';
import { EngineDisposedError, DerivationBusyError } from '../../../clashtest/errors.js';
// `createExecutionWorld`, NOT P0's bare `createFakeWorld`: constructing an engine builds the
// world's registry (P1), which rejects a world without `admitModel`/`isLeaseValid` with
// `ModelBindingError{reason:'invalid-world'}`. P4's composed double has both surfaces.
import { createExecutionWorld, createFakeEnumerator } from '../support/index.mjs';
import { makeResultSet, U1 } from '../derive/support/makeResultSet.mjs';
import { makeHarness } from '../derive/support/harness.mjs';

const mkEngine = (h, limits = {}) => createClashTestEngine({ world: createExecutionWorld(), enumerator: createFakeEnumerator(), limits,
  now: h.now, yieldToScheduler: () => h.yieldToScheduler() });

test('public exports: the context factory plus the two status readers, which ARE P5\'s functions (no second copy)', () => {
  assert.equal(typeof pkg.createDerivationContext, 'function');
  assert.equal(pkg.getPairStatus, p5Status.getPairStatus);
  assert.equal(pkg.getElementStatus, p5Status.getElementStatus);
  for (const k of ['summarize', 'groupBy', 'filter', 'compareResultSets']) assert.equal(k in pkg, false);   // no free-standing derivation
});

test('engine.derivations uses the engine limits and scheduler and adds exactly one key', async () => {
  const h = makeHarness(); const engine = mkEngine(h, { maxConcurrentDerivations: 1, aggregationSliceMaxItems: 1 });
  assert.deepEqual(Object.keys(engine.derivations).sort(), ['compareResultSets', 'filter', 'groupBy', 'summarize']);
  for (const m of ['startRun', 'rerun', 'getRun', 'getResultSet', 'getFreshness', 'canClaimNoClashes', 'assessNoClashClaim', 'dispose']) assert.equal(typeof engine[m], 'function', m);  // P7's surface is intact
  const set = makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]] }, { pair: [['M', 100], ['M', 300]] }] });
  h.hold();
  const first = engine.derivations.summarize(set);
  await assert.rejects(engine.derivations.summarize(set), (e) => e instanceof DerivationBusyError && e.limit === 1);   // engine limit honoured
  h.releaseAll(); assert.equal((await first).totalResults, 2);
  assert.ok(h.yields >= 1);                                                                                              // the engine's yieldToScheduler was used
});

test('after engine.dispose(), engine.derivations rejects EngineDisposedError; standalone helpers keep working', async () => {
  const engine = mkEngine(makeHarness()); const set = makeResultSet({ units: [U1] });
  await engine.dispose();
  await assert.rejects(engine.derivations.summarize(set), EngineDisposedError);
  assert.equal(pkg.getPairStatus(set, { first: { modelKey: 'M', dbId: 100 }, second: { modelKey: 'M', dbId: 200 } }).verdict, 'covered-clean');
});
```

Edit to the P7 test, exactly (the only change to `test/clashtest/engine/exports.test.mjs`):

```diff
-  // Deferred surfaces are ABSENT, not stubbed (see the phase file's Gates and open items):
-  assert.equal(api.createDerivationContext, undefined);
-  assert.equal(api.compareResultSets, undefined);
+  // P8.8 (deferred phase, now landed): createDerivationContext is public; no free-standing derivation is.
+  assert.equal(typeof api.createDerivationContext, 'function');
+  assert.equal(api.compareResultSets, undefined);
 ...
-test('the core engine object has no annotate and no derivations', () => {
+test('the engine object has no annotate; derivations is bound by P8.8', () => {
   const engine = api.createClashTestEngine(base());
   assert.equal(engine.annotate, undefined);
-  assert.equal(engine.derivations, undefined);
+  assert.equal(typeof engine.derivations.summarize, 'function');
   assert.equal('annotate' in engine, false);
 });
```

- [ ] **Step 2: Run it; expect failure** — `node --test test/clashtest/engine/derivations.test.mjs` → `TypeError: Cannot read properties of undefined (reading 'summarize')` (`engine.derivations` is absent in the core engine) and/or a missing `pkg.createDerivationContext`.

- [ ] **Step 3: Implement.**

```js
// clashtest/derive/index.js
export { createDerivationContext } from './context.js';
export { getPairStatus, getElementStatus } from '../results/status.js';   // re-export lines: P5 owns both (D4)
```

```js
// clashtest/index.js — append ONE line (P7 already exports getPairStatus/getElementStatus from results/status.js; exporting them again would be a duplicate-export SyntaxError)
export { createDerivationContext } from './derive/index.js';
```

```js
// clashtest/engine.js — the ONLY edit: one import block, and one key added to the engine literal (P7 ships no `derivations` key)
import { createContextInternal, DERIVATION_LIMIT_KEYS } from './derive/context.js';
import { captureResultSet } from './results/validateResultSet.js';
// ... inside createClashTestEngine, in the engine literal (effectiveLimits = resolved engine limits; alive = P7's dispose guard):
derivations: createContextInternal(
  { limits: Object.fromEntries(DERIVATION_LIMIT_KEYS.map((k) => [k, effectiveLimits[k]])), now, yieldToScheduler },
  { assertOpen: alive,
    capture: (raw) => captureResultSet(raw, { limits: effectiveLimits }) }),
```

- [ ] **Step 4: Run passing** — `node --test test/clashtest/engine/derivations.test.mjs test/clashtest/engine/exports.test.mjs` (the edited P7 test must pass with the binding present), then P7's remaining engine tests unmodified (`node --test test/clashtest/engine/`), then the full suite `npm test` (must stay free of server/credentials).

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "feat(clashtest): bind engine.derivations; flip P7 absence pins (P8.8)"`.

---

## Verification / acceptance for P8

Commands: per file `node --test test/clashtest/derive/<file>.test.mjs`; phase `node --test test/clashtest/derive/`; full `npm test`.

- [ ] `status.consumer.test.mjs` — **consumer-level only (reconciliation D4):** P8's fixtures (P5's pinned ledger shape, incl. the per-root `cls` marker) produce sets P5's reader answers for; `readLedger`/`createStatusReader`/`buildStatusReaderSteps`/`getPairStatus`/`getElementStatus` import from `results/status.js` and agree; `derive/status.js` and `derive/ledgerReader.js` do not exist; an element in a class-`C` root beyond the bounded first-20 `hierarchyInternal.examples` still carries the `hierarchy-internal` caveat (the `cls` marker, not the examples, is the source). **The §12.5 behavior suite — every taint rule 1–7, `covered-clean|covered-caveated|gap|not-required|undetermined`, `required:null` for `undetermined`, hierarchy-internal reason, orientation independence, element status — is P5's `test/clashtest/results/status.test.mjs`** and is a P5 acceptance item (AC-17, AC-20(c)); it is not duplicated here. It still feeds AC-14 through `compare.test.mjs` below.
- [ ] `context.test.mjs` — closed options; per-context slots and independence; `DerivationBusyError` immediate; slot before capture (R21-3 slot part); capture-first; abort mid-derivation frees the slot; fake-clock slicing (AC-13 "Derivation context R17-4", "Derivation memory R21-3 slot-before-capture and third-call rejection", "Method options exhaustive R19-4" for `compareResultSets`).
- [ ] `facets.test.mjs` — facet vocabulary, `locationCell` negative/boundary/null-distinct, FacetRangeError (R15-5), ordering rules, attribute facets unavailable without a snapshot (AC-13).
- [ ] `groupBy.test.mjs` — partition vs cover, order, `GroupId` stability, shuffle-invariance, collision vectors, `GroupingTooLargeError` before allocation, facet/clause caps, abort/busy/sliced (AC-13).
- [ ] `filter.test.mjs` — full §14.4 truth table incl. `isNull`/`notNull` complementarity, ordering on non-numeric rejected, unavailable-is-false (AC-13).
- [ ] `summarize.test.mjs` — §14.6 totals.
- [ ] `compare.test.mjs` — every `Comparison` class incl. both `unverified` classes; join on `PairId`; clearance `0.05→0.10`; pair-semantics gate both directions; identityConflicts; tolerance boundaries and extreme numerics; determinism metadata (weaker wins, base/next); `timeSensitive`; comparability notes; `ComparisonTooLargeError`; shared slots/abort/sliced; randomized equivalence with a reference built on `getPairStatus` (AC-14, AC-13 "Comparison R15-4").
- [ ] `test/clashtest/engine/derivations.test.mjs` and the **edited P7 `exports.test.mjs`** (after P7) — binding, engine limits/scheduler, disposal, P7's engine surface intact, `pkg.getPairStatus`/`getElementStatus` are P5's own functions (no second copy), `createDerivationContext` public.
- [ ] `npm test` green with no server, credentials or network.
- [ ] `docs/handoffs/latest.md` updated by the executor at phase close (project CLAUDE.md); no commit unless authorized.

## Spec coverage

| Spec § | Covered in |
|---|---|
| §12.5 three axes, pair level, taint rules 1–7, `getPairStatus`, `getElementStatus` | **P5.6 (owner, reconciliation D4)**; P8.1 consumes and P8.8 re-exports |
| §13.6 capture-first for raw sets entering derivations (capture only, no `validateResultSet`) | P8.2 |
| §14.1 principle (pure, no UI/state) | Global Constraints, P8.2 |
| §14.2 built-in facets, location point, range safety (R15-5) | P8.3 |
| §14.3 group identity, ordering, partition vs cover | P8.3 (order), P8.4 |
| §14.4 filters and truth rules; unavailable facets | P8.5 |
| §14.4 asynchronous sliced derivations, `signal`, `maxConcurrentDerivations` (slot before capture, R21-3), `DerivationContext` (`createDerivationContext`), bounds and typed errors, closed options | P8.2, P8.4, P8.5, P8.7 |
| §14.5 annotation layer | **excluded**; only the unavailable representation via the P8.3 seam |
| §14.6 summary | P8.6 |
| §15.2 comparability preconditions (recorded, never asserted) | P8.7 (`comparability`) |
| §15.4 `compareResultSets` (O(n+m), abort, `maxComparisonEntries`, pair-semantics gate, unverified classes, determinism classes, extreme numerics) | P8.7 |
| §17.1 / §17.1.1 derivation limits (defaults from P0 only, incl. the compare tolerances) | P8.2 (via `resolveEngineLimits`), P8.7 (`COMPARE_TOLERANCE_DEFAULTS` from P0 `options.js`) |
| §18 `engine.derivations`, standalone helpers, error names | P8.2, P8.8 |
| §22 AC-13 (except annotation compat/jobs/lifecycle, read backpressure), AC-14 | P8.1–P8.8 |

## Gates and open items

**Gates (master §4).** G-PLAN blocks the start of P8 implementation like every phase. **G-CAL** blocks *only* promoting the provisional derivation caps to deployable defaults (`maxComparisonEntries`, `maxGroupMemberships`, `maxConcurrentDerivations`, `aggregationSliceMaxItems`, `sliceBudgetMs`) and the AC-12 measured peak-memory test of two simultaneous maximum-shape comparisons (belongs to P7's maximum-shape harness; P8 supplies the machinery and the slot-before-capture and third-call-rejection parts). No other gate blocks any P8 task. **P8.8 is blocked by P7**, nothing else is.

**Implementation-level items left to implementers (with reason).**
1. *Sorting large group levels is one synchronous `Array.sort`* (P8.4 `finalize`): a level with ~10^6 groups can exceed one slice. Reason: replacing it with a sliced merge sort is a local change once AC-12 measures it; the group count is bounded by `maxGroupMemberships`.
2. *Reader build cost* is P5's (`buildStatusReaderSteps`, one `yield` per record, driven through `drive`); P8 only slices the walk. Measure under AC-12 with P5's reader.
3. *Uniform value order for booleans and element-ref values* (§14.3 lists numbers/strings/arrays/`null` only): chosen `false < true`, refs by element order. Reason: unspecified; low risk; record in the README.
4. *`changedFields` vocabulary beyond `'mode'`/`'clearance'`* (`distance`, `closestPoints`, `witnessPoint`, `witnessKind`, `flags`): spec gives only `string[]`.
5. *Tolerance defaults (`1e-6`)* — **RESOLVED (OPEN-4 ruling):** `COMPARE_TOLERANCE_DEFAULTS` lives in P0 `clashtest/options.js`; `derive/compare.js` imports it and tests import it. Nothing in P8 hard-codes `1e-6`.
6. *In-flight derivations on `engine.dispose()`*: spec is silent; P8 rejects **new** calls with `EngineDisposedError` and lets in-flight ones finish (they hold only their own memory). An abort-on-dispose would need a per-context `AbortController` — deferred.
7. *Hierarchy-internal detection in element status* — **RESOLVED (OPEN-2 ruling, option a):** the sealed ledger's `rootOwners` rows carry the digested per-root `cls` marker (P3 emits, P5 pins and digests, P8 reads only through P5's reader). The bounded-`examples` fallback and its under-reporting limitation are removed; P8.1's consumer test pins the case that would have under-reported.

**Plan self-check.** See *Conformance check* below for the mechanical old-name sweep and for the scratch-directory execution of the P8.2–P8.7 code and tests against throwaway stubs of the *reconciled* producer signatures.

**Interface assumptions — RECONCILED.** The "Consumed interfaces" table has been checked against each owner's Phase interface summary, producer wins; see [`interface-reconciliation.md`](interface-reconciliation.md). Settled: P0 error constructors take one object argument (N1); `resolveEngineLimits` ✔; `captureResultSet` belongs to **P5** and takes `{limits}` (N29); `canonicalJson` ✔; the slicer's yield point is **`tick()`** and P0 has no default `now`/scheduler exports (N6); `compareElementRefs`/`comparePairIds`/`pairSemanticsOf` ✔ (`elementRefKey` is P5's concern, N12); the §12.5 status reader and ledger reader are **P5's**, not P8's (D4); the per-root `cls` marker is persisted on `rootOwners` rows (OPEN-2, option a); the core engine ships without `derivations` and P8.8 edits P7's `exports.test.mjs` (OPEN-3); `COMPARE_TOLERANCE_DEFAULTS` is P0's (OPEN-4). **Still pending outside P8:** P0 must actually export `COMPARE_TOLERANCE_DEFAULTS`, P3 must emit and P5 must pin/digest/read `rootOwners[].owners[].cls`, and P5's `LedgerModel`/`StatusReader` shapes are P5's to document — P8 relies only on `PairStatus.verdict` and the reader's `pairStatus`/`elementStatus` methods.

**Spec observations (reported, not resolved by redesign).**
- The brief asks derivations to use P5's `validateResultSet`; spec §13.6 explicitly says derivation-context methods capture but do **not** run it. P8 follows the spec (capture + a shape guard `assertDerivable` + a canonical-order check; malformed ledgers surface as `CorruptResultSetError('malformed')`). To add validation later, insert one call in `invoke` after capture.
- §14.2 describes `caveated` as "an element-attributed diagnostic … or any target-model/unit taint", but its normative formula is `getPairStatus(...).verdict === 'covered-caveated'`, which also covers taint rules 4–7 (duplicate conflict, freshness, mixed owner, unattributable population). P8 implements the formula.
- §15.4's `Comparison` typedef omits `timeSensitive`, though the prose says `added`/`resolved` entries carry it; P8 adds it to those two classes only (not the `unverified` classes).
- §12.5 gives `required: boolean` but `undetermined` has no defined value; P8 returns `null`.
- §14.5 names the no-snapshot reason nowhere (only `annotation-incompatible:…`); P8 uses `annotation-absent` / `annotation-layer-not-implemented`.
- Spec §14.3 says a group's "identity is its path" but defines `GroupId` for a single facet; P8 gives each group its own `groupId` and a `path` of ancestor ids.
- Whether `unchanged`/`identityConflicts` count toward `maxComparisonEntries` is implicit ("total classified entries"); P8 counts every pushed entry.

---

## Conformance check

Mechanical sweep of this file against [`interface-reconciliation.md`](interface-reconciliation.md)'s name register (N1–N34, D1–D4, OPEN-2/3/4) and the producers' current `## Phase interface summary` sections (P0, P1, P5, P7; P5 re-read after its concurrent remediation — its summary now defines `createStatusReader → {pairStatus, elementStatus, ledger: LedgerModel}`, `LedgerModel = {units, leaves, unitsById, byModel, planningGaps, pairSpaceTotal, emptyOperand}` and `rootOwners[].owners[].cls`, all of which this file matches).

**Consumer-assumed old names and removed local definitions searched for** (`grep -n` over this file; "code" = inside a fenced block, "prose" = outside):

| Family | Pattern(s) | Code hits | Prose hits |
|---|---|---|---|
| N1 positional errors | `new InvalidOptionsError([`, `new InvalidOptionsError(issues`, `new EngineDisposedError()`, `new DerivationAbortedError()`, `ModelBindingError(`, `.code` | 0 | 0 |
| N3/N5 digest names | `digestOf(`, `digestSync` | 0 | 0 |
| N4 capture primitives | `ownKeysOf`, `readOwnValue`, `prototypeIsPlain` | 0 | 0 |
| N6 slicer yield point | `slicer.step`, `.step()`, `.checkpoint(`, `runSliced` | 0 | 0 |
| N6 non-existent P0 defaults | `defaultNow`, `defaultYieldToScheduler` | 0 | 0 |
| N10/N11/N13/N14 P1 | `dead?:`, `createModelRegistry({now`, `makePairId(`, `pairSemanticsForMode` | 0 | 0 |
| N15–N17, D1 P3 | `planRun`, `splitUnit`, `buildScopeExpect`, `checkScopeBracket` | 0 | 0 |
| N21–N25 P5/P6 | `createResultSetDraft`, `startPersistence`, `aggregateDiagnostics`, `readDiagnostics`, `.attachSealed`, `classOf`, `submit(`, `activeRunIds`, `.execute(` | 0 | 0 |
| N29/N30 capture homes | `captureDefinition`, `maxCapturedNodes:` (as a `captureResultSet` argument), `util/capture.js`, `validateResultSet(` | 0 | 0 |
| D4 removed P8 modules/helpers | `ownerToRoot`, `unitsBySourceRoot`, `rootTables`, `sourceRanges`, `rootKey`/`ownerKey`, `sliceHas`/`targetHas`/`sourceHas`, `runSync`, `scope: 'whole'` | 0 | 0 |
| D4 module paths | `derive/status.js`, `derive/ledgerReader.js`, `ledgerReader` | **1** (the `assert.rejects(import(...))` guard in P8.1's consumer test, which asserts the two modules do **not** exist) | 3 (the two struck-through File-structure rows and the Task P8.1 banner that says they are not created) |
| OPEN-4 local definition | `export const COMPARE_TOLERANCE_DEFAULTS`, `COMPARE_TOLERANCE_DEFAULTS = ` | 0 | 0 (the name now occurs only as an **import** from P0 `options.js`) |
| OPEN-2 option (c) | `option (c)`, bounded-examples `fallback`, `rootTables` | 0 | 2 (this file states the fallback was **removed**; the Gates item 7 and the ledger-layout note) |
| OPEN-3 phantom P7 seams | `isDisposed`, `makeTestEngine`, `engine.shape`, `engine.derivations.test`, "reserves/reserved" | 0 | 0 |
| Stale status labels | `Assumed` | 0 | 2 (the sentence "No row is Assumed", and the one explicit, cross-file-tracked assumption that P5's `LedgerModel.leaves[]` are the non-split `UnitRecord`s) |

The single remaining `.whole` code hit is the fixture's **input** spelling `{modelKey, whole:true}`, which `makeResultSet` translates to P5's `scope:'model'`; it is not a ledger field.

**Execution.** Task P8.1–P8.7 code and tests were extracted verbatim into a scratch directory (`.../scratchpad/p8/`) and run with `node --test` against throwaway stubs that implement exactly the *reconciled* producer signatures (P0 `errors` with one-object constructors, `resolveEngineLimits`, `COMPARE_TOLERANCE_DEFAULTS`, `canonicalJson`, `createSlicer` with `tick()`; P1 `ids`; P5 `captureResultSet(raw, {limits})` and a stand-in `results/status.js` with the P5-shaped `createStatusReader`/`buildStatusReaderSteps`/`readLedger` over the pinned ledger incl. `cls`). **81 / 81 passed** (compare 12, context 11, facets 7, filter 34, groupBy 12, status.consumer 3, summarize 2). This proves internal consistency and the absence of removed APIs only; the P5 stand-in is not P5's implementation, and P8.1's third test additionally depends on P5 keying element-level hierarchy caveats off `cls` (P5 Gates item 5). Task P8.8's code blocks were syntax-checked only (they need P7's engine).
