// test/clashpanel/core/testsManager.construction.test.mjs — Task 13 codex review: construction is transactional.
// A registration that throws (or returns a non-function disposer) must unwind every earlier registration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { makeManagerHarness } from '../support/fakeEditor.mjs';

/** Fresh ports whose three subscriptions count live listeners; `mutate` may override one registration. */
function countedPorts(mutate = {}) {
  const base = makeManagerHarness().ports;
  const live = { editor: 0, catalog: 0, bridge: 0 };
  const wrap = (name, fn, override) => (cb) => {
    if (override === 'throw') throw new Error(`${name} boom`);
    if (override === 'nonfn') return 42;
    const off = fn(cb);
    live[name] += 1;
    let done = false;
    return () => { if (!done) { done = true; live[name] -= 1; off(); } };
  };
  const ports = {
    ...base,
    editor: { ...base.editor, getViewModel: () => base.editor.getViewModel(), dispatch: (i) => base.editor.dispatch(i),
      subscribe: wrap('editor', (cb) => base.editor.subscribe(cb), mutate.editor) },
    catalog: { ...base.catalog, list: (...a) => base.catalog.list(...a), keyOfModel: (...a) => base.catalog.keyOfModel(...a),
      onChange: wrap('catalog', (cb) => base.catalog.onChange(cb), mutate.catalog) },
    bridge: { ...base.bridge, onModelLeft: wrap('bridge', (cb) => base.bridge.onModelLeft(cb), mutate.bridge) },
  };
  return { ports, live };
}

test('normal construction registers all three and dispose removes them', () => {
  const { ports, live } = countedPorts();
  const manager = createTestsManager(ports);
  assert.deepEqual(live, { editor: 1, catalog: 1, bridge: 1 });
  manager.dispose();
  manager.dispose();
  assert.deepEqual(live, { editor: 0, catalog: 0, bridge: 0 });
});

test('catalog.onChange throwing unwinds the editor subscription and rethrows the original error', () => {
  const { ports, live } = countedPorts({ catalog: 'throw' });
  assert.throws(() => createTestsManager(ports), /catalog boom/);
  assert.deepEqual(live, { editor: 0, catalog: 0, bridge: 0 });
});

test('bridge.onModelLeft throwing unwinds editor and catalog', () => {
  const { ports, live } = countedPorts({ bridge: 'throw' });
  assert.throws(() => createTestsManager(ports), /bridge boom/);
  assert.deepEqual(live, { editor: 0, catalog: 0, bridge: 0 });
});

test('a non-function disposer is a TypeError and everything registered so far is removed', () => {
  for (const which of ['editor', 'catalog', 'bridge']) {
    const { ports, live } = countedPorts({ [which]: 'nonfn' });
    assert.throws(() => createTestsManager(ports), TypeError, which);
    assert.deepEqual(live, { editor: 0, catalog: 0, bridge: 0 }, which);
  }
});

test('a throwing disposer during unwind does not skip the rest, and the original error wins', () => {
  const { ports, live } = countedPorts({ bridge: 'throw' });
  const realOnChange = ports.catalog.onChange;
  ports.catalog.onChange = (cb) => { const off = realOnChange(cb); return () => { off(); throw new Error('disposer boom'); }; };
  assert.throws(() => createTestsManager(ports), /bridge boom/);
  assert.deepEqual(live, { editor: 0, catalog: 0, bridge: 0 });
});
