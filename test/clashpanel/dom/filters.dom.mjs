// test/clashpanel/dom/filters.dom.mjs — Region 3 FILTERS / GROUPING (Task 29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents, snapshot } from './support/harness.mjs';
import { filtersVm } from './support/vmFixtures.mjs';

const FILTERS = ['/clashpanel/ui/render/filters.js', 'renderFilters'];

test('filters: every control dispatches its exact INTENT payload immediately (no UI debounce)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ active: true }));
  await page.type('[data-key="filter-text"]', 'wa');
  await page.selectOption('[data-key="filter-model"]', 'mB');
  await page.selectOption('[data-key="filter-model"]', '');
  await page.check('[data-key="filter-unverified"]');
  await page.check('[data-key="filter-has-location"]');
  await page.check('[data-key="group-element"]');
  await page.selectOption('[data-key="sort"]', 'gap-asc');
  await page.click('[data-key="filter-clear"]');
  assert.deepEqual(await intents(page), [
    { type: 'filter/text', value: 'w' },
    { type: 'filter/text', value: 'wa' },
    { type: 'filter/model', value: ['mB'] },
    { type: 'filter/model', value: [] },
    { type: 'filter/unverified', value: true },
    { type: 'filter/hasLocation', value: true },
    { type: 'group/mode', value: 'element' },
    { type: 'sort/set', value: 'gap-asc' },
    { type: 'filter/clear' },
  ]);
}));

test('filters: Group offers None / Element / Model Pair / Category / Level (single-level, one active mode); each dispatches group/mode', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ groupBy: 'modelPair' }));
  const r = await page.evaluate(() => ({
    radios: [...document.querySelectorAll('.clash-group input[type="radio"]')].map((i) => [i.value, i.closest('label').textContent, i.checked]),
    names: new Set([...document.querySelectorAll('.clash-group input[type="radio"]')].map((i) => i.name)).size,
  }));
  assert.deepEqual(r.radios, [
    ['none', 'None', false], ['element', 'Element', false], ['modelPair', 'Model Pair', true], ['category', 'Category', false], ['level', 'Level', false],
  ]);
  assert.equal(r.names, 1, 'one radio group: exactly one active mode');
  for (const value of ['element', 'modelPair', 'category', 'level', 'none']) await page.check(`[data-key="group-${value}"]`);
  assert.deepEqual(await intents(page), ['element', 'modelPair', 'category', 'level', 'none'].map((value) => ({ type: 'group/mode', value })));
}));

test('filters: Category / Level checked state and a metadata-mode unavailable note render as text', () => withPage(async ({ page }) => {
  const note = 'Category grouping is unavailable (element properties could not be read) — showing the flat list.';
  await mountRenderer(page, ...FILTERS, filtersVm({ groupBy: 'category', groupingNote: note }));
  let r = await page.evaluate(() => ({
    checked: [...document.querySelectorAll('.clash-group input[type="radio"]')].filter((i) => i.checked).map((i) => i.value),
    note: document.querySelector('.clash-grouping-note')?.textContent ?? null,
  }));
  assert.deepEqual(r, { checked: ['category'], note });
  await rerender(page, filtersVm({ groupBy: 'level', groupingNote: null }));
  r = await page.evaluate(() => ({
    checked: [...document.querySelectorAll('.clash-group input[type="radio"]')].filter((i) => i.checked).map((i) => i.value),
    note: document.querySelector('.clash-grouping-note'),
  }));
  assert.deepEqual(r, { checked: ['level'], note: null });
}));

test('filters: Max gap appears only when visible (Soft), shows its bound and error, dispatches the raw string', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm());
  assert.equal(await page.$('[data-key="filter-max-gap"]'), null);
  await rerender(page, filtersVm({ maxGap: { visible: true, value: '0.2', max: 0.5, error: 'Max gap must be at most the clearance (0.5)' } }));
  const r = await page.evaluate(() => ({
    label: document.querySelector('.clash-filter-max-gap label span').textContent,
    value: document.querySelector('[data-key="filter-max-gap"]').value,
    error: document.querySelector('.clash-filter-max-gap .clash-field-error').textContent,
  }));
  assert.deepEqual(r, { label: 'Max gap (≤ 0.5) ', value: '0.2', error: 'Max gap must be at most the clearance (0.5)' });
  await page.fill('[data-key="filter-max-gap"]', '0.3');
  assert.deepEqual(await intents(page), [{ type: 'filter/maxGap', value: '0.3' }]);
}));

test('filters: vm values are reflected (select values, radios, checkboxes, Clear disabled when inactive)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ text: 'duct', models: ['mA'], groupBy: 'element', sort: 'gap-asc', unverified: true, active: false }));
  const r = await page.evaluate(() => ({
    text: document.querySelector('[data-key="filter-text"]').value,
    model: document.querySelector('[data-key="filter-model"]').value,
    group: document.querySelector('[data-key="group-element"]').checked,
    none: document.querySelector('[data-key="group-none"]').checked,
    sort: document.querySelector('[data-key="sort"]').value,
    unverified: document.querySelector('[data-key="filter-unverified"]').checked,
    clearDisabled: document.querySelector('[data-key="filter-clear"]').disabled,
  }));
  assert.deepEqual(r, { text: 'duct', model: 'mA', group: true, none: false, sort: 'gap-asc', unverified: true, clearDisabled: true });
}));

test('filters: element-only chip clears with {ref:null}; grouping note and busy state are shown', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ elementOnly: { modelKey: 'mA', dbId: 7, label: 'Wall-7' }, groupingNote: 'Grouping unavailable — showing the flat list', busy: true, active: true }));
  const r = await page.evaluate(() => ({
    chip: document.querySelector('.clash-filter-element span').textContent,
    note: document.querySelector('.clash-grouping-note').textContent,
    busy: document.querySelector('.clash-filters').getAttribute('aria-busy'),
    busyText: document.querySelector('.clash-filters-busy').textContent,
  }));
  assert.deepEqual(r, { chip: 'Only clashes involving Wall-7 ', note: 'Grouping unavailable — showing the flat list', busy: 'true', busyText: 'Updating results…' });
  await page.click('[data-key="filter-element-clear"]');
  assert.deepEqual(await intents(page), [{ type: 'filter/element', ref: null }]);
}));

test('filters: typing survives a re-render (focus + caret on the text box) and re-render is idempotent', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ text: 'abc' }));
  const first = await snapshot(page);
  await rerender(page, filtersVm({ text: 'abc' }));
  assert.deepEqual(await snapshot(page), first);
  await page.focus('[data-key="filter-text"]');
  await page.evaluate(() => document.querySelector('[data-key="filter-text"]').setSelectionRange(1, 1));
  await rerender(page, filtersVm({ text: 'abc', busy: true }));
  const r = await page.evaluate(() => ({ key: document.activeElement.getAttribute('data-key'), caret: document.activeElement.selectionStart }));
  assert.deepEqual(r, { key: 'filter-text', caret: 1 });
}));

test('filters: hostile model labels and element-only labels are inert text', () => withPage(async ({ page }) => {
  const hostile = '<img src=x onerror=window.__pwned=1>';
  await mountRenderer(page, ...FILTERS, filtersVm({ modelOptions: [{ modelKey: 'mA', label: hostile }], elementOnly: { modelKey: 'mA', dbId: 1, label: hostile } }));
  const r = await page.evaluate(() => ({
    imgs: document.querySelectorAll('img').length,
    option: document.querySelector('[data-key="filter-model"] option[value="mA"]').textContent,
    pwned: window.__pwned ?? null,
  }));
  assert.deepEqual(r, { imgs: 0, option: hostile, pwned: null });
}));

test('filters: several selected models render an honest disabled "Multiple models (n)" option; picking one replaces them', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...FILTERS, filtersVm({ models: ['mA', 'mB'], active: true }));
  const r = await page.evaluate(() => {
    const s = document.querySelector('[data-key="filter-model"]');
    const o = s.selectedOptions[0];
    return { text: o.textContent, disabled: o.disabled, index: s.selectedIndex, options: s.options.length };
  });
  assert.deepEqual(r, { text: 'Multiple models (2)', disabled: true, index: 0, options: 4 });
  await page.selectOption('[data-key="filter-model"]', 'mA');
  await page.selectOption('[data-key="filter-model"]', '');
  assert.deepEqual(await intents(page), [{ type: 'filter/model', value: ['mA'] }, { type: 'filter/model', value: [] }]);
  await rerender(page, filtersVm({ models: ['mB'] }));
  assert.deepEqual(await page.evaluate(() => {
    const s = document.querySelector('[data-key="filter-model"]');
    return [s.value, s.querySelector('[data-multiple]')];
  }), ['mB', null]);
}));
