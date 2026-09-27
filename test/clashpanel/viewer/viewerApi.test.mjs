// test/clashpanel/viewer/viewerApi.test.mjs — T26 facade over the T3 Viewer3D-shaped fake (Tier B; the mappings
// are source-observed only; runtime/SVF2 behaviour — including world-space bounds — is gate G2 / PG-1 / F7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createViewerApi } from '../../../clashpanel/viewer/viewerApi.js';
import { createFakeViewer, createFakeModel, FAKE_EVENTS } from '../support/fakeViewer.mjs';

const EVENTS = { BEFORE_MODEL_UNLOAD: FAKE_EVENTS.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: FAKE_EVENTS.MODEL_REMOVED };
const MEMBERS = ['eventNames', 'getAllModels', 'getAggregateIsolation', 'getAggregateHiddenNodes', 'setAggregateIsolation',
  'fitToView', 'hasAggregateFit', 'fitToViewAggregate', 'getAggregateSelection', 'overlays', 'getElementWorldBounds',
  'addEventListener', 'removeEventListener'];

test('shape: exactly the ViewerApi members, frozen; ports validated', () => {
  const viewer = createFakeViewer();
  const api = createViewerApi(viewer, { events: EVENTS });
  assert.deepEqual(Object.keys(api).sort(), [...MEMBERS].sort());
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.overlays) && Object.isFrozen(api.eventNames));
  assert.deepEqual(api.eventNames, EVENTS);
  assert.throws(() => createViewerApi(viewer, {}), TypeError);
  assert.throws(() => createViewerApi({}, { events: EVENTS }), TypeError);
});

test('each member maps to the Viewer3D method with the same arguments (mesh-first overlays)', () => {
  const m = createFakeModel({ id: 1 });
  const viewer = createFakeViewer({ models: [m], isolation: [{ model: m, ids: [1] }] });
  const api = createViewerApi(viewer, { events: EVENTS });
  const mesh = {}; const fn = () => {};
  assert.deepEqual(api.getAllModels(), [m]);
  assert.deepEqual(api.getAggregateIsolation(), [{ model: m, ids: [1] }]);
  assert.deepEqual(api.getAggregateHiddenNodes(), []);
  api.setAggregateIsolation([{ model: m, ids: [2] }]);
  api.fitToView([2], m, true);
  api.overlays.addScene('s'); api.overlays.hasScene('s'); api.overlays.addMesh(mesh, 's'); api.overlays.removeMesh(mesh, 's'); api.overlays.removeScene('s');
  api.addEventListener('e', fn); api.removeEventListener('e', fn);
  assert.deepEqual(viewer.callLog.map((c) => [c.method, ...c.args]), [
    ['getAllModels'], ['getAggregateIsolation'], ['getAggregateHiddenNodes'],
    ['setAggregateIsolation', [{ model: m, ids: [2] }]], ['fitToView', [2], m, true],
    ['addScene', 's'], ['hasScene', 's'], ['addMesh', mesh, 's'], ['removeMesh', mesh, 's'], ['removeScene', 's'],
  ]);
  assert.deepEqual(viewer.listenerLog, [{ op: 'add', name: 'e' }, { op: 'remove', name: 'e' }]);
  assert.equal(viewer.listenerCount('e'), 0);
});

test('aggregate fit: fitToView(list keyed `selection`, undefined model slot, immediate); `ids` would throw', () => {
  const a = createFakeModel({ id: 1 }); const b = createFakeModel({ id: 2 });
  const viewer = createFakeViewer({ models: [a, b] });
  const api = createViewerApi(viewer, { events: EVENTS });
  assert.equal(api.hasAggregateFit(), true);
  api.fitToViewAggregate([{ model: a, selection: [1] }, { model: b, selection: [2] }], false);
  assert.deepEqual(viewer.calls.fitToView.at(-1), { form: 'aggregate', args: [[{ model: a, selection: [1] }, { model: b, selection: [2] }], undefined, false] });
  assert.throws(() => viewer.fitToView([{ model: a, ids: [1] }]), TypeError, 'the real key-shape hazard the facade avoids');
  const noAgg = createFakeViewer();
  noAgg.getAggregateSelection = undefined;
  assert.equal(createViewerApi(noAgg, { events: EVENTS }).hasAggregateFit(), false);
});

test('getAggregateSelection normalises `selection` / `selectionSet` to `selection`, drops malformed entries', () => {
  const a = createFakeModel({ id: 1 }); const b = createFakeModel({ id: 2 });
  const viewer = createFakeViewer({ selection: [{ model: a, selection: [3, 1] }] });
  const api = createViewerApi(viewer, { events: EVENTS });
  assert.deepEqual(api.getAggregateSelection(), [{ model: a, selection: [3, 1] }]);
  viewer.getAggregateSelection = () => [{ model: a, selection: [3, 1] }, { model: b, selectionSet: [5] }, { model: null, selection: [1] }, { model: a }, null];
  assert.deepEqual(api.getAggregateSelection(), [{ model: a, selection: [3, 1] }, { model: b, selection: [5] }]);
  viewer.getAggregateSelection = () => 'nope';
  assert.deepEqual(api.getAggregateSelection(), []);
});

test('getElementWorldBounds: object tree, instance-tree fallback, unknown dbId / no tree / throw ⇒ null (world space UNVERIFIED)', () => {
  const box = [0, 1, 2, 3, 4, 5];
  const api = createViewerApi(createFakeViewer(), { events: EVENTS });
  const viaObject = createFakeModel({ id: 1, boxes: { 7: box } });
  assert.deepEqual(api.getElementWorldBounds(viaObject, 7), box);
  assert.ok(Array.isArray(api.getElementWorldBounds(viaObject, 7)), 'a plain array copy, not the Float32Array');
  assert.equal(viaObject.deprecatedInstanceTreeCalls, 0, 'the object tree is preferred');
  const viaInstance = createFakeModel({ id: 2, boxes: { 7: box } });
  viaInstance.getObjectTree = () => null;
  assert.deepEqual(api.getElementWorldBounds(viaInstance, 7), box);
  assert.equal(viaInstance.deprecatedInstanceTreeCalls, 1);
  assert.equal(api.getElementWorldBounds(viaObject, 8), null, 'unfilled buffer is not a zero box');
  assert.equal(api.getElementWorldBounds(createFakeModel({ id: 3, hasObjectTree: false }), 7), null);
  assert.equal(api.getElementWorldBounds({ getObjectTree: () => { throw new Error('gone'); } }, 7), null);
  assert.equal(api.getElementWorldBounds(createFakeModel({ id: 4, boxes: { 7: [3, 0, 0, 1, 1, 1] } }), 7), null, 'inverted box');
});

test('no facade call touches any theming or forbidden Viewer member', () => {
  const m = createFakeModel({ id: 1, boxes: { 1: [0, 0, 0, 1, 1, 1] } });
  const viewer = createFakeViewer({ models: [m], selection: [{ model: m, selection: [1] }] });
  viewer.seedForeignTheming([{ dbId: 1, color: 'blue' }]);
  const api = createViewerApi(viewer, { events: EVENTS });
  api.getAllModels(); api.getAggregateIsolation(); api.getAggregateHiddenNodes(); api.setAggregateIsolation([]);
  api.fitToView([1], m); api.hasAggregateFit(); api.fitToViewAggregate([{ model: m, selection: [1] }]);
  api.getAggregateSelection(); api.getElementWorldBounds(m, 1);
  assert.deepEqual(viewer.themingCalls, []);
  assert.deepEqual(viewer.forbiddenCalls, []);
  assert.deepEqual(viewer.themingState(), [{ dbId: 1, color: 'blue' }]);
});

test('viewerApi.js is the only clashpanel/viewer module that calls Viewer3D methods by name', async () => {
  const dir = new URL('../../../clashpanel/viewer/', import.meta.url);
  const viewerCall = /\bviewer\.(getAllModels|getAggregate\w*|setAggregateIsolation|fitToView|overlays|addEventListener|removeEventListener)\b/;
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.js') || f === 'viewerApi.js') continue;
    const src = await readFile(new URL(f, dir), 'utf8');
    assert.equal(viewerCall.test(src), false, `${f} must go through the injected ViewerApi`);
  }
});
