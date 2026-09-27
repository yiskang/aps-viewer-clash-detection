// test/clashpanel/dom/setup.dom.mjs — Region 1 TEST SETUP (Task 28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents, snapshot } from './support/harness.mjs';
import { setupVm } from './support/vmFixtures.mjs';

const SETUP = ['/clashpanel/ui/render/setup.js', 'renderSetup'];

test('setup: every control dispatches its exact INTENT payload', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ softAvailability: { available: true, pending: false, explanation: null } }));
  await page.fill('[data-key="setup-name"]', 'Level 2 MEP');
  await page.check('[data-key="setup-mode-soft"]');
  await page.click('[data-key="setup-B-mA"]');
  await page.click('[data-key="setup-A-mB"]');
  await page.click('[data-key="setup-use-selection-B"]');
  await page.check('[data-key="setup-self-clash"]');
  await page.click('[data-key="setup-new-test"]');
  assert.deepEqual(await intents(page), [
    { type: 'setup/name', value: 'Level 2 MEP' },
    { type: 'setup/mode', value: 'soft' },
    { type: 'setup/toggleModel', side: 'B', modelKey: 'mA' },
    { type: 'setup/toggleModel', side: 'A', modelKey: 'mB' },
    { type: 'setup/useSelection', side: 'B' },
    { type: 'setup/selfClash', value: true },
    { type: 'setup/newTest' },
  ]);
}));

test('setup: Soft unavailable ⇒ Soft radio disabled, fixed explanation shown, no clearance field', () => withPage(async ({ page }) => {
  const explanation = "Soft (clearance) isn't available for these models: they don't share a verified common measurement basis.";
  await mountRenderer(page, ...SETUP, setupVm({ softAvailability: { available: false, pending: false, explanation } }));
  const r = await page.evaluate(() => ({
    softDisabled: document.querySelector('[data-key="setup-mode-soft"]').disabled,
    hardDisabled: document.querySelector('[data-key="setup-mode-hard"]').disabled,
    explanation: document.querySelector('.clash-soft-explanation')?.textContent ?? null,
    clearance: document.querySelector('[data-key="setup-clearance"]'),
  }));
  assert.deepEqual(r, { softDisabled: true, hardDisabled: false, explanation, clearance: null });
}));

test('setup: clearance field only when visible; input dispatches the raw string; error is shown', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ mode: 'soft', clearance: { value: '0.5', visible: true, error: 'Enter a clearance greater than 0' } }));
  const r = await page.evaluate(() => ({
    value: document.querySelector('[data-key="setup-clearance"]').value,
    invalid: document.querySelector('[data-key="setup-clearance"]').getAttribute('aria-invalid'),
    error: document.querySelector('.clash-clearance .clash-field-error').textContent,
  }));
  assert.deepEqual(r, { value: '0.5', invalid: 'true', error: 'Enter a clearance greater than 0' });
  await page.fill('[data-key="setup-clearance"]', 'abc');
  assert.deepEqual((await intents(page)).at(-1), { type: 'setup/clearance', value: 'abc' });
}));

test('setup: self-clash hides Set B; model states and notes are listed; Use selection disabled per vm', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ selfClash: true, useSelectionEnabled: false }));
  const r = await page.evaluate(() => ({
    setB: document.querySelector('.clash-set-B'),
    setA: document.querySelectorAll('.clash-set-A .clash-model').length,
    useSelA: document.querySelector('[data-key="setup-use-selection-A"]').disabled,
    note: document.querySelectorAll('.clash-set-A .clash-model')[2].textContent,
    selfChecked: document.querySelector('[data-key="setup-self-clash"]').checked,
  }));
  assert.equal(r.setB, null);
  assert.equal(r.setA, 3);
  assert.equal(r.useSelA, true);
  assert.equal(r.note, 'Mechanical (loading) Model Mechanical is still loading');
  assert.equal(r.selfChecked, true);
}));

test('setup: validation ✔ Ready vs ✖ list with truncation; collapsed shows only the one-line summary', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm());
  assert.equal(await page.textContent('.clash-validation-head'), '✔ Ready');
  await rerender(page, setupVm({ validation: { state: 'blocked', messages: [{ control: 'setB', text: 'Set B is empty' }, { control: 'general', text: 'Model X is still loading' }], issuesTruncated: true } }));
  const blocked = await page.evaluate(() => ({
    head: document.querySelector('.clash-validation-head').textContent,
    items: [...document.querySelectorAll('.clash-validation-list li')].map((li) => [li.dataset.control, li.textContent]),
    truncated: document.querySelector('.clash-validation-truncated') !== null,
  }));
  assert.deepEqual(blocked, { head: '✖ Not ready', items: [['setB', 'Set B is empty'], ['general', 'Model X is still loading']], truncated: true });
  await rerender(page, setupVm({ collapsed: true }));
  const collapsed = await page.evaluate(() => ({
    summary: document.querySelector('.clash-setup-summary').textContent,
    inputs: document.querySelectorAll('#clash-root input').length,
  }));
  assert.deepEqual(collapsed, { summary: 'Clash test 1 · Hard · A: Architecture · B: Structure', inputs: 0 });
}));

test('setup: re-render is idempotent and keeps focus + caret of the active input', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm());
  const before = await snapshot(page);
  await rerender(page, setupVm());
  assert.deepEqual(await snapshot(page), before);
  await page.focus('[data-key="setup-name"]');
  await page.evaluate(() => document.querySelector('[data-key="setup-name"]').setSelectionRange(3, 5));
  await rerender(page, setupVm({ name: 'Clash test 1 renamed' }));
  const r = await page.evaluate(() => {
    const a = document.activeElement;
    return { key: a.getAttribute('data-key'), value: a.value, start: a.selectionStart, end: a.selectionEnd, count: document.querySelectorAll('[data-key="setup-name"]').length };
  });
  assert.deepEqual(r, { key: 'setup-name', value: 'Clash test 1 renamed', start: 3, end: 5, count: 1 });
}));

test('setup: the collapse toggle reflects vm.setup.collapsed (aria-expanded) and dispatches setup/toggleCollapsed', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ collapsed: false }));
  assert.deepEqual(await page.evaluate(() => {
    const b = document.querySelector('[data-key="setup-toggle-collapsed"]');
    return [b.getAttribute('aria-expanded'), b.textContent];
  }), ['true', '▾ Hide setup']);
  await page.click('[data-key="setup-toggle-collapsed"]');
  await rerender(page, setupVm({ collapsed: true }));
  assert.deepEqual(await page.evaluate(() => {
    const b = document.querySelector('[data-key="setup-toggle-collapsed"]');
    return [b.getAttribute('aria-expanded'), b.textContent, document.activeElement === b];
  }), ['false', '▸ Show setup', true]);
  await page.click('[data-key="setup-toggle-collapsed"]');
  assert.deepEqual(await intents(page), [{ type: 'setup/toggleCollapsed' }, { type: 'setup/toggleCollapsed' }]);
}));
