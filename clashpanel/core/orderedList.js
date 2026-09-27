// clashpanel/core/orderedList.js
//
// Spec §10.3, §12.1-§12.3: one immutable ORDERED INDEX per (filter, sort, grouping, expansion)
// state — typed arrays only (O(n) memory, no per-record objects); entries are materialized on
// demand for the one rendered page. Flat view = canonical indexes (default = Core order; gap-asc =
// a stable permutation by evidence.distance, Soft only, ties by canonical index). Grouped view =
// [group header, its members if expanded, …]. Selection identity for the list is the OCCURRENCE
// {groupId, resultId} (§12.2): positions/pages are computed from THAT occurrence, never from the
// first occurrence of the resultId. Prev/Next never wrap; a selection outside the list steps to
// the first (Next) or last (Prev) result entry.

const KIND_RESULT = 0;
const KIND_GROUP = 1;

/** Stable gap-ascending permutation of `canon` (canonical indexes); non-clearance records last. */
function gapSorted(canon, index) {
  const m = canon.length;
  const pos = new Uint32Array(m);
  const dist = new Float64Array(m);
  for (let k = 0; k < m; k += 1) {
    pos[k] = k;
    const d = index.at(canon[k])?.evidence?.distance;
    dist[k] = Number.isFinite(d) ? d : Number.POSITIVE_INFINITY;
  }
  // A comparison sort (O(n log n)), synchronous and one-shot per user action (not sliced); its duration on a
  // large set is a PG-3 measurement item — no "never blocks" claim. The canonical-index tie-break makes it stable.
  pos.sort((a, b) => (dist[a] - dist[b]) || (canon[a] - canon[b]));
  const out = new Uint32Array(m);
  for (let k = 0; k < m; k += 1) out[k] = canon[pos[k]];
  return out;
}

function orderMembers(memberIndexes, index, sortKey) {
  const canon = Uint32Array.from(memberIndexes);
  return sortKey === 'gap-asc' && index.isSoft ? gapSorted(canon, index) : canon;
}

export function buildOrderedIndex({ view, matching, index, sortKey = 'default', groups = [], expanded = new Set() }) {
  const gapSort = sortKey === 'gap-asc' && index.isSoft === true;
  if (view !== 'grouped') return buildFlat(gapSort ? gapSorted(matching, index) : matching, index);
  return buildGrouped(groups, expanded, index, sortKey);
}

function buildFlat(order, index) {
  const length = order.length;
  let inverse = null;                                         // canonical -> position, built lazily once
  const positionOfCanonical = (c) => {
    if (inverse === null) {
      inverse = new Int32Array(index.count).fill(-1);
      for (let p = 0; p < length; p += 1) inverse[order[p]] = p;
    }
    return c >= 0 && c < inverse.length ? inverse[c] : -1;
  };
  const occurrenceAt = (p) => ({ groupId: null, resultId: index.at(order[p]).resultId });
  const positionOf = (occ) => (occ ? positionOfCanonical(index.indexOfResultId(occ.resultId)) : -1);
  return Object.freeze({
    view: 'flat',
    length,
    resultCount: length,
    storage: Object.freeze({ kinds: null, canonical: order, groupOrdinals: null }),
    entryAt(i) { return i >= 0 && i < length ? { kind: 'result', canonicalIndex: order[i], groupId: null } : undefined; },
    positionOf,
    navNeighbor(occ, dir) {
      if (length === 0) return null;
      const p = positionOf(occ);
      if (p === -1) return occurrenceAt(dir > 0 ? 0 : length - 1);
      const q = p + (dir > 0 ? 1 : -1);
      return q >= 0 && q < length ? occurrenceAt(q) : null;
    },
  });
}

function buildGrouped(groups, expanded, index, sortKey) {
  const memberOrders = groups.map((g) => orderMembers(g.memberIndexes, index, sortKey));
  let length = groups.length;
  for (let gi = 0; gi < groups.length; gi += 1) if (expanded.has(groups[gi].groupId)) length += memberOrders[gi].length;
  const kinds = new Uint8Array(length);
  const canonical = new Uint32Array(length);
  const groupOrdinals = new Uint32Array(length);
  const headerPos = new Map();                                 // groupId -> header position (O(groups))
  const ordinalOf = new Map();
  let p = 0;
  let resultCount = 0;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi];
    headerPos.set(g.groupId, p);
    ordinalOf.set(g.groupId, gi);
    kinds[p] = KIND_GROUP; groupOrdinals[p] = gi; p += 1;
    if (!expanded.has(g.groupId)) continue;
    const members = memberOrders[gi];
    for (let k = 0; k < members.length; k += 1) {
      kinds[p] = KIND_RESULT; canonical[p] = members[k]; groupOrdinals[p] = gi; p += 1; resultCount += 1;
    }
  }
  const occurrenceAt = (q) => ({ groupId: groups[groupOrdinals[q]].groupId, resultId: index.at(canonical[q]).resultId });
  function positionOf(occ) {
    if (!occ) return -1;
    const c = index.indexOfResultId(occ.resultId);
    if (c < 0) return -1;
    if (occ.groupId === null || occ.groupId === undefined) {  // selected in the flat view: first rendered occurrence
      for (let q = 0; q < length; q += 1) if (kinds[q] === KIND_RESULT && canonical[q] === c) return q;
      return -1;
    }
    const h = headerPos.get(occ.groupId);
    if (h === undefined || !expanded.has(occ.groupId)) return -1;
    const n = memberOrders[ordinalOf.get(occ.groupId)].length;
    for (let q = h + 1; q <= h + n; q += 1) if (canonical[q] === c) return q;
    return -1;
  }
  function navNeighbor(occ, dir, navScope = null) {
    const step = dir > 0 ? 1 : -1;
    // Prev/Next inside the group the user is reading — ONLY while that group is expanded (rendered); a
    // collapsed/unknown scope falls back to the whole list so the result is always a rendered occurrence.
    if (navScope !== null && ordinalOf.has(navScope) && expanded.has(navScope)) {
      const members = memberOrders[ordinalOf.get(navScope)];
      if (members.length === 0) return null;
      const c = occ ? index.indexOfResultId(occ.resultId) : -1;
      let k = -1;
      for (let j = 0; j < members.length; j += 1) if (members[j] === c) { k = j; break; }
      const at = (j) => ({ groupId: navScope, resultId: index.at(members[j]).resultId });
      if (k === -1) return at(step > 0 ? 0 : members.length - 1);
      const j = k + step;
      return j >= 0 && j < members.length ? at(j) : null;
    }
    const p0 = positionOf(occ);
    if (p0 === -1) {                                           // not in the list: first / last result entry
      for (let q = step > 0 ? 0 : length - 1; q >= 0 && q < length; q += step) if (kinds[q] === KIND_RESULT) return occurrenceAt(q);
      return null;
    }
    for (let q = p0 + step; q >= 0 && q < length; q += step) if (kinds[q] === KIND_RESULT) return occurrenceAt(q);
    return null;                                               // no wrap
  }
  return Object.freeze({
    view: 'grouped',
    length,
    resultCount,
    storage: Object.freeze({ kinds, canonical, groupOrdinals }),
    entryAt(i) {
      if (!(i >= 0 && i < length)) return undefined;
      const groupId = groups[groupOrdinals[i]].groupId;
      return kinds[i] === KIND_GROUP ? { kind: 'group', groupId } : { kind: 'result', canonicalIndex: canonical[i], groupId };
    },
    positionOf,
    navNeighbor,
  });
}

export function clampPage(page, length, pageSize) {
  const count = Math.max(1, Math.ceil(length / pageSize));
  if (!Number.isFinite(page)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(page)));
}

export function pageOfPosition(position, pageSize) {
  return position >= 0 ? Math.floor(position / pageSize) : -1;   // -1: not in the list ⇒ the page does not jump
}

export function pageSlice(ordered, page, pageSize) {
  const p = clampPage(page, ordered.length, pageSize);
  const out = [];
  for (let i = p * pageSize, end = Math.min(ordered.length, (p + 1) * pageSize); i < end; i += 1) out.push(ordered.entryAt(i));
  return out;
}
