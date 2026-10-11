// test/clashpanel/dom/selected.dom.mjs — Region 5 SELECTED CLASH actions (Task 30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { selectedVm, groupSelectedVm, side } from './support/vmFixtures.mjs';

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

// ── Addendum B5 (spec §27.4/§27.5, AC-GP7/GP8): the group-selected variant ─────────────────────────────────────────────

const GROUP_REASON = 'Markers are unavailable for a clash group.';

test('B5 group variant: label, counts, shown/unavailable note and ONLY the applicable actions; no child detail', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, groupSelectedVm({ unavailable: 2, shown: 3, unavailableNote: '2 of 5 participants are not shown (model not loaded).', notes: ['note-x'] }));
  const r = await page.evaluate(() => ({
    title: document.querySelector('.clash-selected-title').textContent,
    counts: document.querySelector('.clash-selected-group-counts').textContent,
    unavailable: document.querySelector('.clash-selected-group-unavailable').textContent,
    notes: [...document.querySelectorAll('.clash-selected-notes li')].map((li) => li.textContent),
    keys: [...document.querySelectorAll('#clash-root [data-key]')].map((n) => n.getAttribute('data-key')),
    child: ['.clash-detail-side', '.clash-selected-gap', '.clash-selected-location', '.clash-selected-liveness', '.clash-hidden-note', '[data-key^="selected-only-"]']
      .filter((sel) => document.querySelector(sel) !== null),
    root: document.querySelector('.clash-selected').getAttribute('data-group-id'),
  }));
  assert.deepEqual(r.title, 'Architecture ↔ Structure');
  assert.equal(r.counts, '3 clashes · 5 participants');
  assert.equal(r.unavailable, '2 of 5 participants are not shown (model not loaded).');
  assert.deepEqual(r.notes, ['note-x']);
  assert.deepEqual(r.keys, ['action-focus', 'action-isolate', 'action-markers', 'action-focus-on-select', 'action-back-to-all']);
  assert.deepEqual(r.child, [], 'no child ordinal/sides/gap/location/liveness/element-only controls');
  assert.equal(r.root, 'g1');
}));

test('B5 group variant: Markers is disabled with the exact reason as title, visible text and aria-describedby; clicking dispatches nothing', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, groupSelectedVm());
  const r = await page.evaluate(() => {
    const m = document.querySelector('[data-key="action-markers"]');
    const reason = document.getElementById(m.getAttribute('aria-describedby'));
    return { disabled: m.disabled, checked: m.checked, title: m.title, described: reason?.textContent.trim(), visible: document.querySelector('.clash-action-markers .clash-reason').textContent };
  });
  assert.deepEqual(r, { disabled: true, checked: false, title: GROUP_REASON, described: GROUP_REASON, visible: ` ${GROUP_REASON}` });
  await page.click('[data-key="action-markers"]', { force: true });
  assert.deepEqual(await intents(page), []);
}));

test('B5 group variant: Focus, Isolate, Focus-on-select and Back to all dispatch the existing intents', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, groupSelectedVm());
  await page.click('[data-key="action-focus"]');
  await page.check('[data-key="action-isolate"]');
  await page.uncheck('[data-key="action-focus-on-select"]');
  await page.click('[data-key="action-back-to-all"]');
  assert.deepEqual(await intents(page), [
    { type: 'action/focus' }, { type: 'action/isolate', value: true }, { type: 'action/focusOnSelect', value: false }, { type: 'action/backToAll' },
  ]);
}));

test('B5 group variant: live-only actions disabled with visible reasons when no participant is live', () => withPage(async ({ page }) => {
  const reason = 'Viewer actions are unavailable: no participant model is loaded.';
  const a = groupSelectedVm().actions;
  await mountRenderer(page, ...SELECTED, groupSelectedVm({ shown: 0, unavailable: 5, actions: { ...a, focus: { enabled: false, reason }, isolate: { enabled: false, checked: false, reason } } }));
  const r = await page.evaluate(() => ({
    focus: document.querySelector('[data-key="action-focus"]').disabled, isolate: document.querySelector('[data-key="action-isolate"]').disabled,
    back: document.querySelector('[data-key="action-back-to-all"]').disabled,
    focusDescribed: document.getElementById(document.querySelector('[data-key="action-focus"]').getAttribute('aria-describedby'))?.textContent.trim(),
  }));
  assert.deepEqual(r, { focus: true, isolate: true, back: false, focusDescribed: reason });
}));

test('B5 switching group <-> child replaces the variant atomically and restores the single-clash Markers toggle and details', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, selectedVm());
  const snap = () => page.evaluate(() => ({
    child: document.querySelector('.clash-detail-side-1') !== null, group: document.querySelector('.clash-selected-group-counts') !== null,
    markers: (({ disabled, checked }) => ({ disabled, checked }))(document.querySelector('[data-key="action-markers"]')),
    describedby: document.querySelector('[data-key="action-markers"]').hasAttribute('aria-describedby'),
    selectedRoots: document.querySelectorAll('.clash-selected').length, title: document.querySelector('.clash-selected-title').textContent,
  }));
  const childBefore = await snap();
  await rerender(page, groupSelectedVm());
  assert.deepEqual(await snap(), { child: false, group: true, markers: { disabled: true, checked: false }, describedby: true, selectedRoots: 1, title: 'Architecture ↔ Structure' });
  await rerender(page, selectedVm());
  assert.deepEqual(await snap(), childBefore);
  assert.deepEqual(childBefore, { child: true, group: false, markers: { disabled: false, checked: true }, describedby: false, selectedRoots: 1, title: 'Clash #2' });
  await rerender(page, null);
  assert.equal(await page.evaluate(() => document.querySelector('.clash-selected-empty') !== null && document.querySelector('.clash-selected') === null), true);
}));

test('B5 group variant text is inserted as text, never markup', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SELECTED, groupSelectedVm({ label: '<img src=x onerror=alert(1)>' }));
  const r = await page.evaluate(() => ({ imgs: document.querySelectorAll('#clash-root img').length, t: document.querySelector('.clash-selected-title').textContent }));
  assert.deepEqual(r, { imgs: 0, t: '<img src=x onerror=alert(1)>' });
}));
