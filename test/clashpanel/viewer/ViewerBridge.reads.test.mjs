// test/clashpanel/viewer/ViewerBridge.reads.test.mjs — T26 bridge reads + model-left events
// (Tier B; event dispatch order/payloads of the live Viewer are gate G2 / F8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerBridge } from '../../../clashpanel/viewer/ViewerBridge.js';
import { ISOLATION_REASON, ISOLATION_NOTE } from '../../../clashpanel/viewer/isolation.js';
import { createBridgeHarness, NAMES, EVENTS } from '../support/viewerFaults.mjs';
import { createFakeModel } from '../support/fakeViewer.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

const MUTATORS = new Set(['addScene', 'addMesh', 'removeMesh', 'removeScene', 'setAggregateIsolation', 'fitToView']);

function setup(opts = {}) {
  const h = createBridgeHarness(opts);
  const bridge = createViewerBridge({ viewerApi: h.api, THREE: createFakeThree().THREE, names: NAMES });
  return { h, bridge };
}

test('checkIsolationPrerequisite: sync, read-only; available / hidden / unreadable / disposed', async () => {
  const { h, bridge } = setup();
  assert.deepEqual(bridge.checkIsolationPrerequisite(), { available: true, reason: null });
  h.viewer.setHiddenNodes([{ model: h.models[0], ids: [2] }]);
  assert.deepEqual(bridge.checkIsolationPrerequisite(), { available: false, reason: ISOLATION_REASON.HIDDEN });
  h.viewer.setHiddenNodes([]);
  h.failAt('getAggregateIsolation', 'before');
  assert.deepEqual(bridge.checkIsolationPrerequisite(), { available: false, reason: ISOLATION_REASON.UNREADABLE });
  assert.deepEqual(h.log.filter((e) => MUTATORS.has(e.method)), []);
  await bridge.dispose();
  assert.equal(bridge.checkIsolationPrerequisite().available, false);
});

test('checkIsolationPrerequisite stays available while the Panel owns the current isolation', async () => {
  const { h, bridge } = setup();
  const [m1] = h.models;
  await bridge.present({ sides: [{ model: m1, dbId: 1 }], options: { focus: false, isolate: true, marker: false } });
  h.viewer.setHiddenNodes([{ model: m1, ids: [5] }]);        // e.g. the Viewer reporting isolation-hidden nodes
  assert.equal(bridge.checkIsolationPrerequisite().available, true);
  h.viewer.setIsolationState([]);
  assert.equal(bridge.checkIsolationPrerequisite().available, false, 'ownership lost ⇒ the §9.5 check applies again');
});

test('readAggregateSelection: [{model, dbIds}] sorted/de-duplicated, scene models only, never throws', () => {
  const outside = createFakeModel({ id: 'outside' });
  const m1 = createFakeModel({ id: 'm1' }); const m2 = createFakeModel({ id: 'm2' });
  const { h, bridge } = setup({ models: [m1, m2], selection: [
    { model: m1, selection: [5, 2, 5, -1, 1.5] }, { model: m2, selection: [] }, { model: outside, selection: [1] },
  ] });
  assert.deepEqual(bridge.readAggregateSelection(), [{ model: m1, dbIds: [2, 5] }]);
  h.failAt('getAggregateSelection', 'before');
  assert.deepEqual(bridge.readAggregateSelection(), []);
  assert.deepEqual(h.log.filter((e) => MUTATORS.has(e.method)), []);
});

test('onModelLeft subscribes exactly once per event name however many callbacks; reasons unload/removed', () => {
  const { h, bridge } = setup();
  const [m1] = h.models;
  const a = []; const b = [];
  bridge.onModelLeft((e) => a.push(e));
  bridge.onModelLeft((e) => b.push(e));
  assert.equal(h.viewer.listenerCount(EVENTS.BEFORE_MODEL_UNLOAD), 1);
  assert.equal(h.viewer.listenerCount(EVENTS.MODEL_REMOVED), 1);
  h.viewer.dispatch(EVENTS.BEFORE_MODEL_UNLOAD, { model: m1 });
  h.viewer.dispatch(EVENTS.MODEL_REMOVED, { model: m1 });
  assert.deepEqual(a, [{ model: m1, reason: 'unload' }, { model: m1, reason: 'removed' }]);
  assert.deepEqual(b, a);
});

test('hideModel scenario: only MODEL_REMOVED fires ⇒ exactly one "removed" callback', () => {
  const { h, bridge } = setup();
  const got = [];
  bridge.onModelLeft((e) => got.push(e));
  h.viewer.dispatch(EVENTS.MODEL_REMOVED, { model: h.models[1] });
  assert.deepEqual(got, [{ model: h.models[1], reason: 'removed' }]);
});

test('payload guard: an event without a model is ignored; a throwing callback never breaks dispatch or others', () => {
  const { h, bridge } = setup();
  const got = [];
  bridge.onModelLeft(() => { throw new Error('controller bug'); });
  bridge.onModelLeft((e) => got.push(e));
  for (const payload of [undefined, null, {}, { model: null }, { model: 3 }]) h.viewer.dispatch(EVENTS.BEFORE_MODEL_UNLOAD, payload);
  assert.deepEqual(got, []);
  assert.doesNotThrow(() => h.viewer.dispatch(EVENTS.MODEL_REMOVED, { model: h.models[0] }));
  assert.equal(got.length, 1);
});

test('unsubscribe stops one callback; dispose removes both listeners symmetrically; later onModelLeft is inert', async () => {
  const { h, bridge } = setup();
  const got = [];
  const off = bridge.onModelLeft((e) => got.push(e));
  off(); off();
  h.viewer.dispatch(EVENTS.MODEL_REMOVED, { model: h.models[0] });
  assert.deepEqual(got, []);
  await bridge.dispose();
  assert.equal(h.viewer.listenerCount(EVENTS.BEFORE_MODEL_UNLOAD), 0);
  assert.equal(h.viewer.listenerCount(EVENTS.MODEL_REMOVED), 0);
  const late = bridge.onModelLeft((e) => got.push(e));
  assert.equal(typeof late, 'function');
  assert.equal(h.viewer.listenerCount(EVENTS.MODEL_REMOVED), 0, 'no re-subscription after dispose');
  assert.throws(() => bridge.onModelLeft('nope'), TypeError);
});

test('present uses fit.js: two models ⇒ one aggregate fit keyed `selection`; Focus off ⇒ no fit at all', async () => {
  const { h, bridge } = setup();
  const [m1, m2] = h.models;
  const sides = [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }];
  const o = await bridge.present({ sides, options: { focus: true, isolate: false, marker: false } });
  assert.equal(o.fitted, true);
  assert.deepEqual(h.viewer.calls.fitToView.map((c) => [c.form, c.args[0], c.args[1]]), [['aggregate', [{ model: m1, selection: [1] }, { model: m2, selection: [2] }], undefined]]);
  assert.deepEqual([...o.notes], []);
  h.log.length = 0;
  const o2 = await bridge.present({ sides, options: { focus: false, isolate: false, marker: false } });
  assert.equal(o2.fitted, false);
  assert.deepEqual(h.callsOf('fitToView'), []);
});

// Carry-forward (T22/T25 reviews): dispose must SURFACE listener-removal failures instead of discarding them,
// while staying idempotent and never rejecting; a listener the Viewer refused to remove relays to nobody.
test('dispose surfaces removeEventListener failures (never rejects, idempotent); a stuck listener is inert', async () => {
  const { h, bridge } = setup();
  const got = [];
  bridge.onModelLeft((e) => got.push(e));
  assert.deepEqual(bridge.inspectDisposal(), { disposed: false, releaseNotes: [], listenerErrors: [] });
  const boom = new Error('remove refused');
  const realRemove = h.viewer.removeEventListener;
  h.viewer.removeEventListener = (name, fn) => { if (name === EVENTS.MODEL_REMOVED) throw boom; realRemove(name, fn); };
  assert.equal(await bridge.dispose(), undefined);
  assert.equal(await bridge.dispose(), undefined);
  const d = bridge.inspectDisposal();
  assert.equal(d.disposed, true);
  assert.deepEqual(d.releaseNotes, []);
  assert.deepEqual(d.listenerErrors, [boom], 'exactly the one failed removal, reported once');
  assert.equal(h.viewer.listenerCount(EVENTS.BEFORE_MODEL_UNLOAD), 0);
  assert.equal(h.viewer.listenerCount(EVENTS.MODEL_REMOVED), 1, 'the refused listener is still attached …');
  h.viewer.dispatch(EVENTS.MODEL_REMOVED, { model: h.models[0] });
  assert.deepEqual(got, [], '… but relays to nobody');
});

test('dispose surfaces the release notes of its cleanup (a failed isolation restore is not dropped)', async () => {
  const { h, bridge } = setup();
  await bridge.present({ sides: [{ model: h.models[0], dbId: 1 }], options: { focus: false, isolate: true, marker: false } });
  h.viewer.failNext('setAggregateIsolation', { times: 2 });          // restore call + its one retry both throw
  assert.equal(await bridge.dispose(), undefined);
  assert.deepEqual([...bridge.inspectDisposal().releaseNotes], [ISOLATION_NOTE.RESTORE_FAILED]);
});
