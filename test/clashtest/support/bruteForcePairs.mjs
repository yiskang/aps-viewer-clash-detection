// test/clashtest/support/bruteForcePairs.mjs
//
// The brute-force reference of the P3 property suite (Task P3.9). `requiredPairSpace` builds the required pair space
// P of spec 6.1 straight from the DEFINITION and the MODEL SPECS -- with no plan table, no decomposition and no
// planner code involved -- and `expandUnitPairs` / `expandRecordPairs` expand what the planner produced (a WorkUnit, or
// a ledger leaf record) into the same key space, so "the plan covers P exactly once" is a plain set/multiset comparison.
//
// Elements are ROOTS of the run-start instance tree (a whole-model selection is every root of the model; an explicit
// list names roots), the unit the planner works in. The tree-unreachable population is deliberately OUTSIDE P (spec 6.2,
// the `not-required` class), so neither side ever expands it.
//
// Pair keys:
//   ordered (containment)   `${modelKey}#${dbId}>${modelKey}#${dbId}`: the library call's (source, target), i.e. x in A first
//   unordered               the same two refs joined by `|`, in ascending (modelKey, dbId) order

import { materializeUnit } from '../../../clashtest/planning/planner.js';

const refKey = (modelKey, dbId) => `${modelKey}#${dbId}`;
const compareRefs = (a, b) => (a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : a.dbId - b.dbId);

/** One pair in the key space. `first`/`second` are `{modelKey, dbId}`; for ordered semantics `first` is the A-role member. */
export function pairKey(first, second, ordered) {
  if (ordered) return `${refKey(first.modelKey, first.dbId)}>${refKey(second.modelKey, second.dbId)}`;
  const [lo, hi] = compareRefs(first, second) <= 0 ? [first, second] : [second, first];
  return `${refKey(lo.modelKey, lo.dbId)}|${refKey(hi.modelKey, hi.dbId)}`;
}

/** The roots a NORMALIZED selection names, as `{modelKey, dbId}` refs, straight from the model specs. */
function selectionRoots(selection, models) {
  const out = [];
  for (const entry of selection.entries) {
    const spec = models.find((m) => m.modelKey === entry.modelKey);
    if (!spec) throw new Error(`bruteForce: no model spec for ${entry.modelKey}`);
    const ids = entry.kind === 'model' ? spec.roots.map((r) => r.dbId) : entry.dbIds;
    for (const dbId of ids) out.push({ modelKey: entry.modelKey, dbId });
  }
  return out;
}

/**
 * P = { (x in A, y in B) : x != y } (spec 6.1), as a Set of pair keys (unordered semantics fold (x,y) and (y,x)).
 * @param {{definition: object, models: object[], ordered: boolean}} args
 * @returns {Promise<Set<string>>}
 */
export async function requiredPairSpace({ definition, models, ordered }) {
  const rootsA = selectionRoots(definition.selectionA, models);
  const rootsB = selectionRoots(definition.selectionB, models);
  const out = new Set();
  for (const x of rootsA) {
    for (const y of rootsB) {
      if (x.modelKey === y.modelKey && x.dbId === y.dbId) continue;
      out.add(pairKey(x, y, ordered));
    }
  }
  return out;
}

// An ordered (containment) pair is the library CALL's (source, target): a `B->A` unit is the reversed call of the same two
// root sets (cells 3a / 3b run both directions), so it covers the reversed ordered pairs, not the same ones twice.
function expand(sourceModelKey, sourceIds, targets, ordered) {
  const out = [];
  for (const s of sourceIds) {
    for (const t of targets) {
      for (const y of t.dbIds) {
        const source = { modelKey: sourceModelKey, dbId: s };
        const target = { modelKey: t.modelKey, dbId: y };
        // NOT filtered for x == y: a plan that ever pairs a root with itself must show up as a set mismatch.
        out.push(pairKey(source, target, ordered));
      }
    }
  }
  return out;
}

/** The run-start root dbIds of one model (what a whole-model target stands for), from the plan's per-model digest list. */
function wholeRootsOf(plan, modelKey) {
  const entry = plan.models instanceof Map ? plan.models.get(modelKey) : plan.models[modelKey];
  return entry.scopeDigests.roots.map((r) => r.dbId);
}

/**
 * Every pair key one unit covers, expanded THROUGH the planner's own `materializeUnit` (so a whole-model target expands
 * to that model's run-start roots). Returns an array with repeats preserved, so a double cover is visible.
 */
export function expandUnitPairs(plan, unit, ordered) {
  const m = materializeUnit(plan, unit);
  const targets = m.targets.map((t) => ({ modelKey: t.modelKey, dbIds: t.scope === 'whole' ? wholeRootsOf(plan, t.modelKey) : t.dbIds }));
  return expand(unit.sourceModelKey, m.sourceDbIds, targets, ordered);
}

/**
 * Every pair key one persisted ledger LEAF record covers (a planned unit or a pre-planned `target-too-large` gap),
 * expanded from the record alone (`sourceRootDbIds`, `targets`) plus the plan's whole-model root lists.
 */
export function expandRecordPairs(plan, record, ordered) {
  const targets = record.targets.map((t) => ({
    modelKey: t.modelKey, dbIds: t.scope === 'model' ? wholeRootsOf(plan, t.modelKey) : t.rootDbIds,
  }));
  return expand(record.sourceModelKey, record.sourceRootDbIds, targets, ordered);
}
