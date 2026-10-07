// test/clashpanel/dom/run.dom.mjs — Region 2 RUN / STATUS (Task 28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { runVm } from './support/vmFixtures.mjs';

const RUN = ['/clashpanel/ui/render/run.js', 'renderRun'];

test('run: Run/Stop enabled from vm.canRun/canStop and dispatch run/start, run/stop', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({ canRun: true, canStop: false }));
  assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-key="run-start"]').disabled, document.querySelector('[data-key="run-stop"]').disabled]), [false, true]);
  await page.click('[data-key="run-start"]');
  await rerender(page, runVm({ state: 'planning', canRun: false, canStop: true, headline: 'Planning…' }));
  assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-key="run-start"]').disabled, document.querySelector('[data-key="run-stop"]').disabled]), [true, false]);
  await page.click('[data-key="run-stop"]');
  assert.deepEqual(await intents(page), [{ type: 'run/start' }, { type: 'run/stop' }]);
  assert.equal(await page.textContent('.clash-run-state'), 'Planning…');
}));

test('run: progress bar exposes aria values; indeterminate when fraction is null; counts/elapsed text; no ETA', () => withPage(async ({ page }) => {
  const progress = { fraction: 0.42, unitsEvaluated: 8, unitsTotal: 19, resultsFound: 37, caveatCount: 2, elapsedText: '0:12' };
  await mountRenderer(page, ...RUN, runVm({ state: 'running', canRun: false, canStop: true, progress, headline: 'Running' }));
  const r = await page.evaluate(() => {
    const bar = document.querySelector('progress');
    return {
      role: bar.getAttribute('role') ?? 'progressbar(implicit)', now: bar.getAttribute('aria-valuenow'), min: bar.getAttribute('aria-valuemin'),
      max: bar.getAttribute('aria-valuemax'), text: bar.getAttribute('aria-valuetext'), value: bar.value,
      line: document.querySelector('.clash-progress').textContent,
    };
  });
  assert.deepEqual(r, { role: 'progressbar(implicit)', now: '42', min: '0', max: '100', text: '42%', value: 0.42, line: ' 42% units 8/19 found 37 caveats 2 0:12' });
  assert.doesNotMatch(r.line, /ETA|remaining|left/i);
  await rerender(page, runVm({ state: 'planning', canRun: false, canStop: true, progress: { ...progress, fraction: null } }));
  const ind = await page.evaluate(() => ({ now: document.querySelector('progress').getAttribute('aria-valuenow'), hasValue: document.querySelector('progress').hasAttribute('value') }));
  assert.deepEqual(ind, { now: null, hasValue: false });
}));

test('run: totals, badges, banners with details, state labels for done kinds', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({
    state: 'done', doneKind: 'cancelled', canRun: true, canStop: false, headline: 'Stopped — partial results (812)',
    counts: { total: 812, filtered: 37 },
    badges: { coverage: { value: 'partial', label: 'Coverage: partial' }, integrity: { value: 'caveated', label: 'Integrity: caveated' }, freshness: { value: 'current', label: 'Freshness: current', pending: false } },
    banners: [{ id: 'partial', kind: 'warning', text: 'Results are partial.', details: ['2 units were not evaluated'] }, { id: 'failed', kind: 'error', text: 'Engine failure' }],
  }));
  const r = await page.evaluate(() => ({
    state: document.querySelector('.clash-run-state').textContent,
    counts: document.querySelector('.clash-counts').textContent,
    badges: [...document.querySelectorAll('.clash-badges li')].map((li) => li.textContent),
    banners: [...document.querySelectorAll('.clash-banner')].map((b) => ({ id: b.dataset.bannerId, cls: b.className, role: b.getAttribute('role'), text: b.querySelector('.clash-banner-text').textContent, details: [...b.querySelectorAll('li')].map((li) => li.textContent) })),
  }));
  assert.deepEqual(r, {
    state: 'Stopped — partial results (812)',
    counts: '812 clashes · 37 match filters',
    badges: ['Coverage: partial', 'Integrity: caveated', 'Freshness: current'],
    banners: [
      { id: 'partial', cls: 'clash-banner clash-banner-warning', role: null, text: 'Results are partial.', details: ['2 units were not evaluated'] },
      { id: 'failed', cls: 'clash-banner clash-banner-error', role: 'alert', text: 'Engine failure', details: [] },
    ],
  });
  assert.equal(await page.$('[data-key="diagnostics-copy"]'), null); // vm.run.diagnostics is null here
  await page.click('[data-key="results-clear"]');
  assert.deepEqual(await intents(page), [{ type: 'results/clear' }]);
}));

test('run: the aria-live status node persists across re-renders and only its text changes; banner actions dispatch', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({ statusLive: 'Ready to run' }));
  await page.evaluate(() => { window.__statusNode = document.querySelector('.clash-status'); });
  await rerender(page, runVm({ state: 'running', canRun: false, canStop: true, statusLive: 'Running', banners: [{ id: 'cap', kind: 'error', text: 'Too many results are held', action: { label: 'Release results and retry', intent: { type: 'run/releaseAndRetry' } } }] }));
  const r = await page.evaluate(() => ({
    same: window.__statusNode === document.querySelector('.clash-status'),
    live: document.querySelector('.clash-status').getAttribute('aria-live'),
    text: document.querySelector('.clash-status').textContent,
    count: document.querySelectorAll('[aria-live]').length,
  }));
  assert.deepEqual(r, { same: true, live: 'polite', text: 'Running', count: 1 });
  assert.equal(await page.textContent('[data-key="banner-cap-action"]'), 'Release results and retry');
  await page.click('[data-key="banner-cap-action"]');
  assert.deepEqual(await intents(page), [{ type: 'run/releaseAndRetry' }]);
}));

test('run: a banner action dispatches a COPY of its exact intent; malformed actions render no button', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({ state: 'done', doneKind: 'completed', banners: [
    { id: 'confirm', kind: 'warning', text: 'Discard unsaved results?', action: { label: 'Discard unsaved results', intent: { type: 'results/clearConfirmed' } } },
    { id: 'bad1', kind: 'warning', text: 'x', action: 'clear-results' },
    { id: 'bad2', kind: 'warning', text: 'y', action: { label: 'No intent' } },
  ] }));
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.clash-banner button')].map((b) => b.getAttribute('data-key')));
  assert.deepEqual(buttons, ['banner-confirm-action']);
  await page.click('[data-key="banner-confirm-action"]');
  assert.deepEqual(await intents(page), [{ type: 'results/clearConfirmed' }]);
}));

test('run: diagnostics preview lines render as text; Copy diagnostics writes the RESOLVED string to the clipboard', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({ state: 'done', doneKind: 'failed', diagnostics: { available: true, preview: ['Status: failed · coverage partial · integrity caveated', 'Diagnostics: 3'] } }));
  const preview = await page.evaluate(() => [...document.querySelectorAll('.clash-diagnostics-preview li')].map((li) => li.textContent));
  assert.deepEqual(preview, ['Status: failed · coverage partial · integrity caveated', 'Diagnostics: 3']);
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
    window.__clash.reply = (intent) => (intent.type === 'diagnostics/copy' ? '{"outcome":"full json"}' : undefined);
  });
  await page.click('[data-key="diagnostics-copy"]');
  await page.waitForFunction(() => window.__copied.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__copied), ['{"outcome":"full json"}']);
  assert.deepEqual(await intents(page), [{ type: 'diagnostics/copy' }]);
}));

test('run: Copy diagnostics without a Clipboard API, or with a null reply, copies nothing and throws nothing', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({ state: 'done', doneKind: 'completed', diagnostics: { available: true, preview: [] } }));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    window.__clash.reply = () => 'text';
  });
  await page.click('[data-key="diagnostics-copy"]');
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
    window.__clash.reply = () => null;
  });
  await page.click('[data-key="diagnostics-copy"]');
  await page.evaluate(() => new Promise((res) => setTimeout(res, 0)));
  assert.deepEqual(await page.evaluate(() => window.__copied), []);
  assert.equal((await intents(page)).length, 2);
}));

test('run: Run details is a native <details> with label/value rows; its open state survives a re-render', () => withPage(async ({ page }) => {
  const details = { lines: [{ label: 'Run id', value: 'run-7' }, { label: 'Mode', value: 'Hard (volume overlap)' }] };
  await mountRenderer(page, ...RUN, runVm({ state: 'done', doneKind: 'completed', details }));
  const r = await page.evaluate(() => ({
    tag: document.querySelector('.clash-run-details').tagName,
    summary: document.querySelector('.clash-run-details summary').textContent,
    rows: [...document.querySelectorAll('.clash-run-details dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]),
    open: document.querySelector('.clash-run-details').open,
  }));
  assert.deepEqual(r, { tag: 'DETAILS', summary: 'Run details', rows: [['Run id', 'run-7'], ['Mode', 'Hard (volume overlap)']], open: false });
  await page.click('.clash-run-details summary');
  await rerender(page, runVm({ state: 'done', doneKind: 'completed', details, statusLive: 'changed' }));
  assert.equal(await page.evaluate(() => document.querySelector('.clash-run-details').open), true);
  await rerender(page, runVm({ state: 'done', doneKind: 'completed', details: null }));
  assert.equal(await page.$('.clash-run-details'), null);
}));

test('run: badge labels are rendered exactly as describeAxes returns them (no re-prefixing); pending freshness marks aria-busy', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...RUN, runVm({
    state: 'done', doneKind: 'completed',
    badges: {
      coverage: { value: 'full', label: 'Coverage: full' },
      integrity: { value: 'clean', label: 'Integrity: clean' },
      freshness: { value: 'current', label: 'Freshness: current (at seal) \u2014 checking freshness\u2026', pending: true },
    },
  }));
  const r = await page.evaluate(() => ({
    badges: [...document.querySelectorAll('.clash-badges li')].map((li) => li.textContent),
    busy: document.querySelector('.clash-badge-freshness').getAttribute('aria-busy'),
  }));
  assert.deepEqual(r, { badges: ['Coverage: full', 'Integrity: clean', 'Freshness: current (at seal) \u2014 checking freshness\u2026'], busy: 'true' });
}));
