# Planner: enumerator port, scope digests, three-cell decomposition, sizing, ledger — Phase P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (or `superpowers:executing-plans`). Read the master plan first, then this file only. Steps are checkboxes; RED → GREEN → checkpoint per task.

**Goal:** Build the Viewer-neutral planning layer of `clashtest/`: the `ElementEnumerator` *port* (contract, boundary validation, and a conformance helper every enumerator implementation must pass), the pure scope-digest functions that later phases bracket a call with, and the planner itself — root resolution and the plan-time hierarchy-overlap rule, the three-cell exact-cover decomposition (same-model-safe), deterministic source packing and target slicing under per-unit caps, deterministic capacity splitting, run-scoped plan tables with a hard `planRecords ≤ maxPlanReferences` bound, and the coverage ledger with its single run-wide `maxLedgerRecords` budget whose exhaustion rule is specified for *every* record class. The phase ends with a seeded property suite proving the plan covers the required pair space exactly once against a brute-force reference, and proving the plan is byte-identical under input reordering.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase **inherits the master's Global Constraints** in full (no `collision/` change, no Viewer/`three` import, ESM `.js` modules + `*.test.mjs` tests, plain data at every boundary, fail-closed semantics, defaults only from `clashtest/options.js`, injectable `now`/`yieldToScheduler`, TDD, commits only on explicit authorization). Phase-specific constraints, copied verbatim from the spec:

- §6.1: "The planner's job is to cover `P` **exactly once** with Work Units, every unit legal under the library's rules, and to account for anything it could not cover."
- §6.3: "Each cell's source and target **root** sets are disjoint by construction, and roots are subtree-disjoint (§5.6, enforced by the `hierarchy-overlap` rule), so a source subtree walk never contains a target fragment and the library's fragment-membership self-exclusion (F2) never suppresses a required pair."
- §6.4: "**`maxTargetFragmentsPerUnit` is a hard per-unit bound, not a packing target (M7)**" — and, of the source side, "`maxSourceFragmentsPerUnit` is a **packing target**".
- §6.4 (invariant P1, narrowed): "the *initial plan* is a pure function of *(definition semantics, sorted enumerations, run sizing options)*… **Wall-clock and load never influence planning or any verdict.**"
- §6.4: "At every step the children's weights partition the parent's exactly."
- §6.5: "Units carry only `modelKey`s and table ranges — never `Model` objects or copied dbId arrays."
- §6.5.1: "By construction `planRecords ≤ maxPlanReferences` always." and "The run **never allocates beyond `maxLedgerRecords`** and **never fails merely because the budget is full**."
- §6.5.1: "Every fallback only enlarges what is tainted or turns a split into a gap… budget exhaustion can only make results *more* conservative."
- §6.6: "Nothing is silently dropped."
- §5.6.5: "The selections are *supported* iff `RU = RA ∪ RB` as dbId sets… Otherwise planning fails: run `failed`, reason `hierarchy-overlap`, with the first 20 offending (ancestor, descendant) pairs recorded, **before any unit runs**."

**Simplifications this phase adopts** (spec over-specifies the mechanism; the externally observable safety invariant is preserved and named in each case) are collected in §"Implementation-detail choices" below and cross-referenced from the tasks.

---

## Phase interface summary

Every name below is exported by P3 and is the contract other phases consume. Paths are repo-relative.

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `ENUMERATION_SCOPE_WHOLE` | `clashtest/planning/ElementEnumerator.js` | `'whole'` | The whole-model scope sentinel used in port calls. |
| `PLANNING_CAUSES` | `clashtest/planning/ElementEnumerator.js` | `readonly string[]` | The exhaustive planning-cause enum of spec §6.6 item 2. |
| `validateResolveRootsResult` | `clashtest/planning/ElementEnumerator.js` | `(result, {scope}) => {ok: boolean, issues: Array<{path, code}>}` | Pure boundary validation of one `resolveRoots` answer (shape, ordering, whole-only fields, duplicate roots/owners). |
| `validateDigestScopeResult` | `clashtest/planning/ElementEnumerator.js` | `(result, {scope}) => {ok, issues}` | Same for `digestScope`. |
| `checkEnumeratorConformance` | `clashtest/planning/ElementEnumerator.js` | `({enumerator, binding, cases, checkpoint?}) => Promise<{failures: string[]}>` | The conformance suite every `ElementEnumerator` implementation (fake, Viewer adapter) must pass; returns failure strings, never throws for a conformance failure. |
| `POPULATION_CLASS` | `clashtest/planning/scopeDigest.js` | `{LOADED:'L', NOT_LOADED:'N', OWNER_UNRESOLVABLE:'U'}` | The three population record classes of §6.2.1. |
| `encodePopulationRecords` | `clashtest/planning/scopeDigest.js` | `(records) => Array<Array<number\|string>>` | Canonical, ascending-by-`fragId` record list for a population digest. |
| `digestPopulation` | `clashtest/planning/scopeDigest.js` | `({count, records}, {slicer} = {}) => Promise<{kind:'population', count, digest, digestVersion}>` | Pure population digest (whole-model scope). P0's `digestCanonical` is **synchronous** ("small values only"), so the default path calls it directly and resolves; a caller holding large data (the Viewer enumerator adapter) passes a P0 `slicer` and the helper uses `digestCanonicalSliced(value, slicer, {label})` instead. Both paths are byte-identical, which is why the return stays a `Promise` in both. |
| `digestSubtree` | `clashtest/planning/scopeDigest.js` | `(records, {slicer} = {}) => Promise<{digest, digestVersion}>` | Pure subtree digest for one root (explicit target root or source root). Same sync/sliced rule as `digestPopulation`. |
| `compareScopeExpectation` | `clashtest/planning/scopeDigest.js` | `(expect, observed) => {status:'equal'\|'mismatch'\|'unverifiable', modelKey, role, detail}` | The pure comparator the per-unit and read-time bracketing loops run pre- and post-call (§16.3.2). |
| `checkScopeBracket` | `clashtest/planning/scopeDigest.js` | `(scopeExpect, {enumerator, bindings: Map<string, Binding\|null>, ctx}) => Promise<{proof: 'equal'\|'drift'\|'unverifiable', modelKeys: string[]}>` | **Moved here by reconciliation (duplicate-ownership D1).** **`bindings` is a `Map` keyed by `modelKey`**, built by the *caller* from P1's positional `snapshotBindings(keys).bindings` array (ruling R7): the lookup here is by `entry.modelKey`, never positional, so a bare array cannot serve without also passing the key list. Both consumers already hold one — P4 passes `resolved.byKey`, P6 passes `new Map(keys.map((k, i) => [k, snapshot.bindings[i]]))` — and a missing key reads as `null`, i.e. `unverifiable` (N10). One side of a bracket: re-`digestScope` every listed scope through the `ElementEnumerator` and fold `compareScopeExpectation` over the answers (`unverifiable` is absorbing over `equal`; `drift` wins over both). Originally planned in P6 `run/freshness.js`, but P4's `LocalUnitExecutor` must call it per unit and **P4 may not import from `run/`** (that would invert the master's dependency graph). It lives beside the comparator it folds. Consumed by **P4** (Task P4.8, per unit) and **P6** (Task P6.6 run-level handling, Task P6.7 read-time `getFreshness`). |
| `createRecordBudget` | `clashtest/planning/ledger.js` | `(limits) => RecordBudget` | The single run-wide record budget: `planRecords`, reserved unit slots, discretionary capacity. `limits` is the resolved run-options object from P0 `options.js` (`maxPlanReferences`, `maxLedgerRecords`, `maxUnitsPerRun`, `maxElementTaintsPerUnit` are all `RUN_OPTION_KEYS`). |
| `createLedger` | `clashtest/planning/ledger.js` | `({limits, budget}) => Ledger` | The coverage ledger: tables, unit records, taints, gaps, exhaustion flags. Mutable and run-scoped; it is the object `PlanResult.ledger` and `plan.ledger` both point at. |
| `LEDGER_RECORD_CLASSES` / `PLAN_RECORD_CLASSES` | `clashtest/planning/ledger.js` | `readonly string[]` | The record classes of §6.5.1 that the budget counts (the plan-only subset, and the full set). These are **budget class ids**, not the persisted `taint.kind` vocabulary — see `toLedgerRecord`. |
| `ledger.recordPlanningGap` | `clashtest/planning/ledger.js` | `({phase, cause}) => void` | The **run-level** §6.6.2 gap writer, and the only writer for the sealed ledger's `planningGaps` array (which P5 pins and `ledgerDigestInput` digests). Appends one `{phase, cause}` row, de-duplicated on the pair; allocates no `UnitRecord`, charges no budget class, cannot be refused — so it is safe on a ledger the pre-resolution seal requires to have `units: []`. **Not interchangeable with `recordGap`**, which writes a *unit* gap (`outcome:'not-run'` + a real `pairSpaceWeight`, today only `target-too-large`). P6 is its only caller outside the planner (`planning:cancelled`, and every §6.6.2 cause it detects after `planRun` returned). |
| `ledger.toLedgerRecord` | `clashtest/planning/ledger.js` | `() => Ledger` (arrays-only plain data) | **The persisted projection, and it emits exactly P5's pinned sealed-ledger `Ledger`/`UnitRecord` typedefs** (`p5-result-set.md` → *Shapes this phase pins*; reconciliation **S-P5-4**: "P3 and P6 must emit exactly that shape"). Field-by-field conformance is pinned in Task P3.8 Step 5. The two P3-side deltas the controller ruled on: `rootOwners` rows carry **`cls`** (ruling R2 / master §8 OPEN-2 option (a)), and `secondaryCauses` is written ascending by cause code and is **excluded from `ledgerDigest`** (ruling R4). |
| `ROOT_CLASS` | `clashtest/planning/ledger.js` | frozen `{A_ONLY:'A', B_ONLY:'B', BOTH:'C'}` | The per-root class marker persisted as `rootOwners[].owners[].cls` (**R2**): `'A'` = the root is in `A' = RA \ RB`, `'B'` = `B' = RB \ RA`, `'C'` = `C = RA ∩ RB` (a hierarchy-internal candidate). It is the durable form of the run-scoped `plan.models[mk].classes` key (`A'` → `'A'`, `C` → `'C'`, `B'` → `'B'`). Read by P8's `getElementStatus` **only through P5's `readLedger`** (D4). |
| `buildRootTables` | `clashtest/planning/planTables.js` | `({models, budget}) => {tables, tableById, ownersByModel, ownerRootByModel}` | Immutable ascending root tables per (model, class) plus the per-model owner array. |
| `readRange` / `rangeRootCount` / `rangeFragmentWeight` | `clashtest/planning/planTables.js` | `(plan, range) => number[] \| number` | Range readers; `{table, start, end}` is half-open. |
| `bisectRanges` | `clashtest/planning/planTables.js` | `(plan, ranges) => [Range[], Range[]]` | Deterministic bisection of an ordered range list, never splitting a root. |
| `OWNER_CLASS` | `clashtest/planning/owners.js` | `{ROOT_ONLY, UNREACHABLE_ONLY, MIXED}` | The three owner classes of §6.2 (H1). |
| `classifyOwners` | `clashtest/planning/owners.js` | `({rootOwnerDbIds, unreachableOwnerDbIds}) => {mixedOwnerDbIds, unreachableOnlyDbIds}` | Pure classification from recorded plan data. |
| `ownerClassOf` | `clashtest/planning/owners.js` | `(plan, modelKey, dbId) => 'root-only'\|'unreachable-only'\|'mixed'\|'unknown'` | Owner class lookup used by P4 outcome validation and P5 taint rules. |
| `rootOfOwner` | `clashtest/planning/owners.js` | `(plan, modelKey, dbId) => number \| null` | The `rootOwners` map of §5.6.4 (owner → its root), used by `getPairStatus` (P5). |
| `resolveSelectionRoots` | `clashtest/planning/rootResolution.js` | `({definition, snapshot, enumerator, checkpoint}) => Promise<{ok, models, issues}>` | Stage 1: the three `resolveRoots` calls per model, cross-role agreement, hierarchy-overlap, unresolved selections, owner-mapping mismatch. |
| `decomposeCells` | `clashtest/planning/decompose.js` | `({models, plan, ordered}) => CellSpec[]` | The three-cell decomposition (incl. cell 3b bisection) as range-valued cell specs, in canonical order. |
| `sizeUnits` | `clashtest/planning/sizing.js` | `({cells, plan, options}) => {units, gaps}` | Source packing × target slicing into `WorkUnit`s under the per-unit caps; over-cap target entries become `not-run:target-too-large` gaps. |
| `planSplit` | `clashtest/planning/splitting.js` | `(plan, unit) => {children:[WorkUnit, WorkUnit]} \| {reason:'unsplittable'\|'unit-cap'\|'ledger-cap', capDetail?}` | **Live split admission (controller ruling R8).** The deterministic split order of §6.4 **plus** the atomic capacity decision: it counts unit records (the parent's two children against the run's *live* `unitRecords` population — which already includes every child created by an earlier runtime split, so a nested split counts) and ledger records (through the run's `RecordBudget`) against `maxUnitsPerRun` / `maxLedgerRecords`, and admits both or neither. `'unsplittable'` = the §6.4 order has no cut left; `'unit-cap'` (`capDetail:'unit-records'`) and `'ledger-cap'` (`capDetail:'ledger-records'`) = the cut exists but does not fit. **Callers branch on `.reason` — never on `null`/truthiness** (the refusal is a truthy object; reconciliation N17, the highest-severity row in that pass). Reaches the budget through `plan.ledger`, which is why the arity stays `(plan, unit)`. |
| `SPLIT_REFUSAL_REASONS` | `clashtest/planning/splitting.js` | frozen `['unsplittable','unit-cap','ledger-cap']` | The closed refusal vocabulary of R8. `unit-cap` and `target-too-large` are also §16.7 settlement facts, so P6 maps a refusal onto a fact without inventing a code. |
| `createPlan` (alias `planRun`) | `clashtest/planning/planner.js` | `({definition, snapshot, enumerator, options, checkpoint, ledger?}) => Promise<PlanResult>` | The phase facade: everything above, in order, budget-checked. **Promise-returning, so every failure is a rejected promise or a `{status:'failed'}` result and never a synchronous throw** (controller ruling R1: only the non-Promise entry point `startRun` throws synchronously; that one is P7's). |
| `materializeUnit` | `clashtest/planning/planner.js` | `(plan, unit) => {sourceDbIds, targets, scopeExpect}` | The transient expansion P4 puts in `ExecutionRequest.materialized` (§7.1), including the planning-time `scopeExpect` digests. |
| `rootsForRanges` | `clashtest/planning/planner.js` | `(plan, ranges) => number[]` | Ascending root dbIds behind a range list (thin wrapper over `readRange`). |
| `PLAN_SCHEMA` (typedefs) | `clashtest/planning/planner.js` | JSDoc only | `WorkUnit`, `PlanResult`, `Ledger`, `PlanningGap` typedefs re-exported for consumers. |

`PlanResult = { status: 'planned' | 'failed', plan: Plan | null, ledger: Ledger, planningGaps: PlanningGap[], preTerminalGapWeight: number }`.

**`preTerminalGapWeight` (controller ruling R11)** is the explicit, tested accessor for the planner's *pre-terminal* unit gaps: the Σ of `pairSpaceWeight` over every unit record P3 writes at plan time that is already terminal and will never be executed — today exactly the `not-run:target-too-large` gaps of §6.4 item 3 / §17.1 (Task P3.7). It is `0` on a `status:'failed'` result and `0` when the plan has no such gap. **P6 adopts it into progress accounting at plan completion**, so `unitsSettled`-style progress starts from the work that is already accounted for rather than drifting by the gap weight; the same number is recoverable from the ledger (`toLedgerRecord().units.filter(u => u.kind === 'leaf' && u.outcome === 'not-run')`), and the test in Task P3.9 pins the two against each other so the accessor can never disagree with the ledger it summarizes.

`Plan = { tables, tableById, ownersByModel, ownerRootByModel, models (alias modelsByKey), selectionKindByRole, units, unitsById, pairSpaceTotal, planRecords, sizing, ledger }` — all frozen, all plain data except the `Map`s used for O(1) lookup (which never cross a durable boundary; the ledger's persisted projection is arrays only). Each `models` entry carries `{classes, scopeKinds, scopeDigests: {population: {count, digest}|null, roots: [{dbId, subtreeDigest}]}, rootOwners, unreachable}`.

**`plan.ledger` is the one deliberately un-frozen property** (the same object as `PlanResult.ledger`): the plan's deep-freeze skips that key, because `planSplit(plan, unit)` must reach the live `RecordBudget` through it to make R8's atomic admission decision, and the ledger keeps accumulating unit records and taints for the whole run. Everything else on the plan is deep-frozen, so the §6.4 invariant P1 ("the *initial plan* is a pure function of definition semantics, sorted enumerations and run sizing options") is unaffected: the plan's *data* never changes after `createPlan` returns, only the run's ledger does.
`WorkUnit` is exactly the §6.5 shape: `{unitId, cell, sourceModelKey, sourceRanges, targets, orientationRole, pairSpaceWeight}` (plus the non-durable `targetWeight` used by sizing and splitting).

**Cross-phase name reconciliation (P6 was authored in parallel) — SETTLED; see [`interface-reconciliation.md`](interface-reconciliation.md) rows N15–N18 and D1.** `p6-run-lifecycle.md` assumes P3 exports `planRun`, `splitUnit`, `rootsForRanges`, and a plan shaped `{units, tables, modelsByKey, selectionKindByRole, planningGaps, pairSpaceTotal, planRecords, ledger}`. Per the master's §2.1 rule the owning phase's Produces block is the contract, so P3 ships the names in this table **and exports `planRun`/`splitUnit` as aliases of `createPlan`/`planSplit`, `modelsByKey` as an alias of `plan.models`, and `selectionKindByRole`/`planRecords` as plan fields**. The four residual mismatches are settled **producer-wins**, and P6's assumption table has been corrected accordingly:

1. **`planRun` returns a `PlanResult`, not a `Plan`.** `PlanResult = {status:'planned'|'failed', plan, ledger, planningGaps, preTerminalGapWeight}`; P6 reads `result.plan`, `result.planningGaps` and (**ruling R11**) `result.preTerminalGapWeight`. Its argument names are P3's: **`snapshot`** (the P1 `snapshotBindings` result), **`options`** (resolved run options) and **`checkpoint`** (the enumeration-context checkpoint), not `bindings` / `runOptions` / `limits` / `ctx`. Engine limits reach the planner through the record budget (`createRecordBudget(limits)`), not as a `planRun` argument.
2. **`splitUnit(plan, unit)` takes the `WorkUnit`, not `(plan, unitId, capacityKind)`**, and returns `{children:[WorkUnit, WorkUnit]}` or a **truthy refusal object** — never `null`. P6 must branch on **`result.reason`** (equivalently `'children' in result`), never on `result !== null`. **Controller ruling R8 widens the refusal to three reasons** — `'unsplittable'`, `'unit-cap'` and `'ledger-cap'` (the latter two carrying `capDetail`) — because the capacity decision is now made *inside* `planSplit`, atomically with the split, rather than by a separate `tryRecordSplit` call the caller might forget. A `unit-cap` / `ledger-cap` refusal is the §16.7 `unit-cap` fact; P6 maps it onto `failed:unit-cap` and records the parent's weight as a gap, exactly as it already does for `'unsplittable'`. The capacity *kind* is still not an input: the split order of §6.4 is deterministic and kind-independent; P6 records `capacityKind` on the ledger's `UnitRecord` itself.
3. **`materializeUnit(plan, unit)` returns `{sourceDbIds, targets, scopeExpect}`** — a superset of P6's assumed `{sourceDbIds, targets}`. The third field is load-bearing (see 4).
4. **`buildScopeExpect` is deleted from P6.** P6's Task P6.6 planned its own builder over `plan.modelsByKey[…].scopeDigests`, re-deriving the R20-1 whole-model-source rule that `materializeUnit` already applies. Two copies of that rule is exactly the drift §16.3.4's invariant I-scope cannot survive. **`materializeUnit(...).scopeExpect` is the one producer**; `checkScopeBracket` (the re-digest-and-compare half, now in `planning/scopeDigest.js`, see the table above) is the one consumer of it, called by P4 per unit and by P6 at read time. P6's R20-1 tests move to P3 Task P3.9's `materializeUnit` suite — see *Verification / acceptance for P3*.

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `clashtest/planning/ElementEnumerator.js` | Create (P3.1) | Port JSDoc contract, boundary validators, conformance helper, planning-cause enum. |
| `clashtest/planning/scopeDigest.js` | Create (P3.2) | Pure population/subtree digest functions, the bracketing comparator, **and `checkScopeBracket`** — the single re-digest-and-compare bracket half consumed by P4 (per unit) and P6 (read time). Reconciliation D1. |
| `clashtest/planning/ledger.js` | Create (P3.3), Modify (P3.8) | Record budget (`maxPlanReferences` / `maxLedgerRecords` / reserved slots) and the coverage ledger with per-class exhaustion. |
| `clashtest/planning/planTables.js` | Create (P3.4) | Run-scoped root tables, half-open ranges, range readers, deterministic bisection. |
| `clashtest/planning/owners.js` | Create (P3.4) | Owner classes (H1) and the owner → root map. |
| `clashtest/planning/rootResolution.js` | Create (P3.5) | Stage 1: enumeration, cross-role agreement, `hierarchy-overlap`, `unresolvedSelections`, `ownerMismatch`, `unreachablePopulation`, `hierarchyInternal`. |
| `clashtest/planning/decompose.js` | Create (P3.6) | Three-cell decomposition and cell-3b recursive bisection. |
| `clashtest/planning/sizing.js` | Create (P3.7) | Source packing, target slicing, unit ids, `pairSpaceWeight`, `target-too-large` gaps. |
| `clashtest/planning/splitting.js` | Create (P3.8) | Deterministic capacity-split order and child unit construction. |
| `clashtest/planning/planner.js` | Create (P3.9) | `createPlan` facade + `materializeUnit` + typedefs. |
| `test/clashtest/support/syntheticModels.mjs` | Create (P3.1) | Synthetic model specs → a conforming fake `ElementEnumerator`; shared by every P3 test (lives in the P0 support dir, added to, never forked). |
| `test/clashtest/support/bruteForcePairs.mjs` | Create (P3.9) | The brute-force reference `P` and a unit-coverage expander, used only by the property suite. |
| `test/clashtest/planning/*.test.mjs` | Create (per task) | One test file per module, mirroring the tree. |

---

### Task P3.1: `ElementEnumerator` port contract, boundary validation, conformance helper

The port is the whole Viewer seam. Nothing else in the core may assume anything about enumeration that is not written here and checked by `checkEnumeratorConformance`.

**Files**
- Create: `clashtest/planning/ElementEnumerator.js`
- Create: `test/clashtest/support/syntheticModels.mjs`
- Test: `test/clashtest/planning/ElementEnumerator.test.mjs`

**Interfaces**
- Consumes (**from P0 `clashtest/errors.js`, per P0's *Phase interface summary*** — no longer "assumed"): `EnumerationCancelledError`, typed field `reason: 'cancelled' | 'lease-dead' | 'disposed'` (§6.2). It is constructed **`new EnumerationCancelledError({ reason, message?, cause? })` — one object argument** (P0's error convention, reconciliation **N1**); `error.name` is the class name. Nothing in this task depends on its shape beyond `name`, but nothing here may construct it positionally either.
- Consumes (**from P0 `test/clashtest/support/index.mjs`**): `createFakeClock`, `createFakeWorld`, and `createFakeEnumerator({models, checkpointsPerCall=1, cooperative=true})` / `createFakeEnumerationContext({yieldToScheduler?})` — P0's data-driven doubles of this very port, written against spec §6.2's shapes (`resolveRoots(binding, scope, ctx)`, `digestScope(binding, scope, ctx)`, `binding.modelKey`, `ctx.checkpoint()`), which is exactly what this task's contract fixes. P3 does **not** fork or edit them: per P0's support extension rule (2) it adds the **new** file `support/syntheticModels.mjs` (model-spec-driven, so a test can state a hierarchy or an unreachable population declaratively) and appends its exports to `index.mjs`. `createFakeEnumerator` stays the right double for a test that needs no model topology.
- Produces: `ENUMERATION_SCOPE_WHOLE`, `PLANNING_CAUSES`, `validateResolveRootsResult`, `validateDigestScopeResult`, `checkEnumeratorConformance`.

**Steps**

- [ ] **Step 1: Write the failing port-validation test.** Create `test/clashtest/planning/ElementEnumerator.test.mjs`:

```js
// test/clashtest/planning/ElementEnumerator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENUMERATION_SCOPE_WHOLE, PLANNING_CAUSES,
  validateResolveRootsResult, checkEnumeratorConformance,
} from '../../../clashtest/planning/ElementEnumerator.js';
import { makeSyntheticEnumerator, conformanceCases } from '../support/syntheticModels.mjs';

const okWhole = () => ({
  roots: [{ dbId: 1, fragmentCount: 2, ownerDbIds: [1, 5], subtreeDigest: 'sha256:aa' }],
  population: { count: 2, digest: 'sha256:bb' },
  ownerMismatch: { count: 0, first20: [] },
  unreachable: { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } },
  unresolved: [],
});

test('accepts a well-formed whole-scope answer', () => {
  const r = validateResolveRootsResult(okWhole(), { scope: ENUMERATION_SCOPE_WHOLE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('rejects non-ascending roots, duplicate roots and non-ascending ownerDbIds', () => {
  const a = okWhole(); a.roots = [{ dbId: 5, fragmentCount: 1, ownerDbIds: [5], subtreeDigest: 'sha256:c' },
                                  { dbId: 1, fragmentCount: 1, ownerDbIds: [1], subtreeDigest: 'sha256:d' }];
  assert.deepEqual(validateResolveRootsResult(a, { scope: ENUMERATION_SCOPE_WHOLE }).issues.map(i => i.code),
    ['roots-not-ascending']);
  const b = okWhole(); b.roots[0].ownerDbIds = [5, 1];
  assert.deepEqual(validateResolveRootsResult(b, { scope: ENUMERATION_SCOPE_WHOLE }).issues.map(i => i.code),
    ['owners-not-ascending']);
});

test('whole-only fields are required for whole and forbidden for explicit scopes', () => {
  const noPop = okWhole(); noPop.population = null;
  assert.ok(validateResolveRootsResult(noPop, { scope: ENUMERATION_SCOPE_WHOLE })
    .issues.some(i => i.code === 'population-required'));
  const explicitOk = { roots: okWhole().roots, population: null, ownerMismatch: null, unreachable: null, unresolved: [] };
  assert.equal(validateResolveRootsResult(explicitOk, { scope: { dbIds: [1] } }).ok, true);
  const explicitBad = { ...explicitOk, population: { count: 1, digest: 'sha256:x' } };
  assert.ok(validateResolveRootsResult(explicitBad, { scope: { dbIds: [1] } })
    .issues.some(i => i.code === 'population-forbidden'));
});

test('the planning-cause enum is exactly the spec §6.6 list', () => {
  assert.deepEqual([...PLANNING_CAUSES].sort(), [
    'cancelled', 'definition-invalid', 'element-unresolvable', 'enumeration-failed',
    'hierarchy-overlap', 'migration-failed', 'model-not-bound', 'owner-mapping-mismatch',
    'plan-too-large', 'schema-unsupported', 'test-unavailable', 'world-disposed',
  ]);
});

test('the synthetic fake enumerator passes the conformance suite', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  const { failures } = await checkEnumeratorConformance({ enumerator, binding, cases: conformanceCases() });
  assert.deepEqual(failures, []);
});

test('conformance reports, never throws, for a non-cooperating enumerator', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models, { ignoreCheckpoint: true });
  const { failures } = await checkEnumeratorConformance({ enumerator, binding, cases: conformanceCases() });
  assert.ok(failures.some(f => f.includes('checkpoint')));
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/ElementEnumerator.test.mjs` → `ERR_MODULE_NOT_FOUND` for `clashtest/planning/ElementEnumerator.js`.

- [ ] **Step 3: Write the port module.** `clashtest/planning/ElementEnumerator.js` carries (a) the JSDoc typedefs copied from spec §6.2 verbatim in structure, (b) the two validators, (c) the conformance helper. The validators are pure and allocate one `issues` array:

```js
export const ENUMERATION_SCOPE_WHOLE = 'whole';

export const PLANNING_CAUSES = Object.freeze([
  'test-unavailable', 'definition-invalid', 'schema-unsupported', 'migration-failed',
  'model-not-bound', 'enumeration-failed', 'element-unresolvable', 'owner-mapping-mismatch',
  'hierarchy-overlap', 'plan-too-large', 'cancelled', 'world-disposed',
]);

const isWhole = (scope) => scope === ENUMERATION_SCOPE_WHOLE;
const isSafeNonNegInt = (n) => Number.isSafeInteger(n) && n >= 0;

export function validateResolveRootsResult(result, { scope }) {
  const issues = [];
  const add = (path, code) => { issues.push({ path, code }); };
  if (result === null || typeof result !== 'object') { add('/', 'not-an-object'); return { ok: false, issues }; }
  if (!Array.isArray(result.roots)) add('/roots', 'not-an-array');
  else {
    let prev = -1;
    for (let i = 0; i < result.roots.length; i++) {
      const r = result.roots[i];
      if (r === null || typeof r !== 'object') { add(`/roots/${i}`, 'not-an-object'); continue; }
      if (!isSafeNonNegInt(r.dbId)) add(`/roots/${i}/dbId`, 'not-a-dbid');
      else if (r.dbId <= prev) { add('/roots', 'roots-not-ascending'); prev = Infinity; }
      else prev = r.dbId;
      if (!isSafeNonNegInt(r.fragmentCount)) add(`/roots/${i}/fragmentCount`, 'not-a-count');
      if (typeof r.subtreeDigest !== 'string' || !r.subtreeDigest.startsWith('sha256:'))
        add(`/roots/${i}/subtreeDigest`, 'not-a-digest');
      if (!Array.isArray(r.ownerDbIds)) add(`/roots/${i}/ownerDbIds`, 'not-an-array');
      else {
        let po = -1;
        for (const o of r.ownerDbIds) {
          if (!isSafeNonNegInt(o)) { add(`/roots/${i}/ownerDbIds`, 'not-a-dbid'); break; }
          if (o <= po) { add(`/roots/${i}/ownerDbIds`, 'owners-not-ascending'); break; }
          po = o;
        }
      }
    }
  }
  const whole = isWhole(scope);
  if (whole) {
    if (result.population === null || typeof result.population !== 'object') add('/population', 'population-required');
    else {
      if (!isSafeNonNegInt(result.population.count)) add('/population/count', 'not-a-count');
      if (typeof result.population.digest !== 'string') add('/population/digest', 'not-a-digest');
    }
    if (result.ownerMismatch === null || typeof result.ownerMismatch !== 'object') add('/ownerMismatch', 'required');
    if (result.unreachable === null || typeof result.unreachable !== 'object') add('/unreachable', 'required');
    else {
      const u = result.unreachable;
      if (!isSafeNonNegInt(u.count)) add('/unreachable/count', 'not-a-count');
      if (!Array.isArray(u.ownerDbIds)) add('/unreachable/ownerDbIds', 'not-an-array');
      if (!u.unattributable || !isSafeNonNegInt(u.unattributable.notLoaded)
          || !isSafeNonNegInt(u.unattributable.ownerUnresolvable))
        add('/unreachable/unattributable', 'malformed');
    }
    if (!Array.isArray(result.unresolved) || result.unresolved.length !== 0)
      add('/unresolved', 'unresolved-forbidden');
  } else {
    if (result.population !== null) add('/population', 'population-forbidden');
    if (result.ownerMismatch !== null) add('/ownerMismatch', 'owner-mismatch-forbidden');
    if (result.unreachable !== null) add('/unreachable', 'unreachable-forbidden');
    if (!Array.isArray(result.unresolved)) add('/unresolved', 'not-an-array');
    else for (let i = 0; i < result.unresolved.length; i++) {
      const u = result.unresolved[i];
      if (!u || !isSafeNonNegInt(u.dbId)) add(`/unresolved/${i}/dbId`, 'not-a-dbid');
      if (!u || (u.reason !== 'not-found' && u.reason !== 'no-fragments'))
        add(`/unresolved/${i}/reason`, 'unknown-reason');
    }
  }
  return { ok: issues.length === 0, issues };
}
```

  `validateDigestScopeResult` is the same style over the two `digestScope` shapes (`{kind:'population', count, digest}` for whole; `{kind:'roots', roots:[{dbId, fragmentCount, subtreeDigest}]}` for explicit, ascending by `dbId`).

- [ ] **Step 4: Write the conformance helper.** `checkEnumeratorConformance` is the artifact every future enumerator (including the OQ-4 Viewer adapter) must pass. It asserts the **port contract only** — never a particular model's content:

```js
export async function checkEnumeratorConformance({ enumerator, binding, cases }) {
  const failures = [];
  const fail = (m) => failures.push(m);
  for (const c of cases.scopes) {
    let checkpoints = 0;
    const ctx = { checkpoint() { checkpoints++; } };
    let res;
    try { res = await enumerator.resolveRoots(binding, c.scope, ctx); }
    catch (e) { fail(`resolveRoots(${c.name}) threw ${e && e.name}`); continue; }
    const v = validateResolveRootsResult(res, { scope: c.scope });
    if (!v.ok) fail(`resolveRoots(${c.name}) shape: ${v.issues.map(i => i.path + ':' + i.code).join(',')}`);
    if (checkpoints < 1) fail(`resolveRoots(${c.name}) did not call ctx.checkpoint() at least once per slice`);
    // C1 stability: two calls with no intervening mutation must be deeply equal.
    const again = await enumerator.resolveRoots(binding, c.scope, { checkpoint() {} });
    if (JSON.stringify(again) !== JSON.stringify(res)) fail(`resolveRoots(${c.name}) is not stable across calls`);
    // C2 digestScope agrees with resolveRoots for the same scope, same function, no cache.
    const d = await enumerator.digestScope(binding, c.scope, { checkpoint() {} });
    const dv = validateDigestScopeResult(d, { scope: c.scope });
    if (!dv.ok) fail(`digestScope(${c.name}) shape: ${dv.issues.map(i => i.code).join(',')}`);
    else if (c.scope === ENUMERATION_SCOPE_WHOLE) {
      if (d.digest !== res.population.digest || d.count !== res.population.count)
        fail(`digestScope(${c.name}) disagrees with resolveRoots population`);
    } else {
      const byDbId = new Map(res.roots.map(r => [r.dbId, r.subtreeDigest]));
      for (const r of d.roots) if (byDbId.get(r.dbId) !== r.subtreeDigest)
        fail(`digestScope(${c.name}) subtreeDigest differs for root ${r.dbId}`);
    }
    // C3 cancellation propagates: a checkpoint that throws must surface, unwrapped.
    const boom = new Error('x'); boom.name = 'EnumerationCancelledError';
    let propagated = false;
    try { await enumerator.resolveRoots(binding, c.scope, { checkpoint() { throw boom; } }); }
    catch (e) { propagated = e === boom; }
    if (!propagated) fail(`resolveRoots(${c.name}) swallowed EnumerationCancelledError from checkpoint`);
  }
  return { failures };
}
```

- [ ] **Step 5: Write the synthetic enumerator fixture.** `test/clashtest/support/syntheticModels.mjs` turns a plain model spec into a conforming enumerator. Spec shape and the fake's rules:

```js
/** modelSpec = {
 *   modelKey: string,
 *   roots: [{ dbId, owners: number[] /* ascending, incl. dbId when it owns fragments */,
 *             fragments: [{ fragId, ownerDbId, geometryId }] }],   // ascending by dbId
 *   unreachable: [{ fragId, cls: 'L'|'N'|'U', ownerDbId?: number, geometryId?: number }],
 *   ancestorOf: { [descendantDbId]: ancestorRootDbId },   // for explicit-list antichain reduction
 *   missingDbIds: number[],       // dbIds that are not nodes of the tree      → 'not-found'
 *   emptyDbIds: number[],         // real nodes whose subtree owns no fragment → 'no-fragments'
 *   ownerMismatchCount?: number,  // forced tree-owner vs fragList-owner disagreement
 * } */
```

  `resolveRoots(binding, 'whole')` returns every root ascending with a real `subtreeDigest` (computed with P3.2's `digestSubtree` once that exists — until then a deterministic placeholder that Step 3 of P3.2 replaces), `population` over *all* fragments (root fragments ∪ `unreachable`) ascending by `fragId`, `unreachable` reconciled into `{count, ownerDbIds, unattributable}` where `count` counts only class-`L` entries with a numeric owner and `unattributable` counts class `N`/`U`, and `ownerMismatch: {count: spec.ownerMismatchCount ?? 0, first20: […]}`. `resolveRoots(binding, {dbIds})` drops any listed dbId that has a listed ancestor (via `ancestorOf`), reports `missingDbIds` as `not-found` and `emptyDbIds` as `no-fragments`, and returns `population/ownerMismatch/unreachable` as `null`. Both call `ctx.checkpoint()` once per model and `await` it, unless the fixture is built with `{ignoreCheckpoint: true}`.

- [ ] **Step 6: Run and see it pass.** `node --test test/clashtest/planning/ElementEnumerator.test.mjs` → all tests pass.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs(plan): P3.1 ElementEnumerator port contract + conformance helper`.

---

### Task P3.2: Scope digests and the bracketing comparator (§6.2.1)

P3 owns the **pure** digest functions and the comparator. The loop that *runs* them around a `findClashes` call is P6/P7.

**Files**
- Create: `clashtest/planning/scopeDigest.js`
- Modify: `test/clashtest/support/syntheticModels.mjs` (use the real digest functions)
- Test: `test/clashtest/planning/scopeDigest.test.mjs`

**Interfaces**
- Consumes (**from P0 `clashtest/util/canonical.js`, per P0's *Phase interface summary*** — no longer "assumed"): `canonicalJson(value) => string`; **`digestCanonical(value) => 'sha256:…'`, which is SYNCHRONOUS** and documented "small values only"; `digestCanonicalSliced(value, slicer, {label?}) => Promise<'sha256:…'>`, byte-identical to it, one `slicer.tick` per ~8 KiB of canonical text; and the constants `DIGEST_VERSION = 1` / `DIGEST_PREFIX = 'sha256:'`. There is **no `digestOf`** and no async `digestCanonical` (reconciliation **N3**). `scopeDigest.js` must be the *only* P3 module that imports any of them.
  - Consequence for this task's two digest functions: they keep a `Promise` return (their declared contract, and the sliced path genuinely needs one) but take an optional `{slicer}`. Without it they fold the **synchronous** `digestCanonical` — correct for P3's own call sites, because per implementation-detail choice **D8 the *enumerator* computes the digests it returns**, so P3 only ever digests small in-test record lists. With it they fold `digestCanonicalSliced`, which is what a Viewer `ElementEnumerator` adapter over a real whole-model population must pass. No `await digestCanonical(...)` appears anywhere.
- Consumes (from P0 `clashtest/util/slicer.js`, only for the optional `{slicer}`): `createSlicer(...) → {tick(label?), …}`, where **`tick()` returns `undefined` (not due) or a Promise (due)** — `const p = slicer.tick('x'); if (p) await p;`. The slicer has **no `checkpoint()` and no `step()`** (reconciliation **N6**); `checkpoint()` in this phase always means the §6.2 `EnumerationContext`, a different object.
- Produces: `POPULATION_CLASS`, `encodePopulationRecords`, `digestPopulation`, `digestSubtree`, `compareScopeExpectation`, **`checkScopeBracket`** (duplicate-ownership **D1** — moved here from P6's deleted `run/freshness.js` builder pair).

**Steps**

- [ ] **Step 1: Write the failing digest test.**

```js
// test/clashtest/planning/scopeDigest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POPULATION_CLASS, encodePopulationRecords, digestPopulation, digestSubtree,
  compareScopeExpectation, checkScopeBracket,
} from '../../../clashtest/planning/scopeDigest.js';

const pop = (over = {}) => ({
  count: 4,
  records: [
    { fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 7 },
    { fragId: 1, cls: 'N' },
    { fragId: 2, cls: 'U' },
    { fragId: 3, cls: 'L', ownerDbId: 11, geometryId: 7 },
  ],
  ...over,
});

test('population records encode exactly the three §6.2.1 shapes, ascending', () => {
  assert.deepEqual(encodePopulationRecords(pop().records), [
    [0, 'L', 10, 7], [1, 'N'], [2, 'U'], [3, 'L', 11, 7],
  ]);
});

test('every mutation class changes the population digest', async () => {
  const base = (await digestPopulation(pop())).digest;
  const mutations = {
    'status flip': (p) => { p.records[1] = { fragId: 1, cls: 'L', ownerDbId: 10, geometryId: 7 }; },
    'owner change': (p) => { p.records[0].ownerDbId = 12; },
    'count-preserving geometry replacement': (p) => { p.records[0].geometryId = 8; },
    growth: (p) => { p.records.push({ fragId: 4, cls: 'L', ownerDbId: 12, geometryId: 9 }); p.count = 5; },
    shrink: (p) => { p.records.pop(); p.count = 3; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = pop(); mutate(p);
    assert.notEqual((await digestPopulation(p)).digest, base, name);
  }
});

test('subtree digest is order-insensitive on input but fixed on content', async () => {
  const recs = [{ fragId: 5, ownerDbId: 2, geometryId: 1 }, { fragId: 4, ownerDbId: 2, geometryId: 1 }];
  const a = await digestSubtree(recs);
  const b = await digestSubtree([...recs].reverse());
  assert.equal(a.digest, b.digest);
  assert.equal(a.digestVersion, 1);
  const c = await digestSubtree([{ fragId: 5, ownerDbId: 3, geometryId: 1 }, recs[1]]);
  assert.notEqual(c.digest, a.digest);
});

test('compareScopeExpectation brackets whole-model and root scopes', () => {
  const expect = { modelKey: 'm', role: 'target', scope: 'whole', population: { count: 2, digest: 'sha256:a' } };
  assert.equal(compareScopeExpectation(expect, { kind: 'population', count: 2, digest: 'sha256:a' }).status, 'equal');
  assert.equal(compareScopeExpectation(expect, { kind: 'population', count: 2, digest: 'sha256:b' }).status, 'mismatch');
  assert.equal(compareScopeExpectation(expect, null).status, 'unverifiable');
  const rootsExpect = { modelKey: 'm', role: 'source', scope: 'roots',
    roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }, { dbId: 2, subtreeDigest: 'sha256:y' }] };
  assert.equal(compareScopeExpectation(rootsExpect,
    { kind: 'roots', roots: [{ dbId: 2, subtreeDigest: 'sha256:y' }, { dbId: 1, subtreeDigest: 'sha256:x' }] }).status,
    'equal');
  assert.equal(compareScopeExpectation(rootsExpect,
    { kind: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }] }).status, 'mismatch');
});

// ---------------------------------------------------------------------------
// checkScopeBracket — the four cases inherited from P6's deleted
// test/clashtest/run/scopeBracket.test.mjs (duplicate-ownership D1).
// `bindings` is a `Map<modelKey, Binding|null>` the CALLER builds from P1's
// positional `snapshotBindings(keys).bindings` array (R7): P4 passes
// `resolved.byKey`, P6 passes `new Map(keys.map((k, i) => [k, snap.bindings[i]]))`.
// Per reconciliation N10 a Binding has NO `dead` flag — dead, unregistered and
// lease-invalid all read as `null`, which is the only fail-closed reading, and an
// absent key reads as `null` too.
// ---------------------------------------------------------------------------

const scopedEnumerator = (state) => ({
  state,
  setState(next) { this.state = next; },
  async digestScope(binding, scope, ctx) {
    ctx.checkpoint();
    const m = this.state[binding.modelKey];
    if (m?.throws) throw m.throws;
    return scope === 'whole'
      ? { kind: 'population', count: m.population.count, digest: m.population.digest }
      : { kind: 'roots', roots: m.roots.filter((r) => scope.dbIds.includes(r.dbId)) };
  },
});
const bindingOf = (modelKey) => ({ modelKey, model: {}, modelVersion: 'v1',
  lease: { model: {}, epoch: 1 }, bindingGeneration: 1, placementGeneration: 1 });
// The caller-built `Map<modelKey, Binding|null>` every `checkScopeBracket` call takes.
const bindingsOf = (entries) => new Map(Object.entries(entries));

test('an all-equal bracket reports equal and names no model', async () => {
  const expect = [{ modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] }];
  const enumerator = scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] } });
  const got = await checkScopeBracket(expect, { enumerator, bindings: bindingsOf({ M: bindingOf('M') }), ctx: { checkpoint() {} } });
  assert.deepEqual(got, { proof: 'equal', modelKeys: [] });
});

test('unchanged root subtrees with a MOVED population report drift naming the model (R20-1)', async () => {
  // The exact R20-1 shape: every source-root subtreeDigest is unchanged; only the population moved.
  const expect = [
    { modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] },
    { modelKey: 'M', role: 'source', scope: 'whole', population: { count: 12, digest: 'sha256:pM' } },
  ];
  const enumerator = scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }],   // UNCHANGED
                                             population: { count: 13, digest: 'sha256:pM-grown' } } }); // CHANGED
  const got = await checkScopeBracket(expect, { enumerator, bindings: bindingsOf({ M: bindingOf('M') }), ctx: { checkpoint() {} } });
  assert.equal(got.proof, 'drift');
  assert.deepEqual(got.modelKeys, ['M']);
});

test('unverifiable absorbs equal, while drift dominates both', async () => {
  const expect = [
    { modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] },
    { modelKey: 'X', role: 'target', scope: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x1' }] },
  ];
  const equalM = { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] };
  // equal + unverifiable -> unverifiable
  const a = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: equalM, X: { throws: new Error('tree unavailable') } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: bindingOf('X') }), ctx: { checkpoint() {} } });
  assert.equal(a.proof, 'unverifiable');
  assert.deepEqual(a.modelKeys, ['X']);
  // drift + unverifiable -> drift (a demonstrated change is never downgraded to "could not tell")
  const b = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:MOVED' }] },
                                   X: { throws: new Error('tree unavailable') } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: bindingOf('X') }), ctx: { checkpoint() {} } });
  assert.equal(b.proof, 'drift');
  assert.deepEqual(b.modelKeys, ['M']);
  // a null binding is unverifiable, never equal (N10: dead/unregistered/lease-invalid all read as null)
  const c = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: equalM, X: { roots: [{ dbId: 1, subtreeDigest: 'sha256:x1' }] } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: null }), ctx: { checkpoint() {} } });
  assert.equal(c.proof, 'unverifiable');
  assert.deepEqual(c.modelKeys, ['X']);
});

test('a population that grows and REVERTS between pre- and post-check is still caught', async () => {
  const expect = [{ modelKey: 'M', role: 'source', scope: 'whole', population: { count: 12, digest: 'sha256:pM' } }];
  const enumerator = scopedEnumerator({ M: { population: { count: 12, digest: 'sha256:pM' } } });
  const bindings = bindingsOf({ M: bindingOf('M') });
  const pre = await checkScopeBracket(expect, { enumerator, bindings, ctx: { checkpoint() {} } });
  assert.equal(pre.proof, 'equal');
  enumerator.setState({ M: { population: { count: 13, digest: 'sha256:pM-grown' } } });   // grows DURING the call
  const post = await checkScopeBracket(expect, { enumerator, bindings, ctx: { checkpoint() {} } });
  assert.equal(post.proof, 'drift', 'both sides compare against the PLANNING-TIME expectation, not against each other');
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/scopeDigest.test.mjs` → module not found.

- [ ] **Step 3: Implement the module.**

```js
// P0 `util/canonical.js`: digestCanonical is SYNCHRONOUS ("small values only");
// digestCanonicalSliced is its byte-identical Promise-returning form. (Reconciliation N3.)
import { digestCanonical, digestCanonicalSliced, DIGEST_VERSION } from '../util/canonical.js';
import { ENUMERATION_SCOPE_WHOLE } from './ElementEnumerator.js';   // used by checkScopeBracket (Step 4)

const digestOne = (value, slicer, label) =>
  (slicer ? digestCanonicalSliced(value, slicer, { label }) : Promise.resolve(digestCanonical(value)));

export const POPULATION_CLASS = Object.freeze({ LOADED: 'L', NOT_LOADED: 'N', OWNER_UNRESOLVABLE: 'U' });

export function encodePopulationRecords(records) {
  const sorted = [...records].sort((a, b) => a.fragId - b.fragId);
  return sorted.map((r) => {
    if (r.cls === POPULATION_CLASS.NOT_LOADED) return [r.fragId, 'N'];
    if (r.cls === POPULATION_CLASS.OWNER_UNRESOLVABLE) return [r.fragId, 'U'];
    return [r.fragId, 'L', r.ownerDbId, r.geometryId];
  });
}

export async function digestPopulation({ count, records }, { slicer } = {}) {
  const digest = await digestOne(
    { k: 'population', count, r: encodePopulationRecords(records) }, slicer, 'digest-population');
  return { kind: 'population', count, digest, digestVersion: DIGEST_VERSION };
}

export async function digestSubtree(records, { slicer } = {}) {
  const rows = [...records]
    .sort((a, b) => a.fragId - b.fragId)
    .map((r) => [r.fragId, r.ownerDbId, r.geometryId]);
  const digest = await digestOne({ k: 'subtree', r: rows }, slicer, 'digest-subtree');
  return { digest, digestVersion: DIGEST_VERSION };
}

export function compareScopeExpectation(expect, observed) {
  const base = { modelKey: expect.modelKey, role: expect.role };
  if (observed === null || typeof observed !== 'object')
    return { ...base, status: 'unverifiable', detail: 'no-observation' };
  if (expect.scope === 'whole') {
    if (observed.kind !== 'population') return { ...base, status: 'unverifiable', detail: 'kind-mismatch' };
    return observed.count === expect.population.count && observed.digest === expect.population.digest
      ? { ...base, status: 'equal', detail: null }
      : { ...base, status: 'mismatch', detail: 'population' };
  }
  if (observed.kind !== 'roots') return { ...base, status: 'unverifiable', detail: 'kind-mismatch' };
  if (observed.roots.length !== expect.roots.length) return { ...base, status: 'mismatch', detail: 'root-count' };
  const seen = new Map(observed.roots.map((r) => [r.dbId, r.subtreeDigest]));
  for (const r of expect.roots) {
    if (seen.get(r.dbId) !== r.subtreeDigest) return { ...base, status: 'mismatch', detail: `root:${r.dbId}` };
  }
  return { ...base, status: 'equal', detail: null };
}
```

  Comparison is **exact string equality** (§16.3.2): no thresholds, no counts-only heuristics. `unverifiable` and `mismatch` are distinct because §16.3.3 treats them differently (gap vs. run invalidation) — the comparator never collapses them.

  **`role` is an opaque label (P3's confirmation of P6's open item O8).** `compareScopeExpectation` copies `expect.role` into its result and **never branches on it**; `checkScopeBracket` does not read it at all. Any string is therefore legal, which is what makes P6's read-time `sealedScopeExpect` entries — which carry `role: 'recorded'`, because a sealed set records scopes rather than planning roles — valid input to the same one comparator P4 drives with `role: 'source'|'target'`. P3 will not add a branch on `role` without telling P6; the test above that feeds a `'target'` and a `'source'` entry through identical code paths is the standing guard.

- [ ] **Step 4: Implement `checkScopeBracket` in the same module (duplicate-ownership D1).** It is **one side** of a bracket: re-`digestScope` every scope the expectation lists and fold `compareScopeExpectation` over the answers. Both callers — P4's `LocalUnitExecutor` per unit (pre and post) and P6's `getFreshness` at read time — use this one implementation, which is why it lives beside the comparator it folds and **not** in `run/` (P4 may not import from `run/`; that would invert the master's dependency graph).

```js
/**
 * One side of the bracket. Folding rules, both fail-closed:
 *   - `unverifiable` absorbs `equal` (a scope we could not read is never proof of no change);
 *   - `drift` dominates both (a demonstrated change is never downgraded to "could not tell").
 * `modelKeys` names the models that produced the WINNING status, ascending, de-duplicated.
 * Note `bindings` is a `Map<modelKey, Binding|null>` (caller-built from P1's positional snapshot array, R7): per reconciliation N10 there is NO
 * `binding.dead` flag — dead, unregistered and lease-invalid all read as `null`, and a
 * `null` binding is `unverifiable`, never `equal`.
 */
export async function checkScopeBracket(scopeExpect, { enumerator, bindings, ctx }) {
  const drifted = new Set();
  const unverifiable = new Set();
  for (const entry of scopeExpect) {
    const binding = bindings.get(entry.modelKey) ?? null;
    if (binding === null) { unverifiable.add(entry.modelKey); continue; }
    let observed = null;
    try {
      observed = await enumerator.digestScope(
        binding,
        entry.scope === 'whole' ? ENUMERATION_SCOPE_WHOLE : { dbIds: entry.roots.map((r) => r.dbId) },
        ctx,
      );
    } catch (e) {
      if (e && e.name === 'EnumerationCancelledError') throw e;   // cancellation is never a proof
      unverifiable.add(entry.modelKey); continue;
    }
    const cmp = compareScopeExpectation(entry, observed);
    if (cmp.status === 'mismatch') drifted.add(entry.modelKey);
    else if (cmp.status === 'unverifiable') unverifiable.add(entry.modelKey);
  }
  const asc = (s) => [...s].sort();
  if (drifted.size) return { proof: 'drift', modelKeys: asc(drifted) };
  if (unverifiable.size) return { proof: 'unverifiable', modelKeys: asc(unverifiable) };
  return { proof: 'equal', modelKeys: [] };
}
```

  Three properties the tests pin and both consumers depend on: the expectation is **never rebuilt here** (it arrives from `materializeUnit(plan, unit).scopeExpect`, the sole R20-1 producer); each side compares against that **planning-time** expectation rather than against the other side, which is what catches a grow-and-revert between the pre- and post-check; and `EnumerationCancelledError` propagates unwrapped rather than being laundered into `unverifiable`.

- [ ] **Step 5: Make the fixture use the real digests.** Replace the placeholder in `syntheticModels.mjs` with `digestSubtree`/`digestPopulation` so every later test's digests are the production ones.

- [ ] **Step 6: Run and see it pass.** `node --test test/clashtest/planning/scopeDigest.test.mjs test/clashtest/planning/ElementEnumerator.test.mjs`.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.3: Record budget — `maxPlanReferences`, `maxLedgerRecords`, reserved overflow slots

This is the memory-bound core of §6.5.1 and is built before anything allocates, so *every* allocator goes through it.

**Files**
- Create: `clashtest/planning/ledger.js`
- Test: `test/clashtest/planning/ledger.budget.test.mjs`

**Interfaces**
- Consumes (**from P0 `clashtest/options.js`, per P0's *Phase interface summary*** — no longer "assumed"): `RUN_OPTION_DEFAULTS` (frozen, fully resolved). `maxPlanReferences`, `maxLedgerRecords`, `maxUnitsPerRun`, `maxElementTaintsPerUnit`, `maxSourceFragmentsPerUnit`, `maxSourceDbIdsPerUnit`, `maxTargetModelsPerUnit` and `maxTargetFragmentsPerUnit` are all **`RUN_OPTION_KEYS`**, so every P3 test reads them from `RUN_OPTION_DEFAULTS` and hard-codes no number. Validation is **`resolveRunOptions(input, limits?) → frozen ResolvedRunOptions`, which THROWS `InvalidOptionsError` synchronously** — arity 2 (run options are validated against resolved engine limits, so the limits resolve first) and it does **not** return `{options, issues}` (reconciliation **N31**). P3 never calls it: it receives an already-resolved `options` object from P6 and passes it to `createRecordBudget`. What P3 relies on is that `resolveRunOptions` has already enforced the §17.1.1 cross-field rule `maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun` (issue code `cross-field`) — that rule is the whole proof that `reserveUnitSlots()` can never fail.
- Produces: `createRecordBudget`, `LEDGER_RECORD_CLASSES`, `PLAN_RECORD_CLASSES`.

**Steps**

- [ ] **Step 1: Write the failing budget test.**

```js
// test/clashtest/planning/ledger.budget.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordBudget, PLAN_RECORD_CLASSES, LEDGER_RECORD_CLASSES } from '../../../clashtest/planning/ledger.js';

const limits = { maxPlanReferences: 100, maxLedgerRecords: 100 + 2 * 10, maxUnitsPerRun: 10 };

test('planning admission is refused at maxPlanReferences, before allocation', () => {
  const b = createRecordBudget(limits);
  assert.equal(b.admitPlan('root-table', 100), true);
  assert.equal(b.planRecords, 100);
  assert.equal(b.admitPlan('planning-gap', 1), false);   // refused
  assert.equal(b.planRecords, 100);                       // and nothing was counted
  assert.equal(b.planOverflowClass, 'planning-gap');
});

test('the reserve always fits and consumes no discretionary capacity', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', limits.maxPlanReferences);
  assert.equal(b.reserveUnitSlots(), true);
  assert.equal(b.used, limits.maxPlanReferences + limits.maxUnitsPerRun);
  assert.equal(b.discretionaryRemaining, limits.maxUnitsPerRun);   // ≥ maxUnitsPerRun, per §6.5.1 proof
  const before = b.used;
  assert.equal(b.consumeReservedSlot('u.0'), true);
  assert.equal(b.used, before);                                     // consumed IN PLACE
});

test('a unit may consume its reserved overflow slot exactly once', () => {
  const b = createRecordBudget(limits);
  b.reserveUnitSlots();
  assert.equal(b.consumeReservedSlot('1.0'), true);
  assert.equal(b.consumeReservedSlot('1.0'), false);   // already taken; caller reuses the existing taint
});

test('runtime admission refuses past the budget, flags exhaustion and names the first unit', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', 100);
  b.reserveUnitSlots();
  assert.equal(b.admitRuntime('element-taint', limits.maxUnitsPerRun, '1.0'), true);
  assert.equal(b.admitRuntime('element-taint', 1, '1.1'), false);
  assert.equal(b.budgetExhausted, true);
  assert.equal(b.firstRefusalUnitId, '1.1');
  assert.ok(b.used <= limits.maxLedgerRecords);
});

test('a multi-record block is admitted atomically or not at all', () => {
  const b = createRecordBudget(limits);
  b.admitPlan('root-table', 100); b.reserveUnitSlots();
  assert.equal(b.admitRuntime('split', limits.maxUnitsPerRun + 1, '2.0'), false);
  assert.equal(b.discretionaryRemaining, limits.maxUnitsPerRun);   // no partial block
});

test('every §6.5.1 record class is named', () => {
  for (const c of PLAN_RECORD_CLASSES) assert.ok(LEDGER_RECORD_CLASSES.includes(c));
  assert.deepEqual([...LEDGER_RECORD_CLASSES].sort(), [
    'element-taint', 'hierarchy-internal', 'planning-gap', 'root-owner', 'root-table',
    'scope-digest', 'split', 'target-model-taint', 'unit-range', 'unit-record',
    'unit-taint', 'unreachable-population', 'unresolved-selection',
  ]);
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/ledger.budget.test.mjs` → module not found.

- [ ] **Step 3: Implement `createRecordBudget`.**

```js
export const PLAN_RECORD_CLASSES = Object.freeze([
  'root-table', 'root-owner', 'unreachable-population', 'scope-digest',
  'unresolved-selection', 'hierarchy-internal', 'planning-gap', 'unit-record', 'unit-range',
]);
export const LEDGER_RECORD_CLASSES = Object.freeze([
  ...PLAN_RECORD_CLASSES, 'element-taint', 'target-model-taint', 'unit-taint', 'split',
]);

export function createRecordBudget({ maxPlanReferences, maxLedgerRecords, maxUnitsPerRun }) {
  let planRecords = 0, reserved = 0, discretionary = 0;
  const consumedSlots = new Set();
  const state = {
    budgetExhausted: false, firstRefusalUnitId: null, planOverflowClass: null,
    get planRecords() { return planRecords; },
    get used() { return planRecords + reserved + discretionary; },
    get discretionaryRemaining() { return maxLedgerRecords - (planRecords + reserved + discretionary); },
    admitPlan(cls, n) {
      if (planRecords + n > maxPlanReferences) { state.planOverflowClass = cls; return false; }
      planRecords += n; return true;
    },
    reserveUnitSlots() {
      // §6.5.1 proof: planRecords ≤ maxPlanReferences and (validated options)
      // maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun ⇒ this cannot fail.
      if (planRecords + maxUnitsPerRun > maxLedgerRecords) return false;   // internal invariant
      reserved = maxUnitsPerRun; return true;
    },
    consumeReservedSlot(unitId) {
      if (consumedSlots.has(unitId)) return false;
      consumedSlots.add(unitId); return true;   // `used` deliberately unchanged
    },
    admitRuntime(cls, n, unitId) {
      if (state.discretionaryRemaining < n) {
        state.budgetExhausted = true;
        if (state.firstRefusalUnitId === null) state.firstRefusalUnitId = unitId ?? null;
        return false;
      }
      discretionary += n; return true;
    },
  };
  return state;
}
```

  Two properties the tests pin: admission is **checked before allocation** and a block is **atomic** (`split` admits the two child unit records *and* their range records as one `n`), so no half-recorded split can exist (§6.5.1 table row 5).

- [ ] **Step 4: Run and see it pass.** `node --test test/clashtest/planning/ledger.budget.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.4: Run-scoped plan tables, ranges, and owner classes

**Files**
- Create: `clashtest/planning/planTables.js`, `clashtest/planning/owners.js`
- Test: `test/clashtest/planning/planTables.test.mjs`, `test/clashtest/planning/owners.test.mjs`

**Interfaces**
- Consumes: `createRecordBudget` (P3.3).
- Produces: `buildRootTables`, `readRange`, `rangeRootCount`, `rangeFragmentWeight`, `bisectRanges`, `TABLE_CLASSES`; `OWNER_CLASS`, `classifyOwners`, `ownerClassOf`, `rootOfOwner`.

**Steps**

- [ ] **Step 1: Write the failing table test.**

```js
// test/clashtest/planning/planTables.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRootTables, readRange, rangeRootCount, rangeFragmentWeight, bisectRanges }
  from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

const model = (modelKey, aPrime, c, bPrime) => ({ modelKey, classes: { "A'": aPrime, C: c, "B'": bPrime } });
const root = (dbId, owners, frags) => ({ dbId, fragmentCount: frags, ownerDbIds: owners, subtreeDigest: `sha256:${dbId}` });

test('table ids are positional and canonical (ascending modelKey, then A&prime;, C, B&prime;)', () => {
  const budget = createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });
  const { tables, tableById } = buildRootTables({ models: [
    model('zz', [root(1, [1], 1)], [], []),
    model('aa', [], [root(4, [4], 2)], [root(9, [9], 3)]),
  ], budget });
  assert.deepEqual(tables.map(t => [t.id, t.modelKey, t.cls]), [
    ['t0', 'aa', 'C'], ['t1', 'aa', "B'"], ['t2', 'zz', "A'"],
  ]);
  assert.equal(tableById.get('t2').rows[0].dbId, 1);
});

test('ranges are half-open and read back the exact root dbIds and weights', () => {
  const budget = createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 5), root(3, [3], 7), root(8, [8], 2)], [], [])], budget });
  const r = { table: 't0', start: 0, end: 3 };
  assert.deepEqual(readRange(plan, r), [1, 3, 8]);
  assert.equal(rangeRootCount(r), 3);
  assert.equal(rangeFragmentWeight(plan, r), 14);
  assert.deepEqual(readRange(plan, { table: 't0', start: 1, end: 2 }), [3]);
});

test('bisectRanges splits the ordered root sequence in half and never splits a root', () => {
  const budget = createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 1), root(2, [2], 1), root(3, [3], 1)], [], [])], budget });
  const [l, r] = bisectRanges(plan, [{ table: 't0', start: 0, end: 3 }]);
  assert.deepEqual(readRange(plan, l[0]), [1]);
  assert.deepEqual(r.flatMap(x => readRange(plan, x)), [2, 3]);
  const [l2, r2] = bisectRanges(plan, [{ table: 't0', start: 0, end: 1 }, { table: 't0', start: 2, end: 3 }]);
  assert.deepEqual(l2.flatMap(x => readRange(plan, x)), [1]);
  assert.deepEqual(r2.flatMap(x => readRange(plan, x)), [3]);
});

test('building tables charges the budget per root row and per owner entry', () => {
  const budget = createRecordBudget({ maxPlanReferences: 4, maxLedgerRecords: 100, maxUnitsPerRun: 1 });
  const out = buildRootTables({ models: [model('m', [root(1, [1, 2], 2), root(3, [3], 1)], [], [])], budget });
  assert.equal(out.ok, false);          // 2 rows + 3 owners = 5 > 4
  assert.equal(out.overflowClass, 'root-owner');
  assert.equal(budget.planRecords, 2);  // the rows that were admitted; nothing partial beyond
});

test('a duplicate owner across two roots is an enumerator defect', () => {
  const budget = createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });
  const out = buildRootTables({ models: [model('m', [root(1, [5], 1), root(2, [5], 1)], [], [])], budget });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'enumeration-failed');
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/planTables.test.mjs`.

- [ ] **Step 3: Implement `planTables.js`.** Tables are positional (`t0`, `t1`, …) rather than keyed by `modelKey` so no `modelKey` string ever needs escaping in a range id, and the ids are a pure function of the canonical (ascending `modelKey`, then class order `A'`, `C`, `B'`) build order. Per model, the roots' ascending `ownerDbIds` are concatenated **in root order** into one `ownersByModel[modelKey]` array; each row keeps `[ownerStart, ownerEnd)` into it, and `ownerRootByModel[modelKey]` is a `Map<ownerDbId, rootDbId>` (the §5.6.4 `rootOwners` map). Because roots are a subtree-disjoint antichain, an owner appearing under two roots is an enumerator defect and fails planning `enumeration-failed`. Budget: `admitPlan('root-table', rows)` then `admitPlan('root-owner', owners)` per model, each checked before allocation, returning `{ok:false, overflowClass}` on refusal so the caller raises `plan-too-large`.

```js
export function rangeRootCount(range) { return range.end - range.start; }
export function readRange(plan, { table, start, end }) {
  const rows = plan.tableById.get(table).rows;
  const out = []; for (let i = start; i < end; i++) out.push(rows[i].dbId); return out;
}
export function rangeFragmentWeight(plan, { table, start, end }) {
  const rows = plan.tableById.get(table).rows;
  let w = 0; for (let i = start; i < end; i++) w += rows[i].fragmentCount; return w;
}
export function bisectRanges(plan, ranges) {
  const total = ranges.reduce((n, r) => n + rangeRootCount(r), 0);
  const half = Math.floor(total / 2);                 // deterministic, left-lighter
  const left = [], right = []; let seen = 0;
  for (const r of ranges) {
    const n = rangeRootCount(r);
    if (seen + n <= half) { left.push(r); }
    else if (seen >= half) { right.push(r); }
    else {
      const cut = r.start + (half - seen);
      if (cut > r.start) left.push({ table: r.table, start: r.start, end: cut });
      if (cut < r.end) right.push({ table: r.table, start: cut, end: r.end });
    }
    seen += n;
  }
  return [left, right];
}
```

- [ ] **Step 4: Write the failing owner-class test and implement `owners.js`.**

```js
// test/clashtest/planning/owners.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_CLASS, classifyOwners } from '../../../clashtest/planning/owners.js';

test('owners partition into root-only, unreachable-only and mixed (AC-17 (a))', () => {
  const { mixedOwnerDbIds, unreachableOnlyDbIds } =
    classifyOwners({ rootOwnerDbIds: [200, 900], unreachableOwnerDbIds: [900, 950] });
  assert.deepEqual(mixedOwnerDbIds, [900]);
  assert.deepEqual(unreachableOnlyDbIds, [950]);
});

test('classification is independent of input order and always ascending', () => {
  const a = classifyOwners({ rootOwnerDbIds: [900, 200], unreachableOwnerDbIds: [950, 900] });
  const b = classifyOwners({ rootOwnerDbIds: [200, 900], unreachableOwnerDbIds: [900, 950] });
  assert.deepEqual(a, b);
  assert.equal(OWNER_CLASS.MIXED, 'mixed');
});
```

  `classifyOwners` is a two-pointer merge over the two ascending arrays (pure, O(n)). `ownerClassOf(plan, modelKey, dbId)` reads the model's recorded sets; `rootOfOwner` reads `ownerRootByModel`. Neither depends on which unit produced a result — that invariance is what AC-17 (b) needs.

- [ ] **Step 5: Run and see both pass.** `node --test test/clashtest/planning/planTables.test.mjs test/clashtest/planning/owners.test.mjs`.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.5: Root resolution stage — enumeration, hierarchy-overlap (F16), declared exclusions

**Files**
- Create: `clashtest/planning/rootResolution.js`
- Test: `test/clashtest/planning/rootResolution.test.mjs`
- Modify: `test/clashtest/support/syntheticModels.mjs` (nested-root and unreachable specs)

**Interfaces**
- Consumes (**from P2 `clashtest/definition/normalize.js`, per P2's *Phase interface summary***): `prepareDefinition(captured, {yieldToScheduler, now, sliceBudgetMs}) => Promise<{definition, semanticDigest}>` produces the value P3 plans over — each selection's `entries` ascending by `modelKey`, exactly one entry per `modelKey`, `kind:'model'` winning over `kind:'elements'`, each `dbIds` array de-duplicated and ascending, deep-frozen. **P3 consumes the normalized definition and re-sorts nothing.** P3 also consumes P2's three rule-input helpers rather than re-deriving them (master §2.1: a consumer must not re-implement an owned interface): `assertRootAntichain(roots) => {ok, violations}`, `checkCrossRoleNesting({rootsA, rootsB, rootsUnion}) => {supported, offenders, enumeratorInconsistent}` (offenders already capped at 20 `{ancestor, descendant}`), and `hierarchyInternalCandidates({rootsA, rootsB}) => Array<{dbId, ownerCount}>`. P3 supplies the three enumerator answers and owns only the *consequences* (planning cause, ledger rows, claim-blocking record).
- Consumes (**from P1 `clashtest/identity/ModelRegistry.js`, per P1's *Phase interface summary*** — no longer "assumed): **`registry.snapshotBindings(modelKeys: Iterable<string>) → Readonly<{registryRevision: number, bindings: ReadonlyArray<Binding|null>}>`**. The result is a **positional array whose indices match the input key order** — *not* a `Map<modelKey, …>`, and the entries are whole `Binding`s, not `{binding, modelVersion, …}` wrappers. `Binding = {modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration}`, frozen and never persisted; there is **no `dead` flag** — a `null` entry means "no live binding with a valid lease" (never registered, unregistered, or the world says evicted/disposed), which is the fail-closed reading §16.1 requires (reconciliation **N10**, **N34**).
  - **Controller ruling R7: the run-start leases come from this one `snapshotBindings` call.** P3 reads `binding.lease` off the snapshot and hands the whole `Binding` to `enumerator.resolveRoots(binding, scope, ctx)`; it never calls the registry, never re-reads a binding mid-plan, and never takes a lease of its own. A `null` entry for a key the definition names fails planning `model-not-bound` (§6.6 planning cause) **before any enumeration**.
  - P3 receives the *already-taken* snapshot as the `snapshot` argument. Because the array is positional, `resolveSelectionRoots` indexes it by building the ascending `modelKeys` list it passed (or was passed) and zipping — it must never assume `Map` lookup. The test helper `snapshotOf(binding, [modelKey…])` in `syntheticModels.mjs` produces exactly this `{registryRevision, bindings: [Binding|null, …]}` shape.
- Consumes: the `ElementEnumerator` port (P3.1), `digestSubtree`/`digestPopulation` (P3.2), `createRecordBudget` (P3.3).
- Produces: `resolveSelectionRoots`.

**Steps**

- [ ] **Step 1: Write the failing stage test.**

```js
// test/clashtest/planning/rootResolution.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelectionRoots } from '../../../clashtest/planning/rootResolution.js';
import { makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';

test('cross-role nesting fails planning with hierarchy-overlap and the first 20 offenders (§5.6.5)', async () => {
  const spec = { modelKey: 'm',
    roots: [{ dbId: 100, owners: [100, 105], fragments: [{ fragId: 0, ownerDbId: 100, geometryId: 1 },
                                                        { fragId: 1, ownerDbId: 105, geometryId: 1 }] }],
    ancestorOf: { 105: 100 } };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [100] }],
                        B: [{ kind: 'elements', modelKey: 'm', dbIds: [105] }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'hierarchy-overlap');
  assert.deepEqual(out.detail.offenders, [{ ancestor: 100, descendant: 105 }]);
  assert.ok(out.detail.offenders.length <= 20);
});

test('root-identical same-model overlap is supported and plans (A = B)', async () => {
  const spec = { modelKey: 'm', roots: [
    { dbId: 10, owners: [10], fragments: [{ fragId: 0, ownerDbId: 10, geometryId: 1 }] },
    { dbId: 20, owners: [20, 21], fragments: [{ fragId: 1, ownerDbId: 20, geometryId: 1 },
                                              { fragId: 2, ownerDbId: 21, geometryId: 1 }] }] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {},
  });
  assert.equal(out.ok, true);
  const m = out.models.get('m');
  assert.deepEqual(m.classes["A'"].map(r => r.dbId), []);
  assert.deepEqual(m.classes.C.map(r => r.dbId), [10, 20]);
  assert.deepEqual(m.classes["B'"].map(r => r.dbId), []);
  // R2: every root carries its durable class marker, assigned once, here.
  assert.deepEqual(m.classes.C.map(r => r.cls), ['C', 'C']);
  // §6.6 item 3: only C roots with ≥ 2 distinct fragment owners enter hierarchyInternal.
  assert.deepEqual(out.hierarchyInternal, [{ modelKey: 'm', rootCount: 1, ownerCount: 2,
    examples: [{ rootDbId: 20, ownerDbIds: [20, 21] }] }]);
});

test('a `not-found` explicit dbId fails planning; a `no-fragments` one is a claim-blocking record', async () => {
  const spec = { modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }],
                 missingDbIds: [777], emptyDbIds: [55] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const mk = (dbIds) => resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  const bad = await mk([1, 777]);
  assert.equal(bad.ok, false);
  assert.equal(bad.cause, 'element-unresolvable');
  const soft = await mk([1, 55]);
  assert.equal(soft.ok, true);
  // P5's pinned persisted shape: one row per (selectionRole, modelKey, cause), dbIds ascending.
  assert.deepEqual(soft.unresolvedSelections,
    [{ selectionRole: 'A', modelKey: 'm', cause: 'no-fragments', dbIds: [55] }]);
});

test('a non-zero ownerMismatch fails planning closed (§6.2)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(
    [{ modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }],
       ownerMismatchCount: 3 }]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.equal(out.cause, 'owner-mapping-mismatch');
});

test('unreachable population is recorded orientation-independently with owner classes (AC-2, AC-17 (g))', async () => {
  const spec = { modelKey: 'm',
    roots: [{ dbId: 100, owners: [200, 900], fragments: [{ fragId: 40, ownerDbId: 200, geometryId: 1 },
                                                         { fragId: 41, ownerDbId: 900, geometryId: 1 }] }],
    unreachable: [{ fragId: 42, cls: 'L', ownerDbId: 900, geometryId: 1 },
                  { fragId: 43, cls: 'L', ownerDbId: 950, geometryId: 1 },
                  { fragId: 44, cls: 'N' }, { fragId: 45, cls: 'U' }] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.deepEqual(out.unreachablePopulation, [{ modelKey: 'm', count: 2, ownerDbIds: [900, 950],
    mixedOwnerDbIds: [900], unattributable: { notLoaded: 1, ownerUnresolvable: 1 } }]);
  assert.deepEqual(out.libraryExclusions, ['tree-unreachable-population']);
});

test('the three resolveRoots answers for one model must agree, else enumeration-failed', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(
    [{ modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }] }],
    { driftOnCall: 3 });   // the 3rd resolveRoots of the run returns a different subtreeDigest
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [1] }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.equal(out.cause, 'enumeration-failed');
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/rootResolution.test.mjs`.

- [ ] **Step 3: Implement the stage.** For each `modelKey` in the union of the two selections' entries, in ascending `modelKey` order, `await`ing `checkpoint()` between models:

  1. `scopeA`, `scopeB` from the normalized entries (`'whole'` for `kind:'model'`, `{dbIds}` otherwise); `scopeU = ('whole' if either is 'whole') else {dbIds: merge(ascending unique)}`. A model named by only one selection has the other scope `null` and its role set empty.
  2. `resolveRoots` for each non-null scope **and** for `scopeU`; validate each answer with `validateResolveRootsResult`; a rejection ⇒ `enumeration-failed`.
  3. **Agreement (§6.2 last bullet):** every root dbId shared between two answers must carry an equal `subtreeDigest`, equal `fragmentCount` and an equal `ownerDbIds` list, and the `population` must be equal wherever two answers report one. Otherwise `enumeration-failed`.
  4. **`ownerMismatch.count > 0` ⇒ `owner-mapping-mismatch`** (fail closed, spec §6.2).
  5. **Unresolved:** any `reason: 'not-found'` ⇒ `element-unresolvable` with the first 20 offenders, no unit runs. `'no-fragments'` ⇒ a claim-blocking `unresolvedSelections` row in **P5's pinned persisted shape — `{selectionRole: 'A'|'B', modelKey, cause, dbIds: number[]}`** (one row per `(selectionRole, modelKey, cause)`, `dbIds` ascending), not a row per dbId. `cause` is the enumerator's reason (`'no-fragments'`).
  6. **Hierarchy overlap:** call P2's `checkCrossRoleNesting({rootsA, rootsB, rootsUnion})`; `supported === false` ⇒ fail `hierarchy-overlap` with its `offenders` (already the first 20 `{ancestor, descendant}`), `enumeratorInconsistent === true` ⇒ fail `enumeration-failed`. P3 also calls `assertRootAntichain` on each answer; a violation is an enumerator defect (`enumeration-failed`). If P2's helper turns out not to name the ancestor, the derivation is: build `ownerRoot: Map<ownerDbId, ruRootDbId>` from the `RU` answer and look up `d.ownerDbIds[0]` for each dropped root `d` — exact, because `d`'s subtree lies under exactly one `RU` root and `RU` owner sets are disjoint (see D6).
  7. **Classes:** `A'_m = RA \ RB`, `C_m = RA ∩ RB`, `B'_m = RB \ RA`, each ascending by `dbId`, taking the row objects from the `RU` answer so every class shares one digest/owner source. **Each row also carries its durable class marker `cls` (controller ruling R2)** — `ROOT_CLASS.A_ONLY = 'A'` for `A'`, `ROOT_CLASS.BOTH = 'C'` for `C`, `ROOT_CLASS.B_ONLY = 'B'` for `B'` — so the `rootOwners` rows the ledger persists in step 11 carry it without a second pass over the classes. The marker is assigned **here**, once, from the set arithmetic that defines the classes; nothing downstream re-derives it.
  8. **Unreachable + owner classes:** from the whole-scope answer (only), `classifyOwners({rootOwnerDbIds: all roots' owners merged ascending, unreachableOwnerDbIds: unreachable.ownerDbIds})`; record a row iff `count > 0 || notLoaded > 0 || ownerUnresolvable > 0`; when any row exists add `'tree-unreachable-population'` to `libraryExclusions` (persisted as the ledger's `exclusions[]`). The **run-scoped** row keeps `count`; the **persisted** row is P5's pinned four-field shape `{modelKey, ownerDbIds, mixedOwnerDbIds, unattributable}`, so `toLedgerRecord()` projects `count` away. Nothing reads it downstream (`count` is exactly `ownerDbIds.length`'s attributable total, and §12.5's `not-required` rule reads `ownerDbIds`/`mixedOwnerDbIds`), so the projection is lossless in use; it is listed as a P5 cross-file *observation*, not a blocking need.
  9. **`hierarchyInternal`:** the candidate set is P2's, not P3's — call **`hierarchyInternalCandidates({rootsA, rootsB}) → Array<{dbId, ownerCount}>`** (§5.6.3 rule input: roots in `A ∩ B` whose subtree has ≥ 2 fragment owners) and do **not** re-derive "`C_m` contains a root with `ownerDbIds.length ≥ 2`" here; master §2.1 forbids a consumer re-implementing an owned interface, and this is the same rule P2 already tests. P3 owns only the *consequence*: one row per model with a non-empty candidate list, in P5's pinned persisted shape `{modelKey, rootCount, ownerCount, examples: first 20 × {rootDbId, ownerDbIds: first 8}}`, `rootCount`/`ownerCount` exact (D4). **The bounded `examples` list is a convenience, never the source of truth** — per ruling R2 the full A∩B root set is recoverable from the persisted `rootOwners` rows' `cls === 'C'`, which is what keeps P8's element-level caveats from under-reporting (master §8, OPEN-2 option (a)).
  10. **`scopeKinds`:** per model `{A: 'model'|'elements'|null, B: …}`, recorded so a consumer can tell which operands had a population witness (§6.2 residual limit).
  11. Every recorded row is admitted through the budget (`unreachable-population`, `unresolved-selection`, `hierarchy-internal`, `scope-digest`, `planning-gap`) *before* allocation; a refusal returns `{ok:false, cause:'plan-too-large', overflowClass}`.

- [ ] **Step 4: Run and see it pass.** `node --test test/clashtest/planning/rootResolution.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.6: Three-cell decomposition, exact cover, same-model safety (§6.3)

**Files**
- Create: `clashtest/planning/decompose.js`
- Test: `test/clashtest/planning/decompose.test.mjs`

**Interfaces**
- Consumes: `resolveSelectionRoots` output (P3.5), `buildRootTables`/`readRange` (P3.4).
- Produces: `decomposeCells`, `CELL_IDS`, `targetScopeFor`.

**Steps**

- [ ] **Step 1: Write the failing decomposition test.** It compares cell output against a brute-force `P` built from the root sets directly.

```js
// test/clashtest/planning/decompose.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeCells } from '../../../clashtest/planning/decompose.js';
import { buildRootTables, readRange } from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

const budget = () => createRecordBudget({ maxPlanReferences: 1e6, maxLedgerRecords: 3e6, maxUnitsPerRun: 1e4 });
const row = (dbId) => ({ dbId, fragmentCount: 1, ownerDbIds: [dbId], subtreeDigest: `sha256:${dbId}` });

// Reference: the required pair space of §6.1, straight from the definition of A and B.
function requiredPairs(models, ordered) {
  const out = new Set();
  for (const [mk, m] of models) for (const x of m.A) for (const [nk, n] of models) for (const y of n.B) {
    if (mk === nk && x === y) continue;
    out.add(ordered ? `${mk}:${x}>${nk}:${y}` : [`${mk}:${x}`, `${nk}:${y}`].sort().join('|'));
  }
  return out;
}
function coveredPairs(plan, cells, ordered) {
  const out = [];
  for (const c of cells) for (const s of c.sourceRanges.flatMap(r => readRange(plan, r)))
    for (const t of c.targets) {
      const ys = t.scope === 'whole' ? t.wholeRootDbIds : t.scope.ranges.flatMap(r => readRange(plan, r));
      for (const y of ys) {
        if (c.sourceModelKey === t.modelKey && s === y) continue;
        out.push(ordered ? `${c.sourceModelKey}:${s}>${t.modelKey}:${y}`
                         : [`${c.sourceModelKey}:${s}`, `${t.modelKey}:${y}`].sort().join('|'));
      }
    }
  return out;
}

function fixture(defs) {   // defs: [{modelKey, A:[dbId], B:[dbId], wholeA, wholeB}]
  const models = new Map(defs.map(d => {
    const A = new Set(d.A), B = new Set(d.B), all = [...new Set([...d.A, ...d.B])].sort((a, b) => a - b);
    return [d.modelKey, {
      A: d.A, B: d.B, wholeA: !!d.wholeA, wholeB: !!d.wholeB,
      classes: { "A'": all.filter(x => A.has(x) && !B.has(x)).map(row),
                 C:    all.filter(x => A.has(x) && B.has(x)).map(row),
                 "B'": all.filter(x => !A.has(x) && B.has(x)).map(row) },
    }];
  }));
  const plan = buildRootTables({ models: [...models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })),
                                budget: budget() });
  return { models, plan };
}

test('cross-model disjoint selections collapse to cell 1 only', () => {
  const { models, plan } = fixture([{ modelKey: 'x', A: [1, 2], B: [] }, { modelKey: 'y', A: [], B: [7, 8] }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))], ['1']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);           // exactly once
});

test('A = B in one model collapses to cell 3b and covers every unordered pair exactly once (F2)', () => {
  const { models, plan } = fixture([{ modelKey: 'm', A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))], ['3b']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);
  assert.equal(got.length, (5 * 4) / 2);
  // F2: every same-model cell has disjoint source/target root sets.
  for (const c of cells) for (const t of c.targets) {
    if (t.modelKey !== c.sourceModelKey) continue;
    const s = new Set(c.sourceRanges.flatMap(r => readRange(plan, r)));
    for (const y of t.scope.ranges.flatMap(r => readRange(plan, r))) assert.equal(s.has(y), false);
  }
});

test('partial same-model overlap uses all four cells and still covers exactly once', () => {
  const { models, plan } = fixture([
    { modelKey: 'a', A: [1, 2, 3], B: [2, 3, 4] },
    { modelKey: 'b', A: [5, 6], B: [6, 7] },
  ]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual([...new Set(cells.map(c => c.cell))].sort(), ['1', '2', '3a', '3b']);
  const got = coveredPairs(plan, cells, false);
  assert.deepEqual(new Set(got), requiredPairs(models, false));
  assert.equal(got.length, new Set(got).size);
});

test('ordered mode (containment) covers each ordered pair exactly once', () => {
  const { models, plan } = fixture([{ modelKey: 'a', A: [1, 2, 3], B: [2, 3] },
                                    { modelKey: 'b', A: [4], B: [4, 5] }]);
  const cells = decomposeCells({ models, plan, ordered: true });
  const got = coveredPairs(plan, cells, true);
  assert.deepEqual(new Set(got), requiredPairs(models, true));
  assert.equal(got.length, new Set(got).size);
  assert.deepEqual([...new Set(cells.map(c => c.orientationRole))].sort(), ['A->B', 'B->A']);
});

test('the whole-model sentinel is used only when the model carries no source-role root', () => {
  const { models, plan } = fixture([{ modelKey: 'x', A: [1], B: [] },
                                    { modelKey: 'y', A: [], B: [7, 8], wholeB: true }]);
  const cells = decomposeCells({ models, plan, ordered: false });
  assert.deepEqual(cells[0].targets.map(t => t.scope), ['whole']);
  const { models: m2, plan: p2 } = fixture([{ modelKey: 'x', A: [1], B: [], },
                                            { modelKey: 'y', A: [9], B: [7, 8], wholeB: true }]);
  const cells2 = decomposeCells({ models: m2, plan: p2, ordered: false });
  for (const c of cells2) for (const t of c.targets) assert.notEqual(t.scope, 'whole');
});

test('cells are emitted in canonical order and are byte-identical under model reordering', () => {
  const f1 = fixture([{ modelKey: 'a', A: [1], B: [2] }, { modelKey: 'b', A: [3], B: [4] }]);
  const f2 = fixture([{ modelKey: 'b', A: [3], B: [4] }, { modelKey: 'a', A: [1], B: [2] }]);
  const norm = (f) => JSON.stringify(decomposeCells({ models: f.models, plan: f.plan, ordered: false })
    .map(c => ({ ...c, sourceRanges: c.sourceRanges.map(r => readRange(f.plan, r)),
                 targets: c.targets.map(t => ({ modelKey: t.modelKey,
                   scope: t.scope === 'whole' ? 'whole' : t.scope.ranges.map(r => readRange(f.plan, r)) })) })));
  assert.equal(norm(f1), norm(f2));
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/decompose.test.mjs`.

- [ ] **Step 3: Implement `decomposeCells`.** All sets are *ranges*, never copied dbId arrays (§6.5).

```js
export const CELL_IDS = Object.freeze(['1', '2', '3a', '3b']);

// §6.3 cell-2 note, generalized (see "Implementation-detail choices" D3): a model may be named by the
// whole-model sentinel as a TARGET only when its whole root set is exactly B_n and it carries no
// source-role root — i.e. selection B for n is kind:'model' AND A_n is empty. Otherwise the target is
// an explicit range list, so a source root of n can never appear in n's own target population.
export function targetScopeFor(model, ranges) {
  return (model.wholeB && model.A.length === 0) ? 'whole' : { ranges };
}

export function decomposeCells({ models, plan, ordered }) {
  const keys = [...models.keys()].sort();                       // code-unit order, §5.3 normalization
  const cells = [];
  const rangeOf = (mk, cls) => plan.rangeOfClass(mk, cls);       // null when the class is empty
  const targetsOfB = () => keys.flatMap((nk) => {
    const n = models.get(nk);
    const rs = [rangeOf(nk, 'C'), rangeOf(nk, "B'")].filter(Boolean);
    if (rs.length === 0) return [];
    return [{ modelKey: nk, scope: targetScopeFor(n, rs) }];
  });
  const targetsOfBPrime = () => keys.flatMap((nk) => {
    const r = rangeOf(nk, "B'");
    if (!r) return [];
    return [{ modelKey: nk, scope: targetScopeFor(models.get(nk), [r]) }];
  });

  // Cell 1: A'_m  ->  B_n for every n.
  for (const mk of keys) {
    const src = rangeOf(mk, "A'"); if (!src) continue;
    const targets = targetsOfB(); if (targets.length === 0) continue;
    cells.push({ cell: '1', sourceModelKey: mk, sourceRanges: [src], targets, orientationRole: 'A->B' });
  }
  // Cell 2: C_m -> B'_n for every n.
  for (const mk of keys) {
    const src = rangeOf(mk, 'C'); if (!src) continue;
    const targets = targetsOfBPrime(); if (targets.length === 0) continue;
    cells.push({ cell: '2', sourceModelKey: mk, sourceRanges: [src], targets, orientationRole: 'A->B' });
  }
  // Cell 3a: C_m -> C_n, one unordered model pair (m < n); both orientations when ordered.
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = rangeOf(keys[i], 'C'), b = rangeOf(keys[j], 'C');
    if (!a || !b) continue;
    cells.push({ cell: '3a', sourceModelKey: keys[i], sourceRanges: [a],
                 targets: [{ modelKey: keys[j], scope: { ranges: [b] } }],
                 orientationRole: ordered ? 'A->B' : 'canonical' });
    if (ordered) cells.push({ cell: '3a', sourceModelKey: keys[j], sourceRanges: [b],
                              targets: [{ modelKey: keys[i], scope: { ranges: [a] } }], orientationRole: 'B->A' });
  }
  // Cell 3b: recursive bisection of C_m against itself.
  for (const mk of keys) {
    const c = rangeOf(mk, 'C'); if (!c) continue;
    bisect([c]);
    function bisect(ranges) {
      const n = ranges.reduce((k, r) => k + (r.end - r.start), 0);
      if (n <= 1) return;
      const [L, R] = bisectRanges(plan, ranges);
      if (L.length && R.length) {
        cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: L,
                     targets: [{ modelKey: mk, scope: { ranges: R } }],
                     orientationRole: ordered ? 'A->B' : 'canonical' });
        if (ordered) cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: R,
                                  targets: [{ modelKey: mk, scope: { ranges: L } }], orientationRole: 'B->A' });
      }
      bisect(L); bisect(R);
    }
  }
  return cells;
}
```

  `plan.rangeOfClass(modelKey, cls)` is added to `planTables.js` in this task: it returns the full half-open range of that (model, class) table or `null` when the class is empty.

- [ ] **Step 4: Run and see it pass.** `node --test test/clashtest/planning/decompose.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.7: Unit sizing — source packing, target slicing, per-unit caps, `target-too-large` gaps

**Files**
- Create: `clashtest/planning/sizing.js`
- Test: `test/clashtest/planning/sizing.test.mjs`

**Interfaces**
- Consumes: `decomposeCells` output (P3.6), `rangeFragmentWeight`/`rangeRootCount` (P3.4), `RUN_OPTION_DEFAULTS` (P0, Assumed).
- Produces: `sizeUnits`, `unitIdFor`.

**Steps**

- [ ] **Step 1: Write the failing sizing test.**

```js
// test/clashtest/planning/sizing.test.mjs  (excerpt — the full file also repeats each case under reordering)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeUnits } from '../../../clashtest/planning/sizing.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSizingFixture } from '../support/syntheticModels.mjs';

test('source side is a PACKING TARGET: one root heavier than the cap forms its own unit', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 500, 1] , targets: [{ modelKey: 'y', weight: 10 }] });
  const { units } = sizeUnits({ cells, plan, options: { ...RUN_OPTION_DEFAULTS, maxSourceFragmentsPerUnit: 10 } });
  const sizes = units.map(u => u.sourceRanges.reduce((n, r) => n + (r.end - r.start), 0));
  assert.deepEqual(sizes, [2, 1, 1]);          // [1,1] packed, then 500 alone, then 1
});

test('target caps are HARD: no unit exceeds maxTargetModelsPerUnit or maxTargetFragmentsPerUnit', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', weight: 5 }, { modelKey: 'b', weight: 5 }, { modelKey: 'c', weight: 5 },
              { modelKey: 'd', weight: 5 }, { modelKey: 'e', weight: 5 }] });
  const opts = { ...RUN_OPTION_DEFAULTS, maxTargetModelsPerUnit: 2, maxTargetFragmentsPerUnit: 12 };
  const { units } = sizeUnits({ cells, plan, options: opts });
  for (const u of units) {
    assert.ok(u.targets.length <= opts.maxTargetModelsPerUnit);
    assert.ok(u.targetWeight <= opts.maxTargetFragmentsPerUnit);
  }
});

test('an explicit-root target entry is cut BETWEEN roots, never inside one', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', rootWeights: [7, 7, 7] }] });
  const { units } = sizeUnits({ cells, plan,
    options: { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 14, maxTargetModelsPerUnit: 4 } });
  assert.equal(units.length, 2);
  assert.deepEqual(units.map(u => u.targetWeight), [14, 7]);
});

test('an unsplittable over-cap target entry becomes a not-run:target-too-large gap, never a call (M7)', () => {
  for (const spec of [{ modelKey: 'a', whole: true, weight: 50 }, { modelKey: 'a', rootWeights: [50] }]) {
    const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1], targets: [spec] });
    const { units, gaps } = sizeUnits({ cells, plan,
      options: { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 20 } });
    assert.deepEqual(units, []);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].outcome, 'not-run');
    assert.equal(gaps[0].cause, 'target-too-large');
    assert.equal(gaps[0].pairSpaceWeight, 2 * 1);
  }
});

test('a whole-model sentinel is never partitioned: it is placed alone in its slice', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1],
    targets: [{ modelKey: 'a', weight: 5 }, { modelKey: 'b', whole: true, weight: 5 }] });
  const { units } = sizeUnits({ cells, plan,
    options: { ...RUN_OPTION_DEFAULTS, maxTargetModelsPerUnit: 4, maxTargetFragmentsPerUnit: 100 } });
  const wholeUnits = units.filter(u => u.targets.some(t => t.scope === 'whole'));
  for (const u of wholeUnits) assert.equal(u.targets.length, 1);
});

test('unit ids are `${cell}.${seq}` in canonical plan order and weights sum to the pair space', () => {
  const { cells, plan, expectedPairSpace } = makeSizingFixture({ sourceWeights: [1, 1], targets: [{ modelKey: 'y', weight: 2, roots: 2 }] });
  const { units } = sizeUnits({ cells, plan, options: RUN_OPTION_DEFAULTS });
  assert.ok(units.every(u => /^(1|2|3a|3b)\.\d+$/.test(u.unitId)));
  assert.equal(units.reduce((n, u) => n + u.pairSpaceWeight, 0), expectedPairSpace);
});

test('changing sizing options changes chunking, never coverage', () => {
  const { cells, plan } = makeSizingFixture({ sourceWeights: [1, 1, 1, 1], targets: [{ modelKey: 'y', rootWeights: [1, 1, 1] }] });
  const total = (o) => sizeUnits({ cells, plan, options: { ...RUN_OPTION_DEFAULTS, ...o } })
    .units.reduce((n, u) => n + u.pairSpaceWeight, 0);
  assert.equal(total({ maxSourceDbIdsPerUnit: 1 }), total({}));
  assert.equal(total({ maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 1 }), total({}));
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/planning/sizing.test.mjs`.

- [ ] **Step 3: Implement `sizeUnits`.** Two independent packers plus a cross product (§6.4 item 4):

```js
function packSource(plan, ranges, { maxSourceFragmentsPerUnit, maxSourceDbIdsPerUnit }) {
  const chunks = []; let cur = [], curRoots = 0, curFrags = 0;
  for (const range of ranges) for (let i = range.start; i < range.end; i++) {
    const w = plan.rowAt(range.table, i).fragmentCount;
    // Packing TARGET, not a hard bound: a single root heavier than the cap forms its own unit.
    const wouldExceed = curRoots > 0 && (curRoots + 1 > maxSourceDbIdsPerUnit || curFrags + w > maxSourceFragmentsPerUnit);
    if (wouldExceed) { chunks.push(cur); cur = []; curRoots = 0; curFrags = 0; }
    const last = cur[cur.length - 1];
    if (last && last.table === range.table && last.end === i) last.end = i + 1;
    else cur.push({ table: range.table, start: i, end: i + 1 });
    curRoots++; curFrags += w;
  }
  if (curRoots > 0) chunks.push(cur);
  return chunks;
}

function sliceTargets(plan, targets, { maxTargetModelsPerUnit, maxTargetFragmentsPerUnit }) {
  const slices = []; const oversize = [];
  let cur = [], curModels = 0, curWeight = 0;
  const flush = () => { if (cur.length) { slices.push(cur); cur = []; curModels = 0; curWeight = 0; } };
  for (const t of targets) {                                  // already ascending by modelKey
    if (t.scope === 'whole') {
      if (t.weight > maxTargetFragmentsPerUnit) { oversize.push(t); continue; }   // M7: never issued
      flush(); slices.push([t]); continue;                                        // not partitionable
    }
    for (let i = 0; i < t.rootWeights.length; i++) {
      const w = t.rootWeights[i];
      if (w > maxTargetFragmentsPerUnit) { oversize.push({ ...t, singleRootIndex: i }); continue; }  // M7
      const sameModel = cur.length && cur[cur.length - 1].modelKey === t.modelKey;
      if ((!sameModel && curModels + 1 > maxTargetModelsPerUnit) || curWeight + w > maxTargetFragmentsPerUnit) flush();
      appendRoot(cur, t, i); if (!sameModel) curModels++; curWeight += w;
    }
  }
  flush();
  return { slices, oversize };
}
```

  `sizeUnits` then emits, per cell, `sourceChunks × targetSlices` in that nested order, assigning `unitId = `${cell}.${seq}`` from a per-cell counter that advances in emission order, and `pairSpaceWeight = |source roots| × |target roots|` where a whole-model target contributes the model's **run-start root count** (§6.5). Every target slice that contains an *oversize* entry produces a `not-run:target-too-large` gap record carrying the same `pairSpaceWeight`, and no unit — a deterministic, pre-call outcome.

- [ ] **Step 4: Run and see it pass.** `node --test test/clashtest/planning/sizing.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.8: Deterministic capacity splitting and the ledger's runtime record classes

**Files**
- Create: `clashtest/planning/splitting.js`
- Modify: `clashtest/planning/ledger.js` (unit records, taints, split lifecycle, per-class exhaustion)
- Test: `test/clashtest/planning/splitting.test.mjs`, `test/clashtest/planning/ledger.exhaustion.test.mjs`

**Interfaces**
- Consumes: `bisectRanges` (P3.4), `createRecordBudget` / `createLedger` (P3.3), `WorkUnit` (P3.7), `ROOT_CLASS` (P3.3/P3.5).
- Produces: `planSplit`, `SPLIT_REFUSAL_REASONS`; on the ledger — `recordUnit`, `recordOutcome`, `tryRecordSplit`, `addTaint`, `recordGap`, **`recordPlanningGap`**, `toLedgerRecord`, `budgetExhausted`, `firstRefusalUnitId`.
- **`recordGap` and `recordPlanningGap` are two different writers and are not interchangeable** (cross-phase need raised by P6). `recordGap(unitId, {...})` writes a **unit-level** gap — a `UnitRecord` with `outcome:'not-run'` and a real `pairSpaceWeight` (today only `target-too-large`). **`recordPlanningGap({phase, cause}) → void`** appends one `{phase, cause}` row to the ledger's `planningGaps` array — the *run-level* §6.6.2 gap that has no plan and therefore no weight. P6 is its only caller outside the planner (`planning:cancelled`, and every §6.6.2 cause it detects after `planRun` returned, such as a post-plan `world-disposed`); using `recordGap` for those would put a unit record into a ledger the pre-resolution seal requires to have `units: []`.
- Consumed by P6: **`planSplit(plan, unit)`** on `CapacityExceededError{kind:'tlas-candidate-budget'|'clearance-narrow-phase-budget'}`; `addTaint` per §12.2.1; `recordOutcome` per §8.3. P6 must not re-derive any of them.
- **Controller ruling R8 — live split admission is P3's.** `planSplit` is the **single atomic admission point** for a runtime split: it computes the §6.4 cut *and* decides whether the split fits, counting **unit records** (parents + children, against `maxUnitsPerRun`) and **ledger records** (through this phase's `RecordBudget`, against `maxLedgerRecords`) in one indivisible step, and admitting both or neither. The counting is over the run's **live** unit population, so **children created by earlier runtime splits count** — a nested split of a child is refused exactly when the run is genuinely out of unit records, not when the *initial* plan was. Callers branch on **`.reason`**, never on `null`/truthiness. `tryRecordSplit` remains the ledger-level primitive `planSplit` calls; it is no longer something a caller is expected to invoke itself, and P6 does not call it directly.

**Steps**

- [ ] **Step 1: Write the failing split test.**

```js
// test/clashtest/planning/splitting.test.mjs  (excerpt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSplit, SPLIT_REFUSAL_REASONS } from '../../../clashtest/planning/splitting.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSplitFixture } from '../support/syntheticModels.mjs';

test('split order step 1: > 1 source root bisects the sources', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'y', roots: [9] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map(c => c.unitId), [`${unit.unitId}.0`, `${unit.unitId}.1`]);
  assert.deepEqual(children.map(c => c.sourceDbIdsForTest), [[1, 2], [3, 4]]);
  assert.equal(children[0].pairSpaceWeight + children[1].pairSpaceWeight, unit.pairSpaceWeight);
});

test('split order step 2: one source root, many target models partitions the ENTRIES by modelKey', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1],
    targets: [{ modelKey: 'a', roots: [1, 2] }, { modelKey: 'b', roots: [3] }, { modelKey: 'c', roots: [4] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map(c => c.targets.map(t => t.modelKey)), [['a'], ['b', 'c']]);
  assert.equal(children[0].pairSpaceWeight + children[1].pairSpaceWeight, unit.pairSpaceWeight);
});

test('split order step 3: one source root, one explicit target entry bisects that root list', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [1, 2, 3] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map(c => c.targetDbIdsForTest), [[1], [2, 3]]);
});

test('split order step 4: unsplittable units are gaps, never partial splits', () => {
  for (const targets of [[{ modelKey: 'a', roots: [1] }], [{ modelKey: 'a', whole: true }]]) {
    const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets });
    assert.deepEqual(planSplit(plan, unit), { reason: 'unsplittable' });
  }
});

test('the split ORDER is a pure function of the plan: same inputs, same children', () => {
  const a = makeSplitFixture({ sourceRoots: [1, 2, 3], targets: [{ modelKey: 'a', roots: [1] }] });
  const b = makeSplitFixture({ sourceRoots: [3, 2, 1], targets: [{ modelKey: 'a', roots: [1] }] });
  assert.equal(JSON.stringify(planSplit(a.plan, a.unit).children.map(c => c.sourceDbIdsForTest)),
               JSON.stringify(planSplit(b.plan, b.unit).children.map(c => c.sourceDbIdsForTest)));
});

// ---------------------------------------------------------------------------
// R8: live split ADMISSION. The refusal is always a truthy object and callers
// branch on `.reason` — `result !== null` would treat every refusal as a
// successful split and hand back two `undefined` children.
// ---------------------------------------------------------------------------

test('the refusal vocabulary is closed and every refusal is truthy with a .reason', () => {
  assert.deepEqual([...SPLIT_REFUSAL_REASONS], ['unsplittable', 'unit-cap', 'ledger-cap']);
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [1] }] });
  const r = planSplit(plan, unit);
  assert.ok(r);                                   // truthy: `r !== null` proves nothing
  assert.equal('children' in r, false);
  assert.ok(SPLIT_REFUSAL_REASONS.includes(r.reason));
});

test('a nested split is refused unit-cap when the run is one unit record short (children count)', () => {
  // maxUnitsPerRun = 10,000. The ledger starts with 9,997 live unit records (`unit` among them),
  // so the first split fits (9,997 + 2 = 9,999) and the SECOND does not (9,999 + 2 = 10,001).
  const { plan, unit } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: RUN_OPTION_DEFAULTS.maxUnitsPerRun }, liveUnitRecords: 9_997,
  });
  const first = planSplit(plan, unit);            // 9,997 + 2 = 9,999 <= 10,000: admitted
  assert.deepEqual(first.children.map(c => c.unitId), [`${unit.unitId}.0`, `${unit.unitId}.1`]);
  // The CHILD is splittable by the §6.4 order (2 source roots), but the two grandchildren
  // would take the population to 10,001. A nested split must count.
  const nested = planSplit(plan, first.children[0]);
  assert.equal(nested.reason, 'unit-cap');
  assert.equal(nested.capDetail, 'unit-records');
  assert.equal('children' in nested, false);
});

test('a split that fits the unit cap but not the record budget is refused ledger-cap', () => {
  const { plan, unit } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: 64 }, exhaustLedgerRecords: true,
  });
  const r = planSplit(plan, unit);
  assert.equal(r.reason, 'ledger-cap');
  assert.equal(r.capDetail, 'ledger-records');
});

test('a refused split records NOTHING — admission is atomic in both directions', () => {
  const { plan, unit } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: 64 }, exhaustLedgerRecords: true,
  });
  const before = JSON.stringify(plan.ledger.toLedgerRecord());
  assert.equal(planSplit(plan, unit).reason, 'ledger-cap');
  assert.equal(JSON.stringify(plan.ledger.toLedgerRecord()), before);
});
```

  `makeSplitFixture` gains three options this task adds to `syntheticModels.mjs`: `limits` (merged over `RUN_OPTION_DEFAULTS` before `createRecordBudget`), `liveUnitRecords` (pre-populates the ledger with that many `recordUnit` calls so the unit-record cap is reachable without building a real 10,000-unit plan), and `exhaustLedgerRecords` (drains `budget.discretionaryRemaining`). The fixture returns a `plan` whose **`plan.ledger`** is the live, un-frozen ledger `planSplit` admits through.

- [ ] **Step 2: Write the failing ledger-exhaustion test (AC-16 planner parts).**

```js
// test/clashtest/planning/ledger.exhaustion.test.mjs  (excerpt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordBudget, createLedger, LEDGER_RECORD_CLASSES } from '../../../clashtest/planning/ledger.js';

const limits = { maxPlanReferences: 20, maxLedgerRecords: 20 + 2 * 4, maxUnitsPerRun: 4, maxElementTaintsPerUnit: 2000 };

function seeded(n) { let s = n >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test('every runtime record class is exercised and none exceeds maxLedgerRecords', () => {
  const budget = createRecordBudget(limits);
  const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences);
  budget.reserveUnitSlots();
  const rnd = seeded(7);
  const classes = ['element', 'target-model', 'unit'];   // P5's persisted taint.kind vocabulary
  for (let i = 0; i < 500; i++) {
    const unitId = `1.${i % limits.maxUnitsPerRun}`;
    ledger.addTaint(unitId, { kind: classes[Math.floor(rnd() * classes.length)], modelKey: 'm', dbId: i, reason: 'r' });
    assert.ok(budget.used <= limits.maxLedgerRecords, `overrun at ${i}`);
  }
  for (const cls of LEDGER_RECORD_CLASSES) assert.ok(typeof cls === 'string');
});

test('a unit whose taints collapsed always gets its taint-overflow, in place', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences); budget.reserveUnitSlots();
  for (let i = 0; i < 100; i++) ledger.addTaint('1.0', { kind: 'element', modelKey: 'm', dbId: i, reason: 'r' });
  const rec = ledger.unitRecord('1.0');
  assert.ok(rec.taints.some(t => t.kind === 'unit' && t.reason === 'taint-overflow'));
  assert.equal(budget.budgetExhausted, true);
  assert.ok(budget.used <= limits.maxLedgerRecords);
});

test('a split that no longer fits is NOT performed; the unit becomes failed:unit-cap', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences); budget.reserveUnitSlots();
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');    // exhaust D
  const before = JSON.stringify(ledger.toLedgerRecord());
  const r = ledger.tryRecordSplit('1.0', [{ unitId: '1.0.0', ranges: 2 }, { unitId: '1.0.1', ranges: 2 }]);
  assert.equal(r.ok, false);
  assert.equal(r.capDetail, 'ledger-records');
  assert.equal(JSON.stringify(ledger.toLedgerRecord()), before);   // no half-recorded split
});

test('the unit-record cap refuses a split with capDetail unit-records', () => {
  const budget = createRecordBudget({ ...limits, maxUnitsPerRun: 1, maxLedgerRecords: 40 });
  const ledger = createLedger({ limits: { ...limits, maxUnitsPerRun: 1 }, budget });
  budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 4));
  const r = ledger.tryRecordSplit('1.0', [{ unitId: '1.0.0', ranges: 1 }, { unitId: '1.0.1', ranges: 1 }]);
  assert.equal(r.capDetail, 'unit-records');
});

test('an admitted split supersedes the parent: kind/parentUnitId, and only LEAVES carry the weight', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 4));
  assert.equal(ledger.tryRecordSplit('1.0', [{ unitId: '1.0.0', ranges: 1 }, { unitId: '1.0.1', ranges: 1 }]).ok, true);
  const rec = ledger.toLedgerRecord();
  const byId = new Map(rec.units.map(u => [u.unitId, u]));
  assert.equal(byId.get('1.0').kind, 'split');
  assert.equal(byId.get('1.0').outcome, 'split');
  assert.deepEqual([byId.get('1.0.0').kind, byId.get('1.0.0').parentUnitId], ['leaf', '1.0']);
  assert.equal(rec.units.filter(u => u.kind === 'leaf').reduce((n, u) => n + u.pairSpaceWeight, 0),
    rec.pairSpaceTotal);
});

test('inline fields still update after exhaustion (they allocate nothing)', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences); budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 1));
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');
  ledger.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 2,
    capacityKind: 'tlas-candidate-budget',
    secondaryCauses: ['stale-placement', 'model-evicted'], scopeProof: 'equal' });
  assert.equal(ledger.unitRecord('1.0').attempts, 2);
  assert.equal(ledger.unitRecord('1.0').cause, 'capacity-exceeded');
  assert.equal(ledger.unitRecord('1.0').capacityKind, 'tlas-candidate-budget');
});

test('R4: secondaryCauses are stored ascending by cause code and capped at 8', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.reserveUnitSlots();
  ledger.recordUnit(leafUnit('1.0', 1));
  ledger.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 1,
    scopeProof: 'equal',
    secondaryCauses: ['stale-placement', 'model-evicted', 'extraction-limit', 'unit-cap',
                      'object-tree-unavailable', 'scope-drift', 'input-changed', 'result-cap',
                      'internal-error', 'world-disposed'] });
  const got = ledger.unitRecord('1.0').secondaryCauses;
  assert.equal(got.length, 8);
  assert.deepEqual(got, [...got].sort());                      // canonical tie-break: ascending cause code
  // Same fact set, different observation order ⇒ byte-identical record.
  const budget2 = createRecordBudget(limits);
  const b = createLedger({ limits, budget: budget2 });
  budget2.reserveUnitSlots();
  b.recordUnit(leafUnit('1.0', 1));
  b.recordOutcome('1.0', { outcome: 'failed', cause: 'capacity-exceeded', attempts: 1, scopeProof: 'equal',
    secondaryCauses: ['world-disposed', 'result-cap', 'scope-drift', 'internal-error', 'input-changed',
                      'object-tree-unavailable', 'unit-cap', 'extraction-limit', 'model-evicted',
                      'stale-placement'] });
  assert.deepEqual(b.unitRecord('1.0').secondaryCauses, got);
});

test('budgetExhausted and the first refusing unit id are recorded', () => {
  const budget = createRecordBudget(limits); const ledger = createLedger({ limits, budget });
  budget.admitPlan('root-table', limits.maxPlanReferences); budget.reserveUnitSlots();
  budget.admitRuntime('element-taint', budget.discretionaryRemaining, '1.0');
  ledger.addTaint('1.2', { kind: 'element', modelKey: 'm', dbId: 1, reason: 'r' });
  const rec = ledger.toLedgerRecord();
  assert.equal(rec.budgetExhausted, true);
  assert.equal(rec.firstRefusalUnitId, '1.2');
});
```

  `leafUnit(unitId, pairSpaceWeight)` is this file's one-line helper for P5's pinned self-describing record: `{unitId, kind:'leaf', parentUnitId:null, sourceModelKey:'m', sourceRootDbIds:[1], targets:[{modelKey:'m', scope:'roots', rootDbIds:[2]}], pairSpaceWeight, ranges:1}`. There is **no `cell` field** — the cell is the `unitId` prefix.

- [ ] **Step 3: Run both and see them fail.** `node --test test/clashtest/planning/splitting.test.mjs test/clashtest/planning/ledger.exhaustion.test.mjs`.

- [ ] **Step 4: Implement `planSplit`.** Two halves, in this order: the §6.4 **cut** (pure, with `bisectRanges` doing every cut so no root is ever split), then R8's **atomic admission** of the cut through the run's live ledger.

```js
export const SPLIT_REFUSAL_REASONS = Object.freeze(['unsplittable', 'unit-cap', 'ledger-cap']);

/** The §6.4 order — pure, no admission. Returns the two children or null. */
function cutUnit(plan, unit) {
  const sourceRoots = unit.sourceRanges.reduce((n, r) => n + (r.end - r.start), 0);
  if (sourceRoots > 1) {
    const [L, R] = bisectRanges(plan, unit.sourceRanges);
    return [child(unit, 0, { sourceRanges: L }), child(unit, 1, { sourceRanges: R })];
  }
  if (unit.targets.length > 1) {                       // ascending modelKey already
    const half = Math.floor(unit.targets.length / 2);
    return [child(unit, 0, { targets: unit.targets.slice(0, half) }),
            child(unit, 1, { targets: unit.targets.slice(half) })];
  }
  const only = unit.targets[0];
  if (only && only.scope !== 'whole') {
    const roots = only.scope.ranges.reduce((n, r) => n + (r.end - r.start), 0);
    if (roots > 1) {
      const [L, R] = bisectRanges(plan, only.scope.ranges);
      return [child(unit, 0, { targets: [{ ...only, scope: { ranges: L } }] }),
              child(unit, 1, { targets: [{ ...only, scope: { ranges: R } }] })];
    }
  }
  return null;                                          // one source root vs one root / a whole sentinel
}

/**
 * R8: the ONE live split-admission point. Cut, then admit the cut atomically against
 * maxUnitsPerRun and maxLedgerRecords, or refuse and record nothing.
 * Every refusal is a TRUTHY object carrying `.reason` — callers must never test `!== null`.
 */
export function planSplit(plan, unit) {
  const children = cutUnit(plan, unit);
  if (children === null) return { reason: 'unsplittable' };
  // Internal invariant (§6.4 "the children's weights partition the parent's exactly"): each cut
  // partitions exactly one of the two factors and leaves the other untouched.
  if (children[0].pairSpaceWeight + children[1].pairSpaceWeight !== unit.pairSpaceWeight)
    throw new Error('internal-error: split weights do not partition the parent');
  // tryRecordSplit counts the parent's children against the ledger's LIVE unit-record
  // population — which already includes children admitted by earlier runtime splits — and the
  // child range records against the RecordBudget, as one block. Nothing partial can be written.
  const admitted = plan.ledger.tryRecordSplit(unit.unitId, children.map(
    (c) => ({ unitId: c.unitId, ranges: rangeRecordCount(c) })));
  if (admitted.ok) return { children };
  return admitted.capDetail === 'unit-records'
    ? { reason: 'unit-cap', capDetail: 'unit-records' }
    : { reason: 'ledger-cap', capDetail: 'ledger-records' };
}

function child(parent, i, patch) {
  const c = { ...parent, ...patch, unitId: `${parent.unitId}.${i}` };
  c.pairSpaceWeight = countRoots(c.sourceRanges) * targetRootCount(c.targets);
  return c;
}
```

  The children's `pairSpaceWeight`s partition the parent's exactly, asserted as an internal invariant; a violation is `failed:internal-error`, never a silent drift. **Why the arity stays `(plan, unit)`** (reconciliation N17, and P4/P6 both read it that way): the budget and the ledger are reached through `plan.ledger`, the one property `createPlan`'s deep-freeze deliberately skips. **Why admission moved inside** (R8): with a separate `tryRecordSplit` the caller could compute a cut, act on it, and forget the budget — and a *nested* split was the case most likely to be missed, because the child's own unit records are invisible to anyone counting the initial plan's units. Folding the two makes "did this split fit?" unforgettable and makes the nested case fall out of one counter.

  **Refusal → settlement (P6's half, stated here so the contract is unambiguous):** `unit-cap` and `ledger-cap` are both the §16.7 fact **`unit-cap`** ⇒ `failed:unit-cap`, with the parent's `pairSpaceWeight` recorded as a gap and `pairSpaceTotal` unchanged; `capDetail` is written through to the ledger `UnitRecord.capDetail`, which is exactly the `'ledger-records' | 'unit-records' | null` field P5 pins. `unsplittable` maps the same way, which is why P6's existing handling needs only the widened `.reason` test, not a new branch.

- [ ] **Step 5: Implement the ledger's runtime classes, in P5's pinned sealed shape.** `createLedger` keeps `unitRecords: Map<unitId, UnitRecord>`. **The record shape is not P3's to choose: P5 pins the sealed ledger's JSON** (`p5-result-set.md` → *Shapes this phase pins*), because `validateResultSet` is written against it, and the reconciliation's **S-P5-4** makes it binding — "P3 and P6 must emit exactly that shape". P3's in-memory record therefore carries exactly P5's fields:

```js
/** UnitRecord (P5's pinned typedef — every field, no extra key) =
 *  { unitId, kind: 'leaf'|'split', parentUnitId: string|null, sourceModelKey,
 *    sourceRootDbIds: number[], targets: [{modelKey, scope: 'model'|'roots', rootDbIds?}],
 *    outcome: 'evaluated'|'failed'|'skipped'|'discarded'|'not-run'|'split',
 *    cause: string|null, secondaryCauses: string[], capacityKind: string|null,
 *    capDetail: 'ledger-records'|'unit-records'|null,
 *    scopeProof: 'equal'|'drift'|'unverifiable'|'not-checked', pairSpaceWeight,
 *    taints: [{kind: 'element'|'target-model'|'unit', modelKey, dbId, reason, occurrences}],
 *    attempts,      // NOT digested
 *    durationMs }   // NOT digested
 */
```

  Four differences from what this file previously sketched, each a real conformance break, not a rename: the record carries **`kind` / `parentUnitId`** (so a `split` parent and its leaves are distinguishable — P5 says split records are *superseded by* their leaves, and `pairSpaceTotal` is the Σ over **leaf** units only); it carries **`sourceModelKey` / `sourceRootDbIds` / `targets`** with `scope: 'model'|'roots'` (the sealed ledger is read without a plan, so a unit must be self-describing, and the sentinel spells `'model'`, not `'whole'`); `taint.kind` is **`'element'|'target-model'|'unit'`** — the `*-taint` spellings are `LEDGER_RECORD_CLASSES` **budget class ids**, which are an internal accounting vocabulary and must not leak into the persisted row — and each taint carries **`occurrences`**; and the `cell` / `capacityDetails` / `children` / `diagnosticCounts` keys this file previously put on the **record do not exist there** (`cell` stays on the run-scoped `WorkUnit`, where spec §6.5 puts it, and is recoverable from the `unitId` prefix; `capacityKind` replaces `capacityDetails`; `children` is replaced by `parentUnitId` + `kind`; diagnostics are P4's aggregator's and reach the record only as `taints`).

  §6.5.1's per-class rules, unchanged except where a ruling touches them:
  - `addTaint(unitId, taint)` admits taints **in canonical order** (`kind`, then `modelKey`, then `dbId`, then `reason`, code-unit order) through `budget.admitRuntime(<budget class id>, 1, unitId)`; on refusal, and on exceeding `maxElementTaintsPerUnit`, it calls `budget.consumeReservedSlot(unitId)` and appends the single unit-wide `{kind:'unit', reason:'taint-overflow', occurrences:1}` — which fits by the reserve proof — and the detail is dropped, never the coverage consequence. A unit that collapsed any taint makes every pair of that unit `covered-caveated` (P5's rule; the ledger only records the fact).
  - `tryRecordSplit(unitId, children)` admits `2 + Σ child range records` as **one block**; on refusal it records nothing and returns `{ok:false, capDetail:'ledger-records'}`, or `'unit-records'` when the refusal is `unitRecords.size + 2 > maxUnitsPerRun` — **counted over the ledger's live unit population, which already contains every child of every earlier runtime split** (R8). On success it flips the parent to `kind:'split'`, `outcome:'split'`, and writes the two children with `kind:'leaf'`, `parentUnitId: unitId`. It is called by `planSplit`, which owns the refusal→`.reason` mapping.
  - `recordOutcome(unitId, {...})` writes **inline, fixed-size fields only** — it allocates no record and therefore cannot be refused. **Controller ruling R4** applies here: `secondaryCauses` is written **sorted ascending by cause code** (UTF-16 code-unit order — the canonical tie-break for same-rank settlement facts, so two runs observing the same fact set produce byte-identical records) and capped at 8 (§16.7; the run-level `RunOutcome.reasons` keeps the complete set, so the cap loses nothing overall — register **S-P6-C3**). **`secondaryCauses` is excluded from `ledgerDigest`**, alongside `attempts` and `durationMs`: the settlement's *primary* `cause` is the digested fact, and a same-rank tie is not a difference the digest may see.
  - `recordPlanningGap({phase, cause})` appends `{phase, cause}` — **and nothing else** — to the ledger's `planningGaps` array, in call order, de-duplicated on the `(phase, cause)` pair. It allocates no `UnitRecord`, charges no budget class and cannot be refused (the array is bounded by §6.6.2's closed cause enum), so it is callable on a ledger that will seal with `units: []`. `PlanResult.planningGaps` may carry an extra run-scoped `detail` (§5.6.5 offenders, §6.6 dbIds); `toLedgerRecord()` projects `detail` away, because P5's pinned row is `{phase, cause}` — see cross-file need 3.
  - `toLedgerRecord()` projects to arrays-only plain data (no `Map`) in **exactly P5's `Ledger` typedef** — `{planExists, pairSpaceTotal, emptyOperand, units, rootOwners, unresolvedSelections, unreachablePopulation, hierarchyInternal, planningGaps, exclusions, warnings, budgetExhausted, firstRefusalUnitId}` — so `ledgerDigest` (P5) can be computed over it. Two shapes to get exactly right: `planningGaps` rows are `{phase, cause}` only (a *planning-level* gap has no weight because there is no plan; a **unit-level** gap such as `not-run:target-too-large` is a `UnitRecord` with `outcome:'not-run'` and its own `pairSpaceWeight`, which is what makes ruling **R11**'s accessor and the ledger agree), and **`rootOwners` rows are `{rootDbId, ownerDbIds, cls}` (controller ruling R2)**, `cls` being the `ROOT_CLASS` marker assigned in Task P3.5 step 7. `cls` is **digested** — that is the whole point of the ruling: it makes a hierarchy-internal (`A ∩ B`) root recoverable from the sealed ledger alone, instead of from the bounded first-20 `hierarchyInternal.examples`, which would silently under-report P8's element-level caveats.

- [ ] **Step 6: Run and see both pass.** `node --test test/clashtest/planning/splitting.test.mjs test/clashtest/planning/ledger.exhaustion.test.mjs`.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).**

---

### Task P3.9: `createPlan` facade, unit materialization, and the seeded exact-cover property suite

**Files**
- Create: `clashtest/planning/planner.js`
- Create: `test/clashtest/support/bruteForcePairs.mjs`
- Test: `test/clashtest/planning/planner.test.mjs`, `test/clashtest/planning/planner.property.test.mjs`

**Interfaces**
- Consumes: everything above; `RUN_OPTION_DEFAULTS` (P0 `options.js`); the normalized definition from P2 `prepareDefinition`; the run snapshot from P1 `snapshotBindings` (the **positional array** shape, ruling R7 — see Task P3.5's *Interfaces*). None of these is "assumed" any more: each is taken verbatim from the producer phase's *Phase interface summary*.
- Produces: `createPlan` (alias `planRun`), `materializeUnit`, `rootsForRanges`, the `WorkUnit`/`PlanResult`/`Plan` typedefs, and **`PlanResult.preTerminalGapWeight`** (ruling R11).
- Consumed by P4: `materializeUnit(plan, unit)` returns exactly `ExecutionRequest.materialized` (§7.1) — `{sourceDbIds, targets:[{modelKey, scope:'whole'|'roots', dbIds?}], scopeExpect:[{modelKey, role, scope, population?, roots?}]}`. P4 must not build it itself.

**Steps**

- [ ] **Step 1: Write the failing facade test.**

```js
// test/clashtest/planning/planner.test.mjs  (excerpt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, materializeUnit } from '../../../clashtest/planning/planner.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';

const twoModels = () => ([
  { modelKey: 'arch', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] },
                              { dbId: 2, owners: [2], fragments: [{ fragId: 1, ownerDbId: 2, geometryId: 1 }] }] },
  { modelKey: 'struct', roots: [{ dbId: 7, owners: [7], fragments: [{ fragId: 0, ownerDbId: 7, geometryId: 1 }] }] },
]);

test('a whole-model TARGET unit carries a population scopeExpect (§16.3.2)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
                        B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const m = materializeUnit(plan, plan.units[0]);
  assert.deepEqual(m.targets, [{ modelKey: 'struct', scope: 'whole' }]);
  const tgt = m.scopeExpect.find(s => s.role === 'target' && s.modelKey === 'struct');
  assert.equal(tgt.scope, 'whole');
  assert.ok(tgt.population.digest.startsWith('sha256:'));
  assert.equal(typeof tgt.population.count, 'number');
});

test('a whole-model SOURCE unit brackets BOTH its source roots and the model population (R20-1)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }],
                        B: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const m = materializeUnit(plan, plan.units[0]);
  const src = m.scopeExpect.filter(s => s.role === 'source' && s.modelKey === 'arch');
  assert.deepEqual(src.map(s => s.scope).sort(), ['roots', 'whole']);
  assert.deepEqual(src.find(s => s.scope === 'roots').roots.map(r => r.dbId), [1, 2]);
  assert.ok(src.find(s => s.scope === 'whole').population.digest.startsWith('sha256:'));
  assert.deepEqual(m.sourceDbIds, [1, 2]);          // materialized ids, never held in the unit
});

test('an explicit-root TARGET unit brackets each root subtree digest', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }],
                        B: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const m = materializeUnit(plan, plan.units[0]);
  const tgt = m.scopeExpect.find(s => s.role === 'target' && s.modelKey === 'arch');
  assert.equal(tgt.scope, 'roots');
  assert.deepEqual(tgt.roots.map(r => r.dbId), [1, 2]);
  assert.ok(tgt.roots.every(r => r.subtreeDigest.startsWith('sha256:')));
});

test('an initial plan above maxUnitsPerRun fails plan-too-large with no units', async () => {
  const many = [{ modelKey: 'm', roots: Array.from({ length: 40 }, (_, i) =>
    ({ dbId: i + 1, owners: [i + 1], fragments: [{ fragId: i, ownerDbId: i + 1, geometryId: 1 }] })) }];
  const { enumerator, binding } = makeSyntheticEnumerator(many);
  const res = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator,
    options: { ...RUN_OPTION_DEFAULTS, maxUnitsPerRun: 5 }, checkpoint: () => {} });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map(g => g.cause), ['plan-too-large']);
  assert.equal(res.plan, null);
});

test('units hold ranges only — never copied dbId arrays or Model references (§6.5)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }], B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const json = JSON.stringify(plan.units);
  assert.equal(json.includes('dbIds'), false);
  assert.deepEqual(Object.keys(plan.units[0]).sort(),
    ['cell', 'orientationRole', 'pairSpaceWeight', 'sourceModelKey', 'sourceRanges', 'targetWeight', 'targets', 'unitId']);
});

test('an explicit-list SOURCE emits NO population entry, and scopeExpect is canonically ordered (D1)', async () => {
  // The other two cases relocated from P6's deleted buildScopeExpect suite.
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const { plan } = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
                        B: [{ kind: 'elements', modelKey: 'struct', dbIds: [7] }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const m = materializeUnit(plan, plan.units[0]);
  assert.equal(m.scopeExpect.filter(s => s.scope === 'whole').length, 0);
  assert.deepEqual(m.scopeExpect.map(s => `${s.modelKey}/${s.role}/${s.scope}`),
    ['arch/source/roots', 'struct/target/roots']);
  const key = (s) => [s.modelKey, s.role, s.scope].join('\u0000');
  assert.deepEqual(m.scopeExpect.map(key), [...m.scopeExpect.map(key)].sort());   // canonical (modelKey, role, scope)
});

test('R11: preTerminalGapWeight is exposed and equals the ledger it summarizes', async () => {
  // One whole-model target heavier than maxTargetFragmentsPerUnit: a pre-planned, never-executed
  // not-run:target-too-large gap (M7 — it is never issued as a call).
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  const res = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
                        B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: { ...RUN_OPTION_DEFAULTS, maxTargetFragmentsPerUnit: 1 }, checkpoint: () => {} });
  assert.equal(res.status, 'planned');
  assert.ok(res.preTerminalGapWeight > 0);
  const units = res.ledger.toLedgerRecord().units;
  const fromLedger = units
    .filter(u => u.kind === 'leaf' && u.outcome === 'not-run')
    .reduce((n, u) => n + u.pairSpaceWeight, 0);
  assert.equal(res.preTerminalGapWeight, fromLedger);
  assert.deepEqual([...new Set(units.filter(u => u.outcome === 'not-run').map(u => u.cause))],
    ['target-too-large']);
  // A plan with no such gap reports 0, and a failed plan reports 0.
  const clean = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'arch', dbIds: [1, 2] }],
                        B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  assert.equal(clean.preTerminalGapWeight, 0);
});

test('R2: a hierarchy-internal (A∩B) root is recoverable from the PERSISTED ledger alone', async () => {
  // Root 20 is in both selections and has two fragment owners: hierarchy-internal.
  const spec = [{ modelKey: 'm', roots: [
    { dbId: 10, owners: [10], fragments: [{ fragId: 0, ownerDbId: 10, geometryId: 1 }] },
    { dbId: 20, owners: [20, 21], fragments: [{ fragId: 1, ownerDbId: 20, geometryId: 1 },
                                              { fragId: 2, ownerDbId: 21, geometryId: 1 }] }] }];
  const { enumerator, binding } = makeSyntheticEnumerator(spec);
  const res = await createPlan({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  const record = JSON.parse(JSON.stringify(res.ledger.toLedgerRecord()));   // persisted form only
  const rows = record.rootOwners.find(r => r.modelKey === 'm').owners;
  assert.deepEqual(rows.map(r => [r.rootDbId, r.cls]), [[10, 'C'], [20, 'C']]);
  // The A∩B roots with ≥ 2 owners are derivable WITHOUT the bounded examples list.
  const internal = rows.filter(r => r.cls === 'C' && r.ownerDbIds.length >= 2).map(r => r.rootDbId);
  assert.deepEqual(internal, [20]);
  assert.equal(record.hierarchyInternal[0].rootCount, internal.length);
  // And the marker distinguishes the three classes, so 'C' is not vacuously true.
  const res2 = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [10] }],
                        B: [{ kind: 'elements', modelKey: 'm', dbIds: [20] }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  assert.deepEqual(res2.ledger.toLedgerRecord().rootOwners[0].owners.map(r => [r.rootDbId, r.cls]),
    [[10, 'A'], [20, 'B']]);
});

test('the planner yields: checkpoint is awaited at least once per model', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(twoModels());
  let n = 0;
  await createPlan({ definition: defOf({ A: [{ kind: 'model', modelKey: 'arch' }],
                                         B: [{ kind: 'model', modelKey: 'struct' }] }),
    snapshot: snapshotOf(binding, ['arch', 'struct']), enumerator,
    options: RUN_OPTION_DEFAULTS, checkpoint: async () => { n++; } });
  assert.ok(n >= 2);
});
```

- [ ] **Step 2: Write the failing seeded property suite.** This is the phase's headline test — it is the master's Definition-of-Done item 5.

```js
// test/clashtest/planning/planner.property.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, materializeUnit } from '../../../clashtest/planning/planner.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSyntheticEnumerator, defOf, snapshotOf, shuffleDefinition } from '../support/syntheticModels.mjs';
import { requiredPairSpace, expandUnitPairs } from '../support/bruteForcePairs.mjs';

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function randomCase(rnd) {
  const modelCount = 1 + Math.floor(rnd() * 4);
  const models = [], entriesA = [], entriesB = [];
  for (let i = 0; i < modelCount; i++) {
    const modelKey = `m${i}`;
    const rootCount = 1 + Math.floor(rnd() * 5);
    const roots = Array.from({ length: rootCount }, (_, k) => ({
      dbId: (k + 1) * 10, owners: [(k + 1) * 10],
      fragments: [{ fragId: k, ownerDbId: (k + 1) * 10, geometryId: 1 }],
    }));
    models.push({ modelKey, roots });
    const pick = () => { const n = 1 + Math.floor(rnd() * rootCount);
      return roots.slice(0, n).map(r => r.dbId).sort((a, b) => a - b); };
    if (rnd() < 0.4) entriesA.push({ kind: 'model', modelKey });
    else if (rnd() < 0.85) entriesA.push({ kind: 'elements', modelKey, dbIds: pick() });
    if (rnd() < 0.4) entriesB.push({ kind: 'model', modelKey });
    else if (rnd() < 0.85) entriesB.push({ kind: 'elements', modelKey, dbIds: pick() });
  }
  if (!entriesA.length) entriesA.push({ kind: 'model', modelKey: 'm0' });
  if (!entriesB.length) entriesB.push({ kind: 'model', modelKey: 'm0' });
  return { models, A: entriesA, B: entriesB };
}

for (const ordered of [false, true]) {
  test(`exact cover over 200 seeded cases (${ordered ? 'containment' : 'unordered'})`, async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = seeded(seed);
      const c = randomCase(rnd);
      const { enumerator, binding } = makeSyntheticEnumerator(c.models);
      const definition = defOf({ A: c.A, B: c.B, mode: ordered ? 'containment' : 'volume-overlap' });
      const res = await createPlan({ definition, snapshot: snapshotOf(binding, c.models.map(m => m.modelKey)),
        enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
      if (res.status !== 'planned') {            // every failure must be an ENUMERATED planning cause
        assert.ok(res.planningGaps.every(g => typeof g.cause === 'string'), `seed ${seed}`);
        continue;
      }
      const required = await requiredPairSpace({ definition, models: c.models, ordered });
      const covered = res.plan.units.flatMap(u => expandUnitPairs(res.plan, u, ordered));
      // (a) EXACTLY once: multiset equality with the brute-force reference.
      assert.equal(covered.length, new Set(covered).size, `seed ${seed}: a pair is covered twice`);
      assert.deepEqual(new Set(covered), required, `seed ${seed}: cover != required P`);
      // ledger accounting agrees with the cover. In P5's pinned shape a pre-planned gap IS a
      // unit record (kind:'leaf', outcome:'not-run'), so pairSpaceTotal is the Σ over LEAF units;
      // there is no separate `gaps[]` array. R11's accessor must agree with the same sum.
      const rec = res.ledger.toLedgerRecord();
      const leafWeight = rec.units.filter(u => u.kind === 'leaf')
        .reduce((n, u) => n + u.pairSpaceWeight, 0);
      assert.equal(leafWeight, rec.pairSpaceTotal, `seed ${seed}: ledger does not account for P`);
      assert.equal(res.plan.units.reduce((n, u) => n + u.pairSpaceWeight, 0) + res.preTerminalGapWeight,
        rec.pairSpaceTotal, `seed ${seed}: preTerminalGapWeight does not close the accounting`);
      // (c) F2: same-model units never overlap their own source and target roots
      for (const u of res.plan.units) {
        const m = materializeUnit(res.plan, u);
        for (const t of m.targets) {
          if (t.modelKey !== u.sourceModelKey || t.scope === 'whole') continue;
          for (const y of t.dbIds) assert.equal(m.sourceDbIds.includes(y), false, `seed ${seed}: F2 self-exclusion`);
        }
      }
    }
  });
}

test('(b) the plan is byte-identical under input reordering', async () => {
  for (let seed = 1; seed <= 100; seed++) {
    const c = randomCase(seeded(seed));
    const { enumerator, binding } = makeSyntheticEnumerator(c.models);
    const snapshot = snapshotOf(binding, c.models.map(m => m.modelKey));
    const opts = { definition: defOf({ A: c.A, B: c.B }), snapshot, enumerator,
      options: RUN_OPTION_DEFAULTS, checkpoint: () => {} };
    const a = await createPlan(opts);
    const b = await createPlan({ ...opts, definition: shuffleDefinition(defOf({ A: c.A, B: c.B }), seeded(seed + 1)),
      enumerator: makeSyntheticEnumerator(shuffleModels(c.models, seeded(seed + 2))).enumerator });
    assert.equal(JSON.stringify(projectPlan(a)), JSON.stringify(projectPlan(b)), `seed ${seed}`);
  }
});

test('(d) nested roots produce a hierarchy-overlap failure, never a mis-cover', async () => {
  const models = [{ modelKey: 'm',
    roots: [{ dbId: 100, owners: [100, 105], fragments: [{ fragId: 0, ownerDbId: 100, geometryId: 1 },
                                                         { fragId: 1, ownerDbId: 105, geometryId: 1 }] }],
    ancestorOf: { 105: 100 } }];
  const { enumerator, binding } = makeSyntheticEnumerator(models);
  const res = await createPlan({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [100] }],
                        B: [{ kind: 'elements', modelKey: 'm', dbIds: [105] }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, options: RUN_OPTION_DEFAULTS, checkpoint: () => {} });
  assert.equal(res.status, 'failed');
  assert.deepEqual(res.planningGaps.map(g => g.cause), ['hierarchy-overlap']);
  assert.equal(res.plan, null);                     // no unit exists to mis-cover the gap
});
```

  `bruteForcePairs.mjs` builds `P` straight from spec §6.1 over the model specs' root sets (with whole-model selections expanded to every root), independently of `decompose.js`, and `expandUnitPairs` expands a unit through `materializeUnit` + the plan's per-model run-start root list (so a `'whole'` target expands to that model's roots — the unreachable population is deliberately **outside** `P` and is excluded, matching §6.2's `not-required` class).

- [ ] **Step 3: Run both and see them fail.** `node --test test/clashtest/planning/planner.test.mjs test/clashtest/planning/planner.property.test.mjs`.

- [ ] **Step 4: Implement `createPlan`.** The stages, in order, with `await checkpoint()` between each model and each cell batch:

  1. `resolveSelectionRoots` (P3.5). A `{ok:false}` returns `{status:'failed', plan:null, planningGaps:[{phase:'planning', cause, detail}], ledger, preTerminalGapWeight: 0}` — `unitsTotal = 0`, `pairSpaceTotal = 0`, `coverage: 'partial'` (never vacuously full, §6.6 item 2). The **run-scoped** `PlanningGap` carries `detail` (the §5.6.5 first-20 `{ancestor, descendant}` offenders, the first-20 `element-unresolvable` dbIds, the `plan-too-large` overflow class); the **persisted** row is P5's pinned `{phase, cause}` two-field shape, so `toLedgerRecord()` projects `detail` away and P6 is the phase that surfaces it (on the run's failure and `RunOutcome.reasons`). See *cross-file needs* in this file's Gates section: if those offenders must be durable rather than run-scoped, it is P5's `planningGaps` row that gains the field, not P3's projection that keeps one P5 does not declare.
  2. `buildRootTables` (P3.4), budget-charged; refusal ⇒ `plan-too-large`.
  3. Record the declared exclusions and digest rows through the budget: `unreachablePopulation`, `mixedOwnerDbIds`, `hierarchyInternal`, `unresolvedSelections`, `scopeDigests` (one population row per whole-scope model + one row per root).
  4. `decomposeCells` (P3.6) → `sizeUnits` (P3.7). `units.length > maxUnitsPerRun` ⇒ `plan-too-large` with no units.
  5. `ledger.recordUnit` per unit and `ledger.recordGap` per `target-too-large` gap, budget-charged (`unit-record` + `unit-range`); refusal ⇒ `plan-too-large`. A `target-too-large` gap **is a unit record** in P5's pinned shape — `kind:'leaf'`, `outcome:'not-run'`, `cause:'target-too-large'`, its own `pairSpaceWeight` — not a separate `gaps[]` array; that is what makes it countable in `pairSpaceTotal` and adoptable by P6.
  6. **Ruling R11 — expose the pre-terminal gap weight.** Compute `preTerminalGapWeight` = Σ `pairSpaceWeight` over the unit records written in step 5 that are already terminal and will never be executed (today exactly the `not-run:target-too-large` ones), and put it on the returned `PlanResult`. It is an *accessor over what the ledger already holds*, never a second accounting: the Task P3.9 test asserts it equals `toLedgerRecord().units.filter(u => u.kind === 'leaf' && u.outcome === 'not-run').reduce(…)`, so the two cannot drift. **P6 adopts it into progress accounting at plan completion** — without it, a run whose plan contains `target-too-large` gaps reports progress against a pair space it will never work through.
  7. `budget.reserveUnitSlots()` and the end-of-planning invariant assertion `planRecords + maxUnitsPerRun ≤ maxLedgerRecords` (unreachable under validated options; a violation is `failed:internal-error`, never a silent overrun).
  8. Deep-freeze the plan — **skipping the `ledger` key**, which is the run's live, mutable coverage ledger and the path `planSplit(plan, unit)` reaches the `RecordBudget` through (R8) — and return `{status:'planned', plan, ledger, planningGaps: [], preTerminalGapWeight}`. Everything else on the plan is frozen, so §6.4 invariant P1 still holds: the plan's data is a pure function of *(definition semantics, sorted enumerations, run sizing options)* and never changes after `createPlan` returns.
  9. **Empty operands (§6.6 item 4):** when every root set is empty the plan is `{units: [], pairSpaceTotal: 0, emptyOperand: true}` with a `warnings` entry (P5's pinned `{code, modelKey?}` row shape) — `coverage: 'full'` but never claimable (P5 enforces the claim side). `emptyOperand` and `pairSpaceTotal` live on the **ledger** in the sealed shape, which is where P5 pins them (register **S-P5-3**).

- [ ] **Step 5: Implement `materializeUnit`.** Reads the ranges, produces the transient ids, and assembles `scopeExpect` — **the only place the R20-1 whole-model-source rule lives**:

```js
export function materializeUnit(plan, unit) {
  const sourceDbIds = unit.sourceRanges.flatMap((r) => readRange(plan, r));
  const targets = unit.targets.map((t) => t.scope === 'whole'
    ? { modelKey: t.modelKey, scope: 'whole' }
    : { modelKey: t.modelKey, scope: 'roots', dbIds: t.scope.ranges.flatMap((r) => readRange(plan, r)) });
  const scopeExpect = [];
  const srcModel = plan.models.get(unit.sourceModelKey);
  scopeExpect.push({ modelKey: unit.sourceModelKey, role: 'source', scope: 'roots',
    roots: sourceDbIds.map((dbId) => ({ dbId, subtreeDigest: srcModel.subtreeDigestOf(dbId) })) });
  // R20-1: a kind:'model' SOURCE selection is also bracketed by the model's whole population digest —
  // a fragment outside the instance-tree roots changes no subtree digest but does change the selection.
  if (srcModel.scopeKinds.A === 'model' || srcModel.scopeKinds.B === 'model') {
    scopeExpect.push({ modelKey: unit.sourceModelKey, role: 'source', scope: 'whole',
      population: srcModel.population });
  }
  for (const t of targets) {
    const m = plan.models.get(t.modelKey);
    scopeExpect.push(t.scope === 'whole'
      ? { modelKey: t.modelKey, role: 'target', scope: 'whole', population: m.population }
      : { modelKey: t.modelKey, role: 'target', scope: 'roots',
          roots: t.dbIds.map((dbId) => ({ dbId, subtreeDigest: m.subtreeDigestOf(dbId) })) });
  }
  return { sourceDbIds, targets, scopeExpect };
}
```

- [ ] **Step 6: Run the whole phase suite and see it pass.** `node --test test/clashtest/planning/*.test.mjs`, then `npm test`.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).**

---

## Implementation-detail choices

The convergence review (§2) pushes these to the plan. Each picks the simplest mechanism that preserves the externally observable safety invariant, and names the invariant it preserves.

| # | Choice | Decision | Invariant preserved |
|---|---|---|---|
| D1 | **Plan-table representation** | Positional table ids `t0, t1, …` assigned in canonical build order (ascending `modelKey`, then class `A'`, `C`, `B'`); rows are frozen `{dbId, fragmentCount, subtreeDigest, ownerStart, ownerEnd}` over one ascending per-model `ownerDbIds` array; ranges are half-open `{table, start, end}`. No `modelKey` ever needs escaping in an id, and a split produces sub-ranges, never copies. | §6.5 "Units carry only `modelKey`s and table ranges"; §6.5.1 plan memory O(roots + owners + unit records). |
| D2 | **Ledger record structure** | One `Map<unitId, UnitRecord>` of fixed-shape records with an inline `taints[]` array, plus arrays for the planning-only classes; a single `toLedgerRecord()` projects to arrays-only plain data for digesting and persistence. Every allocation goes through one `RecordBudget`. **The projected shape is not P3's choice: it is P5's pinned `Ledger`/`UnitRecord` typedef, field for field** (register S-P5-4) — `validateResultSet` is written against it, so a P3-invented key would be rejected on read. The two controller-ruled deltas P5's summary predates are `rootOwners[].owners[].cls` (**R2**) and `secondaryCauses` being sorted and digest-excluded (**R4**). | §6.5.1 "checked incrementally, *before* allocating the record"; §13.6's untrusted-read contract (a producer never emits a set its own reader rejects); ledger is structured-clone safe (master Global Constraints). |
| D3 | **Whole-model sentinel eligibility as a target** | A model may be a `'whole'` target entry iff its `B` selection is `kind:'model'` **and** `A_n` is empty. §6.3 states this only for cell 2's `B'_n`; the plan applies the same rule to cell 1's `B_n`, which is the *only* rule under which the sentinel's population equals `B_n` and contains no source-role root. | §6.3 exact cover and F2 self-exclusion: the sentinel can never re-introduce a non-required same-model pair or shadow a required one. |
| D4 | **`hierarchyInternal` representation** | One row per model: `{modelKey, rootCount, ownerCount, examples: ≤20 × {rootDbId, ownerDbIds: ≤8}}`, derived purely from `rootOwners`; budget cost = 1 + one per example. | §6.6 item 3 (exact counts, bounded examples, deterministic). |
| D5 | **`unreachable` population representation** | One row per model, existing iff `count > 0 ∨ notLoaded > 0 ∨ ownerUnresolvable > 0`: `{modelKey, count, ownerDbIds, mixedOwnerDbIds, unattributable:{notLoaded, ownerUnresolvable}}`; budget cost = 1 + one per `ownerDbIds` entry + one per `mixedOwnerDbIds` entry. Owner classes are derived, never stored per owner. | §6.2 (H1, R12-1): orientation-independent, claim-blocking, and identical for both role assignments of a pair. |
| D6 | **Hierarchy-overlap offender derivation** | P2 owns the rule input (`checkCrossRoleNesting`); P3 owns only the planning consequence. The derivation itself uses the already-recorded `RU` owner→root map (look up `d.ownerDbIds[0]`), not an ancestry walk the port does not expose — exact because `RU` root owner sets are disjoint and `d`'s subtree lies under exactly one of them. | §5.6.5: deterministic, cheap, fails **before any unit runs**. |
| D7 | **Where splitting lives** | **Revised by controller ruling R8.** The §6.4 *cut* stays a pure function of the plan (`cutUnit`), but `planSplit` folds the cut together with the **live capacity admission** — unit records (parents + children, incl. children of earlier runtime splits) against `maxUnitsPerRun`, ledger records against `maxLedgerRecords` — so a split is computed and admitted in one indivisible step, or refused with `{reason:'unit-cap'\|'ledger-cap', capDetail}` having recorded nothing. P6 still owns the *decision to call it* (from `failure.capacityKind`) and the settlement of a refusal; P3 owns neither the retry loop nor the queue. What P3 gained is the one thing a caller could silently omit: the count. | §7.1 "the *engine* owns planning, split and retry **decisions**" (the decision is still P6's; only the arithmetic moved); §6.5.1 "the run **never allocates beyond `maxLedgerRecords`**" and "never fails merely because the budget is full"; the split order and weight partition stay in one place. |
| D9 | **The per-root class marker `cls`** | Assigned once, in Task P3.5 step 7, from the set arithmetic that already defines `A'`/`C`/`B'` (`ROOT_CLASS = {A_ONLY:'A', B_ONLY:'B', BOTH:'C'}`), carried on the root row, and persisted **and digested** on every `rootOwners` row. Nothing re-derives it downstream; P8 reads it only through P5's `readLedger` (D4). | Controller ruling **R2** / master §8 OPEN-2 option (a): AC-20(c)'s element-level half needs "is this root in `A ∩ B`?" answerable from the sealed set alone. The rejected fallback (the bounded first-20 `hierarchyInternal.examples`) **under-reports** element caveats — a silent wrong answer, not a visible gap. |
| D10 | **`plan.ledger` is the one un-frozen property** | `createPlan`'s deep-freeze skips the `ledger` key; everything else on the plan is deep-frozen. | Required by D7/R8 (`planSplit(plan, unit)` must reach the live `RecordBudget` at the declared arity), and harmless to §6.4 invariant P1, which constrains the *plan's data*, not the run's accumulating ledger. |
| D8 | **Digest computation ownership** | `scopeDigest.js` is the only P3 module importing P0's canonical/digest utilities; the *enumerator* computes the digests it returns (port contract), and P3's functions are what a conforming enumerator and the P6/P7 bracketing loop both use, so both sides compute bytes identically. | §6.2.1 conformance; §16.3.2 exact string equality. |

---

## Verification / acceptance for P3

Run from the repo root. Every test below must pass; the whole suite must also pass under `npm test`.

- [ ] `node --test test/clashtest/planning/ElementEnumerator.test.mjs` — port shape validation, the planning-cause enum, and **the conformance helper passing for the synthetic enumerator and reporting (not throwing) for a non-cooperating one**. → spec §6.2; the Viewer adapter's acceptance gate (AC-15 (g)) later reuses this helper.
- [ ] `node --test test/clashtest/planning/scopeDigest.test.mjs` — population/subtree digests change under every mutation class (status flip, owner change, count-preserving geometry replacement, growth, shrink) and the comparator distinguishes `equal`/`mismatch`/`unverifiable`. **Plus `checkScopeBracket` (reconciliation D1, inherited from P6's deleted `run/scopeBracket.test.mjs`):** unchanged root subtrees with a moved population reports `drift` naming the model; `unverifiable` is absorbing over `equal` while `drift` dominates both; an all-equal bracket reports `equal`; and a population that grows *and reverts* between the pre-check and the post-check is still caught, because both sides compare against the planning-time expectation rather than against each other. → **AC-2 "Scope-digest conformance"**, the P3 half of AC-8's digest classes, and §16.3.2/§16.3.4 invariant I-scope.
- [ ] `node --test test/clashtest/planning/ledger.budget.test.mjs` — `planRecords ≤ maxPlanReferences` always; the reserve fits and is consumed in place; runtime refusal is atomic and flags exhaustion. → **AC-16 (planner parts)**, §6.5.1.
- [ ] `node --test test/clashtest/planning/planTables.test.mjs test/clashtest/planning/owners.test.mjs` — canonical table ids, half-open ranges, bisection never splits a root, duplicate-owner enumerator defect fails planning; owner classes root-only/unreachable-only/mixed. → **AC-17 (a)**, §6.2 (H1), §6.5.1.
- [ ] `node --test test/clashtest/planning/rootResolution.test.mjs` — `hierarchy-overlap` with the first 20 offenders and no units; `element-unresolvable` vs. the claim-blocking `no-fragments` record; `owner-mapping-mismatch`; `unreachablePopulation` + `unattributable` recorded orientation-independently; three-answer agreement. → **AC-2 (hierarchy cases, tree-unreachable population, unresolved selections)**, **AC-17 (g)**, §5.6.5, §6.2.
- [ ] `node --test test/clashtest/planning/decompose.test.mjs` — the four cells, exact cover against a brute-force `P` for unordered and ordered modes, same-model disjointness (F2), sentinel eligibility, canonical emission order. → **AC-2 (exact cover)**, §6.3.
- [ ] `node --test test/clashtest/planning/sizing.test.mjs` — source packing target vs. hard target caps; explicit entries cut between roots; a whole sentinel never partitioned; over-cap entries become `not-run:target-too-large` gaps with **zero** calls; sizing options change chunking, never coverage. → **AC-18 (a), (b), (c)** planner parts; §6.4.
- [ ] `node --test test/clashtest/planning/splitting.test.mjs` — the four-step split order, `${unitId}.0`/`.1` ids, children's weights partitioning the parent's exactly, unsplittable ⇒ gap, the cut's purity under input reordering. **Plus controller ruling R8 (live split admission):** the refusal vocabulary is exactly `['unsplittable','unit-cap','ledger-cap']` and every refusal is a **truthy** object carrying `.reason`; a **nested** split of a child is refused `unit-cap`/`capDetail:'unit-records'` when the run's live unit-record population (9,999 of `maxUnitsPerRun` = 10,000) leaves no room for two more children; an exhausted record budget is refused `ledger-cap`/`capDetail:'ledger-records'`; a refused split records **nothing**. → **AC-9 (split order / split lifecycle planner parts)**, **AC-16**, §6.4, §6.5.1.
- [ ] `node --test test/clashtest/planning/ledger.exhaustion.test.mjs` — every runtime record class exercised; `used ≤ maxLedgerRecords` after every admitted record; `taint-overflow` always admitted; refused split not performed with `capDetail` `ledger-records`/`unit-records`; inline fields still update; `budgetExhausted` + first refusing unit id recorded. **Plus the P5-pinned sealed shape:** taint `kind` is `element`/`target-model`/`unit` (never a budget class id); an admitted split flips the parent to `kind:'split'`/`outcome:'split'` and writes `parentUnitId` on the leaves, with `pairSpaceTotal` = Σ over **leaf** units only; and **ruling R4** — `secondaryCauses` stored ascending by cause code, capped at 8, byte-identical under a reordered observation sequence. → **AC-16 (planner parts)**, §6.5.1, §13.6 (a producer never emits a set its own reader rejects).
- [ ] `node --test test/clashtest/planning/planner.test.mjs` — `scopeExpect` for whole-model target, whole-model source (R20-1) and explicit-root target; `plan-too-large`; units hold ranges only; the planner yields per model. **`materializeUnit(...).scopeExpect` is the sole producer of the R20-1 rule (reconciliation D1), so this file also carries the cases from P6's deleted `buildScopeExpect` suite:** a `kind:'model'` source emits **both** a `roots` entry and a `whole` population entry for its own model; an explicit-list (`kind:'elements'`) source emits **no** population entry; and the emitted list is canonically ordered by `(modelKey, role, scope)`. **Plus the two controller rulings this task carries: R11** — `PlanResult.preTerminalGapWeight` is exposed, is `> 0` exactly when the plan holds `not-run:target-too-large` unit records, is `0` otherwise, and **equals the ledger sum it summarizes** so the accessor can never drift from the ledger; and **R2** — a hierarchy-internal (`A ∩ B`, `cls === 'C'`) root with ≥ 2 owners is recoverable from the **persisted** ledger alone (`JSON.parse(JSON.stringify(toLedgerRecord()))`, no plan, no run-scoped tables, not the bounded `hierarchyInternal.examples`), and the marker distinguishes all three classes (`'A'`/`'B'`/`'C'`). → **AC-2**, **AC-20 (c)** (the element-level half), §6.2.1, §6.5, §16.3.2; the P3 hooks for **AC-8**'s bracketing loop.
- [ ] `node --test test/clashtest/planning/planner.property.test.mjs` — 200 seeded cases × 2 modes: exact-cover equality with the brute-force reference and no pair covered twice; ledger accounting sums to `pairSpaceTotal` over **leaf** unit records, with `Σ plan.units.pairSpaceWeight + preTerminalGapWeight` closing the same total (R11); F2 self-exclusion; byte-identical plans under input reordering; nested roots ⇒ `hierarchy-overlap`, never a mis-cover. → **AC-2**, master Definition of Done item 5.
- [ ] `npm test` — the full existing suite still passes; no new runtime dependency; no `collision/` file touched (`git diff --stat -- collision/` empty).

---

## Spec coverage

| Spec § | Covered by |
|---|---|
| §5.2 operand semantics (union per model, `model` wins, snapshot at `queued → planning`, whole-target re-extraction) | P3.5 (consumes the normalized definition, plans over the supplied snapshot only), P3.9 (`scopeExpect` is the "proof or a gap" baseline) |
| §5.6.1–.2 subtree granularity, root normalization | P3.1 (port contract), P3.5 (steps 1–2, 7) |
| §5.6.3 hierarchy-internal declared exclusion | P3.5 step 9, D4 |
| §5.6.4 `rootOwners` owner → root map | P3.4 (`ownerRootByModel`, `rootOfOwner`) |
| §5.6.5 cross-role nesting (F16) | P3.5 step 6, D6 |
| §6.1 required pair set | P3.6 (reference), P3.9 (brute-force property suite) |
| §6.2 enumeration, `ElementEnumerator` port, owner classes, unreachable/unattributable, unresolved selections, owner-mapping mismatch | P3.1, P3.4 (`owners.js`), P3.5 |
| §6.2.1 scope digests | P3.2, P3.9 (`materializeUnit`) |
| §6.3 three-cell decomposition, cell 3b bisection, ordered mode | P3.6, D3 |
| §6.4 unit sizing, target-side bounds (H2, M7), plan determinism (P1), capacity splitting, unsplittable causes | P3.7, P3.8, D7 |
| §6.5 unit description (plain data) | P3.7 (`WorkUnit`), P3.9 (`materializeUnit`) |
| §6.5.1 run-scoped plan tables, `planRecords ≤ maxPlanReferences`, reserved overflow slots, per-class exhaustion | P3.3, P3.4, P3.8, D1, D2 |
| §6.6 coverage ledger, planning-level gaps, declared exclusions, empty operands, `maxUnitsPerRun` guard | P3.3, P3.5, P3.8, P3.9 |
| §16.3.2 bracketed scope proof (the digests and `scopeExpect`; the loop is P6) | P3.2, P3.9 |
| §17.1/§17.1.1 sizing options | consumed from P0 `options.js` throughout; P3 hard-codes no number |

---

## Gates and open items

### Master gates that touch this phase

| Gate | Effect on P3 |
|---|---|
| **G-PLAN** | Blocks the start of P3.1, like every other phase. |
| **G-OQ4** (Viewer owner-mapping/enumeration evidence) | **Blocks no task here.** P3 plans entirely over the port and a fake enumerator that passes `checkEnumeratorConformance`. The gate blocks only the Viewer adapter that must later pass the same helper. |
| **G-CAL** (memory/stall calibration) | Blocks *freezing* `maxPlanReferences`, `maxLedgerRecords`, `maxUnitsPerRun`, `maxTargetFragmentsPerUnit` as deployable defaults. P3 tasks run against the provisional defaults from `clashtest/options.js` and hard-code no number, so no P3 task is blocked. |
| **G-OQ16** (hierarchy-internal acceptance) | Blocks nothing here. P3 only *records* the `hierarchyInternal` table; whether a non-empty table blocks a claim is P5's rule and the engine option's default. |
| G-OQ1, G-OQ17, G-OQ19, G-REMOTE, G-RESP | No effect on P3. |

### Left to implementers (with the reason)

1. **The ledger's in-memory container types** (`Map` vs. object for `unitRecords`, array growth strategy) — the only contract is `toLedgerRecord()`'s arrays-only projection and the budget counts; performance tuning needs measurement that does not exist yet (G-CAL).
2. **Slice granularity inside `createPlan`** — the plan requires `await checkpoint()` at least once per model and once per cell batch (§17.3, `sliceBudgetMs`); the exact item count per slice is an implementer choice until AC-12 measures a cap-sized plan.
3. **Whether `decomposeCells` materializes cell 3b iteratively or recursively** — the emission order is pinned by the tests; the traversal form is not. (Deep recursion on a large `C_m` is a real hazard: an implementer choosing recursion must bound depth by `log2(|C_m|)`, which the bisection already guarantees.)
4. **The block-triangular alternative to cell 3b** (§6.3 permits it "provided the coverage invariants and AC-2 still hold") — not adopted here; the reference bisection is implemented and the property suite is the acceptance test any substitute must also pass. OQ-5 records the unmeasured unit-count cost.
5. **Cross-phase duplication — RESOLVED by reconciliation D1 (no longer an open item).** P3 keeps the R20-1 rule in `materializeUnit(...).scopeExpect`, P6's `buildScopeExpect` is deleted, and `checkScopeBracket` moves into `planning/scopeDigest.js` so P4 and P6 share one comparison without P4 importing from `run/`. **Two consequences for P3's own tasks:** (a) Task P3.2 additionally implements and tests `checkScopeBracket` (fold `compareScopeExpectation` over re-digested scopes; `unverifiable` absorbing, `drift` dominant), inheriting the four pure-function cases P6's `run/scopeBracket.test.mjs` had written (unchanged-roots-but-moved-population drift, explicit-list sources having no population entry, grow-and-revert detection across pre/post, and the `equal` path); (b) Task P3.9's `materializeUnit` suite additionally covers the R20-1 cases P6 had written for `buildScopeExpect` — a `kind:'model'` source brackets **both** its root subtrees and its whole population, an explicit-list source brackets roots only, and the emitted `scopeExpect` is canonically ordered. No behavior is lost in the move.
6. **`checkEnumeratorConformance` case catalogue** — P3 ships the port-contract cases (shape, stability, `digestScope` agreement, checkpoint propagation). The Viewer adapter plan adds its own *content* cases (readiness, `ObjectTreeUnavailableError`, real owner mismatch) when OQ-4 evidence exists.

### OQ-4-gated enumerator behaviors (Viewer adapter only, not core)

These are **port obligations P3 states and conformance-tests, but cannot implement or verify** without live Viewer evidence. None of them blocks a P3 task; all of them block accepting a Viewer `ElementEnumerator`:

- **Tree-owner vs. `fragList.getDbIds` owner** (§6.2, `ownerMismatch`). The core's rule is only "non-zero count fails planning `owner-mapping-mismatch`". Whether the two mechanisms agree on real content is AC-15 (g) / OQ-4.
- **Object-tree readiness.** The port must wait for the tree and *fail* rather than return a partial list (`ObjectTreeUnavailableError`-class). The core tests a throwing enumerator; it cannot test Viewer readiness.
- **Whole-model source population and the tree-vs-population reconciliation** that produces `unreachable.count`/`ownerDbIds`/`unattributable` — the core tests that the *records* are honored, not that a real Viewer produces them correctly.
- **Mode 2 under-enumeration for explicit scopes** (§6.2 residual limit, F15): undetectable by design. The core records `scopeKinds` so a consumer can see which operands had a population witness; the adapter's readiness gate is what makes the tree trustworthy.
- **`EnumerationContext.checkpoint()` cooperation.** The conformance helper checks that the port calls and propagates it; a non-cooperating Viewer enumerator weakens cancellation to "takes effect when the current invocation settles" (§6.2), which AC-7 tests on both sides in P6.

### Spec items this phase reported — all five now DECIDED

Every item below is **settled**; none is an open question an implementer must re-litigate. Register ids refer to [`interface-reconciliation.md`](interface-reconciliation.md) §(iii). The spec is frozen and was not edited: where a decision departs from a literal reading, the register carries the *PROPOSED SPEC ERRATUM* marker and this file carries the plan-level rule the implementer follows meanwhile.

1. **AC numbering in the master vs. spec §22 — DECIDED, and the defect was the master's, not the spec's (register S-P3-1).** Spec §22's exact-cover criterion is **AC-2**; AC-5 is the T2 single-query equivalence (P7's) and AC-6 is determinism. **The master has been corrected by the reconciliation pass**: its §7 no longer lists "AC-5, AC-6" for the planner but points at P7's AC traceability table as the authority. **This file's mappings (AC-2, AC-9 split parts, AC-16, AC-17, AC-18, AC-20(c)) are the correct ones and are final** — an implementer follows them and does not reconcile anything here.
2. **Whole-model-sentinel eligibility for cell 1 — DECIDED: adopt the `A_n = ∅` condition for cell 1 too (register S-P3-2, implementation-detail choice D3).** §6.3 states the sentinel condition only for cell 2; read literally, a cell-1 sentinel for a model with a non-empty `A_n` puts that model's own source-role roots into its target population — non-required pairs, i.e. over-coverage, which breaks the exact-cover invariant **AC-2** asserts. `targetScopeFor` therefore applies `model.wholeB && model.A.length === 0` in **both** cells, and the seeded property suite fails if the rule is ever loosened, so the invariant is executably protected. Recorded in the register as a *PROPOSED SPEC ERRATUM* (add the eligibility condition to cell 1's row in §6.3) **that is not applied and does not block implementation**.
3. **Two different quantities called "weight" — DECIDED: two fields, never interchangeable (register S-P3-3).** §6.5's **`pairSpaceWeight`** is `|source roots| × |target roots|`, a whole-model target contributing its **run-start root count**; §6.4's target-slicing **`targetWeight`** is a **fragment** count (`population.count` or Σ `fragmentCount`). §6.4 item 3's "`pairSpaceWeight` recorded as a gap" means the **root product**, never the fragment count — which is also exactly the number ruling **R11**'s `preTerminalGapWeight` sums. `pairSpaceWeight` is durable (P5's `UnitRecord`); `targetWeight` is not, and never reaches the ledger.
4. **Digest rows in `planRecords` — DECIDED: count both, and the revisit (if any) belongs to P5 (register S-P3-4, routed to gate G-CAL).** §6.5.1 counts both root-table entries (which already carry `subtreeDigest`) and per-scope digest rows. P3 counts both — the conservative reading, since §13.2's provenance `scopeDigests` is a separate durable structure — which can only make `plan-too-large` fire **earlier**, never later, so no fail-open exists either way. It is a **calibration** input to G-CAL, not an ambiguity in P3's behavior: the implementer counts both and changes nothing. If P5 later establishes that `scopeDigests` is a *view* over the root tables rather than a copy, the count is revisited **there**.
5. **§6.4 split step (2) wording — DECIDED: implement for exactly 1 source root (register S-P3-5).** The step is reachable only when the source set has ≤ 1 root, and a 0-root unit cannot exist because `sizeUnits` never emits an empty source chunk. No behavior is in doubt.

### Cross-file needs raised by this pass (P3 cannot apply them; listed, not edited)

> **Status after the residual cross-file sweep (all seven closed; kept for the audit trail).**
> **1** applied in P5 — `rootOwners[].owners[].cls` is in the pinned typedef, validated and digested; the sweep additionally corrected its **value domain** to P3's `ROOT_CLASS` literals `'A'|'B'|'C'` (P5 and P8 had pinned the primed plan-table spellings `"A'"|'C'|"B'"`, which no P3-emitted ledger would have satisfied).
> **2** applied in P5 — `ledgerDigestInput` excludes `secondaryCauses`, with a named test.
> **3** confirmed as *aligned, not outstanding* — P5's row stays `{phase, cause}` and P3's projection drops `detail`; P5's typedef now says so explicitly.
> **4** applied in P6 — row **A8** carries the R8 three-reason union and `capDetail`, and P6.5 branches on `.reason`.
> **5** applied in P6 — row **A6** lists `preTerminalGapWeight` and `adoptPlanIntoProgress(run, planResult)` adds P3's scalar instead of re-summing the ledger.
> **6** applied in P6 — no `buildScopeExpect`/`checkScopeBracket` sketch survives in `run/freshness.js`; it imports P3's `checkScopeBracket`, and no `binding.dead` branch remains anywhere in the file.
> **7** applied in P0 — `support/index.mjs` now carries the full later-phase export roster (including `syntheticModels.mjs`) as a comment, so the append is visibly not a fork.
> Two items the sweep raised back at **P3** and applied here: the ledger gained **`recordPlanningGap({phase, cause})`** (P6's only writer for run-level §6.6.2 gaps), and `checkScopeBracket`'s `bindings` argument is pinned as a **`Map`** — both consumers already passed one, while this file's own sketch indexed it as a plain object.

1. **P5 — `rootOwners` row shape (ruling R2).** P5's pinned `Ledger` typedef currently reads `rootOwners: Array<{modelKey, owners: Array<{rootDbId, ownerDbIds}>}>`; it **predates R2** and must gain **`cls: 'A'|'B'|'C'`** on the `owners[]` row, pinned in `validateResultSet` and **included in `ledgerDigestInput`** (it is a real schema decision, which is why it was OPEN-2). P3 emits it as of this pass; without the P5 edit, a P3-produced ledger fails P5's own closed-shape read.
2. **P5 — `ledgerDigestInput` must exclude `secondaryCauses` (ruling R4).** P5's `UnitRecord` marks only `attempts` and `durationMs` "NOT digested". `secondaryCauses` must join them, since a same-rank settlement tie is not a difference the digest may see. P3 additionally guarantees the list is sorted ascending by cause code and capped at 8, so even a digesting reader would be deterministic — but the ruling is explicit.
3. **P5 — `planningGaps` rows carry no `detail`.** §5.6.5 requires the first 20 `hierarchy-overlap` offenders (and §6.6 the `element-unresolvable` dbIds) to be recorded. P3 keeps them **run-scoped** on `PlanResult.planningGaps[].detail` and projects them away for persistence, because P5's pinned row is `{phase, cause}`. If they must be durable, the field is added to **P5's** row, not invented by P3's projection. *(P3's `unreachablePopulation.count` is projected away for the same reason; it is derivable in use, so it is an observation rather than a need.)*
4. **P6 — `splitUnit` refusal union widened (ruling R8).** P6's assumption row **A8** and the register's **N17** both still say `{reason:'unsplittable'}` only. Both must read `{children}` | `{reason:'unsplittable'|'unit-cap'|'ledger-cap', capDetail?}`, and P6's Task P6.5 must branch on `.reason` (it currently also calls `splitUnit(plan, unit.unitId, outcome.failure.capacityKind)` at one code site — the pre-reconciliation arity). P6 must **not** call `tryRecordSplit` itself: admission is inside `planSplit` now.
5. **P6 — adopt `PlanResult.preTerminalGapWeight` at plan completion (ruling R11).** P6's assumption row **A6** lists `PlanResult = {status, plan, ledger, planningGaps}`; it gains `preTerminalGapWeight`, and P6's progress accounting must add it to the settled weight when the plan completes, or progress drifts by the pre-planned `target-too-large` gap weight.
6. **P6 — `run/freshness.js` still contains a `buildScopeExpect`/`checkScopeBracket` code sketch** whose `checkScopeBracket` branches on **`binding.dead === true`** (P6 file, Task P6.6). `Binding` has no `dead` flag (**N10**) — that is the documented fail-**open** hazard. P3's implementation (Task P3.2 Step 4) is the one that ships; P6's sketch must be deleted or reduced to the run-level inputs its own text already says it is.
7. **P0 (test support) — `test/clashtest/support/index.mjs` gains `syntheticModels.mjs`'s exports.** Per P0's support extension rule (2) this is P3 appending a new file, not editing P0's; noted so the append is not mistaken for a fork.

---

## Conformance check

A **mechanical** re-check that no superseded cross-phase identifier survives anywhere in this file — including inside the executable test and implementation blocks, which is where the pre-reconciliation APIs actually hid. Every "consumer-assumed" spelling in the [`interface-reconciliation.md`](interface-reconciliation.md) §(i) name table is grepped for, plus the P3-internal spellings this pass superseded. Run from `docs/superpowers/plans/federated-clash-test-core/`.

```sh
F=p3-planner.md
run(){ printf '%-26s ' "$1"; printf 'hits=%s\n' "$(grep -c -E "$2" $F)"; }
run "N3/N5 digest helper"    "digestOf|digestSync|await digestCanonical"
run "N4 capture primitives"  "ownKeysOf|readOwnValue|prototypeIsPlain"
run "N6 slicer yield point"  "slicer\.(checkpoint|step)\(|\.runSliced\("
run "N31 resolveRunOptions"  "resolveRunOptions\(input\) *=>|resolveRunOptions\([^)]*\) *=> *\{ *options"
run "N10 Binding.dead"       "binding\.dead|dead\?:|\.dead ==="
run "N11 createModelRegistry" "createModelRegistry\(\{ *now"
run "N13/N14 pair ids"       "pairSemanticsForMode|makePairId\(source"
run "N15 planRun arg names"  "planRun\(\{[^}]*bindings|runOptions[,:]|planRun\(\{[^}]*limits"
run "N17 splitUnit refusal"  "splitUnit\(plan, unitId|capacityKind\)|planSplit\(plan, unit, |result !== null\)"
run "N19/N32 freshness"      "freshnessStateOf\(|getFreshness\(.*slicer"
run "N20 diagnostics pair"   "aggregateDiagnostics|readDiagnostics"
run "N21-N24 P5 residency"   "createResultSetDraft|startPersistence|handBackUnsaved|attachSealed|disposeAll|recordPlanningGap|\.mergeUnit\("
run "N25 coordinator"        "\.submit\(|activeRunIds|\.drain\(\)"
run "N29 capture homes"      "captureDefinition|captureResultSet"
run "D1 buildScopeExpect"    "^ *(const|let|export|import).*buildScopeExpect"
run "P1 snapshotBindings Map" "snapshotBindings\([^)]*\) *(=>|→) *(Readonly)?\{? *registryRevision[^}]*bindings: Map"
run "old ledger record keys" "capacityDetails|diagnosticCounts|toLedgerRecord\(\)\.gaps|ledger\.gaps"
run "old taint kinds"        "kind: '(element|unit|target-model)-taint'"
run "old unresolved row"     "\{ modelKey: 'm', dbId: 55, role:"
```

**Result (this file, after the pass).** Every row is **zero** except four, and in all four the only matches are prose that *names the superseded spelling in order to forbid it* or the cross-file-needs list — **no match is inside a code block, an import, a `Consumes` signature or an assertion**:

| Row | hits | Disposition |
|---|---|---|
| N3/N5 digest helper | 2 | Both in Task P3.2's *Interfaces*: "There is **no `digestOf`** and no async `digestCanonical`" and "No `await digestCanonical(...)` appears anywhere." Prohibitions, not uses. |
| N10 `Binding.dead` | 2 | The `checkScopeBracket` doc comment ("there is NO `binding.dead` flag") and cross-file need 6. **Both are prohibitions**; need 6's report is now marked closed (P6 carries no such sketch). |
| N17 `splitUnit` refusal | 2 | The cross-phase paragraph point 2 ("takes the `WorkUnit`, **not** `(plan, unitId, capacityKind)`") and cross-file need 4. |
| old ledger record keys | 1 | Task P3.8 Step 5's list of the four keys that "**do not exist there**". |
| all 15 other rows | 0 | — |

**Executed checks (scratch only, nothing written outside the scratchpad).** Two code blocks in this file were run against minimal stubs of the assumed producer modules before being committed to the plan:

- `scopeDigest.js` (Task P3.2 Steps 3–4) against a stub P0 `util/canonical.js` (`digestCanonical` synchronous, `digestCanonicalSliced` Promise-returning) and the full Task P3.2 test block: **8/8 pass**, including the four relocated `checkScopeBracket` cases (all-equal `equal`; unchanged roots + moved population ⇒ `drift` naming the model; `unverifiable` absorbing over `equal` while `drift` dominates, plus the `null`-binding case N10 requires; grow-and-revert across pre/post still caught).
- `planSplit` / `cutUnit` (Task P3.8 Step 4) against a stub ledger: **4/4 pass**, including the R8 nested-split boundary (9,997 live records ⇒ first split admitted at 9,999, nested split refused `unit-cap`/`unit-records` at 10,001), the `ledger-cap` path, the closed truthy-refusal contract, and the `pairSpaceWeight` partition invariant on every admitted cut.
