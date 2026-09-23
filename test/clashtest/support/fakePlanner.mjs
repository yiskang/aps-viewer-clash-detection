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

export function createFakePlannerPort({
  plan, planningGaps = null, stallAt = null, onPlanRun = () => {},
  yieldToScheduler = async () => {},
} = {}) {
  const calls = { planRun: 0, materializeUnit: 0, splitUnit: 0 };

  async function planRun({ checkpoint, ledger }) {
    calls.planRun += 1;
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
    return { status: 'planned', plan, ledger, planningGaps: [], preTerminalGapWeight: plan.preTerminalGapWeight };
  }

  return {
    calls,
    planRun,
    materializeUnit(_plan, unit) {
      calls.materializeUnit += 1;
      return {
        sourceDbIds: [],
        targets: unit.targets.map((t) => ({ modelKey: t.modelKey, scope: 'whole' })),
        scopeExpect: [],
      };
    },
    // P6.5 extends this (`splits` option); until then every unit is indivisible.
    splitUnit() { calls.splitUnit += 1; return { reason: 'unsplittable' }; },
    rootsForRanges() { return []; },
    createRecordBudget,
    createLedger,
    checkScopeBracket: null,
  };
}
