// test/clashpanel/core/controller.propertyGrouping.test.mjs — the metadata group modes Category and Level through the
// controller: element-property reads (one cached read per loaded model per generation), pair identity, missing /
// duplicate metadata, Level precedence, filters / sort / navigation interaction, unavailable + superseded paths and the
// large (≈4,770-result self-clash) workload. Package brief docs/reviews/for-claude-clash-test-result-grouping-navigation.md
// §4–§6, §8–§11, §13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { PAGE_SIZE } from '../../../clashpanel/core/constants.js';
import { groupModeOf } from '../../../clashpanel/core/groupModes.js';
import { createElementPropertySource } from '../../../clashpanel/core/elementProperties.js';
import { makeHarness, makeSet, prop } from '../support/controllerHarness.mjs';

const catId = (...key) => JSON.stringify(['category', key]);
const lvlId = (...key) => JSON.stringify(['level', key]);
const headers = (vm) => vm.results.rows.filter((r) => r.kind === 'group').map((r) => [r.label, r.count, r.filteredCount]);
const presents = (h) => h.bridge.calls.filter((c) => c.op === 'present');

// mA "Architecture": 30 is a Revit Level element (FIRST FLOOR). mB "Structure": 40 is a Level element (FIRST FLOOR).
const PROPS_A = {
  1: [prop.category('Revit Walls'), prop.levelRef(30), prop.constraintsLevel('WRONG-constraints')],          // ref wins
  2: [prop.category('Revit Walls'), prop.named('Level', 'WRONG-dimensions', 'Dimensions'),                   // not Constraints
    prop.constraintsLevel('FIRST FLOOR'), prop.named('Reference Level', 'WRONG-reference')],                 // Constraints wins
  3: [prop.category('Revit Floors'), prop.named('Reference Level', 'SECOND FLOOR')],
  4: [prop.category('Revit Walls'), prop.named('Base Level', 'FIRST FLOOR'), prop.named('Base Constraint', 'WRONG-bc')],
  5: [prop.category('Revit Walls'), prop.levelRef(30)],
};
const PROPS_B = {
  10: [prop.category('Revit Ducts'), prop.named('Reference Level', 'FIRST FLOOR')],
  11: [prop.category('Revit Ducts'), prop.named('Base Constraint', 'Mech-FIRST FLOOR')],
  12: [],                                                                                                   // nothing at all
  13: [prop.category('Revit Ducts'), prop.levelRef(40)],
  14: [prop.category('Revit Ducts'), prop.constraintsLevel(''), prop.named('Reference Level', 'FIRST FLOOR')], // empty skipped
};
const propsFrom = (table, levels) => (dbId) => (levels[dbId] !== undefined ? { name: levels[dbId], properties: [] }
  : table[dbId] !== undefined ? { name: `element ${dbId}`, properties: table[dbId] } : undefined);
const PROPS = { mA: propsFrom(PROPS_A, { 30: 'FIRST FLOOR [30]' }), mB: propsFrom(PROPS_B, { 40: 'FIRST FLOOR [40]' }) };

// r0 mA1×mA2 · r1 mA3×mB10 · r2 mA4×mB11 (no location) · r3 mB12×mB13 · r4 mA5×mB14
const RESULTS = [
  { a: ['mA', 1], b: ['mA', 2] },
  { a: ['mA', 3], b: ['mB', 10] },
  { a: ['mA', 4], b: ['mB', 11], point: null },
  { a: ['mB', 12], b: ['mB', 13] },
  { a: ['mA', 5], b: ['mB', 14] },
];

async function doneWith(set, options = {}) {
  const h = makeHarness({ props: PROPS, ...options });
  await h.readyHard();
  await h.runToDone(set);
  return h;
}
const calls = (h) => [h.modelA.properties?.calls.length ?? 0, h.modelB.properties?.calls.length ?? 0];

// ── Category ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('Category: unordered category-pair groups (raw-string identity, "Revit " stripped for display), same-category ⇒ one label, missing ⇒ Unknown category', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  const vm = h.vm();
  assert.equal(vm.filters.groupBy, 'category');
  assert.equal(vm.results.view, 'grouped');
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.results.multiValuedNote, null);
  assert.equal(vm.filters.groupingNote, null);
  assert.deepEqual(vm.results.rows.map((r) => r.groupId), [
    catId('Revit Ducts', 'Revit Floors'), catId('Revit Ducts', 'Revit Walls'), catId('Revit Ducts', null), catId('Revit Walls'),
  ]);
  assert.deepEqual(headers(vm), [['Ducts ↔ Floors', 1, 1], ['Ducts ↔ Walls', 2, 2], ['Ducts ↔ Unknown category', 1, 1], ['Walls', 1, 1]]);
  assert.equal(h.engine.control.groupBy.calls, 0, 'no Core facet: a Panel-side property read');
  assert.deepEqual(calls(h), [1, 1], 'one filtered read per model');
  assert.deepEqual(h.modelA.properties.calls[0].ids, [1, 2, 3, 4, 5], 'only the distinct dbIds of the result set');
  assert.deepEqual(h.modelB.properties.calls[0].ids, [10, 11, 12, 13, 14]);
});

test('Category: A×B and B×A are one group; duplicate display labels from different raw strings stay distinct groups', async () => {
  const props = {
    mA: (dbId) => ({ properties: [prop.category({ 1: 'Revit Walls', 2: 'Walls', 3: 'Revit Ducts' }[dbId])] }),
    mB: (dbId) => ({ properties: [prop.category({ 10: 'Revit Walls', 11: 'Revit Ducts' }[dbId])] }),
  };
  const results = [
    { a: ['mA', 1], b: ['mB', 11] },     // Walls × Ducts
    { a: ['mA', 3], b: ['mB', 10] },     // Ducts × Walls (reverse)
    { a: ['mA', 2], b: ['mA', 2] },      // 'Walls' (raw) self
    { a: ['mA', 1], b: ['mB', 10] },     // 'Revit Walls' self (cross-model)
  ];
  const h = await doneWith(makeSet({ runId: 'run-1', results }), { props });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.deepEqual(h.vm().results.rows.map((r) => [r.groupId, r.label, r.count]), [
    [catId('Revit Ducts', 'Revit Walls'), 'Ducts ↔ Walls (Revit Walls)', 2],
    [catId('Revit Walls'), 'Walls (Revit Walls)', 1],
    [catId('Walls'), 'Walls (Walls)', 1],
  ]);
});

test('Category + filters: "n of m" counts, groups emptied by a filter are not rendered, Clear filters restores; no re-read', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });                 // r2 has no location
  assert.deepEqual(headers(h.vm()), [['Ducts ↔ Floors', 1, 1], ['Ducts ↔ Walls', 2, 1], ['Ducts ↔ Unknown category', 1, 1], ['Walls', 1, 1]]);
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mB'] });                       // drops r0 (mA×mA) ⇒ 'Walls' gone
  assert.deepEqual(headers(h.vm()), [['Ducts ↔ Floors', 1, 1], ['Ducts ↔ Walls', 2, 1], ['Ducts ↔ Unknown category', 1, 1]]);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.deepEqual(headers(h.vm()), [['Ducts ↔ Floors', 1, 1], ['Ducts ↔ Walls', 2, 2], ['Ducts ↔ Unknown category', 1, 1], ['Walls', 1, 1]]);
  assert.deepEqual(calls(h), [1, 1], 'filters never re-read properties');
});

test('Category: Sort by group size / group name reorders groups; Default keeps the key order', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-count' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Ducts ↔ Walls', 'Ducts ↔ Floors', 'Ducts ↔ Unknown category', 'Walls']);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Ducts ↔ Floors', 'Ducts ↔ Unknown category', 'Ducts ↔ Walls', 'Walls']);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'default' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Ducts ↔ Floors', 'Ducts ↔ Walls', 'Ducts ↔ Unknown category', 'Walls']);
});

test('Category: Prev/Next stay within the group with group-scoped nav wording; a filter that removes the group clears the scope', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: catId('Revit Ducts', 'Revit Walls') });
  let vm = h.vm();
  assert.equal(vm.results.nav.label, 'Clash #3');
  assert.equal(vm.results.nav.scoped, true);
  assert.equal(vm.results.nav.canPrev, false);
  assert.deepEqual(presents(h).at(-1).req.sides, [{ model: h.modelA, dbId: 4 }, { model: h.modelB, dbId: 11 }]);
  await h.dispatch({ type: INTENT.NAV_NEXT });
  vm = h.vm();
  assert.equal(vm.selected.resultId, 'r4');
  assert.equal(vm.results.nav.canNext, false, 'no leak into the next group');
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['nope'] });
  assert.equal(h.vm().results.state, 'empty-filtered');
  assert.equal(h.vm().filters.groupingNote, null);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(h.vm().results.nav.label, 'Clash #5', 'the filtered-away scope is not resurrected');
  assert.equal(h.vm().results.nav.scoped, false);
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  assert.equal(h.vm().results.view, 'grouped');
});

// ── Level ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Level: per-side level pair by fixed precedence (ref → Constraints → Reference → Base → Base Constraint); same level collapses; missing ⇒ Unknown Level', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  const vm = h.vm();
  assert.equal(vm.results.state, 'list');
  assert.deepEqual(vm.results.rows.map((r) => r.groupId), [
    lvlId('FIRST FLOOR'), lvlId('FIRST FLOOR', 'Mech-FIRST FLOOR'), lvlId('FIRST FLOOR', 'SECOND FLOOR'), lvlId('FIRST FLOOR', null),
  ]);
  assert.deepEqual(headers(vm), [
    ['FIRST FLOOR', 2, 2],                          // r0 (ref [30] · Constraints) + r4 (ref [30] · Reference, empty Constraints skipped)
    ['FIRST FLOOR ↔ Mech-FIRST FLOOR', 1, 1],       // r2: not normalized across models
    ['FIRST FLOOR ↔ SECOND FLOOR', 1, 1],           // r1: conflicting levels ⇒ the pair
    ['FIRST FLOOR ↔ Unknown Level', 1, 1],          // r3: mB13 ref [40] resolved in ITS model; mB12 has nothing
  ]);
  assert.equal(h.vm().results.multiValuedNote, null);
  assert.deepEqual(calls(h), [2, 2], 'element read + one unfiltered level-name read per model');
  assert.deepEqual(h.modelA.properties.calls[1], { ids: [30], options: {} });
  assert.deepEqual(h.modelB.properties.calls[1], { ids: [40], options: {} });
});

test('Level: identity is the raw resolved name (stable across runs, model-independent); deterministic order known-before-Unknown', async () => {
  const props = {
    mA: (dbId) => ({ properties: [prop.named('Reference Level', { 1: 'Level 2', 2: 'Level 1', 3: 'Roof' }[dbId] ?? '')] }),
    mB: (dbId) => ({ properties: dbId === 10 ? [prop.named('Reference Level', 'Level 1')] : [] }),
  };
  const results = [
    { a: ['mA', 3], b: ['mB', 11] }, { a: ['mA', 1], b: ['mA', 2] }, { a: ['mA', 2], b: ['mB', 10] }, { a: ['mB', 11], b: ['mB', 11] },
  ];
  const h = await doneWith(makeSet({ runId: 'run-1', results }), { props });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  const first = h.vm().results.rows.map((r) => [r.groupId, r.label, r.count]);
  assert.deepEqual(first, [
    [lvlId('Level 1'), 'Level 1', 1],               // mA2 and mB10: the same name from two models is the same level
    [lvlId('Level 1', 'Level 2'), 'Level 1 ↔ Level 2', 1],
    [lvlId('Roof', null), 'Roof ↔ Unknown Level', 1],
    [lvlId(null), 'Unknown Level', 1],
  ]);
  await h.runToDone(makeSet({ runId: 'run-2', results }));
  assert.deepEqual(h.vm().results.rows.map((r) => [r.groupId, r.label, r.count]), first, 'same metadata ⇒ same ids, labels, order');
});

test('Level + filters: n-of-m counts, emptied groups dropped, Clear filters restores', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });                 // r2 gone ⇒ its group gone
  assert.deepEqual(headers(h.vm()).map(([l, c, f]) => `${l}:${f}/${c}`), ['FIRST FLOOR:2/2', 'FIRST FLOOR ↔ SECOND FLOOR:1/1', 'FIRST FLOOR ↔ Unknown Level:1/1']);
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mB'] });                       // r0 gone ⇒ FIRST FLOOR 1 of 2
  assert.deepEqual(headers(h.vm())[0], ['FIRST FLOOR', 2, 1]);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(headers(h.vm()).length, 4);
});

test('mode switch Category ↔ Level ↔ others never re-reads properties for the same generation; a new run reads again', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  for (const value of ['category', 'level', 'none', 'element', 'category', 'level', 'modelPair', 'level']) {
    await h.dispatch({ type: INTENT.GROUP_MODE, value });
  }
  assert.deepEqual(calls(h), [2, 2], 'facts once + level names once per model');
  assert.equal(h.vm().results.view, 'grouped');
  await h.runToDone(makeSet({ runId: 'run-2', results: RESULTS }));
  assert.equal(h.vm().filters.groupBy, 'level');
  assert.equal(h.vm().results.view, 'grouped');
  assert.deepEqual(calls(h), [4, 4], 'the cache is per result generation');
});

// ── unavailable / superseded ─────────────────────────────────────────────────────────────────────────────────────

test('property read failure ⇒ that mode is unavailable with its own text (flat list, no guessed groups); other modes still group', async () => {
  const h = makeHarness({ props: PROPS });
  h.modelB.properties.failWith = new Error('property worker failed');
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  let vm = h.vm();
  assert.equal(vm.results.state, 'grouping-unavailable');
  assert.equal(vm.results.view, 'flat');
  assert.equal(vm.filters.groupingNote, groupModeOf('category').unavailableText('properties-error'));
  assert.match(vm.filters.groupingNote, /^Category grouping is unavailable/);
  assert.ok(vm.results.rows.every((r) => r.kind === 'result'));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  assert.match(h.vm().filters.groupingNote, /^Level grouping is unavailable/);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  vm = h.vm();
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.results.view, 'grouped');
});

test('a model without any bulk property read ⇒ unavailable (properties-unsupported), never Unknown', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }), { props: { mA: PROPS.mA } });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  assert.equal(h.vm().filters.groupingNote, groupModeOf('category').unavailableText('properties-unsupported'));
});

test('a level-name read failure makes Level unavailable but Category still groups', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  h.modelA.properties.failWith = new Error('boom');
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().results.state, 'list');
});

test('model unload: the property cache is dropped; the active property mode re-reads and reports model-not-loaded', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().results.view, 'grouped');
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  const vm = h.vm();
  assert.equal(vm.results.state, 'grouping-unavailable');
  assert.equal(vm.filters.groupingNote, groupModeOf('category').unavailableText('model-not-loaded'));
  assert.ok(vm.results.rows.length > 0, 'the flat list stays');
});

test('superseded: a new run while the property read is in flight drops the stale answer; the new run reads and groups', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  h.modelA.properties.manual = true;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().filters.busy, true, 'pending: busy flat list');
  assert.equal(h.vm().results.view, 'flat');
  h.modelA.properties.manual = false;
  await h.runToDone(makeSet({ runId: 'run-2', results: RESULTS.slice(0, 2) }));
  h.modelA.properties.resolveAll();                                                    // the stale run-1 answer lands now
  await h.settle();
  const vm = h.vm();
  assert.deepEqual(headers(vm), [['Ducts ↔ Floors', 1, 1], ['Walls', 1, 1]], 'only run-2 data');
  assert.equal(vm.filters.busy, false);
});

test('superseded: leaving the mode while reading, then a late answer, does not regroup the view; returning is served from cache', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  h.modelA.properties.manual = true;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  h.modelA.properties.manual = false;
  h.modelA.properties.resolveAll();
  await h.settle();
  assert.equal(h.vm().results.view, 'flat');
  const before = calls(h);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  assert.equal(h.vm().results.view, 'grouped');
  assert.deepEqual(calls(h), before);
});

// ── large workload ───────────────────────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ['Revit Walls', 'Revit Floors', 'Revit Doors', 'Revit Windows', 'Revit Columns', 'Revit Ceilings', 'Revit Roofs', 'Revit Stairs', 'Revit Railings', 'Revit Furniture', 'Revit Generic Models', 'Revit Curtain Panels'];
const LEVEL_IDS = [900001, 900002, 900003, 900004, 900005];
const DISTINCT = 4300;
const largeProps = (dbId) => {
  const k = LEVEL_IDS.indexOf(dbId);
  if (k >= 0) return { name: `LEVEL ${k + 1} [${dbId}]`, properties: [] };
  return { properties: [prop.category(CATEGORIES[dbId % CATEGORIES.length]), ...(dbId % 97 === 0 ? [] : [prop.levelRef(LEVEL_IDS[dbId % LEVEL_IDS.length])])] };
};
const LARGE_RESULTS = Array.from({ length: 4770 }, (_, i) => ({ a: ['mA', 1 + (i % DISTINCT)], b: ['mA', 1 + ((i * 7 + 13) % DISTINCT)] }));

test('large self-clash (4,770 results, ~4,300 distinct elements of one model): Category/Level grouping bounded, one read per model, pages ≤ PAGE_SIZE; timings reported', async () => {
  const set = makeSet({ runId: 'run-big', results: LARGE_RESULTS });
  const distinct = new Set(LARGE_RESULTS.flatMap((r) => [r.a[1], r.b[1]])).size;
  assert.ok(distinct >= 4200 && distinct <= DISTINCT, `distinct elements ${distinct}`);

  // Pure compute (property read via the fake + table build), with a macrotask-free scheduler: the Panel-side cost.
  const timings = {};
  for (const id of ['category', 'level']) {
    const model = { getBulkProperties2: (ids, options, ok) => queueMicrotask(() => ok(ids.map((dbId) => {
      const e = largeProps(dbId);
      return { dbId, name: options.propFilter ? undefined : e.name, properties: e.properties };
    }))) };
    const scheduler = { now: () => 0, setTimeout: () => 0, clearTimeout: () => {}, yield: () => Promise.resolve() };
    const properties = createElementPropertySource({ resultSet: set, resolveModel: () => model, scheduler, isCurrent: () => true });
    const t0 = performance.now();
    const out = await groupModeOf(id).compute({ resultSet: set, properties, scheduler, isCurrent: () => true });
    timings[id] = performance.now() - t0;
    assert.equal(out.status, 'ok', id);
    assert.equal(out.table.groups.reduce((n, g) => n + g.count, 0), 4770, `${id}: single-valued counts add up`);
  }
  console.log(`# large-case group compute (4,770 results, ${distinct} distinct elements): category ${timings.category.toFixed(1)} ms, level ${timings.level.toFixed(1)} ms`);

  // Through the controller: grouped, bounded pages, one element read (3 chunks of ≤ 2000 ids) + one level-name read.
  const h = makeHarness({ props: { mA: largeProps } });
  await h.readyHard();
  await h.runToDone(set);
  const t1 = performance.now();
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  for (let i = 0; i < 200 && h.vm().results.view !== 'grouped'; i += 1) await h.settle(1);
  const tCategory = performance.now() - t1;
  let vm = h.vm();
  assert.equal(vm.results.view, 'grouped');
  assert.ok(vm.results.rows.length <= PAGE_SIZE);
  assert.deepEqual(h.modelA.properties.calls.map((c) => c.ids.length), [2000, 2000, distinct - 4000]);
  const biggest = vm.results.rows.find((r) => r.kind === 'group');
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: biggest.groupId });
  vm = h.vm();
  assert.equal(vm.results.rows.length, PAGE_SIZE, 'an expanded large group is paged');
  const t2 = performance.now();
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  for (let i = 0; i < 200 && h.vm().results.view !== 'grouped'; i += 1) await h.settle(1);
  const tLevel = performance.now() - t2;
  vm = h.vm();
  assert.equal(vm.results.view, 'grouped');
  assert.ok(vm.results.rows.length <= PAGE_SIZE);
  assert.ok(headers(vm).some(([l]) => l.includes('Unknown Level')), 'elements without a level ⇒ Unknown Level');
  assert.equal(h.modelA.properties.calls.length, 4, 'level mode re-used the element read; one unfiltered level-name read');
  console.log(`# large-case controller end-to-end (fake scheduler + settle rounds): category ${tCategory.toFixed(1)} ms, level ${tLevel.toFixed(1)} ms`);
});

// ── recovery after a transient read failure ──────────────────────────────────────────────────────────────────────

test('transient properties-error: the failed mode(s) re-read the next time the mode is selected, then group', async () => {
  const h = makeHarness({ props: PROPS });
  h.modelB.properties.failWith = new Error('transient');
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  const before = calls(h);
  await h.settle();
  assert.deepEqual(calls(h), before, 'no automatic retry');
  h.modelB.properties.failWith = null;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.settle();
  assert.equal(h.vm().results.view, 'grouped');
  assert.equal(h.vm().filters.groupingNote, null);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'level' });
  await h.settle();
  assert.equal(h.vm().results.view, 'grouped', 'Level recovers too (its failed facts were not kept)');
});

test("'properties-unsupported' stays cached: re-selecting the mode does not re-read", async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }), { props: { mA: PROPS.mA } });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  const before = calls(h);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.settle();
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  assert.deepEqual(calls(h), before);
});

test('no extra reads while a read is pending (re-selecting the mode is a no-op)', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  h.modelA.properties.manual = true;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  await h.settle();
  assert.equal(h.modelA.properties.calls.length, 1);
  h.modelA.properties.manual = false;
  h.modelA.properties.resolveAll();
  await h.settle();
  assert.equal(h.vm().results.view, 'grouped');
  assert.equal(h.modelA.properties.calls.length, 1);
});

test("unload realism: 'unload' fires while the model is still live, then 'removed': final state is consistent", async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });   // BEFORE_MODEL_UNLOAD: still in the catalog
  await h.settle();
  assert.equal(h.vm().results.view, 'grouped', 'model still live ⇒ the active mode re-reads and groups');
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });
  await h.settle();
  const vm = h.vm();
  assert.equal(vm.results.state, 'grouping-unavailable');
  assert.equal(vm.filters.groupingNote, groupModeOf('category').unavailableText('model-not-loaded'));
  assert.ok(vm.results.rows.length > 0);
});

test("'model-not-loaded' recovers when the model is back in the catalog (catalog change)", async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: RESULTS }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'category' });
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });
  await h.settle();
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  const before = calls(h);
  h.catalog.fire();                                                  // nothing changed yet: still not loaded
  await h.settle();
  assert.equal(h.vm().results.state, 'grouping-unavailable');
  h.catalog.addModel({ modelKey: 'mB', model: h.modelB });          // hide/show: the model is back
  h.catalog.fire();
  await h.settle();
  assert.equal(h.vm().results.view, 'grouped');
  assert.ok(calls(h)[1] > before[1], 'the property cache was re-read');
});
