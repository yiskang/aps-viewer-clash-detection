// clashtest/planning/decompose.js
//
// The three-cell decomposition of spec 6.3 (Task P3.6): the required pair space P = {(x in A, y in B), x != y} covered
// EXACTLY ONCE by cells whose source and target root sets are disjoint by construction, so a source subtree walk never
// contains a target fragment and the library's fragment-membership self-exclusion (F2) never suppresses a required
// pair. For each model m: A'_m = A_m \ B_m, C_m = A_m n B_m, B'_m = B_m \ A_m (the class tables of planTables.js).
//
//   cell 1   A'_m  ->  B_n  for every model n
//   cell 2   C_m   ->  B'_n for every model n
//   cell 3a  C_m   ->  C_n  for each model pair m < n (both orientations when ordered)
//   cell 3b  C_m   ->  C_m  by recursive bisection (both directions at each node when ordered)
//
// Everything here is a RANGE into the run's root tables (spec 6.5: no copied dbId arrays, no Model objects), and the
// output is a pure function of the class tables in canonical order: model keys ascending by code unit, cells in the
// order 1, 2, 3a, 3b. Sizing (P3.7) then packs and slices these cell specs into WorkUnits.
//
// CellSpec = { cell: '1'|'2'|'3a'|'3b', sourceModelKey, sourceRanges: Range[],
//              targets: Array<{ modelKey, scope: 'whole' | { ranges: Range[] } }>,
//              orientationRole: 'A->B' | 'B->A' | 'canonical' }        Range = { table, start, end } (half-open)

import { bisectRanges, rangeRootCount } from './planTables.js';

/** The cell ids, in canonical emission order. */
export const CELL_IDS = Object.freeze(['1', '2', '3a', '3b']);

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Roots a model holds in the source role (A_n = A'_n u C_n). Read from the class tables, the one source of truth.
const sourceRootCount = (model) => (model.classes["A'"]?.length ?? 0) + (model.classes.C?.length ?? 0);

/**
 * Spec 6.3 cell-2 note, generalized to cell 1 (register S-P3-2, erratum A3; D3): a model may be named by the
 * whole-model sentinel as a TARGET only when its selection B is `kind:'model'` AND it carries no source-role root
 * (A_n is empty). That is the only condition under which the sentinel's population is exactly B_n and contains no
 * source-role root, so it can neither re-introduce a non-required same-model pair nor shadow a required one.
 * Otherwise the target is an explicit list of ranges, so a source root of n can never sit in n's own target set.
 */
export function targetScopeFor(model, ranges) {
  return model.wholeB === true && sourceRootCount(model) === 0 ? 'whole' : { ranges };
}

/**
 * @param {object} args
 * @param {Map<string, {classes: object, wholeB: boolean}>} args.models  per-model entries of resolveSelectionRoots
 * @param {{rangeOfClass: (modelKey: string, cls: string) => object | null}} args.plan  buildRootTables' result
 * @param {boolean} args.ordered  containment: ordered pairs, so cells 3a/3b run both orientations
 * @returns {object[]} CellSpec[] in canonical order
 */
export function decomposeCells({ models, plan, ordered }) {
  const keys = [...models.keys()].sort(byCodeUnit);              // code-unit order, spec 5.3 normalization
  const cells = [];
  const rangeOf = (modelKey, cls) => plan.rangeOfClass(modelKey, cls);   // null when the class is empty

  // The target entries of one cell: per model n (ascending), the given classes' ranges, or nothing when all are empty.
  const targetsOf = (classes) => keys.flatMap((nk) => {
    const ranges = classes.map((cls) => rangeOf(nk, cls)).filter(Boolean);
    return ranges.length === 0 ? [] : [{ modelKey: nk, scope: targetScopeFor(models.get(nk), ranges) }];
  });

  // Cell 1: A'_m -> B_n (= C_n u B'_n) for every n.
  for (const mk of keys) {
    const source = rangeOf(mk, "A'");
    if (!source) continue;
    const targets = targetsOf(['C', "B'"]);
    if (targets.length > 0) cells.push({ cell: '1', sourceModelKey: mk, sourceRanges: [source], targets, orientationRole: 'A->B' });
  }
  // Cell 2: C_m -> B'_n for every n.
  for (const mk of keys) {
    const source = rangeOf(mk, 'C');
    if (!source) continue;
    const targets = targetsOf(["B'"]);
    if (targets.length > 0) cells.push({ cell: '2', sourceModelKey: mk, sourceRanges: [source], targets, orientationRole: 'A->B' });
  }
  // Cell 3a: C_m -> C_n, one unordered model pair (m < n); both orientations when ordered.
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rangeOf(keys[i], 'C');
      const b = rangeOf(keys[j], 'C');
      if (!a || !b) continue;
      cells.push({ cell: '3a', sourceModelKey: keys[i], sourceRanges: [a], targets: [{ modelKey: keys[j], scope: { ranges: [b] } }],
        orientationRole: ordered ? 'A->B' : 'canonical' });
      if (ordered) {
        cells.push({ cell: '3a', sourceModelKey: keys[j], sourceRanges: [b], targets: [{ modelKey: keys[i], scope: { ranges: [a] } }],
          orientationRole: 'B->A' });
      }
    }
  }
  // Cell 3b: recursive bisection of C_m against itself. The recursion depth is log2 |C_m| (bisectRanges halves by root
  // count), so it needs no explicit stack.
  for (const mk of keys) {
    const c = rangeOf(mk, 'C');
    if (!c) continue;
    const bisect = (ranges) => {
      if (ranges.reduce((n, r) => n + rangeRootCount(r), 0) <= 1) return;
      const [left, right] = bisectRanges(plan, ranges);
      cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: left, targets: [{ modelKey: mk, scope: { ranges: right } }],
        orientationRole: ordered ? 'A->B' : 'canonical' });
      if (ordered) {
        cells.push({ cell: '3b', sourceModelKey: mk, sourceRanges: right, targets: [{ modelKey: mk, scope: { ranges: left } }],
          orientationRole: 'B->A' });
      }
      bisect(left);
      bisect(right);
    };
    bisect([c]);
  }
  return cells;
}
