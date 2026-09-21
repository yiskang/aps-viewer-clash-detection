# Foundations — Phase P0 Implementation Plan

> **For agentic workers:** Execution workflow (optional recommendation): an agent environment that provides the `superpowers:subagent-driven-development` or `superpowers:executing-plans` skill may use it, but no skill is required. Repository-native fallback (sufficient on its own): execute the tasks in order, run each task's RED then GREEN steps, run the phase verification section, and tick this plan's own checkboxes (`- [ ]`) as you go. Steps use checkbox (`- [ ]`) syntax. Read the master first, then only this file.

**Goal:** Build the dependency-free foundation every later phase stands on: the typed error catalogue of spec §18 (`clashtest/errors.js`); the single code home of every default, ceiling, cross-field rule and the producer/reader invariant of spec §17.1/§17.1.1 (`clashtest/options.js`); the detached, descriptor-based capture of untrusted values (`clashtest/util/capture.js`, spec §5.3/§13.6); canonical JSON plus a sliceable pure-JS SHA-256 in the digest format of spec §5.4/§13.4 (`clashtest/util/canonical.js`); the deadline-aware slicer of spec §17.3 (`clashtest/util/slicer.js`); and the shared test doubles (`test/clashtest/support/`: fake clock, fake `CollisionWorld`, fake enumerator, fake registry placeholder). P0 contains no domain logic — no definitions, identity, planning or execution — and imports nothing from `wwwroot/`, the Viewer, `three`, or `collision/` (tests only touch `collision/errors.js` and `collision/constants.js`).

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints (no collision-core change; layering; ESM `.js` modules and `test/clashtest/**/*.test.mjs`; plain data at every boundary; fail-closed semantics; defaults live in one place; injectable `now`/`yieldToScheduler`; TDD RED → GREEN → checkpoint; commits only on explicit user authorization; handoff update). Phase-specific constraints, copied verbatim from the spec:

- **§17.1 (single source of defaults, R21-I1):** "This table is the single normative source of default values (R21-I1). Other sections name an option and cross-reference §17.1 rather than restating its number; where a number stated elsewhere in this spec disagrees with this table, **this table governs**. Hard ceilings live in §17.1.1 and are governed the same way."
- **§17.1 (calibration gate):** "*No default in this section — including the 16,000,000-node capture ceiling and the 512 MiB stored-result allowance (the table's `maxCapturedNodes` and `maxStoredResultBytes`) — may be implemented as a frozen constant before the AC-12 calibration; until then they ship only as provisional, overridable defaults.*" **Every default in `options.js` is therefore provisional pending gate G-CAL** and is flagged as such in code (`DEFAULTS_STATUS`), in the interface summary below, and in Task P0.8.
- **§17.1.1 (ownership):** "Every option below is exactly one of two kinds. **RunOptions** … **Engine limits** … The constructor's `limits` and the `RunOptions` schema of §18 list exactly these sets; a key in the wrong place is an unknown key and is rejected (`InvalidOptionsError`)." Validation "collects every issue and throws `InvalidOptionsError{issues}` synchronously … Rules: a plain object; **unknown keys rejected**; no coercion; every number must be a **finite integer** (`NaN`, `±Infinity`, fractions, strings rejected); enums exact."
- **§13.6 (producer/reader invariant, R21-2, normative):** "*an engine never produces a set it cannot read.* At `startRun`/`rerun` option validation (§17.1.1) the run's worst case must fit this engine's reader limits — `24 × maxResultsPerRun + 12 × maxLedgerRecords + 12 × maxRetainedDiagnostics + 65,536 ≤ maxCapturedNodes` **and** `maxCapturedNodes × bytesPerNode ≤ maxStoredResultBytes` (`bytesPerNode` = 32, provisional, calibrated by AC-12) — else `InvalidOptionsError('result-unreadable')`."
- **§5.3 (capture):** "reads each schema key's **own property descriptor once** and rejects an accessor descriptor … so no getter on the caller's object is ever *invoked*"; a trap that throws or a revoked proxy "is caught and reported as a V1 issue `unreadable` — never an internal failure and never an escape of the thrown value". "A `Proxy` is **not** detected and no promise is made about it."
- **§5.4 (digest):** `"sha256:" + lowercase hex` of SHA-256 over the UTF-8 bytes of canonical JSON — "object keys sorted by UTF-16 code-unit order, no insignificant whitespace, strings serialized by the ECMAScript well-formed `JSON.stringify` algorithm (ES2019: lone surrogates are escaped as `\uXXXX` …), numbers rendered as the shortest round-trip `Number#toString` (finite only; `-0` normalized to `0`), arrays in their normalized order." "The *implementation* (Web Crypto `SubtleCrypto`, or a sliceable pure-JS SHA-256 for the ≤ `frameBudgetMs` span rule, §17.3) is a plan-level choice; the output bytes are not." Every durable digest records `digestVersion: 1`.
- **§13.4 (serialization):** a sealed set "contains only plain objects, arrays, strings, finite numbers, booleans and `null`. Forbidden anywhere inside it: `Model` or any Viewer object, functions, `THREE` objects, `Map`/`Set`, `undefined` values, and non-finite numbers."
- **§17.3 (slicing):** "a slice checks the injected `now` at least every 64 items and yields once `sliceBudgetMs` (provisional 4 ms, half of `frameBudgetMs`) has elapsed, with `aggregationSliceMaxItems` only a secondary ceiling"; the engine reports labelled spans through an optional `spanRecorder` "(same shape as `collision/scheduler.js`'s `setSpanRecorder` callback)".

## Phase interface summary

Everything other phases may rely on. Names follow spec §18 and the master's module map (§2). Signatures are final for P0; other phases must not re-implement any of these.

### `clashtest/errors.js`

Convention: every class is constructed `new XError({ ...typedFields, message?, cause? })`; `error.name` is the class name; all typed fields are plain data. All extend `ClashTestError extends Error`. `ERROR_CATALOGUE` is a frozen `Array<{name, fields}>`. Fields marked (inferred) are not spelled out in spec §18; P0 chose them and other phases must use them as listed.

| Class | Typed fields (default) | Source in spec |
|---|---|---|
| `ClashTestError` | — (base) | — |
| `InvalidTestDefinitionError` | `issues: {path,code,message}[]` (`[]`), `issuesTruncated: boolean` (`false`) | §5.3, §18 |
| `UnsupportedSchemaVersionError` | `type` (`'ClashTestDefinition' \| 'ResultSet' \| null`), `schemaVersion` (number / ≤64-char string / `null`), `supported` (max supported integer / `null`) | §5.3, §13.6 (inferred fields) |
| `InvalidOptionsError` | `issues: {path,code,message}[]`, `reason: string \| null` (`'result-unreadable'`, `'bad-cursor'`, `'no-embedded-definition'` …) | §17.1.1, §13.6, §18 |
| `ModelBindingError` | `reason` (`'registry-mismatch'`, `'coordinator-version-mismatch'`, `'missing-model-version'`, `'field-too-long'`; open string), `modelKey \| null` | §4.3, §18 |
| `ModelKeyVersionConflictError`, `IdentityConflictError` | `modelKey`, `existingVersion`, `offeredVersion` (inferred) | §4.2, §18 |
| `RevisionConflictError` | `testId`, `latest`, `offered` | §5.5 |
| `TestDeletedError`, `TestArchivedError` | `testId` | §5.5 |
| `RunIdConflictError` | `runId` (inferred) | §13.5 |
| `PersistenceOutcomeUnknownError` | `runId \| null` (inferred) | §13.5 |
| `StoreNotConfiguredError` | `store` (`'testStore' \| 'resultStore'`) | §5.5 |
| `CorruptListingError` | `issues: {path,code}[]` (first 20, no values) | §13.5 |
| `RunQueueFullError` | `limit`, `queued` (inferred) | §7.3 |
| `ResultCapacityError` | `cap`, `active: runId[]`, `retained: runId[]`, `held: {runId, persistence}[]` | §13.5.2 |
| `ResultSetRetainedError`, `UnsavedResultSetError`, `RunNotTerminalError`, `ResultNotResidentError` | `runId` | §13.5.2 |
| `EngineDisposedError` | — | §8, §18 |
| `CorruptResultSetError` | `runId`, `issues: {path,code}[]` (first 20, never values) | §13.6 |
| `ResultSetTooLargeError` | `runId` | §13.6 |
| `ReadCapacityError` | `limit` | §13.6 |
| `ReadAbortedError`, `DerivationAbortedError` | — | §13.6, §14.4 |
| `EnumerationCancelledError` | `reason: 'cancelled' \| 'lease-dead' \| 'disposed'` | §6.2 |
| `AnnotationTooLargeError` | `limit`, `observed` (inferred) | §14.5 |
| `AnnotationSupersededError` | `runId` | §14.5 |
| `AnnotationBusyError`, `DerivationBusyError` | `limit` | §14.4, §14.5 |
| `AttributeSourceError` | `modelKey \| null` (+ `cause`) | §14.5 |
| `GroupingTooLargeError`, `ComparisonTooLargeError` | `limit`, `observed` | §14.4, §15.4 |
| `FacetRangeError` | `facetId` | §14.2 |

### `clashtest/options.js` — every value is provisional pending G-CAL

| Export | Signature / shape | Meaning |
|---|---|---|
| `DEFAULTS_STATUS` | `{provisional: true, gate: 'G-CAL', note}` (frozen) | Machine-readable "these defaults are not frozen". |
| `RUN_OPTION_SPECS`, `ENGINE_LIMIT_SPECS` | `{[key]: {kind:'int'\|'enum'\|'bool', min?, ceiling?, values?, default, derivedFrom?, derivedOffset?}}` | The tables. `derivedFrom` marks the two derived defaults. |
| `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS` | frozen `{[key]: value}` | Fully resolved defaults (derived ones materialised). Tests import these; nothing restates a number. |
| `RUN_OPTION_KEYS`, `ENGINE_LIMIT_KEYS` | `string[]` | The two ownership sets (19 and 21 keys, spec §18). |
| `RUN_OPTION_CEILINGS`, `ENGINE_LIMIT_CEILINGS` | `{[intKey]: number \| null}` | Hard ceilings (`null` = cross-field only). |
| `SCHEMA_MAX_NODES`, `SCHEMA_NODE_FACTORS`, `BYTES_PER_NODE` | `number`, `{result:24, ledger:12, diagnostic:12, slack:65536}`, `32` | §13.6 data-format constants. `SCHEMA_MAX_NODES` is also the hard ceiling of the engine limit `maxCapturedNodes` (so `limits.maxCapturedNodes <= SCHEMA_MAX_NODES` always holds for a resolved `limits`). |
| `COMPARE_TOLERANCE_DEFAULTS` | frozen `{distanceTolerance: 1e-6, pointTolerance: 1e-6}` | Spec §15.4 provisional defaults for `compareResultSets` (`changed` tolerances, world units). **Provisional, flagged G-CAL-pending like every other default** (`DEFAULTS_STATUS` covers it). It is **neither a RunOption nor an engine limit**: it is not in `RUN_OPTION_KEYS` / `ENGINE_LIMIT_KEYS` and `resolveRunOptions` / `resolveEngineLimits` reject it as an unknown key. Added by the conformance pass (reconciliation OPEN-4, strict reading): P8's `derive/compare.js` **imports** it and must not restate `1e-6` (a guard test fails if any other file under `clashtest/` contains the literal). |
| `resolveRunOptions(input, limits?)` | `(object \| undefined, ResolvedLimits?) → frozen ResolvedRunOptions`; throws `InvalidOptionsError` synchronously | Validate + fill defaults + cross-field rules + producer/reader invariant. `limits` defaults to the default engine limits. |
| `resolveEngineLimits(input)` | `(object \| undefined) → frozen ResolvedLimits`; throws `InvalidOptionsError` | Same for the engine constructor's `limits`. |
| `worstCaseCapturedNodes(runOptions)` | `→ number` | `24·maxResultsPerRun + 12·maxLedgerRecords + 12·maxRetainedDiagnostics + 65,536`. |
| `producerReaderIssues(runOptions, limits)` | `→ {path,code,message}[]` (codes `result-unreadable-nodes`, `result-unreadable-bytes`) | Pure. |
| `assertProducerReaderInvariant(runOptions, limits)` | throws `InvalidOptionsError{reason:'result-unreadable'}` | §13.6 R21-2. |

**Not exported from `options.js`** (consumers have asked for these; each is rejected, with the replacement): `SCHEMA_CEILINGS` (P5) — read `RUN_OPTION_CEILINGS.{maxResultsPerRun, maxLedgerRecords, maxUnitsPerRun, maxRetainedDiagnostics, maxElementTaintsPerUnit}` and `ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection`; there is no schema-wide string-length ceiling in the spec (a per-path `stringLimitFor` is P5's own, spec-derived table); `nodeCountOf(resultSet)` (P7 harness) — use `captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes`; a `{options, issues}`-returning `resolveRunOptions` (P3) — it returns the frozen options and **throws** `InvalidOptionsError`.

Issue codes produced by option validation: `bad-shape`, `unknown-key`, `not-an-integer`, `not-a-boolean`, `bad-enum`, `below-minimum`, `above-ceiling`, `cross-field`. Paths are JSON pointers (`/maxUnitsPerRun`).

### `clashtest/util/capture.js`

| Export | Signature | Meaning |
|---|---|---|
| `captureData(root, opts)` | `→ {ok:true, value, nodes, openFieldBytes?} \| {ok:false, issues:{path,code,message}[], issuesTruncated, nodes, openFieldBytes?, gate?}` (`nodes` on failure = values actually copied before capture stopped; `openFieldBytes` only when `openFieldBudget` is passed); never throws for data problems (throws `TypeError` only if `opts.maxNodes` is missing) | Detached, data-only, descriptor-based, iterative capture. `opts`: `maxNodes` (required), `maxDepth=64`, `maxIssues=1`, `maxStringLength`, `maxKeyLength=1024`, `maxArrayLength`, `stringLimitFor(pointer)`, `arrayLimitFor(pointer)`, `rootGate {key, check}`, `openFieldBudget {isOpenPath(pathSegments), maxBytes}` (spec §13.6 unknown-field byte budget, enforced during capture; see below). |
| `CAPTURE_CODES` | `string[]` | `accessor`, `symbol-key`, `sparse-array`, `array-extra-key`, `not-plain`, `cyclic`, `unreadable`, `depth`, `too-many-nodes`, `string-too-long`, `array-too-long`, `gated`, `unknown-field-bytes`. |
| `deepFreeze(value)` / `deepFreezeSliced(value, slicer)` / `isDeepFrozen(value)` | `→ value` / `Promise<value>` / `boolean` | Iterative deep freeze (sliced: one `slicer.tick('freeze')` per node). |

**`util/capture.js` exports exactly those five names** (a test pins the export surface; adding `openFieldBudget` adds an option, not an export). It does **not** export `captureResultSet`, `captureDefinition`, `captureDetached`, `ownKeysOf`, `readOwnValue` or `prototypeIsPlain` (reconciliation N4/N29): `captureResultSet(raw, {limits})` is **P5's** (`results/validateResultSet.js`), and `captureAndValidate` / `toDefinitionError` are **P2's** (`definition/validate.js`); both are thin adapters over `captureData`.

**What `captureData` reads from the raw value, precisely (P5 and P2 rely on every line).**
1. **Only own keys and own property *descriptors*** (`Reflect.ownKeys` once per object, `Reflect.getOwnPropertyDescriptor` once per key), plus `Reflect.getPrototypeOf` and `Array.isArray`. **No property `get` is ever performed on the raw value**, so no accessor (including on `schemaVersion` and `runId`) and no `get` trap is invoked; an accessor is an issue `accessor@<path>` and its getter never runs.
2. **`rootGate = {key, check}`**: the root's `key` is moved to the front of the read order; it is consulted **only if that key is an own *data* property whose value is a primitive**, and `check` then receives that primitive (taken from the descriptor, never through a getter). If `check(value)` is false, capture stops at once with issue `gated@/<key>` and `result.gate = {key, value}` (the offending primitive). **Not consulted, so the caller must still validate the captured copy:** a missing key, an accessor, or a non-primitive value.
3. **`runId` / `schemaVersion` metadata is never read from `raw` by the caller before or beside the capture.** A caller that needs a diagnostic `runId` (for an error object) takes it from the **captured copy** — `r.ok && typeof r.value?.runId === 'string' ? r.value.runId : null` — or accepts it as an explicit argument from its own caller. It must not write `raw?.runId` (including as a default parameter value), which would run an attacker-controlled getter before the descriptor walk begins.
4. The result on failure carries **no value** and `issues` are `{path, code, message}` with `message === code` (no caller data).

**`openFieldBudget: { isOpenPath: (pathSegments: readonly string[]) => boolean, maxBytes: number }` — the spec §13.6 64 KiB unknown-field budget, enforced *during* capture (P5 passes `maxBytes: 65_536` and its own per-type open/closed predicate).** `pathSegments` are the unescaped keys from the root (array indices are decimal strings, the root is `[]`; the array is frozen and fresh per call); a value is *open* if `isOpenPath` says so for its own path **or its parent is open** (everything at or below an open path), and the predicate is not consulted below an open path. Every open value is charged to **one** cumulative counter **before it is copied**: a string by its UTF-8 byte length (a pure code-unit scan of the string already read from the descriptor — no `Buffer`, no `TextEncoder`, no copy; a string longer in UTF-16 units than the remaining budget is refused without being scanned), each **property key** of an open object by its UTF-8 length (charged before that property's descriptor is read), a number/boolean/`null` by 8 bytes, and — the one addition over the bare spec wording — each open object/array **container** by 8 bytes (so nested empty containers cannot dodge the budget). Closed values are never charged. If the running total would exceed `maxBytes`, capture stops at once with the single issue `unknown-field-bytes@<pointer of the offending value>` (a `CAPTURE_CODES` value, so P5 maps it to `CorruptResultSetError` like every other non-node-ceiling code): **no later descriptor is read and nothing later is copied**, so the memory guarantee holds. The counter is the existing `nodes`, now also returned on failure — each node is charged immediately before it is copied, so `result.nodes` is exactly the number of values copied when capture stopped and a test can assert that values after the offending one were not copied; `openFieldBytes` is the running total (present only when the option is passed). Omitted ⇒ no accounting, no `isOpenPath` call, results as before except that a failure now also carries `nodes`. Descriptor discipline is unchanged. A throwing `isOpenPath` is reported as `unreadable`, never thrown.

**The two node ceilings of spec §13.6 and the mapping P5 applies (`captureData` has ONE `maxNodes`).** `resolveEngineLimits` guarantees `limits.maxCapturedNodes <= SCHEMA_MAX_NODES`, so P5 calls `captureData(raw, {maxNodes: limits.maxCapturedNodes, …})` — never `Math.min`, never a second ceiling. On `{ok:false}` a `too-many-nodes` issue means: **`limits.maxCapturedNodes < SCHEMA_MAX_NODES` ⇒ `ResultSetTooLargeError{runId}`** (larger than *this reader* allows; not proof of corruption); **`limits.maxCapturedNodes === SCHEMA_MAX_NODES` ⇒ `CorruptResultSetError{runId, issues:[{path, code:'too-many-nodes'}]}`** (larger than the schema's own maximum, which no conforming producer emits). Every other `CAPTURE_CODES` value ⇒ `CorruptResultSetError` with `{path, code}` pairs only. Both outcomes fail closed; the only imprecision is that a set over `SCHEMA_MAX_NODES` read by an engine whose limit is lower reports "too large" instead of "corrupt" (S-P0-4). `gated` ⇒ P5 classifies `gate.value` (a newer integer ⇒ `UnsupportedSchemaVersionError{type:'ResultSet', schemaVersion: gate.value, supported}`; anything else ⇒ `CorruptResultSetError`).

### `clashtest/util/canonical.js`

| Export | Signature | Meaning |
|---|---|---|
| `DIGEST_VERSION`, `DIGEST_PREFIX` | `1`, `'sha256:'` | Recorded beside every durable digest. |
| `canonicalJson(value)` / `canonicalChunks(value)` | `→ string` / `Generator<string>` | Canonical JSON (`TypeError` on anything not plain JSON data). |
| `Sha256` | `update(Uint8Array) → this`, `digestHex() → string` | Incremental pure-JS SHA-256. |
| `sha256Text(text)` | `→ 'sha256:…'` | Digest of UTF-8 text. |
| `digestCanonical(value)` | `→ 'sha256:…'` | Synchronous; small values only. |
| `digestCanonicalSliced(value, slicer, {label?})` | `→ Promise<'sha256:…'>` | Byte-identical, one `tick` per ~8 KiB of canonical text. |

### `clashtest/util/slicer.js`

| Export | Signature | Meaning |
|---|---|---|
| `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery=64, spanRecorder?, afterYield?})` | `→ {tick(label?), yieldNow(label?), reset(), forEach(list, fn, {label?}), sortSliced(list, compare, {label?}), stats()}` | One slicer per sliced operation; `reset()` (added by the conformance pass for P4's `projectDiagnostics`) restarts the current slice — clock and item counters — **without yielding**, for a caller that reuses one slicer across sequential operations separated by non-sliced time; `stats()` is unchanged by it. There is **no** `step()`, `checkpoint()`, `runSliced()`, `defaultNow` or `defaultYieldToScheduler`: `now` and `yieldToScheduler` simply default inside `createSlicer` (`performance.now()`, a macrotask), so a consumer that has no injected clock passes `undefined`. `tick()` returns `undefined` (not due) or a Promise (due): `const p = slicer.tick('x'); if (p) await p;`. `limits` = resolved engine limits (`sliceBudgetMs`, `aggregationSliceMaxItems`). `afterYield` may throw to abort (cancellation seam). |
| `makeYieldToScheduler(kind, {requestAnimationFrame?})` | `('animation-frame' \| 'macrotask') → () => Promise<void>` | The `interUnitYield` scheduler; `'animation-frame'` degrades to a macrotask when rAF is absent. |

### `test/clashtest/support/index.mjs` (test-only)

| Export | Meaning |
|---|---|
| `createFakeClock({start=0, tickMs=0, yieldAdvanceMs=0})` → `{now, advance(ms), peek(), yieldToScheduler, yieldCount, onYield(fn)}` | Deterministic `now`/`yieldToScheduler`; `now`/`yieldToScheduler` are detachable closures; `onYield(fn)` runs inside every yield (mutate-at-yield, cancel-at-yield tests). |
| `createFakeWorld({defaultResult?})` → `{calls, script(...steps), hold(), dispose(), inFlight, maxInFlight, disposed, findClashes}`; `createFakeModel(id)`; `emptyClashResult()`; `snapshotQuery(query)` | Records every `findClashes` call (`{index, query, snapshot}`), scripted with results / `Error`s / functions, `hold()` parks the next call. |
| `createFakeEnumerator({models, checkpointsPerCall=1, cooperative=true})` → `{calls, resolveRoots, digestScope, set(modelKey, patch), onCall(fn)}`; `createFakeEnumerationContext({yieldToScheduler?})` → `{checkpoint, cancel(reason), checkpoints}` | Data-driven double of the spec §6.2 port. |
| `createFakeRegistry({registrySessionId?, models?})` → `{registrySessionId, register, getBinding, snapshotBindings}` | **Placeholder** for P1's `ModelRegistry` (see Assumed below). **Not API-compatible with P1** (`register({modelKey, modelVersion})` takes one object, the reader is `getBinding` not `bindingFor`, `snapshotBindings()` takes no key list and returns a sorted array, there is no lease/`dead`/placement surface): anything that exercises the real registry surface uses P1's `createModelRegistry({world: makeLeaseWorld()})` (`test/clashtest/support/leaseWorld.mjs`), never this double. |

**Extension rules for `test/clashtest/support/`** (also in `index.mjs`): (1) never change an exported signature or default behaviour — add options with backward-compatible defaults; (2) a phase adds a **new** file `support/<area>.mjs` (e.g. `fakeWorld.placement.mjs`, `fakeExecutor.mjs`, `fakeResultStore.mjs`) and appends its exports to `index.mjs`; it never edits another phase's file; (3) support files contain no `test(...)` and are not named `*.test.mjs` (the runner `scripts/run-tests.mjs` only discovers `*.test.mjs`); (4) no wall-clock time or timers in support code — use `createFakeClock`.

**Assumed (to be reconciled by the controller):** P0 depends on no earlier phase. The fake registry assumes P1's binding shape `{modelKey, modelVersion, model, bindingGeneration}` and `registrySessionId`; the fake enumerator assumes P3's port shapes exactly as spec §6.2 writes them (`resolveRoots(binding, scope, ctx)`, `digestScope(binding, scope, ctx)`, `binding.modelKey`, `ctx.checkpoint()`); the fake world assumes P4's query shape exactly as spec §7.2 writes it. If P1/P3/P4 choose different shapes, they extend `support/` by rule (2) — the P0 files stay valid.

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `clashtest/errors.js` | Create | Every typed error of spec §18; `ERROR_CATALOGUE`. |
| `clashtest/util/capture.js` | Create | Detached descriptor-based capture; deep freeze helpers. |
| `clashtest/options.js` | Create | Single home of defaults, ceilings, validation, cross-field rules, producer/reader invariant. |
| `clashtest/util/slicer.js` | Create | Deadline-aware sliced work; scheduler seam. |
| `clashtest/util/canonical.js` | Create | Canonical JSON, incremental SHA-256, digest helpers. |
| `test/clashtest/errors.test.mjs` | Create | Catalogue + field tests. |
| `test/clashtest/util/capture.test.mjs` | Create | Capture invariants. |
| `test/clashtest/options.test.mjs` | Create | Validation behaviour. |
| `test/clashtest/options.defaults.test.mjs` | Create | Provisional-defaults conformance vs spec §17.1/§17.1.1, producer/reader invariant, collision drift guard. |
| `test/clashtest/support/{fakeClock,fakeWorld,fakeEnumerator,fakeRegistry,index}.mjs` | Create | Shared doubles. **`index.mjs` is the barrel every later phase appends one export line to** (P1 `leaseWorld`, P2 `definitions`, P3 `syntheticModels`/`bruteForcePairs`, P4 `executionWorld`/`executionRequests`/`realWorldFixture`, P5 `resultSetFixtures`/`resultStoreConformance`, P6 `scriptedExecutor`/`fakePlanner`/`placementRegistry`/`runFixture`/`sealedSetFixture`, P7 `realWorld`/`bruteForce`/`maximumShape`); the full roster is a comment inside `index.mjs` (Task P0.5 Step 6) so an unlisted double is visibly a fork. |
| `test/clashtest/support.test.mjs` | Create | Tests of the doubles themselves. |
| `test/clashtest/util/slicer.test.mjs`, `test/clashtest/util/canonical.test.mjs` | Create | Slicer and canonical/digest tests. |

No existing file is modified. The `clashtest/` and `test/clashtest/` directories are new; `scripts/run-tests.mjs` already discovers `test/clashtest/**/*.test.mjs`.

**Design notes (simplifications the master plan allows).**
1. *Capture then validate the copy.* Spec §5.3 describes one pass that reads, validates schema keys and copies. P0 splits it: `captureData` guarantees the structural invariants (plain data, no accessor/symbol/hole/extra key/cycle/non-finite, bounded depth/nodes/lengths) in one descriptor-reading pass; the schema checks (unknown property, V2–V6) run in P2 **on the copy**. The externally observable safety invariants are unchanged: no getter is ever invoked, each descriptor is read once, the caller's object is never touched again, and the value validated is the value used. Unknown-key cost is bounded by the node ceiling *after* `Reflect.ownKeys` (the spec's stated trust boundary).
2. *One node ceiling.* `captureData` takes a single `maxNodes`; P5 maps `too-many-nodes` to `ResultSetTooLargeError` or `CorruptResultSetError` by comparing `limits.maxCapturedNodes` with `SCHEMA_MAX_NODES` — the exact rule is stated under *The two node ceilings* in the interface summary and in Gates item 3.
3. *No `crypto` dependency.* The SHA-256 is pure JS so the same code runs in the browser and can be sliced; tests cross-check it against `node:crypto`.


---

## Tasks

Commit-message rule for every checkpoint step: use the repo's Conventional-style subject shown, end with the `Co-Authored-By` trailer required by the project, and never add a `Claude-Session` trailer.

### Task P0.1: Typed error catalogue (`clashtest/errors.js`)

**Files**
- Create: `clashtest/errors.js`
- Test: `test/clashtest/errors.test.mjs`

**Interfaces**
- Consumes: nothing.
- Produces: `ClashTestError`, the 33 error classes of spec §18 plus `RunIdConflictError`, and `ERROR_CATALOGUE` (see the interface summary table for fields). Every later phase imports its errors from here; none defines its own.

- [x] **Step 1: Write the failing test**

`test/clashtest/errors.test.mjs`:

```js
// test/clashtest/errors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as errors from '../../clashtest/errors.js';

// Names transcribed from spec section 18 ("Errors the engine's own API throws" + the store errors it names).
const SPEC_18_NAMES = [
  'InvalidTestDefinitionError', 'ModelBindingError', 'RunQueueFullError', 'ResultCapacityError',
  'ResultSetRetainedError', 'UnsavedResultSetError', 'ModelKeyVersionConflictError', 'IdentityConflictError',
  'AnnotationTooLargeError', 'EnumerationCancelledError', 'AnnotationSupersededError', 'AnnotationBusyError',
  'AttributeSourceError', 'UnsupportedSchemaVersionError', 'EngineDisposedError', 'RevisionConflictError',
  'TestDeletedError', 'TestArchivedError', 'RunNotTerminalError', 'ResultNotResidentError',
  'CorruptResultSetError', 'ResultSetTooLargeError', 'ReadCapacityError', 'ReadAbortedError',
  'DerivationAbortedError', 'DerivationBusyError', 'GroupingTooLargeError', 'ComparisonTooLargeError',
  'FacetRangeError', 'CorruptListingError', 'PersistenceOutcomeUnknownError', 'StoreNotConfiguredError',
  'InvalidOptionsError', 'RunIdConflictError',
];

test('the catalogue is exactly the spec section 18 error list (and every class is exported)', () => {
  assert.deepEqual(errors.ERROR_CATALOGUE.map((e) => e.name).sort(), [...SPEC_18_NAMES].sort());
  for (const name of SPEC_18_NAMES) assert.equal(typeof errors[name], 'function', name);
});

test('every class: instanceof Error and ClashTestError, name === class name, default fields, message', () => {
  for (const { name, fields } of errors.ERROR_CATALOGUE) {
    const e = new errors[name]();
    assert.ok(e instanceof Error && e instanceof errors.ClashTestError, name);
    assert.equal(e.name, name);
    assert.equal(errors[name].name, name);
    assert.ok(typeof e.message === 'string' && e.message.length > 0, name);
    for (const f of fields) assert.ok(f in e, `${name}.${f}`);
  }
});

test('typed fields round-trip and an explicit message / cause override the defaults', () => {
  const cause = new Error('root');
  const e = new errors.RevisionConflictError({ testId: 't1', latest: 3, offered: 5, message: 'custom', cause });
  assert.equal(e.testId, 't1'); assert.equal(e.latest, 3); assert.equal(e.offered, 5);
  assert.equal(e.message, 'custom'); assert.equal(e.cause, cause);
  const cap = new errors.ResultCapacityError({ cap: 4, active: ['a'], retained: ['b'], held: [{ runId: 'c', persistence: 'pending' }] });
  assert.deepEqual([cap.cap, cap.active, cap.retained, cap.held], [4, ['a'], ['b'], [{ runId: 'c', persistence: 'pending' }]]);
});

test('array defaults are per-instance (never shared between errors)', () => {
  const a = new errors.ResultCapacityError(); const b = new errors.ResultCapacityError();
  assert.notEqual(a.active, b.active);
});

test('CorruptResultSetError and CorruptListingError keep at most 20 {path, code} pairs and never values or messages', () => {
  const issues = Array.from({ length: 30 }, (_, i) => ({ path: `/results/${i}`, code: 'not-plain', message: 'secret value 42', value: 42 }));
  for (const Ctor of [errors.CorruptResultSetError, errors.CorruptListingError]) {
    const e = new Ctor({ runId: 'r1', issues });
    assert.equal(e.issues.length, 20);
    assert.deepEqual(Object.keys(e.issues[0]).sort(), ['code', 'path']);
    assert.ok(Object.isFrozen(e.issues));
  }
});

test('InvalidTestDefinitionError / InvalidOptionsError keep {path, code, message} and issuesTruncated / reason', () => {
  const e = new errors.InvalidTestDefinitionError({ issues: [{ path: '/mode', code: 'bad-enum', message: 'x' }], issuesTruncated: true });
  assert.deepEqual(e.issues, [{ path: '/mode', code: 'bad-enum', message: 'x' }]);
  assert.equal(e.issuesTruncated, true);
  const o = new errors.InvalidOptionsError({ reason: 'result-unreadable', issues: [{ path: '/maxResultsPerRun', code: 'cross-field' }] });
  assert.equal(o.reason, 'result-unreadable');
  assert.equal(o.issues[0].message, '');
});

test('UnsupportedSchemaVersionError never retains an arbitrary caller object as schemaVersion', () => {
  assert.equal(new errors.UnsupportedSchemaVersionError({ type: 'ResultSet', schemaVersion: 7, supported: 1 }).schemaVersion, 7);
  assert.equal(new errors.UnsupportedSchemaVersionError({ schemaVersion: { evil: true } }).schemaVersion, null);
  assert.equal(new errors.UnsupportedSchemaVersionError({ schemaVersion: 'x'.repeat(500) }).schemaVersion.length, 64);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/errors.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`Cannot find module '…/clashtest/errors.js'`).

- [x] **Step 3: Implement `clashtest/errors.js`**

```js
// clashtest/errors.js
//
// Every typed error of spec section 18 (the engine's own API errors, plus the three ports' errors
// the spec names: IdentityConflictError / RunIdConflictError / PersistenceOutcomeUnknownError come
// from a ResultStore, TestDeletedError / RevisionConflictError from a ClashTestStore). Library
// (collision/) errors are never re-exported or wrapped here: the engine maps them to unit
// outcomes, it does not throw them.
//
// Convention: `new XError({ ...typedFields, message?, cause? })`. `error.name` is the class name
// (persistence records `error.name`, spec 13.5.1). Typed fields are plain data (JSON-safe) so an
// error can be summarised into a Result Set or a progress event without a live object.

/** Base class: lets a host write `err instanceof ClashTestError`. */
export class ClashTestError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ClashTestError';
  }
}

/** @type {Array<{ name: string, fields: string[] }>} */
const catalogue = [];

/**
 * @param {string} name
 * @param {Record<string, unknown | (() => unknown)>} fields typed fields and their defaults
 *        (a function default is called per instance so arrays are never shared)
 * @param {(init: any) => string} describe default message
 * @param {(init: any) => any} [normalize] input clean-up applied before the fields are copied
 */
function defineError(name, fields, describe, normalize) {
  const cls = {
    [name]: class extends ClashTestError {
      constructor(init = {}) {
        const src = normalize ? normalize({ ...init }) : init;
        super(init.message ?? describe(src), init.cause);
        this.name = name;
        for (const [field, dflt] of Object.entries(fields)) {
          this[field] = src[field] !== undefined ? src[field] : (typeof dflt === 'function' ? dflt() : dflt);
        }
      }
    },
  }[name];
  catalogue.push(Object.freeze({ name, fields: Object.freeze(Object.keys(fields)) }));
  return cls;
}

const sample = (issues) => (issues && issues[0] ? ` (first: ${issues[0].code} at ${issues[0].path})` : '');
// A rejected schemaVersion is caller data: keep only a number or a short string, never an object.
const boundedVersion = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? v.slice(0, 64) : null);
const fullIssues = (init) => ({
  ...init,
  issues: Object.freeze((init.issues ?? []).map(({ path, code, message }) => Object.freeze({ path, code, message: message ?? '' }))),
});
// Persisted-set and listing errors carry NO values (spec 13.6): first 20 {path, code} only.
const bareIssues = (init) => ({
  ...init,
  issues: Object.freeze((init.issues ?? []).slice(0, 20).map(({ path, code }) => Object.freeze({ path, code }))),
});

// ---- definitions and options ----------------------------------------------------------------------
export const InvalidTestDefinitionError = defineError('InvalidTestDefinitionError',
  { issues: () => [], issuesTruncated: false },
  (i) => `invalid clash test definition${sample(i.issues)}`, fullIssues);
export const UnsupportedSchemaVersionError = defineError('UnsupportedSchemaVersionError',
  { type: null, schemaVersion: null, supported: null },
  (i) => `unsupported ${i.type ?? 'schema'} version`,
  (i) => ({ ...i, schemaVersion: boundedVersion(i.schemaVersion) }));
export const InvalidOptionsError = defineError('InvalidOptionsError',
  { issues: () => [], reason: null },
  (i) => `invalid options${i.reason ? ` [${i.reason}]` : ''}${sample(i.issues)}`, fullIssues);

// ---- identity, registry, stores -------------------------------------------------------------------
export const ModelBindingError = defineError('ModelBindingError',
  { reason: null, modelKey: null }, (i) => `model binding error${i.reason ? ` [${i.reason}]` : ''}`);
export const ModelKeyVersionConflictError = defineError('ModelKeyVersionConflictError',
  { modelKey: null, existingVersion: null, offeredVersion: null }, (i) => `modelKey ${i.modelKey} is already bound to a different modelVersion`);
export const IdentityConflictError = defineError('IdentityConflictError',
  { modelKey: null, existingVersion: null, offeredVersion: null }, (i) => `result store already maps modelKey ${i.modelKey} to a different modelVersion`);
export const RevisionConflictError = defineError('RevisionConflictError',
  { testId: null, latest: null, offered: null }, (i) => `revision ${i.offered} rejected for test ${i.testId} (latest ${i.latest})`);
export const TestDeletedError = defineError('TestDeletedError', { testId: null }, (i) => `test ${i.testId} was deleted`);
export const TestArchivedError = defineError('TestArchivedError', { testId: null }, (i) => `test ${i.testId} is archived`);
export const RunIdConflictError = defineError('RunIdConflictError', { runId: null }, (i) => `run ${i.runId} already stored with different content`);
export const PersistenceOutcomeUnknownError = defineError('PersistenceOutcomeUnknownError', { runId: null }, () => 'persistence outcome unknown');
export const StoreNotConfiguredError = defineError('StoreNotConfiguredError', { store: null }, (i) => `no ${i.store} is configured`);
export const CorruptListingError = defineError('CorruptListingError',
  { issues: () => [] }, (i) => `corrupt store listing${sample(i.issues)}`, bareIssues);

// ---- runs and residency ---------------------------------------------------------------------------
export const RunQueueFullError = defineError('RunQueueFullError', { limit: null, queued: null }, (i) => `run queue is full (limit ${i.limit})`);
export const ResultCapacityError = defineError('ResultCapacityError',
  { cap: null, active: () => [], retained: () => [], held: () => [] },
  (i) => `result capacity ${i.cap} exhausted`);
export const ResultSetRetainedError = defineError('ResultSetRetainedError', { runId: null }, (i) => `result set ${i.runId} is retained`);
export const UnsavedResultSetError = defineError('UnsavedResultSetError', { runId: null }, (i) => `result set ${i.runId} is not saved`);
export const RunNotTerminalError = defineError('RunNotTerminalError', { runId: null }, (i) => `run ${i.runId} is not terminal`);
export const ResultNotResidentError = defineError('ResultNotResidentError', { runId: null }, (i) => `result set ${i.runId} is not resident`);
export const EngineDisposedError = defineError('EngineDisposedError', {}, () => 'engine has been disposed');

// ---- persisted sets and reads ---------------------------------------------------------------------
export const CorruptResultSetError = defineError('CorruptResultSetError',
  { runId: null, issues: () => [] }, (i) => `corrupt result set${sample(i.issues)}`, bareIssues);
export const ResultSetTooLargeError = defineError('ResultSetTooLargeError', { runId: null }, (i) => `result set ${i.runId} exceeds this engine's read limits`);
export const ReadCapacityError = defineError('ReadCapacityError', { limit: null }, (i) => `read capacity ${i.limit} exhausted`);
export const ReadAbortedError = defineError('ReadAbortedError', {}, () => 'read aborted');

// ---- planning --------------------------------------------------------------------------------------
// reason: 'cancelled' | 'lease-dead' | 'disposed' (spec 6.2 EnumerationContext.checkpoint)
export const EnumerationCancelledError = defineError('EnumerationCancelledError', { reason: null }, (i) => `enumeration cancelled${i.reason ? ` [${i.reason}]` : ''}`);

// ---- annotation and derivations --------------------------------------------------------------------
export const AnnotationTooLargeError = defineError('AnnotationTooLargeError', { limit: null, observed: null }, (i) => `annotation exceeds ${i.limit}`);
export const AnnotationSupersededError = defineError('AnnotationSupersededError', { runId: null }, () => 'annotation superseded');
export const AnnotationBusyError = defineError('AnnotationBusyError', { limit: null }, (i) => `annotation concurrency ${i.limit} exhausted`);
export const AttributeSourceError = defineError('AttributeSourceError', { modelKey: null }, () => 'attribute source failed');
export const DerivationAbortedError = defineError('DerivationAbortedError', {}, () => 'derivation aborted');
export const DerivationBusyError = defineError('DerivationBusyError', { limit: null }, (i) => `derivation concurrency ${i.limit} exhausted`);
export const GroupingTooLargeError = defineError('GroupingTooLargeError', { limit: null, observed: null }, (i) => `grouping exceeds ${i.limit}`);
export const ComparisonTooLargeError = defineError('ComparisonTooLargeError', { limit: null, observed: null }, (i) => `comparison exceeds ${i.limit}`);
export const FacetRangeError = defineError('FacetRangeError', { facetId: null }, (i) => `facet ${i.facetId} value out of range`);

/** Frozen list of `{ name, fields }` for every class above (used by the catalogue test and docs). */
export const ERROR_CATALOGUE = Object.freeze(catalogue.slice());
```

- [x] **Step 4: Run it and confirm it passes**

Run: `node --test test/clashtest/errors.test.mjs`
Expected: PASS — 7 tests, 0 failures.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits)**

```bash
git add clashtest/errors.js test/clashtest/errors.test.mjs
git commit -m "feat(clashtest): P0.1 typed error catalogue (spec section 18)"
```

### Task P0.2: Detached descriptor-based capture (`clashtest/util/capture.js`)

**Files**
- Create: `clashtest/util/capture.js`
- Test: `test/clashtest/util/capture.test.mjs`

**Interfaces**
- Consumes: nothing (`deepFreezeSliced` takes any object with `tick(label)`; P0.6's slicer satisfies it).
- Produces: `captureData`, `CAPTURE_CODES`, `deepFreeze`, `deepFreezeSliced`, `isDeepFrozen`. P2 uses `captureData` for definitions (`maxIssues: limits.maxValidationIssues`, a `maxNodes` derived from `maxEntriesPerSelection`/`maxExplicitElementsPerSelection`); P5 uses it, with `rootGate: {key:'schemaVersion', …}` and `stringLimitFor`/`arrayLimitFor`, for external Result Sets; P6/P7 use it for `runOptions` via `options.js`.

- [x] **Step 1: Write the failing test**

`test/clashtest/util/capture.test.mjs`:

```js
// test/clashtest/util/capture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as captureModule from '../../../clashtest/util/capture.js';
import { captureData, deepFreeze, deepFreezeSliced, isDeepFrozen } from '../../../clashtest/util/capture.js';

const cap = (v, o = {}) => captureData(v, { maxNodes: 1_000, ...o });
const codes = (r) => r.issues.map((i) => `${i.code}@${i.path}`);

test('maxNodes is required', () => {
  assert.throws(() => captureData({}, {}), TypeError);
  assert.throws(() => captureData({}), TypeError);
});

test('captures a detached deep copy: key order kept, later caller mutation has no effect', () => {
  const src = { b: 1, a: [1, { z: 'x' }], c: null, d: true };
  const r = cap(src);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, src);
  assert.deepEqual(Object.keys(r.value), ['b', 'a', 'c', 'd']);
  assert.notEqual(r.value, src); assert.notEqual(r.value.a, src.a); assert.notEqual(r.value.a[1], src.a[1]);
  src.a[1].z = 'changed'; src.a.push(9); src.b = 2;
  assert.equal(r.value.a[1].z, 'x'); assert.equal(r.value.a.length, 2); assert.equal(r.value.b, 1);
});

test('primitive roots and null-prototype objects are accepted; nodes are counted', () => {
  assert.deepEqual(cap(5), { ok: true, value: 5, nodes: 1 });
  const np = Object.create(null); np.k = 1;
  const r = cap(np);
  assert.equal(r.ok, true); assert.equal(r.value.k, 1); assert.equal(r.nodes, 2);
});

test('a getter is never invoked: accessor property and accessor array index are issues', () => {
  let calls = 0;
  const o = { ok: 1 }; Object.defineProperty(o, 'evil', { enumerable: true, get() { calls++; return 1; } });
  const arr = [1]; Object.defineProperty(arr, 1, { enumerable: true, get() { calls++; return 2; } });
  assert.deepEqual(codes(cap(o)), ['accessor@/evil']);
  assert.deepEqual(codes(cap({ list: arr })), ['accessor@/list/1']);
  assert.equal(calls, 0);
});

test('symbol keys, array holes and extra array keys are issues', () => {
  assert.deepEqual(codes(cap({ [Symbol('s')]: 1 })), ['symbol-key@/s']);
  assert.deepEqual(codes(cap({ a: [1, , 3] })), ['sparse-array@/a/1']); // eslint-disable-line no-sparse-arrays
  const extra = [1, 2]; extra.tag = 'x';
  assert.deepEqual(codes(cap(extra)), ['array-extra-key@']);
});

test('non-plain values are not-plain: Map, Set, Date, class instance, function, undefined, NaN, Infinity, bigint, symbol', () => {
  class Foo { constructor() { this.x = 1; } }
  for (const bad of [new Map(), new Set(), new Date(0), new Foo(), () => 1, undefined, NaN, Infinity, -Infinity, 1n, Symbol('s')]) {
    const r = cap({ v: bad });
    assert.equal(r.ok, false, String(bad));
    assert.deepEqual(codes(r), ['not-plain@/v'], String(bad));
  }
});

test('a revisited object (cycle or shared reference) is cyclic', () => {
  const a = {}; a.self = a;
  assert.deepEqual(codes(cap(a)), ['cyclic@/self']);
  const shared = { s: 1 };
  assert.deepEqual(codes(cap({ x: shared, y: shared })), ['cyclic@/y']);
});

test('depth: 64 levels of nesting are accepted, 65 are rejected', () => {
  const nest = (n) => { let v = 1; for (let i = 0; i < n; i++) v = { c: v }; return v; };
  assert.equal(cap(nest(64)).ok, true);
  assert.equal(codes(cap(nest(65)))[0].split('@')[0], 'depth');
});

test('node ceiling is charged BEFORE elements are read or allocated', () => {
  let reads = 0;
  const big = new Array(1_000_000); // length only; must be rejected in O(1)
  Object.defineProperty(big, 0, { enumerable: true, get() { reads++; return 1; } });
  const r = captureData({ big }, { maxNodes: 100 });
  assert.deepEqual(codes(r), ['too-many-nodes@/big']);
  assert.equal(reads, 0);
  assert.equal(captureData([1, 2, 3], { maxNodes: 4 }).ok, true);
  assert.equal(captureData([1, 2, 3], { maxNodes: 3 }).ok, false);
});

test('string, key and array length caps (including per-path overrides)', () => {
  assert.deepEqual(codes(cap({ s: 'abcd' }, { maxStringLength: 3 })), ['string-too-long@/s']);
  assert.deepEqual(codes(cap({ ['k'.repeat(11)]: 1 }, { maxKeyLength: 10 }))[0].startsWith('string-too-long@'), true);
  assert.deepEqual(codes(cap({ a: [1, 2, 3] }, { maxArrayLength: 2 })), ['array-too-long@/a']);
  const r = cap({ a: [1, 2, 3], b: [1, 2, 3] }, { maxArrayLength: 2, arrayLimitFor: (p) => (p === '/a' ? 3 : undefined) });
  assert.deepEqual(codes(r), ['array-too-long@/b']);
  assert.equal(cap({ id: 'x'.repeat(50) }, { maxStringLength: 3, stringLimitFor: (p) => (p === '/id' ? 64 : undefined) }).ok, true);
});

test('__proto__ as an own key is captured as an own data property (never invokes the setter)', () => {
  const src = JSON.parse('{"__proto__": {"polluted": true}, "n": 1}');
  const r = cap(src);
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.equal(Object.hasOwn(r.value, '__proto__'), true);
  assert.equal(({}).polluted, undefined);
});

test('a throwing proxy trap or a revoked proxy is reported as unreadable; the thrown value never escapes', () => {
  const secret = new Error('trap secret');
  const hostile = new Proxy({}, { ownKeys() { throw secret; } });
  const r = cap({ h: hostile });
  assert.deepEqual(codes(r), ['unreadable@/h']);
  assert.ok(!JSON.stringify(r).includes('secret'));
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.deepEqual(codes(cap({ p: proxy })), ['unreadable@/p']);
});

test('issues are collected up to maxIssues, then truncated', () => {
  const r = cap({ a: undefined, b: undefined, c: undefined }, { maxIssues: 2 });
  assert.equal(r.ok, false); assert.equal(r.issues.length, 2); assert.equal(r.issuesTruncated, true);
  const exact = cap({ a: undefined, b: undefined }, { maxIssues: 2 });
  assert.equal(exact.issues.length, 2); assert.equal(exact.issuesTruncated, false);
});

test('-0 is captured as-is (normalization is the canonical encoder\'s job)', () => {
  assert.equal(Object.is(cap({ n: -0 }).value.n, -0), true);
});

test('rootGate: the version key is read first and a failing value stops capture before anything else is read', () => {
  let calls = 0;
  const set = { results: [], schemaVersion: 2 };
  Object.defineProperty(set, 'trap', { enumerable: true, get() { calls++; return 1; } });
  const gate = { key: 'schemaVersion', check: (v) => v === 1 };
  const r = cap(set, { rootGate: gate });
  assert.equal(r.ok, false);
  assert.deepEqual(r.gate, { key: 'schemaVersion', value: 2 });
  assert.deepEqual(codes(r), ['gated@/schemaVersion']);
  assert.equal(calls, 0);
  assert.equal(cap({ results: [], schemaVersion: 1 }, { rootGate: gate }).ok, true);
});

test('a throwing getter on schemaVersion or runId is never invoked: accessor issues, the gate is not consulted, no get trap fires (P5 metadata rule)', () => {
  let getterCalls = 0;
  let gateCalls = 0;
  const boom = () => { getterCalls += 1; throw new Error('getter must never run'); };
  const set = { results: [] };
  Object.defineProperty(set, 'schemaVersion', { enumerable: true, get: boom });
  Object.defineProperty(set, 'runId', { enumerable: true, get: boom });
  const gate = { key: 'schemaVersion', check: () => { gateCalls += 1; return true; } };
  const r = cap(set, { rootGate: gate, maxIssues: 10 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r).sort(), ['accessor@/runId', 'accessor@/schemaVersion']);
  assert.equal(getterCalls, 0);
  assert.equal(gateCalls, 0);                                     // the gate only ever sees a primitive read from a DATA descriptor
  assert.equal(r.value, undefined);                               // a failed capture returns no value at all
  assert.ok(!JSON.stringify(r).includes('must never run'));

  // even a proxy whose `get` trap would throw is never asked for a property value
  let gets = 0;
  const spy = new Proxy({ schemaVersion: 1, runId: 'r1', results: [] }, { get() { gets += 1; throw new Error('get trap'); } });
  assert.equal(cap(spy, { rootGate: gate }).ok, true);
  assert.equal(gets, 0);
  assert.equal(gateCalls, 1);                                     // data descriptor: consulted exactly once

  // the ONLY sanctioned way to learn a diagnostic runId: from the captured copy, after a successful capture
  const runIdOf = (result) => (result.ok && typeof result.value?.runId === 'string' ? result.value.runId : null);
  assert.equal(runIdOf(r), null);
  assert.equal(runIdOf(cap({ schemaVersion: 1, runId: 'r1', results: [] }, { rootGate: gate })), 'r1');
  // a non-primitive schemaVersion is not gated (the caller must validate the copy); a missing one is not gated either
  assert.equal(cap({ schemaVersion: { n: 1 }, results: [] }, { rootGate: { key: 'schemaVersion', check: () => false } }).ok, true);
  assert.equal(cap({ results: [] }, { rootGate: { key: 'schemaVersion', check: () => false } }).ok, true);
});

test('there is ONE node ceiling and one issue code (P5 maps it); a second, softer ceiling option is ignored, not honoured', () => {
  const doc = { a: [1, 2, 3] };                                   // root + array + 3 elements = 5 nodes
  assert.deepEqual(codes(captureData(doc, { maxNodes: 4 })), ['too-many-nodes@/a']);
  const ok = captureData(doc, { maxNodes: 5, softMaxNodes: 2, unknownFieldByteBudget: 1, onRootKey() { throw new Error('unused'); } });
  assert.equal(ok.ok, true);
  assert.equal(ok.nodes, 5);
});

// ---- openFieldBudget: the spec 13.6 unknown-field byte budget, enforced DURING capture ----
const budget = (isOpenPath, maxBytes) => ({ openFieldBudget: { isOpenPath, maxBytes } });
const openAt = (...segs) => (p) => p.length >= segs.length && segs.every((s, i) => p[i] === s);

test('openFieldBudget: many individually legal 4 KiB strings exceed 64 KiB, and capture stops before the offending copy (later elements are never read or copied)', () => {
  const reads = [];
  const list = new Proxy(Array.from({ length: 100 }, () => 'x'.repeat(4096)), {
    getOwnPropertyDescriptor(t, k) { reads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = cap({ x: list, after: 1 }, { maxStringLength: 4096, ...budget(openAt('x'), 64 * 1024) });
  // charged: key 'x' (1) + the array (8) + 15 strings (61,440) = 61,449; the 16th string would make 65,545 > 65,536
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['unknown-field-bytes@/x/15']);
  assert.equal(r.value, undefined);
  assert.equal(r.nodes, 17);                                      // root + array + 15 strings: nothing after the offending value was copied
  assert.equal(r.openFieldBytes, 61_449);
  assert.deepEqual(reads.filter((k) => k !== 'length'), Array.from({ length: 16 }, (_, i) => String(i))); // index 16.. never read
  // the same document without the option is captured whole (each string is individually legal)
  const all = cap({ x: Array.from({ length: 100 }, () => 'x'.repeat(4096)) }, { maxStringLength: 4096 });
  assert.equal(all.ok, true); assert.equal(all.nodes, 102);
});

test('openFieldBudget: a below-budget open subtree copies fine; accounting is exact and the boundary is inclusive', () => {
  const doc = { a: { b: 'héllo', n: 1, t: true, z: null, arr: [1] }, closed: 'c'.repeat(500) };
  // key a 1 + container 8 + (b: 1 + 6 bytes) + (n: 1 + 8) + (t: 1 + 8) + (z: 1 + 8) + (arr: 3 + 8 + 8) = 62
  const ok = cap(doc, budget(openAt('a'), 62));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, doc);
  assert.equal(ok.openFieldBytes, 62);
  assert.equal(ok.nodes, 9);                                       // root, a, b, n, t, z, arr, arr[0], closed
  const over = cap(doc, budget(openAt('a'), 61));
  assert.equal(over.ok, false);
  assert.deepEqual(codes(over), ['unknown-field-bytes@/a/arr/0']);
  assert.equal(over.nodes, 7);                                     // root, a, b, n, t, z, arr: the element that broke the budget was not copied, and 'closed' was never reached
});

test('openFieldBudget: closed paths are never charged; isOpenPath receives frozen unescaped segments (indices as strings, root as [])', () => {
  const seen = [];
  const doc = { closed: 's'.repeat(1_000_000), 'we/ird~': [{ deep: 1 }] };
  const r = cap(doc, { maxNodes: 1_000, ...budget((p) => { seen.push([...p]); assert.equal(Object.isFrozen(p), true); return p[0] === 'we/ird~' && p.length >= 1; }, 100) });
  assert.equal(r.ok, true);
  assert.equal(r.openFieldBytes, 7 + 8 + 8 + 4 + 8);              // key 'we/ird~' (7) + array (8) + object (8) + key 'deep' (4) + number (8)
  assert.deepEqual(seen[0], []);                                   // the root itself is asked first
  assert.ok(seen.some((p) => p.join('|') === 'closed'));
  assert.equal(seen.some((p) => p.length > 1), false);             // everything below an open path is open: the predicate is not asked again
  const idx = [];
  const only = cap({ l: [1, 2, 3] }, budget((p) => { idx.push([...p]); return p.length === 2 && p[0] === 'l' && p[1] === '1'; }, 100));
  assert.equal(only.openFieldBytes, 8);                            // only l[1] is open; an array index is the decimal STRING '1'
  assert.deepEqual(idx, [[], ['l'], ['l', '0'], ['l', '1'], ['l', '2']]);
  // everything closed: nothing is charged even with a zero budget
  const none = cap(doc, { maxNodes: 1_000, ...budget(() => false, 0) });
  assert.equal(none.ok, true); assert.equal(none.openFieldBytes, 0);
});

test('openFieldBudget omitted: behaviour identical to before (no accounting, no extra result field, isOpenPath never needed)', () => {
  const src = { b: 1, a: ['x', { z: 'y' }], k: null };
  const plain = cap(src);
  assert.deepEqual(plain, { ok: true, value: src, nodes: 7 });
  assert.equal('openFieldBytes' in plain, false);
  const withClosed = cap(src, budget(() => false, 0));
  assert.deepEqual(withClosed.value, plain.value); assert.equal(withClosed.nodes, plain.nodes);
  const big = cap({ s: 'x'.repeat(1_000_000) });                   // no budget => a huge string is fine
  assert.equal(big.ok, true);
  assert.equal('openFieldBytes' in big, false);
  assert.deepEqual(codes(cap({ a: undefined })), ['not-plain@/a']);
});

test('openFieldBudget: a failure stops everything; a throwing getter or sibling deeper than the failure point is never read, let alone invoked', () => {
  let getterCalls = 0;
  const rootReads = [];
  const items = ['p'.repeat(100), 'q'.repeat(100), 0];
  Object.defineProperty(items, 2, { enumerable: true, get() { getterCalls++; return 1; } });
  const itemReads = [];
  const spyItems = new Proxy(items, { getOwnPropertyDescriptor(t, k) { itemReads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const doc = { open: spyItems };
  Object.defineProperty(doc, 'after', { enumerable: true, get() { getterCalls++; return 1; } });
  const spyDoc = new Proxy(doc, { getOwnPropertyDescriptor(t, k) { rootReads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const r = cap(spyDoc, { maxIssues: 5, ...budget(openAt('open'), 150) });
  assert.deepEqual(codes(r), ['unknown-field-bytes@/open/1']);     // 4 (key) + 8 + 100 = 112; +100 > 150
  assert.equal(getterCalls, 0);
  assert.deepEqual(itemReads.filter((k) => k !== 'length'), ['0', '1']);   // index 2 (the getter) never even had its descriptor read
  assert.deepEqual(rootReads, ['open']);                                    // 'after' (the getter) was never read
  // without the budget the same graph is walked further (proving the stop is the budget's doing) and the getter is still not invoked
  const walked = cap(doc, { maxIssues: 5 });
  assert.deepEqual(codes(walked).sort(), ['accessor@/after', 'accessor@/open/2']);
  assert.equal(getterCalls, 0);
});

test('openFieldBudget: property keys are charged too, before the property is read', () => {
  const keyed = {};
  for (const n of ['a', 'b', 'c', 'd']) keyed[n.repeat(1000)] = null;
  const reads = [];
  const spy = new Proxy(keyed, { getOwnPropertyDescriptor(t, k) { reads.push(k.length); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const r = cap(spy, budget(() => true, 2 * 1008 + 8 + 500));      // root 8 + two (1000 + 8) entries fit; the third key does not
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), [`unknown-field-bytes@/${'c'.repeat(1000)}`]);
  assert.equal(r.nodes, 3);                                        // root + two null values
  assert.deepEqual(reads, [1000, 1000]);                           // the offending key's (and every later key's) descriptor was never read
  assert.equal(r.openFieldBytes, 8 + 2 * 1008);
});

test('openFieldBudget: strings are measured in UTF-8 bytes (2/3/4-byte characters, a lone surrogate is 3), without copying', () => {
  const at = (s, max) => cap(s, budget(() => true, max));
  for (const [s, bytes] of [['abc', 3], ['éé', 4], ['€', 3], ['😀', 4], ['😀😀😀', 12], ['\ud800', 3], ['a\udc00b', 5], ['', 0]]) {
    assert.equal(bytes, Buffer.byteLength(s, 'utf8'), 'the table itself agrees with Buffer');
    const ok = at(s, bytes);
    assert.equal(ok.ok, true, JSON.stringify(s)); assert.equal(ok.openFieldBytes, bytes);
    if (bytes > 0) assert.deepEqual(codes(at(s, bytes - 1)), ['unknown-field-bytes@'], JSON.stringify(s));
  }
  // a string longer (in code units) than the whole budget is refused without being scanned
  assert.deepEqual(codes(at('z'.repeat(10_000_000), 100)), ['unknown-field-bytes@']);
});

test('openFieldBudget: the option shape is validated (TypeError, like maxNodes); a bad budget never reaches the traversal', () => {
  for (const bad of [null, {}, { isOpenPath: () => true }, { isOpenPath: () => true, maxBytes: -1 }, { isOpenPath: () => true, maxBytes: Infinity },
    { isOpenPath: 'no', maxBytes: 10 }]) {
    assert.throws(() => captureData({}, { maxNodes: 10, openFieldBudget: bad }), TypeError);
  }
  // a throwing predicate is the caller's bug, but it is reported as `unreadable`, never thrown out of captureData
  assert.deepEqual(codes(cap({ a: 1 }, budget(() => { throw new Error('predicate'); }, 10))), ['unreadable@']);
});

test('export surface: exactly five names; the per-caller adapters live in P2 (captureAndValidate) and P5 (captureResultSet), not here (N29)', () => {
  assert.deepEqual(Object.keys(captureModule).sort(), ['CAPTURE_CODES', 'captureData', 'deepFreeze', 'deepFreezeSliced', 'isDeepFrozen']);
  for (const absent of ['captureResultSet', 'captureDefinition', 'captureDetached', 'ownKeysOf', 'readOwnValue', 'prototypeIsPlain']) {
    assert.equal(absent in captureModule, false, absent);
  }
});

test('deepFreeze / isDeepFrozen / deepFreezeSliced', async () => {
  const v = { a: [1, { b: 2 }], c: { d: [3] } };
  assert.equal(isDeepFrozen(v), false);
  assert.equal(deepFreeze(v), v);
  assert.equal(isDeepFrozen(v), true);
  assert.throws(() => { 'use strict'; v.a[1].b = 9; }, TypeError);
  let ticks = 0;
  const w = { a: [1, { b: 2 }], c: { d: [3] } };
  await deepFreezeSliced(w, { tick: () => { ticks++; } });
  assert.equal(isDeepFrozen(w), true);
  assert.equal(ticks, 5); // w, w.a, w.a[1], w.c, w.c.d
});

test('every own key list and every own property descriptor is read exactly once (spy on the reflection traps)', () => {
  const seen = new Map(); let ownKeysCalls = 0;
  const spy = (target) => new Proxy(target, {
    ownKeys(t) { ownKeysCalls++; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { seen.set(k, (seen.get(k) ?? 0) + 1); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = cap(spy({ a: 1, c: 2 }));
  assert.equal(r.ok, true);
  assert.equal(ownKeysCalls, 1);
  assert.deepEqual([...seen.entries()], [['a', 1], ['c', 1]]);
  seen.clear(); ownKeysCalls = 0;
  assert.equal(cap(spy([10, 20])).ok, true);          // array: length + each index, once each
  assert.equal(ownKeysCalls, 1);
  assert.deepEqual([...seen.entries()].sort(), [['0', 1], ['1', 1], ['length', 1]]);
});

test('an object with 100,000 unknown own keys is rejected before any key is copied (the ownKeys enumeration cost itself is not bounded, spec 5.3)', () => {
  const wide = {};
  for (let i = 0; i < 100_000; i++) wide[`k${i}`] = 1;
  const r = captureData(wide, { maxNodes: 1_000 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['too-many-nodes@']);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/util/capture.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/util/capture.js`.

- [x] **Step 3: Implement `clashtest/util/capture.js`**

```js
// clashtest/util/capture.js
//
// Detached, data-only capture of an untrusted value (spec 5.3 capture algorithm, generalised to
// Result Sets in 13.6). Iterative (explicit stack, never recursive), descriptor-based: every own key
// list is read once with Reflect.ownKeys, every own property DESCRIPTOR is read once, and a getter
// is never invoked. Nothing the caller holds is touched again after captureData returns, so the
// copy is the one value that is validated, digested, planned, embedded and persisted.
//
// Simplification versus the spec (allowed by the master plan): validation of schema keys runs on
// the COPY in the owning phase (P2 definitions, P5 result sets), not inside this traversal. This
// module only guarantees the structural invariants (plain data, no accessors, no symbols, no
// holes, no cycles, no non-finite numbers, bounded depth/nodes/lengths). Bounds are charged before
// the corresponding copy is allocated.

export const CAPTURE_CODES = Object.freeze([
  'accessor', 'symbol-key', 'sparse-array', 'array-extra-key', 'not-plain', 'cyclic',
  'unreadable', 'depth', 'too-many-nodes', 'string-too-long', 'array-too-long', 'gated',
  'unknown-field-bytes',
]);

// UTF-8 byte length of a JS string, computed by scanning code units: no encoder, no Buffer, and no
// copy of the string is ever allocated. Returns Infinity without scanning when the string cannot fit
// in `limit` bytes (every UTF-16 code unit encodes to >= 1 UTF-8 byte). A lone surrogate is 3 bytes
// (it encodes as U+FFFD), which matches Buffer.byteLength.
function utf8Length(s, limit) {
  if (s.length > limit) return Infinity;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const pointerEscape = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

function pointerOf(frame, key) {
  const segs = [];
  if (key !== undefined) segs.push(pointerEscape(typeof key === 'symbol' ? (key.description ?? 'symbol') : key));
  for (let f = frame; f && f.parent; f = f.parent) segs.push(pointerEscape(f.key));
  return segs.length ? `/${segs.reverse().join('/')}` : '';
}

const isIndexKey = (k, length) => {
  if (typeof k !== 'string' || k === '' || (k.length > 1 && k[0] === '0')) return false;
  const n = Number(k);
  return Number.isInteger(n) && n >= 0 && n < length && String(n) === k;
};

const define = (obj, key, value) => {
  // `obj[key] = v` would invoke the __proto__ setter; defineProperty makes it an own data property.
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
};

/**
 * @param {unknown} root
 * @param {object} opts
 * @param {number} opts.maxNodes        REQUIRED. Every value (container or primitive) is one node.
 * @param {number} [opts.maxDepth=64] container nesting; the root container is depth 1
 * @param {number} [opts.maxIssues=1]   stop after this many issues; `issuesTruncated` when more exist.
 * @param {number} [opts.maxStringLength=Infinity]
 * @param {number} [opts.maxKeyLength=1024]
 * @param {number} [opts.maxArrayLength=Infinity]
 * @param {(pointer: string) => number | undefined} [opts.stringLimitFor] per-path override (opt-in cost)
 * @param {(pointer: string) => number | undefined} [opts.arrayLimitFor]  per-path override (opt-in cost)
 * @param {{ key: string, check: (value: unknown) => boolean }} [opts.rootGate] the root's `key` is read
 *        FIRST; if it is a data property whose primitive value fails `check`, capture stops at once
 *        with issue code 'gated' and NO other property is read (spec 13.6 schemaVersion rule).
 * @param {{ isOpenPath: (pathSegments: readonly string[]) => boolean, maxBytes: number }} [opts.openFieldBudget]
 *        The spec 13.6 unknown-field byte budget, enforced DURING capture. Every value at or below a
 *        path for which `isOpenPath(segments)` is true (segments are unescaped keys; array indices are
 *        decimal strings; the root is `[]`) is charged to ONE cumulative counter BEFORE it is copied:
 *        a string by its UTF-8 byte length, each property key of such a value by its UTF-8 length,
 *        a number/boolean/null by 8 bytes, an object/array container by 8 bytes. If the running total
 *        would exceed `maxBytes`, capture stops at once with issue 'unknown-field-bytes' at the
 *        offending value's pointer; no later value's descriptor is read and nothing later is copied.
 *        Omitted => no accounting and no `isOpenPath` call (behaviour identical to before).
 * @returns {{ ok: true, value: any, nodes: number, openFieldBytes?: number } |
 *           { ok: false, issues: Array<{ path: string, code: string, message: string }>, issuesTruncated: boolean, nodes: number, openFieldBytes?: number, gate?: { key: string, value: unknown } }}
 *          `nodes` (on failure too) is the number of values admitted, each charged immediately before it
 *          was copied, so it is the count of values actually copied when capture stopped.
 *          `openFieldBytes` is present only when `openFieldBudget` was supplied.
 */
export function captureData(root, opts) {
  if (!opts || !Number.isFinite(opts.maxNodes) || opts.maxNodes < 1) {
    throw new TypeError('captureData: opts.maxNodes (a positive number) is required');
  }
  const {
    maxNodes, maxDepth = 64, maxIssues = 1, maxStringLength = Infinity, maxKeyLength = 1024,
    maxArrayLength = Infinity, stringLimitFor, arrayLimitFor, rootGate, openFieldBudget,
  } = opts;
  const budgeted = openFieldBudget !== undefined;
  if (budgeted && (openFieldBudget === null || typeof openFieldBudget.isOpenPath !== 'function'
      || !Number.isFinite(openFieldBudget.maxBytes) || openFieldBudget.maxBytes < 0)) {
    throw new TypeError('captureData: opts.openFieldBudget must be {isOpenPath: function, maxBytes: number >= 0}');
  }
  const isOpenPath = budgeted ? openFieldBudget.isOpenPath : null;
  const maxBytes = budgeted ? openFieldBudget.maxBytes : 0;

  const issues = [];
  let truncated = false;
  let stopped = false;
  let nodes = 0;
  let gate = null;
  let openBytes = 0;
  const visited = new Set();

  const report = (code, path) => {
    if (issues.length >= maxIssues) { truncated = true; stopped = true; return; }
    issues.push({ path, code, message: code });
  };
  // Returns true when the node is admitted (charged) and false when a ceiling was hit.
  const charge = (n, path) => {
    if (nodes + n > maxNodes) { report('too-many-nodes', path); stopped = true; return false; }
    nodes += n;
    return true;
  };
  // The unknown-field byte budget: charged BEFORE the copy it pays for; on overflow capture stops.
  const chargeBytes = (n, path) => {
    if (openBytes + n > maxBytes) { report('unknown-field-bytes', path); stopped = true; return false; }
    openBytes += n;
    return true;
  };
  const chargeString = (s, path) => chargeBytes(utf8Length(s, maxBytes - openBytes), path);
  // Unescaped path segments of `key` under `frame` (a fresh, frozen array per call; depth <= maxDepth).
  const segmentsOf = (frame, key) => {
    const segs = [];
    if (key !== undefined) segs.push(String(key));
    for (let f = frame; f && f.parent; f = f.parent) segs.push(String(f.key));
    return Object.freeze(segs.reverse());
  };
  // A value is open when its parent is open (everything below an open path is open) or when the
  // caller's predicate says its own path is. isOpenPath is the caller's code: if it throws, the
  // surrounding try reports `unreadable` (never an escape).
  const openAt = (parentOpen, frame, key) => budgeted && (parentOpen || isOpenPath(segmentsOf(frame, key)) === true);

  let result;

  // A frame is the traversal state of one container. `dst` is the detached copy being filled.
  const openContainer = (src, parent, key, assign, open) => {
    const path = pointerOf(parent, key);
    if (parent && parent.depth + 1 > maxDepth) { report('depth', path); return null; }
    if (visited.has(src)) { report('cyclic', path); return null; }
    visited.add(src);
    if (Array.isArray(src)) {
      const lenDesc = Reflect.getOwnPropertyDescriptor(src, 'length');
      const length = lenDesc && lenDesc.value;
      if (!Number.isSafeInteger(length) || length < 0) { report('unreadable', path); return null; }
      const limit = arrayLimitFor ? (arrayLimitFor(path) ?? maxArrayLength) : maxArrayLength;
      if (length > limit) { report('array-too-long', path); return null; }
      if (nodes + 1 + length > maxNodes) { report('too-many-nodes', path); stopped = true; return null; }
      if (open && !chargeBytes(8, path)) return null;
      if (!charge(1, path)) return null;
      const ownKeys = Reflect.ownKeys(src);
      for (const k of ownKeys) {
        if (typeof k === 'symbol') { report('symbol-key', path); return null; }
        if (k !== 'length' && !isIndexKey(k, length)) { report('array-extra-key', path); return null; }
      }
      const dst = new Array(length);
      assign(dst);
      return { src, dst, isArray: true, keys: null, length, i: 0, parent, key, open, depth: parent ? parent.depth + 1 : 1 };
    }
    const proto = Reflect.getPrototypeOf(src);
    if (proto !== Object.prototype && proto !== null) { report('not-plain', path); return null; }
    if (open && !chargeBytes(8, path)) return null;
    if (!charge(1, path)) return null;
    const keys = Reflect.ownKeys(src);
    if (nodes + keys.length > maxNodes) { report('too-many-nodes', path); stopped = true; return null; }
    if (rootGate && !parent) {
      const at = keys.indexOf(rootGate.key);
      if (at > 0) { keys.splice(at, 1); keys.unshift(rootGate.key); }
    }
    const dst = {};
    assign(dst);
    return { src, dst, isArray: false, keys, length: keys.length, i: 0, parent, key, open, depth: parent ? parent.depth + 1 : 1 };
  };

  const admitPrimitive = (value, path, open) => {
    if (typeof value === 'string') {
      const limit = stringLimitFor ? (stringLimitFor(path) ?? maxStringLength) : maxStringLength;
      if (value.length > limit) { report('string-too-long', path); return false; }
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) { report('not-plain', path); return false; }
    } else if (typeof value !== 'boolean' && value !== null) {
      report('not-plain', path); // undefined, function, symbol, bigint
      return false;
    }
    if (open && !(typeof value === 'string' ? chargeString(value, path) : chargeBytes(8, path))) return false;
    return charge(1, path);
  };

  const stack = [];
  try {
    const first = (() => {
      if (root === null || typeof root !== 'object') {
        if (admitPrimitive(root, '', openAt(false, null, undefined))) result = root;
        return null;
      }
      return openContainer(root, null, undefined, (d) => { result = d; }, openAt(false, null, undefined));
    })();
    if (first) stack.push(first);
  } catch {
    report('unreadable', '');
  }

  while (stack.length && !stopped) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.length) { stack.pop(); continue; }
    let key;
    let path = '';
    try {
      key = frame.isArray ? String(frame.i) : frame.keys[frame.i];
      frame.i++;
      path = pointerOf(frame, key);
      if (typeof key === 'symbol') { report('symbol-key', path); continue; }
      if (!frame.isArray && key.length > maxKeyLength) { report('string-too-long', path); continue; }
      const childOpen = openAt(frame.open, frame, key);
      // An open object's property keys are unknown-field bytes too; charged before the descriptor is read.
      if (childOpen && !frame.isArray && !chargeString(key, path)) break;
      const desc = Reflect.getOwnPropertyDescriptor(frame.src, key);
      if (desc === undefined) { report(frame.isArray ? 'sparse-array' : 'unreadable', path); continue; }
      if ('get' in desc || 'set' in desc) { report('accessor', path); continue; }
      const value = desc.value;
      if (frame.depth === 1 && rootGate && key === rootGate.key && (value === null || typeof value !== 'object')) {
        if (!rootGate.check(value)) { gate = { key, value }; report('gated', path); stopped = true; break; }
      }
      const put = (v) => (frame.isArray ? (frame.dst[Number(key)] = v) : define(frame.dst, key, v));
      if (value !== null && typeof value === 'object') {
        const child = openContainer(value, frame, key, put, childOpen);
        if (child) stack.push(child);
      } else if (admitPrimitive(value, path, childOpen)) {
        put(value);
      }
    } catch {
      // A throwing trap / revoked proxy / hostile getter on a reflective call. The thrown value is
      // never propagated or inspected (spec 5.3: reported as `unreadable`, never an escape).
      report('unreadable', path);
      stack.pop();
    }
  }

  if (issues.length > 0) {
    const out = { ok: false, issues, issuesTruncated: truncated, nodes };
    if (budgeted) out.openFieldBytes = openBytes;
    if (gate) out.gate = gate;
    return out;
  }
  return budgeted ? { ok: true, value: result, nodes, openFieldBytes: openBytes } : { ok: true, value: result, nodes };
}

/** Synchronous iterative deep freeze. Returns its argument. */
export function deepFreeze(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
  }
  return value;
}

/**
 * Deep freeze in deadline-aware slices (spec 17.3): one `slicer.tick('freeze')` per node.
 * @param {{ tick: (label?: string) => (undefined | Promise<void>) }} slicer
 */
export async function deepFreezeSliced(value, slicer) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
    const pending = slicer.tick('freeze');
    if (pending) await pending;
  }
  return value;
}

/** Test/diagnostic helper: true iff `value` and everything reachable from it is frozen. */
export function isDeepFrozen(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (!Object.isFrozen(v)) return false;
    for (const k of Reflect.ownKeys(v)) stack.push(v[k]);
  }
  return true;
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `node --test test/clashtest/util/capture.test.mjs`
Expected: PASS — 29 tests, 0 failures.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits)**

```bash
git add clashtest/util/capture.js test/clashtest/util/capture.test.mjs
git commit -m "feat(clashtest): P0.2 detached descriptor-based capture and deep freeze"
```

### Task P0.3: Options, ceilings, validation, producer/reader invariant (`clashtest/options.js`)

**Files**
- Create: `clashtest/options.js`
- Test: `test/clashtest/options.test.mjs`

**Interfaces**
- Consumes: `InvalidOptionsError` (P0.1), `captureData` (P0.2).
- Produces: everything in the `options.js` interface table. P3/P4/P5/P6/P7 read run-option values only from the object `resolveRunOptions` returns and limits only from `resolveEngineLimits`'s result; P2 reads `maxEntriesPerSelection`, `maxExplicitElementsPerSelection`, `maxValidationIssues` from the limits; P0.6's slicer reads `sliceBudgetMs`/`aggregationSliceMaxItems`.

Numbers in this task are the provisional values of spec §17.1 (defaults) and §17.1.1 (ceilings). They are provisional pending gate **G-CAL**; nothing else in `clashtest/` may restate them.

- [x] **Step 1: Write the failing test**

`test/clashtest/options.test.mjs`:

```js
// test/clashtest/options.test.mjs
//
// Behaviour of option validation / resolution. Every number comes from clashtest/options.js
// (spec 17.1 is the single source of defaults; tests never restate them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_OPTION_SPECS, ENGINE_LIMIT_SPECS, RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, SCHEMA_MAX_NODES,
  resolveRunOptions, resolveEngineLimits, assertProducerReaderInvariant, producerReaderIssues, worstCaseCapturedNodes,
} from '../../clashtest/options.js';
import { InvalidOptionsError } from '../../clashtest/errors.js';

const issuesOf = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof InvalidOptionsError, String(e)); return e; }
  assert.fail('expected InvalidOptionsError');
};
const codes = (e) => e.issues.map((i) => `${i.code}@${i.path}`);

test('omitted options resolve to the provisional defaults; result is frozen and fully populated', () => {
  const r = resolveRunOptions(undefined);
  assert.deepEqual(r, RUN_OPTION_DEFAULTS);
  assert.ok(Object.isFrozen(r));
  assert.deepEqual(resolveRunOptions({}), RUN_OPTION_DEFAULTS);
  assert.deepEqual(resolveEngineLimits(undefined), ENGINE_LIMIT_DEFAULTS);
  assert.deepEqual(resolveEngineLimits({}), ENGINE_LIMIT_DEFAULTS);
});

test('supplied values override defaults; derived defaults follow the resolved earlier key', () => {
  const r = resolveRunOptions({ maxResultsPerRun: 50, broadPhase: 'linear', persist: false, interUnitYield: 'macrotask' });
  assert.equal(r.maxResultsPerRun, 50);
  assert.equal(r.maxPairsPerOutcome, 50);            // default = maxResultsPerRun
  assert.equal(r.broadPhase, 'linear'); assert.equal(r.persist, false); assert.equal(r.interUnitYield, 'macrotask');
  const l = resolveEngineLimits({ maxResidentResultSets: 1 });
  assert.equal(l.maxQueuedRuns, 0);                  // default = maxResidentResultSets - 1
});

test('unknown keys are rejected, and a key in the wrong set says so', () => {
  const e = issuesOf(() => resolveRunOptions({ nope: 1, maxResidentResultSets: 2 }));
  assert.deepEqual(codes(e), ['unknown-key@/nope', 'unknown-key@/maxResidentResultSets']);
  assert.match(e.issues[1].message, /other option set/);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxUnitsPerRun: 5 }))), ['unknown-key@/maxUnitsPerRun']);
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ pairSemantics: 'x' }))), ['unknown-key@/pairSemantics']);
});

test('no coercion: integers must be finite safe integers, enums exact, booleans real booleans', () => {
  for (const bad of ['5', 5.5, NaN, Infinity, -Infinity, true, null, [], {}]) {
    issuesOf(() => resolveRunOptions({ maxUnitsPerRun: bad })); // each is refused, never coerced
  }
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: '5' })).issues[0].code, 'not-an-integer');
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: 5.5 })).issues[0].code, 'not-an-integer');
  assert.equal(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: NaN })).issues[0].code, 'bad-shape'); // capture rejects non-finite
  assert.equal(issuesOf(() => resolveRunOptions({ broadPhase: 'TLAS' })).issues[0].code, 'bad-enum');
  assert.equal(issuesOf(() => resolveRunOptions({ persist: 1 })).issues[0].code, 'not-a-boolean');
  assert.equal(issuesOf(() => resolveRunOptions({ persist: undefined })).issues[0].code, 'bad-shape');
});

test('the options bag itself must be a plain object of plain values (null, arrays, class instances, accessors)', () => {
  class Opts { constructor() { this.persist = true; } }
  const withGetter = {}; Object.defineProperty(withGetter, 'persist', { enumerable: true, get() { throw new Error('must not be invoked'); } });
  for (const bad of [null, [], 7, 'x', new Opts(), withGetter]) {
    assert.equal(issuesOf(() => resolveRunOptions(bad)).issues[0].code, 'bad-shape');
    assert.equal(issuesOf(() => resolveEngineLimits(bad)).issues[0].code, 'bad-shape');
  }
});

test('every issue is collected, not just the first', () => {
  const e = issuesOf(() => resolveRunOptions({ broadPhase: 'x', maxUnitsPerRun: 0, nope: 1, persist: 'yes' }));
  assert.deepEqual(codes(e).sort(), ['bad-enum@/broadPhase', 'below-minimum@/maxUnitsPerRun', 'not-a-boolean@/persist', 'unknown-key@/nope']);
});

test('minimum and hard ceiling are enforced for every integer option (table-driven from the specs)', () => {
  const check = (specs, resolve) => {
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.kind !== 'int') continue;
      const lo = issuesOf(() => resolve({ [key]: spec.min - 1 })).issues.find((i) => i.path === `/${key}`);
      assert.equal(lo.code, 'below-minimum', key);
      if (spec.ceiling !== null) {
        const hi = issuesOf(() => resolve({ [key]: spec.ceiling + 1 })).issues.find((i) => i.path === `/${key}`);
        assert.equal(hi.code, 'above-ceiling', key);
        // exactly at the ceiling is never a PER-KEY issue (it may still trip a cross-field or reader rule)
        try { resolve({ [key]: spec.ceiling }); } catch (e) {
          assert.ok(e instanceof InvalidOptionsError, key);
          assert.ok(!e.issues.some((i) => i.path === `/${key}` && ['above-ceiling', 'below-minimum', 'not-an-integer'].includes(i.code)), key);
        }
      }
    }
  };
  check(RUN_OPTION_SPECS, (o) => resolveRunOptions(o));
  check(ENGINE_LIMIT_SPECS, (o) => resolveEngineLimits(o));
});

test('cross-field: maxLedgerRecords >= maxPlanReferences + 2 x maxUnitsPerRun', () => {
  const ok = { maxPlanReferences: 1_000, maxUnitsPerRun: 100, maxLedgerRecords: 1_200 };
  assert.equal(resolveRunOptions(ok).maxLedgerRecords, 1_200);
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ ...ok, maxLedgerRecords: 1_199 }))), ['cross-field@/maxLedgerRecords']);
  // raising one operand alone can break the default of the other
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxPlanReferences: RUN_OPTION_DEFAULTS.maxLedgerRecords }))), ['cross-field@/maxLedgerRecords']);
});

test('cross-field: maxPairsPerOutcome <= maxResultsPerRun; maxQueuedRuns <= maxResidentResultSets - 1', () => {
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxResultsPerRun: 50, maxPairsPerOutcome: 51 }))), ['cross-field@/maxPairsPerOutcome']);
  assert.equal(resolveRunOptions({ maxResultsPerRun: 50, maxPairsPerOutcome: 50 }).maxPairsPerOutcome, 50);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxResidentResultSets: 2, maxQueuedRuns: 2 }))), ['cross-field@/maxQueuedRuns']);
  assert.equal(resolveEngineLimits({ maxResidentResultSets: 2, maxQueuedRuns: 1 }).maxQueuedRuns, 1);
});

test('a bad key never cascades into a spurious cross-field issue', () => {
  assert.deepEqual(codes(issuesOf(() => resolveRunOptions({ maxUnitsPerRun: 'x' }))), ['not-an-integer@/maxUnitsPerRun']);
  assert.deepEqual(codes(issuesOf(() => resolveEngineLimits({ maxResidentResultSets: 0 }))), ['below-minimum@/maxResidentResultSets']);
});

test('maxCapturedNodes: ceiling is SCHEMA_MAX_NODES', () => {
  assert.equal(resolveEngineLimits({ maxCapturedNodes: SCHEMA_MAX_NODES }).maxCapturedNodes, SCHEMA_MAX_NODES);
  assert.equal(issuesOf(() => resolveEngineLimits({ maxCapturedNodes: SCHEMA_MAX_NODES + 1 })).issues[0].code, 'above-ceiling');
});

test('-0 is normalised to 0', () => {
  assert.ok(Object.is(resolveRunOptions({ maxRetainedDiagnostics: -0 }).maxRetainedDiagnostics, 0));
});

test('producer/reader invariant: a run whose worst case does not fit this engine\'s reader limits is refused', () => {
  const limits = resolveEngineLimits({ maxCapturedNodes: 1_000_000 });
  const e = issuesOf(() => resolveRunOptions(undefined, limits));
  assert.equal(e.reason, 'result-unreadable');
  assert.deepEqual(codes(e), ['result-unreadable-nodes@/maxResultsPerRun']);
  // the same options are fine for an engine whose reader limit is large enough
  assert.doesNotThrow(() => resolveRunOptions(undefined, resolveEngineLimits({})));
});

test('producer/reader invariant is exact at the boundary (equal passes, one less fails)', () => {
  const opts = resolveRunOptions(undefined);
  const worst = worstCaseCapturedNodes(opts);
  assert.deepEqual(producerReaderIssues(opts, resolveEngineLimits({ maxCapturedNodes: worst })), []);
  assert.equal(producerReaderIssues(opts, resolveEngineLimits({ maxCapturedNodes: worst - 1 })).length, 1);
});

test('producer/reader invariant, byte half: maxCapturedNodes x bytesPerNode must fit maxStoredResultBytes', () => {
  const limits = resolveEngineLimits({ maxStoredResultBytes: 1_000 });
  const e = issuesOf(() => assertProducerReaderInvariant(resolveRunOptions(undefined), limits));
  assert.equal(e.reason, 'result-unreadable');
  assert.deepEqual(codes(e), ['result-unreadable-bytes@/maxCapturedNodes']);
});

test('option errors are thrown synchronously (not as a rejected promise)', () => {
  let threw = false;
  try { resolveRunOptions({ nope: 1 }); } catch { threw = true; }
  assert.equal(threw, true);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/options.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/options.js`.

- [x] **Step 3: Implement `clashtest/options.js`**

```js
// clashtest/options.js
//
// THE single code home of every default, hard ceiling and cross-field rule of spec 17.1 / 17.1.1
// (convergence errata item 3). Nothing else in clashtest/ or in the tests may restate a number
// from this file: import it.
//
// EVERY DEFAULT BELOW IS PROVISIONAL pending gate G-CAL (AC-12 memory / synchronous-capture /
// stall calibration, spec 17.1 "Memory-ceiling calibration gate"). They ship as overridable
// defaults, never as frozen constants of the design; `DEFAULTS_STATUS` says so machine-readably.
//
// Ownership split (spec 17.1.1): a key is EITHER a RunOption (per run, recorded in provenance) OR
// an engine limit (constructor `limits`, fixed per engine, never recorded). A key in the wrong
// place is an unknown key.

import { InvalidOptionsError } from './errors.js';
import { captureData } from './util/capture.js';

const MiB = 1024 * 1024;

export const DEFAULTS_STATUS = Object.freeze({
  provisional: true,
  gate: 'G-CAL',
  note: 'Provisional until AC-12 calibration closes gate G-CAL (spec 17.1); do not treat as frozen.',
});

/** `bytesPerNode` for the producer/reader invariant (spec 13.6): provisional, calibrated by AC-12. */
export const BYTES_PER_NODE = 32;

/**
 * Spec 15.4 provisional defaults for `compareResultSets`' `changed` tolerances (world units; overridable via the
 * call's `opts`, finite and >= 0). PROVISIONAL like every default here (gate G-CAL). Deliberately in neither
 * RUN_OPTION_SPECS nor ENGINE_LIMIT_SPECS: they are per-call options of a derivation, not run options or engine
 * limits, so the ownership split of 17.1.1 (and its unknown-key rule) is untouched. P8's derive/compare.js
 * IMPORTS this object; the single-defaults rule forbids restating the number anywhere else.
 */
export const COMPARE_TOLERANCE_DEFAULTS = Object.freeze({ distanceTolerance: 1e-6, pointTolerance: 1e-6 });

/** Closed-shape node bounds of spec 13.6 (one ClashResult <= 24 nodes; one ledger/diagnostic record <= 12). */
export const SCHEMA_NODE_FACTORS = Object.freeze({ result: 24, ledger: 12, diagnostic: 12, slack: 65_536 });

const int = (min, ceiling, dflt, extra = {}) => ({ kind: 'int', min, ceiling, default: dflt, ...extra });

// ---- RunOptions (spec 17.1.1 first list; 18 RunOptions) ---------------------------------------------
// Order matters only for derived defaults (a derived default reads an EARLIER key).
export const RUN_OPTION_SPECS = Object.freeze({
  broadPhase: { kind: 'enum', values: ['tlas', 'linear'], default: 'tlas' },
  maxSourceFragmentsPerUnit: int(1, 20_000, 200),
  maxSourceDbIdsPerUnit: int(1, 5_000, 500),
  maxTargetModelsPerUnit: int(1, 64, 4),
  maxTargetFragmentsPerUnit: int(1, 100_000, 20_000),
  maxUnitsPerRun: int(1, 100_000, 10_000),
  maxResultsPerRun: int(1, 1_000_000, 100_000),
  maxRetainedDiagnostics: int(0, 100_000, 10_000),
  maxPlacementRetries: int(0, 10, 2),
  progressMinIntervalMs: int(0, 60_000, 100),
  interUnitYield: { kind: 'enum', values: ['animation-frame', 'macrotask'], default: 'animation-frame' },
  persist: { kind: 'bool', default: true },
  maxPlanReferences: int(1, 10_000_000, 500_000),
  maxLedgerRecords: int(1, 20_000_000, 1_000_000),
  maxPairsPerOutcome: int(1, null, null, { derivedFrom: 'maxResultsPerRun' }), // default = maxResultsPerRun; <= it
  maxDiagnosticsPerOutcome: int(1, 1_000_000, 200_000),
  maxDistinctReasons: int(1, 1_024, 64),
  maxElementTaintsPerUnit: int(1, 100_000, 2_000),
  maxUnitIdsPerDiagnostic: int(1, 64, 8),
});

// ---- Engine limits (spec 17.1.1 second list; 18 `limits`) ---------------------------------------------
// SCHEMA_MAX_NODES is a data-format property (spec 13.6): every `_ceiling` below is a 17.1.1 hard maximum.
export const SCHEMA_MAX_NODES = SCHEMA_NODE_FACTORS.result * RUN_OPTION_SPECS.maxResultsPerRun.ceiling
  + SCHEMA_NODE_FACTORS.ledger * RUN_OPTION_SPECS.maxLedgerRecords.ceiling
  + SCHEMA_NODE_FACTORS.diagnostic * RUN_OPTION_SPECS.maxRetainedDiagnostics.ceiling
  + SCHEMA_NODE_FACTORS.slack;

export const ENGINE_LIMIT_SPECS = Object.freeze({
  maxResidentResultSets: int(1, 64, 4),
  maxQueuedRuns: int(0, null, null, { derivedFrom: 'maxResidentResultSets', derivedOffset: -1 }), // default = maxResident - 1; <= it
  persistTimeoutMs: int(0, 60_000, 5_000),
  maxAnnotatedNames: int(1, 256, 16),
  maxAnnotationBytes: int(1, 64 * MiB, 8 * MiB),
  sliceBudgetMs: int(1, 8, 4), // ceiling == collision frameBudgetMs (guarded by a drift test)
  aggregationSliceMaxItems: int(1, 100_000, 2_000),
  maxEntriesPerSelection: int(1, 10_000, 1_024),
  maxExplicitElementsPerSelection: int(1, 100_000, 10_000),
  maxValidationIssues: int(1, 1_000, 100),
  maxConcurrentStoreReads: int(1, 4, 1),
  maxQueuedStoreReads: int(0, 64, 8),
  reconcileTimeoutMs: int(1, 60_000, 10_000),
  maxCapturedNodes: int(1, SCHEMA_MAX_NODES, 16_000_000),
  maxStoredResultBytes: int(1, 1_024 * MiB, 512 * MiB),
  maxConcurrentAnnotations: int(1, 8, 2),
  maxConcurrentDerivations: int(1, 8, 2),
  maxFacetsPerGroupBy: int(1, 16, 4),
  maxFilterClauses: int(1, 128, 32),
  maxGroupMemberships: int(1, 10_000_000, 1_000_000),
  maxComparisonEntries: int(1, 10_000_000, 2_000_000),
});

// ---- cross-field rules (spec 17.1.1) -------------------------------------------------------------------
const RUN_CROSS_RULES = [
  { path: '/maxLedgerRecords', needs: ['maxLedgerRecords', 'maxPlanReferences', 'maxUnitsPerRun'],
    ok: (v) => v.maxLedgerRecords >= v.maxPlanReferences + 2 * v.maxUnitsPerRun,
    message: 'maxLedgerRecords must be >= maxPlanReferences + 2 x maxUnitsPerRun' },
  { path: '/maxPairsPerOutcome', needs: ['maxPairsPerOutcome', 'maxResultsPerRun'],
    ok: (v) => v.maxPairsPerOutcome <= v.maxResultsPerRun,
    message: 'maxPairsPerOutcome must be <= maxResultsPerRun' },
];
const LIMIT_CROSS_RULES = [
  { path: '/maxQueuedRuns', needs: ['maxQueuedRuns', 'maxResidentResultSets'],
    ok: (v) => v.maxQueuedRuns <= v.maxResidentResultSets - 1,
    message: 'maxQueuedRuns must be <= maxResidentResultSets - 1' },
];

const issue = (path, code, message) => ({ path, code, message });

function resolveAgainst(specs, crossRules, input, otherSpecs) {
  const issues = [];
  let provided = {};
  if (input !== undefined) {
    // O(constant) detached copy: an options bag is caller data like any other (spec 5.3 scope (i)).
    const cap = captureData(input, { maxNodes: 512, maxDepth: 2, maxIssues: 100, maxKeyLength: 64, maxStringLength: 32 });
    if (!cap.ok) {
      for (const i of cap.issues) issues.push(issue(i.path, 'bad-shape', `options must be a plain object of plain values (${i.code})`));
      return { issues, values: null };
    }
    if (cap.value === null || typeof cap.value !== 'object' || Array.isArray(cap.value)) {
      return { issues: [issue('', 'bad-shape', 'options must be a plain object')], values: null };
    }
    provided = cap.value;
  }

  const values = {};
  const bad = new Set();
  for (const key of Object.keys(provided)) {
    const path = `/${key}`;
    const spec = Object.hasOwn(specs, key) ? specs[key] : undefined;
    if (!spec) {
      issues.push(issue(path, 'unknown-key', Object.hasOwn(otherSpecs, key)
        ? `${key} belongs to the other option set (RunOptions vs engine limits) and is not accepted here`
        : `unknown option ${key}`));
      bad.add(key);
      continue;
    }
    const v = provided[key];
    if (spec.kind === 'bool') {
      if (typeof v !== 'boolean') { issues.push(issue(path, 'not-a-boolean', `${key} must be a boolean`)); bad.add(key); continue; }
    } else if (spec.kind === 'enum') {
      if (!spec.values.includes(v)) { issues.push(issue(path, 'bad-enum', `${key} must be one of ${spec.values.join(' | ')}`)); bad.add(key); continue; }
    } else if (!Number.isSafeInteger(v)) {
      issues.push(issue(path, 'not-an-integer', `${key} must be a finite integer`)); bad.add(key); continue;
    } else if (v < spec.min) {
      issues.push(issue(path, 'below-minimum', `${key} must be >= ${spec.min}`)); bad.add(key); continue;
    } else if (spec.ceiling !== null && v > spec.ceiling) {
      issues.push(issue(path, 'above-ceiling', `${key} must be <= ${spec.ceiling}`)); bad.add(key); continue;
    }
    values[key] = spec.kind === 'int' && v === 0 ? 0 : v; // normalise -0
  }

  // Fill defaults in table order so a derived default sees the resolved earlier key.
  for (const [key, spec] of Object.entries(specs)) {
    if (key in values || bad.has(key)) continue;
    if (spec.derivedFrom) {
      if (bad.has(spec.derivedFrom)) { bad.add(key); continue; }
      values[key] = values[spec.derivedFrom] + (spec.derivedOffset ?? 0);
    } else {
      values[key] = spec.default;
    }
  }

  for (const rule of crossRules) {
    if (rule.needs.some((k) => bad.has(k))) continue; // never cascade a second issue off a bad key
    if (!rule.ok(values)) issues.push(issue(rule.path, 'cross-field', rule.message));
  }
  return { issues, values };
}

const defaultsOf = (specs, crossRules, otherSpecs) => {
  const { issues, values } = resolveAgainst(specs, crossRules, undefined, otherSpecs);
  if (issues.length) throw new Error(`options.js defaults are internally inconsistent: ${JSON.stringify(issues)}`);
  return Object.freeze(values);
};

/** Provisional (G-CAL) defaults. Derived keys (`maxPairsPerOutcome`, `maxQueuedRuns`) are materialised here. */
export const RUN_OPTION_DEFAULTS = defaultsOf(RUN_OPTION_SPECS, RUN_CROSS_RULES, ENGINE_LIMIT_SPECS);
export const ENGINE_LIMIT_DEFAULTS = defaultsOf(ENGINE_LIMIT_SPECS, LIMIT_CROSS_RULES, RUN_OPTION_SPECS);

export const RUN_OPTION_KEYS = Object.freeze(Object.keys(RUN_OPTION_SPECS));
export const ENGINE_LIMIT_KEYS = Object.freeze(Object.keys(ENGINE_LIMIT_SPECS));

/** Hard ceilings, as plain `{ key: number | null }` tables (null = cross-field only). */
export const RUN_OPTION_CEILINGS = Object.freeze(Object.fromEntries(
  Object.entries(RUN_OPTION_SPECS).filter(([, s]) => s.kind === 'int').map(([k, s]) => [k, s.ceiling])));
export const ENGINE_LIMIT_CEILINGS = Object.freeze(Object.fromEntries(
  Object.entries(ENGINE_LIMIT_SPECS).filter(([, s]) => s.kind === 'int').map(([k, s]) => [k, s.ceiling])));

// ---- public resolvers ------------------------------------------------------------------------------------
/**
 * Validate `input` (an engine `limits` object; `undefined` = all defaults) and return the frozen, fully
 * resolved limits. Collects EVERY issue, then throws InvalidOptionsError{issues} (spec 17.1.1).
 */
export function resolveEngineLimits(input) {
  const { issues, values } = resolveAgainst(ENGINE_LIMIT_SPECS, LIMIT_CROSS_RULES, input, RUN_OPTION_SPECS);
  if (issues.length) throw new InvalidOptionsError({ issues });
  return Object.freeze(values);
}

/** Worst-case captured-node count of a Result Set the given run options may legally produce (spec 13.6). */
export function worstCaseCapturedNodes(runOptions) {
  return SCHEMA_NODE_FACTORS.result * runOptions.maxResultsPerRun
    + SCHEMA_NODE_FACTORS.ledger * runOptions.maxLedgerRecords
    + SCHEMA_NODE_FACTORS.diagnostic * runOptions.maxRetainedDiagnostics
    + SCHEMA_NODE_FACTORS.slack;
}

/** Issues (possibly empty) of the producer/reader invariant. Pure. */
export function producerReaderIssues(runOptions, limits) {
  const out = [];
  const worst = worstCaseCapturedNodes(runOptions);
  if (worst > limits.maxCapturedNodes) {
    out.push(issue('/maxResultsPerRun', 'result-unreadable-nodes',
      `worst-case ${worst} captured nodes exceeds this engine's maxCapturedNodes ${limits.maxCapturedNodes}`));
  }
  if (limits.maxCapturedNodes * BYTES_PER_NODE > limits.maxStoredResultBytes) {
    out.push(issue('/maxCapturedNodes', 'result-unreadable-bytes',
      `maxCapturedNodes x ${BYTES_PER_NODE} bytes exceeds maxStoredResultBytes ${limits.maxStoredResultBytes}`));
  }
  return out;
}

/** "An engine never produces a set it cannot read" (spec 13.6, R21-2). Throws InvalidOptionsError('result-unreadable'). */
export function assertProducerReaderInvariant(runOptions, limits) {
  const issues = producerReaderIssues(runOptions, limits);
  if (issues.length) throw new InvalidOptionsError({ reason: 'result-unreadable', issues });
}

let defaultLimits = null;
/**
 * Validate `input` (`RunOptions`; `undefined` = all defaults), fill defaults, enforce the cross-field
 * rules and the producer/reader invariant against `limits` (the engine's resolved limits), and return
 * the frozen resolved RunOptions to record in provenance. Throws InvalidOptionsError synchronously.
 */
export function resolveRunOptions(input, limits) {
  const { issues, values } = resolveAgainst(RUN_OPTION_SPECS, RUN_CROSS_RULES, input, ENGINE_LIMIT_SPECS);
  if (issues.length) throw new InvalidOptionsError({ issues });
  const resolved = Object.freeze(values);
  assertProducerReaderInvariant(resolved, limits ?? (defaultLimits ??= resolveEngineLimits(undefined)));
  return resolved;
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `node --test test/clashtest/options.test.mjs`
Expected: PASS — 16 tests, 0 failures.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits)**

```bash
git add clashtest/options.js test/clashtest/options.test.mjs
git commit -m "feat(clashtest): P0.3 option tables, validation and producer/reader invariant"
```

### Task P0.4: Provisional-defaults conformance test (spec §17.1 / §17.1.1 / §13.6)

This is a guard task: it adds no production code. It proves the defaults table in `options.js` (a) has exactly the key sets of spec §18, (b) equals the spec's own §17.1 default table and §17.1.1 ceiling table (the test parses the frozen spec markdown; no number is restated in the test), (c) satisfies every cross-field rule and the producer/reader invariant *at the defaults*, and (d) stays aligned with `collision/constants.js` (test-side import only; this is how the master's "the engine may not hard-code copies" and "core imports nothing from `collision/`" constraints are both honoured). RED is demonstrated by mutation because the code under test already exists.

**Files**
- Test: `test/clashtest/options.defaults.test.mjs`

**Interfaces**
- Consumes: `options.js` exports from P0.3 (including `COMPARE_TOLERANCE_DEFAULTS`); `maxCollisionInstancesPerEpoch`, `maxFragmentsPerDbId`, `frameBudgetMs` from `collision/constants.js` (test only); the spec file `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`.
- Produces: the named guards that make G-CAL freezing (Task P0.8) safe: changing any number without updating the referenced source fails a named test.

- [x] **Step 1: Write the test**

`test/clashtest/options.defaults.test.mjs`:

```js
// test/clashtest/options.defaults.test.mjs
//
// Provisional-defaults conformance (spec 17.1 / 17.1.1 / 13.6). Reads every number from
// clashtest/options.js; the only external sources are the spec's own table (parsed) and, for the
// drift guard, collision/constants.js. Nothing here hard-codes a default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opts from '../../clashtest/options.js';
import { InvalidOptionsError } from '../../clashtest/errors.js';
import { maxCollisionInstancesPerEpoch, maxFragmentsPerDbId, frameBudgetMs } from '../../collision/constants.js';

const {
  RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, RUN_OPTION_KEYS, ENGINE_LIMIT_KEYS, RUN_OPTION_CEILINGS, ENGINE_LIMIT_CEILINGS,
  SCHEMA_MAX_NODES, SCHEMA_NODE_FACTORS, BYTES_PER_NODE, DEFAULTS_STATUS,
  worstCaseCapturedNodes, producerReaderIssues, resolveRunOptions, resolveEngineLimits,
} = opts;

// Names only, transcribed from spec 18 (RunOptions list and the constructor `limits` list).
const SPEC_18_RUN_OPTIONS = ['broadPhase', 'maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit', 'maxTargetModelsPerUnit',
  'maxTargetFragmentsPerUnit', 'maxUnitsPerRun', 'maxResultsPerRun', 'maxRetainedDiagnostics', 'maxPlacementRetries',
  'progressMinIntervalMs', 'interUnitYield', 'persist', 'maxPlanReferences', 'maxLedgerRecords', 'maxPairsPerOutcome',
  'maxDiagnosticsPerOutcome', 'maxDistinctReasons', 'maxElementTaintsPerUnit', 'maxUnitIdsPerDiagnostic'];
const SPEC_18_ENGINE_LIMITS = ['maxResidentResultSets', 'maxQueuedRuns', 'persistTimeoutMs', 'maxAnnotatedNames',
  'maxAnnotationBytes', 'sliceBudgetMs', 'aggregationSliceMaxItems', 'maxEntriesPerSelection',
  'maxExplicitElementsPerSelection', 'maxValidationIssues', 'maxConcurrentStoreReads', 'maxQueuedStoreReads',
  'reconcileTimeoutMs', 'maxCapturedNodes', 'maxStoredResultBytes', 'maxConcurrentAnnotations',
  'maxConcurrentDerivations', 'maxFacetsPerGroupBy', 'maxFilterClauses', 'maxGroupMemberships', 'maxComparisonEntries'];

test('ownership split: RunOption keys and engine-limit keys are exactly the spec 18 lists and are disjoint', () => {
  assert.deepEqual([...RUN_OPTION_KEYS].sort(), [...SPEC_18_RUN_OPTIONS].sort());
  assert.deepEqual([...ENGINE_LIMIT_KEYS].sort(), [...SPEC_18_ENGINE_LIMITS].sort());
  assert.deepEqual(RUN_OPTION_KEYS.filter((k) => ENGINE_LIMIT_KEYS.includes(k)), []);
  assert.deepEqual(Object.keys(RUN_OPTION_DEFAULTS), RUN_OPTION_KEYS);
  assert.deepEqual(Object.keys(ENGINE_LIMIT_DEFAULTS), ENGINE_LIMIT_KEYS);
});

test('every default is flagged provisional pending G-CAL', () => {
  assert.equal(DEFAULTS_STATUS.provisional, true);
  assert.equal(DEFAULTS_STATUS.gate, 'G-CAL');
  assert.ok(Object.isFrozen(DEFAULTS_STATUS) && Object.isFrozen(RUN_OPTION_DEFAULTS) && Object.isFrozen(ENGINE_LIMIT_DEFAULTS));
});

test('every default is inside [min, ceiling] and satisfies every cross-field rule (the defaults resolve cleanly)', () => {
  for (const [specs, defaults] of [[opts.RUN_OPTION_SPECS, RUN_OPTION_DEFAULTS], [opts.ENGINE_LIMIT_SPECS, ENGINE_LIMIT_DEFAULTS]]) {
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.kind !== 'int') continue;
      assert.ok(defaults[key] >= spec.min, `${key} >= min`);
      if (spec.ceiling !== null) assert.ok(defaults[key] <= spec.ceiling, `${key} <= ceiling`);
    }
  }
  assert.deepEqual(resolveRunOptions(RUN_OPTION_DEFAULTS), RUN_OPTION_DEFAULTS);      // idempotent round trip
  assert.deepEqual(resolveEngineLimits(ENGINE_LIMIT_DEFAULTS), ENGINE_LIMIT_DEFAULTS);
});

test('derived defaults: maxPairsPerOutcome == maxResultsPerRun; maxQueuedRuns == maxResidentResultSets - 1', () => {
  assert.equal(RUN_OPTION_DEFAULTS.maxPairsPerOutcome, RUN_OPTION_DEFAULTS.maxResultsPerRun);
  assert.equal(ENGINE_LIMIT_DEFAULTS.maxQueuedRuns, ENGINE_LIMIT_DEFAULTS.maxResidentResultSets - 1);
});

test('maxLedgerRecords default >= maxPlanReferences + 2 x maxUnitsPerRun (reserves maxUnitsPerRun overflow slots and >= maxUnitsPerRun discretionary records)', () => {
  const d = RUN_OPTION_DEFAULTS;
  assert.ok(d.maxLedgerRecords >= d.maxPlanReferences + 2 * d.maxUnitsPerRun);
});

test('SCHEMA_MAX_NODES is 24 x maxResults + 12 x maxLedger + 12 x maxDiagnostics ceilings + 65,536 (spec 13.6) and bounds maxCapturedNodes', () => {
  assert.equal(SCHEMA_MAX_NODES,
    SCHEMA_NODE_FACTORS.result * RUN_OPTION_CEILINGS.maxResultsPerRun
    + SCHEMA_NODE_FACTORS.ledger * RUN_OPTION_CEILINGS.maxLedgerRecords
    + SCHEMA_NODE_FACTORS.diagnostic * RUN_OPTION_CEILINGS.maxRetainedDiagnostics
    + SCHEMA_NODE_FACTORS.slack);
  assert.equal(ENGINE_LIMIT_CEILINGS.maxCapturedNodes, SCHEMA_MAX_NODES);
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes <= SCHEMA_MAX_NODES);
});

test('PRODUCER/READER INVARIANT at the defaults: an engine never produces a set it cannot read (spec 13.6, R21-2)', () => {
  const worst = worstCaseCapturedNodes(RUN_OPTION_DEFAULTS);
  assert.equal(worst,
    24 * RUN_OPTION_DEFAULTS.maxResultsPerRun + 12 * RUN_OPTION_DEFAULTS.maxLedgerRecords
    + 12 * RUN_OPTION_DEFAULTS.maxRetainedDiagnostics + 65_536);
  assert.ok(worst <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes, 'worst-case nodes fit maxCapturedNodes');
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes * BYTES_PER_NODE <= ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes, 'nodes x bytesPerNode fit maxStoredResultBytes');
  assert.deepEqual(producerReaderIssues(RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS), []);
});

test('hard ceilings that mirror the library are aligned with collision/constants.js (drift guard; the ONLY collision import, test-side)', () => {
  assert.equal(RUN_OPTION_CEILINGS.maxSourceFragmentsPerUnit, maxCollisionInstancesPerEpoch);
  assert.equal(RUN_OPTION_CEILINGS.maxSourceDbIdsPerUnit, maxFragmentsPerDbId);
  assert.equal(RUN_OPTION_DEFAULTS.maxTargetFragmentsPerUnit, maxCollisionInstancesPerEpoch);
  assert.equal(ENGINE_LIMIT_CEILINGS.sliceBudgetMs, frameBudgetMs);
});

// ---- spec-table drift: parse the spec's own 17.1 table and compare with options.js -------------------------
const SPEC_PATH = new URL('../../docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md', import.meta.url);

function parseSpecDefaultsTable(markdown) {
  const start = markdown.indexOf('### 17.1 Provisional caps');
  const end = markdown.indexOf('**Memory-ceiling calibration gate', start);
  assert.ok(start > 0 && end > start, 'spec 17.1 table located');
  const rows = [];
  for (const line of markdown.slice(start, end).split('\n')) {
    const m = /^\| (`[^|]+?`(?: \/ `[^|]+?`)*) \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const names = [...m[1].matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]);
    const cell = m[2].replace(/\*\*/g, '').replace(/\s*\(.*$/, '').trim();   // drop "(was ...)" / "(512 MiB)" notes
    const tokens = cell.split(' / ').map((t) => t.trim());
    rows.push({ names, tokens });
  }
  return rows;
}

const parseToken = (t) => {
  let m;
  if (/^[\d,]+$/.test(t)) return Number(t.replace(/,/g, ''));
  if ((m = /^([\d,]+) MiB$/.exec(t))) return Number(m[1].replace(/,/g, '')) * 1024 * 1024;
  if (t === '`true`') return true;
  if (t === '`false`') return false;
  if ((m = /^`'([a-z-]+)'`$/.exec(t))) return m[1];
  return undefined; // symbolic default (derived); checked by its own test
};

test('spec 17.1 drift: every numeric/enum default in the spec table equals options.js (symbolic rows are the two derived defaults)', () => {
  const rows = parseSpecDefaultsTable(readFileSync(SPEC_PATH, 'utf8'));
  assert.ok(rows.length >= 35, `parsed ${rows.length} rows`);
  const all = { ...RUN_OPTION_DEFAULTS, ...ENGINE_LIMIT_DEFAULTS };
  const symbolic = [];
  const seen = new Set();
  for (const { names, tokens } of rows) {
    assert.equal(tokens.length, names.length, `row ${names.join('/')} has ${tokens.length} default tokens`);
    names.forEach((name, i) => {
      assert.ok(name in all, `spec parameter ${name} exists in options.js`);
      seen.add(name);
      const want = parseToken(tokens[i]);
      if (want === undefined) { symbolic.push(name); return; }
      assert.strictEqual(all[name], want, `${name}: options.js ${all[name]} vs spec ${want}`);
    });
  }
  assert.deepEqual(symbolic.sort(), ['maxPairsPerOutcome', 'maxQueuedRuns']);
  // every option this file owns is documented in the spec table
  for (const key of [...RUN_OPTION_KEYS, ...ENGINE_LIMIT_KEYS]) assert.ok(seen.has(key), `${key} appears in spec 17.1`);
});

test('COMPARE_TOLERANCE_DEFAULTS (spec 15.4, OPEN-4 strict reading): frozen, two finite non-negative keys, equal to the spec\'s provisional default, in NEITHER option set, flagged provisional', () => {
  const { COMPARE_TOLERANCE_DEFAULTS } = opts;
  assert.ok(Object.isFrozen(COMPARE_TOLERANCE_DEFAULTS));
  assert.deepEqual(Object.keys(COMPARE_TOLERANCE_DEFAULTS), ['distanceTolerance', 'pointTolerance']);
  for (const v of Object.values(COMPARE_TOLERANCE_DEFAULTS)) assert.ok(Number.isFinite(v) && v >= 0);
  const md = readFileSync(SPEC_PATH, 'utf8');
  const m = /`distanceTolerance`, `pointTolerance`: finite numbers ≥ 0, provisional defaults `([0-9.eE+-]+)` world units/.exec(md);
  assert.ok(m, 'spec 15.4 tolerance sentence located');
  assert.strictEqual(COMPARE_TOLERANCE_DEFAULTS.distanceTolerance, Number(m[1]));
  assert.strictEqual(COMPARE_TOLERANCE_DEFAULTS.pointTolerance, Number(m[1]));
  for (const key of Object.keys(COMPARE_TOLERANCE_DEFAULTS)) {
    assert.ok(!RUN_OPTION_KEYS.includes(key) && !ENGINE_LIMIT_KEYS.includes(key), `${key} is not a RunOption or an engine limit`);
    for (const resolve of [resolveRunOptions, resolveEngineLimits]) {
      assert.throws(() => resolve({ [key]: 1 }), (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'unknown-key' && e.issues[0].path === `/${key}`);
    }
  }
  assert.equal(DEFAULTS_STATUS.provisional, true);                                  // the G-CAL flag covers it
});

test('single-defaults rule: no file under clashtest/ except options.js restates a compare-tolerance literal (P8 must import COMPARE_TOLERANCE_DEFAULTS)', () => {
  const root = fileURLToPath(new URL('../../clashtest/', import.meta.url));
  const optionsFile = fileURLToPath(new URL('../../clashtest/options.js', import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js') && full !== optionsFile) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b1e-6\b|\b0\.000001\b/, `${file} restates the compare tolerance`);
  }
});

test('spec 17.1.1 drift: hard ceilings in the spec table equal options.js', () => {
  const md = readFileSync(SPEC_PATH, 'utf8');
  const start = md.indexOf('### 17.1.1 Option validation');
  const end = md.indexOf('Ceilings exist so a caller cannot defeat a bound', start);
  const ceilings = { ...RUN_OPTION_CEILINGS, ...ENGINE_LIMIT_CEILINGS };
  let checked = 0;
  for (const line of md.slice(start, end).split('\n')) {
    const m = /^\| (`[^|]+?`(?:, `[^|]+?`)*) \| [^|]+ \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const names = [...m[1].matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]);
    const cell = m[2].replace(/\s*\(.*$/, '').trim();
    const tokens = cell.split(' / ').map((t) => t.trim());
    const parsed = tokens.map((t) => {
      let mm;
      if (/^[\d,]+$/.test(t)) return Number(t.replace(/,/g, ''));
      if ((mm = /^(\d+) MiB$/.exec(t))) return Number(mm[1]) * 1024 * 1024;
      if (t === '1 GiB') return 1024 * 1024 * 1024;
      if (t === '`SCHEMA_MAX_NODES`') return SCHEMA_MAX_NODES;
      if (t === '`frameBudgetMs` (8)' || t.startsWith('`frameBudgetMs`')) return frameBudgetMs;
      return undefined;
    });
    if (parsed.some((p) => p === undefined)) continue; // cross-field / "-" rows
    // rows like `a`, `b` | ... | 20,000 / 5,000 map positionally; single-ceiling rows share one value
    names.forEach((name, i) => {
      const want = parsed.length === names.length ? parsed[i] : parsed[0];
      assert.strictEqual(ceilings[name], want, `${name} ceiling`);
      checked++;
    });
  }
  assert.ok(checked >= 25, `checked ${checked} ceilings`);
});
```

- [x] **Step 2: Run it and confirm it passes against the P0.3 implementation**

Run: `node --test test/clashtest/options.defaults.test.mjs`
Expected: PASS — 12 tests, 0 failures. (If the `spec 17.1 drift` test reports a mismatch, options.js has a transcription error; fix options.js, never the spec or the test.)

- [x] **Step 3: Mutation check A — a wrong default must fail the drift and invariant tests**

Temporarily edit `clashtest/options.js`: change `maxResultsPerRun: int(1, 1_000_000, 100_000)` to `int(1, 1_000_000, 200_000)`.
Run: `node --test test/clashtest/options.defaults.test.mjs`
Expected: FAIL — tests `every default is inside [min, ceiling] …`, `PRODUCER/READER INVARIANT at the defaults …` and `spec 17.1 drift …` (message `maxResultsPerRun: options.js 200000 vs spec 100000`).

- [x] **Step 4: Mutation check B — an unreadable default must fail the producer/reader invariant**

Revert step 3, then temporarily change `maxCapturedNodes: int(1, SCHEMA_MAX_NODES, 16_000_000)` to `14_000_000`.
Run the same command.
Expected: FAIL — at least the invariant test (worst case 14,585,536 nodes exceeds 14,000,000) and the drift test. Revert this edit.

- [x] **Step 5: Re-run clean**

Run: `node --test test/clashtest/options.test.mjs test/clashtest/options.defaults.test.mjs`
Expected: PASS — 28 tests, 0 failures, and `git diff --stat clashtest/options.js` shows no change.

- [x] **Step 6: Checkpoint commit (only if the user has authorized commits)**

```bash
git add test/clashtest/options.defaults.test.mjs
git commit -m "test(clashtest): P0.4 provisional-defaults conformance and drift guards"
```

### Task P0.5: Shared test doubles (`test/clashtest/support/`)

**Files**
- Create: `test/clashtest/support/fakeClock.mjs`, `fakeWorld.mjs`, `fakeEnumerator.mjs`, `fakeRegistry.mjs`, `index.mjs`
- Test: `test/clashtest/support.test.mjs`

**Interfaces**
- Consumes: `EnumerationCancelledError`, `ModelKeyVersionConflictError` (P0.1); `WorldDisposedError` from `collision/errors.js` (test-side).
- Produces: the support exports of the interface summary. **Assumed:** binding shape (P1), enumerator port shapes (P3), query shape (P4) — see the Assumed paragraph above.

- [x] **Step 1: Write the failing test**

`test/clashtest/support.test.mjs`:

```js
// test/clashtest/support.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFakeClock, createFakeWorld, createFakeModel, emptyClashResult, snapshotQuery,
  createFakeEnumerator, createFakeEnumerationContext, createFakeRegistry,
} from './support/index.mjs';
import { EnumerationCancelledError, ModelKeyVersionConflictError } from '../../clashtest/errors.js';
import { WorldDisposedError } from '../../collision/errors.js';

test('fake clock: now/advance/tick, detached closures, yield counting and onYield hook', async () => {
  const clock = createFakeClock({ start: 10, tickMs: 2, yieldAdvanceMs: 5 });
  const { now, yieldToScheduler } = clock;      // detached use must work
  assert.equal(now(), 10); assert.equal(now(), 12);
  clock.advance(100); assert.equal(clock.peek(), 114);
  const seen = [];
  const off = clock.onYield((n) => { seen.push(n); });
  await yieldToScheduler(); await yieldToScheduler();
  assert.deepEqual(seen, [1, 2]); assert.equal(clock.yieldCount, 2); assert.equal(clock.peek(), 124);
  off(); await yieldToScheduler(); assert.deepEqual(seen, [1, 2]);
});

test('fake world: records calls with a stable snapshot, returns the default, and can be scripted', async () => {
  const world = createFakeWorld();
  const a = createFakeModel(1); const b = createFakeModel(2);
  const dbIds = [3, 4];
  const query = { source: { model: a, dbIds }, target: { targets: [{ model: b }, { model: a, dbIds: [9] }] }, mode: 'clearance', groupBy: 'dbId', clearance: 0.5, broadPhase: 'tlas' };
  assert.deepEqual(await world.findClashes(query), emptyClashResult());
  dbIds.push(99);                                             // caller mutation after the call
  assert.deepEqual(world.calls[0].snapshot.source.dbIds, [3, 4]);
  assert.deepEqual(world.calls[0].snapshot, snapshotQuery({ ...query, source: { model: a, dbIds: [3, 4] } }));
  assert.equal(world.calls[0].snapshot.target.targets[0].dbIds, undefined);

  const boom = new Error('boom');
  world.script({ pairs: [1], statistics: {} }, boom, (q, call) => ({ pairs: [call.index], statistics: {} }));
  assert.deepEqual((await world.findClashes(query)).pairs, [1]);
  await assert.rejects(() => world.findClashes(query), boom);
  assert.deepEqual((await world.findClashes(query)).pairs, [3]);
  assert.deepEqual(await world.findClashes(query), emptyClashResult()); // script exhausted -> default again
  assert.equal(world.calls.length, 5);
});

test('fake world: hold() parks the next call, tracks concurrency, and dispose() makes calls reject', async () => {
  const world = createFakeWorld();
  const q = { source: { model: createFakeModel(1), dbIds: [1] }, target: { targets: [] }, mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'tlas' };
  const held = world.hold();
  const p = world.findClashes(q);
  const call = await held.started;
  assert.equal(call.index, 0); assert.equal(world.inFlight, 1);
  held.release({ pairs: [], statistics: { diagnostics: ['x'] } });
  assert.deepEqual((await p).statistics.diagnostics, ['x']);
  assert.equal(world.inFlight, 0); assert.equal(world.maxInFlight, 1);
  const h2 = world.hold(); const p2 = world.findClashes(q); await h2.started;
  const e = new Error('held failure'); h2.fail(e);
  await assert.rejects(p2, e);
  world.dispose();
  await assert.rejects(() => world.findClashes(q), WorldDisposedError);
});

const ROOTS = [
  { dbId: 20, fragmentCount: 2, ownerDbIds: [21, 22], subtreeDigest: 'd20' },
  { dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd10' },
];

test('fake enumerator: whole and explicit scopes, digestScope, call log, set() and onCall()', async () => {
  const en = createFakeEnumerator({ models: { A: { roots: ROOTS, population: { count: 3, digest: 'pop' } } } });
  const binding = { modelKey: 'A' };
  const whole = await en.resolveRoots(binding, 'whole', null);
  assert.deepEqual(whole.roots.map((r) => r.dbId), [10, 20]);          // ascending by dbId
  assert.deepEqual(whole.population, { count: 3, digest: 'pop' });
  assert.deepEqual(await en.digestScope(binding, 'whole', null), { kind: 'population', count: 3, digest: 'pop' });
  const some = await en.resolveRoots(binding, { dbIds: [20, 99] }, null);
  assert.deepEqual(some.roots.map((r) => r.dbId), [20]);
  assert.deepEqual(some.unresolved, [{ dbId: 99, reason: 'not-found' }]);
  assert.equal(some.population, null);
  assert.deepEqual((await en.digestScope(binding, { dbIds: [10] }, null)).roots, [{ dbId: 10, fragmentCount: 1, subtreeDigest: 'd10' }]);
  assert.deepEqual(en.calls.map((c) => c.kind), ['resolveRoots', 'digestScope', 'resolveRoots', 'digestScope']);
  en.set('A', { population: { count: 4, digest: 'pop2' } });
  assert.equal((await en.digestScope(binding, 'whole', null)).digest, 'pop2');
  let hooked = 0; en.onCall(() => { hooked++; });
  await en.resolveRoots(binding, 'whole', null); assert.equal(hooked, 1);
  await assert.rejects(() => en.resolveRoots({ modelKey: 'nope' }, 'whole', null), /unknown model/);
});

test('fake enumerator: a cooperating call awaits ctx.checkpoint and propagates EnumerationCancelledError; a non-cooperating one ignores it', async () => {
  const coop = createFakeEnumerator({ models: { A: { roots: ROOTS } }, checkpointsPerCall: 3 });
  const ctx = createFakeEnumerationContext();
  await coop.resolveRoots({ modelKey: 'A' }, 'whole', ctx);
  assert.equal(ctx.checkpoints, 3);
  ctx.cancel('lease-dead');
  await assert.rejects(() => coop.resolveRoots({ modelKey: 'A' }, 'whole', ctx), (e) => e instanceof EnumerationCancelledError && e.reason === 'lease-dead');
  const rude = createFakeEnumerator({ models: { A: { roots: ROOTS } }, cooperative: false });
  await rude.resolveRoots({ modelKey: 'A' }, 'whole', ctx);           // cancelled ctx is ignored
});

test('fake registry placeholder: bindings, generation bump, version conflict, sorted snapshot', () => {
  const reg = createFakeRegistry({ models: [{ modelKey: 'b', modelVersion: 'v1' }, { modelKey: 'a', modelVersion: 'v1' }] });
  assert.equal(reg.registrySessionId, 'fake-session-1');
  assert.deepEqual(reg.snapshotBindings().map((b) => b.modelKey), ['a', 'b']);
  assert.equal(reg.register({ modelKey: 'a', modelVersion: 'v1' }).bindingGeneration, 2);
  assert.throws(() => reg.register({ modelKey: 'a', modelVersion: 'v2' }), ModelKeyVersionConflictError);
  assert.equal(reg.getBinding('zzz'), null);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/support.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./support/index.mjs`.

- [x] **Step 3: Implement the fake clock**

`test/clashtest/support/fakeClock.mjs`:

```js
// test/clashtest/support/fakeClock.mjs
//
// Deterministic `now` / `yieldToScheduler` pair (spec 18 test seams; same convention as
// CollisionWorld's constructor). No wall-clock sleeps anywhere in clashtest tests.
//
//   const clock = createFakeClock({ tickMs: 1 });          // every now() read advances 1 ms ("work")
//   const slicer = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, ... });
//
// `now` and `yieldToScheduler` are closures, so they can be destructured and passed detached.
// `onYield(fn)` runs `fn(yieldCount)` inside every yield: this is how a test mutates a caller-owned
// object "while the engine is yielded mid-slice" (spec 5.3, AC-1) or cancels a run at a yield.

export function createFakeClock({ start = 0, tickMs = 0, yieldAdvanceMs = 0 } = {}) {
  let t = start;
  let yields = 0;
  const hooks = new Set();
  return {
    now() { const v = t; t += tickMs; return v; },
    /** Advance time without reading it (simulates a long synchronous span). */
    advance(ms) { t += ms; },
    /** Current time without the per-read tick. */
    peek() { return t; },
    async yieldToScheduler() {
      yields += 1;
      t += yieldAdvanceMs;
      for (const hook of [...hooks]) await hook(yields);
    },
    get yieldCount() { return yields; },
    onYield(fn) { hooks.add(fn); return () => hooks.delete(fn); },
  };
}
```

- [x] **Step 4: Implement the fake world**

`test/clashtest/support/fakeWorld.mjs`:

```js
// test/clashtest/support/fakeWorld.mjs
//
// A fake CollisionWorld that records every `findClashes` call and can be scripted to return or
// throw. It fakes ONLY the call the executor makes (spec 7.2). P4/P6 extend it with new files
// (see support/README rule in index.mjs) - they never edit this one.
import { WorldDisposedError } from '../../../collision/errors.js';

/** A stand-in for a Viewer `Model`: a plain object the fake world never inspects. */
export function createFakeModel(id) { return { id, fakeModel: true }; }

export const emptyClashResult = () => ({ pairs: [], statistics: { diagnostics: [] } });

/** Copy of the query with fresh arrays (models kept by reference) so later mutation cannot change an assertion. */
export function snapshotQuery(query) {
  return {
    source: { model: query.source?.model, dbIds: [...(query.source?.dbIds ?? [])] },
    target: {
      targets: (query.target?.targets ?? []).map((t) => ({ model: t.model, ...(t.dbIds ? { dbIds: [...t.dbIds] } : {}) })),
    },
    mode: query.mode,
    groupBy: query.groupBy,
    ...(query.clearance !== undefined ? { clearance: query.clearance } : {}),
    broadPhase: query.broadPhase,
  };
}

export function createFakeWorld({ defaultResult = emptyClashResult } = {}) {
  const calls = [];
  const queue = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let disposed = false;

  const world = {
    calls,
    get inFlight() { return inFlight; },
    get maxInFlight() { return maxInFlight; },
    get disposed() { return disposed; },

    async findClashes(query) {
      if (disposed) throw new WorldDisposedError();
      const call = { index: calls.length, query, snapshot: snapshotQuery(query) };
      calls.push(call);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (queue.length === 0) return defaultResult(call);
        const step = queue.shift();
        if (typeof step === 'function') return await step(query, call);
        if (step instanceof Error) throw step;
        return step;
      } finally {
        inFlight -= 1;
      }
    },

    /** Queue steps consumed by successive calls: a result object, an Error (thrown), or `(query, call) => result | Promise`. */
    script(...steps) { queue.push(...steps); return world; },

    /**
     * Queue a step that parks the next call until released. `started` resolves (with the call record)
     * once the call is in flight; `release(result)` / `fail(error)` settle it.
     */
    hold() {
      let resolveStarted;
      const started = new Promise((res) => { resolveStarted = res; });
      let settle;
      const gate = new Promise((res, rej) => { settle = { res, rej }; });
      queue.push((_q, call) => { resolveStarted(call); return gate; });
      return { started, release: (v = emptyClashResult()) => settle.res(v), fail: (e) => settle.rej(e) };
    },

    dispose() { disposed = true; },
  };
  return world;
}
```

- [x] **Step 5: Implement the fake enumerator**

`test/clashtest/support/fakeEnumerator.mjs`:

```js
// test/clashtest/support/fakeEnumerator.mjs
//
// A data-driven fake of the ElementEnumerator port (spec 6.2). P3 owns the real port contract and
// its conformance helper; this fake exists so P0-P2 tests and later phases share one double.
// It has NO instance-tree model: an explicit `{dbIds}` scope resolves to the configured roots
// whose dbId is listed (everything else is `unresolved: not-found`). P3 adds hierarchy-aware
// behaviour in a NEW file, not here.
import { EnumerationCancelledError } from '../../../clashtest/errors.js';

const byDbId = (a, b) => a.dbId - b.dbId;
const clone = (v) => (v === undefined ? v : structuredClone(v));

/**
 * @param {object} cfg
 * @param {Record<string, { roots: Array<{dbId:number, fragmentCount:number, ownerDbIds:number[], subtreeDigest:string}>,
 *   population?: {count:number, digest:string} | null, ownerMismatch?: object | null, unreachable?: object | null }>} cfg.models
 * @param {number} [cfg.checkpointsPerCall=1]  how many times a cooperating call awaits ctx.checkpoint()
 * @param {boolean} [cfg.cooperative=true]     false = ignores ctx entirely (the non-cooperating enumerator of AC-7)
 */
export function createFakeEnumerator({ models = {}, checkpointsPerCall = 1, cooperative = true } = {}) {
  const state = new Map(Object.entries(models).map(([k, v]) => [k, clone({ population: null, ownerMismatch: null, unreachable: null, ...v })]));
  const calls = [];
  let onCall = null;

  async function run(kind, binding, scope, ctx) {
    const call = { index: calls.length, kind, modelKey: binding.modelKey, scope: clone(scope) };
    calls.push(call);
    if (cooperative && ctx) for (let i = 0; i < checkpointsPerCall; i++) await ctx.checkpoint();
    if (onCall) await onCall(call);
    const m = state.get(binding.modelKey);
    if (!m) throw new Error(`fake enumerator: unknown model ${binding.modelKey}`);
    const roots = [...m.roots].sort(byDbId);
    if (scope === 'whole') {
      return kind === 'resolveRoots'
        ? { roots: clone(roots), population: clone(m.population), ownerMismatch: clone(m.ownerMismatch), unreachable: clone(m.unreachable), unresolved: [] }
        : { kind: 'population', count: m.population?.count ?? 0, digest: m.population?.digest ?? '' };
    }
    const wanted = new Set(scope.dbIds);
    const picked = roots.filter((r) => wanted.has(r.dbId));
    if (kind === 'digestScope') {
      return { kind: 'roots', roots: picked.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })) };
    }
    const known = new Set(roots.map((r) => r.dbId));
    return {
      roots: clone(picked), population: null, ownerMismatch: null, unreachable: null,
      unresolved: [...wanted].filter((id) => !known.has(id)).sort((a, b) => a - b).map((dbId) => ({ dbId, reason: 'not-found' })),
    };
  }

  return {
    calls,
    resolveRoots: (binding, scope, ctx) => run('resolveRoots', binding, scope, ctx),
    digestScope: (binding, scope, ctx) => run('digestScope', binding, scope, ctx),
    /** Mutate a model's configured content, simulating a change between planning and execution. */
    set(modelKey, patch) { Object.assign(state.get(modelKey), clone(patch)); },
    /** Hook run inside every call after the checkpoints and before the answer (may mutate state via set()). */
    onCall(fn) { onCall = fn; },
  };
}

/** An EnumerationContext whose checkpoint throws EnumerationCancelledError once `cancel(reason)` was called. */
export function createFakeEnumerationContext({ yieldToScheduler = async () => {} } = {}) {
  let cancelReason = null;
  let checkpoints = 0;
  return {
    checkpoint: async () => {
      checkpoints += 1;
      await yieldToScheduler();
      if (cancelReason) throw new EnumerationCancelledError({ reason: cancelReason });
    },
    cancel(reason = 'cancelled') { cancelReason = reason; },
    get checkpoints() { return checkpoints; },
  };
}
```

- [x] **Step 6: Implement the fake registry placeholder and the barrel**

`test/clashtest/support/fakeRegistry.mjs`:

```js
// test/clashtest/support/fakeRegistry.mjs
//
// PLACEHOLDER for the ModelRegistry port (spec 4.3). P1 owns the real `ModelRegistry`
// (identity/ModelRegistry.js); P0 only needs "look up a binding by modelKey" for the enumerator and
// executor doubles. The binding shape below is ASSUMED and must be reconciled with P1:
//   { modelKey, modelVersion, model, bindingGeneration }
// Tests that exercise identity semantics (version conflicts, generations, leases) must use the
// real registry once P1 lands, not this fake.
import { ModelKeyVersionConflictError } from '../../../clashtest/errors.js';

export function createFakeRegistry({ registrySessionId = 'fake-session-1', models = [] } = {}) {
  const bindings = new Map();
  const registry = {
    registrySessionId,
    register({ modelKey, modelVersion, model = null }) {
      const existing = bindings.get(modelKey);
      if (existing && existing.modelVersion !== modelVersion) {
        throw new ModelKeyVersionConflictError({ modelKey, existingVersion: existing.modelVersion, offeredVersion: modelVersion });
      }
      const binding = Object.freeze({ modelKey, modelVersion, model, bindingGeneration: existing ? existing.bindingGeneration + 1 : 1 });
      bindings.set(modelKey, binding);
      return binding;
    },
    getBinding(modelKey) { return bindings.get(modelKey) ?? null; },
    /** Frozen array of current bindings, ascending by modelKey (code-unit order). */
    snapshotBindings() { return Object.freeze([...bindings.values()].sort((a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0))); },
  };
  for (const m of models) registry.register(m);
  return registry;
}
```

`test/clashtest/support/index.mjs`:

```js
// test/clashtest/support/index.mjs
//
// Barrel for the shared clashtest test doubles (master plan 2.1 rule 5: later phases ADD to this
// directory, they never fork it).
//
// EXTENSION RULES
//  1. Never change the signature or default behaviour of an exported name. Add options with
//     defaults that preserve the old behaviour.
//  2. A phase adds a NEW file `support/<area>.mjs` (e.g. `fakeWorld.placement.mjs`,
//     `fakeExecutor.mjs`, `fakeResultStore.mjs`) and appends its exports below; it does not edit
//     another phase's file.
//  3. Support files contain no `test(...)` calls and are not named `*.test.mjs`, so the runner
//     (scripts/run-tests.mjs) never treats them as tests. Their own tests live in support.test.mjs
//     (P0) or `<area>.support.test.mjs`.
//  4. No wall-clock time, no timers, no network: time comes from createFakeClock.
export * from './fakeClock.mjs';
export * from './fakeWorld.mjs';
export * from './fakeEnumerator.mjs';
export * from './fakeRegistry.mjs';
//
// LATER PHASES APPEND ONE LINE EACH, in phase order, as their task creates the file. P0 creates
// only the four above; the roster below is the *expected* final contents of this barrel and is
// recorded here (not implemented here) so no phase re-invents a double that already exists:
//   P1  export * from './leaseWorld.mjs';            // makeLeaseWorld — the only lease surface
//   P2  export * from './definitions.mjs';           // makeDefinition
//   P3  export * from './syntheticModels.mjs';       // synthetic models -> conforming enumerator
//   P3  export * from './bruteForcePairs.mjs';       // reference pair space (property suite)
//   P4  export * from './executionWorld.mjs';        // createExecutionWorld = fakeWorld + leaseWorld
//   P4  export * from './executionRequests.mjs';     // makeRequest / makeExecutorDeps
//   P4  export * from './realWorldFixture.mjs';      // makeTwoModelFixture / box
//   P5  export * from './resultSetFixtures.mjs';     // makeFakeRun / sealFakeRun / ledgerWith
//   P5  export * from './resultStoreConformance.mjs';// runResultStoreConformance
//   P6  export * from './scriptedExecutor.mjs';      // createScriptedExecutor
//   P6  export * from './fakePlanner.mjs';           // createFakePlan
//   P6  export * from './placementRegistry.mjs';     // createPlacementRegistry
//   P6  export * from './runFixture.mjs';            // createRunFixture
//   P6  export * from './sealedSetFixture.mjs';      // createSealedSetFixture
//   P7  export * from './realWorld.mjs';             // makeRealWorldFixture
//   P7  export * from './bruteForce.mjs';            // per-pair differential reference
//   P7  export * from './maximumShape.mjs';          // maximum-shape synthesizer
```

**The barrel is the roster, and it is one file every later phase edits.** Rule (2) above says a phase adds a **new** `support/<area>.mjs` and appends its export line here; it never edits another phase's file, and appending a line to this barrel is not "editing another phase's file". A test may import either from `./support/index.mjs` or from the specific module (`../support/leaseWorld.mjs`) — both are legal, and the phase files use both — but a double that is *not* listed here is a fork and a defect. The commented roster above is the check: every `test/clashtest/support/*.mjs` created by P1–P8 appears in it exactly once.

- [x] **Step 7: Run it and confirm it passes**

Run: `node --test test/clashtest/support.test.mjs`
Expected: PASS — 6 tests, 0 failures.

- [x] **Step 8: Checkpoint commit (only if the user has authorized commits)**

```bash
git add test/clashtest/support test/clashtest/support.test.mjs
git commit -m "test(clashtest): P0.5 shared fakes (clock, world, enumerator, registry placeholder)"
```

### Task P0.6: Deadline-aware slicer (`clashtest/util/slicer.js`)

**Files**
- Create: `clashtest/util/slicer.js`
- Test: `test/clashtest/util/slicer.test.mjs`

**Interfaces**
- Consumes: `ENGINE_LIMIT_DEFAULTS` (P0.3) for default budgets; `createFakeClock` (P0.5) in tests.
- Produces: `createSlicer`, `makeYieldToScheduler` (see summary). P2 (normalization), P3 (enumeration handling, planning), P4 (projection), P5 (merge/sort/digest/seal), P6 (inter-unit yield, cancellation via `afterYield`), P8 (derivations) all obtain their slicing from here. The engine passes its own `spanRecorder` (spec §17.3) when constructing slicers; the recorder receives `(label, ms)` exactly like `collision/scheduler.js`'s `setSpanRecorder` callback.

- [x] **Step 1: Write the failing test**

`test/clashtest/util/slicer.test.mjs`:

```js
// test/clashtest/util/slicer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlicer, makeYieldToScheduler } from '../../../clashtest/util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createFakeClock } from '../support/index.mjs';

const mk = (clock, extra = {}) => createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, ...extra });

test('tick() is synchronous (returns undefined) until a yield is due, then returns a Promise', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  assert.equal(s.tick(), undefined);
  clock.advance(3); assert.equal(s.tick(), undefined);        // 3 ms < 4 ms budget
  clock.advance(1);
  const p = s.tick();
  assert.ok(p instanceof Promise);
  await p;
  assert.equal(clock.yieldCount, 1);
});

test('the clock is only read every checkEvery items (default 64), not on every tick', () => {
  let reads = 0;
  const s = createSlicer({ now: () => { reads++; return 0; }, yieldToScheduler: async () => {}, sliceBudgetMs: 4, maxItemsPerSlice: 1_000_000 });
  const afterConstruction = reads;
  for (let i = 0; i < 63; i++) s.tick();
  assert.equal(reads, afterConstruction);                     // no clock read within the first 63 items
  s.tick();
  assert.equal(reads, afterConstruction + 1);                 // the 64th tick reads it once
});

test('a slice yields once the budget elapsed and the next slice starts fresh', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  let yieldsSeen = 0;
  for (let i = 0; i < 20; i++) {
    clock.advance(1);                                         // each item costs 1 ms
    const p = s.tick('work'); if (p) { await p; yieldsSeen++; }
  }
  assert.equal(yieldsSeen, 5);                                // every 4th item
  assert.equal(clock.yieldCount, 5);
  assert.deepEqual(s.stats(), { ticks: 20, yields: 5 });
});

test('aggregationSliceMaxItems is a secondary ceiling: it yields even when the clock says there is time', async () => {
  const clock = createFakeClock();                            // time never advances
  const s = mk(clock, { sliceBudgetMs: 1_000_000, checkEvery: 1_000_000, maxItemsPerSlice: 10 });
  for (let i = 0; i < 25; i++) { const p = s.tick(); if (p) await p; }
  assert.equal(clock.yieldCount, 2);                          // at item 10 and 20
});

test('defaults come from the resolved engine limits (options.js), overridable per option', () => {
  const clock = createFakeClock();
  const s = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, checkEvery: 1 });
  for (let i = 0; i < ENGINE_LIMIT_DEFAULTS.aggregationSliceMaxItems - 1; i++) assert.equal(s.tick(), undefined);
  assert.ok(s.tick() instanceof Promise);
  assert.throws(() => createSlicer({ sliceBudgetMs: 0 }), TypeError);
  assert.throws(() => createSlicer({ maxItemsPerSlice: 1.5 }), TypeError);
});

test('reset() restarts the current slice without yielding and leaves stats() alone (a reused slicer must not yield at once after non-sliced time)', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 3 });
  s.tick(); s.tick();                                         // 2 of 3 items used in this slice
  clock.advance(100);                                         // a long NON-sliced span (e.g. awaiting findClashes)
  assert.equal(s.reset(), undefined);
  assert.equal(clock.yieldCount, 0);                          // reset never yields
  assert.equal(s.tick(), undefined);                          // fresh slice: 0 ms elapsed, item 1
  assert.equal(s.tick(), undefined);                          // item 2
  assert.deepEqual(s.stats(), { ticks: 4, yields: 0 });
  const third = s.tick();                                     // item 3 reaches maxItemsPerSlice of the FRESH slice
  assert.ok(third instanceof Promise);
  await third;
  // control: without reset() the stale slice start makes the very next tick yield
  const clock2 = createFakeClock();
  const t = mk(clock2, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  t.tick(); clock2.advance(100);
  assert.ok(t.tick() instanceof Promise);
});

test('spanRecorder receives (label, ms) for every yielded slice; a throwing recorder never breaks the slicer', async () => {
  const clock = createFakeClock();
  const spans = [];
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, spanRecorder: (label, ms) => spans.push([label, ms]) });
  clock.advance(5); await s.tick('digest');
  clock.advance(7); await s.tick('sort');
  assert.deepEqual(spans, [['digest', 5], ['sort', 7]]);
  const s2 = mk(clock, { sliceBudgetMs: 1, checkEvery: 1, spanRecorder: () => { throw new Error('host bug'); } });
  clock.advance(2); await s2.tick('x');                       // must not throw
});

test('afterYield runs after every yield and may abort the sliced work by throwing (cancellation seam)', async () => {
  const clock = createFakeClock();
  let n = 0;
  const s = mk(clock, { sliceBudgetMs: 1, checkEvery: 1, afterYield: () => { if (++n === 2) throw new Error('cancelled'); } });
  clock.advance(2); await s.tick();
  clock.advance(2);
  await assert.rejects(async () => { await s.tick(); }, /cancelled/);
});

test('forEach visits every item in order (sync and async callbacks) and yields between slices', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1 });
  const seen = [];
  await s.forEach([1, 2, 3, 4, 5, 6, 7, 8], (x, i) => { clock.advance(1); seen.push([x, i]); });
  assert.deepEqual(seen.map((p) => p[0]), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(clock.yieldCount, 2);
  const seen2 = [];
  await s.forEach(['a', 'b'], async (x) => { await null; seen2.push(x); });
  assert.deepEqual(seen2, ['a', 'b']);
});

test('caller mutation while the engine is yielded mid-slice cannot affect a captured copy (the yield hook seam)', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 1, checkEvery: 1 });
  const caller = { ids: [3, 1, 2] };
  const copy = { ids: [...caller.ids] };
  clock.onYield(() => { caller.ids.push(999); caller.ids[0] = -1; });
  clock.advance(2); await s.tick();
  assert.deepEqual(copy.ids, [3, 1, 2]);
  assert.deepEqual(caller.ids, [-1, 1, 2, 999]);
});

test('sortSliced: stable, does not mutate its input, agrees with Array#sort on random data, and slices', async () => {
  const clock = createFakeClock({ tickMs: 1 });
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1 });
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const data = Array.from({ length: 300 }, (_, i) => ({ k: Math.floor(rnd() * 20), i }));
  const frozen = data.map((d) => ({ ...d }));
  const out = await s.sortSliced(data, (a, b) => a.k - b.k);
  assert.deepEqual(data, frozen);                                              // input untouched
  assert.deepEqual(out, [...data].sort((a, b) => a.k - b.k));                  // Array#sort is stable in Node >= 12
  assert.ok(clock.yieldCount > 0, 'a 300-item sort with a 4-tick budget must have yielded');
  assert.deepEqual(await s.sortSliced([], (a, b) => a - b), []);
  assert.deepEqual(await s.sortSliced([2], (a, b) => a - b), [2]);
  assert.deepEqual(await s.sortSliced([3, 1, 2], (a, b) => a - b), [1, 2, 3]);
});

test('makeYieldToScheduler: animation-frame uses requestAnimationFrame when present, else degrades to a macrotask', async () => {
  let frames = 0;
  const raf = (cb) => { frames++; queueMicrotask(cb); };
  await makeYieldToScheduler('animation-frame', { requestAnimationFrame: raf })();
  assert.equal(frames, 1);
  await makeYieldToScheduler('animation-frame', { requestAnimationFrame: undefined })(); // degrade: resolves via setTimeout(0)
  await makeYieldToScheduler('macrotask', { requestAnimationFrame: raf })();
  assert.equal(frames, 1);                                                    // 'macrotask' never touches rAF
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/util/slicer.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/util/slicer.js`.

- [x] **Step 3: Implement `clashtest/util/slicer.js`**

```js
// clashtest/util/slicer.js
//
// Deadline-aware sliced work (spec 17.3). Every engine-controlled synchronous span that is not
// validation/capture runs through a slicer: it checks the injected `now` at least every
// `checkEvery` (64) items and yields once `sliceBudgetMs` has elapsed, with
// `maxItemsPerSlice` (= engine limit `aggregationSliceMaxItems`) as a secondary ceiling. The 8 ms
// figure is a design target measured in AC-12, not a guarantee (spec 17.3).
//
// Same calling convention as collision/scheduler.js's checkpoint: `tick()` returns `undefined` on
// the not-due fast path and a Promise only when a yield is due, so a hot loop never pays a
// microtask per item:   const p = slicer.tick('label'); if (p) await p;

import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

const defaultNow = () => performance.now();
const macrotaskYield = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The scheduler seam for `interUnitYield` (spec 7.3): 'animation-frame' where
 * requestAnimationFrame exists, else it degrades to a macrotask; 'macrotask' forces the latter.
 */
export function makeYieldToScheduler(kind = 'macrotask', { requestAnimationFrame = globalThis.requestAnimationFrame } = {}) {
  if (kind === 'animation-frame' && typeof requestAnimationFrame === 'function') {
    return () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return macrotaskYield;
}

const positiveInt = (name, v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw new TypeError(`createSlicer: ${name} must be a positive integer (got ${v})`);
  return v;
};

/**
 * @param {object} [o]
 * @param {() => number} [o.now]
 * @param {() => (void | Promise<void>)} [o.yieldToScheduler]
 * @param {{ sliceBudgetMs: number, aggregationSliceMaxItems: number }} [o.limits] resolved engine limits
 * @param {number} [o.sliceBudgetMs]      overrides limits.sliceBudgetMs
 * @param {number} [o.maxItemsPerSlice]   overrides limits.aggregationSliceMaxItems
 * @param {number} [o.checkEvery=64]      clock-check cadence in items
 * @param {(label: string, ms: number) => void} [o.spanRecorder]  labelled slice spans (spec 17.3 `spanRecorder`)
 * @param {() => (void | Promise<void>)} [o.afterYield] runs after every yield; may throw (cancellation / lease checks)
 */
export function createSlicer({
  now = defaultNow, yieldToScheduler = macrotaskYield, limits = ENGINE_LIMIT_DEFAULTS,
  sliceBudgetMs = limits.sliceBudgetMs, maxItemsPerSlice = limits.aggregationSliceMaxItems,
  checkEvery = 64, spanRecorder = null, afterYield = null,
} = {}) {
  positiveInt('sliceBudgetMs', sliceBudgetMs);
  positiveInt('maxItemsPerSlice', maxItemsPerSlice);
  positiveInt('checkEvery', checkEvery);

  let sliceStart = now();
  let items = 0;
  let sinceCheck = 0;
  let yields = 0;
  let ticks = 0;

  async function yieldNow(label = 'slice') {
    const spent = now() - sliceStart;
    if (spanRecorder) { try { spanRecorder(label, spent); } catch { /* a host callback must never break the engine */ } }
    yields += 1;
    await yieldToScheduler();
    items = 0;
    sinceCheck = 0;
    if (afterYield) await afterYield();
    sliceStart = now();
  }

  function tick(label = 'slice') {
    ticks += 1;
    items += 1;
    sinceCheck += 1;
    if (items >= maxItemsPerSlice) return yieldNow(label);
    if (sinceCheck >= checkEvery) {
      sinceCheck = 0;
      if (now() - sliceStart >= sliceBudgetMs) return yieldNow(label);
    }
    return undefined;
  }

  /** Sliced `for` over an array; `fn` may be sync or async. */
  async function forEach(list, fn, { label = 'forEach' } = {}) {
    for (let i = 0; i < list.length; i++) {
      const r = fn(list[i], i);
      if (r && typeof r.then === 'function') await r;
      const p = tick(label);
      if (p) await p;
    }
  }

  /** Stable, sliced bottom-up merge sort; returns a NEW array (input untouched). `compare` as Array#sort. */
  async function sortSliced(list, compare, { label = 'sort' } = {}) {
    let src = list.slice();
    const n = src.length;
    if (n < 2) return src;
    let dst = new Array(n);
    for (let width = 1; width < n; width *= 2) {
      for (let lo = 0; lo < n; lo += 2 * width) {
        const mid = Math.min(lo + width, n);
        const hi = Math.min(lo + 2 * width, n);
        let i = lo; let j = mid; let k = lo;
        while (k < hi) {
          // take the right run's head only when it is STRICTLY smaller: keeps the sort stable
          dst[k++] = (i < mid && (j >= hi || !(compare(src[j], src[i]) < 0))) ? src[i++] : src[j++];
          const p = tick(label);
          if (p) await p;
        }
      }
      [src, dst] = [dst, src];
    }
    return src;
  }

  /** Restart the current slice (clock and item counters) WITHOUT yielding; stats() is untouched. For a caller
   *  that reuses one slicer across sequential operations separated by non-sliced time (P4 projectDiagnostics). */
  function reset() {
    sliceStart = now();
    items = 0;
    sinceCheck = 0;
  }

  return { tick, yieldNow, reset, forEach, sortSliced, stats: () => ({ ticks, yields }) };
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `node --test test/clashtest/util/slicer.test.mjs`
Expected: PASS — 12 tests, 0 failures.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits)**

```bash
git add clashtest/util/slicer.js test/clashtest/util/slicer.test.mjs
git commit -m "feat(clashtest): P0.6 deadline-aware slicer and scheduler seam"
```

### Task P0.7: Canonical JSON and digest (`clashtest/util/canonical.js`)

**Files**
- Create: `clashtest/util/canonical.js`
- Test: `test/clashtest/util/canonical.test.mjs`

**Interfaces**
- Consumes: `createSlicer` (P0.6) and `createFakeClock` (P0.5) in tests only; `digestCanonicalSliced` accepts any `{tick(label)}`.
- Produces: `DIGEST_VERSION`, `DIGEST_PREFIX`, `canonicalJson`, `canonicalChunks`, `Sha256`, `sha256Text`, `digestCanonical`, `digestCanonicalSliced`. P2 uses it for `semanticDigest` (AC-1 definition-level golden vectors — entry permutation, swapped `selectionA`/`selectionB` — live in P2 because they need P2's normalization; P0 pins the byte-level encoding). P3 uses it for scope digests; P5 for `pairSetDigest`/`ledgerDigest` (over "documented fields only", spec §13.6 — the projection is P5's job, P0 digests exactly the value it is given).

- [x] **Step 1: Write the failing test**

`test/clashtest/util/canonical.test.mjs`:

```js
// test/clashtest/util/canonical.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DIGEST_VERSION, DIGEST_PREFIX, Sha256, canonicalJson, canonicalChunks, sha256Text, digestCanonical, digestCanonicalSliced,
} from '../../../clashtest/util/canonical.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { createFakeClock } from '../support/index.mjs';

const nodeSha = (s) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

test('digest format constants', () => {
  assert.equal(DIGEST_VERSION, 1);
  assert.equal(DIGEST_PREFIX, 'sha256:');
  assert.match(digestCanonical({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
});

test('SHA-256: FIPS 180-4 vectors', () => {
  assert.equal(sha256Text(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Text('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    'sha256:248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256 agrees with node:crypto at every padding boundary and on multi-byte UTF-8', () => {
  for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1_000, 65_537]) {
    const s = 'x'.repeat(len);
    assert.equal(sha256Text(s), nodeSha(s), `len ${len}`);
  }
  const uni = 'é中\u{1F600}'.repeat(50);
  assert.equal(sha256Text(uni), nodeSha(uni));
});

test('SHA-256 is invariant under how the input is split into update() calls; finalised hashers refuse more input', () => {
  const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(40));
  const whole = new Sha256().update(bytes).digestHex();
  for (const step of [1, 3, 7, 63, 64, 65, 500]) {
    const h = new Sha256();
    for (let i = 0; i < bytes.length; i += step) h.update(bytes.subarray(i, i + step));
    assert.equal(h.digestHex(), whole, `step ${step}`);
  }
  const h = new Sha256(); h.digestHex();
  assert.throws(() => h.update(new Uint8Array(1)), /finalised/);
});

// Golden byte-level vectors (AC-1): entry permutations, Unicode, control characters, lone
// surrogates, -0 and exponent-form numbers. Expected strings are the normative output.
const GOLDEN = [
  ['key order', { b: 1, a: 2 }, '{"a":2,"b":1}'],
  ['nested key order + arrays keep order', { z: [3, 1, 2], a: { y: 1, x: 2 } }, '{"a":{"x":2,"y":1},"z":[3,1,2]}'],
  // U+1F600 is the code units D83D DE00, which sort BEFORE U+FF5E although its code point is larger.
  ['UTF-16 code-unit key order (not code point order)', { '\uFF5E': 2, '\u{1F600}': 1 }, '{"\u{1F600}":1,"\uFF5E":2}'],
  ['no insignificant whitespace, null/bool', { n: null, t: true, f: false, e: [], o: {} }, '{"e":[],"f":false,"n":null,"o":{},"t":true}'],
  ['non-ASCII is emitted raw', { k: 'é\u{1F600}' }, '{"k":"é\u{1F600}"}'],
  ['control characters: short forms and \\u00XX', 'a\u0000\b\t\n\f\r\u001f\u007f', '"a\\u0000\\b\\t\\n\\f\\r\\u001f\u007f"'],
  ['quote and backslash', 'q"b\\', '"q\\"b\\\\"'],
  ['lone surrogates are escaped, paired ones are not', '\ud800x\udc00\u{1F600}', '"\\ud800x\\udc00\u{1F600}"'],
  ['-0 normalises to 0', [-0, 0], '[0,0]'],
  ['exponent-form and shortest round-trip numbers', [1e21, 1e-7, 123456789012345680000, 0.1 + 0.2, 5e-324, 1.7976931348623157e308, 100, 1.5],
    '[1e+21,1e-7,123456789012345680000,0.30000000000000004,5e-324,1.7976931348623157e+308,100,1.5]'],
  ['entries permutation is NOT normalised here (normalisation is P2)', { entries: [{ kind: 'model', modelKey: 'b' }, { kind: 'model', modelKey: 'a' }] },
    '{"entries":[{"kind":"model","modelKey":"b"},{"kind":"model","modelKey":"a"}]}'],
];
for (const [name, value, expected] of GOLDEN) {
  test(`canonical golden: ${name}`, () => {
    assert.equal(canonicalJson(value), expected);
    assert.equal(digestCanonical(value), nodeSha(expected));       // digest == SHA-256 of exactly those UTF-8 bytes
    assert.equal([...canonicalChunks(value)].join(''), expected);
  });
}

test('pinned digests (regression pins; independently cross-checked against node:crypto above)', () => {
  assert.equal(digestCanonical({ b: 1, a: 2 }), 'sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772');
  assert.equal(digestCanonical([-0, 0]), 'sha256:3d5812abc84c11768aa73a732c85d75dbed439188f5bb3239e9b762ea31d9862');
});

test('key permutations give one digest; array order and role-tagging change it (swap of selectionA/selectionB differs)', () => {
  const x = { mode: 'volume-overlap', selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] }, selectionB: { entries: [{ kind: 'model', modelKey: 'b' }] } };
  const y = { selectionB: x.selectionB, mode: x.mode, selectionA: x.selectionA };
  const swapped = { mode: x.mode, selectionA: x.selectionB, selectionB: x.selectionA };
  assert.equal(digestCanonical(x), digestCanonical(y));
  assert.notEqual(digestCanonical(x), digestCanonical(swapped));
  assert.notEqual(digestCanonical([1, 2]), digestCanonical([2, 1]));
  assert.equal(digestCanonical(-0), digestCanonical(0));
});

test('canonical JSON parses back to the same value (round trip)', () => {
  const v = { a: [1, 'x', null, { b: true }], c: ' \ud800', d: 0.5 };
  assert.deepEqual(JSON.parse(canonicalJson(v)), v);
});

test('anything that is not plain JSON data is a TypeError (undefined, non-finite, function, symbol, bigint, Map, Date, class, cycle)', () => {
  class Foo {}
  const cyc = {}; cyc.self = cyc;
  for (const bad of [undefined, NaN, Infinity, -Infinity, () => 1, Symbol('s'), 1n, new Map(), new Date(0), new Foo(), cyc, { a: undefined }, [undefined]]) {
    assert.throws(() => canonicalJson(bad), TypeError, String(bad));
  }
});

test('sliced digest is byte-identical to the synchronous one, and yields on a large value', async () => {
  const value = { results: Array.from({ length: 5_000 }, (_, i) => ({ id: `r${i}`, p: [i, i / 3, -i], tags: ['a', 'b'] })) };
  const clock = createFakeClock({ tickMs: 1 });
  const slicer = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, sliceBudgetMs: 4, checkEvery: 1 });
  const sliced = await digestCanonicalSliced(value, slicer);
  assert.equal(sliced, digestCanonical(value));
  assert.equal(sliced, nodeSha(canonicalJson(value)));
  assert.ok(clock.yieldCount > 0);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `node --test test/clashtest/util/canonical.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `clashtest/util/canonical.js`.

- [x] **Step 3: Implement `clashtest/util/canonical.js`**

```js
// clashtest/util/canonical.js
//
// Canonical JSON and the durable digest format (spec 5.4, 13.4). The OUTPUT BYTES are normative;
// the mechanism is not: this is a portable pure-JS incremental SHA-256 (no node:crypto, no Web
// Crypto), chosen because the same code must run in the browser and be sliceable to the
// `frameBudgetMs` span rule (spec 17.3).
//
// Canonical JSON: object keys sorted by UTF-16 code-unit order, no insignificant whitespace,
// strings by the ES2019 well-formed JSON.stringify algorithm (lone surrogates escaped, so every
// string has exactly one encoding), numbers by shortest round-trip Number#toString (finite only,
// -0 -> 0), arrays in their given order. `undefined`, functions, symbols, bigint, Map/Set, class
// instances and non-finite numbers are a TypeError: the engine only digests plain data it built.

export const DIGEST_VERSION = 1;
export const DIGEST_PREFIX = 'sha256:';

const MAX_CANONICAL_DEPTH = 128; // a cycle or an absurd nesting is a bug, not data

function* chunks(value, path, depth) {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`canonical: nesting deeper than ${MAX_CANONICAL_DEPTH} at ${path || '/'}`);
  if (value === null) { yield 'null'; return; }
  switch (typeof value) {
    case 'string': yield JSON.stringify(value); return;
    case 'boolean': yield value ? 'true' : 'false'; return;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number at ${path || '/'}`);
      yield Object.is(value, -0) ? '0' : String(value);
      return;
    case 'object': break;
    default: throw new TypeError(`canonical: ${typeof value} is not serialisable at ${path || '/'}`);
  }
  if (Array.isArray(value)) {
    yield '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ',';
      yield* chunks(value[i], `${path}/${i}`, depth + 1);
    }
    yield ']';
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`canonical: non-plain object at ${path || '/'}`);
  const keys = Object.keys(value).sort(); // default sort = UTF-16 code-unit order
  yield '{';
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) yield ',';
    yield JSON.stringify(keys[i]);
    yield ':';
    yield* chunks(value[keys[i]], `${path}/${keys[i]}`, depth + 1);
  }
  yield '}';
}

/** Lazily yields the canonical JSON of `value` as string chunks (each chunk is whole tokens, never half a code point). */
export function canonicalChunks(value) { return chunks(value, '', 0); }

/** The canonical JSON string. */
export function canonicalJson(value) {
  let out = '';
  for (const c of chunks(value, '', 0)) out += c;
  return out;
}

// ---- SHA-256 (FIPS 180-4), incremental -------------------------------------------------------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

export class Sha256 {
  constructor() {
    this._h = Uint32Array.from(H0);
    this._buf = new Uint8Array(64);
    this._bufLen = 0;
    this._bytes = 0;
    this._w = new Uint32Array(64);
    this._done = false;
  }

  /** @param {Uint8Array} bytes */
  update(bytes) {
    if (this._done) throw new Error('Sha256: already finalised');
    const n = bytes.length;
    this._bytes += n;
    let i = 0;
    if (this._bufLen > 0) {
      const take = Math.min(64 - this._bufLen, n);
      this._buf.set(bytes.subarray(0, take), this._bufLen);
      this._bufLen += take;
      i = take;
      if (this._bufLen === 64) { this._block(this._buf, 0); this._bufLen = 0; }
    }
    for (; i + 64 <= n; i += 64) this._block(bytes, i);
    if (i < n) { this._buf.set(bytes.subarray(i), 0); this._bufLen = n - i; }
    return this;
  }

  _block(b, off) {
    const w = this._w;
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]; const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = w[t - 16] + s0 + w[t - 7] + s1; // Uint32Array store wraps mod 2^32
    }
    let [a, b1, c, d, e, f, g, h] = this._h;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b1; b1 = a; a = (t1 + t2) | 0;
    }
    const s = this._h;
    s[0] += a; s[1] += b1; s[2] += c; s[3] += d; s[4] += e; s[5] += f; s[6] += g; s[7] += h;
  }

  /** Finalise and return the 64-char lowercase hex digest. */
  digestHex() {
    const hi = Math.floor(this._bytes / 0x20000000);     // high 32 bits of the bit length
    const lo = (this._bytes % 0x20000000) * 8;            // low 32 bits of the bit length
    const padLen = (this._bufLen < 56 ? 56 - this._bufLen : 120 - this._bufLen) + 8;
    const pad = new Uint8Array(padLen);
    pad[0] = 0x80;
    for (let k = 0; k < 4; k++) { pad[padLen - 8 + k] = (hi >>> (24 - 8 * k)) & 0xff; pad[padLen - 4 + k] = (lo >>> (24 - 8 * k)) & 0xff; }
    this.update(pad);
    this._done = true;
    return Array.from(this._h, (v) => v.toString(16).padStart(8, '0')).join('');
  }
}

const encoder = new TextEncoder();

/** `"sha256:" + hex` of the UTF-8 bytes of `text` (test / small-input convenience). */
export function sha256Text(text) { return DIGEST_PREFIX + new Sha256().update(encoder.encode(text)).digestHex(); }

/** Synchronous digest of the canonical JSON of `value`. Use only for small values; large ones use the sliced form. */
export function digestCanonical(value) {
  const sha = new Sha256();
  for (const c of chunks(value, '', 0)) sha.update(encoder.encode(c));
  return DIGEST_PREFIX + sha.digestHex();
}

/**
 * Digest of the canonical JSON of `value`, in deadline-aware slices (spec 17.3): one `slicer.tick`
 * per ~8 KiB of canonical text. The result is byte-identical to `digestCanonical`.
 * @param {{ tick: (label?: string) => (undefined | Promise<void>) }} slicer
 */
export async function digestCanonicalSliced(value, slicer, { label = 'digest' } = {}) {
  const sha = new Sha256();
  let pending = '';
  for (const c of chunks(value, '', 0)) {
    pending += c;
    if (pending.length >= 8192) {
      sha.update(encoder.encode(pending));
      pending = '';
      const p = slicer.tick(label);
      if (p) await p;
    }
  }
  if (pending) sha.update(encoder.encode(pending));
  return DIGEST_PREFIX + sha.digestHex();
}
```

- [x] **Step 4: Run it and confirm it passes**

Run: `node --test test/clashtest/util/canonical.test.mjs`
Expected: PASS — 20 tests, 0 failures. The SHA-256 cases cross-check against `node:crypto` at every padding boundary; if any differ, the round constants or padding in `Sha256` are wrong.

- [x] **Step 5: Checkpoint commit (only if the user has authorized commits)**

```bash
git add clashtest/util/canonical.js test/clashtest/util/canonical.test.mjs
git commit -m "feat(clashtest): P0.7 canonical JSON and sliceable SHA-256 digest"
```

### Task P0.8: Freeze the defaults — BLOCKED by gate G-CAL

**Blocked until** gate **G-CAL** (master §4) closes: the AC-12 measurement artifact (bytes per record/node, peak clone amplification, worst-case synchronous capture/validation span on the reference device, worst-case retained-byte estimate) exists under `docs/research/`, **and** the product owner has confirmed a memory budget. Until then every default in `options.js` stays provisional and `DEFAULTS_STATUS.provisional` stays `true`. Nothing else in P0–P7 waits on this task. The spec forbids treating these as frozen earlier (§17.1 calibration gate).

**Files**
- Modify: `clashtest/options.js` (numbers, `BYTES_PER_NODE`, `COMPARE_TOLERANCE_DEFAULTS` if the calibration moves them, `DEFAULTS_STATUS` only)
- Modify: `test/clashtest/options.defaults.test.mjs` (the drift source only)

**Interfaces**
- Consumes: the G-CAL measurement record (path to be recorded here when it exists).
- Produces: calibrated defaults with a recorded provenance; no signature changes.

- [ ] **Step 1: Confirm G-CAL is closed** — read the AC-12 artifact and the recorded product budget; record their repo-relative paths in the commit message. If either is missing, stop; this task stays open.
- [ ] **Step 2: Lower the numbers together** — edit only the table rows in `RUN_OPTION_SPECS`/`ENGINE_LIMIT_SPECS` (`maxLedgerRecords`, `maxPlanReferences`, `maxResultsPerRun`, `maxResidentResultSets`, `maxCapturedNodes`, `maxStoredResultBytes`, `maxExplicitElementsPerSelection` and any others the measurement moves) and `BYTES_PER_NODE`, keeping them jointly consistent (spec §13.6: they are frozen "jointly").
- [ ] **Step 3: Repoint the drift test** — the frozen spec must not be edited, so change `SPEC_PATH`/the parser in `options.defaults.test.mjs` to compare against the calibration record's table (same row format) for the calibrated keys, and keep the spec-table comparison for every key the calibration did not move.
- [ ] **Step 4: Flip the status** — in `options.js` replace `DEFAULTS_STATUS` with `{provisional: false, gate: 'G-CAL', calibratedAt: '<date>', record: '<repo-relative path>', note: '…'}` and change the `every default is flagged provisional` test to assert `provisional === false` **and** a non-empty `record`.
- [ ] **Step 5: Run** `node --test test/clashtest/options.test.mjs test/clashtest/options.defaults.test.mjs` — Expected: PASS; the invariant and cross-field tests must pass at the new numbers without edits.
- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits)** — `git commit -m "chore(clashtest): P0.8 freeze calibrated defaults (G-CAL closed)"`.

---

## Verification / acceptance for P0

Run, from the repo root, in this order:

- [x] `node --test test/clashtest/errors.test.mjs` — 7 pass
- [x] `node --test test/clashtest/util/capture.test.mjs` — 29 pass (incl. the accessor-on-`schemaVersion`/`runId` test, the one-ceiling test, the five-name export-surface test and the eight `openFieldBudget` tests)
- [x] `node --test test/clashtest/options.test.mjs test/clashtest/options.defaults.test.mjs` — 28 pass (incl. `COMPARE_TOLERANCE_DEFAULTS` and the single-defaults literal guard)
- [x] `node --test test/clashtest/support.test.mjs` — 6 pass
- [x] `node --test test/clashtest/util/slicer.test.mjs test/clashtest/util/canonical.test.mjs` — 32 pass (slicer 12 incl. `reset()`, canonical 20)
- [x] `node --test test/clashtest/*.test.mjs test/clashtest/util/*.test.mjs` — 102 pass, 0 fail
- [x] `npm test` — the whole suite still passes with no server and no credentials (the new files are discovered by `scripts/run-tests.mjs`; the `support/` files are not, because they are not `*.test.mjs`)
- [x] `grep -rn "from '.*collision" clashtest/` returns nothing (layering: `clashtest/` imports no `collision/` module)
- [x] `git status --short` shows only the files of the file-structure table (no change to `collision/`, `wwwroot/`, `package.json`)
- [x] `docs/handoffs/latest.md` updated from the verified final state (project CLAUDE.md), listing P0 status and the open items below

Named tests mapped to spec acceptance criteria (P0's share; the rest of each AC is owned by the phase noted):

| Spec AC | P0 evidence (test names) | Remainder owned by |
|---|---|---|
| AC-1 capture at the boundary | `captures a detached deep copy…`, `a getter is never invoked…`, `symbol keys, array holes and extra array keys…`, `a revisited object … is cyclic`, `a throwing proxy trap or a revoked proxy is reported as unreadable…`, `every own key list and every own property descriptor is read exactly once…`, `an object with 100,000 unknown own keys is rejected…`, `caller mutation while the engine is yielded mid-slice…` (slicer seam) | P2 (mutating the caller's object after `startRun`/`saveTest`, store/migration-returned definitions) |
| AC-1 option validation | `no coercion…`, `unknown keys are rejected…`, `every issue is collected…`, `minimum and hard ceiling are enforced for every integer option`, `cross-field: …` | P6/P7 (`startRun`/`rerun` call it) |
| AC-1 golden `sha256:` vectors | `canonical golden: …` (11 vectors: key order, code-unit order, Unicode, control characters, lone surrogates, `-0`, exponent numbers), `SHA-256: FIPS 180-4 vectors`, `pinned digests` | P2 (definition-level vectors: `semanticDigest` invariances, entry permutation, `selectionA`/`selectionB` swap) |
| AC-11 serialization | `non-plain values are not-plain: Map, Set, Date, …`, `anything that is not plain JSON data is a TypeError…`, `canonical JSON parses back…` | P5 (Result Set round trip) |
| AC-12 (a) sliced spans | `spanRecorder receives (label, ms)…`, `a slice yields once the budget elapsed…`, `sortSliced … slices` | P7 (measurement at cap-sized inputs) |
| AC-12 (b) synchronous capture | `node ceiling is charged BEFORE elements are read…` (over-cap arrays cost O(1)) | P7 (wall-clock distribution, G-CAL) |
| §17.1 / §17.1.1 / §13.6 | `options.defaults.test.mjs` (all 12), `producer/reader invariant …` in `options.test.mjs` | — |
| §15.4 tolerance defaults | `COMPARE_TOLERANCE_DEFAULTS (spec 15.4, …)`, `single-defaults rule: no file under clashtest/ except options.js restates a compare-tolerance literal` | P8 (`derive/compare.js` imports them) |

## Implementation status (2026-09-21)

**P0.1–P0.7 IMPLEMENTED and verified on branch `feature/federated-clash-test-core-engine`; P0.8 remains BLOCKED by G-CAL (not started, by design).** P0 is committed as one authorized commit (the per-task "Checkpoint commit" boxes above are ticked as satisfied by that single commit, not eight separate commits). Modules were created from this file's code blocks (RED confirmed by `ERR_MODULE_NOT_FOUND` before each module existed, then GREEN); the P0.4 mutation checks A and B were run and reverted (A: 3 failing tests, B: 3 failing tests, `options.js` byte-identical afterwards). A targeted internal Codex review (`docs/reviews/2026-09-21-federated-clash-test-core-p0-internal-codex-review.md`) led to six accepted hardening fixes in `capture.js` / `options.js` with six new tests; **implemented test counts therefore exceed the plan-time counts above: capture 31, options 20 + defaults 12 = 32, P0 suite 108** (errors 7, support 6, slicer 12, canonical 20 unchanged). No export surface, default value, signature or spec/plan contract changed. The handoff item below is ticked when `docs/handoffs/latest.md` records this state.

## Spec coverage

| Spec § | Content | Task |
|---|---|---|
| §5.3 capture algorithm (descriptor reads, no getter, proxy `unreadable`, sparse arrays, extra keys, cyclic) | detached capture | P0.2 |
| §5.3 validation V1–V6, single-pass issue collection, `InvalidTestDefinitionError` construction | (schema half) | P2 (P0.1 supplies the error) |
| §5.4 digest format, canonical JSON, `digestVersion` | canonical + SHA-256 | P0.7 |
| §13.4 serialization rules (plain data only) | capture rejects; canonical rejects | P0.2, P0.7 |
| §13.6 capture-first ceilings (depth 64, nodes, string/array caps, `schemaVersion` first) | `captureData` options incl. `rootGate` | P0.2 (P5 applies them) |
| §13.6 producer/reader invariant | `assertProducerReaderInvariant` | P0.3, P0.4 |
| §17.1 provisional defaults table | `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS`, drift test | P0.3, P0.4, P0.8 |
| §15.4 `compareResultSets` tolerance defaults (provisional `1e-6`) | `COMPARE_TOLERANCE_DEFAULTS` | P0.3, P0.4 |
| §17.1 calibration gate | `DEFAULTS_STATUS`, G-CAL task | P0.3, P0.8 |
| §17.1.1 ownership, validation rules, ceilings, cross-field | `resolveRunOptions`, `resolveEngineLimits` | P0.3, P0.4 |
| §17.3 slicing (64-item cadence, `sliceBudgetMs`, `aggregationSliceMaxItems`, `spanRecorder`) | slicer | P0.6 |
| §7.3 `interUnitYield` scheduler seam | `makeYieldToScheduler` | P0.6 |
| §18 error catalogue | `errors.js` | P0.1 |
| §18 `RunOptions` / `limits` key lists | option key sets | P0.3, P0.4 |
| §18 `now`, `yieldToScheduler` test seams | fake clock | P0.5 |
| §22 AC-1, AC-11, AC-12 (P0 share) | see the table above | P0.2–P0.7 |

## Gates and open items

**Gates that touch this phase**

| Gate | Blocks in P0 | Does not block |
|---|---|---|
| **G-CAL** | Task **P0.8** only (promoting provisional defaults/ceilings, `BYTES_PER_NODE`, `maxExplicitElementsPerSelection` to calibrated values). | Tasks P0.1–P0.7 and every later phase: all functional work runs on the provisional defaults. |
| G-PLAN | Start of P0 implementation (master §4). | Authoring/review of this file. |

No other master gate (G-OQ4, G-OQ1, G-OQ16, G-OQ17, G-OQ19, G-REMOTE, G-RESP) touches P0.

**Implementation-level items deliberately left to implementers**

1. **Definition-capture node ceiling (P2).** `captureData` needs a `maxNodes`. P2 derives it from the engine limits, e.g. `16 + 2 × (2 + 4 × maxEntriesPerSelection + maxExplicitElementsPerSelection)` (per selection: object + `entries` array + up to four nodes per entry + one node per explicit dbId; plus the seven scalar fields), passes `maxIssues: limits.maxValidationIssues`, `maxStringLength: 4096` (the largest V3 string cap) and `maxArrayLength: max(maxEntriesPerSelection, maxExplicitElementsPerSelection)`, then applies V1–V6 to the copy. Reason: it needs P2's schema.
2. **Unknown-field byte budget (P5 supplies the predicate).** Spec §13.6 caps the running byte count of unknown fields at 64 KiB *during* the traversal, before the offending copy is allocated. `captureData` enforces it through the optional `openFieldBudget: {isOpenPath, maxBytes}` (interface summary; Task P0.2); P5 supplies only `isOpenPath` (its per-type open/closed schema, which P0 cannot know) and `maxBytes: 65_536`, and maps the `unknown-field-bytes` issue to `CorruptResultSetError`. P5 must **not** re-implement the budget on the copy.
3. **Two-ceiling result-set capture (P5).** Spec §13.6 distinguishes "more than `SCHEMA_MAX_NODES` ⇒ `CorruptResultSetError`" from "more than `maxCapturedNodes` ⇒ `ResultSetTooLargeError`". `captureData` has one `maxNodes`. **P5's rule (binding; stated in full in the interface summary):** call it with `maxNodes = limits.maxCapturedNodes` (never above `SCHEMA_MAX_NODES` by the engine-limit ceiling); map `too-many-nodes` to `ResultSetTooLargeError` when `limits.maxCapturedNodes < SCHEMA_MAX_NODES`, and to `CorruptResultSetError` when `limits.maxCapturedNodes === SCHEMA_MAX_NODES`. Both fail closed; the only loss is that a set beyond `SCHEMA_MAX_NODES` read by an engine with a smaller limit reports "too large" instead of "corrupt". P5's `captureDetached` / `softMaxNodes` / `onRootKey` / `unknownFieldByteBudget` spelling is **not** an export of this phase (item 2 above: the 64 KiB unknown-field budget is enforced by `captureData` itself through `openFieldBudget`, not by a P5 pass over the copy).
4. **Which run options are "sizing options" folded into `ledgerDigest` (§17.1.1)** is not enumerated by the spec; P3/P5 decide and record it. P0 exports no such list.
5. **Explicit `undefined` option values are rejected** (`bad-shape`), consistent with "no coercion" and §13.4. Hosts must omit a key rather than pass `undefined`; P6/P7 tests must not pass `{persist: undefined}`.
6. **`animation-frame` in a hidden tab.** `requestAnimationFrame` is paused in background tabs, so an `'animation-frame'` inter-unit yield can stall a run there. The spec only says it "degrades to a macrotask where unavailable"; observing and, if needed, bounding this (e.g. racing a timeout) is a G-CAL/AC-12 characterization item for P6/P7, not designed here.
7. **The byte half of the producer/reader invariant** (`maxCapturedNodes × bytesPerNode ≤ maxStoredResultBytes`) depends only on engine limits, yet spec §13.6 checks it at `startRun`/`rerun`. P0 follows the spec (it lives in `assertProducerReaderInvariant`, called by `resolveRunOptions`). P7 may additionally fail fast at engine construction; that is an optimisation, not a requirement.

**Spec/master items that look contradictory (reported, not resolved by redesign)**

1. **Master Global Constraint "Provisional numbers … inherited from `collision/constants.js`; the engine may not hard-code copies of them" versus the master's layering rule "core imports nothing from `wwwroot/`, the Viewer, `three`, or `collision/` internals".** `collision/constants.js` is not re-exported by `collision/index.js`, and the spec §17.1.1 states the ceilings as literal numbers (20,000 / 5,000 / 8). P0 resolves it without a design change: `options.js` holds the spec's numbers (spec §17.1 is the single source), and the test `hard ceilings that mirror the library are aligned with collision/constants.js` imports the library constants **test-side only** so any drift fails a named test. The controller should confirm this reading of the master constraint.
2. **Spec §18 lists error names but gives typed fields for only about a third of them** (e.g. `ModelKeyVersionConflictError`, `RunQueueFullError`, `AnnotationTooLargeError`, `EnumerationCancelledError` have none stated). P0 inferred the fields marked "(inferred)" in the interface table from usage in §4.2, §6.2, §7.3, §14.5. Later phases must consume them as listed or raise a reconciliation item.
3. **Spec §5.3 says validation and capture are "one uninterruptible pass"; P0 splits capture from schema validation** (design note 1). This preserves every stated observable invariant but is a mechanism change; P2 should implement `validateTest` as `captureData` followed by validation of the copy and must state that in its own phase file.

## Conformance check

Producer-side conformance pass against every consumer's *Phase interface summary* / *Assumed* / *Consumes* block (P2…P8) and `interface-reconciliation.md` (rows N1–N6, N29, N31, N33, OPEN-4). Executed in a scratch directory (`/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/c5075efa-45e0-4c72-8cc2-b290429c87e9/scratchpad/p0p1/`) by extracting every fenced `// clashtest/…` / `// test/clashtest/…` block of this file verbatim and running it under Node v22.23.1 with `collision/` copied from the repo (test-side only). No file under the repo's `clashtest/` or `test/` exists yet, so `npm test` is not run here.

**Commands and results (final state of this file)**

| Command | Result |
|---|---|
| `node --test test/clashtest/errors.test.mjs` | 7 pass, 0 fail |
| `node --test test/clashtest/util/capture.test.mjs` | 29 pass, 0 fail |
| `node --test test/clashtest/options.test.mjs` | 16 pass, 0 fail |
| `node --test test/clashtest/options.defaults.test.mjs` | 12 pass, 0 fail |
| `node --test test/clashtest/support.test.mjs` | 6 pass, 0 fail |
| `node --test test/clashtest/util/slicer.test.mjs test/clashtest/util/canonical.test.mjs` | 32 pass, 0 fail |
| `node --test test/clashtest/*.test.mjs test/clashtest/util/*.test.mjs` | **102 pass, 0 fail** |
| `grep -rn "from '.*collision" clashtest/` | no output (layering holds) |
| Mutation checks on the additions | (a) `distanceTolerance: 1e-5` ⇒ the `COMPARE_TOLERANCE_DEFAULTS` test fails; (b) a `1e-6` literal in a stray `clashtest/derive/compare.js` ⇒ the single-defaults guard fails; (c) reading `frame.src[key]` instead of the descriptor ⇒ the pre-existing accessor test **and** the new `schemaVersion`/`runId` test fail; (d) removing `reset` from the slicer's return ⇒ the `reset()` test fails |

**Added by this pass:** `COMPARE_TOLERANCE_DEFAULTS` (options.js, OPEN-4) with two conformance tests; the precise `captureData` read/ceiling/mapping statement in the interface summary, Gates item 3 and design note 2; three capture tests (accessor on `schemaVersion`/`runId` never invoked, single node ceiling, five-name export surface); `slicer.reset()` with a test; the "not exported" list under `options.js`; the placeholder warning on `createFakeRegistry`.

**Added by the `openFieldBudget` pass:** the optional `openFieldBudget` option, `unknown-field-bytes` in `CAPTURE_CODES`, `nodes`/`openFieldBytes` on failure results, eight capture tests (4 KiB-strings overflow with later elements never read or copied; below-budget copy with exact accounting and inclusive boundary; closed paths never charged and frozen segments; option omitted; no descriptor read or getter after the failure point; key charging; UTF-8 accounting; option validation). Scratch run (`p0b/`): capture 29 pass, whole P0 suite 102 pass, 0 fail; a fuzz of 20,000 random strings shows `openFieldBytes === Buffer.byteLength`; mutation checks (drop the value charge / the key charge / the container charge) each fail the new tests.

**Consumer expectations audit (P0 names)**

Snapshot taken while the other phase files were still being remediated in parallel: a row marked *rejected* records what a consumer expected **when audited**; where that consumer has since been corrected the row is history, and where it has not, **P0's export is the authority** and the consumer changes (never P0, except the rows marked *added*).

| Consumer expectation | Verdict |
|---|---|
| P2 `captureData(root, {maxNodes, maxIssues, maxStringLength, maxArrayLength, rootGate})`, `InvalidTestDefinitionError{issues, issuesTruncated}`, `RevisionConflictError`, `StoreNotConfiguredError`, `CorruptListingError`, `ENGINE_LIMIT_DEFAULTS.{maxValidationIssues, maxEntriesPerSelection, maxExplicitElementsPerSelection, sliceBudgetMs}` | present, signatures as stated |
| P2 code sketches importing `ownKeysOf` / `readOwnValue` / `prototypeIsPlain` from `util/capture.js` (P2.2 and the summary validator) | **rejected** — not exports (N4); read the detached copy from `captureData` |
| P2 `digestSync(text)` (`normalize.js`) | **rejected** — use `digestCanonical(value)` (sync, value-taking) or `sha256Text(text)` (N5) |
| P2 `slicer.checkpoint()` | **rejected** — `slicer.tick(label?)` (N6) |
| P2 `new TestDeletedError(testId)`, `new TestArchivedError(testId)`, `new UnsupportedSchemaVersionError(path)` (positional) | **rejected** — one object argument (N1): `{testId}`, `{testId}`, `{type, schemaVersion, supported}` |
| P3 `EnumerationCancelledError{reason}`, fake clock/world/enumerator, `canonicalJson`, `digestCanonical`, `RUN_OPTION_DEFAULTS` | present |
| P3 `resolveRunOptions(input) => {options, issues}` | **rejected** — returns the frozen resolved options and **throws** `InvalidOptionsError` synchronously; second argument is the resolved engine `limits` (N31) |
| P4 `slicer.reset()` | **added** (was absent) |
| P4 `RUN_OPTION_DEFAULTS.{maxPairsPerOutcome, maxDiagnosticsPerOutcome, maxDistinctReasons, maxRetainedDiagnostics, maxUnitIdsPerDiagnostic}` | present |
| P4 `createFakeWorld({onFindClashes, leases})`, `createFakeEnumerator({throwOn, record, digests, digestsAfterCall})` | **rejected** — not options of P0's doubles; extend with a new `support/<area>.mjs` file (P0 extension rule 2), as P4's own `executionWorld.mjs` already does |
| P5 `captureDetached(value, {softMaxNodes, unknownFieldByteBudget, onRootKey, …})`, `CaptureError{code}` throwing | **rejected** as spelled — P0 exports `captureData` returning `{ok:false, issues, nodes, gate?}` (never throws for data); the mapping is under *The two node ceilings* in the interface summary. **The unknown-field byte budget is provided**, as `openFieldBudget: {isOpenPath(pathSegments), maxBytes}` with issue code `unknown-field-bytes` (interface summary; Task P0.2) |
| P5 `SCHEMA_CEILINGS.{…, maxStringCodeUnits, maxEntriesPerSelection2x}` | **rejected** — see the *Not exported* paragraph under `options.js`; no schema-wide string ceiling exists in the spec |
| P5 `captureResultSet` / P7, P8 `captureResultSet`, `captureDefinition` attributed to `util/capture.js` | **rejected** — not P0's (N29): `captureResultSet` is P5's (`results/validateResultSet.js`), `captureAndValidate` is P2's; a P0 test pins the five-name export surface |
| P5 `UnsupportedSchemaVersionError({runId, observed})`, `IdentityConflictError({modelKey, claimed, offered})` | **rejected** — fields are `{type, schemaVersion, supported}` and `{modelKey, existingVersion, offeredVersion}` (an unknown key is dropped, so `.schemaVersion` / `.existingVersion` would read `null`) |
| P5 `slicer.step()`; P8 `slicer.step()` | **rejected** — `slicer.tick(label?)` (N6) |
| P6 A1–A3, A18 (`resolveRunOptions(input, limits?)`, `createSlicer` shape, `ModelBindingError{reason}`, `create*` doubles) | present |
| P6 `new ModelBindingError('registry-factory-required', '…')`, `new EngineDisposedError('…')` (positional) | **rejected** — `new ModelBindingError({reason, modelKey, message?})`, `new EngineDisposedError({message?})` (N1) |
| P6 O4 (feature-detect `requestAnimationFrame` itself) | **already provided** — `makeYieldToScheduler('animation-frame' \| 'macrotask')` |
| P7 `resolveEngineLimits`, `ENGINE_LIMIT_DEFAULTS`, `RUN_OPTION_DEFAULTS`, `SCHEMA_MAX_NODES`, `BYTES_PER_NODE` | present |
| P7 `nodeCountOf(resultSet)` | **rejected** — `captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes` |
| P7 `new InvalidOptionsError([{path, code}])` (positional) | **rejected** — `new InvalidOptionsError({issues, reason})` |
| P8 `defaultNow`, `defaultYieldToScheduler` from `util/slicer.js` | **rejected** — not exported; `createSlicer` defaults internally, pass `undefined` |
| P8 `new InvalidOptionsError(issues)` (positional, `derive/steps.js`, `derive/facets.js`) | **rejected** — object form (N1) |
| P8 `COMPARE_TOLERANCE_DEFAULTS` in `derive/compare.js` | **now P0's** — import it from `../options.js`; a guard test fails on a restated literal (OPEN-4) |

