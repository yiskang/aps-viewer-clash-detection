// test/clashpanel/core/controller.grouping.test.mjs — single-level grouping-mode registry (None / Element / Model Pair),
// Model Pair semantics, grouped navigation and the two closed Lows (stale group-scoped nav wording after the origin group
// was filtered away; grouping notes over an empty filtered list). Package brief
// docs/reviews/for-claude-clash-test-result-grouping-navigation.md §3, §6–§10, §13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupingTooLargeError } from '../../../clashtest/index.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { PAGE_SIZE, FILTER_DEBOUNCE_MS } from '../../../clashpanel/core/constants.js';
import { GROUPING_UNAVAILABLE_TEXT, MULTI_VALUED_NOTE } from '../../../clashpanel/core/grouping.js';
import { GROUP_MODE_IDS, groupModeOf } from '../../../clashpanel/core/groupModes.js';
import { makeHarness, makeSet } from '../support/controllerHarness.mjs';

async function doneWith(set, harnessOptions) {
  const h = makeHarness(harnessOptions);
  await h.readyHard();
  await h.runToDone(set);
  return h;
}
const pairId = (a, b) => JSON.stringify(['pairModels', {}, [a, b]]);
const elementId = (modelKey, dbId) => JSON.stringify(['element', {}, { dbId, modelKey }]);
const headers = (vm) => vm.results.rows.filter((r) => r.kind === 'group').map((r) => [r.label, r.count, r.filteredCount]);
const presents = (h) => h.bridge.calls.filter((c) => c.op === 'present');

// r0 mA↔mA (self) · r1,r2 mA↔mB · r3 mB↔mB (self) · r4 mA↔mB — canonical order (first ≤ second, as Core's PairId).
const MIXED = [
  { a: ['mA', 1], b: ['mA', 2] },
  { a: ['mA', 3], b: ['mB', 10] },
  { a: ['mA', 4], b: ['mB', 11], point: null },
  { a: ['mB', 12], b: ['mB', 13] },
  { a: ['mA', 5], b: ['mB', 14] },
];

// ── registry ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('registry: none / element / modelPair / category / level are the supported single-level modes; each grouped mode declares its seam', () => {
  assert.deepEqual([...GROUP_MODE_IDS], ['none', 'element', 'modelPair', 'category', 'level']);
  assert.equal(groupModeOf('none').grouped, false);
  assert.equal(groupModeOf('constructor'), null, 'own names only');
  assert.equal(groupModeOf('pairModels'), null);
  for (const id of ['element', 'modelPair', 'category', 'level']) {
    const m = groupModeOf(id);
    assert.equal(m.grouped, true);
    assert.equal(typeof m.compute, 'function', `${id}.compute (async groups + unavailable state)`);
    assert.equal(typeof m.labelOf, 'function', `${id}.labelOf`);
    assert.equal(typeof m.multiValued, 'boolean');
    assert.equal(m.defaultOrder, 'core');
    assert.ok(Object.isFrozen(m));
  }
  assert.equal(groupModeOf('element').multiValued, true);
  assert.equal(groupModeOf('element').note, MULTI_VALUED_NOTE);
  for (const id of ['modelPair', 'category', 'level']) {
    assert.equal(groupModeOf(id).multiValued, false, id);
    assert.equal(groupModeOf(id).note, null, `${id}: single-valued modes never show the multi-valued note`);
  }
});

test('GROUP_MODE ignores unknown modes', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  for (const value of ['pairModels', 'Category', 'levels', '', null]) {
    await h.dispatch({ type: INTENT.GROUP_MODE, value });
    assert.equal(h.vm().filters.groupBy, 'none');
  }
  assert.equal(h.engine.control.groupBy.calls, 0);
});

// ── Model Pair ───────────────────────────────────────────────────────────────────────────────────────────────────

test('Model Pair: one groupBy(set, [\'pairModels\']); unordered model-pair groups keyed by modelKey identity; self-clash A↔A', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  const vm = h.vm();
  assert.equal(h.engine.control.groupBy.successes, 1);
  assert.deepEqual(h.engine.control.groupBy.args[0][1], ['pairModels']);
  assert.equal(vm.filters.groupBy, 'modelPair');
  assert.equal(vm.results.view, 'grouped');
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.results.multiValuedNote, null, 'each clash is in exactly one model pair');
  assert.deepEqual(vm.results.rows.map((r) => r.groupId), [pairId('mA', 'mA'), pairId('mA', 'mB'), pairId('mB', 'mB')]);
  assert.deepEqual(headers(vm), [['Architecture ↔ Architecture', 1, 1], ['Architecture ↔ Structure', 3, 3], ['Structure ↔ Structure', 1, 1]]);
  assert.equal(headers(vm).reduce((n, [, c]) => n + c, 0), 5, 'single-valued: group counts add up to the result count');
  assert.deepEqual(vm.filters.sortOptions.map((o) => o.value), ['default', 'group-count', 'group-label']);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mA', 'mB') });
  assert.deepEqual(h.vm().results.rows.filter((r) => r.groupId === pairId('mA', 'mB') && r.kind === 'result').map((r) => r.resultId), ['r1', 'r2', 'r4']);
});

test('Model Pair identity is stable: a host display-name change relabels the group but keeps its groupId and expansion', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mA', 'mB') });
  h.catalog.addModel({ modelKey: 'mA', displayName: 'Architecture (rev 2)', model: h.modelA, loaded: true });
  h.catalog.fire();
  await h.settle();
  const vm = h.vm();
  assert.deepEqual(vm.results.rows.filter((r) => r.kind === 'group').map((r) => [r.groupId, r.label, r.expanded]), [
    [pairId('mA', 'mA'), 'Architecture (rev 2) ↔ Architecture (rev 2)', false],
    [pairId('mA', 'mB'), 'Architecture (rev 2) ↔ Structure', true],
    [pairId('mB', 'mB'), 'Structure ↔ Structure', false],
  ]);
  assert.equal(h.engine.control.groupBy.successes, 1, 'a relabel is presentation only: no regrouping');
});

test('Model Pair: the same display name on two loaded instances stays two disambiguated, distinct groups', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }), { displayNames: { mA: 'Architecture', mB: 'Architecture' } });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  const vm = h.vm();
  const labels = headers(vm).map(([label]) => label);
  assert.deepEqual(labels, ['Architecture · …mA ↔ Architecture · …mA', 'Architecture · …mA ↔ Architecture · …mB', 'Architecture · …mB ↔ Architecture · …mB']);
  assert.equal(new Set(labels).size, 3);
  assert.equal(new Set(vm.results.rows.map((r) => r.groupId)).size, 3);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });
  assert.equal(h.vm().results.rows.filter((r) => r.kind === 'group').length, 3, 'label sort never collapses equal-looking groups');
});

test('Model Pair: missing host display metadata falls back to the deterministic modelKey-based name', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }), { displayNames: { mA: '', mB: 'Structure' } });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.deepEqual(headers(h.vm()).map(([label]) => label), ['Model mA ↔ Model mA', 'Model mA ↔ Structure', 'Structure ↔ Structure']);
});

test('Model Pair: Sort by group size / group name reorders groups deterministically; Default keeps the modelKey order', async () => {
  const results = [{ a: ['mA', 1], b: ['mA', 2] }, { a: ['mA', 3], b: ['mB', 10] }, { a: ['mA', 4], b: ['mB', 11] }, { a: ['mB', 12], b: ['mB', 13] }];
  const h = await doneWith(makeSet({ runId: 'run-1', results }), { displayNames: { mA: 'Zeta', mB: 'Alpha' } });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Zeta ↔ Zeta', 'Zeta ↔ Alpha', 'Alpha ↔ Alpha']);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-count' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Zeta ↔ Alpha', 'Zeta ↔ Zeta', 'Alpha ↔ Alpha'], 'ties keep the default order');
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Alpha ↔ Alpha', 'Zeta ↔ Alpha', 'Zeta ↔ Zeta']);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'default' });
  assert.deepEqual(headers(h.vm()).map(([l]) => l), ['Zeta ↔ Zeta', 'Zeta ↔ Alpha', 'Alpha ↔ Alpha']);
});

test('Model Pair + filters: counts read "n of m", groups emptied by a filter are not rendered, Clear filters restores them', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });              // r2 has no witness
  assert.deepEqual(headers(h.vm()), [['Architecture ↔ Architecture', 1, 1], ['Architecture ↔ Structure', 3, 2], ['Structure ↔ Structure', 1, 1]]);
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mB'] });                    // drops the mA↔mA group
  assert.deepEqual(headers(h.vm()), [['Architecture ↔ Structure', 3, 2], ['Structure ↔ Structure', 1, 1]]);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.deepEqual(headers(h.vm()), [['Architecture ↔ Architecture', 1, 1], ['Architecture ↔ Structure', 3, 3], ['Structure ↔ Structure', 1, 1]]);
  assert.equal(h.engine.control.groupBy.successes, 1, 'filters never regroup');
});

test('per-mode grouping cache: one groupBy per (generation, mode); switching modes never refetches; a new run regroups', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  for (const value of ['modelPair', 'element', 'none', 'modelPair', 'element']) await h.dispatch({ type: INTENT.GROUP_MODE, value });
  assert.deepEqual(h.engine.control.groupBy.args.map((a) => a[1]), [['pairModels'], ['element']]);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().filters.groupBy, 'none', 'no displayed set: default filters region');
  await h.runToDone(makeSet({ runId: 'run-2', results: MIXED }));
  assert.equal(h.vm().filters.groupBy, 'modelPair', 'the mode is a view preference and survives Clear');
  assert.equal(h.vm().results.view, 'grouped');
  assert.deepEqual(h.engine.control.groupBy.args.map((a) => a[1]), [['pairModels'], ['element'], ['pairModels']]);
});

test('Model Pair unavailable ⇒ flat list + note for that mode only; Element still groups', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  h.engine.control.groupBy.failNext.push(new GroupingTooLargeError({ limit: 4, observed: 10 }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  let vm = h.vm();
  assert.equal(vm.results.state, 'grouping-unavailable');
  assert.equal(vm.filters.groupingNote, GROUPING_UNAVAILABLE_TEXT['too-large']);
  assert.equal(vm.results.view, 'flat');
  assert.equal(vm.results.multiValuedNote, null);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  vm = h.vm();
  assert.equal(vm.results.state, 'list');
  assert.equal(vm.filters.groupingNote, null);
  assert.equal(vm.results.view, 'grouped');
  assert.equal(vm.results.multiValuedNote, MULTI_VALUED_NOTE);
});

test('Model Pair row actions: Focus / Isolate / Markers present the selected clash; Back to all keeps the grouping', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: pairId('mA', 'mB') });
  assert.deepEqual(presents(h).at(-1).req.sides, [{ model: h.modelA, dbId: 3 }, { model: h.modelB, dbId: 10 }]);
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.equal(presents(h).at(-1).req.options.focus, true);
  await h.dispatch({ type: INTENT.ACTION_ISOLATE, value: true });
  assert.equal(presents(h).at(-1).req.options.isolate, true);
  await h.dispatch({ type: INTENT.ACTION_MARKERS, value: false });
  assert.equal(presents(h).at(-1).req.options.marker, false);
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  const vm = h.vm();
  assert.equal(vm.selected, null);
  assert.equal(vm.results.nav.label, 'No clash selected');
  assert.equal(vm.filters.groupBy, 'modelPair');
  assert.equal(vm.results.view, 'grouped');
  assert.ok(vm.results.rows.some((r) => r.kind === 'group' && r.groupId === pairId('mA', 'mB') && r.expanded));
});

// ── navigation ──────────────────────────────────────────────────────────────────────────────────────────────────

test('Model Pair: Prev/Next step inside the selected group only, with group-scoped nav wording; ends do not wrap', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mA', 'mA') });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mB', 'mB') });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: pairId('mA', 'mB') });
  let vm = h.vm();
  assert.equal(vm.results.nav.label, 'Clash #2');
  assert.equal(vm.results.nav.scoped, true);
  assert.equal(vm.results.nav.canPrev, false, 'first of its group (r0 in the previous group is not stepped to)');
  await h.dispatch({ type: INTENT.NAV_NEXT });
  assert.equal(h.vm().selected.resultId, 'r2');
  await h.dispatch({ type: INTENT.NAV_NEXT });
  vm = h.vm();
  assert.equal(vm.selected.resultId, 'r4');
  assert.equal(vm.results.nav.label, 'Clash #5');
  assert.equal(vm.results.nav.scoped, true);
  assert.equal(vm.results.nav.canNext, false, 'r3 sits in another group: no wrap, no leak');
});

test('Low closed: a filter that removes the origin group clears the group scope — no stale group-scoped nav wording', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mB', 'mB') });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: pairId('mA', 'mA') });
  assert.equal(h.vm().results.nav.label, 'Clash #1');
  assert.equal(h.vm().results.nav.scoped, true);
  await h.dispatch({ type: INTENT.FILTER_MODEL, value: ['mB'] });                    // the mA↔mA group is filtered away
  let vm = h.vm();
  assert.ok(!vm.results.rows.some((r) => r.groupId === pairId('mA', 'mA')));
  assert.equal(vm.results.nav.label, 'Clash #1', 'the scope group is gone');
  assert.equal(vm.results.nav.scoped, false);
  assert.equal(vm.selected.resultId, 'r0');
  assert.equal(vm.selected.hiddenByFilters, true);
  await h.dispatch({ type: INTENT.NAV_NEXT });                                       // whole-list step to a rendered occurrence
  vm = h.vm();
  assert.equal(vm.selected.resultId, 'r3');
  assert.equal(vm.results.nav.label, 'Clash #4');
  assert.equal(vm.results.nav.scoped, false);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(h.vm().results.nav.label, 'Clash #4', 'clearing filters never resurrects an old scope');
  assert.equal(h.vm().results.nav.scoped, false);
});

test('Low closed (Element too): the origin element group filtered away ⇒ no suffix, even after Clear filters', async () => {
  const results = [{ a: ['mA', 1], b: ['mB', 10] }, { a: ['mA', 2], b: ['mB', 10] }, { a: ['mA', 3], b: ['mB', 11] }];
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: elementId('mB', 10) });
  assert.equal(h.vm().results.nav.label, 'Clash #1');
  assert.equal(h.vm().results.nav.scoped, true);
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mA', dbId: 3 } }); // only r2 left: mB:10 gone
  assert.equal(h.vm().results.nav.label, 'Clash #1');
  assert.equal(h.vm().results.nav.scoped, false);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(h.vm().results.nav.label, 'Clash #1');
  assert.equal(h.vm().results.nav.scoped, false);
});

test('mode switch Element → Model Pair: the element scope does not exist there ⇒ no suffix; the selection survives', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: elementId('mB', 10) });
  assert.equal(h.vm().results.nav.label, 'Clash #2');
  assert.equal(h.vm().results.nav.scoped, true);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  let vm = h.vm();
  assert.equal(vm.selected.resultId, 'r1');
  assert.equal(vm.results.nav.label, 'Clash #2');
  assert.equal(vm.results.nav.scoped, false);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  vm = h.vm();
  assert.equal(vm.results.nav.label, 'Clash #2', 'a scope cleared by another grouping is not resurrected');
  assert.equal(vm.results.nav.scoped, false);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: elementId('mA', 4) });
  assert.equal(h.vm().results.nav.label, 'Clash #3', 'selecting inside a group scopes again');
  assert.equal(h.vm().results.nav.scoped, true);
});

test('selection follows its group across Sort changes in Model Pair mode (page follows the occurrence)', async () => {
  const results = [
    ...Array.from({ length: 60 }, (_, i) => ({ a: ['mA', 100 + i], b: ['mA', 1000 + i] })),
    ...Array.from({ length: 3 }, (_, i) => ({ a: ['mA', 2000 + i], b: ['mB', 10 + i] })),
  ];
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mA', 'mA') });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r55', groupId: pairId('mA', 'mA') });
  assert.equal(h.vm().results.page.index, Math.floor(56 / PAGE_SIZE));
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });                 // "Architecture ↔ Architecture" stays first
  assert.ok(h.vm().results.rows.some((r) => r.resultId === 'r55' && r.selected));
  assert.equal(h.vm().results.nav.label, 'Clash #56');
  assert.equal(h.vm().results.nav.scoped, true);
});

// ── notes over an empty filtered list (Low closed) ──────────────────────────────────────────────────────────────

test('Low closed: no grouping note / multi-valued note over an empty filtered list (Element, Model Pair, unavailable)', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'no-such-thing' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  let vm = h.vm();
  assert.equal(vm.results.state, 'empty-filtered');
  assert.equal(vm.results.multiValuedNote, null);
  assert.equal(vm.filters.groupingNote, null);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  vm = h.vm();
  assert.equal(vm.results.state, 'empty-filtered');
  assert.equal(vm.results.multiValuedNote, null);
  assert.deepEqual(vm.results.rows, []);
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(h.vm().results.state, 'list');

  const u = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  u.engine.control.groupBy.failNext.push(new GroupingTooLargeError({ limit: 4, observed: 10 }));
  await u.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.equal(u.vm().filters.groupingNote, GROUPING_UNAVAILABLE_TEXT['too-large']);
  await u.dispatch({ type: INTENT.FILTER_MODEL, value: ['nope'] });
  vm = u.vm();
  assert.equal(vm.results.state, 'empty-filtered');
  assert.equal(vm.filters.groupingNote, null, 'the unavailable note is not shown above an empty filtered list');
  await u.dispatch({ type: INTENT.FILTER_CLEAR });
  assert.equal(u.vm().filters.groupingNote, GROUPING_UNAVAILABLE_TEXT['too-large'], 'and returns with the list');
});

test('pending grouping: busy flat list; a grouping that lands after the user left that mode does not regroup the view', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: MIXED }));
  h.engine.control.groupBy.manual = true;
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  let vm = h.vm();
  assert.equal(vm.filters.busy, true);
  assert.equal(vm.results.view, 'flat');
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  h.engine.control.groupBy.resolveNext();
  await h.settle();
  vm = h.vm();
  assert.equal(vm.filters.groupBy, 'none');
  assert.equal(vm.results.view, 'flat');
  assert.equal(vm.filters.busy, false);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  assert.equal(h.vm().results.view, 'grouped', 'served from the per-mode cache');
  assert.equal(h.engine.control.groupBy.calls, 1);
});

test('large self-clash (4,770 results, one model pair): one group, every page bounded by PAGE_SIZE', async () => {
  const results = Array.from({ length: 4770 }, (_, i) => ({ a: ['mA', 2 * i + 1], b: ['mA', 2 * i + 2] }));
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'modelPair' });
  let vm = h.vm();
  assert.deepEqual(headers(vm), [['Architecture ↔ Architecture', 4770, 4770]]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: pairId('mA', 'mA') });
  vm = h.vm();
  assert.equal(vm.results.rows.length, PAGE_SIZE);
  assert.equal(vm.results.page.count, Math.ceil(4771 / PAGE_SIZE));
  await h.dispatch({ type: INTENT.NAV_PAGE, page: vm.results.page.count - 1 });
  assert.ok(h.vm().results.rows.length <= PAGE_SIZE);
});
