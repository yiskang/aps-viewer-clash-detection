// test/clashtest/support/fakePlanner.mjs
//
// P6's minimal fake of P3's `Plan` shape (master plan "Consumed interfaces" table, A6:
// `Plan = { tables, tableById, ownersByModel, ownerRootByModel, models, selectionKindByRole,
// units, unitsById, pairSpaceTotal, planRecords, sizing }`).
//
// Task P6.3 only needs enough of that shape for `createRunFixture` to compute a `pairSpaceTotal`
// (sum of each unit's `weight`) and expose `units`/`unitsById` — it does NOT build the full P3
// shape (no tables, no scopeExpect, no preplanned gaps). Task P6.4 EXTENDS this file with the
// fuller shape (definition-lookup racing, `createFakeLedger`, etc.) per this directory's own
// extension rules (support/index.mjs): it never forks or recreates this file.
//
// Signature is forward-compatible on purpose: `(units, opts = {})` so a later task can pass more
// options without breaking callers that only pass `units` (extension rule 1).

export function createFakePlan(units, opts = {}) {
  const list = [...units];
  const unitsById = new Map(list.map((u) => [u.unitId, u]));
  const pairSpaceTotal = list.reduce((sum, u) => sum + (u.weight ?? 0), 0);
  return {
    // `opts` spreads FIRST so the three computed fields below always win: an opts.units/
    // opts.unitsById/opts.pairSpaceTotal that disagreed with the real computation would silently
    // mask a wiring bug in whichever later task passed it (codex-advisor review, P6.3). A later
    // task that genuinely needs an inconsistent/malformed fixture should add an explicitly-named
    // override option instead of relying on this spread to clobber a computed field.
    ...opts,
    units: list,
    unitsById,
    pairSpaceTotal,
  };
}
