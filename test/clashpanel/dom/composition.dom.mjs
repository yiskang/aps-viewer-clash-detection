// test/clashpanel/dom/composition.dom.mjs — createClashPanel end-to-end over fake ports in Chromium (Task 32).
// Real core controller + real ViewerBridge/viewerApi + real UI, fake engine/catalog/viewer/THREE (inPageFakes.mjs).
// Event-driven waits only (page.waitForFunction on view-model / fake state); no fixed sleeps, no timing assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage } from './support/harness.mjs';

async function boot(page) {
  await page.evaluate(async () => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const world = fakes.createWorld();
    const panel = createClashPanel({
      Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE,
      engine: world.engine, catalog: world.catalog, events: world.events,
    });
    window.__e2e = { world, panel, vmOf: () => panel.controller.getViewModel() };
    panel.show();
  });
}

async function waitVm(page, predicateSource) {
  // predicateSource: a function (vm) => boolean, serialized; evaluated against the controller's current view-model.
  await page.waitForFunction(`(${predicateSource})(window.__e2e.vmOf())`);
}

async function configureAndRun(page) {
  await page.click('#clash-detection-panel [data-key="setup-A-mA"]');
  await waitVm(page, (vm) => vm.setup.models.some((m) => m.modelKey === 'mA' && m.inA));
  await page.click('#clash-detection-panel [data-key="setup-B-mB"]');
  await waitVm(page, (vm) => vm.setup.models.some((m) => m.modelKey === 'mB' && m.inB));
  await waitVm(page, (vm) => vm.setup.validation.state === 'ready' && vm.run.canRun === true);
  await page.click('#clash-detection-panel [data-key="run-start"]');
  await page.waitForFunction(() => window.__e2e.world.engine.handles.length === 1);
}

async function finishRun(page) {
  await page.evaluate(() => window.__e2e.world.engine.handles[0].progress({ unitsEvaluated: 1, unitsTotal: 2, resultsFound: 2 }));
  await waitVm(page, (vm) => vm.run.state === 'running' && vm.run.canStop === true && vm.run.progress !== null);
  const during = await page.evaluate(() => ({
    rows: document.querySelectorAll('#clash-detection-panel .clash-row').length,
    progress: document.querySelector('#clash-detection-panel progress')?.getAttribute('aria-valuenow') ?? null,
    stop: document.querySelector('#clash-detection-panel [data-key="run-stop"]').disabled,
  }));
  await page.evaluate(() => window.__e2e.world.engine.handles[0].finish());
  await waitVm(page, (vm) => vm.run.state === 'done' && vm.results.state === 'list' && vm.results.rows.length === 3);
  return during;
}

async function selectFirstRowWithMarkers(page) {
  await page.click('#clash-detection-panel .clash-row >> nth=0');
  await waitVm(page, (vm) => vm.selected !== null && vm.selected.resultId === 'r1');
  const markersOn = await page.evaluate(() => window.__e2e.vmOf().selected.actions.markers.checked);
  if (!markersOn) {
    await page.check('#clash-detection-panel [data-key="action-markers"]');
    await waitVm(page, (vm) => vm.selected.actions.markers.checked === true);
  }
  await page.waitForFunction(() => window.__e2e.world.viewer.meshCount() > 0);
}

test('E2E (Option E): a front-loaded pair-space fraction does not drive the bar; the shown % is settled units / total, labelled', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  // The Architecture self-clash shape: 80 of 4,294 units settled while 2/3 of the pair space is covered.
  await page.evaluate(() => window.__e2e.world.engine.handles[0].progress({ unitsEvaluated: 80, unitsTotal: 4294, resultsFound: 7, pairSpace: { processed: 2, total: 3 } }));
  await waitVm(page, (vm) => vm.run.state === 'running' && vm.run.progress !== null && vm.run.progress.unitsEvaluated === 80);
  const shown = await page.evaluate(() => {
    const bar = document.querySelector('#clash-detection-panel progress');
    return {
      now: bar.getAttribute('aria-valuenow'), text: bar.getAttribute('aria-valuetext'), value: bar.value,
      pct: document.querySelector('#clash-detection-panel .clash-progress-pct').textContent,
      units: document.querySelector('#clash-detection-panel .clash-progress-units').textContent,
    };
  });
  assert.deepEqual(shown, { now: '2', text: '2% of units processed', value: 80 / 4294, pct: ' 2% of units ·', units: ' units 80/4294' });
  assert.equal(shown.pct.includes('67'), false, 'the 66.7% pair-space figure is not presented as progress');
  await page.evaluate(() => window.__e2e.world.engine.handles[0].finish());
  await waitVm(page, (vm) => vm.run.state === 'done');
}));

test('E2E: setup by clicks → Run → progress → done → list → select presents markers → Back to all → dispose leaves nothing', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  const during = await finishRun(page);
  assert.deepEqual(during, { rows: 0, progress: '50', stop: false }); // AC-P3: no list during a run; Stop enabled

  const listed = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#clash-detection-panel .clash-row')].map((li) => li.getAttribute('aria-selected')),
    counts: document.querySelector('#clash-detection-panel .clash-counts')?.textContent ?? null,
  }));
  assert.deepEqual(listed.rows, ['false', 'false', 'false']);
  assert.match(listed.counts, /^3 clashes/);

  // Copy diagnostics: the real controller resolves the full plain-JSON string; the UI writes it to the clipboard.
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
  });
  await page.click('#clash-detection-panel [data-key="diagnostics-copy"]');
  await page.waitForFunction(() => window.__copied.length === 1);
  const copied = await page.evaluate(() => JSON.parse(window.__copied[0]));
  assert.equal(typeof copied, 'object');
  assert.notEqual(copied, null);
  // Run details (spec §8.4) from the real view-model render as a native <details> of label/value rows.
  const details = await page.evaluate(() => ({
    rows: document.querySelectorAll('#clash-detection-panel .clash-run-details dt').length,
    vmRows: window.__e2e.vmOf().run.details?.lines.length ?? 0,
  }));
  assert.ok(details.vmRows > 0);
  assert.equal(details.rows, details.vmRows);

  await selectFirstRowWithMarkers(page);
  const selected = await page.evaluate(() => ({
    ariaSelected: document.querySelector('#clash-detection-panel .clash-row[aria-selected="true"]')?.getAttribute('data-key') ?? null,
    detail: document.querySelector('#clash-detection-panel .clash-selected')?.getAttribute('data-result-id') ?? null,
    addMesh: window.__e2e.world.viewer.calls.filter((c) => c[0] === 'addMesh').length,
  }));
  assert.ok(selected.ariaSelected.endsWith('r1'));
  assert.equal(selected.detail, 'r1');
  assert.ok(selected.addMesh >= 1);

  await page.click('#clash-detection-panel [data-key="action-back-to-all"]');
  await waitVm(page, (vm) => vm.selected === null);
  await page.waitForFunction(() => window.__e2e.world.viewer.meshCount() === 0);

  await selectFirstRowWithMarkers(page);
  await page.evaluate(() => window.__e2e.panel.dispose());
  const after = await page.evaluate(() => {
    const { world } = window.__e2e;
    return {
      meshes: world.viewer.meshCount(),
      viewerListeners: world.viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      runListeners: world.engine.handles[0].listenerCount(),
      leases: world.engine.activeLeases(),
      panelInDom: document.getElementById('clash-detection-panel') !== null,
      theming: world.viewer.calls.filter((c) => /Theming/.test(c[0])).length,
      forbidden: world.engine.calls.filter((c) => ['register', 'unregister', 'invalidateModelPlacement', 'wireModelUnload'].includes(c[0])).length,
      showAfterDispose: (() => { window.__e2e.panel.show(); return window.__e2e.panel.isVisible(); })(),
    };
  });
  assert.deepEqual(after, {
    meshes: 0, viewerListeners: 0, catalogListeners: 0, runListeners: 0, leases: 0,
    panelInDom: false, theming: 0, forbidden: 0, showAfterDispose: false,
  });
}));

test('E2E: hiding the panel clears Panel-owned markers but keeps the selection; showing again rebuilds the same DOM', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  await finishRun(page);
  await selectFirstRowWithMarkers(page);
  // Regions 1, 3 and 4 (setup, filters/grouping, page + selected row) must be rebuilt identically; Region 2's
  // status text and Region 5's marker state may legitimately change on hide (spec §9.6: markers cleared).
  const regionsSnapshot = async () => page.evaluate(async () => {
    const { snapshotDom } = await import('/test/clashpanel/dom/support/mount.mjs');
    return JSON.stringify(['setup', 'filters', 'results'].map((r) => snapshotDom(document.querySelector(`#clash-detection-panel section[data-region="${r}"]`))));
  });
  const before = await regionsSnapshot();
  await page.evaluate(() => window.__e2e.panel.hide());
  await page.waitForFunction(() => window.__e2e.world.viewer.meshCount() === 0);
  await waitVm(page, (vm) => vm.selected !== null && vm.selected.resultId === 'r1');
  await page.evaluate(() => window.__e2e.panel.show());
  const r = await page.evaluate(() => ({
    visible: window.__e2e.panel.isVisible(),
    selected: window.__e2e.vmOf().selected?.resultId ?? null,
    detail: document.querySelector('#clash-detection-panel .clash-selected')?.getAttribute('data-result-id') ?? null,
  }));
  r.dom = await regionsSnapshot();
  assert.equal(r.visible, true);
  assert.equal(r.selected, 'r1');
  assert.equal(r.detail, 'r1');
  assert.equal(r.dom, before);
  await page.evaluate(() => window.__e2e.panel.dispose());
}));

test('E2E: dispose during an active run cancels it with reason panel-disposed and leaves no listener', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  await page.evaluate(() => window.__e2e.world.engine.handles[0].progress({ unitsEvaluated: 1, unitsTotal: 4, resultsFound: 0 }));
  await waitVm(page, (vm) => vm.run.state === 'running');
  await page.evaluate(() => window.__e2e.panel.dispose());
  const r = await page.evaluate(() => {
    const { world } = window.__e2e;
    return {
      reasons: world.engine.handles[0].cancelReasons,
      runListeners: world.engine.handles[0].listenerCount(),
      viewerListeners: world.viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      meshes: world.viewer.meshCount(),
      leases: world.engine.activeLeases(),
    };
  });
  const { reasons, ...rest } = r;
  assert.ok(reasons.includes('panel-disposed'), JSON.stringify(reasons));
  assert.deepEqual(rest, { runListeners: 0, viewerListeners: 0, catalogListeners: 0, meshes: 0, leases: 0 });
}));

test('dispose: idempotent (same promise) and a failing shell step still runs controller + bridge teardown', () => withPage(async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const { world, panel } = window.__e2e;
    const proto = window.Autodesk.Viewing.UI.DockingPanel.prototype;
    const original = proto.uninitialize;
    proto.uninitialize = function failingUninitialize() { original.call(this); throw new Error('uninitialize failed'); };
    const p1 = panel.dispose();
    const p2 = panel.dispose();
    let error = null;
    try { await p1; } catch (e) { error = { name: e.name, inner: e.errors.map((x) => x.message) }; }
    proto.uninitialize = original;
    return { same: p1 === p2, error, viewerListeners: world.viewer.listenerCount(), catalogListeners: world.catalog.listenerCount() };
  });
  assert.deepEqual(r, { same: true, error: { name: 'AggregateError', inner: ['uninitialize failed'] }, viewerListeners: 0, catalogListeners: 0 });
}));

test('createClashPanel: argument validation (viewer, events) throws TypeError before creating anything', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const world = fakes.createWorld();
    const base = { Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events };
    const out = [];
    for (const over of [{ viewer: null }, { events: undefined }, { events: { BEFORE_MODEL_UNLOAD: 'x' } }]) {
      try { createClashPanel({ ...base, ...over }); out.push(null); } catch (e) { out.push(e.name); }
    }
    return { out, panels: document.querySelectorAll('.docking-panel').length, listeners: world.viewer.listenerCount() };
  });
  assert.deepEqual(r, { out: ['TypeError', 'TypeError', 'TypeError'], panels: 0, listeners: 0 });
}));

test('boot: the panel mounts into viewer.container, hidden until show(), with the five regions', () => withPage(async ({ page }) => {
  await page.evaluate(async () => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const world = fakes.createWorld();
    const panel = createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events });
    window.__e2e = { world, panel, vmOf: () => panel.controller.getViewModel() };
  });
  const r = await page.evaluate(() => {
    const el = document.getElementById('clash-detection-panel');
    const hiddenAtBoot = !window.__e2e.panel.isVisible();
    window.__e2e.panel.show();
    return {
      parent: el.parentNode === window.__e2e.world.viewer.container,
      hiddenAtBoot,
      visible: window.__e2e.panel.isVisible(),
      regions: [...el.querySelectorAll('section')].map((s) => s.dataset.region),
      keys: Object.keys(window.__e2e.panel).sort(),
      version: typeof window.__e2e.vmOf().version,
    };
  });
  assert.deepEqual(r, {
    parent: true, hiddenAtBoot: true, visible: true, regions: ['setup', 'run', 'filters', 'results', 'selected'],
    keys: ['controller', 'dispose', 'hide', 'isVisible', 'show', 'toggle'], version: 'number',
  });
  // Ruling C-3 (T1 scope note): the package entry exports exactly createClashPanel and re-exports no presentation
  // constant (PAGE_SIZE, …) from core/constants.js (AC-P11).
  const surface = await page.evaluate(async () => ({
    index: Object.keys(await import('/clashpanel/index.js')).sort(),
    constants: Object.keys(await import('/clashpanel/core/constants.js')),
  }));
  assert.deepEqual(surface.index, ['createClashPanel']);
  assert.deepEqual(surface.index.filter((name) => surface.constants.includes(name)), []);
  await page.evaluate(() => window.__e2e.panel.dispose());
}));

test('dispose during a HELD run stays pending until the engine finishes it, then leaves no mesh, listener or retained set', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  await page.evaluate(() => window.__e2e.world.engine.handles[0].progress({ unitsEvaluated: 1, unitsTotal: 4, resultsFound: 1 }));
  await waitVm(page, (vm) => vm.run.state === 'running');
  await page.evaluate(() => {
    const { world, panel } = window.__e2e;
    world.engine.options.holdCancel = true;
    window.__disposeState = 'pending';
    window.__dispose = panel.dispose().then(() => { window.__disposeState = 'resolved'; }, (e) => { window.__disposeState = `rejected:${e?.name}`; });
  });
  // let every queued task/microtask run; the run is still held, so dispose must still be pending
  for (let i = 0; i < 5; i += 1) await page.evaluate(() => new Promise((res) => setTimeout(res, 0)));
  const held = await page.evaluate(() => ({ state: window.__disposeState, reasons: window.__e2e.world.engine.handles[0].cancelReasons }));
  assert.equal(held.state, 'pending');
  assert.ok(held.reasons.includes('panel-disposed'), JSON.stringify(held.reasons));
  await page.evaluate(async () => {
    window.__e2e.world.engine.handles[0].finish({ status: 'cancelled' });   // saved, with results: a set to release
    await window.__dispose;
  });
  const r = await page.evaluate(() => {
    const { world } = window.__e2e;
    return {
      state: window.__disposeState,
      meshes: world.viewer.meshCount(),
      viewerListeners: world.viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      runListeners: world.engine.handles[0].listenerCount(),
      leases: world.engine.activeLeases(),
      released: world.engine.calls.some((c) => (c[0] === 'releaseResultSet' || c[0] === 'lease.release') && c[1] === 'run-1'),
    };
  });
  assert.deepEqual(r, { state: 'resolved', meshes: 0, viewerListeners: 0, catalogListeners: 0, runListeners: 0, leases: 0, released: true });
}));

test('two panels on ONE viewer own instance-scoped overlay scenes: clearing/disposing one leaves the other intact', () => withPage(async ({ page }) => {
  await page.evaluate(async () => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const { INTENT } = await import('/clashpanel/core/intents.js');
    const world = fakes.createWorld();
    const make = (id) => createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events, id });
    window.__two = { world, INTENT, a: make('panel-a'), b: make('panel-b') };
  });
  const drive = async (name, handleIndex) => {
    const vm = `window.__two.${name}.controller.getViewModel()`;
    await page.evaluate(async (n) => {
      const { INTENT } = window.__two;
      const c = window.__two[n].controller;
      await c.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
      await c.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
    }, name);
    await page.waitForFunction(`${vm}.run.canRun === true`);
    await page.evaluate((n) => window.__two[n].controller.dispatch({ type: window.__two.INTENT.RUN_START }), name);
    await page.waitForFunction(`window.__two.world.engine.handles.length === ${handleIndex + 1}`);
    await page.evaluate((i) => window.__two.world.engine.handles[i].finish(), handleIndex);
    await page.waitForFunction(`${vm}.results.state === 'list'`);
    await page.evaluate((n) => window.__two[n].controller.dispatch({ type: window.__two.INTENT.NAV_SELECT, resultId: 'r1', groupId: null }), name);
    await page.waitForFunction(`${vm}.selected !== null`);
    if (!(await page.evaluate(`${vm}.selected.actions.markers.checked`))) {
      await page.evaluate((n) => window.__two[n].controller.dispatch({ type: window.__two.INTENT.ACTION_MARKERS, value: true }), name);
    }
    await page.waitForFunction(`(window.__two.world.viewer.sceneMeshes()['clash-panel-markers:${name === 'a' ? 'panel-a' : 'panel-b'}'] ?? 0) > 0`);
  };
  await drive('a', 0);
  await drive('b', 1);
  const scenes = () => page.evaluate(() => window.__two.world.viewer.sceneMeshes());
  const both = await scenes();
  assert.ok(both['clash-panel-markers:panel-a'] > 0 && both['clash-panel-markers:panel-b'] > 0, JSON.stringify(both));
  const bCount = both['clash-panel-markers:panel-b'];

  await page.evaluate(() => window.__two.a.controller.dispatch({ type: window.__two.INTENT.ACTION_BACK_TO_ALL }));
  await page.waitForFunction(() => (window.__two.world.viewer.sceneMeshes()['clash-panel-markers:panel-a'] ?? 0) === 0);
  assert.equal((await scenes())['clash-panel-markers:panel-b'], bCount);

  await page.evaluate(() => window.__two.a.dispose());
  const afterA = await scenes();
  assert.equal(afterA['clash-panel-markers:panel-b'], bCount);
  assert.equal(await page.evaluate(() => document.getElementById('panel-b') !== null && document.getElementById('panel-a') === null), true);

  await page.evaluate(() => window.__two.b.dispose());
  const r = await page.evaluate(() => ({ meshes: window.__two.world.viewer.meshCount(), listeners: window.__two.world.viewer.listenerCount() }));
  assert.deepEqual(r, { meshes: 0, listeners: 0 });
}));

test('construction rollback: createClashPanel failing mid-construction leaves no DOM node, subscription, viewer listener or overlay', () => withPage(async ({ page }) => {
  const r = await page.evaluate(async () => {
    const fakes = await import('/test/clashpanel/dom/support/inPageFakes.mjs');
    const { createClashPanel } = await import('/clashpanel/index.js');
    const out = {};
    // (a) the shell fails (DockingPanel initialize path throws after the base constructor appended its container)
    {
      const world = fakes.createWorld();
      const proto = window.Autodesk.Viewing.UI.DockingPanel.prototype;
      const original = proto.initializeMoveHandlers;
      proto.initializeMoveHandlers = () => { throw new RangeError('shell failed'); };
      let error = null;
      try { createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: world.engine, catalog: world.catalog, events: world.events, id: 'rb-a' }); } catch (e) { error = e.message; }
      proto.initializeMoveHandlers = original;
      out.a = { error, world };
    }
    // (b) the controller fails (the engine port is not an engine)
    {
      const world = fakes.createWorld();
      let error = null;
      try { createClashPanel({ Autodesk: window.Autodesk, viewer: world.viewer, THREE: world.THREE, engine: {}, catalog: world.catalog, events: world.events, id: 'rb-b' }); } catch (e) { error = e.name; }
      out.b = { error, world };
    }
    window.__rb = out;
    return { a: out.a.error, b: out.b.error };
  });
  assert.deepEqual(r, { a: 'shell failed', b: 'TypeError' });
  // teardown of the already-created controller/bridge is asynchronous: wait for it, then assert everything at once
  await page.waitForFunction(() => ['a', 'b'].every((k) => window.__rb[k].world.viewer.listenerCount() === 0 && window.__rb[k].world.catalog.listenerCount() === 0));
  const state = await page.evaluate(() => Object.fromEntries(['a', 'b'].map((k) => {
    const { world } = window.__rb[k];
    return [k, {
      panels: document.querySelectorAll(`#rb-${k}, .docking-panel`).length,
      containerChildren: world.viewer.container.children.length,
      viewerListeners: world.viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      meshes: world.viewer.meshCount(),
      scenes: Object.keys(world.viewer.sceneMeshes()).length,
      theming: world.viewer.calls.filter((c) => /Theming/.test(c[0])).length,
    }];
  })));
  const clean = { panels: 0, containerChildren: 0, viewerListeners: 0, catalogListeners: 0, meshes: 0, scenes: 0, theming: 0 };
  assert.deepEqual(state, { a: clean, b: clean });
}));

test('dispose folds the controller\'s {released:false, errors} into the AggregateError, after every step ran', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  await finishRun(page);
  await selectFirstRowWithMarkers(page);
  const r = await page.evaluate(async () => {
    const { world, panel } = window.__e2e;
    world.engine.options.failRelease = true;
    let error = null;
    try { await panel.dispose(); } catch (e) { error = { name: e.name, inner: e.errors.map((x) => x.message) }; }
    return {
      error,
      meshes: world.viewer.meshCount(),
      viewerListeners: world.viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      panelInDom: document.getElementById('clash-detection-panel') !== null,
    };
  });
  assert.equal(r.error?.name, 'AggregateError');
  assert.ok(r.error.inner.some((m) => /release failed for run-1/.test(m)), JSON.stringify(r.error));
  assert.deepEqual({ ...r, error: undefined }, { error: undefined, meshes: 0, viewerListeners: 0, catalogListeners: 0, panelInDom: false });
}));

test('C-M1: bridge teardown failures (listener removal, isolation restore) make dispose reject with an AggregateError, after every step ran', () => withPage(async ({ page }) => {
  await boot(page);
  await configureAndRun(page);
  await finishRun(page);
  await selectFirstRowWithMarkers(page);
  await page.check('#clash-detection-panel [data-key="action-isolate"]');
  await page.waitForFunction(() => window.__e2e.world.viewer.getAggregateIsolation().length > 0);
  const r = await page.evaluate(async () => {
    const { world, panel } = window.__e2e;
    const { viewer } = world;
    const removeListener = viewer.removeEventListener;
    viewer.removeEventListener = function failingRemove(type, fn) { removeListener.call(this, type, fn); throw new Error('removeEventListener failed'); };
    viewer.setAggregateIsolation = () => { throw new Error('setAggregateIsolation failed'); };
    const p1 = panel.dispose();
    const p2 = panel.dispose();
    let error = null;
    try { await p1; } catch (e) { error = { name: e.name, inner: e.errors.map((x) => x.message) }; }
    let again = null;
    try { await p2; } catch (e) { again = e.name; }
    return {
      same: p1 === p2,
      again,
      error,
      meshes: viewer.meshCount(),
      viewerListeners: viewer.listenerCount(),
      catalogListeners: world.catalog.listenerCount(),
      leases: world.engine.activeLeases(),
      panelInDom: document.getElementById('clash-detection-panel') !== null,
    };
  });
  assert.equal(r.error?.name, 'AggregateError', JSON.stringify(r));
  assert.ok(r.error.inner.some((m) => /removeEventListener failed/.test(m)), JSON.stringify(r.error));
  assert.ok(r.error.inner.some((m) => /Isolation could not be restored/.test(m)), JSON.stringify(r.error));
  assert.deepEqual({ ...r, error: undefined }, {
    same: true, again: 'AggregateError', error: undefined, meshes: 0, viewerListeners: 0, catalogListeners: 0, leases: 0, panelInDom: false,
  });
}));
