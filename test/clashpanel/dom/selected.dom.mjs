// test/clashpanel/dom/selected.dom.mjs — Region 5 SELECTED CLASH actions (Task 30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { selectedVm, side } from './support/vmFixtures.mjs';

const SELECTED = ['/clashpanel/ui/render/selected.js', 'renderSelected'];

test('selected: null selection shows the empty prompt and no actions', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, null);
  const r = await page.evaluate(() => ({ text: document.querySelector('.clash-selected-empty').textContent, buttons: document.querySelectorAll('#clash-root button').length }));
  assert.deepEqual(r, { text: 'No clash selected. Select a result to see its details.', buttons: 0 });
}));

test('selected: detail shows Element 1/2, gap, location and liveness notes', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, selectedVm({ gap: '0.031 scene units', liveness: 'reloaded since run', notes: ['Model Structure is not loaded'], side2: side('mB', 'Structure', '#201', 201) }));
  const r = await page.evaluate(() => ({
    title: document.querySelector('.clash-selected-title').textContent,
    s1: document.querySelector('.clash-detail-side-1 .clash-detail-value').textContent,
    s2: document.querySelector('.clash-detail-side-2 .clash-detail-value').textContent,
    gap: document.querySelector('.clash-selected-gap').textContent,
    loc: document.querySelector('.clash-selected-location').textContent,
    live: document.querySelector('.clash-selected-liveness').textContent,
    notes: [...document.querySelectorAll('.clash-selected-notes li')].map((li) => li.textContent),
  }));
  assert.deepEqual(r, {
    title: 'Clash #2', s1: 'Architecture · Wall-1 · #101', s2: 'Structure · #201', gap: 'Gap 0.031 scene units',
    loc: '● Location available', live: 'Model state: reloaded since run', notes: ['Model Structure is not loaded'],
  });
}));

test('selected: Focus, Isolate, Markers, Focus-on-select, Back to all and Show-only dispatch exact intents', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, selectedVm());
  await page.click('[data-key="action-focus"]');
  await page.check('[data-key="action-isolate"]');
  await page.uncheck('[data-key="action-markers"]');
  await page.uncheck('[data-key="action-focus-on-select"]');
  await page.click('[data-key="selected-only-2"]');
  await page.click('[data-key="action-back-to-all"]');
  assert.deepEqual(await intents(page), [
    { type: 'action/focus' },
    { type: 'action/isolate', value: true },
    { type: 'action/markers', value: false },
    { type: 'action/focusOnSelect', value: false },
    { type: 'filter/element', ref: { modelKey: 'mB', dbId: 201 } },
    { type: 'action/backToAll' },
  ]);
}));

test('selected: disabled Isolate carries its reason as title AND visible text; clicking it dispatches nothing', () => withPage(async ({ page }) => {
  const reason = 'Isolate is unavailable: the scene has hidden elements the Panel cannot restore';
  await mountRenderer(page, ...SELECTED, selectedVm({ actions: { ...selectedVm().actions, isolate: { enabled: false, checked: false, reason }, focus: { enabled: false, reason: 'No live side to focus' } } }));
  const r = await page.evaluate(() => ({
    disabled: document.querySelector('[data-key="action-isolate"]').disabled,
    title: document.querySelector('[data-key="action-isolate"]').title,
    visible: document.querySelector('.clash-action-isolate .clash-reason').textContent,
    focusDisabled: document.querySelector('[data-key="action-focus"]').disabled,
    focusTitle: document.querySelector('[data-key="action-focus"]').title,
  }));
  assert.deepEqual(r, { disabled: true, title: reason, visible: ` ${reason}`, focusDisabled: true, focusTitle: 'No live side to focus' });
  await page.click('[data-key="action-isolate"]', { force: true });
  assert.deepEqual(await intents(page), []);
}));

test('selected: checkbox state mirrors vm (checked/unchecked) across re-render; Back to all disabled per vm', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, selectedVm());
  const base = selectedVm().actions;
  await rerender(page, selectedVm({ actions: { ...base, isolate: { enabled: true, checked: true, reason: null }, markers: { enabled: true, checked: false, reason: null }, backToAll: { enabled: false } } }));
  const r = await page.evaluate(() => ({
    iso: document.querySelector('[data-key="action-isolate"]').checked,
    mk: document.querySelector('[data-key="action-markers"]').checked,
    back: document.querySelector('[data-key="action-back-to-all"]').disabled,
  }));
  assert.deepEqual(r, { iso: true, mk: false, back: true });
}));

test('selected: hidden-by-filters and no-location states are stated', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, selectedVm({ hiddenByFilters: true, hasLocation: false }));
  const r = await page.evaluate(() => ({
    hidden: document.querySelector('.clash-hidden-note').textContent,
    loc: document.querySelector('.clash-selected-location').textContent,
  }));
  assert.deepEqual(r, { hidden: 'This clash is hidden by the current filters.', loc: 'No location recorded for this clash' });
}));
