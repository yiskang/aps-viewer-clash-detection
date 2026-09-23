// test/clashtest/support/fakePlanner.mjs
//
// P6's fake of P3's planner surface (master plan "Consumed interfaces" A6/A7/A8/A17).
//
// `createFakePlan(units, opts)` (Task P6.3, extended by P6.4) builds a minimal `Plan`:
// `units`, `unitsById`, `pairSpaceTotal` (Σ unit `weight` + Σ preplanned gap `pairSpaceWeight`, which
// is what P3's own `pairSpaceTotal` means: "already includes the gap weights", R11). Each unit keeps
// the fields it was given (`unitId`, `weight`, `models`) and gains the WorkUnit fields a run reads:
// `pairSpaceWeight` (= `weight`), `sourceModelKey` (= `models[0]`, default `'mk-a'`), `targets`
// (one `{modelKey, scope: 'whole'}` per further model), `sourceRanges: []`, `cell`, `orientationRole`.
// `opts.gaps: [{unitId, pairSpaceWeight, cause}]` are P3's preplanned `not-run:<cause>` records
// (today only `target-too-large`): part of the pair space, never an executable unit.
//
// `createFakePlannerPort({plan, planningGaps, stallAt, onPlanRun, yieldToScheduler})` (P6.4) is the
// `RunSpec.plannerPort` over that plan. `createRecordBudget`/`createLedger` are P3's REAL ones (the
// ledger is a plain in-memory container with the exact A17 surface and P5's pinned projection), so
// a sealed ledger in a P6 test is exactly the shape P5 reads; the planner half is faked:
//   - `planRun` records the plan's units and preplanned gaps into the ledger P6 handed it, reserves
//     the per-unit overflow slots (P3 step 5), and returns P3's `PlanResult` WRAPPER;
//   - `planningGaps: PlanningGap[]` makes it return `{status: 'failed', plan: null, planningGaps}`;
//     `plan: null` with no gaps is an `enumeration-failed` gap;
//   - `stallAt: 'enumerating'` parks it in a checkpoint loop (so only a cancel ends it, through the
//     checkpoint's `EnumerationCancelledError`, exactly like a cooperative enumerator).
//   - `materializeUnit` / `splitUnit` are minimal; Task P6.5 extends them (`splits`, scopeExpect).
//
// Extension rules (support/index.mjs): signatures are forward-compatible, and a later task ADDS
// options with defaults that preserve this behaviour; it never forks or recreates this file.

import { createRecordBudget, createLedger } from '../../../clashtest/planning/ledger.js';

const DEFAULT_MODEL_KEY = 'mk-a';

function workUnitOf(u) {
  const models = u.models ?? [DEFAULT_MODEL_KEY];
  return {
    ...u,
    cell: u.cell ?? 'cell-0',
    sourceModelKey: models[0],
    sourceRanges: [],
    targets: models.slice(1).map((modelKey) => ({ modelKey, scope: 'whole' })),
    orientationRole: 'canonical',
    pairSpaceWeight: u.weight ?? 0,
  };
}

/** A7/N16: `(plan, unit) -> {sourceDbIds, targets, scopeExpect}` -- the same body `plannerPort`'s own
 *  `materializeUnit` uses (Task P6.5), factored out so `fx.plan.materializeUnit(...)` and
 *  `fx.plannerPort.materializeUnit(...)` can never silently disagree. */
export function materializeUnitOf(_plan, unit) {
  return {
    sourceDbIds: [],
    targets: unit.targets.map((t) => ({ modelKey: t.modelKey, scope: 'whole' })),
    scopeExpect: [],
  };
}

export function createFakePlan(units, opts = {}) {
  const list = units.map(workUnitOf);
  const gaps = (opts.gaps ?? []).map((g) => ({ ...g }));
  const unitsById = new Map(list.map((u) => [u.unitId, u]));
  const gapWeight = gaps.reduce((sum, g) => sum + (g.pairSpaceWeight ?? 0), 0);
  const pairSpaceTotal = list.reduce((sum, u) => sum + u.pairSpaceWeight, 0) + gapWeight;
  return {
    // `opts` spreads FIRST so the computed fields below always win: an opts.units/
    // opts.unitsById/opts.pairSpaceTotal that disagreed with the real computation would silently
    // mask a wiring bug in whichever later task passed it (codex-advisor review, P6.3). A later
    // task that genuinely needs an inconsistent/malformed fixture should add an explicitly-named
    // override option instead of relying on this spread to clobber a computed field.
    ...opts,
    units: list,
    unitsById,
    gaps,
    pairSpaceTotal,
    preTerminalGapWeight: gapWeight,
    materializeUnit: materializeUnitOf,                     // Task P6.5: `fx.plan.materializeUnit(...)`
  };
}

/** Every model key a fake plan touches, ascending and distinct (the definition's model set). */
export function modelKeysOfPlan(plan) {
  if (plan === null || plan === undefined) return [];
  const keys = new Set();
  for (const u of plan.units) {
    keys.add(u.sourceModelKey);
    for (const t of u.targets) keys.add(t.modelKey);
  }
  return [...keys].sort();
}

const pathOf = (unitId) => unitId.split('.').map(Number);
function comparePaths(a, b) {
  const [x, y] = [pathOf(a), pathOf(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** The self-describing ledger fields of a fake unit (P3 `unitRecordFields`' shape). */
const ledgerFieldsOf = (u) => ({
  unitId: u.unitId,
  sourceModelKey: u.sourceModelKey ?? DEFAULT_MODEL_KEY,
  sourceRootDbIds: [],
  targets: (u.targets ?? []).map((t) => ({ modelKey: t.modelKey, scope: 'model' })),
  pairSpaceWeight: u.pairSpaceWeight,
});

/**
 * Task P6.5 extension: `splits` maps a parent unitId to its two children (`[{unitId, weight}, {unitId,
 * weight}]`, §6.4 ids `${unitId}.0` / `${unitId}.1`, weights partitioning the parent's). When a parent
 * has no entry, a splittable unit (`splittable !== false`, `weight >= 2`) is auto-halved
 * (`Math.ceil(weight/2)` / `Math.floor(weight/2)`) so a capacity-always executor can drive nested
 * splits to the ledger's real caps without every test having to spell out every generation's weights.
 * `preExhaustLedger` pre-spends the run's discretionary ledger budget down to 1 remaining record on the
 * FIRST split attempt (after planning's own `reserveUnitSlots()` already succeeded), so that exact
 * split is refused on the ledger-records cap rather than the unit-records one (support/runFixture.mjs's
 * `limits: {maxLedgerRecords: 'exhausted'}` sentinel).
 */
function defaultChildrenOf(unit) {
  const half = Math.floor(unit.weight / 2);
  return [
    { unitId: `${unit.unitId}.0`, weight: unit.weight - half },
    { unitId: `${unit.unitId}.1`, weight: half },
  ];
}

/** P3's per-model plan record shape (`rootResolution.js` step 9) for every model the definition
 *  names, with no enumeration evidence: `{scopeKinds: {A, B}, scopeDigests: {population: null,
 *  roots: []}, rootOwners: []}` (whole-branch review C1). */
function fakeModelsOf(definition) {
  const models = new Map();
  const kindsOf = (modelKey) => models.get(modelKey) ?? { scopeKinds: { A: null, B: null },
    scopeDigests: { population: null, roots: [] }, rootOwners: [] };
  for (const [role, selection] of [['A', definition.selectionA], ['B', definition.selectionB]]) {
    for (const entry of selection.entries) {
      const record = kindsOf(entry.modelKey);
      record.scopeKinds[role] = entry.kind;
      models.set(entry.modelKey, record);
    }
  }
  return models;
}

const REASON_BY_CAP_DETAIL =Object.freeze({ 'unit-records': 'unit-cap', 'ledger-records': 'ledger-cap' });

export function createFakePlannerPort({
  plan, planningGaps = null, stallAt = null, onPlanRun = () => {},
  yieldToScheduler = async () => {}, splits = {}, preExhaustLedger = false,
} = {}) {
  const calls = { planRun: 0, materializeUnit: 0, splitUnit: 0 };
  let capturedLedger = null;                               // set by planRun; splitUnit reaches the
  let ledgerPreExhausted = false;                           // SAME ledger the same way the real planner does

  async function planRun({ definition, checkpoint, ledger }) {
    calls.planRun += 1;
    capturedLedger = ledger;
    onPlanRun();                                           // the fixture's reached('enumerating')
    if (stallAt === 'enumerating') {
      // A cooperative enumeration that never finishes on its own: only a cancel (the checkpoint
      // throwing) ends it. Bounded so a broken cancel path fails the test instead of spinning forever.
      for (let i = 0; i < 1_000_000; i += 1) {
        await checkpoint('fake:stall');
        await yieldToScheduler();
      }
      throw new Error('fakePlanner: stallAt loop was never cancelled');
    }
    await checkpoint('fake:plan');
    if (planningGaps !== null || plan === null || plan === undefined) {
      const gaps = planningGaps ?? [{ phase: 'enumerating', cause: 'enumeration-failed' }];
      for (const g of gaps) ledger.recordPlanningGap({ phase: g.phase, cause: g.cause });
      return { status: 'failed', plan: null, ledger, planningGaps: gaps.map((g) => ({ ...g })), preTerminalGapWeight: 0 };
    }
    ledger.recordPlanning({ planExists: true });
    const records = [
      ...plan.units.map((u) => ({ u, gap: null })),
      ...plan.gaps.map((g) => ({ u: g, gap: g.cause })),
    ].sort((a, b) => comparePaths(a.u.unitId, b.u.unitId));
    for (const { u, gap } of records) {
      if (gap === null) ledger.recordUnit(ledgerFieldsOf(u));
      else ledger.recordGap(u.unitId, { ...ledgerFieldsOf(u), cause: gap });
    }
    if (!ledger.budget.reserveUnitSlots()) throw new Error('fakePlanner: the overflow reserve does not fit');
    await checkpoint('fake:built');
    // P6 whole-branch review C1: P3's real `Plan.models` carries one record per definition model,
    // and P6 now projects its `scopeKinds` / `scopeDigests` / `rootOwners` into provenance. A fake
    // plan that does not supply its own `models` gets P3's record SHAPE derived from the definition
    // it was handed: the selection kinds per role, and empty plan-time scope evidence (this fake
    // never enumerates, so it has no digests and no root owners to report).
    const planned = plan.models !== undefined ? plan : { ...plan, models: fakeModelsOf(definition) };
    return { status: 'planned', plan: planned, ledger, planningGaps: [], preTerminalGapWeight: plan.preTerminalGapWeight };
  }

  return {
    calls,
    planRun,
    materializeUnit(plannedPlan, unit) {
      calls.materializeUnit += 1;
      return materializeUnitOf(plannedPlan, unit);
    },
    /** A8/N17: `(plan, unit) -> {children: [WorkUnit, WorkUnit]} | {reason: 'unsplittable'|'unit-cap'|
     *  'ledger-cap', capDetail?}`. Admission goes through THE run's ledger (R8, review C5), captured
     *  from `planRun`'s own argument — never a `run.plan.units.length` guard, which never changes as
     *  runtime children are created. */
    splitUnit(_plan, unit) {
      calls.splitUnit += 1;
      if (unit.splittable === false) return { reason: 'unsplittable' };
      const explicit = splits[unit.unitId];
      const spec = explicit ?? (unit.weight >= 2 ? defaultChildrenOf(unit) : null);
      if (spec === null) return { reason: 'unsplittable' };
      if (preExhaustLedger && !ledgerPreExhausted) {
        ledgerPreExhausted = true;
        const remaining = capturedLedger.budget.discretionaryRemaining;
        if (remaining > 1) capturedLedger.budget.admitRuntime('unit-taint', remaining - 1, null);
      }
      const children = spec.map((c) => workUnitOf({ ...unit, unitId: c.unitId, weight: c.weight }));
      const ledgerChildren = children.map((c) => ({
        unitId: c.unitId, sourceModelKey: c.sourceModelKey, sourceRootDbIds: [],
        targets: c.targets.map((t) => ({ modelKey: t.modelKey, scope: 'model' })),
        pairSpaceWeight: c.pairSpaceWeight, ranges: 0,
      }));
      const result = capturedLedger.tryRecordSplit(unit.unitId, ledgerChildren);
      if (result.ok !== true) return { reason: REASON_BY_CAP_DETAIL[result.capDetail], capDetail: result.capDetail };
      return { children };
    },
    rootsForRanges() { return []; },
    createRecordBudget,
    createLedger,
    checkScopeBracket: null,
  };
}
