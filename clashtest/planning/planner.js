// clashtest/planning/planner.js
//
// The planning facade of spec 6 (Task P3.9). `createPlan` (alias `planRun`) runs every planning stage in order, every
// stage budget-charged and yielding through the injected checkpoint:
//
//   1  resolveSelectionRoots   the ElementEnumerator port, cross-role agreement, hierarchy-overlap, declared exclusions
//                              (it charges scope-digest / unresolved-selection / unreachable-population /
//                              hierarchy-internal rows itself when given the run budget)
//   2  buildRootTables         the run-scoped root tables (charges root-table / root-owner rows)
//   3  decomposeCells          the three-cell exact-cover decomposition
//   4  sizeUnits               source packing x target slicing, one cell batch at a time
//   5  admit + record          unit records and their range records, as blocks, then the ledger's planning sections
//   6  reserveUnitSlots        the overflow reserve (the budget identity planRecords + maxUnitsPerRun <= maxLedgerRecords)
//   7  deep-freeze the plan    EXCEPT `plan.ledger` (D10): planSplit reaches the live budget through it
//
// It never throws synchronously: it is an `async` function, so every failure is a `{status: 'failed'}` result (a
// spec 6.6.2 planning cause) or a rejected promise (enumerator errors, caller bugs, internal errors), controller
// ruling R1. A failed result records nothing but its `{phase, cause}` planning gap on the ledger (a failed plan has
// `units: []` and `planExists: false`); the run-scoped `detail` rides on the result only.
//
// `materializeUnit` is the ONE producer of a unit's transient expansion and of its `scopeExpect`, including the R20-1
// whole-model-source rule (reconciliation D1): P4 puts it in `ExecutionRequest.materialized`; nobody re-derives it.
//
// -- Typedefs (JSDoc only; the shapes other phases consume) -------------------------------------------------------
//
// @typedef {{table: string, start: number, end: number}} Range          half-open slice of one root table
// @typedef {{modelKey: string, scope: 'whole' | {ranges: Range[]}}} UnitTarget
// @typedef {object} WorkUnit  the spec 6.5 shape: ranges only, never dbId arrays or Model objects
//   @property {string} unitId  `${cell}.${seq}`; split children append `.0` / `.1`
//   @property {'1'|'2'|'3a'|'3b'} cell
//   @property {string} sourceModelKey
//   @property {Range[]} sourceRanges
//   @property {UnitTarget[]} targets  ascending by modelKey
//   @property {'A->B'|'B->A'|'canonical'} orientationRole
//   @property {number} pairSpaceWeight  |source roots| x |target roots|
//   @property {number} targetWeight     non-durable: the unit's target weight in fragments (sizing / splitting)
// @typedef {{phase: string, cause: string, detail?: object}} PlanningGap  `detail` is run-scoped, never persisted
// @typedef {object} Plan
//   @property {object[]} tables @property {Map} tableById @property {Map} ownersByModel @property {Map} ownerRootByModel
//   @property {Function} rangeOfClass  (modelKey, cls) => Range | null
//   @property {Map<string, object>} models  (alias modelsByKey) per model {classes, scopeKinds, wholeA, wholeB,
//     scopeDigests: {population: {count, digest} | null, roots: [{dbId, subtreeDigest}]}, rootOwners, unreachable}
//   @property {{A: Array<{modelKey: string, kind: string}>, B: Array<{modelKey: string, kind: string}>}} selectionKindByRole
//   @property {WorkUnit[]} units  the ISSUABLE initial units, canonical order
//   @property {WorkUnit[]} gaps   the pre-planned `not-run:target-too-large` units (each also a leaf ledger record)
//   @property {Map<string, WorkUnit>} unitsById  over `units`
//   @property {number} pairSpaceTotal  sum over units AND gaps
//   @property {number} planRecords     records the plan charged to the budget
//   @property {object} sizing          the four per-unit caps the plan was sized with
//   @property {object} ledger          the run's live coverage ledger; the one un-frozen property
// @typedef {{status: 'planned' | 'failed', plan: Plan | null, ledger: object, planningGaps: PlanningGap[],
//   preTerminalGapWeight: number}} PlanResult
// @typedef {object} Ledger  the ledger.js projection (`toLedgerRecord()`), exactly P5's pinned sealed-ledger shape

import { pairSemanticsOf } from '../identity/ids.js';
import { resolveSelectionRoots } from './rootResolution.js';
import { buildRootTables, readRange } from './planTables.js';
import { decomposeCells } from './decompose.js';
import { sizeUnits, rangeRecordCount, unitRecordFields } from './sizing.js';
import { createRecordBudget, createLedger, rootOwnerRowsOf } from './ledger.js';

/** Spec 17.3: a checkpoint at least every 64 items of an engine-controlled span (the slicer's own cadence). */
const CHECK_EVERY = 64;
const PLANNING_PHASE = 'planning';
/** The ledger `warnings[]` code of spec 6.6 item 4 (an empty operand); the spec names the row, not the code. */
export const EMPTY_OPERAND_WARNING = 'empty-operand';
const TARGET_TOO_LARGE = 'target-too-large';
const SIZING_KEYS = Object.freeze(['maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit', 'maxTargetModelsPerUnit', 'maxTargetFragmentsPerUnit']);
const LEDGER_METHODS = Object.freeze(['recordUnit', 'recordGap', 'recordPlanning', 'recordPlanningGap']);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ascending = (a, b) => a - b;

// ---- read-only plan structure ----------------------------------------------------------------------------------

/** Makes an existing Map genuinely read-only (still `instanceof Map`, so O(1) lookups keep working). */
function readOnlyMap(map) {
  const refuse = () => { throw new TypeError('the plan is immutable: this Map is read-only'); };
  for (const name of ['set', 'delete', 'clear']) Object.defineProperty(map, name, { value: refuse, enumerable: false });
  return map;
}

/**
 * Deep-freeze `value` in place: arrays, plain objects, and the entries of Maps (which are also made read-only). Skips
 * the top-level keys in `skip` (the live ledger), functions, and anything already visited.
 */
function deepFreeze(value, skip = [], seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [, v] of value) deepFreeze(v, [], seen);
    return readOnlyMap(value);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (skip.includes(key)) continue;
    const v = value[key];
    if (v !== null && typeof v === 'object') deepFreeze(v, [], seen);
  }
  return Object.freeze(value);
}

// ---- lookups -----------------------------------------------------------------------------------------------------

function modelOf(plan, modelKey) {
  const models = plan.models;
  const entry = models instanceof Map ? models.get(modelKey)
    : models !== null && typeof models === 'object' && Object.hasOwn(models, modelKey) ? models[modelKey] : undefined;
  if (entry === undefined) throw new RangeError(`the plan holds no model ${String(modelKey)}`);
  return entry;
}

/**
 * The root dbIds behind a range list, ASCENDING and detached. A unit's target ranges are ordered `[C, B']` by class, so
 * the flattened table order is not globally ascending; the sort makes the answer canonical. (Roots are unique per model,
 * so nothing is lost by it.) Every range is validated by `readRange`.
 * @param {Plan} plan
 * @param {Range[]} ranges
 * @returns {number[]}
 */
export function rootsForRanges(plan, ranges) {
  const out = [];
  for (const range of ranges) for (const dbId of readRange(plan, range)) out.push(dbId);
  return out.sort(ascending);
}

/** `{dbId, subtreeDigest}` per root behind a range list, ascending by dbId. The digests are the plan tables' own rows. */
function rootDigestsForRanges(plan, ranges) {
  const out = [];
  for (const range of ranges) {
    readRange(plan, range);   // validates the range (throws RangeError on a range that names no real slice)
    const { rows } = plan.tableById.get(range.table);
    for (let i = range.start; i < range.end; i++) out.push({ dbId: rows[i].dbId, subtreeDigest: rows[i].subtreeDigest });
  }
  return out.sort((a, b) => a.dbId - b.dbId);
}

const populationOf = (plan, modelKey) => {
  const population = modelOf(plan, modelKey).scopeDigests?.population;
  if (population === null || population === undefined) {
    throw new TypeError(`the plan holds no whole-model population digest for ${String(modelKey)}`);
  }
  return { count: population.count, digest: population.digest };   // a copy: the plan's own is never handed out
};

/**
 * The selection role(s) a unit's source occupies, from its orientation (spec 6.4): `A->B` calls take the source from
 * selection A, `B->A` from selection B; an unordered `canonical` pair has its source in both roles (a same-model
 * cell 3 root is in A and B), so either role naming the model `kind:'model'` counts.
 */
const sourceRolesOf = (unit) => (unit.orientationRole === 'A->B' ? ['A'] : unit.orientationRole === 'B->A' ? ['B'] : ['A', 'B']);

const compareExpectations = (a, b) => byCodeUnit(a.modelKey, b.modelKey) || byCodeUnit(a.role, b.role) || byCodeUnit(a.scope, b.scope);

/**
 * A unit's transient expansion (spec 7.1 `ExecutionRequest.materialized`): the source root dbIds, the targets (a
 * whole-model sentinel stays `{scope: 'whole'}`; an explicit entry carries its root dbIds), and the planning-time
 * `scopeExpect` the per-unit bracket (spec 16.3.2) compares against. Pure and detached: it reads the plan, never
 * mutates it, and hands out copies.
 *
 * `scopeExpect` (canonical order: modelKey, role, scope), the only place the bracket rules live:
 *   - the source's roots, always (a `roots` entry, one subtree digest per source root);
 *   - R20-1: the source model's whole-population digest too, when that model is named through a `kind:'model'`
 *     selection in the role the unit's source occupies (`sourceRolesOf`): a fragment outside every root subtree
 *     changes no subtree digest but does change the selection. An explicit-list source has no population entry;
 *   - per target: a `whole` entry (population digest) for a whole-model sentinel, else a `roots` entry.
 * @param {Plan} plan
 * @param {WorkUnit} unit
 * @returns {{sourceDbIds: number[], targets: object[], scopeExpect: object[]}}
 */
export function materializeUnit(plan, unit) {
  const sourceDbIds = rootsForRanges(plan, unit.sourceRanges);
  const targets = unit.targets.map((t) => (t.scope === 'whole'
    ? { modelKey: t.modelKey, scope: 'whole' }
    : { modelKey: t.modelKey, scope: 'roots', dbIds: rootsForRanges(plan, t.scope.ranges) }));

  const scopeExpect = [{
    modelKey: unit.sourceModelKey, role: 'source', scope: 'roots', roots: rootDigestsForRanges(plan, unit.sourceRanges),
  }];
  const sourceModel = modelOf(plan, unit.sourceModelKey);
  if (sourceRolesOf(unit).some((role) => sourceModel.scopeKinds?.[role] === 'model')) {
    scopeExpect.push({ modelKey: unit.sourceModelKey, role: 'source', scope: 'whole', population: populationOf(plan, unit.sourceModelKey) });
  }
  for (const t of unit.targets) {
    scopeExpect.push(t.scope === 'whole'
      ? { modelKey: t.modelKey, role: 'target', scope: 'whole', population: populationOf(plan, t.modelKey) }
      : { modelKey: t.modelKey, role: 'target', scope: 'roots', roots: rootDigestsForRanges(plan, t.scope.ranges) });
  }
  scopeExpect.sort(compareExpectations);
  return { sourceDbIds, targets, scopeExpect };
}

// ---- createPlan --------------------------------------------------------------------------------------------------

const fail = (cause, detail) => ({ ok: false, cause, detail });

/** Cells grouped by cell id, in first-appearance order: the id counter of sizeUnits is per cell id, so grouping keeps ids stable. */
function groupByCell(cells) {
  const groups = new Map();
  for (const spec of cells) {
    if (!groups.has(spec.cell)) groups.set(spec.cell, []);
    groups.get(spec.cell).push(spec);
  }
  return [...groups.values()];
}

const seqOf = (unit) => Number(unit.unitId.slice(unit.unitId.lastIndexOf('.') + 1));

/** The run's budget and ledger: a caller-supplied ledger (P6 owns both, reconciliation A17) or a fresh pair. */
function budgetAndLedger(options, suppliedLedger) {
  if (suppliedLedger === null || suppliedLedger === undefined) {
    const budget = createRecordBudget(options);
    return { budget, ledger: createLedger({ limits: options, budget }) };
  }
  for (const method of LEDGER_METHODS) {
    if (typeof suppliedLedger[method] !== 'function') throw new TypeError(`createPlan: ledger.${method} is required`);
  }
  const budget = suppliedLedger.budget;
  if (budget === null || typeof budget !== 'object' || typeof budget.admitPlan !== 'function' || typeof budget.reserveUnitSlots !== 'function') {
    throw new TypeError('createPlan: the supplied ledger must expose the run\'s RecordBudget as `ledger.budget`');
  }
  if (!Number.isSafeInteger(suppliedLedger.unitRecordCount)) throw new TypeError('createPlan: ledger.unitRecordCount is required');
  return { budget, ledger: suppliedLedger };
}

/**
 * @param {object} args
 * @param {object} args.definition  the NORMALIZED definition (P2 prepareDefinition)
 * @param {{bindings: ReadonlyArray<object|null>}} args.snapshot  P1 `snapshotBindings(keys)`: positional over the definition's ascending model keys
 * @param {object} args.enumerator  the ElementEnumerator port
 * @param {object} args.options  resolved run options (the sizing caps and the budget limits are read)
 * @param {() => (void|Promise<void>)} args.checkpoint  awaited between models, stages and cell batches (spec 17.3)
 * @param {object} [args.ledger]  the run's coverage ledger (which carries its RecordBudget); created when omitted
 * @returns {Promise<PlanResult>}
 */
export async function createPlan({ definition, snapshot, enumerator, options, checkpoint, ledger: suppliedLedger = null }) {
  if (definition === null || typeof definition !== 'object' || definition.selectionA === undefined || definition.selectionB === undefined) {
    throw new TypeError('createPlan: definition must be a normalized ClashTestDefinition');
  }
  if (options === null || typeof options !== 'object') throw new TypeError('createPlan: options must be the resolved run options');
  if (typeof checkpoint !== 'function') throw new TypeError('createPlan: checkpoint must be a function');
  if (enumerator === null || typeof enumerator !== 'object' || typeof enumerator.resolveRoots !== 'function') {
    throw new TypeError('createPlan: enumerator must be an ElementEnumerator');
  }
  const ordered = pairSemanticsOf(definition.mode) === 'ordered';
  const { budget, ledger } = budgetAndLedger(options, suppliedLedger);
  const maxUnitsPerRun = options.maxUnitsPerRun;
  if (!Number.isSafeInteger(maxUnitsPerRun) || maxUnitsPerRun < 0) throw new TypeError('createPlan: options.maxUnitsPerRun must be a non-negative integer');
  const sizing = Object.fromEntries(SIZING_KEYS.map((key) => [key, options[key]]));

  const failed = ({ cause, detail }) => {
    ledger.recordPlanningGap({ phase: PLANNING_PHASE, cause });
    const gap = detail === undefined ? { phase: PLANNING_PHASE, cause } : { phase: PLANNING_PHASE, cause, detail };
    return { status: 'failed', plan: null, ledger, planningGaps: [gap], preTerminalGapWeight: 0 };
  };
  const tooLarge = (overflowClass) => failed({ cause: 'plan-too-large', detail: { overflowClass } });

  // 1. Root resolution. It charges its own rows through the run budget; a refusal or any other failure is a result.
  const resolved = await resolveSelectionRoots({ definition, snapshot, enumerator, checkpoint, budget });
  if (!resolved.ok) {
    const detail = resolved.detail ?? (resolved.overflowClass === undefined ? undefined : { overflowClass: resolved.overflowClass });
    return failed({ cause: resolved.cause, detail });
  }

  // 2. Root tables (charged), from the resolved per-model classes.
  const built = buildRootTables({
    models: [...resolved.models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })),
    budget,
  });
  if (!built.ok) return failed(built.cause === 'plan-too-large' ? { cause: built.cause, detail: { overflowClass: built.overflowClass } } : built);
  await checkpoint();

  // The plan's own per-model entries: detached copies (freezing the plan must never freeze an enumerator-owned array).
  const models = new Map([...resolved.models].map(([modelKey, m]) => [modelKey, structuredClone(m)]));
  const tablePlan = { ...built, models };

  // 3. Decomposition, then sizing one cell batch at a time (a yield between batches), guarding the unit cap as we go
  //    so an oversized plan is refused as soon as it is known to be oversized.
  const cells = decomposeCells({ models, plan: tablePlan, ordered });
  await checkpoint();
  const records = [];   // { unit, gap } in canonical emission order: per cell id, by the shared id sequence
  for (const group of groupByCell(cells)) {
    // `limit`: the room left under maxUnitsPerRun, so the sizer stops after `limit + 1` units instead of building the
    // whole source-chunk x target-slice cross product of an oversized plan before it can be refused (spec 6.5.1).
    const limit = Math.max(0, maxUnitsPerRun - ledger.unitRecordCount - records.length);
    const { units: sized, gaps: sizedGaps, exceeded } = sizeUnits({ cells: group, plan: tablePlan, options, limit });
    if (exceeded) return tooLarge('unit-record');
    const batch = [...sized.map((unit) => ({ unit, gap: false })), ...sizedGaps.map((unit) => ({ unit, gap: true }))]
      .sort((a, b) => seqOf(a.unit) - seqOf(b.unit));
    for (const item of batch) records.push(item);
    if (ledger.unitRecordCount + records.length > maxUnitsPerRun) return tooLarge('unit-record');
    await checkpoint();
  }

  // 4. Admission, as blocks, BEFORE anything is recorded (spec 6.5.1): unit records, then their range records.
  const rangeTotal = records.reduce((n, { unit }) => n + rangeRecordCount(unit), 0);
  const rootOwners = rootOwnerRowsOf(resolved.models);
  const raRoots = [...models.values()].reduce((n, m) => n + m.classes["A'"].length + m.classes.C.length, 0);
  const rbRoots = [...models.values()].reduce((n, m) => n + m.classes["B'"].length + m.classes.C.length, 0);
  const emptyOperand = raRoots === 0 || rbRoots === 0;   // spec 6.6 item 4: a selection with no root in any model
  const warnings = emptyOperand ? [{ code: EMPTY_OPERAND_WARNING }] : [];
  if (!budget.admitPlanBlock([['unit-record', records.length], ['unit-range', rangeTotal], ['planning-gap', warnings.length]])) {
    return tooLarge(budget.planOverflowClass);
  }

  // 5. The overflow reserve. Unreachable under validated options (options.js: maxLedgerRecords >= maxPlanReferences +
  //    2 x maxUnitsPerRun); a violation is an internal error, never a silent overrun.
  if (!budget.reserveUnitSlots()) {
    throw new Error('internal-error: planRecords + maxUnitsPerRun exceeds maxLedgerRecords (the record budget cannot hold the overflow reserve)');
  }

  // 6. Build every record (yielding), then commit them to the ledger in one synchronous pass: a cancellation or a
  //    failure above can never leave a half-written ledger behind a `failed` result.
  const fields = [];
  for (const { unit } of records) {
    fields.push(unitRecordFields(tablePlan, unit));
    if (fields.length % CHECK_EVERY === 0) await checkpoint();
  }
  ledger.recordPlanning({
    planExists: true,
    emptyOperand,
    rootOwners,
    unresolvedSelections: resolved.unresolvedSelections,
    unreachablePopulation: resolved.unreachablePopulation,
    hierarchyInternal: resolved.hierarchyInternal,
    exclusions: resolved.libraryExclusions,
    warnings,
  });
  records.forEach(({ unit, gap }, i) => {
    if (gap) ledger.recordGap(unit.unitId, { ...fields[i], cause: TARGET_TOO_LARGE });
    else ledger.recordUnit(fields[i]);
  });

  // 7. Assemble and freeze (everything but the live ledger).
  const units = records.filter((r) => !r.gap).map((r) => r.unit);
  const gaps = records.filter((r) => r.gap).map((r) => r.unit);
  const preTerminalGapWeight = gaps.reduce((n, g) => n + g.pairSpaceWeight, 0);
  const selectionKindByRole = { A: [], B: [] };
  for (const [modelKey, m] of models) {
    if (m.scopeKinds.A !== null) selectionKindByRole.A.push({ modelKey, kind: m.scopeKinds.A });
    if (m.scopeKinds.B !== null) selectionKindByRole.B.push({ modelKey, kind: m.scopeKinds.B });
  }
  const plan = {
    tables: built.tables,
    tableById: built.tableById,
    ownersByModel: built.ownersByModel,
    ownerRootByModel: built.ownerRootByModel,
    rangeOfClass: built.rangeOfClass,
    models,
    modelsByKey: models,
    selectionKindByRole,
    units,
    gaps,
    unitsById: new Map(units.map((u) => [u.unitId, u])),
    pairSpaceTotal: records.reduce((n, { unit }) => n + unit.pairSpaceWeight, 0),
    planRecords: budget.planRecords,
    sizing,
    ledger,
  };
  deepFreeze(plan, ['ledger']);
  return { status: 'planned', plan, ledger, planningGaps: [], preTerminalGapWeight };
}

/** P6's name for createPlan (register N15). */
export const planRun = createPlan;
