// clashtest/planning/ledger.js
//
// Run-scoped record budget of spec 6.5.1 (Task P3.3). Every planning-time and runtime allocator of the coverage
// ledger goes through ONE RecordBudget, and admission is checked BEFORE allocation, so the run can never allocate
// past `maxLedgerRecords` and `planRecords <= maxPlanReferences` holds by construction. Task P3.8 extends this file
// with createLedger (unit records, taints, gaps, splits, the arrays-only projection) on top of the budget below.
//
// Budget arithmetic (spec 6.5.1 proof): resolveRunOptions has already enforced the cross-field rule
// maxLedgerRecords >= maxPlanReferences + 2 x maxUnitsPerRun, so after planning
//   planRecords + reserved(maxUnitsPerRun) <= maxLedgerRecords - maxUnitsPerRun,
// i.e. the reserve always fits AND the discretionary capacity D is always >= maxUnitsPerRun. The reserve holds one
// "taint-overflow" slot per unit record (unit records are themselves capped at maxUnitsPerRun), which is why a unit
// can always record that its taints collapsed, however full the budget is.

/** Budget class ids of the planning-time records (exhaustion of any of these is `plan-too-large`). */
export const PLAN_RECORD_CLASSES = Object.freeze([
  'root-table', 'root-owner', 'unreachable-population', 'scope-digest',
  'unresolved-selection', 'hierarchy-internal', 'planning-gap', 'unit-record', 'unit-range',
]);

/**
 * Every record class the budget counts. These are internal ACCOUNTING ids, not the persisted `taint.kind`
 * vocabulary ('element' | 'target-model' | 'unit') of the sealed ledger.
 */
export const LEDGER_RECORD_CLASSES = Object.freeze([
  ...PLAN_RECORD_CLASSES, 'element-taint', 'target-model-taint', 'unit-taint', 'split',
]);

/**
 * Durable per-root class marker persisted as `rootOwners[].owners[].cls` (controller ruling R2): 'A' = root in
 * A' = RA \ RB, 'B' = root in B' = RB \ RA, 'C' = root in C = RA n RB (a hierarchy-internal candidate). It is the
 * persisted form of the run-scoped plan-table classes "A'" / "B'" / 'C'.
 */
export const ROOT_CLASS = Object.freeze({ A_ONLY: 'A', B_ONLY: 'B', BOTH: 'C' });

const PLAN_CLASS_SET = new Set(PLAN_RECORD_CLASSES);
const LEDGER_CLASS_SET = new Set(LEDGER_RECORD_CLASSES);

// A NaN / negative / fractional size or limit would make every `x > limit` comparison below read as "fits":
// fail closed, loudly (these are programming errors, never data).
const requireUnitId = (v) => {
  if (typeof v !== 'string' || v.length === 0) throw new TypeError('unitId must be a non-empty string');
  return v;
};
const requireCount = (v, what) => {
  if (!Number.isSafeInteger(v) || v < 0) throw new TypeError(`${what} must be a non-negative safe integer`);
  return v;
};

/**
 * @param {{maxPlanReferences: number, maxLedgerRecords: number, maxUnitsPerRun: number}} limits the resolved run
 *        options of options.js (only these three keys are read; the cross-field rule is options.js's to enforce).
 * @returns {Readonly<{
 *   planRecords: number, used: number, discretionaryRemaining: number,
 *   budgetExhausted: boolean, firstRefusalUnitId: string|null, planOverflowClass: string|null,
 *   admitPlan(cls: string, n: number): boolean,
 *   admitPlanBlock(blocks: Array<[string, number]>): boolean,
 *   reserveUnitSlots(): boolean,
 *   consumeReservedSlot(unitId: string): boolean,
 *   admitRuntime(cls: string, n: number, unitId?: string): boolean }>}
 */
export function createRecordBudget(limits) {
  const maxPlanReferences = requireCount(limits?.maxPlanReferences, 'maxPlanReferences');
  const maxLedgerRecords = requireCount(limits?.maxLedgerRecords, 'maxLedgerRecords');
  const maxUnitsPerRun = requireCount(limits?.maxUnitsPerRun, 'maxUnitsPerRun');

  let planRecords = 0;
  let reserved = 0;
  let discretionary = 0;
  let budgetExhausted = false;
  let firstRefusalUnitId = null;
  let planOverflowClass = null;
  const consumedSlots = new Set();

  const used = () => planRecords + reserved + discretionary;

  return Object.freeze({
    get planRecords() { return planRecords; },
    get used() { return used(); },
    get discretionaryRemaining() { return maxLedgerRecords - used(); },
    get budgetExhausted() { return budgetExhausted; },
    get firstRefusalUnitId() { return firstRefusalUnitId; },
    /** Class of the FIRST planning refusal (what `plan-too-large` reports); null while planning fits. */
    get planOverflowClass() { return planOverflowClass; },

    /**
     * Admit `n` planning-time records of class `cls` as one block, or none of them. Refusal is
     * `plan-too-large` at the caller. The second bound only matters if planning admission is (mis)used after the
     * reserve: it keeps `used <= maxLedgerRecords` unconditionally.
     */
    admitPlan(cls, n) {
      if (!PLAN_CLASS_SET.has(cls)) throw new TypeError(`admitPlan: ${String(cls)} is not a planning record class`);
      requireCount(n, 'admitPlan size');
      if (planRecords + n > maxPlanReferences || used() + n > maxLedgerRecords) {
        planOverflowClass ??= cls;
        return false;
      }
      planRecords += n;
      return true;
    },

    /**
     * Admit several planning-time record blocks `[[cls, n], ...]` as ONE all-or-nothing operation: every block is
     * checked (cumulatively, in order) before any counter moves, so a refusal leaves `planRecords` exactly as it was
     * (no ghost accounting for records that were never retained). The first block that does not fit names
     * `planOverflowClass`.
     */
    admitPlanBlock(blocks) {
      if (!Array.isArray(blocks)) throw new TypeError('admitPlanBlock: blocks must be an array of [class, count] pairs');
      let total = 0;
      for (const block of blocks) {
        if (!Array.isArray(block) || block.length !== 2) throw new TypeError('admitPlanBlock: each block is a [class, count] pair');
        const [cls, n] = block;
        if (!PLAN_CLASS_SET.has(cls)) throw new TypeError(`admitPlanBlock: ${String(cls)} is not a planning record class`);
        requireCount(n, 'admitPlanBlock size');
        total += n;
        if (planRecords + total > maxPlanReferences || used() + total > maxLedgerRecords) {
          planOverflowClass ??= cls;
          return false;
        }
      }
      planRecords += total;
      return true;
    },

    /**
     * Reserve one overflow slot per possible unit record (`maxUnitsPerRun`). Idempotent. `false` is an internal
     * invariant violation (unreachable under validated options): nothing is reserved and the caller fails the run
     * `internal-error`, never a silent overrun.
     */
    reserveUnitSlots() {
      if (reserved > 0) return true;
      if (used() + maxUnitsPerRun > maxLedgerRecords) return false;
      reserved = maxUnitsPerRun;
      return true;
    },

    /**
     * A unit takes its reserved overflow slot exactly once, IN PLACE (`used` is unchanged: the slot was already
     * counted). `false` = this unit already holds it (the caller reuses its existing taint-overflow record).
     * Throws when no reserved slot is left to give (no reserve made, or more distinct units than the reserve holds):
     * that breaks the "one slot per unit record" proof, and a silent unaccounted record is the one thing the budget
     * exists to prevent.
     */
    consumeReservedSlot(unitId) {
      requireUnitId(unitId);   // two unidentified units must never alias to one "already taken" slot
      if (consumedSlots.has(unitId)) return false;
      if (consumedSlots.size >= reserved) {
        throw new RangeError('consumeReservedSlot: no reserved overflow slot left (reserveUnitSlots() not made, or more units than maxUnitsPerRun)');
      }
      consumedSlots.add(unitId);
      return true;
    },

    /**
     * Admit `n` runtime records (`cls` any LEDGER_RECORD_CLASSES id) from the discretionary capacity as one block,
     * or none. `unitId` is optional (an oracle may not know it) but is a non-empty string when given. Refusal flags
     * exhaustion and remembers the unit of the FIRST refusal only (null if that one had no id); the caller degrades conservatively
     * (collapse into taint-overflow, or refuse the split) and the run never fails merely because the budget is full.
     */
    admitRuntime(cls, n, unitId) {
      if (!LEDGER_CLASS_SET.has(cls)) throw new TypeError(`admitRuntime: ${String(cls)} is not a ledger record class`);
      requireCount(n, 'admitRuntime size');
      if (unitId !== undefined && unitId !== null) requireUnitId(unitId);
      if (maxLedgerRecords - used() < n) {
        if (!budgetExhausted) firstRefusalUnitId = unitId ?? null;
        budgetExhausted = true;
        return false;
      }
      discretionary += n;
      return true;
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The coverage ledger (Task P3.8): unit records, taints, splits, planning gaps and the arrays-only projection.
//
// The persisted shape is NOT P3's to choose: P5 pins the sealed ledger's JSON (`Ledger` / `UnitRecord` typedefs,
// register S-P5-4), `toLedgerRecord()` emits exactly that, and the in-memory record carries only P5's fields (plus
// private bookkeeping that never leaves this closure). Two controller rulings shape it: R2 (`rootOwners` rows carry
// `cls`) and R4 (`secondaryCauses` written sorted ascending by cause code and capped, and excluded from the digest --
// the digest itself is P5's `ledgerDigestInput`; nothing here computes one).
//
// Budget discipline (spec 6.5.1): the ledger allocates a runtime record only through `budget.admitRuntime` (taints,
// split blocks) BEFORE creating it, and never allocates at all for the inline, fixed-size fields (`recordOutcome`).
// Planning-time records (`recordUnit`, `recordGap`, `recordPlanning`) are charged by the PLANNER -- unit records and
// their range records through `budget.admitPlan('unit-record' | 'unit-range', n)` as blocks BEFORE the call -- so a
// refusal is `plan-too-large` at one place and the ledger stays a plain container there.
// ---------------------------------------------------------------------------------------------------------------

/** P5's `UnitRecord` keys, in its typedef order: nothing else is ever persisted on a unit. */
export const UNIT_RECORD_KEYS = Object.freeze(['unitId', 'kind', 'parentUnitId', 'sourceModelKey', 'sourceRootDbIds', 'targets',
  'outcome', 'cause', 'secondaryCauses', 'capacityKind', 'capDetail', 'scopeProof', 'pairSpaceWeight', 'taints', 'attempts', 'durationMs']);
/** P5's `Ledger` keys, in its typedef order. */
export const LEDGER_KEYS = Object.freeze(['planExists', 'pairSpaceTotal', 'emptyOperand', 'units', 'rootOwners', 'unresolvedSelections',
  'unreachablePopulation', 'hierarchyInternal', 'planningGaps', 'exclusions', 'warnings', 'budgetExhausted', 'firstRefusalUnitId']);

/** Spec 16.7 / 6.5.1: a unit row keeps at most this many secondary causes (the run-level reasons keep the full set). */
export const MAX_SECONDARY_CAUSES = 8;
/** The unit-wide taint a unit's collapsed taints become (spec 12.2.1), stored in the slot reserved for it. */
export const TAINT_OVERFLOW_REASON = 'taint-overflow';

// `split` is set only by tryRecordSplit; `null` (never persisted-valid) is a planned unit no outcome has settled yet.
const SETTLED_OUTCOMES = new Set(['evaluated', 'failed', 'skipped', 'discarded', 'not-run']);
const SCOPE_PROOFS = new Set(['equal', 'drift', 'unverifiable', 'not-checked']);
const CAP_DETAILS = new Set(['ledger-records', 'unit-records']);
const TAINT_KINDS = new Set(['element', 'target-model', 'unit']);
// Persisted taint.kind -> the internal budget class id (the two vocabularies are deliberately different).
const TAINT_CLASS = Object.freeze({ element: 'element-taint', 'target-model': 'target-model-taint', unit: 'unit-taint' });
const ROOT_CLASS_VALUES = new Set(Object.values(ROOT_CLASS));
const PLANNING_SECTIONS = new Set(['planExists', 'emptyOperand', 'rootOwners', 'unresolvedSelections', 'unreachablePopulation',
  'hierarchyInternal', 'exclusions', 'warnings']);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isId = (v) => Number.isSafeInteger(v) && v >= 0;
const nonEmptyString = (v, what) => {
  if (typeof v !== 'string' || v.length === 0) throw new TypeError(`${what} must be a non-empty string`);
  return v;
};
const idList = (v, what) => {
  if (!Array.isArray(v) || !v.every(isId)) throw new TypeError(`${what} must be an array of non-negative safe integers`);
  const out = [...new Set(v)].sort((a, b) => a - b);
  if (out.length !== v.length) throw new TypeError(`${what} must not repeat an id`);
  return out;
};

/** The self-describing part of a unit record (P5: a sealed ledger is read without a plan), validated and canonicalized. */
function normalizeUnitFields(fields) {
  const sourceModelKey = nonEmptyString(fields.sourceModelKey, 'sourceModelKey');
  const sourceRootDbIds = idList(fields.sourceRootDbIds, 'sourceRootDbIds');
  if (!Array.isArray(fields.targets)) throw new TypeError('targets must be an array');
  const targets = fields.targets.map((t) => {
    const modelKey = nonEmptyString(t?.modelKey, 'target modelKey');
    if (t.scope === 'model') {
      if (t.rootDbIds !== undefined) throw new TypeError('a model-scope target carries no rootDbIds');
      return { modelKey, scope: 'model' };
    }
    if (t.scope === 'roots') return { modelKey, scope: 'roots', rootDbIds: idList(t.rootDbIds, 'target rootDbIds') };
    throw new TypeError(`target scope must be 'model' or 'roots', got ${String(t.scope)}`);
  }).sort((a, b) => byCodeUnit(a.modelKey, b.modelKey));
  for (let i = 1; i < targets.length; i++) {
    if (targets[i].modelKey === targets[i - 1].modelKey) throw new TypeError(`targets repeat model ${targets[i].modelKey}`);
  }
  if (!isId(fields.pairSpaceWeight)) throw new TypeError('pairSpaceWeight must be a non-negative safe integer');
  if (fields.ranges !== undefined) requireCount(fields.ranges, 'ranges');
  return { sourceModelKey, sourceRootDbIds, targets, pairSpaceWeight: fields.pairSpaceWeight };
}

function normalizeTaint(t) {
  if (t === null || typeof t !== 'object' || !TAINT_KINDS.has(t.kind)) throw new TypeError('taint.kind must be element | target-model | unit');
  const reason = nonEmptyString(t.reason, 'taint.reason');
  const occurrences = t.occurrences === undefined ? 1 : t.occurrences;
  if (!Number.isSafeInteger(occurrences) || occurrences < 1) throw new TypeError('taint.occurrences must be a positive safe integer');
  if (t.kind === 'element') {
    if (!isId(t.dbId)) throw new TypeError('an element taint needs a dbId');
    return { kind: 'element', modelKey: nonEmptyString(t.modelKey, 'element taint modelKey'), dbId: t.dbId, reason, occurrences };
  }
  // target-model / unit entries are keyed by (kind, modelKey, reason) (spec 12.2.1): a dbId means nothing there.
  const modelKey = t.modelKey === undefined || t.modelKey === null ? null : nonEmptyString(t.modelKey, 'taint modelKey');
  if (t.kind === 'target-model' && modelKey === null) throw new TypeError('a target-model taint needs a modelKey');
  return { kind: t.kind, modelKey, dbId: null, reason, occurrences };
}

const taintKey = (t) => JSON.stringify([t.kind, t.modelKey, t.dbId, t.reason]);
// Spec 6.5.1 canonical order: kind, then modelKey, then dbId, then reason, code-unit order (null sorts first).
const compareTaints = (a, b) => byCodeUnit(a.kind, b.kind) || byCodeUnit(a.modelKey ?? '', b.modelKey ?? '')
  || (a.dbId ?? -1) - (b.dbId ?? -1) || byCodeUnit(a.reason, b.reason);

/**
 * The persisted per-root class rows of `rootOwners` (P5: `[{modelKey, owners: [{rootDbId, ownerDbIds, cls}]}]`, models
 * ascending) from resolveSelectionRoots' per-model entries. `cls` was assigned once, in root resolution (D9).
 * @param {Map<string, {rootOwners: Array<{rootDbId: number, ownerDbIds: number[], cls: string}>}>} models
 */
export function rootOwnerRowsOf(models) {
  return [...models].sort(([a], [b]) => byCodeUnit(a, b)).map(([modelKey, m]) => ({
    modelKey, owners: m.rootOwners.map((o) => ({ rootDbId: o.rootDbId, ownerDbIds: [...o.ownerDbIds], cls: o.cls })),
  }));
}

// P5 pins these rows unique by modelKey: a writer must not emit a set its own reader rejects.
function requireUniqueModels(rows, what) {
  const seen = new Set();
  for (const row of rows) {
    nonEmptyString(row?.modelKey, `${what} modelKey`);
    if (seen.has(row.modelKey)) throw new TypeError(`${what} repeats model ${row.modelKey}`);
    seen.add(row.modelKey);
  }
}

function normalizeRootOwners(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rootOwners must be an array');
  requireUniqueModels(rows, 'rootOwners');
  return rows.map((row) => {
    if (!Array.isArray(row.owners)) throw new TypeError('rootOwners row needs owners');
    const seenRoots = new Set();
    return {
      modelKey: row.modelKey,
      owners: row.owners.map((o) => {
        if (!ROOT_CLASS_VALUES.has(o?.cls)) throw new TypeError(`rootOwners cls must be one of ${[...ROOT_CLASS_VALUES].join(' | ')}, got ${String(o?.cls)}`);
        if (!isId(o.rootDbId)) throw new TypeError('rootOwners rootDbId must be a non-negative safe integer');
        if (seenRoots.has(o.rootDbId)) throw new TypeError(`rootOwners repeats root ${o.rootDbId} of ${row.modelKey}`);
        seenRoots.add(o.rootDbId);
        return { rootDbId: o.rootDbId, ownerDbIds: idList(o.ownerDbIds, 'rootOwners ownerDbIds'), cls: o.cls };
      }),
    };
  });
}

/**
 * @param {{limits: {maxUnitsPerRun: number, maxElementTaintsPerUnit: number}, budget: ReturnType<typeof createRecordBudget>}} args
 *   `limits` is the resolved run-options object (the budget does not expose its limits); `budget` is THE run's RecordBudget.
 */
export function createLedger({ limits, budget }) {
  const maxUnitsPerRun = requireCount(limits?.maxUnitsPerRun, 'maxUnitsPerRun');
  const maxElementTaintsPerUnit = requireCount(limits?.maxElementTaintsPerUnit, 'maxElementTaintsPerUnit');
  if (budget === null || typeof budget !== 'object' || typeof budget.admitRuntime !== 'function') {
    throw new TypeError('createLedger: budget must be the run\'s RecordBudget');
  }

  const unitRecords = new Map();          // unitId -> internal record, insertion order = record order
  const planningGaps = [];
  let planning = { planExists: false, emptyOperand: false, rootOwners: [], unresolvedSelections: [], unreachablePopulation: [],
    hierarchyInternal: [], exclusions: [], warnings: [] };

  const requireUnit = (unitId) => {
    const rec = unitRecords.get(unitId);
    if (rec === undefined) throw new RangeError(`the ledger holds no unit record ${String(unitId)}`);
    return rec;
  };

  const newRecord = (unitId, parentUnitId, fields) => ({
    unitId, kind: 'leaf', parentUnitId, ...fields,
    outcome: null, cause: null, secondaryCauses: [], capacityKind: null, capDetail: null, scopeProof: 'not-checked',
    taints: [], attempts: 0, durationMs: 0,
    // private bookkeeping, never projected
    taintIndex: new Map(), elementTaints: 0, overflowed: false, children: [],
  });

  const projectTaints = (rec) => [...rec.taints].sort(compareTaints).map((t) => ({ ...t }));
  const projectUnit = (rec) => ({
    unitId: rec.unitId, kind: rec.kind, parentUnitId: rec.parentUnitId, sourceModelKey: rec.sourceModelKey,
    sourceRootDbIds: [...rec.sourceRootDbIds],
    targets: rec.targets.map((t) => (t.scope === 'model' ? { modelKey: t.modelKey, scope: 'model' }
      : { modelKey: t.modelKey, scope: 'roots', rootDbIds: [...t.rootDbIds] })),
    outcome: rec.outcome, cause: rec.cause, secondaryCauses: [...rec.secondaryCauses], capacityKind: rec.capacityKind,
    capDetail: rec.capDetail, scopeProof: rec.scopeProof, pairSpaceWeight: rec.pairSpaceWeight,
    taints: projectTaints(rec), attempts: rec.attempts, durationMs: rec.durationMs,
  });

  /** The unit collapses its taints: one unit-wide `taint-overflow` in the slot reserved for it (consumed IN PLACE). */
  function collapse(rec) {
    budget.consumeReservedSlot(rec.unitId);   // false = this unit already holds its slot; throws only when the reserve proof is broken
    rec.overflowed = true;
    const row = { kind: 'unit', modelKey: null, dbId: null, reason: TAINT_OVERFLOW_REASON, occurrences: 1 };
    if (!rec.taintIndex.has(taintKey(row))) { rec.taintIndex.set(taintKey(row), row); rec.taints.push(row); }
  }

  const ledger = {
    /**
     * THE run's RecordBudget this ledger allocates through (read-only). The planner reaches it here: P6 constructs the
     * budget and the ledger and hands only the ledger to `planRun` (reconciliation A17), and `planSplit(plan, unit)`
     * keeps its arity by reaching the budget the same way.
     */
    get budget() { return budget; },
    /** True once any budget refusal was recorded (a flag, never a failure: the run degrades conservatively). */
    get budgetExhausted() { return budget.budgetExhausted; },
    /** The unit at which the budget FIRST refused a record; null while nothing was refused. */
    get firstRefusalUnitId() { return budget.firstRefusalUnitId; },
    /** Live unit records (leaves + split parents): what `maxUnitsPerRun` bounds. */
    get unitRecordCount() { return unitRecords.size; },

    /**
     * Record one planned unit, self-describing (P5): `{unitId, kind?: 'leaf', parentUnitId?: null, sourceModelKey,
     * sourceRootDbIds, targets: [{modelKey, scope: 'model'|'roots', rootDbIds?}], pairSpaceWeight, ranges?}`. Allocates
     * nothing itself (see the file header): the planner admits its unit and range records first. Its outcome is `null`
     * (planned, not yet settled) until `recordOutcome`.
     */
    recordUnit(fields) {
      const unitId = nonEmptyString(fields?.unitId, 'unitId');
      if (fields.kind !== undefined && fields.kind !== 'leaf') throw new TypeError('recordUnit records leaf units only; a split parent is made by tryRecordSplit');
      if (fields.parentUnitId !== undefined && fields.parentUnitId !== null) throw new TypeError('recordUnit records initial units only; children are made by tryRecordSplit');
      const rec = newRecord(unitId, null, normalizeUnitFields(fields));
      if (unitRecords.has(unitId)) throw new RangeError(`unit record ${unitId} already exists`);
      // The cap is an invariant the planner guards BEFORE recording (plan-too-large), never a refusal here.
      if (unitRecords.size + 1 > maxUnitsPerRun) throw new RangeError('recordUnit: maxUnitsPerRun exceeded');
      unitRecords.set(unitId, rec);
    },

    /** A unit-level gap: a leaf unit record already terminal, `outcome: 'not-run'` with its `cause` (today only `target-too-large`). */
    recordGap(unitId, fields) {
      if (fields?.unitId !== undefined && fields.unitId !== unitId) throw new TypeError('recordGap: unitId does not match');
      const cause = nonEmptyString(fields?.cause, 'gap cause');
      ledger.recordUnit({ ...fields, unitId });
      const rec = unitRecords.get(unitId);
      rec.outcome = 'not-run';
      rec.cause = cause;
    },

    /**
     * Inline, fixed-size fields of an existing unit record (spec 6.5.1): allocates nothing and cannot be refused. Omitted
     * fields keep their value. `secondaryCauses` is stored DISTINCT, ascending by cause code (R4), capped at 8.
     */
    recordOutcome(unitId, patch) {
      const rec = requireUnit(unitId);
      const next = {};
      if (patch.outcome !== undefined) {
        if (!SETTLED_OUTCOMES.has(patch.outcome) && !(rec.kind === 'split' && patch.outcome === 'split')) {
          throw new TypeError(`recordOutcome: outcome must be one of ${[...SETTLED_OUTCOMES].join(' | ')}`);
        }
        next.outcome = patch.outcome;
      }
      if (rec.kind === 'split' && next.outcome !== undefined && next.outcome !== 'split') throw new TypeError('a split parent keeps outcome `split`');
      for (const key of ['cause', 'capacityKind']) {
        if (patch[key] === undefined) continue;
        if (patch[key] !== null && (typeof patch[key] !== 'string' || patch[key].length === 0)) throw new TypeError(`${key} must be a non-empty string or null`);
        next[key] = patch[key];
      }
      if (patch.capDetail !== undefined) {
        if (patch.capDetail !== null && !CAP_DETAILS.has(patch.capDetail)) throw new TypeError('capDetail must be ledger-records | unit-records | null');
        next.capDetail = patch.capDetail;
      }
      if (patch.scopeProof !== undefined) {
        if (!SCOPE_PROOFS.has(patch.scopeProof)) throw new TypeError('scopeProof must be equal | drift | unverifiable | not-checked');
        next.scopeProof = patch.scopeProof;
      }
      if (patch.attempts !== undefined) next.attempts = requireCount(patch.attempts, 'attempts');
      if (patch.durationMs !== undefined) {
        if (!Number.isFinite(patch.durationMs) || patch.durationMs < 0) throw new TypeError('durationMs must be a non-negative finite number');
        next.durationMs = Math.round(patch.durationMs);   // P5: an integer; wall-clock, never digested
        if (!Number.isSafeInteger(next.durationMs)) throw new TypeError('durationMs must round to a safe integer');
      }
      if (patch.secondaryCauses !== undefined) {
        if (!Array.isArray(patch.secondaryCauses)) throw new TypeError('secondaryCauses must be an array');
        for (const c of patch.secondaryCauses) nonEmptyString(c, 'secondary cause');
        next.secondaryCauses = [...new Set(patch.secondaryCauses)].sort(byCodeUnit).slice(0, MAX_SECONDARY_CAUSES);
      }
      Object.assign(rec, next);
    },

    /**
     * Record taints of one unit (spec 12.2.1, 6.5.1): `taint` is one entry or an array (an array is admitted in CANONICAL
     * order -- kind, modelKey, dbId, reason -- so which entries collapse is a pure function of the ledger state). An
     * identical entry adds `occurrences` and allocates nothing. Each new entry is admitted through the budget first;
     * refusal, an element entry past `maxElementTaintsPerUnit`, or a direct `taint-overflow` collapses the unit into its
     * single unit-wide `taint-overflow` (always admitted: its slot was reserved), after which further detail is absorbed:
     * the overflow already makes every pair of the unit caveated, so nothing is lost but the detail.
     */
    addTaint(unitId, taint) {
      const rec = requireUnit(unitId);
      const list = (Array.isArray(taint) ? taint : [taint]).map(normalizeTaint).sort(compareTaints);
      for (const t of list) {
        if (t.kind === 'unit' && t.reason === TAINT_OVERFLOW_REASON) { collapse(rec); continue; }
        const key = taintKey(t);
        const existing = rec.taintIndex.get(key);
        if (existing !== undefined) {
          if (!Number.isSafeInteger(existing.occurrences + t.occurrences)) throw new RangeError('taint occurrences exceed the safe-integer range');
          existing.occurrences += t.occurrences;
          continue;
        }
        if (rec.overflowed) continue;
        if ((t.kind === 'element' && rec.elementTaints + 1 > maxElementTaintsPerUnit)
          || !budget.admitRuntime(TAINT_CLASS[t.kind], 1, unitId)) { collapse(rec); continue; }
        rec.taintIndex.set(key, t);
        rec.taints.push(t);
        if (t.kind === 'element') rec.elementTaints++;
      }
    },

    /**
     * The ledger-level split primitive (planSplit is its caller; nothing else should be): admit the two child unit records
     * and their range records as ONE block, or none. `children` is `[{unitId, ranges, ...self-describing fields}]`, the
     * two ids `${unitId}.0` / `${unitId}.1`, weights partitioning the parent's exactly. Returns `{ok: true}`, or
     * `{ok: false, capDetail: 'unit-records' | 'ledger-records'}` having recorded NOTHING. The unit-record count is over
     * the LIVE population, so every child of every earlier split counts. A malformed call throws before anything changes.
     */
    tryRecordSplit(unitId, children) {
      const parent = requireUnit(unitId);
      if (parent.kind !== 'leaf' || (parent.outcome !== null && parent.outcome !== 'failed')) {
        throw new RangeError(`unit ${unitId} cannot be split (a split parent, or a unit already settled ${String(parent.outcome)})`);
      }
      if (!Array.isArray(children) || children.length !== 2) throw new TypeError('a split has exactly two children');
      const made = children.map((c, i) => {
        if (c?.unitId !== `${unitId}.${i}`) throw new TypeError(`child ${i} must be ${unitId}.${i}`);
        if (unitRecords.has(c.unitId)) throw new RangeError(`unit record ${c.unitId} already exists`);
        return { record: newRecord(c.unitId, unitId, normalizeUnitFields(c)), ranges: requireCount(c.ranges, 'child ranges') };
      });
      if (made[0].record.pairSpaceWeight + made[1].record.pairSpaceWeight !== parent.pairSpaceWeight) {
        throw new TypeError('internal-error: split weights do not partition the parent');
      }
      if (unitRecords.size + 2 > maxUnitsPerRun) return { ok: false, capDetail: 'unit-records' };
      if (!budget.admitRuntime('split', 2 + made[0].ranges + made[1].ranges, unitId)) return { ok: false, capDetail: 'ledger-records' };
      // Everything below cannot fail: the block is admitted and both records are already built.
      parent.kind = 'split';
      parent.outcome = 'split';
      parent.cause = null;
      for (const { record } of made) { unitRecords.set(record.unitId, record); parent.children.push(record.unitId); }
      return { ok: true };
    },

    /**
     * The RUN-level (spec 6.6.2) gap writer: appends `{phase, cause}` and nothing else, de-duplicated on the pair, in
     * call order. No unit record, no budget class, cannot be refused (the causes are a closed enum), so it is safe on a
     * ledger that will seal with `units: []`. A run-scoped `detail` belongs on PlanResult, not here.
     */
    recordPlanningGap({ phase, cause }) {
      nonEmptyString(phase, 'planning gap phase');
      nonEmptyString(cause, 'planning gap cause');
      if (!planningGaps.some((g) => g.phase === phase && g.cause === cause)) planningGaps.push({ phase, cause });
    },

    /**
     * Adopt the planning-only sections, already charged to the budget by the stage that built them (buildRootTables,
     * resolveSelectionRoots). Any subset of `{planExists, emptyOperand, rootOwners, unresolvedSelections,
     * unreachablePopulation, hierarchyInternal, exclusions, warnings}`; anything else throws. `rootOwners[].owners[].cls`
     * must be a ROOT_CLASS literal (R2). Data is copied, never aliased.
     */
    recordPlanning(sections) {
      for (const key of Object.keys(sections)) if (!PLANNING_SECTIONS.has(key)) throw new TypeError(`recordPlanning: unknown section ${key}`);
      const next = { ...planning };
      for (const key of ['planExists', 'emptyOperand']) {
        if (sections[key] === undefined) continue;
        if (typeof sections[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`);
        next[key] = sections[key];
      }
      if (sections.rootOwners !== undefined) next.rootOwners = normalizeRootOwners(sections.rootOwners);
      for (const key of ['unresolvedSelections', 'unreachablePopulation', 'hierarchyInternal', 'warnings']) {
        if (sections[key] === undefined) continue;
        if (!Array.isArray(sections[key])) throw new TypeError(`${key} must be an array`);
        if (key === 'unreachablePopulation' || key === 'hierarchyInternal') requireUniqueModels(sections[key], key);
        next[key] = structuredClone(sections[key]);
      }
      if (sections.exclusions !== undefined) {
        if (!Array.isArray(sections.exclusions)) throw new TypeError('exclusions must be an array');
        for (const e of sections.exclusions) nonEmptyString(e, 'exclusion');
        next.exclusions = [...new Set(sections.exclusions)].sort(byCodeUnit);
      }
      planning = next;
    },

    /** One unit's record in its persisted shape (a detached copy), or null when the ledger holds no such unit. */
    unitRecord(unitId) {
      const rec = unitRecords.get(unitId);
      return rec === undefined ? null : projectUnit(rec);
    },

    /**
     * The persisted projection: exactly P5's `Ledger` (arrays-only plain data, no Map, detached from the live ledger).
     * Units are in planPath order -- initial units in record order, each split parent immediately followed by its
     * subtree -- so it never depends on the order runtime splits happened in. `pairSpaceTotal` is the sum over LEAF units.
     */
    toLedgerRecord() {
      const units = [];
      let pairSpaceTotal = 0;
      const visit = (rec) => {
        units.push(projectUnit(rec));
        if (rec.kind === 'leaf') pairSpaceTotal += rec.pairSpaceWeight;
        for (const childId of rec.children) visit(unitRecords.get(childId));
      };
      for (const rec of unitRecords.values()) if (rec.parentUnitId === null) visit(rec);
      return {
        planExists: planning.planExists,
        pairSpaceTotal,
        emptyOperand: planning.emptyOperand,
        units,
        rootOwners: structuredClone(planning.rootOwners),
        unresolvedSelections: structuredClone(planning.unresolvedSelections),
        unreachablePopulation: structuredClone(planning.unreachablePopulation),
        hierarchyInternal: structuredClone(planning.hierarchyInternal),
        planningGaps: planningGaps.map((g) => ({ ...g })),
        exclusions: [...planning.exclusions],
        warnings: structuredClone(planning.warnings),
        budgetExhausted: budget.budgetExhausted,
        firstRefusalUnitId: budget.firstRefusalUnitId,
      };
    },
  };
  return ledger;
}
