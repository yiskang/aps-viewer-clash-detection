// clashpanel/core/propertyGrouping.js
//
// Pure, sliced group-table builders of the metadata group modes Category and Level (package brief §4–§6, §10). Both
// are SINGLE-valued: each clash lands in exactly one group, keyed by the UNORDERED pair of its two sides' raw metadata
// values. They produce the same table shape as the Core-facet modes (grouping.js computeFacetGroups), so filtering,
// sorting, navigation and expand/collapse are unchanged.
//
// Group identity (§6), owner-approved contract:
//   * a side's value is a RAW metadata string, or null = "missing" (the reserved sentinel: JSON null can never equal a
//     real string, so a real category literally named "Unknown category" stays a different group);
//   * key = the two values in code-point order (= UTF-8 byte order) with null last; the same value on both sides ⇒ a
//     single-element key ([v]); groupId = JSON.stringify([modeId, key]) — independent of any display text, and
//     mode-prefixed so ids of two modes never coincide (a group-scoped navigation never survives a mode switch);
//   * default group order = key order (element-wise compareIdentity, a single [v] ranking as [v, v]): known values
//     before missing ones; Sort "Group size" / "Group name" override it Panel-side (grouping.sortGroups);
//   * labels = display(value) per side joined by ' ↔ ' (single-element key ⇒ one label); missing ⇒ the mode's
//     unknown label. Two DISTINCT raw values whose display text coincides (e.g. 'Revit Walls' and 'Walls' both show
//     'Walls'), or a real value whose display text equals the unknown label, are disambiguated by appending the raw
//     text: 'Walls (Revit Walls)' / 'Walls (Walls)'. Labels never merge groups.
//   * members in canonical result order (results[] walked once, in LIST_CHUNK_SIZE slices with a yield between).
import { LIST_CHUNK_SIZE } from './constants.js';

export const UNKNOWN_CATEGORY_LABEL = 'Unknown category';
export const UNKNOWN_LEVEL_LABEL = 'Unknown Level';

/** Code-point order of two identity values (UTF-8 byte order); null (missing) after every string. */
export function compareIdentity(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The unordered identity key of a side pair: [v] when equal, else [lo, hi] in compareIdentity order. */
export function pairKey(a, b) {
  if (a === b) return [a];
  return compareIdentity(a, b) <= 0 ? [a, b] : [b, a];
}

const second = (k) => (k.length === 1 ? k[0] : k[1]);   // a single-value key [v] ranks as [v, v] (v may be null)
const compareKeys = (k1, k2) => compareIdentity(k1[0], k2[0]) || compareIdentity(second(k1), second(k2));

/** Category display text: a leading 'Revit ' stripped (display only — the key keeps the raw string). */
export function categoryDisplay(raw) {
  return raw.startsWith('Revit ') && raw.length > 'Revit '.length ? raw.slice('Revit '.length) : raw;
}

/**
 * The Level of one element by FIXED precedence (owner contract): (1) the '__internalref__' Level reference resolved to
 * the referenced Level element's name in the SAME model (`levelNamesOfModel`: Map<levelDbId, name>), (2) the
 * 'Constraints' Level string, (3) Reference Level, (4) Base Level, (5) Base Constraint. Empty values are already null
 * in the facts; the first non-null wins; none ⇒ null (missing). The name is NOT normalized: 'Arch-FIRST FLOOR' and
 * 'FIRST FLOOR' are different levels, while equal names from two models ARE the same level (identity is the raw name,
 * modelKey-independent). World Z is never used.
 */
export function resolveLevel(facts, levelNamesOfModel) {
  if (facts === undefined || facts === null) return null;
  if (facts.levelRef !== null) {
    const name = levelNamesOfModel?.get(facts.levelRef);
    if (typeof name === 'string') return name;
  }
  for (const value of facts.levelStrings) if (value !== null) return value;
  return null;
}

function displayLabels(values, display, unknownLabel) {
  const text = (v) => (v === null ? unknownLabel : display(v));
  const owners = new Map();                                   // display text -> distinct values showing it
  for (const v of values) {
    const t = text(v);
    if (!owners.has(t)) owners.set(t, new Set());
    owners.get(t).add(v);
  }
  const out = new Map();
  for (const v of values) {
    const t = text(v);
    const clash = v !== null && (owners.get(t).size > 1 || t === unknownLabel);
    out.set(v, clash ? `${t} (${v})` : t);
  }
  return out;
}

/**
 * One sliced pass over resultSet.results → {status:'ok', table:{groups:[{groupId, ref:{key, labels}, count, memberIds}],
 * memberships, total}} | {status:'superseded'}. `sideValue(ref)` → raw string | null.
 */
export async function buildPairGroupTable({ modeId, resultSet, sideValue, display, unknownLabel, scheduler, isCurrent }) {
  const groups = new Map();                                   // groupId -> {key, memberIds}
  const values = new Set();
  const results = resultSet.results;
  for (let start = 0; start < results.length; start += LIST_CHUNK_SIZE) {
    if (!isCurrent()) return { status: 'superseded' };
    const end = Math.min(results.length, start + LIST_CHUNK_SIZE);
    for (let i = start; i < end; i += 1) {
      const r = results[i];
      const a = sideValue(r.pair.first);
      const b = sideValue(r.pair.second);
      const key = pairKey(a, b);
      const groupId = JSON.stringify([modeId, key]);
      let g = groups.get(groupId);
      if (g === undefined) {
        g = { key, memberIds: [] };
        groups.set(groupId, g);
        for (const v of key) values.add(v);
      }
      g.memberIds.push(r.resultId);
    }
    await scheduler.yield();
  }
  if (!isCurrent()) return { status: 'superseded' };
  const labelOfValue = displayLabels([...values], display, unknownLabel);
  const list = [...groups.entries()]
    .sort(([, x], [, y]) => compareKeys(x.key, y.key))
    .map(([groupId, g]) => Object.freeze({
      groupId,
      ref: Object.freeze({ key: Object.freeze(g.key), labels: Object.freeze(g.key.map((v) => labelOfValue.get(v))) }),
      count: g.memberIds.length,
      memberIds: Object.freeze(g.memberIds),
    }));
  return { status: 'ok', table: Object.freeze({ groups: Object.freeze(list), memberships: results.length, total: results.length }) };
}
