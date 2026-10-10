// test/clashpanel/dom/manager.dom.mjs — spec §26.8–§26.10: the managed renderer in real Chromium over fake ViewModels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, mountRenderer, rerender, intents } from './support/harness.mjs';
import { managedVm, managerRow } from './support/managerFixtures.mjs';
import { HOSTILE, runVm, panelVm } from './support/vmFixtures.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { lockedEditorVm, MANAGER_TEXT } from '../../../clashpanel/core/managerViewModel.js';
import { FAULT_POLICY } from '../../../clashpanel/core/testsManager.js';
import { faultCases } from '../support/faultControls.mjs';

const R = ['/clashpanel/ui/render/manager.js', 'renderManagedPanel'];

test('list view: one item per test, name element = name, active item by visible Active badge text and aria-current; the editor keeps five hidden sections', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'list' }));
  const r = await page.evaluate(() => {
    const root = document.getElementById('clash-root');
    return {
      rows: [...root.querySelectorAll('.clash-manager-list .clash-manager-item')].map((li) => [li.querySelector('.clash-manager-name').textContent, li.querySelector('.clash-manager-badge')?.textContent ?? null, li.getAttribute('aria-current')]),
      caption: root.querySelector('.clash-manager-caption').textContent,
      sections: [...root.querySelectorAll('section')].map((s) => s.dataset.region),
      editorHidden: root.querySelector('.clash-manager-editor').hidden,
      listHidden: root.querySelector('.clash-manager-list').hidden,
      toggle: root.querySelector('[data-key="manager-view-editor"]').textContent,
    };
  });
  assert.deepEqual(r.rows, [['Clash test 1', 'Active', 'true'], ['Clash test 2', null, null]]);
  assert.equal(r.caption, 'Clash tests (this session only)');
  assert.deepEqual(r.sections, ['setup', 'run', 'filters', 'results', 'selected']);
  assert.equal(r.editorHidden, true);
  assert.equal(r.listHidden, false);
  assert.equal(r.toggle, 'Back to test');
}));

test('row actions dispatch manager intents with the testId; a disabled action exposes its visible reason via aria-describedby', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'list' }));
  for (const key of ['manager-open-1', 'manager-duplicate-0', 'manager-delete-1', 'manager-create']) await page.click(`[data-key="${key}"]`);
  assert.deepEqual(await intents(page), [
    { type: 'manager/open', testId: 'T-2' }, { type: 'manager/duplicate', testId: 'T-1' },
    { type: 'manager/delete', testId: 'T-2' }, { type: 'manager/create' },
  ]);
  const reset = await page.evaluate(() => {
    const b = document.querySelector('[data-key="manager-reset-0"]');
    return { disabled: b.disabled, label: b.getAttribute('aria-label'), reason: document.getElementById(b.getAttribute('aria-describedby'))?.textContent };
  });
  assert.deepEqual(reset, { disabled: true, label: 'Reset results “Clash test 1”', reason: 'This test has no results to reset.' });
}));

test('the confirmation is an in-panel banner: focus moves to it once; Confirm/Cancel carry the operationId', () => withPage(async ({ page }) => {
  const confirm = { operationId: 'op-3', text: 'Delete “Clash test 2”? Its setup and results are discarded for this session and can\'t be recovered.', confirmLabel: 'Delete test', cancelLabel: 'Cancel', enabled: true };
  await mountRenderer(page, ...R, managedVm({ view: 'list', confirm, pending: { operationId: 'op-3', kind: 'delete', sourceTestId: 'T-2', targetTestId: null } }));
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-banner-id')), 'manager-confirm');
  await page.click('[data-key="manager-cancel"]');
  await page.click('[data-key="manager-confirm"]');
  assert.deepEqual(await intents(page), [{ type: 'manager/cancel', operationId: 'op-3' }, { type: 'manager/confirm', operationId: 'op-3' }]);
}));

test('ONE live region: manager announcements and the editor status are relayed by a single persistent header node (§23.6/§26.10)', () => withPage(async ({ page }) => {
  const created = 'Created “Clash test 2”.';
  await mountRenderer(page, ...R, managedVm({ view: 'editor', live: created }));
  const state = () => page.evaluate(() => {
    const root = document.getElementById('clash-root');
    const node = root.querySelector('.clash-manager-header > .clash-status');
    return { regions: root.querySelectorAll('[aria-live]').length, same: node === window.__liveNode, text: node.textContent, hidden: node.closest('[hidden]') !== null };
  });
  await page.evaluate(() => { window.__liveNode = document.querySelector('.clash-manager-header > .clash-status'); });
  assert.deepEqual(await state(), { regions: 1, same: true, text: created, hidden: false });
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="manager-view-list"]').textContent), 'All tests (2)');
  await rerender(page, managedVm({ view: 'editor', live: created }, { run: runVm({ statusLive: 'Running' }) }));
  assert.deepEqual(await state(), { regions: 1, same: true, text: 'Running', hidden: false }, 'the editor status is relayed');
  await rerender(page, managedVm({ view: 'list', live: 'Opened “Clash test 1”.' }, { run: runVm({ statusLive: 'Running' }) }));
  assert.deepEqual(await state(), { regions: 1, same: true, text: 'Opened “Clash test 1”.', hidden: false }, 'still announced in list view');
  await rerender(page, managedVm({ view: 'editor', live: 'Opened “Clash test 1”.' }, { run: runVm({ statusLive: 'Running' }) }));
  await page.click('[data-key="manager-view-list"]');
  assert.deepEqual(await intents(page), [{ type: 'manager/viewList' }]);
}));

test('a pending editor confirmation can be cancelled from the manager header (CONFIRM_CANCEL)', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'editor' }, { test: { pendingConfirm: true } }));
  await page.click('[data-key="editor-confirm-cancel"]');
  assert.deepEqual(await intents(page), [{ type: 'confirm/cancel' }]);
}));

test('manager fault: alert banner; setup controls (not the collapse toggle) and Run disabled and described by it; Clear results stays enabled', () => withPage(async ({ page }) => {
  const fault = { text: 'The tests list lost track of the test editor.' };
  const editor = lockedEditorVm(panelVm({ run: runVm({ state: 'done', doneKind: 'completed', canRun: true }) }), fault.text, FAULT_POLICY);
  await mountRenderer(page, ...R, managedVm({ view: 'editor', fault, editorLock: { enabled: false, reason: fault.text } }, editor));
  const r = await page.evaluate(() => {
    const banner = document.querySelector('[data-banner-id="manager-fault"]');
    const setup = [...document.querySelectorAll('section[data-region="setup"] button, section[data-region="setup"] input, section[data-region="setup"] select')];
    const locked = setup.filter((n) => n.getAttribute('data-key') !== 'setup-toggle-collapsed');
    const toggle = document.querySelector('[data-key="setup-toggle-collapsed"]');
    const run = document.querySelector('[data-key="run-start"]');
    return {
      role: banner.getAttribute('role'), text: banner.textContent,
      setupAllDisabled: locked.length > 0 && locked.every((n) => n.disabled && n.getAttribute('aria-describedby') === banner.id),
      toggleEnabled: toggle.disabled === false && !toggle.hasAttribute('aria-describedby'),
      runDisabled: run.disabled && run.getAttribute('aria-describedby') === banner.id,
      clearEnabled: document.querySelector('[data-key="results-clear"]').disabled === false,
    };
  });
  assert.deepEqual(r, { role: 'alert', text: 'The tests list lost track of the test editor.', setupAllDisabled: true, toggleEnabled: true, runDisabled: true, clearEnabled: true });
}));

test('Review Focus 6 / re-review M1 (DOM): every user-facing control FAULT_POLICY blocks is disabled and described by the fault reason; allowed controls are untouched', () => withPage(async ({ page }) => {
  const reason = MANAGER_TEXT.FAULT;
  const read = (selectors) => page.evaluate((map) => {
    const root = document.getElementById('clash-root');
    const state = (n) => {
      const by = n.getAttribute('aria-describedby');
      return { disabled: n.disabled === true, ariaDisabled: n.getAttribute('aria-disabled'), describedBy: by, reason: by ? document.getElementById(by)?.textContent ?? null : null };
    };
    const out = {};
    for (const [type, list] of Object.entries(map)) out[type] = list.flatMap((sel) => [...root.querySelectorAll(sel)]).map(state);
    return { out, bannerId: root.querySelector('[data-banner-id="manager-fault"]')?.id ?? null };
  }, selectors);
  for (const { name, vm: ed, controls } of faultCases()) {
    const selectors = Object.fromEntries(Object.entries(controls).map(([type, c]) => [type, c.dom]));
    await mountRenderer(page, ...R, managedVm({ view: 'editor' }, ed));
    const before = await read(selectors);
    await rerender(page, managedVm({ view: 'editor', fault: { text: reason }, editorLock: { enabled: false, reason } }, lockedEditorVm(ed, reason, FAULT_POLICY)));
    const after = await read(selectors);
    assert.equal(before.bannerId, null);
    assert.ok(typeof after.bannerId === 'string' && after.bannerId.endsWith('-manager-fault'));
    for (const [type, nodes] of Object.entries(after.out)) {
      assert.ok(nodes.length > 0 && nodes.length === before.out[type].length, `${name} ${type}: its control(s) are rendered by the fixture`);
      if (FAULT_POLICY[type] === 'allow') {
        assert.deepEqual(nodes, before.out[type], `${name} ${type}: allowed — not disabled or re-described by the fault`);
        continue;
      }
      assert.ok(before.out[type].every((n) => !n.disabled && n.ariaDisabled !== 'true'), `${name} ${type}: enabled before the fault (non-vacuous)`);
      for (const n of nodes) {
        assert.ok(n.disabled || n.ariaDisabled === 'true', `${name} ${type}: disabled while faulted`);
        assert.equal(n.describedBy, after.bannerId, `${name} ${type}: described by the fault banner`);
        assert.equal(n.reason, reason, `${name} ${type}: exposes the terminal-fault reason`);
      }
    }
  }
}));

test('fault-state re-review M1 (DOM): a faulted result row leaves the tab order, looks disabled, and click/Enter/Space emit no intent — the same inputs dispatch NAV_SELECT when not faulted', () => withPage(async ({ page }) => {
  const reason = MANAGER_TEXT.FAULT;
  const ed = faultCases()[0].vm;   // main fixture: grouped page, rows r0 and r1 (selected), both in group g1
  const ROW = '.clash-manager-editor [data-key="-|r0"]';
  const SELECT = { type: INTENT.NAV_SELECT, resultId: 'r0', groupId: 'g1' };
  const clean = () => managedVm({ view: 'editor' }, ed);
  const faulted = () => managedVm({ view: 'editor', fault: { text: reason }, editorLock: { enabled: false, reason } }, lockedEditorVm(ed, reason, FAULT_POLICY));
  // ONE input path for both states: synthetic click on the row and on a child (bubbling, like a pointer click on its
  // text), synthetic Enter and Space keydown on the row (the events results.js resultRow listens to), then real
  // Playwright input — a forced pointer click (force: Playwright treats aria-disabled as not actionable) and
  // focus + Enter/Space keys.
  const fire = async () => {
    await page.evaluate((sel) => {
      const row = document.querySelector(sel);
      const opts = { bubbles: true, cancelable: true, composed: true };
      row.dispatchEvent(new MouseEvent('click', opts));
      row.querySelector('.clash-label').dispatchEvent(new MouseEvent('click', opts));
      row.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: 'Enter' }));
      row.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: ' ' }));
    }, ROW);
    await page.click(ROW, { force: true });
    await page.focus(ROW);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
  };
  const rowState = () => page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const by = row.getAttribute('aria-describedby');
    const cs = getComputedStyle(row);
    return {
      tabindex: row.getAttribute('tabindex'), ariaDisabled: row.getAttribute('aria-disabled'), locked: row.getAttribute('data-fault-locked'),
      describedBy: by, reason: by ? document.getElementById(by)?.textContent ?? null : null,
      cursor: cs.cursor, opacity: cs.opacity, background: cs.backgroundColor,
    };
  }, ROW);
  const focusedRow = () => page.evaluate(() => document.activeElement?.classList.contains('clash-row') === true);
  // Real Tab sweep from the header's view toggle through the whole editor host; returns the result rows it lands on.
  const rowTabStops = async () => {
    await page.focus('[data-key="manager-view-list"]');
    const stops = [];
    for (let i = 0; i < 200; i += 1) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const a = document.activeElement;
        return { inEditor: a?.closest('.clash-manager-editor') != null, row: a?.classList.contains('clash-row') === true, key: a?.getAttribute('data-key') ?? null };
      });
      if (!s.inEditor) { if (stops.length > 0) break; continue; }
      stops.push(s);
    }
    return stops.filter((s) => s.row).map((s) => s.key);
  };
  // Stand-in for the host's main.css row hover (the harness loads no host stylesheet), so "no hover highlight" is observable.
  await page.addStyleTag({ content: '.clash-panel-root .clash-row:hover{background-color:rgb(1, 2, 3)}' });

  // Not faulted (non-vacuous): both rows are tab stops, hover highlights, and every input dispatches NAV_SELECT.
  await mountRenderer(page, ...R, clean());
  assert.deepEqual(await rowTabStops(), ['-|r0', '-|r1'], 'not faulted: the rows are tab stops');
  await page.hover(ROW);
  assert.deepEqual(await rowState(), {
    tabindex: '0', ariaDisabled: null, locked: null, describedBy: null, reason: null, cursor: 'auto', opacity: '1', background: 'rgb(1, 2, 3)',
  });
  await fire();
  assert.deepEqual(await intents(page), Array(7).fill(SELECT), 'not faulted: 2 clicks + Enter + Space (synthetic) + click + Enter + Space (real) each select');
  assert.equal(await focusedRow(), true, 'not faulted: the row took focus');

  // Faulted (rendered twice: the lock is idempotent): rebuild() restores focus to the row, lockRow removes it again.
  await rerender(page, faulted());
  assert.equal(await focusedRow(), false, 'faulted: focus does not stay on a locked row');
  await rerender(page, faulted());
  const bannerId = await page.evaluate(() => document.querySelector('[data-banner-id="manager-fault"]').id);
  await page.mouse.move(0, 0);
  await page.hover(ROW);
  assert.deepEqual(await rowState(), {
    tabindex: null, ariaDisabled: 'true', locked: 'true', describedBy: bannerId, reason, cursor: 'default', opacity: '0.4', background: 'rgba(0, 0, 0, 0)',
  });
  await fire();
  assert.equal((await intents(page)).length, 7, 'faulted: no click, Enter or Space — synthetic or real — reaches the row handler');
  assert.equal(await focusedRow(), false, 'faulted: focus() cannot land on the row');
  assert.deepEqual(await rowTabStops(), [], 'faulted: Tab never lands on a result row');

  // Un-faulted render: rows are rebuilt unlocked and interactive again.
  await rerender(page, clean());
  assert.deepEqual(await rowState().then(({ tabindex, ariaDisabled, locked, describedBy }) => ({ tabindex, ariaDisabled, locked, describedBy })),
    { tabindex: '0', ariaDisabled: null, locked: null, describedBy: null });
  await fire();
  assert.equal((await intents(page)).length, 14, 'un-faulted: the same inputs select again');
}));

test('Review Focus 2: hostile and unbroken names stay inert text and never widen the panel', () => withPage(async ({ page }) => {
  const long = 'W'.repeat(10000);
  await page.setViewportSize({ width: 480, height: 800 });
  await mountRenderer(page, ...R, managedVm({ view: 'list', activeName: HOSTILE, tests: [managerRow(1, { name: HOSTILE, setA: HOSTILE }), managerRow(2, { name: long })] }));
  const r = await page.evaluate(() => {
    const root = document.getElementById('clash-root');
    return { pwned: window.__pwned ?? null, imgs: root.querySelectorAll('img').length, overflow: root.scrollWidth <= root.clientWidth + 1,
      name: root.querySelector('.clash-manager-item .clash-manager-name').textContent };
  });
  assert.deepEqual(r, { pwned: null, imgs: 0, overflow: true, name: '<img src=x onerror=window.__pwned=1>' });
}));

// ---- Work review M1: every disabled action exposes its reason (§26.10) ----
const confirmOp = (over = {}) => ({ operationId: 'op-9', text: 'Delete “Clash test 2”?', confirmLabel: 'Delete test', cancelLabel: 'Cancel', enabled: true, disabledReason: null, ...over });
const confirmState = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-key="manager-confirm"]');
  const id = b.getAttribute('aria-describedby');
  return { disabled: b.disabled, describedby: id, reason: id === null ? null : document.getElementById(id)?.textContent ?? '(unresolved)', spans: document.querySelectorAll('[id$="-manager-confirm-reason"]').length };
});

test('M1: a disabled Confirm exposes its reason by aria-describedby (recovering / editor confirmation / fault); enabled has none', () => withPage(async ({ page }) => {
  const pending = { operationId: 'op-9', kind: 'delete', sourceTestId: 'T-2', targetTestId: null };
  await mountRenderer(page, ...R, managedVm({ view: 'list', pending, confirm: confirmOp() }));
  assert.deepEqual(await confirmState(page), { disabled: false, describedby: null, reason: null, spans: 0 });
  for (const [reason] of [[MANAGER_TEXT.RECOVERING], [MANAGER_TEXT.ANSWER_CONFIRM], [MANAGER_TEXT.FAULT]]) {
    await rerender(page, managedVm({ view: 'list', pending, confirm: confirmOp({ enabled: false, disabledReason: reason }) }));
    const st = await confirmState(page);
    assert.match(st.describedby, /-manager-confirm-reason$/);
    assert.deepEqual([st.disabled, st.reason, st.spans], [true, reason, 1]);
  }
  await rerender(page, managedVm({ view: 'list', pending, confirm: confirmOp() }));
  assert.deepEqual(await confirmState(page), { disabled: false, describedby: null, reason: null, spans: 0 }, 'enabling again removes the description');
}));

const runningEditor = () => ({ setup: { ...panelVm().setup, newTest: { enabled: false } }, run: runVm({ state: 'running' }) });
const newTestState = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-key="setup-new-test"]');
  const id = b.getAttribute('aria-describedby');
  return { disabled: b.disabled, describedby: id, reason: id === null ? null : document.getElementById(id)?.textContent ?? '(unresolved)',
    visible: id === null ? null : document.getElementById(id)?.getClientRects().length > 0, overlays: document.querySelectorAll('[id$="-manager-new-test-reason"]').length };
});

test('M1: the managed editor New test, disabled by a live run, exposes a visible run-active reason; idempotent; removed when enabled; fault keeps the fault reason', () => withPage(async ({ page }) => {
  await mountRenderer(page, ...R, managedVm({ view: 'editor' }, {}));
  assert.deepEqual(await newTestState(page), { disabled: false, describedby: null, reason: null, visible: null, overlays: 0 });
  await rerender(page, managedVm({ view: 'editor' }, runningEditor()));
  const on = await newTestState(page);
  assert.deepEqual([on.disabled, on.reason, on.visible, on.overlays], [true, MANAGER_TEXT.STOP_FIRST, true, 1]);
  await rerender(page, managedVm({ view: 'editor' }, runningEditor()));
  assert.deepEqual(await newTestState(page), on, 'a re-render does not duplicate or churn the overlay');
  await rerender(page, managedVm({ view: 'editor' }, {}));
  assert.deepEqual(await newTestState(page), { disabled: false, describedby: null, reason: null, visible: null, overlays: 0 });
  const fault = { text: 'The tests list lost track of the test editor.' };
  const locked = lockedEditorVm(panelVm({ setup: { ...panelVm().setup, newTest: { enabled: false } }, run: runVm({ state: 'running' }) }), fault.text, FAULT_POLICY);
  await rerender(page, managedVm({ view: 'editor', fault, editorLock: { enabled: false, reason: fault.text } }, locked));
  const f = await newTestState(page);
  assert.deepEqual([f.disabled, f.reason, f.overlays], [true, fault.text, 0], 'the fault reason stays the exposed reason');
}));

// ---- Work review M2: identical consecutive manager announcements are each observable (§26.10) ----
test('M2: two distinct manager events with IDENTICAL text each produce an observable live-node update; still ONE live region', () => withPage(async ({ page }) => {
  const text = 'Deleted “Same” for this session.';
  await mountRenderer(page, ...R, managedVm({ view: 'list', live: '', liveSeq: 0 }));
  await page.evaluate(() => {
    const node = document.querySelector('.clash-manager-header > .clash-status');
    window.__mut = 0; window.__node = node;
    new MutationObserver((rs) => { window.__mut += rs.length; }).observe(node, { childList: true, characterData: true, subtree: true });
  });
  const snap = () => page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 0));
    const node = document.querySelector('.clash-manager-header > .clash-status');
    return { mut: window.__mut, text: node.textContent, seq: node.getAttribute('data-live-seq'), same: node === window.__node, regions: document.querySelectorAll('#clash-root [aria-live]').length };
  });
  await rerender(page, managedVm({ view: 'list', live: text, liveSeq: 1 }));
  const a = await snap();
  await rerender(page, managedVm({ view: 'list', live: text, liveSeq: 1 }));
  const idle = await snap();
  assert.deepEqual([idle.mut, idle.seq], [a.mut, '1'], 'same event, same text: no churn');
  await rerender(page, managedVm({ view: 'list', live: text, liveSeq: 2 }));
  const b = await snap();
  assert.deepEqual([a.text, b.text, a.seq, b.seq, a.same, b.same, a.regions, b.regions], [text, text, '1', '2', true, true, 1, 1]);
  assert.ok(a.mut > 0, 'the first event updated the node');
  assert.ok(b.mut > a.mut, 'the second, identical-text event ALSO updated the node');
}));
