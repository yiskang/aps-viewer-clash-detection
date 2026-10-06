import test from 'node:test';
import assert from 'node:assert/strict';

const created = [];
class FakeButton { constructor(id) { this.id = id; this.container = { id }; this.states = []; } setToolTip(t) { this.tip = t; } setState(st) { this.state = st; this.states.push(st); } }
FakeButton.State = { ACTIVE: 0, INACTIVE: 1, DISABLED: 2 };
class FakeGroup { constructor(id) { this.id = id; this.controls = []; } addControl(c) { this.controls.push(c); } removeControl(c) { this.controls = this.controls.filter((x) => x !== c); } }
globalThis.Autodesk = { Viewing: { TOOLBAR_CREATED_EVENT: 'toolbarCreated', UI: { Button: FakeButton, ControlGroup: FakeGroup } } };
const { ClashPanelExtension, EXTENSION_ID, TOOLBAR_BUTTON_ID, TOOLBAR_BUTTON_TITLE } = await import('../wwwroot/extensions/ClashPanelExtension.js');

function fakeViewer({ withToolbar = true } = {}) {
  const listeners = new Map();
  const groups = [];
  return {
    toolbar: withToolbar ? { addControl: (g) => groups.push(g), removeControl: (g) => groups.splice(groups.indexOf(g), 1) } : null,
    groups,
    addEventListener(n, f) { listeners.set(n, f); },
    removeEventListener(n, f) { if (listeners.get(n) === f) listeners.delete(n); },
    listeners,
  };
}
function fakeHost(log) {
  let visible = false;
  return { toggle() { visible = !visible; log.push('toggle'); }, isVisible: () => visible, dispose: async () => { log.push('dispose'); } };
}

test('id is distinct and namespaced like its siblings', () => {
  assert.equal(EXTENSION_ID, 'Autodesk.Sandbox.ClashPanel');
});

test('load adds a button with stable id + tooltip; click lazily creates the host once and toggles', async () => {
  const log = []; let creates = 0;
  const viewer = fakeViewer();
  const ext = new ClashPanelExtension(viewer, { createHost: async () => { creates++; return fakeHost(log); } });
  assert.equal(ext.load(), true);
  assert.equal(viewer.groups.length, 1);
  const button = viewer.groups[0].controls[0];
  assert.equal(button.container.id, TOOLBAR_BUTTON_ID);
  assert.equal(TOOLBAR_BUTTON_ID, 'clash-panel-toolbar-button');
  assert.equal(button.tip, TOOLBAR_BUTTON_TITLE);
  assert.equal(creates, 0, 'no host before first toggle');
  await Promise.all([ext.toggle(), ext.toggle()]);
  assert.equal(creates, 1);
  assert.deepEqual(log, ['toggle'], 'rapid first-use clicks coalesce into ONE open');
  await ext.unload();
});

test('toolbar created later: button added on TOOLBAR_CREATED_EVENT; listener removed after', async () => {
  const viewer = fakeViewer({ withToolbar: false });
  const ext = new ClashPanelExtension(viewer, { createHost: async () => fakeHost([]) });
  ext.load();
  assert.equal(viewer.groups.length, 0);
  viewer.toolbar = { addControl: (g) => viewer.groups.push(g), removeControl: (g) => viewer.groups.splice(viewer.groups.indexOf(g), 1) };
  viewer.listeners.get('toolbarCreated')();
  assert.equal(viewer.groups.length, 1);
  assert.equal(viewer.listeners.size, 0);
  await ext.unload();
  assert.equal(viewer.groups.length, 0);
});

test('unload disposes the host (awaited, errors swallowed), removes the button; repeated cycles do not leak', async () => {
  const log = [];
  const viewer = fakeViewer();
  for (let i = 0; i < 3; i++) {
    const ext = new ClashPanelExtension(viewer, { createHost: async () => ({ ...fakeHost(log), dispose: async () => { log.push('dispose'); throw new Error('boom'); } }) });
    ext.load();
    await ext.toggle();
    assert.equal(await ext.unload(), true);
    assert.equal(viewer.groups.length, 0);
    assert.equal(viewer.listeners.size, 0);
    await ext.unload(); // idempotent
  }
  assert.equal(log.filter((x) => x === 'dispose').length, 3);
});

test('unload racing a pending host creation still disposes the host; toggle after unload is a no-op', async () => {
  const log = []; let release;
  const gate = new Promise((r) => { release = r; });
  const viewer = fakeViewer();
  const ext = new ClashPanelExtension(viewer, { createHost: async () => { await gate; return fakeHost(log); } });
  ext.load();
  const t = ext.toggle();
  const u = ext.unload();
  release();
  await Promise.all([t, u]);
  assert.deepEqual(log, ['dispose']);
  assert.equal(await ext.toggle(), false);
});

test('failed creation does not poison later toggles', async () => {
  let n = 0; const log = [];
  const prevAlert = globalThis.alert; globalThis.alert = () => {};
  const origErr = console.error; console.error = () => {};
  try {
    const ext = new ClashPanelExtension(fakeViewer(), { createHost: async () => { if (++n === 1) throw new Error('first fails'); return fakeHost(log); } });
    ext.load();
    assert.equal(await ext.toggle(), false);
    assert.equal(await ext.toggle(), true);
    assert.deepEqual(log, ['toggle']);
    await ext.unload();
  } finally { console.error = origErr; globalThis.alert = prevAlert; }
});

test('L2: rapid clicks during creation end open; a later click then closes', async () => {
  const log = []; let host;
  const ext = new ClashPanelExtension(fakeViewer(), { createHost: async () => { host = fakeHost(log); return host; } });
  ext.load();
  await Promise.all([ext.toggle(), ext.toggle(), ext.toggle()]);
  assert.equal(host.isVisible(), true);
  await ext.toggle();
  assert.equal(host.isVisible(), false);
  await ext.unload();
});

test('L1: toolbar button active state follows panel visibility (open, close, unload)', async () => {
  const viewer = fakeViewer();
  const ext = new ClashPanelExtension(viewer, { createHost: async () => fakeHost([]) });
  ext.load();
  const button = viewer.groups[0].controls[0];
  await ext.toggle();
  assert.equal(button.state, FakeButton.State.ACTIVE);
  await ext.toggle();
  assert.equal(button.state, FakeButton.State.INACTIVE);
  await ext.toggle();
  assert.equal(button.state, FakeButton.State.ACTIVE);
  ext.syncButtonState(); // e.g. after the panel's own close (X) button
  assert.equal(button.state, FakeButton.State.ACTIVE);
  await ext.unload();
  assert.equal(ext.syncButtonState(), undefined); // quiet after unload
});

test('L5: unload is idempotent (one dispose), and late callbacks after unload are quiet', async () => {
  const log = []; let release;
  const gate = new Promise((r) => { release = r; });
  const ext = new ClashPanelExtension(fakeViewer(), { createHost: async () => { await gate; return { ...fakeHost(log), toggle() { throw new Error('late'); } }; } });
  ext.load();
  const t = ext.toggle();
  const u1 = ext.unload();
  const u2 = ext.unload();
  release();
  assert.equal(await t, false);
  assert.equal(await u1, true);
  assert.equal(await u2, true);
  assert.equal(log.filter((x) => x === 'dispose').length, 1);
  ext._createToolbarUI(); // late toolbarCreated callback
  assert.equal(ext._button, null);
  assert.equal(await ext.toggle(), false);
});

test('L5: a host.toggle that throws after unload is swallowed; before unload it surfaces as failure', async () => {
  const ext = new ClashPanelExtension(fakeViewer(), { createHost: async () => ({ ...fakeHost([]), toggle() { throw new Error('x'); } }) });
  ext.load();
  const origErr = console.error; console.error = () => {};
  try { assert.equal(await ext.toggle(), false); } finally { console.error = origErr; }
  await ext.unload();
});
