// test/clashpanel/dom/managerComposition.dom.mjs — createClashPanel hosts the Clash Tests manager (spec §26.8);
// real core + manager + ViewerBridge + UI over the in-page fake engine/catalog/viewer (inPageFakes.mjs). Event-driven waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage } from './support/harness.mjs';

const P = '#clash-detection-panel';

async function boot(page, options = {}) {
  await page.evaluate(async (opts) => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const world = fakes.createWorld();
    const panel = createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events, ...opts });
    window.__e2e = { world, panel, vmOf: () => panel.controller.getViewModel() };
    panel.show();
  }, options);
}
const waitVm = (page, predicate) => page.waitForFunction(`(${predicate})(window.__e2e.vmOf())`);

async function runFirstTest(page) {
  await page.click(`${P} [data-key="setup-A-mA"]`);
  await waitVm(page, (vm) => vm.setup.models.some((m) => m.modelKey === 'mA' && m.inA));
  await page.click(`${P} [data-key="setup-B-mB"]`);
  await waitVm(page, (vm) => vm.setup.validation.state === 'ready' && vm.run.canRun === true);
  await page.click(`${P} [data-key="run-start"]`);
  await page.waitForFunction(() => window.__e2e.world.engine.handles.length === 1);
  await page.evaluate(() => window.__e2e.world.engine.handles[0].finish());
  await waitVm(page, (vm) => vm.run.state === 'done' && vm.results.state === 'list');
}

test('E2E manager: New test keeps test 1 in the list with its last run; switching back shows test 1 idle and clears the Viewer', () => withPage(async ({ page }) => {
  await boot(page);
  const r0 = await page.evaluate(() => ({ header: !!document.querySelector('#clash-detection-panel .clash-manager-header'), keys: Object.keys(window.__e2e.panel).sort() }));
  assert.deepEqual(r0, { header: true, keys: ['controller', 'dispose', 'hide', 'isVisible', 'show', 'toggle'] });
  await runFirstTest(page);
  const firstId = await page.evaluate(() => window.__e2e.vmOf().test.testId);
  await page.click(`${P} [data-key="setup-new-test"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 2' && vm.run.state === 'idle');
  await page.click(`${P} [data-key="manager-view-list"]`);
  await page.waitForFunction(() => document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr').length === 2);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr')]
    .map((tr) => ({ name: tr.querySelector('.clash-manager-name').textContent, status: tr.querySelector('.clash-manager-status').textContent, current: tr.getAttribute('aria-current') })));
  assert.equal(rows[0].name, 'Clash test 1');
  assert.match(rows[0].status, /^Completed — 3 clashes reported · Results not held — open and re-run to view/);
  assert.equal(rows[1].current, 'true');
  await page.click(`${P} [data-key="manager-open-0"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 1' && vm.run.state === 'idle' && vm.results.state === 'before-run');
  assert.equal(await page.evaluate(() => window.__e2e.vmOf().test.testId), firstId);
  assert.equal(await page.evaluate(() => window.__e2e.world.viewer.meshCount()), 0, 'no Panel-owned marker remains');
}));

test('E2E: panel.controller is the manager-routed facade — SETUP_NEW_TEST creates, TEST_LOAD is dropped (Codex plan review C1)', () => withPage(async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const { INTENT } = await import('/clashpanel/core/intents.js');
    const c = window.__e2e.panel.controller;
    const first = c.getViewModel().test;
    await c.dispatch({ type: INTENT.TEST_LOAD, testId: 'forged', draft: first.draft });
    const afterLoad = c.getViewModel().test.testId;
    await c.dispatch({ type: INTENT.SETUP_NEW_TEST });              // resolves after the Create operation settled
    return { firstId: first.testId, afterLoad, name: c.getViewModel().test.draft.name,
      allTests: document.querySelector('#clash-detection-panel [data-key="manager-view-list"]').textContent };
  });
  assert.equal(r.afterLoad, r.firstId, 'a forged TEST_LOAD through the public controller is dropped');
  assert.equal(r.name, 'Clash test 2');
  assert.equal(r.allTests, 'All tests (2)', 'Create kept test 1 in the list (no in-place reset, no divergence)');
}));

test('E2E standalone (testsManager:false): no manager UI and New test keeps the §23.5 in-place semantics', () => withPage(async ({ page }) => {
  await boot(page, { testsManager: false });
  await page.click(`${P} [data-key="setup-new-test"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 2');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#clash-detection-panel .clash-manager-header').length), 0);
}));

test('E2E: a hostile test name is inert in the list; dispose leaves no panel, manager UI or listener', () => withPage(async ({ page }) => {
  await boot(page);
  await page.fill(`${P} [data-key="setup-name"]`, '<img src=x onerror=window.__pwned=1>');
  await waitVm(page, (vm) => vm.test.draft.name.startsWith('<img'));
  await page.click(`${P} [data-key="manager-view-list"]`);
  const r = await page.evaluate(async () => {
    const name = document.querySelector('#clash-detection-panel .clash-manager-name').textContent;
    const pwned = window.__pwned ?? null;
    await window.__e2e.panel.dispose();
    return { name, pwned, panels: document.querySelectorAll('.docking-panel').length, headers: document.querySelectorAll('.clash-manager-header').length,
      catalogListeners: window.__e2e.world.catalog.listenerCount() };
  });
  assert.deepEqual(r, { name: '<img src=x onerror=window.__pwned=1>', pwned: null, panels: 0, headers: 0, catalogListeners: 0 });
}));

async function startRun(page) {
  await page.click(`${P} [data-key="setup-A-mA"]`);
  await waitVm(page, (vm) => vm.setup.models.some((m) => m.modelKey === 'mA' && m.inA));
  await page.click(`${P} [data-key="setup-B-mB"]`);
  await waitVm(page, (vm) => vm.setup.validation.state === 'ready' && vm.run.canRun === true);
  await page.click(`${P} [data-key="run-start"]`);
  await page.waitForFunction(() => window.__e2e.world.engine.handles.length === 1);
  await waitVm(page, (vm) => vm.test.runActive === true);
}
const newTestInfo = (page) => page.evaluate((sel) => {
  const b = document.querySelector(`${sel} [data-key="setup-new-test"]`);
  const id = b.getAttribute('aria-describedby');
  return { disabled: b.disabled, reason: id === null ? null : document.getElementById(id)?.textContent ?? '(unresolved)', overlays: document.querySelectorAll('[id$="-manager-new-test-reason"]').length };
}, P);

test('E2E M1: during a live run the managed New test is disabled and described by the run-active reason; enabled with no overlay otherwise', () => withPage(async ({ page }) => {
  await boot(page);
  assert.deepEqual(await newTestInfo(page), { disabled: false, reason: null, overlays: 0 });
  await startRun(page);
  await page.waitForFunction((sel) => document.querySelector(`${sel} [data-key="setup-new-test"]`).disabled, P);
  assert.deepEqual(await newTestInfo(page), { disabled: true, reason: 'Stop the running test first.', overlays: 1 });
  await page.evaluate(() => window.__e2e.world.engine.handles[0].finish());
  await waitVm(page, (vm) => vm.run.state === 'done');
  assert.deepEqual(await newTestInfo(page), { disabled: false, reason: null, overlays: 0 });
}));

test('E2E M1: standalone (testsManager:false) renders no manager overlay during a live run', () => withPage(async ({ page }) => {
  await boot(page, { testsManager: false });
  await startRun(page);
  await page.waitForFunction((sel) => document.querySelector(`${sel} [data-key="setup-new-test"]`).disabled, P);
  const info = await newTestInfo(page);
  assert.deepEqual(info, { disabled: true, reason: null, overlays: 0 });
  assert.equal(await page.evaluate((sel) => document.querySelector(`${sel} [data-key="setup-new-test"]`).hasAttribute('aria-describedby'), P), false);
}));

test('E2E M2: two REAL distinct deletions with identical announcement text each update the single live node (data-live-seq N then N+1)', () => withPage(async ({ page }) => {
  await boot(page);
  const live = `${P} .clash-manager-header > .clash-status`;
  await page.fill(`${P} [data-key="setup-name"]`, 'Same');
  await waitVm(page, (vm) => vm.test.draft.name === 'Same');
  await page.click(`${P} [data-key="setup-new-test"]`);
  await waitVm(page, (vm) => vm.test.draft.name === 'Clash test 2');
  await page.fill(`${P} [data-key="setup-name"]`, 'Same');
  await waitVm(page, (vm) => vm.test.draft.name === 'Same');
  await page.click(`${P} [data-key="manager-view-list"]`);
  await page.waitForFunction(() => document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr').length === 2);
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    window.__node = node; window.__mut = 0;
    new MutationObserver((rs) => { window.__mut += rs.length; }).observe(node, { childList: true, characterData: true, subtree: true });
  }, live);
  const snap = () => page.evaluate(async (sel) => {
    await new Promise((r) => setTimeout(r, 0));
    const n = document.querySelector(sel);
    return { mut: window.__mut, text: n.textContent, seq: Number(n.getAttribute('data-live-seq')), same: n === window.__node, regions: document.querySelectorAll(`#clash-detection-panel [aria-live]`).length };
  }, live);
  const deleteRow = async (i, expectedRows) => {
    await page.click(`${P} [data-key="manager-delete-${i}"]`);
    await page.click(`${P} [data-key="manager-confirm"]`);
    await page.waitForFunction((n) => document.querySelectorAll('#clash-detection-panel .clash-manager-table tbody tr').length === n && !document.querySelector('#clash-detection-panel [data-key="manager-confirm"]'), expectedRows);
  };
  const base = await snap();
  await deleteRow(0, 1);
  const a = await snap();
  await deleteRow(0, 1);                      // the last test: Delete + Create successor (CTM-5), same announcement text
  const b = await snap();
  assert.equal(a.text, 'Deleted “Same” for this session.');
  assert.equal(b.text, a.text, 'identical text for two distinct actions');
  assert.equal(b.seq, a.seq + 1, 'data-live-seq advances N then N+1');
  assert.ok(a.mut > base.mut && b.mut > a.mut, 'each event produced an observable update of the live node');
  assert.deepEqual([a.same, b.same, a.regions, b.regions], [true, true, 1, 1]);
}));
