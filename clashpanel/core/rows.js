// clashpanel/core/rows.js
// Spec §8.2 row model. Pure: every Viewer-derived string arrives through `labels`, liveness through the resolver.
// formatGap is the SINGLE place the Soft gap is formatted (OD-13 Part 2 changes only GAP_UNIT_LABEL/GAP_DECIMALS).
// Hard (volume-overlap) rows carry no magnitude: `gap` is null (no invented penetration depth).
import { GAP_DECIMALS, GAP_UNIT_LABEL } from './constants.js';

export const LIVENESS_TEXT = Object.freeze({
  'not-registered': 'model not loaded',
  'reloaded-since-run': 'reloaded since run',
  'version-mismatch': 'version mismatch',
  'not-in-scene': 'not in scene',
});

/** Row liveness from a resolveResult() value: 'live' only when BOTH sides are live, else the first side's reason. */
export function livenessOf(resolution) {
  if (resolution.allLive) return 'live';
  const down = resolution.sides.find((side) => side.state !== 'live');
  return LIVENESS_TEXT[down?.reason] ?? 'model not loaded';
}

export function formatGap(distance) {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return '—';
  return `${distance.toFixed(GAP_DECIMALS)} ${GAP_UNIT_LABEL}`;
}

const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Spec §8.2 "Location": Hard = evidence.witness.point; Soft = midpoint of closestPoints. null when the record
 * has no usable location (flags.witnessUnavailable, or the evidence is absent/malformed).
 * @returns {null | {kind:'witness', point:number[]} | {kind:'closest-points', point:number[], closestPoints:{first:number[],second:number[]}}}
 */
export function locationOf(record) {
  if (record?.flags?.witnessUnavailable === true) return null;
  const evidence = record?.evidence ?? {};
  if (record?.mode === 'clearance') {
    const cp = evidence.closestPoints;
    if (!cp || !isPoint(cp.first) || !isPoint(cp.second)) return null;
    const point = [0, 1, 2].map((i) => (cp.first[i] + cp.second[i]) / 2);
    return { kind: 'closest-points', point, closestPoints: { first: cp.first, second: cp.second } };
  }
  const point = evidence.witness?.point;
  return isPoint(point) ? { kind: 'witness', point } : null;
}

/** Badge order is fixed: 'no location','unreachable owner','mixed owner','duplicate-evidence conflict','caveated'. */
export function badgesFor(record, caveatedIds) {
  const flags = record?.flags ?? {};
  const badges = [];
  if (locationOf(record) === null) badges.push('no location');
  if (flags.unreachableOwner === true) badges.push('unreachable owner');
  if (flags.mixedOwnerProvenance === true) badges.push('mixed owner');
  if (flags.duplicateEvidenceConflict === true) badges.push('duplicate-evidence conflict');
  if (caveatedIds instanceof Set && caveatedIds.has(record.resultId)) badges.push('caveated');
  return badges;
}

/** {modelKey, modelName, label, dbId} for one pair side; names are raw strings (UI uses textContent). */
export function sideView(ref, labels) {
  return { modelKey: ref.modelKey, modelName: labels.modelName(ref.modelKey), label: labels.elementLabel(ref), dbId: ref.dbId };
}

/** gap text for a record: Soft only, else null. */
export function gapOf(record) {
  return record?.mode === 'clearance' ? formatGap(record.evidence?.distance) : null;
}

export function buildRow({ record, canonicalIndex, groupId = null, labels, liveness, caveatedIds = null, selected = false }) {
  return {
    kind: 'result',
    key: `${groupId ?? '-'}|${record.resultId}`,
    resultId: record.resultId,
    groupId: groupId ?? null,
    ordinal: canonicalIndex + 1,
    side1: sideView(record.pair.first, labels),
    side2: sideView(record.pair.second, labels),
    gap: gapOf(record),
    badges: badgesFor(record, caveatedIds),
    liveness,
    selected: selected === true,
  };
}

/**
 * group = a filterGroups() entry {groupId, ref, count, filteredCount}. `label` = the active group mode's labelOf(ref)
 * (any mode: element, model pair, …); without it the Element label is built from an ElementRef `ref`.
 */
export function buildGroupHeaderRow({ group, label, labels, expanded, selected = false }) {
  return {
    kind: 'group',
    key: `group:${group.groupId}`,
    groupId: group.groupId,
    label: typeof label === 'string' ? label : `${labels.modelName(group.ref.modelKey)} · ${labels.elementLabel(group.ref)}`,
    count: group.count,
    filteredCount: group.filteredCount,
    expanded: expanded === true,
    selected: selected === true,                  // spec §27.1: this group is the aggregate-presentation selection
  };
}
