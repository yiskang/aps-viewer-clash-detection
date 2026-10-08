// test/clashpanel/core/propertyGrouping.test.mjs — the Panel-side element-property read path (elementProperties.js)
// and the pure Category / Level group-table builders (propertyGrouping.js). Package brief §4–§6, §10, §11, §13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_PROP_FILTER, PROPERTY_CHUNK_SIZE, readBulkProperties, elementFactsOf, levelNameOf, createElementPropertySource,
} from '../../../clashpanel/core/elementProperties.js';
import {
  compareIdentity, pairKey, categoryDisplay, resolveLevel, buildPairGroupTable, UNKNOWN_CATEGORY_LABEL, UNKNOWN_LEVEL_LABEL,
} from '../../../clashpanel/core/propertyGrouping.js';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { drain } from '../support/settle.mjs';
import { makeFakeModel, makeSet, withFakeProperties, prop } from '../support/controllerHarness.mjs';

const always = () => true;

// ── identity helpers ─────────────────────────────────────────────────────────────────────────────────────────────

test('compareIdentity: code-point (UTF-8 byte) order, the missing sentinel (null) after every real value', () => {
  assert.ok(compareIdentity('Revit Ducts', 'Revit Walls') < 0);
  assert.ok(compareIdentity('B', 'a') < 0, 'bytewise, not locale/case-insensitive');
  assert.ok(compareIdentity('￿', '\u{1F600}') < 0, 'astral code points sort after BMP ones (UTF-8 byte order), unlike UTF-16 code units');
  assert.ok(compareIdentity('zzz', null) < 0);
  assert.ok(compareIdentity(null, '') > 0);
  assert.equal(compareIdentity(null, null), 0);
  assert.equal(compareIdentity('x', 'x'), 0);
});

test('pairKey: unordered (A,B) == (B,A); same value ⇒ single-element key; missing ⇒ null sentinel, last', () => {
  assert.deepEqual(pairKey('Revit Walls', 'Revit Ducts'), ['Revit Ducts', 'Revit Walls']);
  assert.deepEqual(pairKey('Revit Ducts', 'Revit Walls'), ['Revit Ducts', 'Revit Walls']);
  assert.deepEqual(pairKey('Revit Walls', 'Revit Walls'), ['Revit Walls']);
  assert.deepEqual(pairKey(null, 'Revit Walls'), ['Revit Walls', null]);
  assert.deepEqual(pairKey(null, null), [null]);
  assert.notEqual(JSON.stringify(pairKey(null, null)), JSON.stringify(pairKey('null', 'null')), 'sentinel cannot collide with a real string');
});

test('categoryDisplay strips a leading "Revit " for display only', () => {
  assert.equal(categoryDisplay('Revit Walls'), 'Walls');
  assert.equal(categoryDisplay('Walls'), 'Walls');
  assert.equal(categoryDisplay('Revit '), 'Revit ', 'nothing left after the prefix ⇒ raw text');
  assert.equal(categoryDisplay('RevitWalls'), 'RevitWalls');
});

// ── fact extraction ──────────────────────────────────────────────────────────────────────────────────────────────

test('elementFactsOf: Category (__category__), Level ref (__internalref__, integer), the string level attributes by displayCategory', () => {
  const facts = elementFactsOf({ dbId: 7, properties: [
    prop.category('Revit Walls'), prop.levelRef(30), prop.constraintsLevel('L1-constraints'),
    prop.named('Reference Level', 'RL'), prop.named('Base Level', 'BL'), prop.named('Base Constraint', 'BC'),
  ] });
  assert.deepEqual({ ...facts }, { category: 'Revit Walls', levelRef: 30, levelStrings: ['L1-constraints', 'RL', 'BL', 'BC'] });
  assert.ok(Object.isFrozen(facts));
});

test('elementFactsOf: missing / empty / non-string category ⇒ null; a Level string outside Constraints is not the Constraints Level', () => {
  for (const value of [undefined, '', '   ', 12, null]) {
    const props = value === undefined ? [] : [prop.category(value)];
    assert.equal(elementFactsOf({ dbId: 1, properties: props }).category, null, String(value));
  }
  const odd = elementFactsOf({ dbId: 1, properties: [
    { displayName: 'Category', attributeName: 'Category', displayCategory: 'Other', displayValue: 'Revit Walls' },  // not __category__
    prop.named('Level', 'Dimensions-Level', 'Dimensions'),                                                          // not Constraints
    { displayName: 'Level', attributeName: 'Level', displayCategory: '__internalref__', displayValue: '30' },     // not a number
  ] });
  assert.deepEqual({ ...odd }, { category: null, levelRef: null, levelStrings: [null, null, null, null] });
});

test('levelNameOf: unfiltered row name with a trailing " [<digits>]" stripped; Name property fallback; empty ⇒ null', () => {
  assert.equal(levelNameOf({ dbId: 30, name: 'FIRST FLOOR [30]', properties: [] }), 'FIRST FLOOR');
  assert.equal(levelNameOf({ dbId: 30, name: 'Level [B] [12]', properties: [] }), 'Level [B]');
  assert.equal(levelNameOf({ dbId: 30, name: 'Roof', properties: [] }), 'Roof');
  assert.equal(levelNameOf({ dbId: 30, name: undefined, properties: [{ displayName: 'Name', attributeName: 'name', displayCategory: '__name__', displayValue: 'SECOND FLOOR [31]' }] }), 'SECOND FLOOR');
  assert.equal(levelNameOf({ dbId: 30, name: ' [30]', properties: [] }), null);
  assert.equal(levelNameOf({ dbId: 30, properties: [] }), null);
});

test('resolveLevel: FIXED precedence ref → Constraints Level → Reference Level → Base Level → Base Constraint; empties skipped', () => {
  const names = new Map([[30, 'FIRST FLOOR']]);
  const f = (levelRef, levelStrings) => ({ category: null, levelRef, levelStrings });
  assert.equal(resolveLevel(f(30, ['C', 'R', 'B', 'BC']), names), 'FIRST FLOOR');
  assert.equal(resolveLevel(f(99, ['C', 'R', 'B', 'BC']), names), 'C', 'an unresolved ref falls through');
  assert.equal(resolveLevel(f(null, [null, 'R', 'B', 'BC']), names), 'R');
  assert.equal(resolveLevel(f(null, [null, null, 'B', 'BC']), names), 'B');
  assert.equal(resolveLevel(f(null, [null, null, null, 'BC']), names), 'BC');
  assert.equal(resolveLevel(f(null, [null, null, null, null]), names), null);
  assert.equal(resolveLevel(undefined, names), null, 'no properties row ⇒ missing');
  assert.equal(resolveLevel(f(30, [null, null, null, null]), undefined), null, 'no level names for the model ⇒ ref unresolved');
});

// ── bulk read ────────────────────────────────────────────────────────────────────────────────────────────────────

test('readBulkProperties: getBulkProperties2 in chunks of ≤ PROPERTY_CHUNK_SIZE, propFilter passed through, one yield per chunk', async () => {
  assert.equal(PROPERTY_CHUNK_SIZE, 2000);
  const model = withFakeProperties(makeFakeModel('A'), (dbId) => ({ name: `n${dbId}`, properties: [prop.category('Revit Walls')] }));
  const ids = Array.from({ length: 4500 }, (_, i) => i + 1);
  const scheduler = createFakeScheduler();
  const out = await drain(scheduler, readBulkProperties({ model, dbIds: ids, propFilter: ELEMENT_PROP_FILTER, scheduler, isCurrent: always }));
  assert.equal(out.status, 'ok');
  assert.equal(out.rows.length, 4500);
  assert.deepEqual(model.properties.calls.map((c) => c.ids.length), [2000, 2000, 500]);
  assert.deepEqual(model.properties.calls[0].options, { propFilter: [...ELEMENT_PROP_FILTER] });
  assert.equal(scheduler.yieldCount, 3);
});

test('readBulkProperties: falls back to legacy getBulkProperties; neither ⇒ unsupported; onError / throw / malformed ⇒ error', async () => {
  const scheduler = createFakeScheduler();
  const legacy = withFakeProperties(makeFakeModel('A'), () => ({ properties: [prop.category('Revit Walls')] }), { legacy: true });
  const ok = await drain(scheduler, readBulkProperties({ model: legacy, dbIds: [1], propFilter: ['Category'], scheduler, isCurrent: always }));
  assert.equal(ok.status, 'ok');
  assert.equal(legacy.properties.calls.length, 1);

  const none = await drain(scheduler, readBulkProperties({ model: makeFakeModel('B'), dbIds: [1], propFilter: null, scheduler, isCurrent: always }));
  assert.deepEqual(none, { status: 'unavailable', reason: 'properties-unsupported' });

  const failing = withFakeProperties(makeFakeModel('C'), () => ({ properties: [] }));
  failing.properties.failWith = new Error('worker died');
  assert.deepEqual(await drain(scheduler, readBulkProperties({ model: failing, dbIds: [1], propFilter: null, scheduler, isCurrent: always })), { status: 'unavailable', reason: 'properties-error' });

  const throwing = { getBulkProperties2: () => { throw new Error('sync'); } };
  assert.deepEqual(await drain(scheduler, readBulkProperties({ model: throwing, dbIds: [1], propFilter: null, scheduler, isCurrent: always })), { status: 'unavailable', reason: 'properties-error' });

  const malformed = { getBulkProperties2: (ids, o, onSuccess) => onSuccess({ not: 'an array' }) };
  assert.deepEqual(await drain(scheduler, readBulkProperties({ model: malformed, dbIds: [1], propFilter: null, scheduler, isCurrent: always })), { status: 'unavailable', reason: 'properties-error' });
});

test('readBulkProperties: superseded between chunks stops reading (no further getBulkProperties2 call)', async () => {
  const model = withFakeProperties(makeFakeModel('A'), () => ({ properties: [] }));
  let live = true;
  const scheduler = createFakeScheduler();
  scheduler.yieldHook = () => { live = false; };
  const out = await drain(scheduler, readBulkProperties({ model, dbIds: Array.from({ length: 5000 }, (_, i) => i), propFilter: null, scheduler, isCurrent: () => live }));
  assert.deepEqual(out, { status: 'superseded' });
  assert.equal(model.properties.calls.length, 1);
});

// ── property source (one cached read per loaded model, distinct result dbIds only) ───────────────────────────────

function sourceOver({ results, models, scheduler = createFakeScheduler(), isCurrent = always }) {
  const set = makeSet({ runId: 'run-p', results });
  const source = createElementPropertySource({ resultSet: set, resolveModel: (key) => models[key] ?? null, scheduler, isCurrent });
  return { source, scheduler, set };
}

test('property source: ONE filtered read per model for only the distinct dbIds of the result set, cached; level names read once, unfiltered', async () => {
  const mA = withFakeProperties(makeFakeModel('A'), (dbId) => (dbId === 30
    ? { name: 'FIRST FLOOR [30]', properties: [prop.named('Elevation', 0)] }
    : { properties: [prop.category('Revit Walls'), prop.levelRef(30)] }));
  const mB = withFakeProperties(makeFakeModel('B'), () => ({ properties: [prop.category('Revit Ducts'), prop.named('Reference Level', 'Mech L1')] }));
  const { source, scheduler } = sourceOver({
    results: [{ a: ['mA', 2], b: ['mB', 9] }, { a: ['mA', 1], b: ['mB', 9] }, { a: ['mA', 2], b: ['mA', 1] }],
    models: { mA, mB },
  });
  const facts = await drain(scheduler, source.facts());
  assert.equal(facts.status, 'ok');
  assert.deepEqual(mA.properties.calls.map((c) => c.ids), [[1, 2]], 'distinct, ascending');
  assert.deepEqual(mB.properties.calls.map((c) => c.ids), [[9]]);
  assert.equal(facts.facts.get('mA').get(1).category, 'Revit Walls');
  const again = await drain(scheduler, source.facts());
  assert.equal(again, facts, 'cached: the same outcome object');
  const levels = await drain(scheduler, source.levels());
  assert.equal(levels.status, 'ok');
  assert.deepEqual(mA.properties.calls.map((c) => c.ids), [[1, 2], [30]]);
  assert.equal(mA.properties.calls[1].options.propFilter, undefined, 'level names: unfiltered (propFilter ["Name"] drops the row name on the pinned build)');
  assert.equal(levels.levelNames.get('mA').get(30), 'FIRST FLOOR');
  assert.equal(mB.properties.calls.length, 1, 'no level refs in mB ⇒ no second read');
  await drain(scheduler, source.levels());
  assert.equal(mA.properties.calls.length + mB.properties.calls.length, 3, 'everything cached');
});

test('property source: a participating model that is not live ⇒ unavailable model-not-loaded (never "Unknown")', async () => {
  const mA = withFakeProperties(makeFakeModel('A'), () => ({ properties: [prop.category('Revit Walls')] }));
  const { source, scheduler } = sourceOver({ results: [{ a: ['mA', 1], b: ['mB', 2] }], models: { mA } });
  assert.deepEqual(await drain(scheduler, source.facts()), { status: 'unavailable', reason: 'model-not-loaded' });
});

test('property source: a failing level-name read ⇒ levels unavailable; facts stay ok', async () => {
  const mA = withFakeProperties(makeFakeModel('A'), () => ({ properties: [prop.category('Revit Walls'), prop.levelRef(30)] }));
  const { source, scheduler } = sourceOver({ results: [{ a: ['mA', 1], b: ['mA', 2] }], models: { mA } });
  assert.equal((await drain(scheduler, source.facts())).status, 'ok');
  mA.properties.failWith = new Error('boom');
  assert.deepEqual(await drain(scheduler, source.levels()), { status: 'unavailable', reason: 'properties-error' });
});

test('property source: invalidate() supersedes an in-flight read and the next request reads again', async () => {
  const mA = withFakeProperties(makeFakeModel('A'), () => ({ properties: [prop.category('Revit Walls')] }));
  mA.properties.manual = true;
  const { source, scheduler } = sourceOver({ results: [{ a: ['mA', 1], b: ['mA', 2] }], models: { mA } });
  const first = source.facts();
  await drain(scheduler, Promise.resolve());
  source.invalidate();
  mA.properties.resolveAll();
  assert.deepEqual(await drain(scheduler, first), { status: 'superseded' });
  const second = source.facts();
  assert.notEqual(second, first);
  await drain(scheduler, Promise.resolve());
  mA.properties.resolveAll();
  assert.equal((await drain(scheduler, second)).status, 'ok');
  assert.equal(mA.properties.calls.length, 2);
});

// ── group tables ─────────────────────────────────────────────────────────────────────────────────────────────────

test('buildPairGroupTable: unordered pair groups, stable mode-prefixed groupId, identity order (known before missing), canonical members', async () => {
  const set = makeSet({ runId: 'run-t', results: [
    { a: ['mA', 1], b: ['mB', 2] },      // Walls × Ducts
    { a: ['mA', 3], b: ['mA', 4] },      // Walls × Walls
    { a: ['mB', 2], b: ['mA', 1] },      // Ducts × Walls (reverse order)
    { a: ['mA', 5], b: ['mA', 1] },      // missing × Walls
    { a: ['mA', 5], b: ['mA', 6] },      // missing × missing
  ] });
  const value = { 'mA:1': 'Revit Walls', 'mA:3': 'Revit Walls', 'mA:4': 'Revit Walls', 'mB:2': 'Revit Ducts' };
  const scheduler = createFakeScheduler();
  const out = await drain(scheduler, buildPairGroupTable({
    modeId: 'category', resultSet: set, sideValue: (ref) => value[`${ref.modelKey}:${ref.dbId}`] ?? null,
    display: categoryDisplay, unknownLabel: UNKNOWN_CATEGORY_LABEL, scheduler, isCurrent: always,
  }));
  assert.equal(out.status, 'ok');
  const g = out.table.groups;
  assert.deepEqual(g.map((x) => x.groupId), [
    JSON.stringify(['category', ['Revit Ducts', 'Revit Walls']]),
    JSON.stringify(['category', ['Revit Walls']]),
    JSON.stringify(['category', ['Revit Walls', null]]),
    JSON.stringify(['category', [null]]),
  ]);
  assert.deepEqual(g.map((x) => x.ref.labels.join(' ↔ ')), ['Ducts ↔ Walls', 'Walls', 'Walls ↔ Unknown category', 'Unknown category']);
  assert.deepEqual(g.map((x) => [x.count, x.memberIds]), [[2, ['r0', 'r2']], [1, ['r1']], [1, ['r3']], [1, ['r4']]]);
  assert.equal(out.table.total, 5);
  assert.equal(out.table.memberships, 5, 'single-valued');
});

test('buildPairGroupTable: two raw values that DISPLAY identically stay distinct groups with disambiguated labels', async () => {
  const set = makeSet({ runId: 'run-d', results: [{ a: ['mA', 1], b: ['mA', 1] }, { a: ['mA', 2], b: ['mA', 2] }, { a: ['mA', 3], b: ['mA', 3] }] });
  const value = { 1: 'Revit Walls', 2: 'Walls', 3: 'Unknown category' };
  const out = await drain(createFakeScheduler(), buildPairGroupTable({
    modeId: 'category', resultSet: set, sideValue: (ref) => value[ref.dbId], display: categoryDisplay,
    unknownLabel: UNKNOWN_CATEGORY_LABEL, scheduler: createFakeScheduler(), isCurrent: always,
  }));
  assert.deepEqual(out.table.groups.map((x) => [x.groupId, x.ref.labels]), [
    [JSON.stringify(['category', ['Revit Walls']]), ['Walls (Revit Walls)']],
    [JSON.stringify(['category', ['Unknown category']]), ['Unknown category (Unknown category)']],
    [JSON.stringify(['category', ['Walls']]), ['Walls (Walls)']],
  ]);
});

test('buildPairGroupTable: sliced (one yield per LIST_CHUNK_SIZE results) and superseded mid-way', async () => {
  const results = Array.from({ length: 4770 }, (_, i) => ({ a: ['mA', i], b: ['mA', i + 1] }));
  const set = makeSet({ runId: 'run-s', results });
  const scheduler = createFakeScheduler();
  const args = { modeId: 'level', resultSet: set, sideValue: () => 'L1', display: (v) => v, unknownLabel: UNKNOWN_LEVEL_LABEL, scheduler };
  const out = await drain(scheduler, buildPairGroupTable({ ...args, isCurrent: always }));
  assert.equal(out.table.groups.length, 1);
  assert.equal(out.table.groups[0].count, 4770);
  assert.equal(scheduler.yieldCount, 3);
  let live = true;
  scheduler.yieldHook = () => { live = false; };
  assert.deepEqual(await drain(scheduler, buildPairGroupTable({ ...args, isCurrent: () => live })), { status: 'superseded' });
});
