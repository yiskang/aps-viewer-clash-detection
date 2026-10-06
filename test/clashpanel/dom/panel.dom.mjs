// test/clashpanel/dom/panel.dom.mjs — renderPanel: fixed region order, a11y, and AC-P13 hostile text (Task 30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, snapshot } from './support/harness.mjs';
import {
  HOSTILE, HOSTILE2, panelVm, setupVm, runVm, filtersVm, resultsVm, resultRow, groupRow, selectedVm, side,
} from './support/vmFixtures.mjs';

const PANEL = ['/clashpanel/ui/render/panel.js', 'renderPanel'];

test('panel: five regions in fixed order with headings Test setup … Selected clash', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm());
  const r = await page.evaluate(() => [...document.querySelectorAll('#clash-root > section')].map((s) => [s.dataset.region, s.querySelector('h2').textContent, s.getAttribute('aria-label')]));
  assert.deepEqual(r, [
    ['setup', 'Test setup', 'Test setup'],
    ['run', 'Run status', 'Run status'],
    ['filters', 'Filters and grouping', 'Filters and grouping'],
    ['results', 'Results', 'Results'],
    ['selected', 'Selected clash', 'Selected clash'],
  ]);
}));

test('panel: re-render reuses the sections (idempotent) and exactly one aria-live="polite" status exists', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm());
  const first = await snapshot(page);
  await page.evaluate(() => { window.__sections = [...document.querySelectorAll('#clash-root > section')]; });
  await rerender(page, panelVm());
  assert.deepEqual(await snapshot(page), first);
  const r = await page.evaluate(() => ({
    same: [...document.querySelectorAll('#clash-root > section')].every((s, i) => s === window.__sections[i]),
    live: [...document.querySelectorAll('[aria-live]')].map((n) => [n.getAttribute('aria-live'), n.closest('section').dataset.region]),
  }));
  assert.deepEqual(r, { same: true, live: [['polite', 'run']] });
}));

test('panel: keyboard reachability — no positive tabindex; Tab visits every enabled control in DOM order', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm());
  const expected = await page.evaluate(() => {
    const positive = [...document.querySelectorAll('[tabindex]')].filter((n) => n.tabIndex > 0).length;
    const focusables = [...document.querySelectorAll('#clash-root button, #clash-root input, #clash-root select, #clash-root [tabindex="0"]')]
      .filter((n) => !n.disabled && !(n.type === 'radio' && !n.checked))
      .map((n) => n.getAttribute('data-key'));
    return { positive, focusables };
  });
  assert.equal(expected.positive, 0);
  assert.ok(expected.focusables.length >= 15);
  const visited = [];
  for (let i = 0; i < expected.focusables.length; i += 1) {
    await page.keyboard.press('Tab');
    visited.push(await page.evaluate(() => document.activeElement.getAttribute('data-key')));
  }
  assert.deepEqual(visited, expected.focusables);
}));

test('panel: all actions are native controls (buttons are <button type=button>, toggles are <input>)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, panelVm());
  const r = await page.evaluate(() => {
    const keyed = [...document.querySelectorAll('#clash-root [data-key]')];
    const nonNative = keyed.filter((n) => !['BUTTON', 'INPUT', 'SELECT', 'LI', 'SUMMARY'].includes(n.tagName)).map((n) => n.tagName);
    const badButtons = [...document.querySelectorAll('#clash-root button')].filter((b) => b.type !== 'button').length;
    const rowsNotOptions = [...document.querySelectorAll('#clash-root li[data-key]')].filter((li) => li.getAttribute('role') !== 'option').length;
    return { nonNative, badButtons, rowsNotOptions };
  });
  assert.deepEqual(r, { nonNative: [], badButtons: 0, rowsNotOptions: 0 });
}));

function hostileVm() {
  const hs = (k) => side(k, `${HOSTILE} model ${k}`, `${HOSTILE2} label ${k}`, 5);
  return panelVm({
    setup: setupVm({
      summary: `${HOSTILE} summary`, name: HOSTILE2,
      softAvailability: { available: false, pending: false, explanation: `Soft unavailable ${HOSTILE}` },
      models: [{ modelKey: 'mA', displayName: HOSTILE, ready: false, registered: true, inA: true, inB: false, note: HOSTILE2 }],
      scope: { A: HOSTILE, B: HOSTILE2 },
      validation: { state: 'blocked', messages: [{ control: 'setA', text: `${HOSTILE} is not registered` }], issuesTruncated: false },
    }),
    run: runVm({
      state: 'done', doneKind: 'failed', headline: `Failed ${HOSTILE}`, statusLive: HOSTILE2,
      banners: [{ id: 'failed', kind: 'error', text: `Engine error ${HOSTILE}`, details: [`banner detail ${HOSTILE2}`, HOSTILE], action: { label: `Retry ${HOSTILE}`, intent: { type: 'run/releaseAndRetry' } } }],
      diagnostics: { available: true, preview: [`Reason: ${HOSTILE}`, `Planning gap: ${HOSTILE2}`] },
      details: { lines: [{ label: `Model ${HOSTILE}`, value: HOSTILE2 }] },
    }),
    filters: filtersVm({ text: HOSTILE, modelOptions: [{ modelKey: 'mA', label: HOSTILE }], elementOnly: { modelKey: 'mA', dbId: 5, label: HOSTILE2 }, groupingNote: HOSTILE }),
    results: resultsVm({
      view: 'grouped', message: `Error detail ${HOSTILE}`, lines: [HOSTILE2],
      rows: [groupRow('g1', { label: `${HOSTILE} group` }), resultRow(0, { side1: hs('mA'), side2: hs('mB'), badges: [HOSTILE], groupId: 'g1', key: 'g1|r0' })],
      multiValuedNote: HOSTILE,
    }),
    selected: selectedVm({ side1: hs('mA'), side2: hs('mB'), notes: [HOSTILE, HOSTILE2], gap: HOSTILE }),
  });
}

test('AC-P13: hostile model/element names, banners + actions, error details, diagnostics preview, run details, validation and group labels are inert text', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, hostileVm());
  await rerender(page, hostileVm());
  const r = await page.evaluate(async () => {
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const root = document.getElementById('clash-root');
    const text = (sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
    return {
      pwned: window.__pwned === undefined ? 'undefined' : String(window.__pwned),
      imgs: document.querySelectorAll('img').length,
      scripts: root.querySelectorAll('script').length,
      elementsWithOnAttr: [...root.querySelectorAll('*')].filter((n) => [...n.attributes].some((a) => a.name.startsWith('on'))).length,
      modelName: text('.clash-model-name'),
      chips: text('.clash-row .clash-chip'),
      labels: text('.clash-row .clash-label'),
      detail: text('.clash-detail-value'),
      banner: text('.clash-banner-text'),
      bannerDetails: text('.clash-banner-details li'),
      bannerAction: text('.clash-banner button'),
      diagnostics: text('.clash-diagnostics-preview li'),
      detailRows: [...root.querySelectorAll('.clash-run-details dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]),
      validation: text('.clash-validation-list li'),
      group: text('.clash-group-label'),
      option: text('[data-key="filter-model"] option[value="mA"]'),
      lines: text('.clash-results-lines li'),
      status: root.querySelector('.clash-status').textContent,
      nameValue: root.querySelector('[data-key="setup-name"]')?.value ?? null,
      filterValue: root.querySelector('[data-key="filter-text"]').value,
    };
  });
  const H = '<img src=x onerror=window.__pwned=1>';
  const H2 = '"><script>window.__pwned=2</script>';
  assert.equal(r.pwned, 'undefined');
  assert.equal(r.imgs, 0);
  assert.equal(r.scripts, 0);
  assert.equal(r.elementsWithOnAttr, 0);
  assert.deepEqual(r.modelName, [H, H]); // listed under Set A and Set B
  assert.deepEqual(r.chips, [`${H} model mA`, `${H} model mB`]);
  assert.deepEqual(r.labels, [`${H2} label mA`, `${H2} label mB`]);
  assert.deepEqual(r.detail, [`${H} model mA · ${H2} label mA · #5`, `${H} model mB · ${H2} label mB · #5`]);
  assert.deepEqual(r.banner, [`Engine error ${H}`]);
  assert.deepEqual(r.bannerDetails, [`banner detail ${H2}`, H]);
  assert.deepEqual(r.bannerAction, [`Retry ${H}`]);
  assert.deepEqual(r.diagnostics, [`Reason: ${H}`, `Planning gap: ${H2}`]);
  assert.deepEqual(r.detailRows, [[`Model ${H}`, H2]]);
  assert.deepEqual(r.validation, [`${H} is not registered`]);
  assert.deepEqual(r.group, [`${H} group`]);
  assert.deepEqual(r.option, [H]);
  assert.deepEqual(r.lines, [H2]);
  assert.equal(r.status, H2);
  assert.equal(r.nameValue, H2);
  assert.equal(r.filterValue, H);
}));

test('AC-P13 negative control: the same string assigned as markup WOULD create an element (proves the probe is sensitive)', () => withPage(async ({ page }) => {
  const r = await page.evaluate((h) => {
    const t = document.createElement('template');
    const range = document.createRange();
    const frag = range.createContextualFragment(h);
    t.content.appendChild(frag);
    return t.content.querySelectorAll('img').length;
  }, HOSTILE);
  assert.equal(r, 1);
}));

test('panel: every enabled control dispatches ONLY values of the INTENT vocabulary', () => withPage(async ({ page }) => {
  const vm = panelVm({
    run: runVm({ state: 'done', doneKind: 'completed', banners: [{ id: 'b', kind: 'warning', text: 't', action: { label: 'Discard', intent: { type: 'results/clearConfirmed' } } }], diagnostics: { available: true, preview: ['p'] }, details: { lines: [{ label: 'l', value: 'v' }] } }),
    filters: filtersVm({ active: true, maxGap: { visible: true, value: '', max: 1, error: null }, elementOnly: { modelKey: 'mA', dbId: 1, label: 'W' } }),
    results: resultsVm({ view: 'grouped', rows: [groupRow('g'), resultRow(0, { groupId: 'g', key: 'g|r0' })], page: { index: 1, count: 3, size: 50 }, nav: { canPrev: true, canNext: true, label: '' } }),
  });
  await mountRenderer(page, ...PANEL, vm);
  const r = await page.evaluate(async () => {
    const { INTENT } = await import('/clashpanel/core/intents.js');
    // <summary> only opens its native disclosure (presentational); every other keyed control dispatches.
    const controls = [...document.querySelectorAll('#clash-root [data-key]')].filter((n) => !n.disabled && n.tagName !== 'SUMMARY');
    const checkedRadios = controls.filter((n) => n.type === 'radio' && n.checked).length; // clicking these fires no change
    for (const n of controls) {
      if (n.tagName === 'SELECT') { n.value = n.options[n.options.length - 1].value; n.dispatchEvent(new Event('change')); }
      else if (n.tagName === 'INPUT' && (n.type === 'text' || n.type === 'search')) { n.value = `${n.value}1`; n.dispatchEvent(new Event('input')); }
      else n.click();
    }
    const vocabulary = new Set(Object.values(INTENT));
    const types = window.__clash.intents.map((i) => i.type);
    return { expected: controls.length - checkedRadios, dispatched: types.length, unknown: types.filter((t) => !vocabulary.has(t)), distinct: new Set(types).size };
  });
  assert.deepEqual(r.unknown, []);
  assert.equal(r.dispatched, r.expected);
  assert.ok(r.distinct >= 25, JSON.stringify(r));
}));

// Review Focus pin RF-5: 10,000-character names WITHOUT spaces stay inert, never widen the panel, and create no
// per-character nodes.
function longVm(n) {
  const long = (c) => c.repeat(n);
  const s = (k) => side(k, long('M'), long('E'), 9);
  return panelVm({
    setup: setupVm({
      models: [{ modelKey: 'mA', displayName: long('A'), ready: true, registered: true, inA: true, inB: false, note: null }],
      validation: { state: 'blocked', messages: [{ control: 'setA', text: long('V') }], issuesTruncated: false },
    }),
    run: runVm({ state: 'done', doneKind: 'completed', banners: [{ id: 'b', kind: 'warning', text: long('B') }], details: { lines: [{ label: 'Model', value: long('D') }] } }),
    filters: filtersVm({ modelOptions: [{ modelKey: 'mA', label: long('O') }] }),
    results: resultsVm({ view: 'grouped', rows: [groupRow('g', { label: long('G') }), resultRow(0, { side1: s('mA'), side2: s('mB'), groupId: 'g', key: 'g|r0' })] }),
    selected: selectedVm({ side1: s('mA'), side2: s('mB') }),
  });
}

test('RF-5: 10,000-char unbroken names render inert, never widen a 420px panel, and add no per-character nodes', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...PANEL, longVm(3));
  const measure = () => page.evaluate(() => {
    const root = document.getElementById('clash-root');
    root.style.width = '420px';
    const wide = [...root.querySelectorAll('section, .clash-row, .clash-group-row, .clash-banner, .clash-run-details, .clash-validation, .clash-selected, select')]
      .filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.className || n.tagName);
    return {
      nodes: root.querySelectorAll('*').length,
      rootOk: root.scrollWidth <= root.clientWidth,
      wide,
      imgs: document.querySelectorAll('img').length,
      styles: document.querySelectorAll('style#clash-panel-style').length,
    };
  });
  const short = await measure();
  await rerender(page, longVm(10000));
  const long = await measure();
  const texts = await page.evaluate(() => ({
    model: document.querySelector('.clash-model-name').textContent.length,
    label: document.querySelector('.clash-row .clash-label').textContent.length,
    group: document.querySelector('.clash-group-label').textContent.length,
    banner: document.querySelector('.clash-banner-text').textContent.length,
    validation: document.querySelector('.clash-validation-list li').textContent.length,
    detail: document.querySelector('.clash-run-details dd').textContent.length,
  }));
  assert.deepEqual(texts, { model: 10000, label: 10000, group: 10000, banner: 10000, validation: 10000, detail: 10000 });
  assert.equal(long.rootOk, true);
  assert.deepEqual(long.wide, []);
  assert.equal(long.nodes, short.nodes);
  assert.equal(long.imgs, 0);
  assert.equal(long.styles, 1);
}));
