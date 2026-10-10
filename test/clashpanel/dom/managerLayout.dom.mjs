// test/clashpanel/dom/managerLayout.dom.mjs — spec §26.14 / plan Addendum A (AC-UI1…AC-UI12): the Tests list presentation
// in real Chromium over fake ViewModels. Presentation only: every behavioral/dispatch/confirmation assertion lives in
// manager.dom.mjs and managerComposition.dom.mjs and is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { managedVm, managerRow } from './support/managerFixtures.mjs';

const R = ['/clashpanel/ui/render/manager.js', 'renderManagedPanel'];
const ALLOW = { enabled: true, reason: null };
const RUNNING = 'Stop the running test first.';
const NO_RESULTS = 'This test has no results to reset.';
const LABELS = ['Open', 'Duplicate', 'Reset results', 'Delete test'];
const KEYS = ['open', 'duplicate', 'reset', 'delete'];
const LONG = 'W'.repeat(10000);

const list = (over = {}) => managedVm({ view: 'list', ...over });
const running = (i, over = {}) => managerRow(i, {
  actions: { open: { enabled: false, reason: RUNNING }, duplicate: ALLOW, reset: { enabled: false, reason: RUNNING }, delete: { enabled: false, reason: RUNNING } }, ...over,
});

test('AC-UI1/2: a labelled list of items, no table elements, creation order, Active badge + aria-current only on the active item', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, list({ tests: [managerRow(1), managerRow(2), managerRow(3)] }));
  const r = await page.evaluate(() => {
    const host = document.querySelector('.clash-manager-list');
    const ul = host.querySelector('ul');
    const caption = host.querySelector('.clash-manager-caption');
    const items = [...ul.children];
    return {
      tables: host.querySelectorAll('table,tr,th,td,thead,tbody,caption').length,
      labelled: ul.getAttribute('aria-labelledby') === caption.id && caption.id.length > 0 ? caption.textContent : null,
      tags: items.map((n) => n.tagName),
      ids: items.map((n) => n.getAttribute('data-test-id')),
      current: items.map((n) => n.getAttribute('aria-current')),
      badges: items.map((n) => n.querySelector('.clash-manager-badge')?.textContent ?? null),
      suffix: host.textContent.includes('(active)'),
      order: [...items[0].children].map((c) => c.className.split(' ')[0]),
      sets: [...items[0].querySelectorAll('.clash-manager-set')].map((s) => [s.querySelector('.clash-manager-set-label').textContent, s.querySelector('.clash-manager-set-value').textContent]),
    };
  });
  assert.deepEqual(r.tables, 0);
  assert.equal(r.labelled, 'Clash tests (this session only)');
  assert.deepEqual(r.tags, ['LI', 'LI', 'LI']);
  assert.deepEqual(r.ids, ['T-1', 'T-2', 'T-3']);
  assert.deepEqual(r.current, ['true', null, null]);
  assert.deepEqual(r.badges, ['Active', null, null]);
  assert.equal(r.suffix, false);
  assert.deepEqual(r.order, ['clash-manager-head', 'clash-manager-meta', 'clash-manager-set', 'clash-manager-set', 'clash-manager-readiness', 'clash-manager-reasons'],
    'the fixture row has a disabled Reset, so the reasons container is the sixth and last child');
  assert.deepEqual(r.sets, [['Set A', 'Architecture'], ['Set B', 'Structure']]);
}));

test('meta line: mode and the UNCHANGED status text are separate elements joined by an aria-hidden separator', () => withPage(async ({ page }) => {
  const row = managerRow(1, { modeText: 'Soft (clearance 0.05)', status: { kind: 'done', text: 'Completed — 3 clashes reported' }, resultsText: 'Results not held — open and re-run to view', modelsChangedText: 'Models changed since this run' });
  await mountRenderer(page, ...R, list({ tests: [row] }));
  const r = await page.evaluate(() => {
    const meta = document.querySelector('.clash-manager-item .clash-manager-meta');
    return { mode: meta.querySelector('.clash-manager-mode').textContent, sep: [meta.querySelector('.clash-manager-sep').textContent, meta.querySelector('.clash-manager-sep').getAttribute('aria-hidden')],
      status: meta.querySelector('.clash-manager-status').textContent, readiness: document.querySelector('.clash-manager-readiness').textContent };
  });
  assert.deepEqual(r, { mode: 'Soft (clearance 0.05)', sep: ['·', 'true'],
    status: 'Completed — 3 clashes reported · Results not held — open and re-run to view · Models changed since this run', readiness: 'Setup complete — readiness to run is checked when opened' });
}));

test('AC-UI3/11: icon-only actions in order, named with the test name, titled, 28x28, spaced, aria-hidden icons, same intents by pointer and keyboard', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, list({ tests: [managerRow(1, { actions: { open: ALLOW, duplicate: ALLOW, reset: ALLOW, delete: ALLOW } })] }));
  const r = await page.evaluate(() => {
    const li = document.querySelector('.clash-manager-item');
    const group = li.querySelector('[role="group"]');
    const buttons = [...group.querySelectorAll('button')];
    const rects = buttons.map((b) => b.getBoundingClientRect());
    return {
      groupName: group.getAttribute('aria-label'),
      keys: buttons.map((b) => b.getAttribute('data-key')),
      names: buttons.map((b) => b.getAttribute('aria-label')),
      titles: buttons.map((b) => b.getAttribute('title')),
      hidden: buttons.map((b) => b.querySelector('.clash-manager-icon')?.getAttribute('aria-hidden')),
      visibleText: buttons.map((b) => b.innerText),
      minSize: Math.min(...rects.flatMap((x) => [x.width, x.height])),
      gaps: rects.slice(1).map((x, i) => x.left - rects[i].right),
      inside: rects.every((x) => x.right <= li.getBoundingClientRect().right + 0.5 && x.left >= li.getBoundingClientRect().left),
      masked: buttons.map((b) => { const cs = getComputedStyle(b.querySelector('.clash-manager-icon')); return (cs.maskImage || cs.webkitMaskImage || '').startsWith('url("data:image/svg+xml'); }),
    };
  });
  assert.equal(r.groupName, 'Actions for “Clash test 1”');
  assert.deepEqual(r.keys, KEYS.map((k) => `manager-${k}-0`));
  assert.deepEqual(r.names, LABELS.map((l) => `${l} “Clash test 1”`));
  assert.deepEqual(r.titles, LABELS);
  assert.deepEqual(r.hidden, ['true', 'true', 'true', 'true']);
  assert.deepEqual(r.visibleText, ['', '', '', ''], 'icon-only: no visible text');
  assert.ok(r.minSize >= 28, `hit area ${r.minSize}`);
  assert.ok(r.gaps.every((g) => g >= 4), `gaps ${r.gaps}`);
  assert.equal(r.inside, true);
  assert.deepEqual(r.masked, [true, true, true, true], 'every glyph is a CSS mask data-URI');
  // keyboard: Tab order Open -> Duplicate -> Reset -> Delete; Enter and Space dispatch the same intents as a click
  await page.focus('[data-key="manager-open-0"]');
  const order = [];
  for (let i = 0; i < 4; i += 1) { order.push(await page.evaluate(() => document.activeElement.getAttribute('data-key'))); await page.keyboard.press('Tab'); }
  assert.deepEqual(order, KEYS.map((k) => `manager-${k}-0`));
  await page.focus('[data-key="manager-open-0"]');
  await page.keyboard.press('Enter');
  await page.focus('[data-key="manager-duplicate-0"]');
  await page.keyboard.press('Space');
  await page.click('[data-key="manager-reset-0"]');
  assert.deepEqual(await intents(page), [{ type: 'manager/open', testId: 'T-1' }, { type: 'manager/duplicate', testId: 'T-1' }, { type: 'manager/reset', testId: 'T-1' }]);
  await page.focus('[data-key="manager-delete-0"]');
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return [document.activeElement.getAttribute('data-key'), cs.outlineStyle, parseFloat(cs.outlineWidth)]; });
  assert.notEqual(ring[1], 'none', 'a keyboard-focused icon button shows a focus ring');
  assert.ok(ring[2] >= 1);
}));

test('AC-UI4: equal disabled reasons render ONCE per item; every disabled button stays native-disabled and linked; distinct reasons stay distinct', () => withPage(async ({ page }) => {
  const mixed = managerRow(2, { actions: { open: ALLOW, duplicate: ALLOW, reset: { enabled: false, reason: NO_RESULTS }, delete: { enabled: false, reason: RUNNING } } });
  await mountRenderer(page, ...R, list({ tests: [running(1), mixed, managerRow(3, { actions: { open: ALLOW, duplicate: ALLOW, reset: ALLOW, delete: ALLOW } })] }));
  const r = await page.evaluate(() => {
    const out = [];
    for (const li of document.querySelectorAll('.clash-manager-item')) {
      const rows = [...li.querySelectorAll('.clash-manager-reasons .clash-manager-reason-row')].map((p) => ({ who: p.querySelector('.clash-manager-reason-for').textContent, reason: p.querySelector('.clash-manager-reason').textContent, visible: p.querySelector('.clash-manager-reason').getClientRects().length > 0 }));
      const buttons = [...li.querySelectorAll('[role="group"] button')].map((b) => ({
        key: b.getAttribute('data-key'), disabled: b.disabled, tabbable: b.tabIndex >= 0 && !b.disabled,
        reason: b.hasAttribute('aria-describedby') ? document.getElementById(b.getAttribute('aria-describedby'))?.textContent ?? '(unresolved)' : null,
      }));
      out.push({ container: li.querySelector('.clash-manager-reasons') !== null, rows, buttons });
    }
    const ids = [...document.querySelectorAll('.clash-manager-reason')].map((n) => n.id);
    return { out, uniqueIds: new Set(ids).size === ids.length };
  });
  assert.equal(r.uniqueIds, true);
  assert.deepEqual(r.out[0].rows, [{ who: 'Open, Reset results, Delete test: ', reason: RUNNING, visible: true }], 'three equal reasons -> one row naming all three actions in order');
  assert.deepEqual(r.out[0].buttons.map((b) => [b.key, b.disabled, b.reason]), [['manager-open-0', true, RUNNING], ['manager-duplicate-0', false, null], ['manager-reset-0', true, RUNNING], ['manager-delete-0', true, RUNNING]]);
  assert.deepEqual(r.out[1].rows.map((x) => [x.who, x.reason]), [['Reset results: ', NO_RESULTS], ['Delete test: ', RUNNING]], 'distinct reasons stay distinct rows');
  assert.deepEqual(r.out[1].buttons.map((b) => b.reason), [null, null, NO_RESULTS, RUNNING]);
  assert.equal(r.out[2].container, false, 'no reasons container when nothing is disabled');
  // disabled controls are not operable by pointer, keyboard or a programmatic click
  await page.evaluate(() => document.querySelector('[data-key="manager-open-0"]').click());
  await page.focus('[data-key="manager-delete-1"]').catch(() => {});
  await page.keyboard.press('Enter');
  assert.deepEqual(await intents(page), [], 'a disabled action dispatches nothing');
  assert.equal(r.out[0].buttons.filter((b) => b.disabled).every((b) => b.tabbable === false), true);
}));

test('AC-UI6/7: 10 000-character unbroken names at 240/280/340/436 px — no overflow, minimum sizes, <=2 clamped lines, title = full text, status/readiness never clamped', () => withPage(async ({ page }) => {
  const hostile = managerRow(1, { name: LONG, setA: LONG, setB: `${LONG}B`,
    status: { kind: 'done', text: `Completed — 3 clashes reported ${LONG}` }, readiness: { state: 'models-missing', text: `${LONG} is not loaded; load it to run`, models: [] },
    actions: { open: ALLOW, duplicate: ALLOW, reset: { enabled: false, reason: RUNNING }, delete: { enabled: false, reason: RUNNING } } });
  const plain = managerRow(2, { name: 'Clash test 2' });
  for (const width of [240, 280, 340, 436]) {
    await page.setViewportSize({ width: 900, height: 900 });
    await mountRenderer(page, ...R, list({ tests: [hostile, plain] }));
    await page.evaluate((w) => { document.getElementById('clash-root').style.width = `${w}px`; }, width);
    const r = await page.evaluate(() => {
      const root = document.getElementById('clash-root');
      const ch = (el) => { const p = document.createElement('span'); p.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${getComputedStyle(el).font}`; p.textContent = '0'; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return w; };
      const li = root.querySelector('.clash-manager-item');
      const name = li.querySelector('.clash-manager-name');
      const values = [...li.querySelectorAll('.clash-manager-set-value')];
      const lineH = (el) => parseFloat(getComputedStyle(el).lineHeight);
      const unclamped = ['.clash-manager-mode', '.clash-manager-status', '.clash-manager-readiness', '.clash-manager-reason'].map((s) => { const n = li.querySelector(s); return [s, n.scrollHeight <= n.clientHeight + 1 || getComputedStyle(n).display === 'inline']; });
      const group = li.querySelector('[role="group"]').getBoundingClientRect();
      const rect = li.getBoundingClientRect();
      return {
        overflow: root.scrollWidth <= root.clientWidth + 1, liInside: rect.right <= root.getBoundingClientRect().right + 1,
        nameW: name.getBoundingClientRect().width / ch(name), valueW: values.map((v) => v.getBoundingClientRect().width / ch(v)),
        nameLines: name.getBoundingClientRect().height / lineH(name), valueLines: values.map((v) => v.getBoundingClientRect().height / lineH(v)),
        titles: [name.getAttribute('title') === name.textContent, ...values.map((v) => v.getAttribute('title') === v.textContent)],
        groupInside: group.right <= rect.right + 0.5 && group.left >= rect.left - 0.5,
        status: li.querySelector('.clash-manager-status').textContent.length, readiness: li.querySelector('.clash-manager-readiness').textContent.length, unclamped,
        statusHeightOk: li.querySelector('.clash-manager-status').getBoundingClientRect().height > 100,
      };
    });
    const at = `at ${width}px`;
    assert.equal(r.overflow, true, `no horizontal overflow ${at}`);
    assert.equal(r.liInside, true, `item inside the list ${at}`);
    assert.ok(r.nameW >= 10, `name >= 10ch ${at}: ${r.nameW}`);
    assert.ok(r.valueW.every((w) => w >= 12), `Set values >= 12ch ${at}: ${r.valueW}`);
    assert.ok(r.nameLines <= 2.01 && r.valueLines.every((l) => l <= 2.01), `<= 2 lines ${at}: ${r.nameLines} ${r.valueLines}`);
    assert.deepEqual(r.titles, [true, true, true], `title = full text ${at}`);
    assert.equal(r.groupInside, true, `actions inside item ${at}`);
    assert.ok(r.status > 10000 && r.readiness > 10000, 'full status/readiness text is in the DOM');
    assert.equal(r.statusHeightOk, true, `status wraps instead of clamping ${at}`);
    assert.deepEqual(r.unclamped.filter(([, ok]) => !ok), [], `non-clamped fields ${at}`);
  }
}));

test('responsive: the action group never shrinks, wraps below the name, and floor width stacks Set label over value', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, list({ tests: [managerRow(1, { name: 'Architecture vs Mechanical clearance review — level 3 and level 4' })] }));
  const probe = (w) => page.evaluate((width) => {
    document.getElementById('clash-root').style.width = `${width}px`;
    const li = document.querySelector('.clash-manager-item');
    const g = li.querySelector('[role="group"]').getBoundingClientRect();
    const n = li.querySelector('.clash-manager-name').getBoundingClientRect();
    const set = li.querySelector('.clash-manager-set');
    const label = set.querySelector('.clash-manager-set-label').getBoundingClientRect();
    const value = set.querySelector('.clash-manager-set-value').getBoundingClientRect();
    const bs = [...li.querySelectorAll('[role="group"] button')].map((b) => b.getBoundingClientRect());
    return { groupW: Math.round(bs[bs.length - 1].right - bs[0].left), sameLine: g.top < n.bottom, stacked: value.top >= label.bottom - 1 };
  }, w);
  const wide = await probe(436);
  const floor = await probe(240);
  assert.equal(wide.sameLine, true, 'normal width: name and actions share the head line');
  assert.equal(floor.sameLine, false, 'floor width: actions sit on their own row');
  assert.equal(floor.stacked, true, 'floor width: Set label stacks above its value');
  assert.equal(wide.stacked, false);
  assert.equal(wide.groupW, floor.groupW, 'the action group never shrinks');
}));

test('supported floor: a 300 px viewport keeps >= 240 px of list content with no overflow; 280 px degrades without error', () => withPage(async ({ page }) => {
  for (const vw of [300, 280]) {
    await page.setViewportSize({ width: vw, height: 800 });
    await mountRenderer(page, ...R, list({ tests: [managerRow(1, { name: LONG, setA: LONG }), managerRow(2)] }));
    await page.evaluate((w) => { document.getElementById('clash-root').style.width = `${Math.floor(w * 0.9) - 24}px`; }, vw);   // 90vw panel minus scrollbar/padding
    const r = await page.evaluate((n) => {
      const root = document.getElementById('clash-root');
      const li = root.querySelector('.clash-manager-item');
      const name = li.querySelector('.clash-manager-name'); const g = li.querySelector('[role="group"]').getBoundingClientRect(); const nb = name.getBoundingClientRect();
      return { content: root.clientWidth, overflow: root.scrollWidth <= root.clientWidth + 1, widthAfter: root.style.width, fullText: name.textContent.length === n && li.querySelector('.clash-manager-set-value').textContent.length === n,
        actionsOwnRow: g.top >= nb.bottom - 1, groupInside: g.right <= li.getBoundingClientRect().right + 0.5 };
    }, LONG.length);
    if (vw === 300) assert.ok(r.content >= 240 - 1 && r.overflow, `300px viewport: content ${r.content}, overflow-free ${r.overflow}`);
    else {
      assert.ok(r.content > 0);
      assert.equal(r.fullText, true, '280px: the complete DOM text remains');
      assert.equal(r.actionsOwnRow, true, '280px: the action group sits on its own row');
      assert.equal(r.groupInside, true, '280px: actions stay inside the item');
      assert.equal(r.overflow, true, '280px: no root overflow; the width was not increased');
      assert.equal(r.widthAfter, `${Math.floor(vw * 0.9) - 24}px`);
    }
  }
}));

test('icon fallback: the .clash-manager-no-mask seam (and the production @supports-not rule) shows text labels instead of glyphs', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, list({ tests: [managerRow(1, { actions: { open: ALLOW, duplicate: ALLOW, reset: ALLOW, delete: ALLOW } })] }));
  const css = await page.evaluate(() => document.getElementById('clash-manager-style').textContent);
  assert.match(css, /@supports not \(\(mask-image: ?none\) or \(-webkit-mask-image: ?none\)\)/);
  await page.evaluate(() => document.querySelector('.clash-manager-list').classList.add('clash-manager-no-mask'));
  for (const width of [240, 280, 340, 436]) {
    await page.evaluate((w) => { document.getElementById('clash-root').style.width = `${w}px`; }, width);
    const r = await page.evaluate(() => {
      const root = document.getElementById('clash-root');
      const li = root.querySelector('.clash-manager-item').getBoundingClientRect();
      const inside = (x) => x.left >= li.left - 0.5 && x.right <= li.right + 0.5;
      return { overflow: root.scrollWidth <= root.clientWidth + 1, buttons: [...root.querySelectorAll('.clash-manager-item [role="group"] button')].map((b) => {
        const bb = b.getBoundingClientRect(); const t = b.querySelector('.clash-manager-act-text'); const tb = t.getBoundingClientRect();
        return { text: b.innerText, icon: getComputedStyle(b.querySelector('.clash-manager-icon')).display, h: bb.height, w: bb.width, inside: inside(bb) && inside(tb),
          textInButton: tb.left >= bb.left - 0.5 && tb.right <= bb.right + 0.5 && tb.top >= bb.top - 0.5 && tb.bottom <= bb.bottom + 0.5 };
      }) };
    });
    const at = `at ${width}px`;
    assert.equal(r.overflow, true, `no horizontal overflow ${at}`);
    assert.deepEqual(r.buttons.map((x) => x.text), LABELS, `every label visible ${at}`);
    assert.ok(r.buttons.every((x) => x.icon === 'none' && x.h >= 28 && x.w >= 28), `hit areas ${at}`);
    assert.ok(r.buttons.every((x) => x.inside && x.textInButton), `labels and buttons stay inside the item, text inside its button ${at}`);
  }
}));

test('AC-UI8: rendering the list or the editor writes no width to the root or any ancestor', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, list());
  const styleOf = () => page.evaluate(() => { const out = []; for (let n = document.getElementById('clash-root'); n; n = n.parentElement) out.push([n.tagName, n.getAttribute('style')]); return out; });
  await page.evaluate(() => { document.getElementById('clash-root').style.width = '333px'; });
  const before = await styleOf();
  await rerender(page, managedVm({ view: 'editor' }));
  await rerender(page, list());
  assert.deepEqual(await styleOf(), before);
}));

test('inert text: a hostile name in the new item/aria-label/title attributes stays text', () => withPage(async ({ page }) => {
  const evil = '<img src=x onerror=window.__pwned=1>';
  await mountRenderer(page, ...R, list({ tests: [managerRow(1, { name: evil, setA: evil, setB: evil })] }));
  const r = await page.evaluate(() => ({ pwned: window.__pwned ?? null, imgs: document.querySelectorAll('#clash-root img').length,
    group: document.querySelector('[role="group"]').getAttribute('aria-label'), title: document.querySelector('.clash-manager-name').getAttribute('title') }));
  assert.deepEqual(r, { pwned: null, imgs: 0, group: 'Actions for “<img src=x onerror=window.__pwned=1>”', title: '<img src=x onerror=window.__pwned=1>' });
}));
