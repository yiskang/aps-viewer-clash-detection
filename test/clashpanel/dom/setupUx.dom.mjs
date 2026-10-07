// test/clashpanel/dom/setupUx.dom.mjs — Test Setup UX cleanup (owner decision 2026-10-07): New test placement, Soft never
// disabled, measurement-basis block, real-Tab focus order, one concise status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withPage, mountRenderer, rerender, intents, REPO_ROOT } from './support/harness.mjs';
import { panelVm, setupVm, runVm } from './support/vmFixtures.mjs';

const SETUP = ['/clashpanel/ui/render/setup.js', 'renderSetup'];
const PANEL = ['/clashpanel/ui/render/panel.js', 'renderPanel'];

const basisOn = (over = {}) => ({
  ...setupVm().basis, required: true, state: 'unavailable',
  headline: 'Soft clearance needs a measurement basis. Hard clash is available.',
  message: 'The host could not verify a common measurement basis for these models.',
  detail: 'models differ', ...over,
});
const softSetup = (over = {}) => setupVm({ mode: 'soft', basis: basisOn(), clearance: { value: '', visible: true, unitLabel: '', error: null }, ...over });

async function tabStops(page, stopKey, max = 60) {
  const visited = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const k = await page.evaluate(() => document.activeElement?.getAttribute('data-key') ?? null);
    visited.push(k);
    if (k === stopKey) break;
  }
  return visited;
}

for (const collapsed of [false, true]) {
  test(`setup UX: New test sits in .clash-setup-actions LEFT of the toggle (${collapsed ? 'collapsed' : 'expanded'}), is secondary, and is not duplicated at the bottom`, () => withPage(async ({ page }) => {
    await mountRenderer(page, ...SETUP, setupVm({ collapsed }));
    const r = await page.evaluate(() => {
      const nt = [...document.querySelectorAll('[data-key="setup-new-test"]')];
      const toggle = document.querySelector('[data-key="setup-toggle-collapsed"]');
      const setup = document.querySelector('.clash-setup');
      return {
        count: nt.length,
        parentClass: nt[0].parentElement.className,
        sameParent: nt[0].parentElement === toggle.parentElement,
        before: Boolean(nt[0].compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING),
        firstChild: nt[0].parentElement === setup.firstElementChild,
        secondary: nt[0].classList.contains('clash-setup-new-test') && !nt[0].classList.contains('clash-run-start') && nt[0].getAttribute('data-key') !== 'run-start',
        notLast: setup.lastElementChild !== nt[0],
        text: nt[0].textContent,
      };
    });
    assert.deepEqual(r, { count: 1, parentClass: 'clash-setup-actions', sameParent: true, before: true, firstChild: true, secondary: true, notLast: true, text: 'New test' });
    await page.click('[data-key="setup-new-test"]');
    assert.deepEqual(await intents(page), [{ type: 'setup/newTest' }]);
  }));
}

test('setup UX: New test is disabled while a run is active and is skipped by Tab', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ newTest: { enabled: false } }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="setup-new-test"]').disabled), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-key')), 'setup-toggle-collapsed');
  await page.evaluate(() => document.querySelector('[data-key="setup-new-test"]').click());
  assert.deepEqual(await intents(page), []);
  await rerender(page, setupVm({ newTest: { enabled: true } }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="setup-new-test"]').disabled), false);
}));

test('setup UX: Soft radio is never disabled (unverified basis shows the basis block instead) and still dispatches', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm({ basis: basisOn() }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="setup-mode-soft"]').disabled), false);
  assert.equal(await page.evaluate(() => document.querySelector('.clash-soft-explanation')), null);
  await page.check('[data-key="setup-mode-soft"]');
  assert.deepEqual(await intents(page), [{ type: 'setup/mode', value: 'soft' }]);
  await rerender(page, setupVm({ softChecking: true }));
  const r = await page.evaluate(() => ({ soft: document.querySelector('[data-key="setup-mode-soft"]').disabled, pending: document.querySelector('.clash-soft-pending')?.textContent ?? null }));
  assert.deepEqual(r, { soft: false, pending: 'Checking whether Soft is available…' });
}));

test('setup UX: basis block shown only when basis.required; Units select dispatches setup/basis with the chosen value', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, setupVm());
  assert.equal(await page.evaluate(() => [document.querySelector('.clash-basis'), document.querySelector('[data-key="setup-basis"]')]).then((a) => a.every((x) => x === null)), true);
  await rerender(page, softSetup({ basis: basisOn({ status: 'Raw model units. Not verified — no physical unit is implied.', state: 'raw', value: 'raw' }) }));
  const r = await page.evaluate(() => ({
    headline: document.querySelector('.clash-basis-headline').textContent,
    message: document.querySelector('.clash-basis-message').textContent,
    status: document.querySelector('.clash-basis-status').textContent,
    detail: document.querySelector('.clash-basis-detail').textContent,
    state: document.querySelector('.clash-basis').dataset.basisState,
    options: [...document.querySelectorAll('[data-key="setup-basis"] option')].map((o) => [o.value, o.textContent]),
    value: document.querySelector('[data-key="setup-basis"]').value,
    invalid: document.querySelector('[data-key="setup-basis"]').hasAttribute('aria-invalid'),
    verified: /verified/i.test(document.querySelector('.clash-basis-status').textContent.replace(/not verified/gi, '')),
  }));
  assert.equal(r.headline, 'Soft clearance needs a measurement basis. Hard clash is available.');
  assert.equal(r.message, 'The host could not verify a common measurement basis for these models.');
  assert.equal(r.status, 'Raw model units. Not verified — no physical unit is implied.');
  assert.equal(r.detail, 'Details: models differ');
  assert.equal(r.state, 'raw');
  assert.deepEqual(r.options.map((o) => o[0]), ['', 'mm', 'cm', 'm', 'in', 'ft', 'raw']);
  assert.equal(r.options.at(-1)[1], 'Model units (raw, unverified)');
  assert.equal(r.value, 'raw');
  assert.equal(r.invalid, false);
  assert.equal(r.verified, false);
  await page.selectOption('[data-key="setup-basis"]', 'ft');
  await page.selectOption('[data-key="setup-basis"]', 'raw');
  assert.deepEqual(await intents(page), [{ type: 'setup/basis', value: 'ft' }, { type: 'setup/basis', value: 'raw' }]);
  await rerender(page, softSetup({ basis: basisOn({ required: false, headline: null, message: null }) }));
  assert.equal(await page.evaluate(() => document.querySelector('.clash-basis')), null);
}));

test('setup UX: basis error marks the Units select aria-invalid; clearance error marks the field; unit label renders beside Clearance', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...SETUP, softSetup({
    basis: basisOn({ error: 'Choose a unit' }),
    clearance: { value: '5', visible: true, unitLabel: 'mm', error: 'Enter a clearance greater than 0' },
  }));
  const r = await page.evaluate(() => ({
    basisInvalid: document.querySelector('[data-key="setup-basis"]').getAttribute('aria-invalid'),
    basisError: document.querySelector('.clash-basis .clash-field-error').textContent,
    clearanceInvalid: document.querySelector('[data-key="setup-clearance"]').getAttribute('aria-invalid'),
    unit: document.querySelector('.clash-clearance-unit').textContent.trim(),
    unitAdjacent: document.querySelector('.clash-clearance-unit').previousElementSibling === document.querySelector('label.clash-clearance') || document.querySelector('.clash-clearance-unit').parentElement.contains(document.querySelector('[data-key="setup-clearance"]')),
  }));
  assert.deepEqual(r, { basisInvalid: 'true', basisError: 'Choose a unit', clearanceInvalid: 'true', unit: 'mm', unitAdjacent: true });
  await rerender(page, softSetup({ clearance: { value: '5', visible: true, unitLabel: '', error: null } }));
  assert.equal(await page.evaluate(() => document.querySelector('.clash-clearance-unit')), null);
  await rerender(page, softSetup({ clearance: { value: '5', visible: true, unitLabel: 'model units (raw)', error: null } }));
  assert.equal(await page.evaluate(() => document.querySelector('.clash-clearance-unit').textContent.trim()), 'model units (raw)');
}));

test('setup UX: real Tab order in expanded setup (Soft mode, basis + clearance shown), disabled controls skipped', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm({ setup: softSetup({ selfClash: false }) }));
  const visited = await tabStops(page, 'run-start');
  assert.deepEqual(visited, [
    'setup-new-test', 'setup-toggle-collapsed', 'setup-name', 'setup-mode-soft', 'setup-basis', 'setup-clearance',
    'setup-A-mA', 'setup-A-mB', 'setup-A-mC', 'setup-use-selection-A',
    'setup-B-mA', 'setup-B-mB', 'setup-B-mC', 'setup-use-selection-B',
    'setup-self-clash', 'run-start',
  ]);
}));

test('setup UX: Hard mode tab order omits Units/Clearance; Hard radio is the group stop; disabled Use selection and New test are skipped', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm({ setup: setupVm({ selfClash: true, useSelectionEnabled: false, newTest: { enabled: false } }) }));
  const visited = await tabStops(page, 'run-start');
  assert.deepEqual(visited, [
    'setup-toggle-collapsed', 'setup-name', 'setup-mode-hard',
    'setup-A-mA', 'setup-A-mB', 'setup-A-mC', 'setup-self-clash', 'run-start',
  ]);
}));

test('setup UX: collapsed setup tab order is only New test, Show setup — no setup form controls', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm({ setup: setupVm({ collapsed: true }) }));
  const visited = await tabStops(page, 'run-start');
  assert.deepEqual(visited, ['setup-new-test', 'setup-toggle-collapsed', 'run-start']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-region="setup"] input, [data-region="setup"] select').length), 0);
}));

test('status UX: idle panel shows "Ready to run" zero times in visible text; the live region is visually hidden but still present', () => withPage(async ({ page }) => {
  const css = await readFile(path.join(REPO_ROOT, 'wwwroot', 'main.css'), 'utf8');
  await page.addStyleTag({ content: css });
  await mountRenderer(page, ...PANEL, panelVm());
  await page.evaluate(() => document.getElementById('clash-root').classList.add('clash-panel-root'));
  const r = await page.evaluate(() => {
    const root = document.getElementById('clash-root');
    const status = root.querySelector('.clash-status');
    const cs = getComputedStyle(status);
    const visibleText = [...root.querySelectorAll('*')]
      .filter((n) => !n.closest('.clash-status'))
      .flatMap((n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.data)).join('\n');
    const rect = status.getBoundingClientRect();
    return {
      live: status.getAttribute('aria-live'), statusText: status.textContent, position: cs.position, w: rect.width, h: rect.height,
      overflow: cs.overflow, visibleReady: (visibleText.match(/Ready to run/g) ?? []).length,
      runState: root.querySelector('.clash-run-state').textContent,
    };
  });
  assert.equal(r.live, 'polite');
  assert.equal(r.statusText, 'Ready to run');
  assert.deepEqual([r.position, r.overflow], ['absolute', 'hidden']);
  assert.ok(r.w <= 1 && r.h <= 1, `status box ${r.w}x${r.h}`);
  assert.equal(r.visibleReady, 0);
  assert.equal(r.runState, 'Idle');
}));

test('status UX: visibleStatus never repeats the state label (Completed / Running / Stopping / Stopped / idle)', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { visibleStatus, stateLabel } = await import('/clashpanel/ui/render/run.js');
    const v = (run) => visibleStatus(run);
    return {
      idle: v({ state: 'idle', headline: 'Ready to run' }),
      idleNot: v({ state: 'idle', headline: 'Not ready to run' }),
      completed: v({ state: 'done', doneKind: 'completed', headline: 'Completed — 491 clashes' }),
      completedOther: v({ state: 'done', doneKind: 'completed', headline: '491 clashes' }),
      running: v({ state: 'running', headline: 'Running…' }),
      stopping: v({ state: 'stopping', headline: 'Stopping… (finishing the current step)' }),
      stopped: v({ state: 'done', doneKind: 'cancelled', headline: 'Stopped — partial results (812)' }),
      cancelledLabel: stateLabel({ state: 'done', doneKind: 'cancelled' }),
      failed: v({ state: 'done', doneKind: 'failed', headline: 'Run failed: engine error' }),
      noHeadline: v({ state: 'done', doneKind: 'completed', headline: '' }),
    };
  });
  assert.deepEqual(r.idle, { label: 'Idle', headline: null });
  assert.deepEqual(r.idleNot, { label: 'Idle', headline: null });
  assert.deepEqual(r.completed, { label: null, headline: 'Completed — 491 clashes' });
  assert.deepEqual(r.completedOther, { label: 'Completed', headline: '491 clashes' });
  assert.deepEqual(r.running, { label: null, headline: 'Running…' });
  assert.deepEqual(r.stopping, { label: null, headline: 'Stopping… (finishing the current step)' });
  assert.deepEqual(r.stopped, { label: null, headline: 'Stopped — partial results (812)' });
  assert.equal(r.cancelledLabel, 'Stopped');
  assert.deepEqual(r.failed, { label: 'Failed', headline: 'Run failed: engine error' });
  assert.deepEqual(r.noHeadline, { label: 'Completed', headline: null });
}));

test('status UX: rendered done state shows "Completed" once', () => withPage(async ({ page }) => {
  await mountRenderer(page, '/clashpanel/ui/render/run.js', 'renderRun', runVm({ state: 'done', doneKind: 'completed', headline: 'Completed — 491 clashes', statusLive: 'Completed — 491 clashes' }));
  const text = await page.textContent('.clash-run-state');
  assert.equal(text, 'Completed — 491 clashes');
  assert.equal((text.match(/Completed/g) ?? []).length, 1);
}));
