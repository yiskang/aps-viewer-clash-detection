# Executor and diagnostics — Phase P4 Implementation Plan

Build the per-unit execution boundary of the Federated Clash Test engine: the closed `ExecutionRequest`/`UnitOutcome` DTO schemas and their untrusting validator, the reference `LocalUnitExecutor` that resolves bindings, checks leases, brackets the unit with scope digests, issues **exactly one** `world.findClashes` call, maps every library signal (resolved or thrown) onto the §7.5 taxonomy, and projects everything to structured-clone-safe plain data before it crosses the port; plus the diagnostics layer — the single `isCompletenessAffecting` predicate, the structural `attributionOf` classifier, the per-unit projection with its two distinct bounding mechanisms (rejection of illegal data, overflow-with-exact-totals for legal high-cardinality data), the exact per-unit taint table, and the cross-unit aggregation into `NormalizedDiagnostic` with exact totals. P4 owns the *per-unit call*; the world coordinator, the retry loop and the ledger that consumes these outcomes are P6.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints in full. Phase-specific constraints, copied verbatim from the spec:

- **"Live `Model` references never escape"** (§7.1). `UnitOutcome` is plain, structured-clone-safe data (§11.2, §12); `ClashPair` carries the live `Model` on each operand and a raw `ClashPair[]` is not structured-cloneable (F4, the tracked M1-gate crash). The projection is the only defence.
- **"`UnitOutcome` is a closed schema — every field is bounded or enumerated (R14-3)"** (§7.1). No field may be added to it; an executor that returns an unknown field produces a malformed outcome.
- **"Two separate mechanisms, never conflated"** (§7.1 H7): *rejection* of illegal data (over-length/non-string `reason`, non-plain diagnostic, unclassifiable shape) ⇒ the whole outcome is `failed:internal-error`; *overflow* of legal data ⇒ detail collapses while **totals stay exact**. "Diagnostics whose every field is legal are never rejected for being many or varied."
- **`isCompletenessAffecting(reason) = (reason !== 'witness-unavailable')`** (§12.3) — one place, fail-safe, "any reason the engine does not recognize … must default to 'may be incomplete', never 'harmless'".
- **"Unattributable diagnostics are never dropped or de-numbered into `dbId: 0`/`-1` sentinels: `dbId` stays `null`"** (§12.2.1). The attribution test is "on *shape*, not on a reason whitelist".
- **"The executor performs the `modelId → modelKey` mapping for diagnostics from the unit's own binding table (F12: `modelId` is not unique) … if two participating models nevertheless report the same `modelId`, the diagnostic's `modelKey` is `null` and it carries `ambiguousModelId: true` — never a guess"** (§11.2).
- **"Always the `targets` shape (never legacy `{model, dbIds}`)"**, `groupBy: 'dbId'`, one mode per call, `clearance` iff `mode === 'clearance'` (§7.2, F1, F10).
- **"After any thrown `ModelEvictedError`, the engine identifies *which* binding died by re-checking leases — never by trusting the error's `modelId`"** (§7.4, F12).
- **Invariant I-scope (§16.3 item 4):** a unit is `evaluated` only if its `scopeProof` is `equal`.
- **`continueOnUnitFailure` is fixed `true`** for the non-fatal rows of §7.5 (§7.5 closing note).

---

## Phase interface summary

Every exported name P4 produces. Other phases consume exactly these; internal helpers not listed here are private to their module.

### `clashtest/execution/UnitExecutor.js` — port contract and closed DTO schemas

| Export | Signature | Meaning |
|---|---|---|
| `EXECUTION_MODES` | `readonly string[]` | `['volume-overlap','surface-intersection','containment','clearance']` (§7.1, F1). |
| `UNIT_OUTCOME_KINDS` | `readonly string[]` | `['evaluated','failed','skipped','discarded']` (§11.2). |
| `SCOPE_PROOF_VALUES` | `readonly string[]` | `['equal','drift','unverifiable','not-checked']` (§11.2, §16.3.2). |
| `UNIT_CAUSES` | `readonly string[]` | The exhaustive §8.3 unit-cause enum; `failure.code` must be a member. |
| `LIBRARY_CAPACITY_KINDS` | `readonly string[]` | `CapacityExceededError.kind` set (F8). |
| `LIBRARY_STATISTICS_KEYS` | `readonly string[]` | The 23 numeric keys of the library's `statistics` minus `diagnostics` (§12.6); unknown key ⇒ malformed. |
| `EVIDENCE_KEYS_BY_MODE` | `Record<mode, readonly string[]>` | Per-mode legal pair evidence keys (§11.1/§11.2 library orientation). |
| `MAX_NESTED_STRING_CODE_UNITS` | `128` | Every nested string in a `UnitOutcome`, incl. diagnostic `reason` and `failure.errorName` (§7.1). |
| `MAX_FAILURE_MESSAGE_CODE_UNITS` | `512` | `failure.message` (§7.1). |
| `validateExecutionRequest(request)` | `(object) => {ok: boolean, issues: Issue[]}` | Pure. Closed-schema check of §7.1's `ExecutionRequest` (incl. `limits`); used by the executor at entry and by P6 before issue. |
| `validateUnitOutcome(request, outcome, opts?)` | `(ExecutionRequest, object, {isLegalOwner?}?) => {ok: boolean, issues: Issue[]}` | Pure, **never throws**, **synchronous**. The result is **always exactly those two fields** (`ok:true` still carries `issues: []`) — reconciliation row **N8**, which P6's assumption A10 is written against; nothing else may be added to it. The engine's untrusting boundary check of §7.1; `ok:false` ⇒ P6 substitutes `internalErrorOutcome(request, issues)` and fails the run. The optional third argument carries the owner-scope oracle `isLegalOwner({modelKey, dbId, side}) => boolean`, which P6 builds over P3's `ownerClassOf` / `rootOfOwner`; **omitted ⇒ the owner-scope checks are skipped**, so P6 supplies it (Task P4.5). |
| `internalErrorOutcome(request, issues)` | `(ExecutionRequest, Issue[]) => UnitOutcome` | Canonical `failed:internal-error` outcome, **synchronous**. P6 substitutes it for a rejected outcome; the reference executor uses it for its own malformed-request and projection failures. |

`Issue = {code: string, path: string, detail: string}` — `detail` is truncated to `MAX_FAILURE_MESSAGE_CODE_UNITS`.

### `clashtest/execution/diagnostics.js` — the two diagnostic DTOs and their transforms

| Export | Signature | Meaning |
|---|---|---|
| `KNOWN_DIAGNOSTIC_REASONS` | `ReadonlySet<string>` | The 20 reason literals verified in `collision/` (§12.3). Informative; the predicate is normative. |
| `NON_COMPLETENESS_AFFECTING_REASONS` | `ReadonlySet<string>` | Exactly `{'witness-unavailable'}` (§12.3, README M2.1). |
| `isCompletenessAffecting(reason)` | `(unknown) => boolean` | The ONE predicate. `true` for every value except the literal `'witness-unavailable'`. |
| `attributionOf(projected)` | `(ProjectedDiagnostic) => 'element'\|'target-model'\|'unit'` | Structural classifier of §12.2.1; never a reason whitelist. |
| `createUnitBindingTable(entries)` | `(Array<{modelKey, modelId}>) => UnitBindingTable` | Builds the unit's `modelId → modelKey` map; a `modelId` claimed by ≥ 2 participants resolves ambiguous (§11.2, F12). |
| `projectDiagnostic(raw, table)` | `(unknown, UnitBindingTable) => {ok: true, diagnostic: ProjectedDiagnostic} \| {ok: false, issue: Issue}` | One library diagnostic → one `ProjectedDiagnostic`; drops `modelId` (F4 clone safety), rejects illegal data. |
| `projectDiagnostics(raw, opts)` | `(unknown, {table, limits, slicer}) => Promise<ProjectionResult>` | Whole-array projection with §7.1's O(1) overflow marker; `ProjectionResult = {ok, diagnostics, diagnosticOverflowLength?, issue?}`. |
| `projectStatistics(raw)` | `(unknown) => {ok: true, statistics: Record<string,number>} \| {ok: false, issue: Issue}` | Closed numeric schema (§12.6). |
| `deriveUnitTaints(diagnostics, opts)` | `(ProjectedDiagnostic[], {maxElementTaintsPerUnit, admit}) => {taints: TaintEntry[], overflowed: boolean}` | The exact per-unit taint table of §12.2.1, before any de-duplication. `admit(n) => boolean` is the ledger-budget oracle **injected by P6 from P3's `createRecordBudget(limits)` / `createLedger({limits, budget})`** (reconciliation row N9): P6 passes a closure asking the run's live ledger whether `n` more records fit, so P4 never owns budget state and P3 never learns about diagnostics. Omitted ⇒ defaults to `() => true` (what P4's own unit tests use). |
| `TAINT_OVERFLOW_REASON` | `'taint-overflow'` | Reserved unit-taint reason the collapse uses (§12.2.1). |
| `createDiagnosticAggregator(opts)` | `({maxRetainedDiagnostics, maxDistinctReasons, maxUnitIdsPerDiagnostic, slicer}) => DiagnosticAggregator` | Cross-unit de-duplication and exact accounting (§12.4). **`addUnit` is asynchronous; `snapshot()` is synchronous.** **Amendment 2026-10-07 (owner-authorized Option D; see N20):** the aggregator also exposes synchronous `counters() → {total, completenessAffectingCount, unclassifiedOccurrences}` — exact running totals, O(`maxDistinctReasons`), no sort/copy of the retained set, same Σ-invariant check as `snapshot()`; P6 reads it for per-unit progress and calls `snapshot()` once at seal. |
| `createStatisticsAccumulator()` | `() => {add(statistics, durationMs), snapshot()}` | §12.6 passthrough: per-key sums plus `libraryMsTotal` / `maxUnitMs`. **Both methods synchronous.** |

```text
TaintEntry =
  | {kind: 'element',      modelKey: string, dbId: number, reason: string, occurrences: number}
  | {kind: 'target-model', modelKey: string | null, reason: string, occurrences: number}
  | {kind: 'unit',         modelKey: string | null, reason: string, occurrences: number}

DiagnosticAggregator {
  addUnit(unitId, outcome) → Promise<{unitTaints: TaintEntry[]}>   // extra unit-wide taints this unit earned
                                                                   // (diagnostic-overflow / diagnostic-reason-overflow)
  snapshot() → DiagnosticsSummary
}

DiagnosticsSummary = {
  diagnostics: NormalizedDiagnostic[],   // canonical order, ≤ maxRetainedDiagnostics
  truncated: boolean,
  total: number,                         // EXACT, never capped
  completenessAffectingCount: number,    // EXACT over EXAMINED diagnostics
  unclassifiedOccurrences: number,       // EXACT count of received-but-unexamined
  completenessAffectingUpperBound: number,          // = completenessAffectingCount + unclassifiedOccurrences
  countsByReason: Array<{scope, reason, count}>,    // ≤ maxDistinctReasons keys, plan-order admission
  omittedReasonOccurrences: number,
  geometryReadinessOccurrences: number,
}
```

**Diagnostic-aggregation ownership and synchrony (duplicate-ownership D3, RESOLVED; rows N9, N20).** `execution/diagnostics.js` is the **single home of all diagnostic aggregation** — the per-unit taint table, the cross-unit de-duplication, `maxDistinctReasons` and `omittedReasonOccurrences`. **P5 consumes a finished `DiagnosticsSummary` from `snapshot()` and aggregates nothing**; **P6 drives** the aggregator (one per run, `await addUnit(unitId, outcome)` per settled unit, `snapshot()` once at seal) and injects the `admit(n)` ledger-budget oracle of `deriveUnitTaints` (row N9). There is **no** `aggregateDiagnostics` / `readDiagnostics` free-function pair — those names exist in no module (row N20). The consumer-visible synchrony of every export in this module, fixed:

| Asynchronous (returns a `Promise`) | Synchronous (returns a value) |
|---|---|
| `projectDiagnostics(raw, {table, limits, slicer})`, `aggregator.addUnit(unitId, outcome)` | `isCompletenessAffecting`, `attributionOf`, `createUnitBindingTable`, `projectDiagnostic`, `projectStatistics`, `deriveUnitTaints`, `aggregator.snapshot()`, `createStatisticsAccumulator()` and both its methods |

No signature in this table may change without a reconciliation-register update: P6 awaits exactly `addUnit`, reads `counters()` per unit (added 2026-10-07, N20 amendment) and P5 reads exactly `snapshot()`'s result.

### `clashtest/execution/LocalUnitExecutor.js` — the reference executor (§7.2, §7.4, §7.5)

| Export | Signature | Meaning |
|---|---|---|
| `createLocalUnitExecutor(deps)` | `({world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs}) => UnitExecutor` | `UnitExecutor = (ExecutionRequest) => Promise<UnitOutcome>` (§7.1). |
| `buildFindClashesQuery(request, resolved)` | `(ExecutionRequest, ResolvedBindings) => object` | The exact §7.2 query object. Exported so P7's differential suite can assert call shape without a fake world. |
| `classifyLibraryError(error, ctx)` | `(unknown, {placementGenerationChanged, deadModelKeys, participants}) => {outcome, failure}` | The §7.5 taxonomy, matched on `error.name` + the pinned linear-ceiling message matcher. |
| `LINEAR_CEILING_MESSAGE_PREFIX` | `'findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs'` | The pinned matcher of §7.2; guarded by a T2 compatibility test. |
| `projectPairs(rawPairs, opts)` | `(unknown, {mode, clearance, limits, table}) => {ok, pairs, pairsOverflowLength?, issue?}` | Library-orientation pair projection; drops `model`/`modelId`, enforces `maxPairsPerOutcome` with the O(1) marker. |

`ResolvedBindings = {byKey: Map<string, Binding>, table: UnitBindingTable, sourceBinding: Binding, targetEntries: Array<{modelKey, binding, scope, dbIds?}>}` — internal to the executor except as an argument to `buildFindClashesQuery`.

---

## File structure

| Path | Create/Modify | Responsibility |
|---|---|---|
| `clashtest/execution/diagnostics.js` | Create | Reason table, `isCompletenessAffecting`, `attributionOf`, binding table, per-diagnostic and per-array projection, statistics projection, per-unit taints, cross-unit aggregator, statistics accumulator. |
| `clashtest/execution/UnitExecutor.js` | Create | Port JSDoc, the closed enums/limits constants, `validateExecutionRequest`, `validateUnitOutcome`, `internalErrorOutcome`. |
| `clashtest/execution/LocalUnitExecutor.js` | Create | Binding/lease resolution, bracketed scope-digest protocol, the one `findClashes` call, error taxonomy, pair projection, outcome assembly. |
| `test/clashtest/execution/diagnostics.predicate.test.mjs` | Create | §12.3 table-driven predicate + the `collision/` reason drift test. |
| `test/clashtest/execution/diagnostics.projection.test.mjs` | Create | `attributionOf`, `projectDiagnostic`, binding table, `dbId:null`, ambiguous `modelId`, clone safety. |
| `test/clashtest/execution/diagnostics.overflow.test.mjs` | Create | §7.1 H7.2 overflow paths and exact-total invariants. |
| `test/clashtest/execution/diagnostics.taints.test.mjs` | Create | §12.2.1 per-unit taint table and its two collapse triggers. |
| `test/clashtest/execution/diagnostics.aggregate.test.mjs` | Create | §12.4 cross-unit de-duplication, caps, `countsByReason`, §12.6 statistics. |
| `test/clashtest/execution/unitOutcome.validate.test.mjs` | Create | The full AC-3 rejection battery. |
| `test/clashtest/execution/localExecutor.call.test.mjs` | Create | §7.2 call construction + pair projection + F4 structured-clone safety (fake world). |
| `test/clashtest/execution/localExecutor.realWorld.test.mjs` | Create | **T2**: the executor over a real `CollisionWorld` + `buildMockModel` fixtures — real diagnostics, real pairs, real linear-ceiling error, statistics-key drift. |
| `test/clashtest/execution/localExecutor.errors.test.mjs` | Create | Every §7.5 taxonomy row (fake world throwing each signal). |
| `test/clashtest/execution/localExecutor.scope.test.mjs` | Create | §7.4 lease handling + §16.3.2 bracketed digest protocol. |
| `test/clashtest/support/executionWorld.mjs` | Create (additive) | `createExecutionWorld({defaultResult?})` — P0's `createFakeWorld` (recording/scripting `findClashes`) composed with P1's `makeLeaseWorld` (`admitModel` / `isLeaseValid` / `evictModel` / `invalidateModelPlacement` / `dispose`), because no single shipped fake has both surfaces. **The composition passes P0's fake-world surface through verbatim — `calls`, `script`, **`hold`**, `inFlight`, `maxInFlight`, `disposed`, `findClashes` — and adds P1's lease methods; it never re-implements or narrows one.** `hold()` in particular is load-bearing outside this phase: P7 Task P7.5's four disposal *signal-then-wait* tests park an in-flight `findClashes` through `createExecutionWorld().hold()`, so dropping it from the composition would fail P7, not P4. Appended to `support/index.mjs`. **P0's and P1's own support files are not edited** — P0's extension rule (2) and master §2.1 rule 5 require a new file. |
| `test/clashtest/support/executionRequests.mjs` | Create (additive) | `makeRequest(over)` — a valid `ExecutionRequest` over the two-model fixture, where the shorthand keys `sourceDbIds` / `targets` / `scopeExpect` merge into `materialized` — and `makeExecutorDeps(over) → {world, registry, enumerator, models, now, yieldToScheduler, sliceBudgetMs}` (`models` = `modelKey → model`), wiring P1's real `createModelRegistry({world})` over the composed world and P0's `createFakeEnumerator` / `createFakeClock`. `over.world` / `over.models` inject a **real** `CollisionWorld` and real models, which is how the T2 tests reuse the same builder. |
| `test/clashtest/support/realWorldFixture.mjs` | Create (additive) | `makeTwoModelFixture` / `box` for the T2 tests, copied from the collision test tree rather than imported across it. **Distinct from P7's `support/realWorld.mjs` by construction, not by oversight** (checked against the reconciliation's duplicate-ownership decisions D1–D4 on 2026-09-21): both mirror `test/CollisionWorld.findClashes.crossModel.test.mjs`, but P4 ships **before** P7, so it cannot import P7's file, and P0's support extension rule 2 forbids P7 from editing this one. The two therefore cannot be merged without relaxing that rule. They also carry different obligations — this one builds two models for the *executor*, P7's builds N models plus an enumerator, a registry and the AC-17/18/19/21 seams for the *assembled engine* — and **no invariant depends on the two agreeing**: neither is an oracle for the other, and each phase's T2 arms prove only their own claims about the real library. D1–D4 govern duplicate implementations of a **normative production rule**; this is neither. |

---

### Task P4.1: The completeness predicate and the known-reason drift guard

The one place §12.3 allows. Nothing else in the engine may decide whether a diagnostic affects completeness.

**Files**
- Create: `clashtest/execution/diagnostics.js`
- Test: `test/clashtest/execution/diagnostics.predicate.test.mjs`

**Interfaces**
- Consumes: nothing. (Deliberate: the predicate has no dependency so no later module can be tempted to reimplement it behind an option.)
- Produces: `KNOWN_DIAGNOSTIC_REASONS`, `NON_COMPLETENESS_AFFECTING_REASONS`, `isCompletenessAffecting(reason) → boolean`.

- [ ] **Step 1: Write the failing predicate test.**

```js
// test/clashtest/execution/diagnostics.predicate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCompletenessAffecting, KNOWN_DIAGNOSTIC_REASONS, NON_COMPLETENESS_AFFECTING_REASONS,
} from '../../../clashtest/execution/diagnostics.js';

test('exactly one known reason is non-completeness-affecting', () => {
  assert.deepEqual([...NON_COMPLETENESS_AFFECTING_REASONS], ['witness-unavailable']);
  for (const reason of KNOWN_DIAGNOSTIC_REASONS) {
    assert.equal(isCompletenessAffecting(reason), reason !== 'witness-unavailable', reason);
  }
});

test('all four clearance reasons count (the M2.1 carve-out does not transfer)', () => {
  for (const reason of ['clearance-invalid-transform', 'clearance-anisotropic-scale-unsupported',
    'clearance-hard-clash-precheck-inconclusive', 'clearance-distance-unavailable']) {
    assert.equal(isCompletenessAffecting(reason), true);
    assert.ok(KNOWN_DIAGNOSTIC_REASONS.has(reason));
  }
});

test('an unknown or non-string reason fails safe to true and never throws', () => {
  for (const reason of ['a-future-library-reason', '', 'witness-unavailable ', 'WITNESS-UNAVAILABLE',
    undefined, null, 0, {}, [], Symbol.iterator]) {
    assert.equal(isCompletenessAffecting(reason), true);
  }
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/diagnostics.predicate.test.mjs` → `ERR_MODULE_NOT_FOUND` for `clashtest/execution/diagnostics.js`. (3 tests, all failing.)

- [ ] **Step 3: Implement the predicate and the table.**

```js
// clashtest/execution/diagnostics.js
/**
 * The ONE completeness predicate (spec §12.3). `witness-unavailable` is the library's single
 * documented carve-out (README M2.1: the volume-overlap verdict is settled before witness capture).
 * EVERYTHING else — including every clearance reason and every reason this table does not know —
 * counts, because a future library diagnostic must default to "may be incomplete".
 */
export const NON_COMPLETENESS_AFFECTING_REASONS = Object.freeze(new Set(['witness-unavailable']));

/**
 * Informative, NOT normative (§12.3). Verified as `reason:` literals in `collision/` at the time of
 * writing; the drift test below fails when `collision/` gains one this table lacks, so a new reason
 * is CONSCIOUSLY classified rather than silently defaulted.
 */
export const KNOWN_DIAGNOSTIC_REASONS = Object.freeze(new Set([
  'fragment-not-loaded', 'fragment-owner-unresolvable', 'geometry-not-yet-available',
  'unsupported-geometry-layout', 'rejected-primitive-range', 'geometry-too-large-for-sync-build',
  'geometry-aspect-ratio-exceeds-tolerance-model', 'index-references-invalid-vertex',
  'crossing-budget-exhausted', 'inconclusive-crossing', 'inconclusive-containment',
  'incomplete-component-coverage', 'non-manifold-component', 'unverified-open-component',
  'unverified-parity-operand', 'clearance-invalid-transform',
  'clearance-anisotropic-scale-unsupported', 'clearance-hard-clash-precheck-inconclusive',
  'clearance-distance-unavailable', 'witness-unavailable',
]));

export function isCompletenessAffecting(reason) {
  return !NON_COMPLETENESS_AFFECTING_REASONS.has(reason);
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/diagnostics.predicate.test.mjs` → 3 passing.

- [ ] **Step 5: Write the failing drift test.** Append to the same file. It is a *source scan*, not an import — the engine core must not import `collision/`.

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLLISION_DIR = fileURLToPath(new URL('../../../collision/', import.meta.url));
function* jsFilesUnder(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsFilesUnder(full);
    else if (entry.endsWith('.js')) yield full;
  }
}

test('collision/ gains no reason literal the known-reason table lacks (AC-10 drift guard)', () => {
  // Matches a `reason: 'literal'` property in library source. A computed `reason: d.reason`
  // forwards an already-listed literal and is deliberately not matched.
  const found = new Set();
  for (const file of jsFilesUnder(COLLISION_DIR)) {
    for (const [, , lit] of readFileSync(file, 'utf8').matchAll(/\breason:\s*(['"])([a-z0-9-]+)\1/g)) found.add(lit);
  }
  // CapacityExceededError `kind`s share the property name but are not diagnostics.
  for (const kind of ['bucket-capacity', 'call-wide-unique-fragment-precheck',
    'whole-model-enumeration', 'tlas-candidate-budget', 'clearance-narrow-phase-budget']) found.delete(kind);
  assert.ok(found.size >= 15, `the scan found only ${found.size} literals — the matcher is broken`);
  assert.deepEqual([...found].filter((r) => !KNOWN_DIAGNOSTIC_REASONS.has(r)).sort(), [],
    'classify each new reason in KNOWN_DIAGNOSTIC_REASONS deliberately');
});
```

- [ ] **Step 6: Run the drift test and confirm it passes against today's `collision/`.** → 4 passing. If the list is non-empty the table above is wrong and must be corrected (not the assertion relaxed).

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs: P4.1 completeness predicate + reason drift guard`.

---

### Task P4.2: Unit binding table, attribution, and single-diagnostic projection

Turns one raw library diagnostic into one `ProjectedDiagnostic` — the point at which `modelId` (which may be a **live `Model` object**, see below) is replaced by a durable `modelKey` and never copied forward.

**Files**
- Modify: `clashtest/execution/diagnostics.js`
- Test: `test/clashtest/execution/diagnostics.projection.test.mjs`

**Interfaces**
- Consumes: **Assumed (P1 `identity/ModelRegistry.js`)** — `Binding = {modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration}` and `registry.bindingFor(modelKey) → Binding | null` (spec §4.3). P4 reads only `binding.modelKey` and `binding.model`.
- Produces: `createUnitBindingTable(entries)`, `attributionOf(projected)`, `projectDiagnostic(raw, table)`.

**Library shapes this task is grounded in** (read from `collision/CollisionWorld.js` and `collision/viewer/ViewerModelAdapter.js`, not from the spec):

| Library emission | Shape |
|---|---|
| fragment scope (`diagnoseFragmentOnce`, clearance admission) | `{scope:'fragment', reason, role, fragment:{modelId, dbId, fragId}}` |
| fragment scope, whole-model target (`extractAllFragments`) | `{scope:'fragment', reason, role:'target', fragment:{modelId, dbId: null, fragId}}` |
| pair scope (`attach`, clearance precheck/abort, `witness-unavailable`) | `{scope:'pair', reason, role?, sourceFragment:{…}, targetFragment:{…}}` |

`modelIdOf(model) = model && model.id !== undefined ? model.id : model` — so for a Model object with no `.id`, **`fragment.modelId` is the live `Model` itself**. Copying it forward would reproduce the F4 crash inside a diagnostic; the projection must resolve it to a `modelKey` and drop the original.

- [ ] **Step 1: Write the failing binding-table / attribution test.**

```js
// test/clashtest/execution/diagnostics.projection.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUnitBindingTable, projectDiagnostic, attributionOf,
} from '../../../clashtest/execution/diagnostics.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }, { modelKey: 'mk-b', modelId: 2 }]);
const frag = (reason, fragment, role) => ({ scope: 'fragment', reason, role, fragment });

test('fragment diagnostic with a numeric dbId projects to element attribution', () => {
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 1, dbId: 42, fragId: 7 }, 'source'), table);
  assert.equal(r.ok, true);
  assert.deepEqual(r.diagnostic, {
    scope: 'fragment', reason: 'geometry-not-yet-available', completenessAffecting: true,
    attribution: 'element', fragment: { modelKey: 'mk-a', dbId: 42, fragId: 7, role: 'source' },
  });
  assert.equal('modelId' in r.diagnostic.fragment, false, 'modelId must never survive projection');
});

test('a whole-model-target dbId:null diagnostic keeps null and becomes target-model', () => {
  const r = projectDiagnostic(frag('fragment-not-loaded', { modelId: 2, dbId: null, fragId: 9 }, 'target'), table);
  assert.equal(r.diagnostic.fragment.dbId, null, 'never a 0/-1 sentinel');
  assert.equal(r.diagnostic.attribution, 'target-model');
  assert.equal(attributionOf(r.diagnostic), 'target-model');
});

test('a dbId:null SOURCE-role fragment degrades to unit attribution', () => {
  const r = projectDiagnostic(frag('fragment-owner-unresolvable', { modelId: 1, dbId: null, fragId: 3 }, 'source'), table);
  assert.equal(r.diagnostic.attribution, 'unit');
});

test('a non-numeric, non-null dbId normalizes to null and degrades to unit (legal, unpinnable)', () => {
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 1, dbId: '42', fragId: 1 }, 'target'), table);
  assert.equal(r.ok, true);
  assert.equal(r.diagnostic.fragment.dbId, null, 'never coerced');
  assert.equal(r.diagnostic.attribution, 'unit');
});

test('an ambiguous modelId yields modelKey null + ambiguousModelId + unit attribution', () => {
  const ambiguous = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 7 }, { modelKey: 'mk-b', modelId: 7 }]);
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 7, dbId: 11, fragId: 1 }, 'target'), ambiguous);
  assert.equal(r.diagnostic.fragment.modelKey, null);
  assert.equal(r.diagnostic.ambiguousModelId, true);
  assert.equal(r.diagnostic.attribution, 'unit', 'never a guess');
});

test('a live Model object as modelId is resolved by identity and never copied', () => {
  const liveModel = { getFragmentList() { return {}; } };
  liveModel.self = liveModel; // circular, exactly like the F4 window reference
  const t = createUnitBindingTable([{ modelKey: 'mk-a', modelId: liveModel }]);
  const r = projectDiagnostic(frag('rejected-primitive-range', { modelId: liveModel, dbId: 5, fragId: 2 }, 'source'), t);
  assert.equal(r.diagnostic.fragment.modelKey, 'mk-a');
  assert.doesNotThrow(() => structuredClone(r.diagnostic));
});

test('pair scope maps sourceFragment/targetFragment to canonical first/second', () => {
  const r = projectDiagnostic({ scope: 'pair', reason: 'witness-unavailable',
    sourceFragment: { modelId: 2, dbId: 30, fragId: 4 }, targetFragment: { modelId: 1, dbId: 20, fragId: 8 } }, table);
  assert.equal(r.diagnostic.completenessAffecting, false);
  assert.deepEqual(r.diagnostic.fragments.first, { modelKey: 'mk-a', dbId: 20, fragId: 8 });
  assert.deepEqual(r.diagnostic.fragments.second, { modelKey: 'mk-b', dbId: 30, fragId: 4 });
  assert.equal(r.diagnostic.attribution, 'element');
});

test('illegal diagnostics are REJECTED, not degraded', () => {
  const ok = { modelId: 1, dbId: 1, fragId: 1 };
  for (const [label, raw] of [
    ['over-length reason', frag('x'.repeat(129), ok)],
    ['10 KB reason', frag('y'.repeat(10_240), ok)],
    ['non-string reason', frag(12, ok)],
    ['non-plain diagnostic', new Map([['scope', 'fragment']])],
    ['unknown scope', { scope: 'model', reason: 'x', fragment: ok }],
    ['non-finite fragId', frag('x', { modelId: 1, dbId: 1, fragId: NaN })],
  ]) {
    const r = projectDiagnostic(raw, table);
    assert.equal(r.ok, false, label);
    assert.ok(r.issue.code.length > 0 && r.issue.detail.length <= 512, label);
  }
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/diagnostics.projection.test.mjs` → every test fails with `createUnitBindingTable is not a function`.

- [ ] **Step 3: Implement the binding table, attribution and single-diagnostic projection.**

```js
const AMBIGUOUS = Symbol('ambiguous-modelId');
const MAX_NESTED_STRING_CODE_UNITS = 128;

/**
 * F12: the library's diagnostic `modelId` is NOT unique. Within one unit every participating model
 * is simultaneously live and should be distinct; if two nevertheless claim the same modelId we
 * refuse to guess (§11.2). `modelId` may also be the live Model OBJECT itself
 * (`modelIdOf(model) = model.id ?? model`), so the map is keyed by value/identity, not by string.
 */
export function createUnitBindingTable(entries) {
  const byModelId = new Map();
  for (const { modelKey, modelId } of entries) {
    byModelId.set(modelId, byModelId.has(modelId) && byModelId.get(modelId) !== modelKey
      ? AMBIGUOUS : modelKey);
  }
  const participants = Object.freeze([...new Set(entries.map((e) => e.modelKey))].sort());
  return Object.freeze({
    participants,
    resolve(modelId) {
      const hit = byModelId.get(modelId);
      if (hit === undefined) return { modelKey: null, ambiguous: false }; // not a participant
      if (hit === AMBIGUOUS) return { modelKey: null, ambiguous: true };
      return { modelKey: hit, ambiguous: false };
    },
  });
}

const issue = (code, path, detail) => ({ ok: false, issue: { code, path, detail: String(detail).slice(0, 512) } });
const isPlainObject = (v) => v !== null && typeof v === 'object'
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function projectOperand(raw, table, path) {
  if (!isPlainObject(raw)) return issue('diagnostic-operand-not-plain', path, 'not a plain object');
  if (!Number.isSafeInteger(raw.fragId) || raw.fragId < 0) return issue('diagnostic-fragid-invalid', `${path}.fragId`, raw.fragId);
  const { modelKey, ambiguous } = table.resolve(raw.modelId);
  // `dbId` is EITHER a non-negative safe integer OR null. Anything else is the attribution table's
  // "anything else" row: legal to receive, impossible to pin down, so it normalizes to null and the
  // diagnostic degrades to `unit` — never coerced, never a 0/-1 sentinel (§12.2.1).
  const dbId = Number.isSafeInteger(raw.dbId) && raw.dbId >= 0 ? raw.dbId : null;
  return { ok: true, operand: { modelKey, dbId, fragId: raw.fragId }, ambiguous };
}

/** Element order (§4.4), with an unresolved modelKey sorting last so it can never alias a real key. */
function operandOrder(a, b) {
  const ka = a.modelKey ?? '￿';
  const kb = b.modelKey ?? '￿';
  return ka !== kb ? (ka < kb ? -1 : 1) : a.fragId - b.fragId;
}

export function attributionOf(projected) {
  const operands = projected.scope === 'pair'
    ? [projected.fragments.first, projected.fragments.second]
    : [projected.fragment];
  if (operands.every((o) => typeof o.dbId === 'number' && o.modelKey !== null)) return 'element';
  if (projected.scope === 'fragment' && projected.fragment.role === 'target'
      && projected.fragment.dbId === null && projected.fragment.modelKey !== null) {
    return 'target-model';
  }
  return 'unit';
}

export function projectDiagnostic(raw, table) {
  if (!isPlainObject(raw)) return issue('diagnostic-not-plain', '', 'not a plain object');
  if (typeof raw.reason !== 'string') return issue('diagnostic-reason-not-string', 'reason', typeof raw.reason);
  if (raw.reason.length > MAX_NESTED_STRING_CODE_UNITS) return issue('diagnostic-reason-too-long', 'reason', raw.reason.length);
  const base = { scope: raw.scope, reason: raw.reason, completenessAffecting: isCompletenessAffecting(raw.reason) };
  let projected;
  let ambiguous = false;
  if (raw.scope === 'fragment') {
    const r = projectOperand(raw.fragment, table, 'fragment');
    if (r.ok === false) return r;
    ambiguous = r.ambiguous;
    const role = raw.role === 'source' || raw.role === 'target' ? { role: raw.role } : {};
    projected = { ...base, fragment: { ...r.operand, ...role } };
  } else if (raw.scope === 'pair') {
    const s = projectOperand(raw.sourceFragment, table, 'sourceFragment');
    if (s.ok === false) return s;
    const t = projectOperand(raw.targetFragment, table, 'targetFragment');
    if (t.ok === false) return t;
    ambiguous = s.ambiguous || t.ambiguous;
    // Canonicalized so §12.4's cross-unit dedup key ("canonical pair of (modelKey, fragId)") does not
    // depend on which side the library called source. The library's top-level pair `role` is
    // DROPPED: ProjectedDiagnostic is closed, and first/second already identify both operands.
    const [first, second] = [s.operand, t.operand].sort(operandOrder);
    projected = { ...base, fragments: { first, second } };
  } else {
    return issue('diagnostic-scope-unknown', 'scope', raw.scope);
  }
  projected.attribution = attributionOf(projected);
  if (ambiguous) projected.ambiguousModelId = true;
  return { ok: true, diagnostic: projected };
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/diagnostics.projection.test.mjs` → 8 passing.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P4.2 diagnostic projection and attribution`.

---

### Task P4.3: Whole-array projection with the two bounding mechanisms

§7.1 H7's rejection/overflow split, enforced *while projecting*, so an oversized array never crosses the port.

**Files**
- Modify: `clashtest/execution/diagnostics.js`
- Test: `test/clashtest/execution/diagnostics.overflow.test.mjs`

**Interfaces**
- Consumes (**P0 `util/slicer.js`** — reconciliation row **N6**, P0's summary verbatim): `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery?, spanRecorder?, afterYield?}) → {tick(label?), yieldNow(label?), forEach(list, fn, {label?}), sortSliced(list, compare, {label?}), stats()}`. `tick()` returns `undefined` when no yield is due and a `Promise` when one is: `const p = slicer.tick('x'); if (p) await p;`. **There is no `reset()`** — P0 ships **one slicer per sliced operation**, so the executor creates a fresh slicer per unit (P4.6) and `projectDiagnostics` never resets the one it is handed. The names `step()`, `checkpoint()` and `runSliced()` belong to no slicer (N6); `checkpoint()` is P3's `EnumerationContext`, a different object.
- Consumes (**P0 `options.js`**): `RUN_OPTION_DEFAULTS.maxPairsPerOutcome / .maxDiagnosticsPerOutcome / .maxDistinctReasons` (row N33 — no divergence; never hard-coded here).
- Produces: `projectDiagnostics(raw, {table, limits, slicer})`, `projectStatistics(raw)`.

**Binding decision recorded here (see Gates and open items, item 1).** The executor applies **only** the two whole-array caps of §7.1 (`maxPairsPerOutcome`, `maxDiagnosticsPerOutcome`). It does **not** thin by `maxDistinctReasons`, because (a) `UnitOutcome` is a closed schema (§11.2) with no `omittedReasonOccurrences` field to carry what thinning would discard, and (b) §11.2 requires the executor to return "each unit's diagnostics **before** any de-duplication so the engine can build the per-unit `taints` table" — a reason-thinned array cannot produce an exact taint table. `maxDistinctReasons` is therefore applied by the engine-side aggregator (P4.9) and by the per-unit retention it performs there.

- [ ] **Step 1: Write the failing overflow test.**

```js
// test/clashtest/execution/diagnostics.overflow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectDiagnostics, projectStatistics, createUnitBindingTable } from '../../../clashtest/execution/diagnostics.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }]);
const slicer = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {}, sliceBudgetMs: 4 });
const frag = (reason, fragId) => ({ scope: 'fragment', reason, role: 'target', fragment: { modelId: 1, dbId: fragId, fragId } });
const project = (raw, maxDiagnosticsPerOutcome, s = slicer()) =>
  projectDiagnostics(raw, { table, limits: { maxDiagnosticsPerOutcome }, slicer: s });

test('an oversized array is NOT iterated; only its length crosses the port', async () => {
  let reads = 0;
  const spied = new Proxy(new Array(300_000).fill(null).map((_, i) => frag('geometry-not-yet-available', i)), {
    get(t, p, r) { if (typeof p === 'string' && /^\d+$/.test(p)) reads++; return Reflect.get(t, p, r); },
  });
  const out = await project(spied, 20_000);
  assert.equal(out.ok, true);
  assert.deepEqual(out.diagnostics, []);
  assert.equal(out.diagnosticOverflowLength, 300_000);
  assert.equal(reads, 0, 'the executor must not read a single element of an over-cap array');
});

test('an at-cap array is projected in full with no marker', async () => {
  const out = await project(new Array(1_000).fill(null).map((_, i) => frag('inconclusive-crossing', i)), 1_000);
  assert.equal(out.diagnostics.length, 1_000);
  assert.equal('diagnosticOverflowLength' in out, false);
});

test('100,000 distinct legal reasons are all projected — many and varied is never a rejection', async () => {
  const out = await project(new Array(100_000).fill(null).map((_, i) => frag(`r${String(i).padStart(6, '0')}`, i)), 200_000);
  assert.equal(out.diagnostics.length, 100_000);
  assert.equal(new Set(out.diagnostics.map((d) => d.reason)).size, 100_000);
});

test('one illegal diagnostic rejects the WHOLE array', async () => {
  const out = await project([frag('inconclusive-crossing', 1), frag('z'.repeat(129), 2)], 10);
  assert.equal(out.ok, false);
  assert.equal(out.issue.code, 'diagnostic-reason-too-long');
});

test('a non-array diagnostics value is rejected', async () => {
  for (const raw of [undefined, null, {}, 'x', new Set()]) assert.equal((await project(raw, 10)).ok, false);
});

test('projection yields to the scheduler when the slice budget is spent', async () => {
  let t = 0; let yields = 0;
  // `checkEvery: 1` — P0's slicer only consults the clock every `checkEvery` ticks (default 64), so a
  // 50-item pass would never be due at the default.
  const s = createSlicer({ now: () => (t += 1), yieldToScheduler: async () => { yields++; }, sliceBudgetMs: 4, checkEvery: 1 });
  await project(new Array(50).fill(null).map((_, i) => frag('non-manifold-component', i)), 100, s);
  assert.ok(yields > 0, 'a long projection pass must not be one synchronous span');
});

test('statistics: the closed numeric schema', () => {
  assert.equal(projectStatistics({ broadPhasePairs: 1, narrowPhasePairs: 2, totalMs: 3 }).ok, true);
  assert.equal(projectStatistics({ broadPhasePairs: 1, somethingNew: 2 }).ok, false);
  assert.equal(projectStatistics({ broadPhasePairs: Infinity }).ok, false);
  assert.equal(projectStatistics({ broadPhasePairs: '1' }).ok, false);
  assert.equal(projectStatistics({ diagnostics: [] }).ok, false, 'diagnostics is not a statistic');
  const negZero = projectStatistics({ broadPhaseMs: -0 });
  assert.ok(Object.is(negZero.statistics.broadPhaseMs, 0), '-0 normalizes to 0');
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/diagnostics.overflow.test.mjs` → `projectDiagnostics is not a function`.

- [ ] **Step 3: Implement the whole-array projection and statistics projection.**

```js
export const LIBRARY_STATISTICS_KEYS = Object.freeze([
  'broadPhasePairs', 'narrowPhasePairs', 'blasBuilt', 'blasCacheHits', 'broadPhaseMs',
  'narrowPhaseMs', 'totalMs', 'tlasLeafRangeEmissions', 'tlasPrimitiveCandidatePairs',
  'tlasExactRetestSurvivors', 'tlasNarrowPhaseInputPairs', 'tlasBuilds', 'tlasCacheHits',
  'tlasSharedBuildWaits', 'tlasBuildMs', 'tlasQueryMs', 'clearanceExpandedCandidatePairs',
  'clearanceExactAabbSurvivors', 'clearanceOverlapPrechecksRun', 'clearanceHardClashExclusions',
  'clearanceDistanceQueriesRun', 'clearanceHits', 'clearanceQueryMs',
]);
const STATISTICS_KEY_SET = new Set(LIBRARY_STATISTICS_KEYS);

export function projectStatistics(raw) {
  if (!isPlainObject(raw)) return issue('statistics-not-plain', 'statistics', 'not a plain object');
  const statistics = {};
  for (const key of Object.keys(raw)) {
    if (!STATISTICS_KEY_SET.has(key)) return issue('statistics-unknown-key', `statistics.${key}`, key);
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return issue('statistics-non-finite', `statistics.${key}`, value);
    statistics[key] = value === 0 ? 0 : value; // normalizes -0
  }
  return { ok: true, statistics };
}

/**
 * §7.1 R11-6. The cap is checked with the O(1) `length` read BEFORE any element is touched, so an
 * over-cap array costs the executor nothing: no iteration, no projected object, no message payload.
 * The engine still re-checks `length` on arrival (an executor is untrusted).
 */
export async function projectDiagnostics(raw, { table, limits, slicer }) {
  if (!Array.isArray(raw)) return issue('diagnostics-not-array', 'diagnostics', typeof raw);
  if (raw.length > limits.maxDiagnosticsPerOutcome) {
    return { ok: true, diagnostics: [], diagnosticOverflowLength: raw.length };
  }
  const diagnostics = [];
  // One slicer per sliced operation (P0): the caller hands in a slicer built for THIS unit, so there
  // is nothing to reset — P0's slicer exposes no `reset()`.
  for (let i = 0; i < raw.length; i++) {
    const pending = slicer.tick('project-diagnostics');
    if (pending) await pending;
    const r = projectDiagnostic(raw[i], table);
    if (r.ok === false) return { ok: false, issue: { ...r.issue, path: `diagnostics[${i}].${r.issue.path}` } };
    diagnostics.push(r.diagnostic);
  }
  return { ok: true, diagnostics };
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/diagnostics.overflow.test.mjs` → 7 passing.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P4.3 bounded diagnostic projection`.

---

### Task P4.4: The exact per-unit taint table

§12.2.1's `taints` table — exact, computed from the unit's own diagnostics before any de-duplication or retained-diagnostic cap, so retained-list truncation can never lose a taint.

**Files**
- Modify: `clashtest/execution/diagnostics.js`
- Test: `test/clashtest/execution/diagnostics.taints.test.mjs`

**Interfaces**
- Consumes: `projectDiagnostic` (P4.2); the ledger-budget oracle `admit(n: number) => boolean` — **reconciled, row N9**: the budget itself is **P3's** (`createRecordBudget(limits)` / `createLedger({limits, budget})`, `clashtest/planning/ledger.js`) and **P6 injects** a closure over the run's live ledger that returns `true` iff the discretionary `maxLedgerRecords` capacity `D` can take `n` more records, *charging* them when it does. P4 defines the collapse rule and owns no budget state; P3 never learns about diagnostics. Omitted ⇒ defaults to `() => true` (what P4's own unit tests use). (§6.5.1 makes the budget a run-wide property, so it cannot live in this module.)
- Produces: `deriveUnitTaints(diagnostics, {maxElementTaintsPerUnit, admit})`, `TAINT_OVERFLOW_REASON`.

- [ ] **Step 1: Write the failing taint test.**

```js
// test/clashtest/execution/diagnostics.taints.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveUnitTaints, projectDiagnostic, createUnitBindingTable, TAINT_OVERFLOW_REASON,
} from '../../../clashtest/execution/diagnostics.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }, { modelKey: 'mk-b', modelId: 2 }]);
const project = (raw) => { const r = projectDiagnostic(raw, table); assert.equal(r.ok, true); return r.diagnostic; };
const alwaysAdmit = () => true;
const elem = (dbId, reason = 'inconclusive-crossing', modelId = 1) =>
  project({ scope: 'fragment', reason, role: 'source', fragment: { modelId, dbId, fragId: dbId } });

const derive = (ds, over = {}) => deriveUnitTaints(ds, { maxElementTaintsPerUnit: 2_000, admit: alwaysAdmit, ...over });
const pair = (reason, a, b) => project({ scope: 'pair', reason,
  sourceFragment: { modelId: 1, dbId: a, fragId: a }, targetFragment: { modelId: 2, dbId: b, fragId: b } });
const nulled = (reason, role, modelId) => project({ scope: 'fragment', reason, role,
  fragment: { modelId, dbId: null, fragId: 5 } });

test('element diagnostics produce one entry per (modelKey, dbId, reason) with exact occurrences', () => {
  const { taints, overflowed } = derive([elem(10), elem(10), elem(11), elem(10, 'non-manifold-component')]);
  assert.equal(overflowed, false);
  assert.deepEqual(taints, [
    { kind: 'element', modelKey: 'mk-a', dbId: 10, reason: 'inconclusive-crossing', occurrences: 2 },
    { kind: 'element', modelKey: 'mk-a', dbId: 10, reason: 'non-manifold-component', occurrences: 1 },
    { kind: 'element', modelKey: 'mk-a', dbId: 11, reason: 'inconclusive-crossing', occurrences: 1 },
  ]);
});

test('a pair-scoped element diagnostic implicates BOTH owner elements', () => {
  const { taints } = derive([pair('unverified-parity-operand', 10, 20)]);
  assert.deepEqual(taints.map((t) => [t.modelKey, t.dbId]), [['mk-a', 10], ['mk-b', 20]]);
});

test('target-model and unit diagnostics get their own exact entry kinds', () => {
  const tm = nulled('fragment-not-loaded', 'target', 2);
  const { taints } = derive([tm, tm, nulled('fragment-owner-unresolvable', 'source', 1)]);
  assert.deepEqual(taints, [
    { kind: 'target-model', modelKey: 'mk-b', reason: 'fragment-not-loaded', occurrences: 2 },
    { kind: 'unit', modelKey: 'mk-a', reason: 'fragment-owner-unresolvable', occurrences: 1 },
  ]);
});

test('exceeding maxElementTaintsPerUnit collapses the WHOLE unit, losing nothing', () => {
  const { taints, overflowed } = derive(Array.from({ length: 12 }, (_, i) => elem(i)), { maxElementTaintsPerUnit: 10 });
  assert.equal(overflowed, true);
  assert.deepEqual(taints, [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: 12 }]);
});

test('a refusing ledger budget collapses the same way, for ANY taint kind', () => {
  const { taints, overflowed } = derive([elem(1), nulled('fragment-not-loaded', 'target', 2)], { admit: () => false });
  assert.equal(overflowed, true);
  assert.deepEqual(taints, [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: 2 }]);
});

test('taint entries are admitted in canonical order, independent of diagnostic order', () => {
  const order = (ds) => derive(ds).taints.map((t) => `${t.kind}|${t.modelKey}|${t.dbId}|${t.reason}`);
  assert.deepEqual(order([elem(2), elem(1, 'a-reason'), elem(1)]),
    order([elem(1), elem(2), elem(1, 'a-reason')]));
});

test('benign witness-unavailable still taints — taints are not filtered by the predicate', () => {
  assert.equal(derive([pair('witness-unavailable', 3, 4)]).taints.length, 2,
    'the taint table records what was observed; §12.5 decides what it means');
});
```

> The last test pins a real subtlety: §12.2.1 says the taint table is built "from that unit's own diagnostics" with no completeness filter, while §12.5's taint rule 1 makes *any* element entry `covered-caveated`. Applying the rule literally would make a benign `witness-unavailable` weaken an absence. P4 records what the spec says to record; **P5 owns the rule and applies the `completenessAffecting` filter at rule 1** — settled as register **S-P4-4** and written into P5's Gates item 6. See Gates and open items, contradiction 4.

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/diagnostics.taints.test.mjs` → `deriveUnitTaints is not a function`.

- [ ] **Step 3: Implement `deriveUnitTaints`.**

```js
export const TAINT_OVERFLOW_REASON = 'taint-overflow';

const taintKey = (t) => [t.kind, t.modelKey ?? '￿', t.dbId ?? -1, t.reason].join('\u0000');

/**
 * §12.2.1. Exact and independent of the global de-duplicated diagnostic list. Element entries are
 * at OWNER granularity (a pair-scoped element diagnostic implicates BOTH owners) so the record stays
 * small and conservative. Two independent exhaustion triggers — the per-unit element cap and the
 * run-wide ledger budget — collapse to ONE unit-wide `taint-overflow` entry that is a SUPERSET of
 * everything it replaces (every pair of the unit becomes caveated, §12.5 rule 3).
 */
export function deriveUnitTaints(diagnostics, { maxElementTaintsPerUnit, admit }) {
  const byKey = new Map();
  const bump = (entry) => {
    const key = taintKey(entry);
    const existing = byKey.get(key);
    if (existing) existing.occurrences += 1;
    else byKey.set(key, { ...entry, occurrences: 1 });
  };
  for (const d of diagnostics) {
    if (d.attribution === 'element') {
      const operands = d.scope === 'pair' ? [d.fragments.first, d.fragments.second] : [d.fragment];
      for (const o of operands) bump({ kind: 'element', modelKey: o.modelKey, dbId: o.dbId, reason: d.reason });
    } else if (d.attribution === 'target-model') {
      bump({ kind: 'target-model', modelKey: d.fragment.modelKey, reason: d.reason });
    } else {
      const modelKey = d.scope === 'fragment' ? d.fragment.modelKey : null;
      bump({ kind: 'unit', modelKey, reason: d.reason });
    }
  }
  const elementCount = [...byKey.values()].filter((t) => t.kind === 'element').length;
  const collapse = () => ({
    taints: [{ kind: 'unit', modelKey: null, reason: TAINT_OVERFLOW_REASON, occurrences: diagnostics.length }],
    overflowed: true,
  });
  if (elementCount > maxElementTaintsPerUnit) return collapse();
  // One all-or-nothing charge: the ledger either takes this unit's whole table or the unit collapses
  // into its reserved slot. Charging entry-by-entry would leave a partially recorded table, which
  // §6.5.1's "no partial record" rule forbids.
  if (!admit(byKey.size)) return collapse();
  const taints = [...byKey.values()].sort((a, b) => (taintKey(a) < taintKey(b) ? -1 : 1));
  return { taints, overflowed: false };
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/diagnostics.taints.test.mjs` → 7 passing.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P4.4 per-unit taint table`.

---

### Task P4.5: The closed `ExecutionRequest` / `UnitOutcome` schemas and the untrusting validator

The engine's boundary check. §7.1: "The engine never trusts an executor *to be structurally well-formed*."

**Files**
- Create: `clashtest/execution/UnitExecutor.js`
- Test: `test/clashtest/execution/unitOutcome.validate.test.mjs`

**Interfaces**
- Consumes: `LIBRARY_STATISTICS_KEYS`, `isCompletenessAffecting` from `diagnostics.js`.
- Consumes (**P3 `planning/planner.js`**): `WorkUnit` exactly as P3's summary declares it — `{unitId, cell, sourceModelKey, sourceRanges, targets, orientationRole, pairSpaceWeight}` (§6.5) — and `materializeUnit(plan, unit) → {sourceDbIds, targets, scopeExpect}` (row **N16**), which P6 puts on the request as **`request.materialized`**. The bracket expectation is therefore read from **`request.materialized.scopeExpect`**, never from a top-level `request.scopeExpect`.
- Consumes (**P3 `planning/owners.js`**): `ownerClassOf(plan, modelKey, dbId)` and `rootOfOwner(plan, modelKey, dbId)` — P3's summary names P4's outcome validation as their consumer. P4 never reads P3's table representation directly: `validateUnitOutcome(request, outcome, {isLegalOwner} = {})` takes the owner check as an optional callback `isLegalOwner({modelKey, dbId, side}) => boolean`, which **P6 builds over those two P3 functions**. When it is omitted the owner-scope checks are skipped; **P6 supplies it** (this is the only way those checks run, and it is stated in P6's A10).
- **Result shape is fixed at two fields (row N8).** `validateUnitOutcome` returns exactly `{ok, issues}` — `ok:true` still carries `issues: []`, and nothing else (no `ownerCheck`, no diagnostics) may be added, because P6's substitution path is written against exactly those two fields.
- Produces: `validateExecutionRequest`, `validateUnitOutcome`, `internalErrorOutcome`, and every enum constant in the interface summary.

- [ ] **Step 1: Write the failing validator test — the whole AC-3 rejection battery.**

```js
// test/clashtest/execution/unitOutcome.validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUnitOutcome, validateExecutionRequest } from '../../../clashtest/execution/UnitExecutor.js';

const gen = (modelKey, b = 0, p = 0) => ({ modelKey, bindingGeneration: b, placementGeneration: p });
const request = Object.freeze({
  unit: { unitId: '1.0', cell: '1', sourceModelKey: 'mk-a', sourceRanges: [], targets: [], orientationRole: 'A->B', pairSpaceWeight: 4 },
  materialized: {
    sourceDbIds: [10, 11],
    targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [20] }],
    scopeExpect: [
      { modelKey: 'mk-a', role: 'source', scope: 'roots', roots: [{ dbId: 10, subtreeDigest: 'sha256:a' }, { dbId: 11, subtreeDigest: 'sha256:b' }] },
      { modelKey: 'mk-b', role: 'target', scope: 'roots', roots: [{ dbId: 20, subtreeDigest: 'sha256:c' }] },
    ],
  },
  runId: 'run-1', attempt: 0, mode: 'volume-overlap', broadPhase: 'tlas',
  snapshot: [{ ...gen('mk-a'), modelVersion: 'v1' }, { ...gen('mk-b'), modelVersion: 'v1' }],
  limits: { maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 },
});

const gens = () => ({ start: [gen('mk-a'), gen('mk-b')], end: [gen('mk-a'), gen('mk-b')] });
const good = (over = {}) => ({
  unitId: '1.0', attempt: 0, outcome: 'evaluated', scopeProof: 'equal', failure: null,
  generations: gens(), pairs: [], diagnostics: [], statistics: { broadPhasePairs: 0 }, durationMs: 1, ...over,
});
/** A `failed` shell so a failure-field row does not also trip the evaluated/scopeProof invariant. */
const failed = (failure) => good({ outcome: 'failed', scopeProof: 'not-checked', failure });
const p = (over = {}) => ({ source: { modelKey: 'mk-a', dbId: 10 }, target: { modelKey: 'mk-b', dbId: 20 }, type: 'volume-overlap', witness: null, ...over });
const d = (over = {}) => ({ scope: 'fragment', reason: 'x', completenessAffecting: true, attribution: 'unit', fragment: { modelKey: null, dbId: null, fragId: 0 }, ...over });

test('the request schema is closed', () => {
  assert.equal(validateExecutionRequest(request).ok, true);
  assert.equal(validateExecutionRequest({ ...request, surprise: 1 }).ok, false);
  assert.equal(validateExecutionRequest({ ...request, mode: 'clearance' }).ok, false, 'clearance needs a clearance');
  assert.equal(validateExecutionRequest({ ...request, mode: 'clearance', clearance: 0.05 }).ok, true);
  assert.equal(validateExecutionRequest({ ...request, clearance: 0.05 }).ok, false, 'clearance only for clearance mode');
  assert.equal(validateExecutionRequest({ ...request, broadPhase: 'bvh' }).ok, false);
  assert.equal(validateExecutionRequest({ ...request, limits: { maxPairsPerOutcome: 1 } }).ok, false, 'limits is closed');
});

test('a well-formed evaluated outcome is accepted', () => {
  assert.deepEqual(validateUnitOutcome(request, good()).issues, []);
});

const REJECTIONS = [
  ['unitId mismatch', good({ unitId: '1.1' })],
  ['attempt mismatch', good({ attempt: 1 })],
  ['evaluated with non-null failure', good({ failure: { code: 'capacity-exceeded' } })],
  ['evaluated with scopeProof drift', good({ scopeProof: 'drift' })],
  ['failed with null failure', good({ outcome: 'failed', failure: null })],
  ['unknown outcome kind', good({ outcome: 'retried' })],
  ['unknown scopeProof', good({ scopeProof: 'maybe' })],
  ['unknown failure.code', failed({ code: 'nope' })],
  ['unknown capacityKind', failed({ code: 'capacity-exceeded', capacityKind: 'nope' })],
  ['over-length failure.message', failed({ code: 'internal-error', message: 'm'.repeat(513) })],
  ['over-length errorName', failed({ code: 'internal-error', errorName: 'e'.repeat(129) })],
  ['duplicate modelKeys', failed({ code: 'model-evicted', modelKeys: ['mk-a', 'mk-a'] })],
  ['non-participant modelKey', failed({ code: 'model-evicted', modelKeys: ['mk-z'] })],
  ['1,000,000 duplicate modelKeys', failed({ code: 'model-evicted', modelKeys: new Array(1_000_000).fill('mk-a') })],
  ['generations missing a participant', good({ generations: { ...gens(), end: [gen('mk-a')] } })],
  ['generations with a duplicate', good({ generations: { ...gens(), start: [gen('mk-a'), gen('mk-a')] } })],
  ['generations with an extra model', good({ generations: { ...gens(), start: [gen('mk-a'), gen('mk-b'), gen('mk-z')] } })],
  ['negative generation', good({ generations: { ...gens(), start: [gen('mk-a', -1), gen('mk-b')] } })],
  ['pair naming a model outside the unit', good({ pairs: [p({ source: { modelKey: 'mk-z', dbId: 10 } })] })],
  ['pair type outside the mode enumeration', good({ pairs: [p({ type: 'clearance' })] })],
  ['evidence of the wrong mode shape', good({ pairs: [{ ...p(), witness: undefined, distance: 1 }] })],
  ['non-finite evidence value', good({ pairs: [p({ witness: { kind: 'containment', point: [0, NaN, 0] } })] })],
  ['pairs over cap', good({ pairs: new Array(1_001).fill(p()) })],
  ['overflow marker below cap', good({ pairs: [], pairsOverflowLength: 5 })],
  ['overflow marker with a non-empty array', good({ pairs: [p()], pairsOverflowLength: 2_000 })],
  ['overflow marker non-integer', good({ pairs: [], pairsOverflowLength: 1.5 })],
  ['overflow marker on a non-evaluated outcome', good({ outcome: 'skipped', scopeProof: 'drift', failure: { code: 'scope-drift' }, diagnosticOverflowLength: 3_000 })],
  ['diagnostics over cap with no marker', good({ diagnostics: new Array(2_001).fill(d()) })],
  ['diagnostic with engine-only occurrences field', good({ diagnostics: [d({ occurrences: 2 })] })],
  ['diagnostic with engine-only unitIds field', good({ diagnostics: [d({ unitIds: ['1.0'] })] })],
  ['diagnostic reason 129 code units', good({ diagnostics: [d({ reason: 'z'.repeat(129) })] })],
  ['unknown statistics key', good({ statistics: { surprise: 1 } })],
  ['a Map anywhere', good({ statistics: new Map() })],
  ['a function anywhere', good({ extra: () => {} })],
  ['negative durationMs', good({ durationMs: -1 })],
  ['non-finite durationMs', good({ durationMs: Infinity })],
];

for (const [label, outcome] of REJECTIONS) {
  test(`rejected: ${label}`, () => {
    const result = validateUnitOutcome(request, outcome);
    assert.equal(result.ok, false, label);
    assert.ok(result.issues.length > 0);
    for (const i of result.issues) assert.ok(i.detail.length <= 512, 'issue details are bounded');
  });
}

test('validateUnitOutcome never throws, whatever it is handed', () => {
  for (const outcome of [undefined, null, 0, 'x', [], { get unitId() { throw new Error('boom'); } }]) {
    assert.doesNotThrow(() => validateUnitOutcome(request, outcome));
    assert.equal(validateUnitOutcome(request, outcome).ok, false);
  }
});

test('the documented limit of validation: a semantically false but structurally valid outcome is ACCEPTED', () => {
  // §7.1 trust boundary. An executor that never called findClashes and returns a clean, empty,
  // scope-proven outcome is indistinguishable from an honest one. This test exists to pin that the
  // engine does NOT pretend to detect it.
  assert.equal(validateUnitOutcome(request, good()).ok, true);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/unitOutcome.validate.test.mjs` → `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the enums and both validators.** The enum tables, listed in full and verbatim from the spec:

```js
// clashtest/execution/UnitExecutor.js
export const EXECUTION_MODES = Object.freeze(['volume-overlap', 'surface-intersection', 'containment', 'clearance']);
export const UNIT_OUTCOME_KINDS = Object.freeze(['evaluated', 'failed', 'skipped', 'discarded']);
export const SCOPE_PROOF_VALUES = Object.freeze(['equal', 'drift', 'unverifiable', 'not-checked']);
export const UNIT_CAUSES = Object.freeze([   // §8.3, exhaustive
  'model-evicted', 'world-disposed', 'stale-placement', 'capacity-exceeded', 'extraction-limit',
  'object-tree-unavailable', 'internal-error', 'cancelled', 'result-cap', 'run-failed',
  'input-changed', 'scope-drift', 'scope-unverifiable', 'unit-cap', 'target-too-large',
]);
export const LIBRARY_CAPACITY_KINDS = Object.freeze([   // F8
  'call-wide-unique-fragment-precheck', 'bucket-capacity', 'tlas-candidate-budget',
  'whole-model-enumeration', 'clearance-narrow-phase-budget',
]);
export const MAX_NESTED_STRING_CODE_UNITS = 128;
export const MAX_FAILURE_MESSAGE_CODE_UNITS = 512;

/**
 * Per-mode legal pair keys, library orientation (§11.1, §11.2). Presence is exact: a key outside the
 * mode's list, or a missing required key, is a malformed outcome.
 *   volume-overlap       : witness = {kind:'surface-crossing'|'containment', point:[x,y,z]} | null
 *   surface-intersection : no evidence keys
 *   containment          : no evidence keys
 *   clearance            : distance (finite ≥ 0), clearance (finite > 0), witness object
 */
export const EVIDENCE_KEYS_BY_MODE = Object.freeze({
  'volume-overlap': Object.freeze(['witness']),
  'surface-intersection': Object.freeze([]),
  containment: Object.freeze([]),
  clearance: Object.freeze(['distance', 'clearance', 'witness']),
});
```

The validator is a straight sequence of guards; the shape below is the whole of it, with the checks in §7.1's stated order (cheap identity first, then the O(1) size gates *before* any deep walk, then the deep walk):

```js
export function validateUnitOutcome(request, outcome, { isLegalOwner } = {}) {
  const issues = [];
  const add = (code, path, detail) => issues.push({ code, path, detail: String(detail).slice(0, MAX_FAILURE_MESSAGE_CODE_UNITS) });
  try {
    if (!isPlainObject(outcome)) { add('outcome-not-plain', '', typeof outcome); return done(); }
    // 1. identity
    if (outcome.unitId !== request.unit.unitId) add('unit-id-mismatch', 'unitId', outcome.unitId);
    if (outcome.attempt !== request.attempt) add('attempt-mismatch', 'attempt', outcome.attempt);
    // 2. closed key set
    for (const key of Object.keys(outcome)) if (!OUTCOME_KEYS.has(key)) add('outcome-unknown-key', key, key);
    // 3. enums + the evaluated invariant (I-scope)
    …
    // 4. O(1) size gates BEFORE any deep processing
    if (Array.isArray(outcome.pairs) && outcome.pairs.length > request.limits.maxPairsPerOutcome) {
      add('pairs-over-cap', 'pairs', outcome.pairs.length);   // P6 maps this to failed:result-cap, not internal-error
    }
    …
    // 5. deep walk: plainness, finiteness, -0 normalization, string lengths, participant membership,
    //    owner membership via isLegalOwner, evidence shape by mode, statistics schema.
  } catch (err) {
    add('outcome-threw-on-read', '', err && err.message);
  }
  return done();
  // Exactly two fields, always (row N8): P6 reads `{ok, issues}` and nothing else.
  function done() { return { ok: issues.length === 0, issues }; }
}
```

Implement the elided branches against the test list above; every rejection row in the test is one guard. `pairs-over-cap` is reported as its own issue code so P6 can apply §17.1's whole-unit `failed:result-cap` rule rather than `failed:internal-error` — the one rejection that is not an internal error.

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/unitOutcome.validate.test.mjs` → 3 + 35 rejection + 2 = 40 passing.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P4.5 closed UnitOutcome schema and validator`.

---

### Task P4.6: `LocalUnitExecutor` — the one `findClashes` call, pair projection, clone safety

**Files**
- Create: `clashtest/execution/LocalUnitExecutor.js`
- Test: `test/clashtest/execution/localExecutor.call.test.mjs`
- Test: `test/clashtest/execution/localExecutor.realWorld.test.mjs` (**T2**, real `CollisionWorld`)

**Interfaces**
- Consumes: `world.findClashes(query)` (real API, `collision/CollisionWorld.js:1231`).
- Consumes (**P1 `identity/ModelRegistry.js`**): `registry.bindingFor(modelKey) → Binding | null`, where `Binding = {modelKey, model, modelVersion, lease: {model, epoch}, bindingGeneration, placementGeneration}` and **`null` already means "no live binding with a valid lease"** — there is no `dead` flag (row **N10**). P4 reads `binding.model`, `binding.lease`, `binding.bindingGeneration`, `binding.placementGeneration`. Registries are built with P1's `createModelRegistry({world})` (row **N11**).
- Consumes (**P0 test support**, `test/clashtest/support/index.mjs`, signatures verbatim): `createFakeWorld({defaultResult?}) → {calls, script(...steps), hold(), dispose(), inFlight, maxInFlight, disposed, findClashes}` — each recorded call is `{index, query, snapshot}`, and behaviour is queued with `script(result | Error | (query, call) => result)`; plus `createFakeModel(id)`, `emptyClashResult()`, `snapshotQuery(query)`, `createFakeClock({...})`. There is **no `onFindClashes` and no `leases` option**; P0's fake world has no lease surface at all, so P4's `createExecutionWorld` (File structure) composes it with P1's `makeLeaseWorld()` rather than editing either file.
- Produces: `createLocalUnitExecutor`, `buildFindClashesQuery`, `projectPairs`.

- [ ] **Step 1: Write the failing call-construction and clone-safety test.**

```js
// test/clashtest/execution/localExecutor.call.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { emptyClashResult, createFakeClock } from '../support/index.mjs';   // P0
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';  // P4-local (additive)

const empty = emptyClashResult;   // P0's `{pairs: [], statistics: {diagnostics: []}}`
/**
 * `makeExecutorDeps` returns `{world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs}`;
 * its `world` is P4's `createExecutionWorld` — P0's fake world (`calls`, `script`) plus P1's lease
 * surface. Behaviour is QUEUED with P0's `script(...)`; the factory takes no per-call callback option.
 */
const run = (step, request = makeRequest({}), extra = {}) => {
  const deps = makeExecutorDeps(extra);
  deps.world.script(step);
  return createLocalUnitExecutor(deps)(request).then((outcome) => ({ world: deps.world, outcome }));
};
const rawPair = (over = {}) => ({ source: { modelId: 1, dbId: 10, model: {} },
  target: { modelId: 2, dbId: 20, model: {} }, type: 'volume-overlap', witness: null, ...over });

test('the composed world exposes P0 fake-world surface verbatim, including hold()', () => {
  // The composition NARROWS nothing: P7's disposal tests park an in-flight call with `hold()`.
  const w = makeExecutorDeps({}).world;
  for (const k of ['calls', 'script', 'hold', 'inFlight', 'maxInFlight', 'disposed', 'findClashes',
    'admitModel', 'isLeaseValid', 'evictModel', 'invalidateModelPlacement', 'dispose']) {
    assert.ok(k in w, `createExecutionWorld must pass through ${k}`);
  }
  assert.equal(typeof w.hold, 'function');
});

test('the call is always the targets shape with groupBy dbId and one mode', async () => {
  const { world } = await run(empty, makeRequest({ mode: 'surface-intersection',
    targets: [{ modelKey: 'mk-b', scope: 'whole' }, { modelKey: 'mk-c', scope: 'roots', dbIds: [7, 8] }] }));
  assert.equal(world.calls.length, 1);
  const q = world.calls[0].query;   // P0 records {index, query, snapshot}
  assert.deepEqual(Object.keys(q).sort(), ['broadPhase', 'groupBy', 'mode', 'source', 'target']);
  assert.equal(q.groupBy, 'dbId');
  assert.equal(q.mode, 'surface-intersection');
  assert.equal('clearance' in q, false, 'clearance is absent for a non-clearance mode');
  assert.ok(Array.isArray(q.target.targets), 'never the legacy {model, dbIds} shape');
  assert.equal('dbIds' in q.target.targets[0], false, 'whole-model target omits dbIds entirely');
  assert.deepEqual(q.target.targets[1].dbIds, [7, 8]);
  assert.deepEqual(q.source.dbIds, [10, 11]);
});

test('clearance mode carries the definition clearance; the library has no default', async () => {
  const { world } = await run(empty, makeRequest({ mode: 'clearance', clearance: 0.05 }));
  assert.equal(world.calls[0].query.clearance, 0.05);
});

test('the engine passes fresh arrays and never mutates plan data after issue', async () => {
  const request = makeRequest({});
  await run((q) => { q.source.dbIds.push(999); return empty(); }, request);
  assert.deepEqual(request.materialized.sourceDbIds, [10, 11], 'the library got a copy, not the plan array');
});

test('a ClashPair carrying a live Model never leaks: the outcome is structured-clone safe (F4)', async () => {
  const liveModel = { id: 2 };
  liveModel.window = liveModel;   // the circular reference that crashed the M1 gate
  const { outcome } = await run(() => ({
    pairs: [rawPair({ target: { modelId: 2, dbId: 20, model: liveModel },
      witness: { kind: 'surface-crossing', point: [1, 2, 3] } })],
    statistics: { broadPhasePairs: 1, diagnostics: [] },
  }));
  assert.equal(outcome.outcome, 'evaluated');
  assert.doesNotThrow(() => structuredClone(outcome), 'a raw ClashPair[] would throw here');
  assert.deepEqual(outcome.pairs, [{ source: { modelKey: 'mk-a', dbId: 10 }, target: { modelKey: 'mk-b', dbId: 20 },
    type: 'volume-overlap', witness: { kind: 'surface-crossing', point: [1, 2, 3] } }]);
  assert.equal(JSON.stringify(outcome).includes('modelId'), false);
});

test('library pair ORDER is preserved verbatim; canonical ordering is not the executor\'s job (F3)', async () => {
  const { outcome } = await run(() => ({
    pairs: [30, 10, 20].map((dbId) => rawPair({ source: { modelId: 1, dbId, model: {} } })), statistics: {} }));
  assert.deepEqual(outcome.pairs.map((x) => x.source.dbId), [30, 10, 20]);
});

test('more pairs than maxPairsPerOutcome yields the O(1) marker with no projection', async () => {
  const pairs = new Proxy(new Array(5_000).fill(rawPair()), {
    get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) assert.fail('read an element of an over-cap pairs array'); return Reflect.get(t, k, r); },
  });
  const { outcome } = await run(() => ({ pairs, statistics: {} }),
    makeRequest({ limits: { maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 } }));
  assert.deepEqual(outcome.pairs, []);
  assert.equal(outcome.pairsOverflowLength, 5_000);
});

test('durationMs comes from the injected clock, never wall time', async () => {
  const clock = createFakeClock({ start: 0 });
  const { outcome } = await run(() => { clock.advance(42); return empty(); }, makeRequest({}), { now: clock.now });
  assert.equal(outcome.durationMs, 42);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/localExecutor.call.test.mjs` → `ERR_MODULE_NOT_FOUND` for `LocalUnitExecutor.js`.

- [ ] **Step 3: Implement `buildFindClashesQuery`, `projectPairs` and the happy-path executor.**

```js
// clashtest/execution/LocalUnitExecutor.js
/**
 * §7.2 verbatim. ALWAYS the `targets` shape, so the broad phase defaults to 'tlas', cross-model is
 * legal, and `maxBroadPhaseInstancePairs` does not apply (F1, README M2). A whole-model target OMITS
 * `dbIds` entirely — the library rejects `dbIds: null` and treats only `undefined` as the sentinel,
 * so the key must not be present at all.
 */
export function buildFindClashesQuery(request, resolved) {
  return {
    source: { model: resolved.sourceBinding.model, dbIds: [...request.materialized.sourceDbIds] },
    target: {
      targets: request.materialized.targets.map((t) => {
        const model = resolved.byKey.get(t.modelKey).model;
        return t.scope === 'whole' ? { model } : { model, dbIds: [...t.dbIds] };
      }),
    },
    mode: request.mode,
    groupBy: 'dbId',
    ...(request.mode === 'clearance' ? { clearance: request.clearance } : {}),
    broadPhase: request.broadPhase,
  };
}

/**
 * Library orientation, projected. `model` and `modelId` are dropped: `model` is the live Model whose
 * circular `window` reference makes a raw ClashPair[] non-cloneable (F4), and `modelId` is
 * diagnostic-only and not unique (F12). Order is NOT canonicalized — the library's insertion order
 * differs between TLAS and linear (F3) and §11.3's canonical sort is the engine's job at merge time.
 */
export function projectPairs(rawPairs, { mode, limits, table }) {
  if (!Array.isArray(rawPairs)) return { ok: false, issue: { code: 'pairs-not-array', path: 'pairs', detail: typeof rawPairs } };
  if (rawPairs.length > limits.maxPairsPerOutcome) {
    return { ok: true, pairs: [], pairsOverflowLength: rawPairs.length };
  }
  const pairs = [];
  for (const raw of rawPairs) {
    const source = table.resolve(raw.source?.modelId);
    const target = table.resolve(raw.target?.modelId);
    const pair = {
      source: { modelKey: source.modelKey, dbId: raw.source?.dbId },
      target: { modelKey: target.modelKey, dbId: raw.target?.dbId },
      type: raw.type,
    };
    for (const key of EVIDENCE_KEYS_BY_MODE[mode]) if (key in raw) pair[key] = cloneEvidence(raw[key]);
    pairs.push(pair);
  }
  return { ok: true, pairs };
}
```

`cloneEvidence` is a whitelisted deep copy: `null`, a finite number, or `{kind, point:[x,y,z]}` / `{sourcePoint:[…], targetPoint:[…]}` with every coordinate a finite number; anything else becomes the sentinel `{__invalid: true}` so `validateUnitOutcome` rejects it rather than the executor throwing. `-0` normalizes to `0`.

The executor body, happy path only in this task (leases and digests arrive in P4.8, error mapping in P4.7):

```js
export function createLocalUnitExecutor({ world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs }) {
  return async function execute(request) {
    const requestCheck = validateExecutionRequest(request);
    // The canonical failed:internal-error shell is the EXPORTED one (P4.5) — the executor does not
    // hand-build a second one, exactly as P6 does not (row N8).
    if (!requestCheck.ok) return internalErrorOutcome(request, requestCheck.issues);
    const startedAt = now();
    const resolved = resolveUnitBindings(request, registry);   // P4.8 adds the lease gate here
    const generationsStart = readGenerations(request, registry);
    let result;
    try {
      result = await world.findClashes(buildFindClashesQuery(request, resolved));
    } catch (error) {
      return finishFailure(error);                             // P4.7
    }
    const generationsEnd = readGenerations(request, registry);
    const slicer = createSlicer({ now, yieldToScheduler, sliceBudgetMs });
    const projectedPairs = projectPairs(result.pairs, { mode: request.mode, limits: request.limits, table: resolved.table });
    const { diagnostics: rawDiagnostics, ...rawStatistics } = result.statistics ?? {};
    const projectedDiagnostics = await projectDiagnostics(rawDiagnostics ?? [], { table: resolved.table, limits: request.limits, slicer });
    const statistics = projectStatistics(rawStatistics);
    // any !ok above ⇒ failed:internal-error with the issue attached (the executor built an illegal
    // call, or the library returned a shape this build does not understand)
    return {
      unitId: request.unit.unitId, attempt: request.attempt, outcome: 'evaluated', scopeProof: 'equal',
      failure: null, generations: { start: generationsStart, end: generationsEnd },
      pairs: projectedPairs.pairs, diagnostics: projectedDiagnostics.diagnostics,
      ...(projectedPairs.pairsOverflowLength !== undefined ? { pairsOverflowLength: projectedPairs.pairsOverflowLength } : {}),
      ...(projectedDiagnostics.diagnosticOverflowLength !== undefined ? { diagnosticOverflowLength: projectedDiagnostics.diagnosticOverflowLength } : {}),
      statistics: statistics.statistics, durationMs: now() - startedAt,
    };
  };
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/localExecutor.call.test.mjs` → 7 passing.

- [ ] **Step 5: Write the failing T2 test over the REAL `CollisionWorld`.** Mirrors `test/CollisionWorld.findClashes.crossModel.test.mjs`'s `makeTwoModelFixture` plumbing (`buildMockModel` + one shared `viewer.impl.getRenderProxy` dispatching by model identity) — copied into `test/clashtest/support/realWorldFixture.mjs`, not imported across the collision/clashtest test trees.

```js
// test/clashtest/execution/localExecutor.realWorld.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../../collision/index.js';   // TEST-ONLY import; the engine core imports none of this
import { makeTwoModelFixture, box } from '../support/realWorldFixture.mjs';
import { makeExecutorDeps, makeRequest as realRequest } from '../support/executionRequests.mjs';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { LIBRARY_STATISTICS_KEYS } from '../../../clashtest/execution/diagnostics.js';

const OVERLAPPING = {   // modelA's dbId 100 and modelB's dbId 200 overlap by construction
  rootNodesA: [{ dbId: 100, fragments: [1] }],
  fragSpecsA: { 1: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  rootNodesB: [{ dbId: 200, fragments: [2] }],
  fragSpecsB: { 2: { geometryIndex: 0, geometry: box(2, 2, 2), at: [1, 0, 0] } },
};
const realWorld = async (fixture) => {
  const f = makeTwoModelFixture(fixture);
  const world = await CollisionWorld.fromViewer(f.viewer, { now: () => 0 });
  // Same P4-local builder as the fake-world tests, given a REAL world and the real models.
  return { ...f, world, exec: createLocalUnitExecutor(makeExecutorDeps({ world, models: { 'mk-a': f.modelA, 'mk-b': f.modelB } })) };
};

test('a real cross-model volume-overlap unit produces a clone-safe evaluated outcome', async () => {
  const { exec } = await realWorld(OVERLAPPING);
  const outcome = await exec(realRequest({ mode: 'volume-overlap', sourceDbIds: [100],
    targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [200] }] }));
  assert.equal(outcome.outcome, 'evaluated');
  assert.equal(outcome.scopeProof, 'equal');
  assert.equal(outcome.pairs.length, 1);
  assert.deepEqual(outcome.pairs[0].source, { modelKey: 'mk-a', dbId: 100 });
  assert.deepEqual(outcome.pairs[0].target, { modelKey: 'mk-b', dbId: 200 });
  assert.doesNotThrow(() => structuredClone(outcome), 'a real ClashPair carries a live Model (F4)');
  assert.equal(JSON.stringify(outcome).includes('"modelId"'), false);
});

test('real unattributable diagnostics survive projection with dbId null (F17)', async () => {
  // A whole-model TARGET is the only path that produces fragment-not-loaded /
  // fragment-owner-unresolvable, and their fragment.dbId is hard-coded null in the library.
  const flat = { min: [0, 0, 0], max: [0, 0, 0] };
  const { exec } = await realWorld({ ...OVERLAPPING,
    fragSpecsB: { ...OVERLAPPING.fragSpecsB, 3: { geometryIndex: 1, bounds: flat }, 4: { geometryIndex: 2, bounds: flat } },
    modelOptionsB: { notLoadedFragIds: [3], ownerDbIdOverrides: new Map([[4, undefined]]) } });
  const outcome = await exec(realRequest({ mode: 'volume-overlap', sourceDbIds: [100],
    targets: [{ modelKey: 'mk-b', scope: 'whole' }] }));

  const byReason = new Map(outcome.diagnostics.map((d) => [d.reason, d]));
  for (const reason of ['fragment-not-loaded', 'fragment-owner-unresolvable']) {
    const d = byReason.get(reason);
    assert.ok(d, `${reason} must reach the outcome`);
    assert.equal(d.fragment.dbId, null, 'never a sentinel');
    assert.deepEqual([d.fragment.modelKey, d.fragment.role, d.attribution, d.completenessAffecting],
      ['mk-b', 'target', 'target-model', true]);
  }
  assert.doesNotThrow(() => structuredClone(outcome));
});

test('LIBRARY_STATISTICS_KEYS does not drift from the library\'s real statistics shape', async () => {
  const { world, modelA, modelB } = await realWorld();
  const raw = await world.findClashes({ source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB }] }, mode: 'volume-overlap', groupBy: 'dbId' });
  assert.deepEqual(Object.keys(raw.statistics).filter((k) => k !== 'diagnostics').sort(),
    [...LIBRARY_STATISTICS_KEYS].sort(),
    'the closed statistics schema must be updated deliberately when the library adds a field');
});
```

- [ ] **Step 6: Run the T2 test and watch it pass.** `node --test test/clashtest/execution/localExecutor.realWorld.test.mjs` → 3 passing. Fix the projection, not the assertions, if the real library disagrees with the plan.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs: P4.6 LocalUnitExecutor call construction and projection`.

---

### Task P4.7: The §7.5 error taxonomy

Every row of the table, matched on `error.name` rather than `instanceof`.

**Files**
- Modify: `clashtest/execution/LocalUnitExecutor.js`
- Test: `test/clashtest/execution/localExecutor.errors.test.mjs`
- Test: append one case to `test/clashtest/execution/localExecutor.realWorld.test.mjs`

**Interfaces**
- Consumes: `UNIT_CAUSES`, `LIBRARY_CAPACITY_KINDS` (P4.5).
- Produces: `classifyLibraryError(error, ctx)`, `LINEAR_CEILING_MESSAGE_PREFIX`.

**Why `error.name` and not `instanceof`.** `instanceof` would require `clashtest/` to import `collision/index.js`, and §7.3 explicitly anticipates duplicate bundles/module copies in one page — under which `instanceof` silently fails for a genuine library error and the unit becomes `failed:internal-error`, which **fails the whole run**. Name matching has no such failure mode. The T2 case below is what keeps the names honest.

- [ ] **Step 1: Write the failing taxonomy test, one case per §7.5 row.**

```js
// test/clashtest/execution/localExecutor.errors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLibraryError, LINEAR_CEILING_MESSAGE_PREFIX } from '../../../clashtest/execution/LocalUnitExecutor.js';

import { UNIT_CAUSES } from '../../../clashtest/execution/UnitExecutor.js';

const named = (name, extra = {}) => Object.assign(new Error(`${name} happened`), { name }, extra);
const ctx = { participants: ['mk-a', 'mk-b'], deadModelKeys: [], placementGenerationChanged: false };

const capacity = (kind, extra = {}) =>
  [named('CapacityExceededError', { kind, ...extra }), ctx, { outcome: 'failed', code: 'capacity-exceeded', capacityKind: kind }];

const ROWS = [
  ['WorldDisposedError ⇒ failed:world-disposed', named('WorldDisposedError'), ctx, { outcome: 'failed', code: 'world-disposed' }],
  ['ModelEvictedError ⇒ failed:model-evicted, models from the LEASE recheck not the error',
    named('ModelEvictedError', { modelId: 99 }), { ...ctx, deadModelKeys: ['mk-b'] },
    { outcome: 'failed', code: 'model-evicted', modelKeys: ['mk-b'] }],
  ['placement changed, generation UNCHANGED ⇒ retryable failed:stale-placement',
    named('ModelPlacementChangedError'), ctx, { outcome: 'failed', code: 'stale-placement', retryable: true }],
  ['placement changed, generation CHANGED ⇒ discarded:input-changed, never retried',
    named('ModelPlacementChangedError'), { ...ctx, placementGenerationChanged: true },
    { outcome: 'discarded', code: 'input-changed', retryable: false }],
  ['capacity tlas-candidate-budget (splittable)', ...capacity('tlas-candidate-budget', { requested: 9, limit: 8 })],
  ['capacity clearance-narrow-phase-budget (splittable)', ...capacity('clearance-narrow-phase-budget')],
  ['capacity bucket-capacity (environment-sensitive)', ...capacity('bucket-capacity', { currentSize: 19_000, missing: 2_000, limit: 20_000 })],
  ['capacity call-wide-unique-fragment-precheck', ...capacity('call-wide-unique-fragment-precheck')],
  ['capacity whole-model-enumeration', ...capacity('whole-model-enumeration')],
  ['ExtractionLimitExceededError ⇒ failed:extraction-limit', named('ExtractionLimitExceededError'), ctx, { outcome: 'failed', code: 'extraction-limit' }],
  ['ObjectTreeUnavailableError ⇒ failed:object-tree-unavailable', named('ObjectTreeUnavailableError'), ctx, { outcome: 'failed', code: 'object-tree-unavailable' }],
  ['plain Error matching the linear ceiling ⇒ capacity-exceeded, NOT internal-error',
    Object.assign(new Error(`${LINEAR_CEILING_MESSAGE_PREFIX} (2 x 3 > 1)`), { name: 'Error' }), ctx,
    { outcome: 'failed', code: 'capacity-exceeded', capacityKind: null }],
  ['any other plain Error ⇒ failed:internal-error (fail-fast: the engine built an illegal call)',
    named('Error'), ctx, { outcome: 'failed', code: 'internal-error' }],
  ['a TypeError ⇒ failed:internal-error', named('TypeError'), ctx, { outcome: 'failed', code: 'internal-error' }],
  ['a non-Error throw ⇒ failed:internal-error, never a crash', 'a string', ctx, { outcome: 'failed', code: 'internal-error' }],
];

for (const [label, error, context, expected] of ROWS) {
  test(label, () => {
    const got = classifyLibraryError(error, context);
    assert.equal(got.outcome, expected.outcome);
    assert.equal(got.failure.code, expected.code);
    assert.ok(UNIT_CAUSES.includes(got.failure.code));
    if (expected.capacityKind !== undefined) assert.equal(got.failure.capacityKind ?? null, expected.capacityKind);
    if (expected.modelKeys) assert.deepEqual(got.failure.modelKeys, expected.modelKeys);
    if (expected.retryable !== undefined) assert.equal(got.failure.retryable, expected.retryable);
    assert.ok((got.failure.message ?? '').length <= 512);
    assert.ok((got.failure.errorName ?? '').length <= 128);
    assert.doesNotThrow(() => structuredClone(got.failure), 'failure data must be plain');
  });
}

test('a capacity error\'s details are copied as finite numbers only', () => {
  const got = classifyLibraryError(
    named('CapacityExceededError', { kind: 'bucket-capacity', currentSize: 1, missing: NaN, extra: {} }), ctx);
  assert.deepEqual(got.failure.capacityDetails, { currentSize: 1 });
});

test('an over-length library message is TRUNCATED, not rejected — a library message is not executor data', () => {
  const got = classifyLibraryError(named('ObjectTreeUnavailableError', { message: 'x'.repeat(5_000) }), ctx);
  assert.equal(got.failure.message.length, 512);
});
```

> The last case resolves a real tension: §7.1's `failure.message ≤ 512` is a *validation* rule on what the executor returns, while the message's *source* is the library. The reference executor truncates at projection so a long library message can never make its own outcome malformed; a third-party executor that returns an over-length message is still rejected by `validateUnitOutcome`.

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/localExecutor.errors.test.mjs` → `classifyLibraryError is not a function`.

- [ ] **Step 3: Implement `classifyLibraryError`.**

```js
export const LINEAR_CEILING_MESSAGE_PREFIX =
  'findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs';

const trunc = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const CAPACITY_DETAIL_KEYS = ['currentSize', 'missing', 'requested', 'limit'];

export function classifyLibraryError(error, { participants, deadModelKeys, placementGenerationChanged }) {
  const name = error && typeof error.name === 'string' ? error.name : 'Error';
  const message = trunc(error && error.message, MAX_FAILURE_MESSAGE_CODE_UNITS);
  const base = { errorName: trunc(name, MAX_NESTED_STRING_CODE_UNITS), message };
  switch (name) {
    case 'WorldDisposedError':
      return { outcome: 'failed', failure: { code: 'world-disposed', ...base, retryable: false } };
    case 'ModelEvictedError':
      // F12: the error's modelId is NOT unique. WHICH binding died is established by re-checking
      // leases (§7.4); the error is used only for its class.
      return { outcome: 'failed', failure: { code: 'model-evicted', ...base, modelKeys: [...deadModelKeys].sort(), retryable: false } };
    case 'ModelPlacementChangedError':
      return placementGenerationChanged
        ? { outcome: 'discarded', failure: { code: 'input-changed', ...base, retryable: false } }
        : { outcome: 'failed', failure: { code: 'stale-placement', ...base, retryable: true } };
    case 'CapacityExceededError': {
      const capacityDetails = {};
      for (const key of CAPACITY_DETAIL_KEYS) {
        if (typeof error[key] === 'number' && Number.isFinite(error[key])) capacityDetails[key] = error[key];
      }
      return { outcome: 'failed', failure: {
        code: 'capacity-exceeded', ...base,
        capacityKind: LIBRARY_CAPACITY_KINDS.includes(error.kind) ? error.kind : undefined,
        capacityDetails, retryable: false,
      } };
    }
    case 'ExtractionLimitExceededError':
      return { outcome: 'failed', failure: { code: 'extraction-limit', ...base, retryable: false } };
    case 'ObjectTreeUnavailableError':
      return { outcome: 'failed', failure: { code: 'object-tree-unavailable', ...base, retryable: false } };
    default:
      // The linear oracle's ceiling is a PLAIN Error, recognized by a pinned message matcher
      // (§7.2). It is a capacity failure, never an internal error — an internal error fails the
      // whole run, and an oversized 'linear' verification call must not do that.
      if (typeof message === 'string' && message.startsWith(LINEAR_CEILING_MESSAGE_PREFIX)) {
        return { outcome: 'failed', failure: { code: 'capacity-exceeded', ...base, capacityKind: undefined, capacityDetails: {}, retryable: false } };
      }
      return { outcome: 'failed', failure: { code: 'internal-error', ...base, retryable: false } };
  }
}
```

The executor's `finishFailure(error)` wraps this into a full `UnitOutcome`: `scopeProof` is whatever the bracketed protocol reached (`'not-checked'` if the pre-check never ran, `'equal'` if the pre-check passed and the call then threw), `pairs: []`, `diagnostics: []`, `statistics: {}`, `generations` from the two reads, `durationMs` from the injected clock.

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/localExecutor.errors.test.mjs` → 17 passing.

- [ ] **Step 5: Write the failing T2 compatibility test for the pinned matcher.** Append to `localExecutor.realWorld.test.mjs`. It trips the real ceiling cheaply: the check is a pure count precheck (`sourceCount > maxBroadPhaseInstancePairs / targetCount`) run **before** admission, so bounds-only fragments with no geometry suffice.

```js
// 1,001 × 1,001 = 1,002,001 > maxBroadPhaseInstancePairs (1,000,000). Bounds-only fragments with no
// geometry are enough: `_exceedsBroadPhaseCeiling` is a pure count precheck run after extraction and
// BEFORE admission or any narrow-phase work, so this fixture is cheap.
const CEILING_FIXTURE = (() => {
  const bounds = { min: [0, 0, 0], max: [1, 1, 1] };
  const specs = (base) => Object.fromEntries(Array.from({ length: 1_001 }, (_, i) => [base + i, { geometryIndex: 0, bounds }]));
  const frags = (base) => Array.from({ length: 1_001 }, (_, i) => base + i);
  return { rootNodesA: [{ dbId: 1, fragments: frags(1_000) }], fragSpecsA: specs(1_000),
    rootNodesB: [{ dbId: 2, fragments: frags(5_000) }], fragSpecsB: specs(5_000) };
})();

test('the library still throws a message matching the pinned linear-ceiling matcher (T2 compatibility)', async () => {
  const { world, modelA, modelB } = await realWorld(CEILING_FIXTURE);
  await assert.rejects(
    () => world.findClashes({ source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [2] }] }, mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear' }),
    (err) => err.name === 'Error' && err.message.startsWith(LINEAR_CEILING_MESSAGE_PREFIX),
    'if this fails, the engine would classify a real capacity ceiling as failed:internal-error and fail the run',
  );
});

test('the executor maps that same real error to failed:capacity-exceeded', async () => {
  const { exec } = await realWorld(CEILING_FIXTURE);
  const outcome = await exec(realRequest({ mode: 'volume-overlap', broadPhase: 'linear',
    sourceDbIds: [1], targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [2] }] }));
  assert.equal(outcome.outcome, 'failed');
  assert.equal(outcome.failure.code, 'capacity-exceeded');
  assert.equal(outcome.failure.capacityKind, undefined, 'a plain Error carries no typed kind');
});
```

- [ ] **Step 6: Run the T2 tests and watch them pass.** `node --test test/clashtest/execution/localExecutor.realWorld.test.mjs` → 5 passing.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs: P4.7 executor error taxonomy`.

---

### Task P4.8: Lease handling and the bracketed scope-digest protocol

§7.4 and §16.3.2 — the part that makes invariant I-scope true rather than asserted.

**Files**
- Modify: `clashtest/execution/LocalUnitExecutor.js`
- Test: `test/clashtest/execution/localExecutor.scope.test.mjs`

**Interfaces**
- Consumes (**P3 `planning/scopeDigest.js`** — RECONCILED, duplicate-ownership **D1**): **`checkScopeBracket(scopeExpect, {enumerator, bindings, ctx}) → Promise<{proof: 'equal'|'drift'|'unverifiable', modelKeys: string[]}>`**, imported from `clashtest/planning/scopeDigest.js`. **`bindings` is a `Map<modelKey, Binding|null>`** — P4 passes its own `resolved.byKey` unchanged (`ResolvedBindings.byKey` is already that `Map`); P3 looks a model up by `entry.modelKey`, and a missing key or a `null` value is `unverifiable`, never `equal` (N10). **P4 implements no digest comparison and builds no expectation** — it does not import `compareScopeExpectation` either, because `checkScopeBracket` already folds it. The expectation arrives ready-made as **`request.materialized.scopeExpect`** (P3's `materializeUnit(plan, unit)`, row N16, which owns the R20-1 whole-model-source rule). This task calls `checkScopeBracket` **twice** — once before the `findClashes` call and once after (§7.1: the bracket is executed **per unit**) — and maps the two answers onto `outcome.scopeProof` / `failure.code` / `failure.modelKeys` per the table in this task, reporting the proof in the `UnitOutcome`. Rationale: §16.3.4's invariant I-scope cannot survive two copies of the comparison, and **P4 may not import from `run/`** (that would invert the master's dependency graph, since P6 depends on P4). See `interface-reconciliation.md` D1 and master §3's "P3 → P4 is a real module edge".
- Consumes (**P3 `planning/ElementEnumerator.js`**, indirectly): P4 **passes** the `enumerator` and an `EnumerationContext` `ctx = {checkpoint()}` through to `checkScopeBracket`; it does **not** call `digestScope(binding, scope, ctx)` itself. (`checkpoint()` is the enumeration context's, never a slicer method — row N6.)
- Consumes (**P1 `identity/ModelRegistry.js`** / the world): `world.isLeaseValid(lease)` is total and non-throwing (F5); `binding.lease` (`{model, epoch}`), `binding.bindingGeneration`, `binding.placementGeneration`. `bindingFor` already returns `null` for an invalid lease (row N10), so the explicit `lease == null` guard below is belt-and-braces, never the primary gate.
- **Lease-check ownership (duplicate-ownership D2, RESOLVED):** the **per-unit** `world.isLeaseValid(binding.lease)` pre-check of §7.4 is implemented **here**, in `LocalUnitExecutor` — the only component that holds the live bindings at call time. **P6** owns the **run-start binding snapshot** — the single `registry.snapshotBindings(modelKeys)` call whose frozen bindings *already* carry valid cached leases, which is why **P6 runs no `admitModel` sweep of its own** (controller ruling R7: the registry admitted lazily inside `snapshotBindings`, and P6's own test asserts `world.calls.admitModel === 0`) — and the run-level `model-evicted` settlement fact; P6 does **not** re-check leases per unit. P1's cross-phase note, which had assigned the per-unit check to P6, has been corrected.
- Produces: no new exports; the executor's outcome now carries a real `scopeProof`.

- [ ] **Step 1: Write the failing lease/digest test.**

```js
// test/clashtest/execution/localExecutor.scope.test.mjs
import { emptyClashResult } from '../support/index.mjs';                          // P0
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';  // P4-local
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';

const ok = emptyClashResult;
const exec = (deps) => createLocalUnitExecutor(deps);
const digestCalls = (enumerator) => enumerator.calls.filter((c) => c.kind === 'digestScope');

test('an invalid lease skips the unit WITHOUT calling findClashes', async () => {
  const deps = makeExecutorDeps({});
  deps.world.evictModel(deps.models['mk-b']);   // P1's lease world: the real eviction path
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'model-evicted', 'not-checked']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0, 'avoids a ModelEvictedError from admitModel and wasted work (F5)');
});

test('a pre-check digest mismatch is skipped:scope-drift and issues no call', async () => {
  const deps = makeExecutorDeps({});
  // P0's fake enumerator: `set(modelKey, patch)` mutates the configured content, which is exactly
  // "the model changed between planning and execution".
  deps.enumerator.set('mk-b', { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['skipped', 'scope-drift', 'drift']);
  assert.deepEqual(outcome.failure.modelKeys, ['mk-b']);
  assert.equal(deps.world.calls.length, 0);
});

test('a post-check mismatch DISCARDS: pairs and diagnostics are not merged', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script((query, call) => {
    deps.enumerator.set('mk-b', { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] });
    return {
      pairs: [{ source: { modelId: 1, dbId: 10, model: {} }, target: { modelId: 2, dbId: 20, model: {} }, type: 'volume-overlap', witness: null }],
      statistics: { diagnostics: [{ scope: 'fragment', reason: 'inconclusive-crossing', role: 'source', fragment: { modelId: 1, dbId: 10, fragId: 1 } }] },
    };
  });
  const outcome = await exec(deps)(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], ['discarded', 'scope-drift', 'drift']);
  assert.deepEqual(outcome.pairs, []);
  assert.deepEqual(outcome.diagnostics, []);
});

test('a digest that cannot be computed fails CLOSED to scope-unverifiable, pre and post', async () => {
  for (const [firstFailingCall, expected] of [[1, 'skipped'], [3, 'discarded']]) {
    const deps = makeExecutorDeps({});
    deps.world.script(ok);
    // P0's `onCall(fn)` runs inside every enumerator call: the 1st digestScope is the pre-check's
    // first scope, the 3rd is the post-check's first (two scopes per bracket).
    deps.enumerator.onCall((call) => { if (call.index + 1 >= firstFailingCall) throw new Error('digest unavailable'); });
    const outcome = await exec(deps)(makeRequest({}));
    assert.deepEqual([outcome.outcome, outcome.failure.code, outcome.scopeProof], [expected, 'scope-unverifiable', 'unverifiable']);
  }
});

test('every scope of the unit is re-digested twice, bracketing the call', async () => {
  // The CONTENT of the expectation — including R20-1's whole-model-source population entry — is
  // P3's (`materializeUnit`), and its rule is tested there. What P4 owns, and what this pins, is
  // that the executor brackets the call with the unit's WHOLE `scopeExpect`, pre and post.
  const deps = makeExecutorDeps({});
  deps.world.script(ok);
  await exec(deps)(makeRequest({ scopeExpect: [
    { modelKey: 'mk-a', role: 'source', scope: 'whole', population: { count: 3, digest: 'sha256:p' } },
    { modelKey: 'mk-b', role: 'target', scope: 'roots', roots: [{ dbId: 20, subtreeDigest: 'sha256:c' }] },
  ] }));
  assert.deepEqual(digestCalls(deps.enumerator).map((c) => `${c.modelKey}:${c.scope === 'whole' ? 'whole' : 'roots'}`),
    ['mk-a:whole', 'mk-b:roots', 'mk-a:whole', 'mk-b:roots']);
});

test('scopeProof equal is the ONLY path to evaluated (invariant I-scope)', async () => {
  // SCOPE_SCENARIOS = the cross-product of {pre ok/drift/throw} × {post ok/drift/throw} × {call
  // resolves / throws each §7.5 signal}, each run through the executor.
  for (const o of await Promise.all(SCOPE_SCENARIOS.map(runScenario))) {
    if (o.outcome === 'evaluated') assert.equal(o.scopeProof, 'equal');
    if (o.scopeProof !== 'equal') assert.notEqual(o.outcome, 'evaluated');
  }
});

test('generations are read at attempt start and end and list every participant exactly once', async () => {
  const deps = makeExecutorDeps({});
  deps.world.script(ok);
  const outcome = await exec(deps)(makeRequest({}));
  for (const side of ['start', 'end']) assert.deepEqual(outcome.generations[side].map((g) => g.modelKey), ['mk-a', 'mk-b']);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/localExecutor.scope.test.mjs` → the executor still has no lease or digest step, so every test fails.

- [ ] **Step 3: Implement the lease gate and the bracketed protocol.** In the executor, before the call:

```js
// §7.4. Every model the unit touches, checked BEFORE the call. isLeaseValid is total and
// non-throwing (F5), so this never needs a try/catch and never costs an epoch.
//
// Row N10: `registry.bindingFor(modelKey)` returns **`null`** for a model that was never registered,
// was unregistered, OR whose lease the world no longer honours — there is no `dead` flag. So
// `resolveUnitBindings` stores `null` in `byKey` for such a model and the gate must iterate the
// unit's PARTICIPANTS, not `byKey.values()`: filtering the values would both dereference `null` and
// lose the modelKey of the very model that died.
const participantKeys = request.snapshot.map((s) => s.modelKey).sort();
const dead = participantKeys.filter((modelKey) => {
  const binding = resolved.byKey.get(modelKey) ?? null;
  return binding === null || !world.isLeaseValid(binding.lease);
});
if (dead.length > 0) {
  return skipped('model-evicted', { modelKeys: dead, scopeProof: 'not-checked' });
}
// Past this point every participant has a live binding, so the query builder and the generation
// reads may dereference `resolved.byKey.get(k).model` without a null check.

// §16.3.2 step 1 — pre-check. P3 owns BOTH halves of the comparison: the expectation
// (`materializeUnit(...).scopeExpect`, incl. the R20-1 whole-model-source rule) and the
// re-digest-and-compare fold (`checkScopeBracket`, planning/scopeDigest.js). P4 owns only WHEN to
// bracket and what the answer means for the outcome. Drift ⇒ the unit is NOT ISSUED.
import { checkScopeBracket } from '../planning/scopeDigest.js';   // P3 — never from run/ (D1)

const bracket = () => checkScopeBracket(request.materialized.scopeExpect,
  { enumerator, bindings: resolved.byKey, ctx });

const pre = await bracket();
if (pre.proof === 'drift') return skipped('scope-drift', { modelKeys: pre.modelKeys, scopeProof: 'drift' });
if (pre.proof === 'unverifiable') return skipped('scope-unverifiable', { modelKeys: pre.modelKeys, scopeProof: 'unverifiable' });
```

and after it settles (resolved **or** thrown-and-mapped):

```js
const post = await bracket();
if (post.proof === 'drift') return discarded('scope-drift', { modelKeys: post.modelKeys, scopeProof: 'drift' });
if (post.proof === 'unverifiable') return discarded('scope-unverifiable', { modelKeys: post.modelKeys, scopeProof: 'unverifiable' });
```

`checkScopeBracket` returns `{proof: 'equal'|'drift'|'unverifiable', modelKeys}`; it re-`digestScope`s every scope the expectation lists and folds P3's `compareScopeExpectation` over the answers (`unverifiable` absorbs `equal`, `drift` wins over both), including the "any throw from `digestScope` ⇒ `unverifiable`" rule. **P4 implements no digest comparison of its own and builds no expectation** — both would be the second copy §16.3.4's invariant I-scope cannot survive (duplicate-ownership D1). Each bracket call is independent and both compare against the **planning-time** expectation, which is what still catches a grow-and-revert between the two checks. P4's own contribution is the mapping below: `skipped`/`discarded` outcomes carry `pairs: []`, `diagnostics: []`, `statistics: {}` — nothing from a drifted call is merged — and `scopeProof` is written from `proof`.

The post-check runs **even when the call threw**, and §7.5's row for the thrown signal supplies `failure.code`.

**CORRECTED (owner-authorized C1 remediation, 2026-09-22, Option B — this supersedes the sketch immediately above, which unconditionally early-returns).** This paragraph previously read: *"Precedence when both are non-`equal`: scope drift wins over the thrown cause, because drift invalidates the run (§16.3 item 3) while most thrown causes only gap it — the fail-closed direction."* That claim and that citation were both wrong. §16.3 item 3 defines what a `scope-drift` **outcome** does to run status; it says nothing about precedence against a thrown failure. And for `world-disposed`/`internal-error`/`result-cap` the argument inverts: those resolve to `failed`, which §16.7 Table A **part B** resolves *before* `invalidated`, so masking them with drift is fail-**open**.

What is implemented is **fact-preserving, and reports both facts**, so nothing is destroyed at the P4 boundary (P6's accepted `factsFromOutcome` resolver reads the two independently):

- `failure.code` is **always** the classified thrown cause (§7.5), whatever the bracket said;
- `scopeProof` is **always** the true bracket answer (`equal`/`drift`/`unverifiable`), whatever was thrown;
- only the coarse outcome **kind** is chosen, by comparing **§16.7 Table A part A** ranks — U1 `world-disposed` > U2 `internal-error` > U3 `result-cap` > U4 `input-changed` > U5 `scope-drift` > U6 `model-evicted` > U7 `scope-unverifiable` > U8 everything else. When the bracket answer outranks the thrown cause the kind is `discarded` (the call was issued and its result thrown away); otherwise the thrown cause keeps its own kind.

The same Table A order governs the **pre**-check: a live participant's `scope-drift` (U5) settles ahead of another participant's dead/re-bound lease (U6), which in turn settles ahead of `scope-unverifiable` (U7). The lease gate therefore no longer returns before the bracket runs; it only forces every unheld participant to a `null` binding so the bracket can never digest a re-registered model (§16.1, H5).

Residual, explicitly carried forward and **not** closed by Option B: when U5 drift legitimately beats a U8 cause, Table A would also retain that cause as a *secondary* cause, and `UnitOutcome` has no field for one — the cause stays visible in `failure.code`, but the ordering between the two is P6's to re-derive. Closing it is option (A) in the C1 record and needs an owner-approved schema change.

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/localExecutor.scope.test.mjs` → 7 passing.

- [ ] **Step 5: Run the whole phase suite.** `node --test test/clashtest/execution/*.test.mjs` → all green; no regression in P4.6/P4.7.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).** `docs: P4.8 lease gate and bracketed scope proof`.

---

### Task P4.9: Cross-unit aggregation — `ProjectedDiagnostic` → `NormalizedDiagnostic`

The one bridge between the two DTOs (§11.2, §12.4), with the exactness invariant as an assertion rather than a comment.

**Files**
- Modify: `clashtest/execution/diagnostics.js`
- Test: `test/clashtest/execution/diagnostics.aggregate.test.mjs`

**Interfaces**
- Consumes: `UnitOutcome` (P4.5), P0's slicer, **Assumed (P0 `options.js`)** `RUN_OPTION_DEFAULTS.maxRetainedDiagnostics / .maxDistinctReasons / .maxUnitIdsPerDiagnostic`.
- Produces: `createDiagnosticAggregator(opts)`, `createStatisticsAccumulator()`.

- [ ] **Step 1: Write the failing aggregation test.**

```js
// test/clashtest/execution/diagnostics.aggregate.test.mjs
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';   // never hard-code the numbers
import { createSlicer } from '../../../clashtest/util/slicer.js';      // P0 — the only slicer factory

/** A never-due slicer: a constant clock means `tick()` always returns `undefined` (P0, row N6). */
const neverYields = () => createSlicer({ now: () => 0, yieldToScheduler: async () => {} });

const agg = (over = {}) => createDiagnosticAggregator({
  maxRetainedDiagnostics: RUN_OPTION_DEFAULTS.maxRetainedDiagnostics,
  maxDistinctReasons: RUN_OPTION_DEFAULTS.maxDistinctReasons,
  maxUnitIdsPerDiagnostic: RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic,
  slicer: neverYields(), ...over,
});

const many = (n, reason, from = 0) => Array.from({ length: n },
  (_, i) => projected(typeof reason === 'function' ? reason(i) : reason, { modelKey: 'mk-a', dbId: from + i, fragId: from + i }));

test('the projection is the identity on shared fields; only occurrences and unitIds are added', async () => {
  const a = agg();
  const d = projected('geometry-not-yet-available', { modelKey: 'mk-a', dbId: 5, fragId: 1 });
  await a.addUnit('1.0', outcomeWith([d]));
  await a.addUnit('1.1', outcomeWith([d]));
  const [n] = a.snapshot().diagnostics;
  assert.deepEqual(Object.fromEntries(Object.entries(n).filter(([k]) => k !== 'occurrences' && k !== 'unitIds')), d);
  assert.equal(n.occurrences, 2);
  assert.deepEqual(n.unitIds, ['1.0', '1.1']);
});

test('unitIds are capped but occurrences are not', async () => {
  const a = agg();
  const d = projected('non-manifold-component', { modelKey: 'mk-a', dbId: 5, fragId: 1 });
  for (let i = 0; i < 20; i++) await a.addUnit(`1.${i}`, outcomeWith([d]));
  const [n] = a.snapshot().diagnostics;
  assert.equal(n.occurrences, 20);
  assert.equal(n.unitIds.length, RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic);
});

test('a null-modelKey diagnostic is NEVER merged across units', async () => {
  const a = agg();
  const d = projected('fragment-owner-unresolvable', { modelKey: null, dbId: null, fragId: 3 }, 'unit');
  await a.addUnit('1.0', outcomeWith([d]));
  await a.addUnit('1.1', outcomeWith([d]));
  assert.equal(a.snapshot().diagnostics.length, 2, 'its unit attribution is per unit');
});

test('a whole-array overflow marker keeps totals exact, never inflates the affecting count, and taints', async () => {
  const a = agg();
  const { unitTaints } = await a.addUnit('1.0', { ...outcomeWith([]), diagnosticOverflowLength: 300_000 });
  const s = a.snapshot();
  assert.equal(s.total, 300_000);
  assert.equal(s.unclassifiedOccurrences, 300_000);
  assert.equal(s.completenessAffectingCount, 0, 'never inflated to look exact');
  assert.equal(s.completenessAffectingUpperBound, 300_000);
  assert.deepEqual(s.countsByReason, []);
  assert.deepEqual(unitTaints, [{ kind: 'unit', modelKey: null, reason: 'diagnostic-overflow', occurrences: 300_000 }]);
});

test('100,000 distinct reasons: retained keys are capped, totals stay exact, Σ invariant holds', async () => {
  const a = agg();
  const { unitTaints } = await a.addUnit('1.0', outcomeWith(many(100_000, (i) => `r${String(i).padStart(6, '0')}`)));
  const s = a.snapshot();
  assert.equal(s.total, 100_000);
  assert.equal(s.completenessAffectingCount, 100_000, 'all examined');
  assert.equal(s.unclassifiedOccurrences, 0);
  assert.ok(s.countsByReason.length <= RUN_OPTION_DEFAULTS.maxDistinctReasons);
  assert.equal(s.countsByReason.reduce((n, c) => n + c.count, 0) + s.omittedReasonOccurrences + s.unclassifiedOccurrences,
    s.total, 'Σ invariant (§12.4)');
  assert.deepEqual(unitTaints.map((t) => t.reason), ['diagnostic-reason-overflow']);
});

test('only BENIGN omissions add no overflow taint', async () => {
  const a = agg({ maxDistinctReasons: 1 });
  const { unitTaints } = await a.addUnit('1.0', outcomeWith(many(200, 'witness-unavailable')));
  assert.deepEqual(unitTaints, []);
  assert.equal(a.snapshot().completenessAffectingCount, 0);
});

test('the retained key set is identical for shuffled diagnostic order', async () => {
  const keys = async (ds) => { const a = agg({ maxDistinctReasons: 4 }); await a.addUnit('1.0', outcomeWith(ds)); return a.snapshot().countsByReason.map((c) => `${c.scope}|${c.reason}`); };
  const base = ['e', 'b', 'a', 'd', 'c', 'f'].map((r) => projected(`reason-${r}`, { modelKey: 'mk-a', dbId: 1, fragId: 1 }));
  assert.deepEqual(await keys(base), await keys([...base].reverse()));
});

test('the retained-diagnostic cap truncates detail in canonical order but never a total', async () => {
  const a = agg({ maxRetainedDiagnostics: 10 });
  await a.addUnit('1.0', outcomeWith(many(50, 'inconclusive-crossing')));
  const s = a.snapshot();
  assert.equal(s.diagnostics.length, 10);
  assert.equal(s.truncated, true);
  assert.equal(s.total, 50);
  assert.deepEqual(s.diagnostics.map((x) => x.fragment.dbId), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('geometryReadinessOccurrences is an exact independent counter', async () => {
  const a = agg({ maxDistinctReasons: 1 });
  await a.addUnit('1.0', outcomeWith([...many(7, 'geometry-not-yet-available'), ...many(3, 'non-manifold-component', 100)]));
  assert.equal(a.snapshot().geometryReadinessOccurrences, 7, 'independent of countsByReason retention');
});

test('library statistics aggregate as sums plus libraryMsTotal and maxUnitMs (§12.6)', () => {
  const acc = createStatisticsAccumulator();
  acc.add({ broadPhasePairs: 3, totalMs: 10 }, 12);   // (statistics, unit durationMs)
  acc.add({ broadPhasePairs: 4, totalMs: 20 }, 30);
  const s = acc.snapshot();
  assert.equal(s.broadPhasePairs, 7);
  assert.equal(s.libraryMsTotal, 30, 'Σ of the library\'s own in-call totalMs, not of unit durations');
  assert.equal(s.maxUnitMs, 30, 'max unit durationMs');
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/execution/diagnostics.aggregate.test.mjs` → `createDiagnosticAggregator is not a function`.

- [ ] **Step 3: Implement the aggregator.** The dedup key (§12.4) and the admission rules:

```js
/**
 * De-duplication key (§12.4): fragment scope by (reason, modelKey, fragId); pair scope by (reason,
 * canonical pair of (modelKey, fragId)) — `fragments.first/second` are ALREADY canonical (P4.2). A
 * diagnostic with a null modelKey is never merged with one from another unit, so its key carries the
 * producing unitId.
 */
function dedupKey(d, unitId) {
  const nullish = d.scope === 'fragment'
    ? d.fragment.modelKey === null
    : d.fragments.first.modelKey === null || d.fragments.second.modelKey === null;
  const operands = d.scope === 'fragment'
    ? [`${d.fragment.modelKey}\u0001${d.fragment.fragId}`]
    : [`${d.fragments.first.modelKey}\u0001${d.fragments.first.fragId}`,
       `${d.fragments.second.modelKey}\u0001${d.fragments.second.fragId}`];
  return [d.scope, d.reason, ...operands, nullish ? unitId : ''].join('\u0000');
}
```

`addUnit(unitId, outcome)`:

1. If `outcome.diagnosticOverflowLength` is present: `total += n`, `unclassifiedOccurrences += n`, return one unit taint `{kind:'unit', modelKey: null, reason:'diagnostic-overflow', occurrences: n}`. **Nothing else** — the array was never examined, so `completenessAffectingCount` and `countsByReason` are untouched.
2. Otherwise iterate once, ticking the slicer: `total++`; `completenessAffectingCount += d.completenessAffecting ? 1 : 0`; `geometryReadinessOccurrences += d.reason === 'geometry-not-yet-available' ? 1 : 0`; admit `(scope, reason)` into `countsByReason` if it is already present or the map is below `maxDistinctReasons` — admission order is **unit order, then code-unit order of the keys new to that unit** (§12.4), so collect this unit's new keys, sort them, and admit in that order *before* counting; otherwise `omittedReasonOccurrences++` and set `sawOmittedAffecting ||= d.completenessAffecting`. Merge into the dedup map (occurrences++, push `unitId` while `unitIds.length < maxUnitIdsPerDiagnostic`).
3. Return `[{kind:'unit', modelKey:null, reason:'diagnostic-reason-overflow', occurrences: omittedThisUnit}]` iff `sawOmittedAffecting` — fail-safe, benign-only omissions add no taint.

`snapshot()` sorts the dedup map into canonical order — `(scope, reason, modelKey…, fragId…)`, code-unit order for strings and numeric for ids, with a `null` `modelKey` sorting last — truncates to `maxRetainedDiagnostics` setting `truncated`, computes `completenessAffectingUpperBound = completenessAffectingCount + unclassifiedOccurrences`, and **asserts** `Σ countsByReason + omittedReasonOccurrences + unclassifiedOccurrences === total`; a violation is an engine defect, surfaced as a thrown internal error rather than a silently wrong number.

`createStatisticsAccumulator()` sums each `LIBRARY_STATISTICS_KEYS` entry, tracks `libraryMsTotal` (Σ `durationMs`) and `maxUnitMs`, and deliberately carries no `blasBuilt`/`blasCacheHits` *claim* (the library reports them as constant `0`; §12.6).

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/execution/diagnostics.aggregate.test.mjs` → 11 passing.

- [ ] **Step 5: Run the whole phase suite and the full project suite.** `node --test test/clashtest/execution/*.test.mjs` then `npm test` → all green, no collision-library regression.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).** `docs: P4.9 cross-unit diagnostic aggregation`.

---

## Verification / acceptance for P4

Run from the repo root. The whole phase must also pass under `npm test` with no server, no APS credentials and no network.

| # | Check | Command | Spec AC |
|---|---|---|---|
| 1 | Predicate is table-driven over every known reason; unknown fails safe | `node --test test/clashtest/execution/diagnostics.predicate.test.mjs` | AC-10 |
| 2 | Drift guard fails when `collision/` gains an unclassified `reason:` literal | same file, test `collision/ gains no reason literal…` | AC-10 |
| 3 | Attribution classes incl. `dbId: null` and ambiguous `modelId ⇒ null` | `node --test test/clashtest/execution/diagnostics.projection.test.mjs` | AC-10, AC-3 |
| 4 | Oversized `reason` / non-plain / unknown shape are **rejected**, never collapsed | same file, test `illegal diagnostics are REJECTED…` | AC-3 |
| 5 | Over-cap arrays are not iterated (element-access spy); marker crosses instead | `node --test test/clashtest/execution/diagnostics.overflow.test.mjs` | AC-3 |
| 6 | High-cardinality legal diagnostics are all projected | same file | AC-3 |
| 7 | Per-unit taint table exact; both collapse triggers produce `taint-overflow` | `node --test test/clashtest/execution/diagnostics.taints.test.mjs` | AC-10 |
| 8 | Full `validateUnitOutcome` rejection battery (35 rows) + never-throws | `node --test test/clashtest/execution/unitOutcome.validate.test.mjs` | AC-3 |
| 9 | Call shape: `targets` always, `groupBy:'dbId'`, one mode, `clearance` iff clearance | `node --test test/clashtest/execution/localExecutor.call.test.mjs` | AC-3 |
| 10 | **F4**: `structuredClone(outcome)` succeeds on an outcome built from pairs carrying live `Model`s | same file + `localExecutor.realWorld.test.mjs` | AC-3 |
| 11 | **F3**: library pair order is preserved verbatim, not canonicalized here | `localExecutor.call.test.mjs` | AC-3 |
| 12 | Every §7.5 row, incl. the plain-`Error` linear ceiling and a non-`Error` throw | `node --test test/clashtest/execution/localExecutor.errors.test.mjs` | AC-3 |
| 13 | **T2**: real `CollisionWorld` evaluated outcome + real unattributable `dbId:null` diagnostics | `node --test test/clashtest/execution/localExecutor.realWorld.test.mjs` | AC-3, AC-10 |
| 14 | **T2**: the library's linear-ceiling message still matches the pinned matcher | same file | AC-3 |
| 15 | **T2**: `LIBRARY_STATISTICS_KEYS` does not drift from the real statistics shape | same file | AC-3 |
| 16 | Lease gate skips without calling; drift/unverifiable pre and post; I-scope holds; every scope re-digested twice | `node --test test/clashtest/execution/localExecutor.scope.test.mjs` | AC-3, AC-8 (executor half) |
| 16a | **D1 single-owner bracket:** the bracket comes from P3 and is never re-implemented | `grep -rn "checkScopeBracket" clashtest/execution/` names only an import from `../planning/scopeDigest.js`; `grep -rn "compareScopeExpectation\|subtreeDigest ===\|buildScopeExpect" clashtest/execution/` returns nothing | AC-8, AC-20(c) |
| 16b | **No `execution/` → `run/` edge** (the cycle D1 exists to avoid) | `grep -rn "from '\.\./run/" clashtest/execution/` returns nothing | master §3 |
| 17 | Cross-unit dedup, unit-id cap, null-`modelKey` never merged, Σ invariant | `node --test test/clashtest/execution/diagnostics.aggregate.test.mjs` | AC-10, AC-3 |
| 18 | Whole phase + whole repo green | `node --test test/clashtest/execution/*.test.mjs` then `npm test` | master §5.2 |

**Phase exit criteria.** All 20 checks pass; `clashtest/execution/*` imports nothing from `collision/`, `wwwroot/`, `three` or the Viewer (assert by `grep -rn "from '\.\./\.\./collision" clashtest/` returning nothing) and nothing from `clashtest/run/` (check 16b); no numeric cap is written as a literal in a test (every one reads `RUN_OPTION_DEFAULTS`); no file under `test/clashtest/support/` owned by P0 or P1 is modified (`git diff --name-only` shows only the three P4 support files of the File structure table).

---

## Spec coverage

| Spec § | Covered by |
|---|---|
| §7.1 `ExecutionRequest` closed schema incl. `limits` | P4.5 (`validateExecutionRequest`) |
| §7.1 `UnitOutcome` closed schema, boundary validation, H7.1 rejection | P4.5 |
| §7.1 H7.2 overflow with exact totals; executor-side projection caps (R11-6) | P4.3 (executor half), P4.9 (engine half) |
| §7.1 trust boundary (a structurally valid lie is accepted) | P4.5, last test |
| §7.2 the exact `findClashes` call | P4.6 (`buildFindClashesQuery`), verified T2 in P4.6/P4.7 |
| §7.2 linear-oracle ceiling + pinned matcher | P4.7 |
| §7.3 sequential execution | **Not P4** — P4 provides only the per-unit call; the coordinator is P6 |
| §7.4 lease handling, identify the dead binding by re-checking leases | P4.8, P4.7 (`ModelEvictedError` row) |
| §7.5 error taxonomy, every row | P4.7 |
| §8.3 unit-cause enum | P4.5 (`UNIT_CAUSES`) |
| §11.2 `UnitOutcome`, `ProjectedDiagnostic` (errata E4) | P4.2, P4.5 |
| §11.2 `modelId → modelKey` via the unit binding table; ambiguous ⇒ `null` | P4.2 |
| §12.1 thrown vs diagnosed preserved | P4.7 (thrown) + P4.6 (diagnosed) |
| §12.2 `NormalizedDiagnostic` = projected + `occurrences`/`unitIds` | P4.9 |
| §12.2.1 attribution classes; `dbId: null` first-class; per-unit `taints` | P4.2, P4.4 |
| §12.3 the ONE predicate + known-reason table + drift guard | P4.1 |
| §12.4 dedup, caps, Σ invariant, `geometryReadinessOccurrences` | P4.9 |
| §12.5 per-unit taint **derivation** | P4.4. The `getPairStatus`/`getElementStatus` taint **rules** are ResultSet-level and belong to **P5 `results/status.js`** (duplicate-ownership D4) — including the rule-1 completeness filter handed over as register S-P4-4 (open items, contradiction 4). |
| §12.6 library statistics passthrough | P4.9 (`createStatisticsAccumulator`), P4.3 (`projectStatistics`) |
| §16.3.2 bracketed scope-digest protocol (executor side) | P4.8 — *when* to bracket and the outcome mapping only; the expectation (`materializeUnit(...).scopeExpect`) and the comparison (`checkScopeBracket` / `compareScopeExpectation`) are **P3's** (duplicate-ownership D1) |
| §17.1 `maxPairsPerOutcome`, `maxDiagnosticsPerOutcome`, `maxDistinctReasons`, `maxRetainedDiagnostics`, `maxUnitIdsPerDiagnostic`, `maxElementTaintsPerUnit` | consumed from P0 `options.js`; never literal in P4 |
| §19.2 mapping table (the library call built from a unit) | P4.6 |

---

## Gates and open items

### Master gates that touch this phase

| Gate | Effect on P4 |
|---|---|
| **G-PLAN** | Blocks the start of P4.1, as for every phase. |
| **G-CAL** | Blocks *freezing* `maxDiagnosticsPerOutcome` / `maxPairsPerOutcome` / `maxElementTaintsPerUnit` as deployable constants. P4 reads them from P0's `options.js` and never hard-codes them, so no P4 task is blocked. AC-12's measurement of the executor's own synchronous projection span (item 5 below) is the P4-relevant input. |
| **G-OQ4** | Does **not** block P4. The scope-digest protocol is tested against a fake `ElementEnumerator`; the real Viewer enumerator is the adapter package. |
| G-OQ1 / G-OQ16 / G-OQ17 / G-REMOTE / G-RESP | No effect on P4. |

### Implementation-level items deliberately left to implementers

1. **The elided branches of `validateUnitOutcome` (P4.5 step 3).** Every one is pinned by a named test row; the plan gives the guard order and the issue codes but not 35 near-identical `if`s. *Reason:* mechanical, and the test list is the specification.
2. **`cloneEvidence`'s exact whitelist walk.** The rule is given (null / finite number / the two witness shapes, `-0` → `0`, anything else → a sentinel the validator rejects); the traversal is trivial. *Reason:* mechanical.
3. **Slice sizing inside `projectDiagnostics` and `addUnit`.** The plan requires a `slicer.tick()` per item; whether an implementer ticks every item or every *n* items is a measurement question (AC-12), not a correctness one, as long as no slice exceeds `sliceBudgetMs`. *Reason:* needs G-CAL numbers.
4. **The bodies of `support/executionWorld.mjs` and `support/executionRequests.mjs`.** The option names are no longer open: P4's tests are written against P0's and P1's **shipped** support APIs verbatim (`createFakeWorld({defaultResult?})` + `script(...)` + `calls[i].query`, `createFakeEnumerator({models}).set/onCall/calls`, `createFakeClock`, `makeLeaseWorld()`), and the two P4 files only compose them — the invented `onFindClashes` / `leases` / `digestsAfterCall` / `throwOn` knobs are gone. **One constraint on the body is not free:** `createExecutionWorld` passes P0's whole fake-world surface through verbatim (`calls`, `script`, **`hold`**, `inFlight`, `maxInFlight`, `disposed`, `findClashes`) — P7 Task P7.5 drives `hold()` through this double — and the pass-through is pinned by the first test of `localExecutor.call.test.mjs`. P0's and P1's own support files are never edited (P0 extension rule 2, master §2.1 rule 5). *Reason:* mechanical composition.

### Items found in the spec that look contradictory — reported, not resolved by redesign

1. **`maxDistinctReasons` "per outcome" has nowhere to live in the closed `UnitOutcome`.** §7.1 H7.2 says at most `maxDistinctReasons` distinct `(scope, reason)` keys are retained "per outcome", with the surplus added to "the outcome's single `omittedReasonOccurrences` counter" — but §11.2's `UnitOutcome` typedef has no `omittedReasonOccurrences` field, and §7.1 declares the schema closed with unknown fields ⇒ malformed. §11.2 separately requires the executor to return each unit's diagnostics "**before** any de-duplication so the engine can build the per-unit `taints` table", which a reason-thinned array cannot support. **Simplest mechanism preserving the observable invariants:** the executor applies only the two whole-array caps; the *engine-side* aggregator applies `maxDistinctReasons` and owns `omittedReasonOccurrences` (§12.4 already places that counter at run level). Every externally observable invariant — exact `total`, exact `completenessAffectingCount` over examined diagnostics, the Σ identity, fail-safe `diagnostic-reason-overflow` taints, the bounded executor payload — is preserved. **Register S-P4-1, APPLIED as spec erratum A4 (owner-authorized 2026-09-21):** §7.1 H7.2's reason cap moves to the engine side, and §11.2's `UnitOutcome` stays closed and is **not** widened. The mechanism above is the authorized reading; **no implementation step changes.**
2. **`statistics-overflow` has no reachable trigger.** §7.1 lists "`statistics` overflow collapses to a `statistics-overflow` sentinel" alongside "statistics restricted to the known numeric schema (unknown keys rejected)", and AC-3's rejection battery explicitly includes "unknown statistics keys". Under a closed 23-key numeric schema there is no legal-but-oversized statistics object left to collapse. P4 implements **rejection** (AC-3 is explicit) and keeps `'statistics-overflow'` reserved as a unit-taint reason string in §6.5.1's table without emitting it. If the spec intends the opposite, this is a one-line change in `projectStatistics`.
3. **Lease checking is assigned to two different owners** (register **S-P4-3**). §7.4 says "the *engine* `admitModel`s every bound model … Before every unit it checks `world.isLeaseValid(lease)`"; §7.1's division-of-responsibility paragraph says "the *executor* … checks leases (§7.4)". **SETTLED as duplicate-ownership D2:** the per-unit check is the executor's (§7.1 is the more specific statement, and it is the only place that has the live bindings); the run-start **binding snapshot** is P6's — one `snapshotBindings` call, **no second `admitModel` sweep** (ruling R7). Recorded in P4.8's *Interfaces*; nothing is left for the controller here.
4. **Taint rule 1 vs. a benign `witness-unavailable`** (register **S-P4-4**, **APPLIED as spec erratum A5 — owner-authorized 2026-09-21**: the completeness filter is verdict-only at §12.5 rule 1, §12.2.1's per-unit table stays unfiltered, and a non-completeness-affecting taint is still listed in `caveats[]`). §12.2.1 builds the per-unit taint table from the unit's diagnostics with **no** completeness filter; §12.5 taint rule 1 then makes a pair `covered-caveated` if the unit has *any* `element` entry naming either owner. Read literally, a `witness-unavailable` diagnostic — explicitly the one reason that leaves a verdict complete — would prevent a clean absence, contradicting §12.3's carve-out and README M2.1. **SETTLED at plan level:** P4 records the table unfiltered (it is the evidence base for later rules and for the ledger), and **P5's `results/status.js` applies the filter at rule 1** — written into P5's Gates item 6 with a test obligation on both halves. **Do not resolve this by filtering in P4** — that would silently drop evidence from the ledger.
5. **`ProjectedDiagnostic` has no home for a pair-scoped `role`.** `collision/CollisionWorld.js`'s `attach()` forwards a top-level `role` onto pair-scoped diagnostics when the inner diagnostic carries one, but §11.2's `ProjectedDiagnostic` places `role` only inside `fragment` (fragment scope). P4 drops it, on the grounds that the canonical `fragments.first/second` already identify both operands and the DTO is closed. No observable invariant depends on it; recorded in case the Panel later wants it.
6. **The executor's own projection pass is a synchronous main-thread span bounded only by `maxDiagnosticsPerOutcome` (200,000).** §17.3 forbids an engine-owned synchronous span above `frameBudgetMs`, which is why P4 slices the pass through P0's slicer — but the *size* at which that pass must yield is exactly an AC-12 measurement. Noted as a G-CAL input, not resolved here.

---

## Conformance check

The mechanical pass run after this file's executable steps were rewritten against the producing phases' *Phase interface summaries* and [`interface-reconciliation.md`](interface-reconciliation.md). It greps for **every consumer-assumed spelling the register's name table records as wrong**, plus the four invented test-double knobs this file used to carry. The unit of the check is **the code**, so the greps run over the file's fenced blocks only — prose may name a dead identifier in order to forbid it, code may not.

```sh
# 1. Extract every JS block in this file (the executable steps), excluding this section's own
#    shell block, which necessarily names the forbidden identifiers.
awk '/^```js/{f=1;next} /^```/{f=0} f' docs/superpowers/plans/federated-clash-test-core/p4-executor-diagnostics.md > /tmp/p4-code.txt

# 2. Every consumer-assumed old name from the register's name table (N1–N34) and D1–D4,
#    plus this file's own superseded local names.
grep -nE 'digestOf|digestSync|ownKeysOf|readOwnValue|prototypeIsPlain|\.step\(|runSliced|\.reset\(|\.dead\b|pairSemanticsForMode|resolveForRun|buildScopeExpect|checkScopes|splitUnit|aggregateDiagnostics|readDiagnostics|createResultSetDraft|mergeUnit|recordUnit|recordPlanningGap|sealResultSet|startPersistence|attachSealed|classOf|handBackUnsaved|disposeAll|captureResultSet|captureDefinition|validateResultSet|freshnessStateOf|\.submit\(|activeRunIds|\.drain\(|derive/status|derive/ledgerReader|\.execute\(|onFindClashes|leases:|digestsAfterCall|throwOn|ownerCheck|ownerOracle|malformedRequestOutcome|request\.scopeExpect' /tmp/p4-code.txt

# 3. The two rules this file cannot break without inverting the dependency graph (D1).
grep -nE "from '\.\./run/" /tmp/p4-code.txt
grep -nE 'compareScopeExpectation' /tmp/p4-code.txt
```

**Result: every command above returns no lines (`grep` exit status 1).** Checked names, grouped by the register row that killed them:

| Register row | Consumer-assumed name(s) grepped | Hits in P4 code |
|---|---|---|
| N3, N5 | `digestOf`, `digestSync` | 0 |
| N4 | `ownKeysOf`, `readOwnValue`, `prototypeIsPlain` | 0 |
| N6 | `.step(`, `runSliced`, **`.reset(`** | 0 — `.reset()` was the live defect: P4.3 assumed it and `projectDiagnostics` called it; P0's slicer has no such method |
| N10 | `.dead` | 0 |
| N13, N14 | `pairSemanticsForMode`, a supplied `pairSemantics` | 0 (P4 handles no pair ids) |
| N17 / R8 | `splitUnit` | 0 (P4 never splits; `planSplit` is P3's, called by P6) |
| N20 / D3 | `aggregateDiagnostics`, `readDiagnostics` | 0 |
| N21, N22, N24 | `createResultSetDraft`, `mergeUnit`, `recordUnit`, `recordPlanningGap`, `sealResultSet`, `startPersistence` | 0 |
| N23 | `attachSealed`, `classOf`, `handBackUnsaved`, `disposeAll` | 0 |
| N25 | `.submit(`, `activeRunIds`, `.drain(` | 0 |
| N26 | `.execute(` (the object-with-a-method shape P7 assumed) | 0 — `createLocalUnitExecutor` returns the function form |
| N27 | `resolveForRun` | 0 |
| N29, N30 | `captureResultSet`, `captureDefinition`, `validateResultSet` | 0 |
| N19 | `freshnessStateOf` | 0 |
| D1 | `buildScopeExpect`, **`checkScopes`**, `compareScopeExpectation`, `from '../run/` | 0 — `checkScopes` was the live defect: P4.8's implementation step carried a third copy of the digest comparison, now replaced by a call to P3's `checkScopeBracket` |
| D4 | `derive/status`, `derive/ledgerReader` | 0 |
| N8 (this file's own) | `ownerCheck`, `ownerOracle` | 0 — the validator result is exactly `{ok, issues}` |
| local | `malformedRequestOutcome`, `request.scopeExpect` | 0 — replaced by `internalErrorOutcome` and `request.materialized.scopeExpect` |
| P0 test support | `onFindClashes`, `leases:`, `digestsAfterCall`, `throwOn` | 0 — the four invented fake knobs are gone; the tests use `script(...)`, `evictModel`, `set(...)`, `onCall(...)` |

**Names deliberately kept, with the sense that makes them correct** (they collide with a register row's dead spelling but are not it):

| Name in P4 | Why it stays |
|---|---|
| `ctx.checkpoint()` | N6's note: `checkpoint()` is real on P3's `EnumerationContext`, which is why the slicer collision arose. P4 only forwards `ctx` to `checkScopeBracket`. |
| `admit(n)` (`deriveUnitTaints`) | N9's ledger-budget oracle injected by P6 over P3's budget — unrelated to N23's residency `admit()`, which P4 never calls. |
| `capacityKind` | `CapacityExceededError.kind` on a `UnitOutcome.failure` (F8) — not N17's rejected `splitUnit(plan, unitId, capacityKind)` argument. |
| `failure.code` / `issue.code` | P4's own enums — not N1's rejected `ModelBindingError.code`, which P4 never constructs or catches. |
| `createFakeWorld`, `makeLeaseWorld` | P0's and P1's **real** exports, now consumed at their real signatures. |

**Producer-side confirmation** (the names P5/P6/P7 assume from P4 exist under exactly these spellings, in this file's *Phase interface summary*): `clashtest/execution/UnitExecutor.js` with `validateExecutionRequest` / **`validateUnitOutcome`** / **`internalErrorOutcome`**; `clashtest/execution/diagnostics.js` with **`createDiagnosticAggregator`** (and **no** `aggregateDiagnostics` / `readDiagnostics`), `createStatisticsAccumulator`, `deriveUnitTaints`; `clashtest/execution/LocalUnitExecutor.js` with **`createLocalUnitExecutor`** returning the function-shaped `UnitExecutor`.
