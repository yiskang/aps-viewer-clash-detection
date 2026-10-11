// test/clashpanel/dom/results.dom.mjs — Region 4 RESULTS: rows, groups, selection, Prev/Next, pagination, states (Task 29).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
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
  const r = await page.evaluate(() => [...document.querySelectorAll('.clash-group-row')].map((row) => {
    const t = row.querySelector('.clash-group-toggle');
    const b = row.querySelector('.clash-group-body');
    return [t.getAttribute('aria-expanded'), t.textContent, t.getAttribute('aria-label'), b.textContent];
  }));
  assert.deepEqual(r, [
    ['true', '▾ ', 'Collapse group Architecture · Wall-1', 'Architecture · Wall-1 (2 of 4)'],
    ['false', '▸ ', 'Expand group Structure · Beam-9', 'Structure · Beam-9 (1)'],
  ]);
  await page.click('.clash-group-toggle >> nth=1');
  assert.deepEqual(await intents(page), [{ type: 'group/toggle', groupId: 'gB' }]);
}));

test('results: Prev/Next disabled per vm.nav; pagination ‹ Page n of N › dispatches nav/page and disables at the ends', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ page: { index: 1, count: 3, size: PAGE_SIZE }, nav: { canPrev: true, canNext: false, label: '12 of 812' } }));
  const r = await page.evaluate(() => ({
    prev: document.querySelector('[data-key="nav-prev"]').disabled, next: document.querySelector('[data-key="nav-next"]').disabled,
    label: document.querySelector('.clash-page-label').textContent, navLabel: document.querySelector('.clash-nav-label').textContent,
    pPrev: document.querySelector('[data-key="page-prev"]').disabled, pNext: document.querySelector('[data-key="page-next"]').disabled,
  }));
  assert.deepEqual(r, { prev: false, next: true, label: ' Page 2 of 3 ', navLabel: ' 12 of 812 ', pPrev: false, pNext: false });
  await page.click('[data-key="nav-prev"]');
  await page.click('[data-key="page-prev"]');
  await page.click('[data-key="page-next"]');
  assert.deepEqual(await intents(page), [{ type: 'nav/prev' }, { type: 'nav/page', page: 0 }, { type: 'nav/page', page: 2 }]);
  await rerender(page, resultsVm({ page: { index: 2, count: 3, size: PAGE_SIZE }, nav: { canPrev: true, canNext: true, label: '' } }));
  assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-key="page-prev"]').disabled, document.querySelector('[data-key="page-next"]').disabled]), [false, true]);
  await page.click('[data-key="nav-next"]');
  assert.deepEqual((await intents(page)).at(-1), { type: 'nav/next' });
}));

const navShape = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.clash-nav > .clash-nav-row')];
  const btn = (k) => document.querySelector(`[data-key="${k}"]`);
  return {
    rows: rows.map((r) => [r.getAttribute('data-scope'), r.querySelector('.clash-nav-scope').textContent]),
    selectedHas: [...rows[0].querySelectorAll('button')].map((b) => b.getAttribute('data-key')),
    pagesHas: [...rows[1].querySelectorAll('button')].map((b) => b.getAttribute('data-key')),
    grouped: rows[0].getAttribute('data-group-scoped'),
    text: [btn('nav-prev').textContent, btn('nav-next').textContent],
    aria: [btn('nav-prev').getAttribute('aria-label'), btn('nav-next').getAttribute('aria-label')],
    navLabel: rows[0].querySelector('.clash-nav-label').textContent.trim(),
    pageLabel: rows[1].querySelector('.clash-page-label').textContent.trim(),
    all: document.querySelector('.clash-nav').textContent,
  };
});

test('results: nav renders two separate labelled rows; plain Previous/Next when the scope is not constrained', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ page: { index: 0, count: 4, size: PAGE_SIZE }, nav: { canPrev: true, canNext: true, label: 'Clash #7', scoped: false } }));
  const r = await navShape(page);
  assert.deepEqual(r.rows, [['selected-clash', 'Selected clash'], ['result-pages', 'Result pages']]);
  assert.deepEqual(r.selectedHas, ['nav-prev', 'nav-next']);
  assert.deepEqual(r.pagesHas, ['page-prev', 'page-next']);
  assert.equal(r.grouped, 'false');
  assert.deepEqual(r.text, ['◀ Previous', 'Next ▶']);
  assert.deepEqual(r.aria, ['Previous clash', 'Next clash']);
  assert.equal(r.navLabel, 'Clash #7');
  assert.equal(r.pageLabel, 'Page 1 of 4');
  assert.doesNotMatch(r.all, /group/i);
}));

test('results: "in group" button wording only while nav.scoped, with no duplicate suffix, and it disappears when scope ends', () => withPage(async ({ page }) => {
  const vm = (scoped) => resultsVm({ nav: { canPrev: true, canNext: false, label: 'Clash #3', scoped } });
  await mountRenderer(page, ...RESULTS, vm(true));
  let r = await navShape(page);
  assert.equal(r.grouped, 'true');
  assert.deepEqual(r.text, ['◀ Previous in group', 'Next in group ▶']);
  assert.deepEqual(r.aria, ['Previous clash in group', 'Next clash in group']);
  assert.equal(r.navLabel, 'Clash #3');
  assert.equal((r.all.match(/in group/g) ?? []).length, 2, 'only the two buttons carry the wording');
  assert.doesNotMatch(r.all, /within its group/);
  await page.click('[data-key="nav-prev"]');
  assert.deepEqual(await intents(page), [{ type: 'nav/prev' }]);       // same intent as before
  for (const scoped of [false, true, false]) {                           // filtered-away origin / collapse / None / mode switch all arrive as scoped:false
    await rerender(page, vm(scoped));
    r = await navShape(page);
    assert.deepEqual(r.text, scoped ? ['◀ Previous in group', 'Next in group ▶'] : ['◀ Previous', 'Next ▶']);
    assert.equal(r.grouped, String(scoped));
  }
}));

test('results: page row semantics unchanged (disabled ends, nav/page intents) and independent of the group wording', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ page: { index: 0, count: 2, size: PAGE_SIZE }, nav: { canPrev: false, canNext: true, label: 'Clash #1', scoped: true } }));
  const dis = () => page.evaluate(() => [document.querySelector('[data-key="page-prev"]').disabled, document.querySelector('[data-key="page-next"]').disabled, document.querySelector('[data-key="page-prev"]').getAttribute('aria-label'), document.querySelector('[data-key="page-next"]').getAttribute('aria-label')]);
  assert.deepEqual(await dis(), [true, false, 'Previous page', 'Next page']);
  await page.click('[data-key="page-next"]');
  assert.deepEqual(await intents(page), [{ type: 'nav/page', page: 1 }]);
}));

test('results: narrow layout — rows stack, labels sit above controls, no horizontal overflow at a 460px panel in a 480px viewport', () => withPage(async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.addStyleTag({ content: readFileSync(new URL('../../../wwwroot/main.css', import.meta.url), 'utf8') });
  await mountRenderer(page, ...RESULTS, resultsVm({ page: { index: 11, count: 120, size: PAGE_SIZE }, nav: { canPrev: true, canNext: true, label: 'Clash #6999', scoped: true } }));
  const r = await page.evaluate(() => {
    const root = document.querySelector('#clash-root');
    root.classList.add('clash-panel-root');
    root.style.width = '460px';
    const nav = document.querySelector('.clash-nav');
    const [a, b] = [...nav.querySelectorAll(':scope > .clash-nav-row')];
    const cs = (e) => getComputedStyle(e);
    return {
      navFlex: [cs(nav).display, cs(nav).flexDirection],
      rowsStacked: a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1,
      scopeAbove: a.querySelector('.clash-nav-scope').getBoundingClientRect().bottom <= a.querySelector('button').getBoundingClientRect().top + 1,
      overflow: nav.scrollWidth > nav.clientWidth + 1 || document.documentElement.scrollWidth > 480,
      controlsWrap: cs(a.querySelector('.clash-nav-controls')).flexWrap,
    };
  });
  assert.deepEqual(r, { navFlex: ['flex', 'column'], rowsStacked: true, scopeAbove: true, overflow: false, controlsWrap: 'wrap' });
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

test('results: a Model Pair group header shows the pair label and count only (no element label / dbId)', () => withPage(async ({ page }) => {
  const gp = JSON.stringify(['pairModels', {}, ['mA', 'mB']]);
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: [
    groupRow(gp, { label: 'Architecture ↔ Structure', count: 1211, filteredCount: 40, expanded: true }),
    resultRow(0, { groupId: gp, key: `${gp}|r0` }),
    groupRow(JSON.stringify(['pairModels', {}, ['mA', 'mA']]), { label: 'Architecture ↔ Architecture', count: 3, filteredCount: 3, expanded: false }),
  ] }));
  const r = await page.evaluate(() => ({
    headers: [...document.querySelectorAll('.clash-group-body')].map((b) => [b.querySelector('.clash-group-label').textContent, b.querySelector('.clash-group-count').textContent, b.querySelectorAll('.clash-dbid, .clash-label').length]),
    listbox: [...document.querySelectorAll('.clash-rows[role="listbox"]')].map((u) => u.getAttribute('aria-label')),
    note: document.querySelector('.clash-multivalued-note'),
  }));
  assert.deepEqual(r.headers, [['Architecture ↔ Structure', ' (40 of 1211)', 0], ['Architecture ↔ Architecture', ' (3)', 0]]);
  assert.deepEqual(r.listbox, ['Architecture ↔ Structure']);
  assert.equal(r.note, null);
  await page.click('.clash-group-toggle >> nth=1');
  assert.deepEqual(await intents(page), [{ type: 'group/toggle', groupId: JSON.stringify(['pairModels', {}, ['mA', 'mA']]) }]);
}));

test('results: Category / Level group headers show the metadata pair label and count (raw labels via textContent)', () => withPage(async ({ page }) => {
  const c1 = JSON.stringify(['category', ['Revit Ducts', 'Revit Walls']]);
  const c2 = JSON.stringify(['category', ['Revit Walls', null]]);
  const l1 = JSON.stringify(['level', ['FIRST FLOOR', 'SECOND FLOOR']]);
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: [
    groupRow(c1, { label: 'Ducts ↔ Walls', count: 12, filteredCount: 12, expanded: true }),
    resultRow(0, { groupId: c1, key: `${c1}|r0` }),
    groupRow(c2, { label: 'Walls ↔ Unknown category', count: 3, filteredCount: 1, expanded: false }),
    groupRow(l1, { label: '<b>FIRST FLOOR</b> ↔ SECOND FLOOR', count: 2, filteredCount: 2, expanded: false }),
  ] }));
  const r = await page.evaluate(() => ({
    headers: [...document.querySelectorAll('.clash-group-body')].map((b) => [b.querySelector('.clash-group-label').textContent, b.querySelector('.clash-group-count').textContent]),
    bold: document.querySelectorAll('.clash-group-row b').length,
    note: document.querySelector('.clash-multivalued-note'),
  }));
  assert.deepEqual(r.headers, [['Ducts ↔ Walls', ' (12)'], ['Walls ↔ Unknown category', ' (1 of 3)'], ['<b>FIRST FLOOR</b> ↔ SECOND FLOOR', ' (2)']]);
  assert.equal(r.bold, 0, 'metadata text is never markup');
  assert.equal(r.note, null);
  await page.click('.clash-group-toggle >> nth=2');
  assert.deepEqual(await intents(page), [{ type: 'group/toggle', groupId: l1 }]);
}));

test('results: empty-filtered grouped state renders no grouping note and no group rows', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ state: 'empty-filtered', view: 'grouped', message: 'No clashes match the current filters.', rows: [], multiValuedNote: null }));
  const r = await page.evaluate(() => ({
    note: document.querySelector('.clash-multivalued-note'),
    groups: document.querySelectorAll('.clash-group-row').length,
    clear: document.querySelector('[data-key="results-clear-filters"]')?.textContent ?? null,
  }));
  assert.deepEqual(r, { note: null, groups: 0, clear: 'Clear filters' });
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
      toggles: document.querySelectorAll('.clash-group-row > .clash-group-toggle').length,
      bodies: document.querySelectorAll('.clash-group-row > .clash-group-body').length,
      optionsOutsideListbox: [...document.querySelectorAll('[role="option"]')].filter((o) => o.parentElement.getAttribute('role') !== 'listbox').length,
      labels: listboxes.map((lb) => lb.getAttribute('aria-label')),
    };
  });
  assert.deepEqual(r.ownedRoles, [['option', 'option'], ['option']]);
  assert.equal(r.buttonsInsideListbox, 0);
  assert.equal(r.groupButtons, 6, 'two sibling buttons per group header');
  assert.deepEqual([r.toggles, r.bodies], [3, 3]);
  assert.equal(r.optionsOutsideListbox, 0);
  assert.deepEqual(r.labels, ['Architecture · Wall-1', 'Structure · Beam-9']); // each group's options are named by their group
}));

test('results ARIA: grouped Tab order is header (disclosure → body) → its options → next header; Enter/Space on the disclosure toggles; option Enter still selects', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, resultsVm({ view: 'grouped', rows: GROUPED_ROWS() }));
  await page.focus('.clash-group-toggle >> nth=0');
  const order = [];
  for (let i = 0; i < 7; i += 1) {
    order.push(await page.evaluate(() => document.activeElement.getAttribute('data-key')));
    await page.keyboard.press('Tab');
  }
  assert.deepEqual(order, ['g|gA', 'g|gA|present', 'gA|r0', 'gA|r1', 'g|gB', 'g|gB|present', 'gB|r2']);
  await page.focus('.clash-group-toggle >> nth=1');
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

// ── Addendum B1 (spec §27.1, AC-GP1/GP2): sibling native disclosure + row-body buttons ─────────────────────────────

const groupedVm = (over = {}) => resultsVm({ view: 'grouped', rows: [
  groupRow('gA', { label: 'Architecture · Wall-1', count: 4, filteredCount: 2, expanded: true, ...over.gA }),
  resultRow(0, { groupId: 'gA', key: 'gA|r0' }),
  groupRow('gB', { label: 'Structure · Beam-9', count: 1, filteredCount: 1, expanded: false, ...over.gB }),
] });

test('B1: every group header is two SIBLING native buttons (disclosure + body), no nested interactive element', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, groupedVm());
  const r = await page.evaluate(() => [...document.querySelectorAll('.clash-group-row')].map((row) => ({
    kids: [...row.children].map((c) => [c.tagName, c.type, c.className]),
    nested: row.querySelectorAll('button button, button a, button input, button [tabindex], button [role="button"]').length,
    keys: [...row.querySelectorAll('button')].map((b) => b.getAttribute('data-key')),
  })));
  for (const g of r) {
    assert.deepEqual(g.kids, [['BUTTON', 'button', 'clash-group-toggle'], ['BUTTON', 'button', 'clash-group-body']]);
    assert.equal(g.nested, 0);
  }
  assert.deepEqual(r[0].keys, ['g|gA', 'g|gA|present']);
  assert.equal(new Set(r.flatMap((g) => g.keys)).size, 4, 'data-keys are unique');
}));

test('B1/AC-GP1: disclosure click/Enter/Space dispatch only group/toggle; body click/Enter/Space only group/present', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, groupedVm());
  await page.click('[data-key="g|gA"]');
  await page.focus('[data-key="g|gA"]');
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  assert.deepEqual(await intents(page), [
    { type: 'group/toggle', groupId: 'gA' }, { type: 'group/toggle', groupId: 'gA' }, { type: 'group/toggle', groupId: 'gA' },
  ]);
  await page.evaluate(() => { window.__clash.intents.length = 0; });
  await page.click('[data-key="g|gA|present"]');
  await page.focus('[data-key="g|gB|present"]');
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  assert.deepEqual(await intents(page), [
    { type: 'group/present', groupId: 'gA' }, { type: 'group/present', groupId: 'gB' }, { type: 'group/present', groupId: 'gB' },
  ]);
}));

test('B1: selected group exposes aria-current + a selected class on its row; an unselected one does not; listbox semantics of children unchanged', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, groupedVm({ gB: { selected: true } }));
  const r = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.clash-group-row')].map((row) => [row.classList.contains('clash-group-row-selected'), row.querySelector('.clash-group-body').getAttribute('aria-current'), row.querySelector('.clash-group-toggle').hasAttribute('aria-current')]),
    option: [...document.querySelectorAll('.clash-row')].map((li) => [li.getAttribute('role'), li.getAttribute('aria-selected')]),
    listbox: [...document.querySelectorAll('.clash-rows')].map((u) => u.getAttribute('role')),
  }));
  assert.deepEqual(r.rows, [[false, null, false], [true, 'true', false]]);
  assert.deepEqual(r.option, [['option', 'false']]);
  assert.deepEqual(r.listbox, ['listbox']);
}));

test('B1: focus on the disclosure / body button survives a rerender (expand/collapse, selection change)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RESULTS, groupedVm());
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-key'));
  await page.focus('[data-key="g|gB"]');
  await rerender(page, groupedVm({ gB: { expanded: true } }));
  assert.equal(await active(), 'g|gB', 'disclosure keeps focus across expand');
  await page.focus('[data-key="g|gB|present"]');
  await rerender(page, groupedVm({ gB: { selected: true } }));
  assert.equal(await active(), 'g|gB|present', 'body keeps focus across selection');
  await rerender(page, groupedVm({ gB: { selected: true, expanded: true } }));
  assert.equal(await active(), 'g|gB|present', 'and across a later expand');
}));
