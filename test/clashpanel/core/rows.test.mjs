// test/clashpanel/core/rows.test.mjs — spec §8.2 row model
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, buildGroupHeaderRow, formatGap, livenessOf, locationOf, badgesFor } from '../../../clashpanel/core/rows.js';
import { GAP_DECIMALS, GAP_UNIT_LABEL } from '../../../clashpanel/core/constants.js';

const labels = {
  modelName: (key) => ({ mA: 'Architecture', mB: 'Structure' })[key] ?? `Model ${key}`,
  elementLabel: (ref) => (ref.dbId === 1 ? 'Wall-102' : `#${ref.dbId}`),
};
const hard = (over = {}) => ({
  resultId: 'r1', mode: 'volume-overlap', unitId: '1.0',
  pair: { first: { modelKey: 'mA', dbId: 1 }, second: { modelKey: 'mB', dbId: 10 } },
  evidence: { witness: { kind: 'surface-crossing', point: [1, 2, 3] } }, flags: {}, ...over,
});
const soft = (over = {}) => ({
  resultId: 's1', mode: 'clearance', unitId: '1.0',
  pair: { first: { modelKey: 'mA', dbId: 1 }, second: { modelKey: 'mA', dbId: 2 } },
  evidence: { distance: 0.03125, clearance: 0.05, closestPoints: { first: [0, 0, 0], second: [2, 4, 6] } }, flags: {}, ...over,
});

test('formatGap uses GAP_DECIMALS and GAP_UNIT_LABEL (single point of change for OD-13 Part 2)', () => {
  assert.equal(formatGap(0.03125), `${(0.03125).toFixed(GAP_DECIMALS)} ${GAP_UNIT_LABEL}`);
  assert.equal(formatGap(0), `${(0).toFixed(GAP_DECIMALS)} ${GAP_UNIT_LABEL}`);
  assert.equal(formatGap(Number.NaN), '—');
  assert.equal(formatGap(undefined), '—');
});

test('Hard row: key, ordinal, sides, NO gap, liveness and selection flags', () => {
  const row = buildRow({ record: hard(), canonicalIndex: 11, groupId: null, labels, liveness: 'live', caveatedIds: null, selected: true });
  assert.deepEqual(row, {
    kind: 'result', key: '-|r1', resultId: 'r1', groupId: null, ordinal: 12,
    side1: { modelKey: 'mA', modelName: 'Architecture', label: 'Wall-102', dbId: 1 },
    side2: { modelKey: 'mB', modelName: 'Structure', label: '#10', dbId: 10 },
    gap: null, badges: [], liveness: 'live', selected: true,
  });
});

test('Soft row: gap from evidence.distance; grouped occurrence key carries the groupId', () => {
  const row = buildRow({ record: soft(), canonicalIndex: 0, groupId: 'g1', labels, liveness: 'model not loaded', caveatedIds: new Set(), selected: false });
  assert.equal(row.gap, formatGap(0.03125));
  assert.equal(row.key, 'g1|s1');
  assert.equal(row.groupId, 'g1');
  assert.equal(row.liveness, 'model not loaded');
});

test('badges come from flags and the caveated mask, in fixed order', () => {
  const record = hard({ flags: { witnessUnavailable: true, unreachableOwner: true, mixedOwnerProvenance: true, duplicateEvidenceConflict: true }, evidence: { witness: null } });
  assert.deepEqual(badgesFor(record, new Set(['r1'])), ['no location', 'unreachable owner', 'mixed owner', 'duplicate-evidence conflict', 'caveated']);
  assert.deepEqual(badgesFor(hard(), new Set(['other'])), []);
  assert.deepEqual(badgesFor(hard(), null), []);
});

test('locationOf: Hard witness point; Soft midpoint of closestPoints; none when unavailable', () => {
  assert.deepEqual(locationOf(hard()), { kind: 'witness', point: [1, 2, 3] });
  assert.deepEqual(locationOf(soft()).point, [1, 2, 3]);
  assert.deepEqual(locationOf(soft()).closestPoints, { first: [0, 0, 0], second: [2, 4, 6] });
  assert.equal(locationOf(hard({ flags: { witnessUnavailable: true } })), null);
  assert.equal(locationOf(hard({ evidence: { witness: null } })), null);
  assert.equal(locationOf(hard({ evidence: { witness: { kind: 'k', point: [1, Number.NaN, 3] } } })), null);
});

test('livenessOf maps the first unavailable side; live only when both sides are live', () => {
  const live = { state: 'live' };
  assert.equal(livenessOf({ allLive: true, sides: [live, live] }), 'live');
  assert.equal(livenessOf({ allLive: false, sides: [live, { state: 'unavailable', reason: 'not-in-scene' }] }), 'not in scene');
  assert.equal(livenessOf({ allLive: false, sides: [{ state: 'unavailable', reason: 'reloaded-since-run' }, live] }), 'reloaded since run');
  assert.equal(livenessOf({ allLive: false, sides: [{ state: 'unavailable', reason: 'version-mismatch' }, live] }), 'version mismatch');
  assert.equal(livenessOf({ allLive: false, sides: [{ state: 'unavailable', reason: 'not-registered' }, live] }), 'model not loaded');
});

test('group header row', () => {
  const header = buildGroupHeaderRow({ group: { groupId: 'g1', ref: { modelKey: 'mA', dbId: 1 }, count: 5, filteredCount: 2 }, labels, expanded: false });
  assert.deepEqual(header, { kind: 'group', key: 'group:g1', groupId: 'g1', label: 'Architecture · Wall-102', count: 5, filteredCount: 2, expanded: false, selected: false });
});

test('group header row for a non-element group: the mode label is used and no element label is read', () => {
  const strict = { modelName: () => { throw new Error('no model name read'); }, elementLabel: () => { throw new Error('no element label read'); } };
  const header = buildGroupHeaderRow({ group: { groupId: 'gp', ref: ['mA', 'mB'], count: 3, filteredCount: 3 }, label: 'Architecture ↔ Structure', labels: strict, expanded: true });
  assert.deepEqual(header, { kind: 'group', key: 'group:gp', groupId: 'gp', label: 'Architecture ↔ Structure', count: 3, filteredCount: 3, expanded: true, selected: false });
});

test('AC-P13: hostile names flow through rows as raw strings', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const row = buildRow({ record: hard(), canonicalIndex: 0, labels: { modelName: () => hostile, elementLabel: () => hostile }, liveness: 'live' });
  assert.equal(row.side1.modelName, hostile);
  assert.equal(row.side2.label, hostile);
});
