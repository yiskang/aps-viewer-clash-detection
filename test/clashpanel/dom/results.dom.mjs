// test/clashpanel/dom/results.dom.mjs — Region 4 RESULTS: rows, groups, selection, Prev/Next, pagination, states (Task 29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { resultsVm, resultRow, groupRow, side } from './support/vmFixtures.mjs';

const RESULTS = ['/clashpanel/ui/render/results.js', 'renderResults'];
const PAGE_SIZE = 50; // mirrors clashpanel/core/constants.js PAGE_SIZE (asserted equal below)

test('results: a row shows #ordinal, Element 1 ↔ Element 2 with model chips, gap, badges and liveness', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ rows: [
    resultRow(11, { gap: '0.031 scene units', badges: ['caveated', 'no location'], liveness: 'model not loaded' }),
    resultRow(12, { side2: side('mB', 'Structure', '#212', 212) }),
  ] }));
  const r = await page.evaluate(() => [...document.querySelectorAll('.clash-row')].map((li) => ({
    text: li.textContent,
    chips: [...li.querySelectorAll('.clash-chip')].map((c) => c.textContent),
  })));
  assert.deepEqual(r, [
    { text: '#12 Architecture · Wall-11 · #111 ↔ Structure · Beam-11 · #211 0.031 scene units caveated no location (model not loaded)', chips: ['Architecture', 'Structure'] },
    { text: '#13 Architecture · Wall-12 · #112 ↔ Structure · #212', chips: ['Architecture', 'Structure'] },
  ]);
}));

test('results: click and keyboard Enter select via nav/select {resultId, groupId}; selected row has aria-selected', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ rows: [resultRow(0), resultRow(1, { selected: true, groupId: 'g1', key: 'g1|r1' })] }));
  const sel = await page.evaluate(() => [...document.querySelectorAll('.clash-row')].map((li) => [li.getAttribute('aria-selected'), li.tabIndex, li.getAttribute('role')]));
  assert.deepEqual(sel, [['false', 0, 'option'], ['true', 0, 'option']]);
  await page.click('.clash-row >> nth=0');
  await page.focus('.clash-row >> nth=1');
  await page.keyboard.press('Enter');
  assert.deepEqual(await intents(page), [
    { type: 'nav/select', resultId: 'r0', groupId: null },
    { type: 'nav/select', resultId: 'r1', groupId: 'g1' },
  ]);
}));

test('results: group headers expand/collapse via group/toggle and expose aria-expanded and counts', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: [
    groupRow('gA', { label: 'Architecture · Wall-1', count: 4, filteredCount: 2, expanded: true }),
    resultRow(0, { groupId: 'gA', key: 'gA|r0' }),
    groupRow('gB', { label: 'Structure · Beam-9', count: 1, filteredCount: 1, expanded: false }),
  ] }));
  const r = await page.evaluate(() => [...document.querySelectorAll('.clash-group-row button')].map((b) => [b.getAttribute('aria-expanded'), b.textContent]));
  assert.deepEqual(r, [['true', '▾ Architecture · Wall-1 (2 of 4)'], ['false', '▸ Structure · Beam-9 (1)']]);
  await page.click('.clash-group-row button >> nth=1');
  assert.deepEqual(await intents(page), [{ type: 'group/toggle', groupId: 'gB' }]);
}));

test('results: Prev/Next disabled per vm.nav; pagination ‹ n / N › dispatches nav/page and disables at the ends', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ page: { index: 1, count: 3, size: PAGE_SIZE }, nav: { canPrev: true, canNext: false, label: '12 of 812' } }));
  const r = await page.evaluate(() => ({
    prev: document.querySelector('[data-key="nav-prev"]').disabled, next: document.querySelector('[data-key="nav-next"]').disabled,
    label: document.querySelector('.clash-page-label').textContent, navLabel: document.querySelector('.clash-nav-label').textContent,
    pPrev: document.querySelector('[data-key="page-prev"]').disabled, pNext: document.querySelector('[data-key="page-next"]').disabled,
  }));
  assert.deepEqual(r, { prev: false, next: true, label: ' 2 / 3 ', navLabel: ' 12 of 812 ', pPrev: false, pNext: false });
  await page.click('[data-key="nav-prev"]');
  await page.click('[data-key="page-prev"]');
  await page.click('[data-key="page-next"]');
  assert.deepEqual(await intents(page), [{ type: 'nav/prev' }, { type: 'nav/page', page: 0 }, { type: 'nav/page', page: 2 }]);
  await rerender(page, resultsVm({ page: { index: 2, count: 3, size: PAGE_SIZE }, nav: { canPrev: true, canNext: true, label: '' } }));
  assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-key="page-prev"]').disabled, document.querySelector('[data-key="page-next"]').disabled]), [false, true]);
  await page.click('[data-key="nav-next"]');
  assert.deepEqual((await intents(page)).at(-1), { type: 'nav/next' });
}));

test('results: bounded DOM — a page of PAGE_SIZE rows renders exactly PAGE_SIZE row elements (never more than vm rows)', () => withPage(async ({ page }) => {
  const constPage = await page.evaluate(async () => (await import('/clashpanel/core/constants.js')).PAGE_SIZE);
  assert.equal(constPage, PAGE_SIZE);
  const rows = Array.from({ length: PAGE_SIZE }, (_, i) => resultRow(i));
  await mountRenderer(page, ...RESULTS, resultsVm({ rows, page: { index: 0, count: 17, size: PAGE_SIZE } }));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.clash-row').length), PAGE_SIZE);
  await rerender(page, resultsVm({ rows: rows.slice(0, 7) }));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.clash-row').length), 7);
}));

test('results: non-list states render message + lines and no rows; empty-filtered offers Clear filters', () => withPage(async ({ page }) => {
  const cases = [
    ['before-run', 'Run a test to see clashes', []],
    ['running', 'Results appear when the run finishes', ['37 found so far']],
    ['empty-claim', 'Completed — no clashes found in full coverage', ['Coverage: full']],
    ['empty-nonclaim', 'No clashes were found, but this is not a no-clash claim', ['Coverage is partial']],
    ['error', 'The clash engine failed', ['seal-failed']],
  ];
  await mountRenderer(page, ...RESULTS, resultsVm({ state: 'before-run', message: 'x', rows: [] }));
  for (const [state, message, lines] of cases) {
    await rerender(page, resultsVm({ state, message, lines, rows: [resultRow(0)] }));
    const r = await page.evaluate(() => ({
      message: document.querySelector('.clash-results-message')?.textContent ?? null,
      lines: [...document.querySelectorAll('.clash-results-lines li')].map((li) => li.textContent),
      rows: document.querySelectorAll('.clash-row').length,
      nav: document.querySelector('.clash-nav') !== null,
    }));
    assert.deepEqual(r, { message, lines, rows: 0, nav: false }, state);
    assert.doesNotMatch(message, /^No clashes$/);
  }
  await rerender(page, resultsVm({ state: 'empty-filtered', message: 'No clashes match the current filters', rows: [] }));
  await page.click('[data-key="results-clear-filters"]');
  assert.deepEqual(await intents(page), [{ type: 'filter/clear' }]);
}));

test('results: grouping-unavailable still lists rows; multi-valued and hidden-by-filters notes render', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({
    state: 'grouping-unavailable', message: 'Grouping is unavailable — showing the flat list', rows: [resultRow(0), resultRow(1)],
    multiValuedNote: 'A clash appears under both of its elements', hiddenByFiltersNote: true,
  }));
  const r = await page.evaluate(() => ({
    rows: document.querySelectorAll('.clash-row').length,
    message: document.querySelector('.clash-results-message').textContent,
    multi: document.querySelector('.clash-multivalued-note').textContent,
    hidden: document.querySelector('.clash-hidden-note').textContent,
  }));
  assert.deepEqual(r, { rows: 2, message: 'Grouping is unavailable — showing the flat list', multi: 'A clash appears under both of its elements', hidden: 'The selected clash is hidden by the current filters.' });
}));

test('results: focus on a row survives a re-render (keyed by data-key)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm());
  await page.focus('.clash-row >> nth=2');
  await rerender(page, resultsVm({ rows: [resultRow(0), resultRow(1), resultRow(2, { selected: true })] }));
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-key')), '-|r2');
}));

// --- Bounded ARIA remediation (independent review M1): a listbox may own ONLY option children. ---
const GROUPED_ROWS = () => [
  groupRow('gA', { label: 'Architecture · Wall-1', count: 2, filteredCount: 2, expanded: true }),
  resultRow(0, { groupId: 'gA', key: 'gA|r0' }),
  resultRow(1, { groupId: 'gA', key: 'gA|r1', selected: true }),
  groupRow('gB', { label: 'Structure · Beam-9', count: 1, filteredCount: 1, expanded: true }),
  resultRow(2, { groupId: 'gB', key: 'gB|r2' }),
  groupRow('gC', { label: 'Mechanical · Duct-3', count: 4, filteredCount: 4, expanded: false }),
];

test('results ARIA: in the grouped view every listbox owns only options; group toggle buttons live outside any listbox', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: GROUPED_ROWS() }));
  const r = await page.evaluate(() => {
    const listboxes = [...document.querySelectorAll('[role="listbox"]')];
    return {
      ownedRoles: listboxes.map((lb) => [...lb.children].map((c) => c.getAttribute('role'))),
      buttonsInsideListbox: document.querySelectorAll('[role="listbox"] button').length,
      groupButtons: document.querySelectorAll('.clash-group-row button').length,
      optionsOutsideListbox: [...document.querySelectorAll('[role="option"]')].filter((o) => o.parentElement.getAttribute('role') !== 'listbox').length,
      labels: listboxes.map((lb) => lb.getAttribute('aria-label')),
    };
  });
  assert.deepEqual(r.ownedRoles, [['option', 'option'], ['option']]);
  assert.equal(r.buttonsInsideListbox, 0);
  assert.equal(r.groupButtons, 3);
  assert.equal(r.optionsOutsideListbox, 0);
  assert.deepEqual(r.labels, ['Architecture · Wall-1', 'Structure · Beam-9']); // each group's options are named by their group
}));

test('results ARIA: grouped Tab order is header → its options → next header; Enter/Space on a header toggles; option Enter still selects', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: GROUPED_ROWS() }));
  await page.focus('.clash-group-row button >> nth=0');
  const order = [];
  for (let i = 0; i < 5; i += 1) {
    order.push(await page.evaluate(() => document.activeElement.getAttribute('data-key')));
    await page.keyboard.press('Tab');
  }
  assert.deepEqual(order, ['g|gA', 'gA|r0', 'gA|r1', 'g|gB', 'gB|r2']);
  await page.focus('.clash-group-row button >> nth=1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.focus('[data-key="gA|r1"]');
  await page.keyboard.press('Space');
  assert.deepEqual(await intents(page), [
    { type: 'group/toggle', groupId: 'gB' }, { type: 'group/toggle', groupId: 'gB' },
    { type: 'nav/select', resultId: 'r1', groupId: 'gA' },
  ]);
}));

test('results ARIA: focus on a group header or an option inside a group survives a grouped re-render', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: GROUPED_ROWS() }));
  for (const key of ['g|gB', 'gA|r1']) {
    await page.focus(`[data-key="${key}"]`);
    await rerender(page, resultsVm({ view: 'grouped', rows: GROUPED_ROWS() }));
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-key')), key);
  }
}));

test('results ARIA: a page that starts mid-group (options before any header) still nests options in a listbox; collapsed groups emit no empty listbox', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: [
    resultRow(5, { groupId: 'gA', key: 'gA|r5' }),
    groupRow('gB', { label: 'Structure · Beam-9', count: 1, filteredCount: 1, expanded: false }),
  ] }));
  const r = await page.evaluate(() => ({
    listboxes: document.querySelectorAll('[role="listbox"]').length,
    emptyListboxes: [...document.querySelectorAll('[role="listbox"]')].filter((lb) => lb.children.length === 0).length,
    orphanOptions: [...document.querySelectorAll('[role="option"]')].filter((o) => o.parentElement.getAttribute('role') !== 'listbox').length,
  }));
  assert.deepEqual(r, { listboxes: 1, emptyListboxes: 0, orphanOptions: 0 });
}));

test('results ARIA: the flat view is unchanged — one listbox "Clash results" owning only options', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ rows: [resultRow(0), resultRow(1)] }));
  const r = await page.evaluate(() => ({
    listboxes: [...document.querySelectorAll('[role="listbox"]')].map((lb) => [lb.getAttribute('aria-label'), [...lb.children].map((c) => c.getAttribute('role'))]),
  }));
  assert.deepEqual(r.listboxes, [['Clash results', ['option', 'option']]]);
}));
