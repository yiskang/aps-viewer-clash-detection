// test/clashpanel/core/largeResults.test.mjs — Task 21: bounded behaviour on a 100,000-result set (spec §12;
// AC-P4, AC-P5). Structural bounds only — page row count, slicing (yield counts), one derivation per
// (generation, spec), typed-array ordered storage. NO wall-clock assertion: responsiveness is unmeasured (PG-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { PAGE_SIZE, LIST_CHUNK_SIZE, FILTER_DEBOUNCE_MS } from '../../../clashpanel/core/constants.js';
import { buildResultIndex } from '../../../clashpanel/core/resultIndex.js';
import { runFilterPass } from '../../../clashpanel/core/filters.js';
import { buildOrderedIndex, pageSlice } from '../../../clashpanel/core/orderedList.js';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { drain } from '../support/settle.mjs';

const N = 100000;
const SET = makeSet({ runId: 'run-big', results: hardResults(N) });   // built once; deep-frozen
const slices = (n) => Math.ceil(n / LIST_CHUNK_SIZE);

async function bigHarness() {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(SET);
  return h;
}

async function waitFor(h, predicate) {
  for (let i = 0; i < 20000 && !predicate(); i += 1) await h.settle(1);
  assert.ok(predicate(), 'condition not reached within the round bound');
}

test('flat view: a page never exceeds PAGE_SIZE rows; counts and page math cover the whole set; one derivation each', async () => {
  const h = await bigHarness();
  await waitFor(h, () => h.vm().run.counts.filtered === N);
  const vm = h.vm();
  assert.equal(vm.results.rows.length, PAGE_SIZE);
  assert.deepEqual(vm.results.page, { index: 0, count: Math.ceil(N / PAGE_SIZE), size: PAGE_SIZE });
  await h.dispatch({ type: INTENT.NAV_PAGE, page: Math.ceil(N / PAGE_SIZE) - 1 });
  assert.equal(h.vm().results.rows.length, N % PAGE_SIZE === 0 ? PAGE_SIZE : N % PAGE_SIZE);
  assert.equal(h.vm().results.rows.at(-1).ordinal, N);
  assert.deepEqual([h.engine.control.summarize.successes, h.engine.control.filter.successes], [1, 1]);
});

test('an active filter pass is sliced: yields grow with the set size in LIST_CHUNK_SIZE steps (no single long pass)', async () => {
  const h = await bigHarness();
  await waitFor(h, () => h.vm().run.counts.filtered === N);
  const before = h.scheduler.yieldCount;
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  await waitFor(h, () => h.vm().run.counts.filtered === N - N / 10);
  assert.ok(h.scheduler.yieldCount - before >= slices(N) - 1, `expected ≥ ${slices(N) - 1} yields, saw ${h.scheduler.yieldCount - before}`);
  assert.equal(h.vm().results.rows.length, PAGE_SIZE);

  // The same pass over a 10x smaller index yields ~10x less: slicing scales with size, not with a fixed count.
  const small = buildResultIndex(makeSet({ runId: 'run-small', results: hardResults(N / 10) }));
  const scheduler = createFakeScheduler();
  const matching = await drain(scheduler, runFilterPass({ index: small, spec: { text: '', models: [], elementOnly: null, maxGap: null, unverified: false, hasLocation: true }, caveatedIds: null, labelText: () => '', scheduler, isCurrent: () => true }));
  assert.equal(matching.length, N / 10 - N / 100);
  assert.equal(scheduler.yieldCount, slices(N / 10) - 1);
});

test('text filter: the label index is built in slices once per set, then the text pass runs sliced too', async () => {
  const h = await bigHarness();
  await waitFor(h, () => h.vm().run.counts.filtered === N);
  const before = h.scheduler.yieldCount;
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-1500' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await waitFor(h, () => h.vm().run.counts.filtered === 11);             // A-1500 and A-15000 … A-15009
  assert.ok(h.scheduler.yieldCount - before >= 2 * (slices(N) - 1), 'label warm + filter pass both sliced');
  assert.deepEqual(h.vm().results.rows.map((r) => r.side1.label).slice(0, 2), ['A-1500', 'A-15000']);
  const afterFirst = h.scheduler.yieldCount;
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-1501' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await waitFor(h, () => h.vm().filters.busy === false && h.vm().run.counts.filtered === 11);
  assert.ok(h.scheduler.yieldCount - afterFirst < 2 * (slices(N) - 1), 'the label index is not rebuilt for a second text');
});

test('grouped view: one groupBy; pages stay bounded even with a 1,000+-member group expanded', async () => {
  const h = await bigHarness();
  await waitFor(h, () => h.vm().run.counts.filtered === N);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await waitFor(h, () => h.vm().results.view === 'grouped');
  let vm = h.vm();
  assert.equal(vm.results.rows.length, PAGE_SIZE);
  assert.equal(h.engine.control.groupBy.successes, 1);
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-count' });      // the mB groups (~1,031 members) first
  vm = h.vm();
  const big = vm.results.rows[0];
  assert.ok(big.count > 1000);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: big.groupId });
  vm = h.vm();
  assert.equal(vm.results.rows.length, PAGE_SIZE);
  assert.ok(vm.results.page.count > Math.ceil(N / PAGE_SIZE) / 100);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  assert.equal(h.engine.control.groupBy.successes, 1);
});

test('selecting a result far outside the current page moves the page to its occurrence; Prev stays on that page', async () => {
  const h = await bigHarness();
  await waitFor(h, () => h.vm().run.counts.filtered === N);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: `r${N - 1}`, groupId: null });
  let vm = h.vm();
  assert.equal(vm.results.page.index, Math.ceil(N / PAGE_SIZE) - 1);
  assert.equal(vm.results.rows.filter((r) => r.selected).length, 1);
  await h.dispatch({ type: INTENT.NAV_PREV });
  vm = h.vm();
  assert.equal(vm.selected.resultId, `r${N - 2}`);
  assert.equal(vm.results.page.index, Math.ceil(N / PAGE_SIZE) - 1);
});

test('memory shape: the pass result and the ordered index are typed arrays; entries are produced per page only', async () => {
  const index = buildResultIndex(SET);
  const scheduler = createFakeScheduler();
  const spec = { text: '', models: ['mA'], elementOnly: null, maxGap: null, unverified: false, hasLocation: true };
  const matching = await drain(scheduler, runFilterPass({ index, spec, caveatedIds: null, labelText: () => '', scheduler, isCurrent: () => true }));
  assert.ok(matching instanceof Uint32Array);
  const ordered = buildOrderedIndex({ view: 'flat', matching, index, sortKey: 'default' });
  assert.ok(ordered.storage.canonical instanceof Uint32Array);
  assert.equal(ordered.length, matching.length);
  const page = pageSlice(ordered, 3, PAGE_SIZE);
  assert.equal(page.length, PAGE_SIZE);
  assert.equal(page[0].canonicalIndex, matching[3 * PAGE_SIZE]);
});
