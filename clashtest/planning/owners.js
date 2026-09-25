// clashtest/planning/owners.js
//
// Owner classes of spec 6.2 (H1) and the owner -> root map of spec 5.6.4 (Task P3.4). The classification is a pure
// function of RECORDED PLAN DATA: it is identical for both role assignments of a pair and never depends on which unit
// produced a result, so it cannot be bypassed by a whole-model source or target choice.

/**
 * root-only        the owner is reachable from some root's subtree only;
 * unreachable-only the owner's fragments are only in the tree-unreachable population (no root reaches it);
 * mixed            both (some fragments under a root, some unreachable).
 */
export const OWNER_CLASS = Object.freeze({
  ROOT_ONLY: 'root-only',
  UNREACHABLE_ONLY: 'unreachable-only',
  MIXED: 'mixed',
});

const numeric = (a, b) => a - b;

/**
 * Pure classification. Inputs may arrive in any order (and with repeats); they are copied, never sorted in place.
 * @returns {{mixedOwnerDbIds: number[], unreachableOnlyDbIds: number[]}} both ascending
 */
export function classifyOwners({ rootOwnerDbIds, unreachableOwnerDbIds }) {
  const roots = [...rootOwnerDbIds].sort(numeric);
  const unreachable = [...unreachableOwnerDbIds].sort(numeric);
  const mixed = [];
  const unreachableOnly = [];
  let i = 0;
  for (let j = 0; j < unreachable.length; j++) {
    const u = unreachable[j];
    if (j > 0 && u === unreachable[j - 1]) continue;   // a repeated id is the same owner
    while (i < roots.length && roots[i] < u) i++;
    if (i < roots.length && roots[i] === u) mixed.push(u);
    else unreachableOnly.push(u);
  }
  return { mixedOwnerDbIds: mixed, unreachableOnlyDbIds: unreachableOnly };
}

// `plan.models` is a Map (the planner's own); the P6 alias `modelsByKey` is read as an own-property object as well.
function modelEntry(plan, modelKey) {
  const models = plan.models;
  if (models instanceof Map) return models.get(modelKey);
  return models !== null && typeof models === 'object' && Object.hasOwn(models, modelKey) ? models[modelKey] : undefined;
}

// Lazy per-array membership sets: correctness must not depend on the recorded list happening to be sorted.
const unreachableSets = new WeakMap();
function unreachableSetOf(ownerDbIds) {
  let set = unreachableSets.get(ownerDbIds);
  if (set === undefined) {
    set = new Set(ownerDbIds);
    unreachableSets.set(ownerDbIds, set);
  }
  return set;
}

/**
 * The owner class of one fragment owner of one model, from the plan's recorded root owners and recorded
 * unreachable-population owners. `'unknown'` = the plan records no such owner for that model (an owner no unit may
 * legally report on).
 * @returns {'root-only'|'unreachable-only'|'mixed'|'unknown'}
 */
export function ownerClassOf(plan, modelKey, dbId) {
  const underRoot = plan.ownerRootByModel.get(modelKey)?.has(dbId) === true;
  const unreachableOwners = modelEntry(plan, modelKey)?.unreachable?.ownerDbIds;
  const unreachable = unreachableOwners !== undefined && unreachableSetOf(unreachableOwners).has(dbId);
  if (underRoot) return unreachable ? OWNER_CLASS.MIXED : OWNER_CLASS.ROOT_ONLY;
  return unreachable ? OWNER_CLASS.UNREACHABLE_ONLY : 'unknown';
}

/** The `rootOwners` map of spec 5.6.4: the root dbId whose subtree the owner sits under, or null. */
export function rootOfOwner(plan, modelKey, dbId) {
  return plan.ownerRootByModel.get(modelKey)?.get(dbId) ?? null;
}
