// test/clashpanel/dom/shell.dom.mjs — the thin DockingPanel adapter (Task 31; spec §14.2, AC-P21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage } from './support/harness.mjs';
import { panelVm, runVm, filtersVm, resultsVm, resultRow, selectedVm, setupVm } from './support/vmFixtures.mjs';

// In-page prelude shared by every test: imports the shell + fake controller, creates the parent container.
const PRELUDE = async () => {
  const shellMod = await import('/clashpanel/ui/ClashDockingPanel.js');
  const { createFakeController } = await import('/test/clashpanel/dom/support/fakeController.mjs');
  const { snapshotDom } = await import('/test/clashpanel/dom/support/mount.mjs');
  const host = document.createElement('div');
  host.id = 'host';
  document.body.appendChild(host);
  window.__t = { ...shellMod, createFakeController, snapshotDom, host };
};

function richVm() {
  return panelVm({
    setup: setupVm({ collapsed: true, summary: 'Clash test 3 · Soft 0.05 · A: Architecture · B: Structure' }),
    run: runVm({ state: 'done', doneKind: 'completed', canRun: true, headline: 'Completed — 3 clashes', counts: { total: 3, filtered: 2 } }),
    filters: filtersVm({ text: 'wall', groupBy: 'element', sort: 'gap-asc', active: true }),
    results: resultsVm({ page: { index: 1, count: 2, size: 50 }, rows: [resultRow(0), resultRow(1, { selected: true })] }),
    selected: selectedVm({ resultId: 'r1' }),
  });
}

test('construct: hidden, rendered from getViewModel, ONE visibility listener, no intent dispatched', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const controller = createFakeController(vm);
    const shell = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'Clash Detection' });
    const container = document.getElementById('clash-panel');
    const ops = window.Autodesk.__stubCalls.map((c) => c.op);
    return {
      inHost: container?.parentNode === host,
      display: container.style.display,
      visible: shell.isVisible(),
      regions: [...container.querySelectorAll('.clash-panel-body > section')].map((s) => s.dataset.region),
      listeners: ops.filter((o) => o === 'addVisibilityListener').length,
      baseInitialize: ops.includes('initialize:base'),
      titleBar: ops.includes('createTitleBar') && ops.includes('createCloseButton') && ops.includes('initializeMoveHandlers'),
      dispatched: controller.dispatched,
      subscribers: controller.subscriberCount(),
    };
  }, panelVm());
  assert.deepEqual(r, {
    inHost: true, display: 'none', visible: false, regions: ['setup', 'run', 'filters', 'results', 'selected'],
    listeners: 1, baseInitialize: false, titleBar: true, dispatched: [], subscribers: 1,
  });
}));

test('show/hide/toggle/close button dispatch panel/shown and panel/hidden through the single listener', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const controller = createFakeController(vm);
    const shell = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T' });
    const seen = [];
    shell.show(); seen.push(shell.isVisible());
    shell.toggle(); seen.push(shell.isVisible());
    shell.toggle(); seen.push(shell.isVisible());
    document.querySelector('#clash-panel .docking-panel-close').click(); seen.push(shell.isVisible());
    shell.hide();
    return { seen, dispatched: controller.dispatched.map((i) => i.type) };
  }, panelVm());
  assert.deepEqual(r.seen, [true, false, true, false]);
  assert.deepEqual(r.dispatched, ['panel/shown', 'panel/hidden', 'panel/shown', 'panel/hidden', 'panel/hidden']);
}));

test('controller notifications re-render the body; DOM events reach controller.dispatch as intents', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate(([vm1, vm2]) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const controller = createFakeController(vm1);
    createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T' });
    const before = document.querySelector('#clash-panel .clash-run-state').textContent;
    controller.set(vm2);
    const after = document.querySelector('#clash-panel .clash-run-state').textContent;
    document.querySelector('#clash-panel [data-key="run-stop"]').click();
    return { before, after, dispatched: controller.dispatched };
  }, [panelVm(), panelVm({ run: runVm({ state: 'running', canRun: false, canStop: true, headline: 'Running' }) })]);
  assert.deepEqual(r, { before: 'Idle', after: 'Running', dispatched: [{ type: 'run/stop' }] });
}));

test('dispose: unsubscribes, uninitializes ONCE, never calls setVisible afterwards, is idempotent, ignores late events', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const controller = createFakeController(vm);
    const shell = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T' });
    shell.show();
    const staleButton = document.querySelector('#clash-panel [data-key="run-start"]');
    shell.dispose();
    shell.dispose();
    shell.show(); shell.hide(); shell.toggle();
    staleButton.click();     // a detached DOM control must not reach the controller
    controller.set(vm);      // no subscriber left: nothing renders
    const ops = window.Autodesk.__stubCalls;
    return {
      subscribers: controller.subscriberCount(),
      uninit: ops.filter((c) => c.op === 'uninitialize').length,
      setVisibleAfter: ops.filter((c) => c.op === 'setVisible' && c.afterUninitialize).length,
      inDom: document.getElementById('clash-panel') !== null,
      visible: shell.isVisible(),
      dispatched: controller.dispatched.map((i) => i.type),
    };
  }, panelVm());
  assert.equal(r.subscribers, 0);
  assert.equal(r.uninit, 1);
  assert.equal(r.inDom, false);
  assert.equal(r.visible, false);
  assert.deepEqual(r.dispatched, ['panel/shown']);
  assert.equal(r.setVisibleAfter, 0);
}));

test('AC-P21: re-creating the shell over the same controller rebuilds identical setup/run/filters/page/selection DOM', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, snapshotDom, host } = window.__t;
    const controller = createFakeController(vm);
    const a = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T' });
    a.show();
    const snapA = snapshotDom(document.querySelector('#clash-panel .clash-panel-body'));
    a.hide(); a.show();
    const snapA2 = snapshotDom(document.querySelector('#clash-panel .clash-panel-body'));
    a.dispose();
    const b = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T' });
    const snapB = snapshotDom(document.querySelector('#clash-panel .clash-panel-body'));
    const body = document.querySelector('#clash-panel .clash-panel-body');
    return {
      sameAfterHideShow: JSON.stringify(snapA) === JSON.stringify(snapA2),
      sameAfterRecreate: JSON.stringify(snapA) === JSON.stringify(snapB),
      size: snapB.length,
      summary: body.querySelector('.clash-setup-summary').textContent,
      page: body.querySelector('.clash-page-label').textContent,
      selectedRow: body.querySelector('.clash-row[aria-selected="true"]').getAttribute('data-key'),
      selectedDetail: body.querySelector('.clash-selected').getAttribute('data-result-id'),
      filter: body.querySelector('[data-key="filter-text"]').value,
      group: body.querySelector('[data-key="group-element"]').checked,
      b: b.isVisible(),
    };
  }, richVm());
  assert.deepEqual(r, {
    sameAfterHideShow: true, sameAfterRecreate: true, size: r.size,
    summary: 'Clash test 3 · Soft 0.05 · A: Architecture · B: Structure', page: ' 2 / 2 ', selectedRow: '-|r1', selectedDetail: 'r1',
    filter: 'wall', group: true, b: false,
  });
  assert.ok(r.size > 20);
}));

test('AC-P21: no 3D-host reference and no domain state (a throwing host proxy is never touched; own props are UI-only)', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const touched = [];
    const hostileHost = new Proxy({}, { get(_, k) { touched.push(String(k)); throw new Error(`host touched: ${String(k)}`); }, has(_, k) { touched.push(String(k)); throw new Error('host touched'); } });
    const controller = createFakeController(vm);
    const shell = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: 'clash-panel', title: 'T', viewer: hostileHost });
    shell.show(); shell.hide();
    const instance = window.Autodesk.__stubInstances.at(-1);
    const ownKeys = Object.keys(instance).sort();
    const holdsController = Object.values(instance).some((v) => v === controller || v === vm);
    return { touched, shellKeys: Object.keys(shell).sort(), frozen: Object.isFrozen(shell), ownKeys, holdsController };
  }, panelVm());
  assert.deepEqual(r.touched, []);
  assert.deepEqual(r.shellKeys, ['dispose', 'hide', 'isVisible', 'show', 'toggle']);
  assert.equal(r.frozen, true);
  assert.equal(r.holdsController, false);
  const allowed = new Set(['visibilityCallbacks', 'titleLabel', 'options', 'parentContainer', 'container', 'title', 'closer']);
  assert.deepEqual(r.ownKeys.filter((k) => !allowed.has(k)), []);
}));

test('argument validation and construction failure clean up (no orphan container)', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createClashDockingPanelClass, createFakeController, host } = window.__t;
    const errs = [];
    const tryIt = (fn) => { try { fn(); errs.push(null); } catch (e) { errs.push(e.name); } };
    tryIt(() => createClashDockingPanelClass({}));
    tryIt(() => createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller: {}, id: 'x' }));
    tryIt(() => createPanelShell({ Autodesk: window.Autodesk, parentContainer: null, controller: createFakeController(vm), id: 'x' }));
    tryIt(() => createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller: createFakeController(vm), id: '' }));
    const broken = { ...createFakeController(vm), subscribe() { throw new RangeError('subscribe failed'); } };
    tryIt(() => createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller: broken, id: 'broken' }));
    const Cls = createClashDockingPanelClass(window.Autodesk);
    const p = new Cls(host, 'plain', 'Plain title');
    return {
      errs, orphan: document.getElementById('broken') !== null,
      isSub: p instanceof window.Autodesk.Viewing.UI.DockingPanel,
      body: p.container.querySelectorAll(':scope > .clash-panel-body').length,
      title: p.container.querySelector('.docking-panel-title').textContent,
    };
  }, panelVm());
  assert.deepEqual(r, { errs: ['TypeError', 'TypeError', 'TypeError', 'TypeError', 'RangeError'], orphan: false, isSub: true, body: 1, title: 'Plain title' });
}));

test('transactional construction: a throw from initializeMoveHandlers() or addVisibilityListener() leaves no container, subscription or listener', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    const proto = window.Autodesk.Viewing.UI.DockingPanel.prototype;
    const out = {};
    for (const method of ['initializeMoveHandlers', 'addVisibilityListener']) {
      const original = proto[method];
      proto[method] = function failing() { throw new RangeError(`${method} failed`); };
      const controller = createFakeController(vm);
      const childrenBefore = host.children.length;
      let error = null;
      try { createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller, id: `p-${method}`, title: 'T' }); } catch (e) { error = e.message; }
      proto[method] = original;
      const instance = window.Autodesk.__stubInstances.at(-1);
      out[method] = {
        error,
        inDocument: document.getElementById(`p-${method}`) !== null,
        hostChildren: host.children.length - childrenBefore,
        subscribers: controller.subscriberCount(),
        listeners: instance.visibilityCallbacks.length,
        dispatched: controller.dispatched.length,
      };
    }
    return out;
  }, panelVm());
  assert.deepEqual(r, {
    initializeMoveHandlers: { error: 'initializeMoveHandlers failed', inDocument: false, hostChildren: 0, subscribers: 0, listeners: 0, dispatched: 0 },
    addVisibilityListener: { error: 'addVisibilityListener failed', inDocument: false, hostChildren: 0, subscribers: 0, listeners: 0, dispatched: 0 },
  });
}));

test('two shells mounted at once keep separate radio groups (Soft / Element in one leaves the other unchanged)', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    for (const id of ['pa', 'pb']) {
      const shell = createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller: createFakeController(vm), id, title: id });
      shell.show();
      // The shell anchors every panel at left:10px; place them side by side so neither covers the other's inputs.
      if (id === 'pb') document.getElementById(id).style.left = '600px';
    }
  }, panelVm());
  await page.check('#pa [data-key="setup-mode-soft"]');
  await page.check('#pa [data-key="group-element"]');
  const r = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel).checked;
    return {
      a: [q('#pa [data-key="setup-mode-soft"]'), q('#pa [data-key="group-element"]')],
      b: [q('#pb [data-key="setup-mode-hard"]'), q('#pb [data-key="setup-mode-soft"]'), q('#pb [data-key="group-none"]'), q('#pb [data-key="group-element"]')],
      names: [...new Set([...document.querySelectorAll('input[type=radio]')].map((i) => i.name))].length,
    };
  });
  assert.deepEqual(r, { a: [true, true], b: [true, false, true, false], names: 4 });
}));

test('geometry: container is anchored with a bounded height; body scrolls and is opaque (live-validation regression)', () => withPage(async ({ page }) => {
  await page.evaluate(PRELUDE);
  const r = await page.evaluate((vm) => {
    const { createPanelShell, createFakeController, host } = window.__t;
    createPanelShell({ Autodesk: window.Autodesk, parentContainer: host, controller: createFakeController(vm), id: 'clash-panel', title: 'T' });
    const c = document.getElementById('clash-panel').style;
    const b = document.querySelector('#clash-panel .clash-panel-body').style;
    return {
      position: c.position, top: c.top, left: c.left, height: c.height,
      width: c.width, minWidth: c.minWidth, maxWidth: c.maxWidth, bodyTop: b.top, bodyClass: document.querySelector('#clash-panel .clash-panel-body').className,
      bodyPosition: b.position, overflowY: b.overflowY, bodyBackground: b.backgroundColor,
    };
  }, panelVm());
  assert.equal(r.position, 'absolute');
  assert.notEqual(r.top, '');
  assert.notEqual(r.left, '');
  assert.match(r.height, /^(calc\(.+\)|\d+(\.\d+)?(px|%|vh))$/, 'container height must be bounded');
  assert.equal(r.width.replace(/\s+/g, ''), 'min(460px,90vw)', `width contract, got "${r.width}"`);
  assert.equal(r.minWidth.replace(/\s+/g, ''), 'min(340px,90vw)');
  assert.equal(r.maxWidth, '90vw');
  assert.equal(r.bodyTop, '50px');
  assert.match(r.bodyClass, /docking-panel-scroll/);
  assert.equal(r.bodyPosition, 'absolute');
  assert.equal(r.overflowY, 'auto');
  assert.ok(r.bodyBackground !== '' && r.bodyBackground !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(r.bodyBackground), `opaque body background, got "${r.bodyBackground}"`);
}));
