// clashtest/planning/splitting.js
//
// Deterministic capacity splitting (spec 6.4, Task P3.8) and controller ruling R8: `planSplit` is the ONE live
// split-admission point. It computes the spec 6.4 cut and then decides, atomically, whether the split fits -- unit
// records against `maxUnitsPerRun` (counted over the run's LIVE population, so every child of every earlier runtime
// split counts) and ledger records against `maxLedgerRecords` -- admitting both children or neither. The refusal is
// always a TRUTHY object carrying `.reason`; callers branch on `.reason`, never on null/truthiness (register N17).
//
// The cut order is kind-independent (the capacity kind is not an input; P6 records it on the unit record):
//   1. more than one source root  -> bisect the sources (ascending, floor(n/2) to the left, both children keep the targets)
//   2. else more than one target entry -> partition the entries by ascending modelKey, floor(n/2) to the left
//   3. else one explicit target entry with more than one root -> bisect its root list
//   4. else (one source root vs one root, or vs a whole-model sentinel) -> unsplittable
// Every cut is by `bisectRanges` or an entry boundary, so no root is ever split, the children's weights partition the
// parent's exactly, and every root pair still lands in exactly one unit.

import { bisectRanges } from './planTables.js';
import { pairSpaceWeightOf, sourceRootCount, targetEntryRootCount, targetWeightOf, unitRecordFields } from './sizing.js';

/** The closed refusal vocabulary of R8. `unit-cap` is also a spec 16.7 settlement fact, so P6 maps a refusal onto it. */
export const SPLIT_REFUSAL_REASONS = Object.freeze(['unsplittable', 'unit-cap', 'ledger-cap']);

const copyRange = (r) => ({ table: r.table, start: r.start, end: r.end });
const copyTarget = (t) => ({ modelKey: t.modelKey, scope: t.scope === 'whole' ? 'whole' : { ranges: t.scope.ranges.map(copyRange) } });

// A child WorkUnit: the parent's identity fields, the patched side, and weights recomputed from the tables.
function child(plan, parent, i, patch) {
  const c = {
    unitId: `${parent.unitId}.${i}`,
    cell: parent.cell,
    sourceModelKey: parent.sourceModelKey,
    sourceRanges: (patch.sourceRanges ?? parent.sourceRanges).map(copyRange),
    targets: (patch.targets ?? parent.targets).map(copyTarget),
    orientationRole: parent.orientationRole,
  };
  c.pairSpaceWeight = pairSpaceWeightOf(plan, c.sourceRanges, c.targets);
  c.targetWeight = targetWeightOf(plan, c.targets);
  return c;
}

/**
 * The spec 6.4 order, pure (no admission). Returns the two children, or null when the unit is fundamentally unsplittable.
 * @returns {[object, object] | null}
 */
export function cutUnit(plan, unit) {
  if (sourceRootCount(unit.sourceRanges) > 1) {
    const [left, right] = bisectRanges(plan, unit.sourceRanges);
    return [child(plan, unit, 0, { sourceRanges: left }), child(plan, unit, 1, { sourceRanges: right })];
  }
  if (unit.targets.length > 1) {                       // ascending modelKey already
    const half = Math.floor(unit.targets.length / 2);
    return [child(plan, unit, 0, { targets: unit.targets.slice(0, half) }), child(plan, unit, 1, { targets: unit.targets.slice(half) })];
  }
  const only = unit.targets[0];
  if (only !== undefined && only.scope !== 'whole' && targetEntryRootCount(plan, only) > 1) {
    const [left, right] = bisectRanges(plan, only.scope.ranges);
    return [child(plan, unit, 0, { targets: [{ modelKey: only.modelKey, scope: { ranges: left } }] }),
      child(plan, unit, 1, { targets: [{ modelKey: only.modelKey, scope: { ranges: right } }] })];
  }
  return null;                                          // one source root vs one root / a whole sentinel
}

/**
 * R8: cut, then admit the cut atomically against maxUnitsPerRun and maxLedgerRecords through the run's live ledger
 * (`plan.ledger`, the one property createPlan's deep-freeze skips), or refuse and record nothing.
 * @returns {{children: [object, object]} | {reason: 'unsplittable'} | {reason: 'unit-cap', capDetail: 'unit-records'}
 *   | {reason: 'ledger-cap', capDetail: 'ledger-records'}}
 */
export function planSplit(plan, unit) {
  const children = cutUnit(plan, unit);
  if (children === null) return { reason: 'unsplittable' };
  // Internal invariant (spec 6.4 "the children's weights partition the parent's exactly"): each cut partitions one
  // factor of the product and leaves the other untouched.
  if (children[0].pairSpaceWeight + children[1].pairSpaceWeight !== unit.pairSpaceWeight) {
    throw new Error('internal-error: split weights do not partition the parent');
  }
  const ledger = plan.ledger;
  if (ledger === undefined || ledger === null || typeof ledger.tryRecordSplit !== 'function') {
    throw new TypeError('planSplit: plan.ledger (the run\'s live coverage ledger) is required to admit a split');
  }
  // The ledger counts the two children against its LIVE unit-record population and the block (2 + their range records)
  // against the RecordBudget, as one indivisible step: nothing partial can be written.
  const admitted = ledger.tryRecordSplit(unit.unitId, children.map((c) => unitRecordFields(plan, c)));
  if (admitted.ok) return { children };
  return admitted.capDetail === 'unit-records'
    ? { reason: 'unit-cap', capDetail: 'unit-records' }
    : { reason: 'ledger-cap', capDetail: 'ledger-records' };
}

/** P6's name for planSplit (register N15-N18). */
export const splitUnit = planSplit;
