// clashpanel/core/grouping.js
//
// Spec §10.2: a Core-facet grouping (Element, Model Pair — see groupModes.js) is ONE Core call —
// engine.derivations.groupBy(set, [facet], {signal}) — per (generation, mode), through the single-flight
// derivation queue (Task 7), cached as a table. Everything after it (filter intersection, n-of-m counts, re-sorting) is Panel-side
// presentation. The `element` facet is multi-valued: a clash is listed under BOTH of its elements,
// so group counts do not sum to the result count. GroupingTooLargeError / DerivationBusyError (after
// the queue's bounded retries) / any other error ⇒ "grouping unavailable, showing the flat list".

export const GROUPING_UNAVAILABLE_TEXT = Object.freeze({
  'too-large': 'Grouping unavailable for a set this large — showing the flat list.',
  error: 'Grouping is unavailable right now — showing the flat list.',
});
export const MULTI_VALUED_NOTE = 'Each clash is listed under both of its elements, so group counts do not add up to the number of clashes.';

/**
 * ONE Core groupBy over a single built-in facet (the shared compute of the Core-facet group modes, groupModes.js).
 * `isValue` guards the facet value shape: a malformed group value makes the whole grouping 'unavailable' (never a
 * partial or mislabelled grouping). The group's Core groupId (canonical JSON of [facetId, params, value]) is the
 * stable, display-independent group key.
 */
export async function computeFacetGroups({ queue, engine, resultSet, facet, isValue = () => true, priority = 3 }) {
  const outcome = await queue.submit({
    key: `groupBy:${facet}:${resultSet.runId}`,
    priority,
    job: (signal) => engine.derivations.groupBy(resultSet, [facet], { signal }),
  });
  if (outcome.status === 'superseded') return { status: 'superseded' };
  if (outcome.status !== 'ok') {
    return { status: 'unavailable', reason: outcome.error?.name === 'GroupingTooLargeError' ? 'too-large' : 'error' };
  }
  const raw = outcome.value;
  if (!raw || !Array.isArray(raw.groups) || (Array.isArray(raw.unavailable) && raw.unavailable.length > 0)
    || !raw.groups.every((g) => typeof g?.groupId === 'string' && Array.isArray(g.members) && isValue(g.value))) {
    return { status: 'unavailable', reason: 'error' };
  }
  const groups = raw.groups.map((g) => Object.freeze({
    groupId: g.groupId, ref: g.value, count: g.count, memberIds: g.members,   // Core arrays referenced, not copied
  }));
  return { status: 'ok', table: Object.freeze({ groups: Object.freeze(groups), memberships: raw.memberships, total: raw.total }) };
}

/** Group by Element (spec §10.2): the multi-valued `element` facet. Kept as the named entry point of the Element mode. */
export function computeElementGroups({ queue, engine, resultSet, priority = 3 }) {
  return computeFacetGroups({ queue, engine, resultSet, facet: 'element', priority });
}

/** Result-id set of a filter pass (the mask intersected with group members). */
export function matchIdsFrom(matching, index) {
  const ids = new Set();
  for (let k = 0; k < matching.length; k += 1) ids.add(index.at(matching[k]).resultId);
  return ids;
}

/** `matchIds` null = no filter active. Groups whose filtered count is 0 are dropped only then. */
export function filterGroups(table, { matchIds = null, index }) {
  const out = [];
  for (const g of table.groups) {
    const memberIndexes = [];
    for (const id of g.memberIds) {
      if (matchIds !== null && !matchIds.has(id)) continue;
      const i = index.indexOfResultId(id);
      if (i >= 0) memberIndexes.push(i);
    }
    // No sort: Core pushes members while walking results[] in canonical order (derive/groupBy.js `place`),
    // so memberIndexes is already ascending (pinned against the real groupBy in the test).
    if (matchIds !== null && memberIndexes.length === 0) continue;
    out.push(Object.freeze({ groupId: g.groupId, ref: g.ref, count: g.count, filteredCount: memberIndexes.length, memberIndexes }));
  }
  return out;
}

/** 'core' keeps Core order (the facet's identity order); 'count-desc' by filtered count; 'label' by labelOf(ref).
 *  Stable: ties keep Core order. Returns a new array. */
export function sortGroups(groups, sortKey, labelOf = () => '') {
  const withPos = groups.map((g, pos) => ({ g, pos }));
  if (sortKey === 'count-desc') withPos.sort((a, b) => (b.g.filteredCount - a.g.filteredCount) || (a.pos - b.pos));
  else if (sortKey === 'label') {
    const labels = withPos.map(({ g }) => String(labelOf(g.ref)).toLowerCase());
    withPos.sort((a, b) => (labels[a.pos] < labels[b.pos] ? -1 : labels[a.pos] > labels[b.pos] ? 1 : a.pos - b.pos));
  }
  return withPos.map(({ g }) => g);
}

/** Header count text "n of m" (filtered of total). */
export function groupCountText(group) {
  return group.filteredCount === group.count ? `${group.count}` : `${group.filteredCount} of ${group.count}`;
}
