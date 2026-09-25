// clashtest/planning/planner.js
//
// The planning facade of spec 6 (Task P3.9). `createPlan` (alias `planRun`) runs every planning stage in order, every
// stage budget-charged and yielding through the injected checkpoint:
//
//   1  resolveSelectionRoots   the ElementEnumerator port, cross-role agreement, hierarchy-overlap, declared exclusions
//                              (it charges scope-digest / unresolved-selection / unreachable-population /
//                              hierarchy-internal rows itself when given the run budget)
//   2  buildRootTables         the run-scoped root tables (charges root-table / root-owner rows)
//   3  decomposeCellsLazy +    the three-cell exact-cover decomposition, generated cell by cell and consumed by sizing
//      sizeUnits               (source packing x target slicing) under the remaining unit cap: an oversized plan is refused
//                              after `limit + 1` units without ever materializing the unadmitted pair space (spec 6.5.1)
//   4  admit                   unit records and their range records, as blocks
//   5  reserveUnitSlots        the overflow reserve (the budget identity planRecords + maxUnitsPerRun <= maxLedgerRecords)
//   6  stage + assemble        every ledger record and the plan are BUILT (validated, copied, deep-frozen EXCEPT
//                              `plan.ledger`, D10) without touching the ledger
//   7  commit                  ONE O(1) `ledger.commitPlanned` assignment after the last checkpoint, so a cancelled or
//                              failed plan leaves the ledger untouched (spec 6.6.2)
//
// Spec 17.3: every size-dependent loop above yields through `checkpoint(label)` at least every 64 items (the label names the
// span, for AC-12's spanRecorder; a checkpoint may ignore it), and once per model, per cell batch and per stage. The two
// spans that stay synchronous are named in the JSDoc of `createPlan`.
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
import { runSliced } from './steps.js';
import { resolveSelectionRoots } from './rootResolution.js';
import { buildRootTablesSliced, readRange } from './planTables.js';
import { decomposeCellsLazy, CELL_IDS } from './decompose.js';
import { sizeUnitsSliced, SIZING_BATCH_LABEL, rangeRecordCount, unitRecordFields } from './sizing.js';
import { createRecordBudget, createLedger, rootOwnerRowsOfSliced } from './ledger.js';

/** Spec 17.3: a checkpoint at least every 64 items of an engine-controlled span (the slicer's own cadence). */
const CHECK_EVERY = 64;
const PLANNING_PHASE = 'planning';
/** The ledger `warnings[]` code of spec 6.6 item 4 (an empty operand); the spec names the row, not the code. */
export const EMPTY_OPERAND_WARNING = 'empty-operand';
const TARGET_TOO_LARGE = 'target-too-large';
const SIZING_KEYS = Object.freeze(['maxSourceFragmentsPerUnit', 'maxSourceDbIdsPerUnit', 'maxTargetModelsPerUnit', 'maxTargetFragmentsPerUnit']);
const LEDGER_METHODS = Object.freeze(['recordUnit', 'recordGap', 'recordPlanning', 'recordPlanningGap', 'stagePlanned', 'commitPlanned']);

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
 * Deep-freeze `value` in place, in deadline-aware slices (spec 17.3): arrays, plain objects, and the entries of Maps (which
 * are also made read-only). Skips the top-level keys in `skip` (the live ledger), functions, and anything already frozen
 * (a frozen subtree is never entered: the plan tables freeze their own rows). One `tick` per node (`plan:freeze`) and per Map entry (`plan:freeze-map`).
 */
async function deepFreezeSliced(value, skip, tick) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    if (v instanceof Map) {
      for (const [, entry] of v) {
        if (entry !== null && typeof entry === 'object') stack.push(entry);
        const pending = tick('plan:freeze-map');
        if (pending) await pending;
      }
      readOnlyMap(v);
    } else {
      for (const key of Reflect.ownKeys(v)) {
        if (v === value && skip.includes(key)) continue;
        const child = v[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
    Object.freeze(v);
    const pending = tick('plan:freeze');
    if (pending) await pending;
  }
  return value;
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

const seqOf = (unit) => Number(unit.unitId.slice(unit.unitId.lastIndexOf('.') + 1));
/** Slice items a unit record's expansion is worth: one, plus one per 64 root ids it copies (its cost scales with its roots). */
const idsTicks = (fields) => 1 + Math.floor((fields.sourceRootDbIds.length
  + fields.targets.reduce((n, t) => n + (t.rootDbIds?.length ?? 0), 0)) / CHECK_EVERY);
const CELL_RANK = new Map(CELL_IDS.map((id, rank) => [id, rank]));

/**
 * The checkpoint adapter every sliced stage runs through: `checkpoint(label)` at least every CHECK_EVERY items, and at
 * once at the end of each cell batch. (The label is an extra argument a zero-argument checkpoint simply ignores.)
 */
function tickThrough(checkpoint) {
  let items = 0;
  return (label) => (label === SIZING_BATCH_LABEL || ++items % CHECK_EVERY === 0 ? checkpoint(label) : undefined);
}

/**
 * Sizing returns issuable units and pre-terminal gaps as two lists, each already in emission order (per cell id, by the
 * one shared id sequence). One linear merge on (cell rank, seq) restores the canonical interleaving, with the plan-level
 * sums (range records, pair space, gap weight) taken in the same pass.
 */
function* assembleSteps(sizedUnits, sizedGaps) {
  const records = [];
  const units = [];
  const gaps = [];
  let rangeTotal = 0;
  let pairSpaceTotal = 0;
  let gapWeight = 0;
  const before = (a, b) => (CELL_RANK.get(a.cell) - CELL_RANK.get(b.cell)) || (seqOf(a) - seqOf(b));
  let u = 0;
  let g = 0;
  while (u < sizedUnits.length || g < sizedGaps.length) {
    const takeGap = u >= sizedUnits.length || (g < sizedGaps.length && before(sizedGaps[g], sizedUnits[u]) < 0);
    const unit = takeGap ? sizedGaps[g++] : sizedUnits[u++];
    records.push({ unit, gap: takeGap });
    (takeGap ? gaps : units).push(unit);
    rangeTotal += rangeRecordCount(unit);
    pairSpaceTotal += unit.pairSpaceWeight;
    if (takeGap) gapWeight += unit.pairSpaceWeight;
    yield 'plan:assemble';
  }
  return { records, units, gaps, rangeTotal, pairSpaceTotal, gapWeight };
}

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
 * @param {(label?: string) => (void|Promise<void>)} args.checkpoint  awaited between models, stages and cell batches and at
 *   least every 64 items inside every size-dependent loop (spec 17.3). Called with a span label (`planTables:*`, `plan:*`,
 *   `sizing:*`, `ledger:*`) a zero-argument checkpoint ignores. Anything it throws (cancellation) aborts planning and
 *   leaves the ledger exactly as it was: the ledger is written by ONE O(1) `commitPlanned` after the last checkpoint.
 *   Spans that stay synchronous (AC-12 / G-CAL gate items, not measured closed): the per-model `structuredClone` of the
 *   resolved entry (one model at ~100,000 roots measured ~90-140 ms), and the per-unit expansion + sort of one unit's
 *   root ids (bounded by the per-unit caps, not by plan size). The commit and the return are sub-millisecond.
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

  const tick = tickThrough(checkpoint);

  // 2. Root tables (charged), from the resolved per-model classes, built in slices.
  const built = await buildRootTablesSliced({
    models: [...resolved.models].map(([modelKey, m]) => ({ modelKey, classes: m.classes })),
    budget,
  }, { tick });
  if (!built.ok) return failed(built.cause === 'plan-too-large' ? { cause: built.cause, detail: { overflowClass: built.overflowClass } } : built);
  await checkpoint('plan:tables');

  // The plan's own per-model entries: detached copies (freezing the plan must never freeze an enumerator-owned array).
  // `structuredClone` of one model is not sliceable, so the checkpoint runs between models (see the JSDoc: AC-12 gate).
  const models = new Map();
  for (const [modelKey, m] of resolved.models) {
    models.set(modelKey, structuredClone(m));
    await checkpoint('plan:models');
  }
  const tablePlan = { ...built, models };

  // 3. Decomposition fused into sizing: cells are generated lazily and consumed by `sizeUnitsSliced` under `limit`, the
  //    room left under maxUnitsPerRun, so an oversized plan is refused after `limit + 1` units without ever building the
  //    unadmitted pair space (cells or units, spec 6.5.1). Sizing yields inside every loop and once per cell batch.
  const limit = Math.max(0, maxUnitsPerRun - ledger.unitRecordCount);
  const sized = await sizeUnitsSliced({ cells: decomposeCellsLazy({ models, plan: tablePlan, ordered }), plan: tablePlan, options, limit }, { tick });
  if (sized.exceeded) return tooLarge('unit-record');
  const { records, units, gaps, rangeTotal, pairSpaceTotal, gapWeight: preTerminalGapWeight } = await runSliced(assembleSteps(sized.units, sized.gaps), tick);
  await checkpoint('plan:sized');

  // 4. Admission, as blocks, BEFORE anything is recorded (spec 6.5.1): unit records, then their range records.
  const rootOwners = await rootOwnerRowsOfSliced(resolved.models, { tick });
  let raRoots = 0;
  let rbRoots = 0;
  for (const m of models.values()) {   // O(models) with O(1) work each (models <= maxEntriesPerSelection)
    raRoots += m.classes["A'"].length + m.classes.C.length;
    rbRoots += m.classes["B'"].length + m.classes.C.length;
  }
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

  // 6. BUILD everything without touching the ledger (a cancellation or failure in any slice below leaves it exactly as it
  //    was): the unit records' self-describing fields, the ledger's staged commit, and the frozen plan.
  const stagedUnits = [];
  for (const { unit, gap } of records) {
    const fields = unitRecordFields(tablePlan, unit);
    stagedUnits.push(gap ? { fields, gapCause: TARGET_TOO_LARGE } : { fields });
    for (let n = 0; n < idsTicks(fields); n++) {   // one item per unit plus one per 64 expanded root ids: a unit's cost is its size
      const pending = tick('plan:unit-fields');
      if (pending) await pending;
    }
  }
  const staged = await ledger.stagePlanned({
    planning: {
      planExists: true,
      emptyOperand,
      rootOwners,
      unresolvedSelections: resolved.unresolvedSelections,
      unreachablePopulation: resolved.unreachablePopulation,
      hierarchyInternal: resolved.hierarchyInternal,
      exclusions: resolved.libraryExclusions,
      warnings,
    },
    units: stagedUnits,
  }, { tick });

  const selectionKindByRole = { A: [], B: [] };
  for (const [modelKey, m] of models) {
    if (m.scopeKinds.A !== null) selectionKindByRole.A.push({ modelKey, kind: m.scopeKinds.A });
    if (m.scopeKinds.B !== null) selectionKindByRole.B.push({ modelKey, kind: m.scopeKinds.B });
  }
  const unitsById = new Map();
  for (const u of units) {
    unitsById.set(u.unitId, u);
    const pending = tick('plan:units-index');
    if (pending) await pending;
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
    unitsById,
    pairSpaceTotal,
    planRecords: budget.planRecords,
    sizing,
    ledger,
  };
  await deepFreezeSliced(plan, ['ledger'], tick);   // everything but the live ledger (D10)
  await checkpoint('plan:built');

  // 7. Commit: the last statement before the result, after the last checkpoint, and O(1): the ledger is either fully
  //    planned or exactly as the caller handed it over.
  ledger.commitPlanned(staged);
  return { status: 'planned', plan, ledger, planningGaps: [], preTerminalGapWeight };
}

/** P6's name for createPlan (register N15). */
export const planRun = createPlan;
