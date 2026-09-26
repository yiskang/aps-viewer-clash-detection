// test/clashpanel/viewer/ViewerBridge.queue.test.mjs — T22: pure sequencing (queue, tokens, dispose).
// Requests use options all false so these tests stay valid once T25 adds Viewer mutation. Mid-flight
// invalidation is driven from INSIDE a Viewer read via the fake's onCall hook (no production seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerBridge, createSerialQueue, createListenerRegistry } from '../../../clashpanel/viewer/ViewerBridge.js';
import { createBridgeHarness, NAMES, flush } from '../support/viewerFaults.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';
import { createFakeViewer } from '../support/fakeViewer.mjs';

const MUTATORS = new Set(['addScene', 'addMesh', 'removeMesh', 'removeScene', 'setAggregateIsolation', 'fitToView']);
const OFF = { focus: false, isolate: false, marker: false };

function setup() {
  const h = createBridgeHarness();
  const { THREE } = createFakeThree();
  const bridge = createViewerBridge({ viewerApi: h.api, THREE, names: NAMES });
  const req = { sides: [{ model: h.models[0], dbId: 1 }], options: OFF };
  return { h, bridge, req };
}

test('serial queue runs tasks one at a time, in call order', async () => {
  const q = createSerialQueue();
  const order = [];
  let running = 0; let maxRunning = 0;
  const task = (name) => async () => {
    running += 1; maxRunning = Math.max(maxRunning, running);
    order.push(`start ${name}`); await flush(3); order.push(`end ${name}`);
    running -= 1; return name;
  };
  const results = await Promise.all([q.run(task('a')), q.run(task('b')), q.run(task('c'))]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.equal(maxRunning, 1);
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a rejected task is returned to its caller and never wedges the queue', async () => {
  const q = createSerialQueue();
  const failing = q.run(async () => { throw new Error('boom'); });
  const next = q.run(async () => 'still runs');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'still runs');
  assert.equal(q.size(), 0);
});

test('a later present invalidates earlier tokens immediately, even before the queue reaches them', async () => {
  const { h, bridge, req } = setup();
  let p2; let p3;
  // Arrives synchronously INSIDE p1's step-1 read, i.e. while p1 is in flight.
  h.viewer.onCall('getAllModels', () => { p2 = bridge.present(req); p3 = bridge.present(req); });
  const o1 = await bridge.present(req);
  const [o2, o3] = await Promise.all([p2, p3]);
  assert.equal(o1.superseded, true, 'in-flight token stopped at its next check');
  assert.equal(o2.superseded, true, 'queued token was already stale when the queue reached it');
  assert.equal(o3.superseded, false);
  assert.equal(h.callsOf('getAllModels').length, 2, 'p2 never started (only p1 and p3 read)');
});

test('clear() invalidates the in-flight present and resolves only after the queue drains (AC-P16 completion point)', async () => {
  const { h, bridge, req } = setup();
  const settled = [];
  let c;
  h.viewer.onCall('getAllModels', () => {
    c = bridge.clear().then((o) => { settled.push('clear'); return o; });
  }, { phase: 'before' });
  const po = await bridge.present(req).then((o) => { settled.push('present'); return o; });
  const co = await c;
  assert.equal(po.superseded, true, 'invalidated mid-flight by the clear');
  assert.deepEqual(settled, ['present', 'clear'], 'clear queued behind the in-flight step');
  assert.deepEqual(co, { isolation: 'none', markersRemoved: 0, notes: [] });
  const later = await bridge.present(req);
  assert.equal(later.superseded, false, 'a present after the clear is live again');
});

test('dispose() is idempotent, awaited, and every later call is a non-mutating disposed no-op', async () => {
  const { h, bridge, req } = setup();
  await bridge.present(req);
  const d1 = bridge.dispose();
  const d2 = bridge.dispose();
  assert.equal(d1, d2, 'same promise');
  assert.equal(await d1, undefined);
  h.log.length = 0;
  const po = await bridge.present(req);
  assert.equal(po.disposed, true);
  assert.equal(po.superseded, true);
  const co = await bridge.clear();
  assert.equal(co.disposed, true);
  assert.equal(co.isolation, 'none');
  assert.equal(await bridge.dispose(), undefined);
  assert.deepEqual(h.log.filter((e) => MUTATORS.has(e.method)), [], 'no Viewer mutation after dispose');
  h.assertNoTheming();
});

test('a throwing Viewer call inside present resolves (never rejects) and does not wedge later presents', async () => {
  const { h, bridge, req } = setup();
  h.viewer.onCall('getAllModels', () => { throw new Error('scene read failed'); }, { phase: 'before' });
  const o1 = await bridge.present(req);
  assert.equal(o1.superseded, false);
  assert.equal(o1.fitted || o1.isolated || o1.marked, false);
  assert.ok(o1.notes.includes("An element's model is no longer in the scene"), 'unreadable scene ⇒ side treated as not live');
  const o2 = await bridge.present(req);
  assert.equal(o2.superseded, false);
  assert.deepEqual([...o2.notes], []);
});

test('malformed requests reject with TypeError and do not disturb the queue', async () => {
  const { h, bridge, req } = setup();
  await assert.rejects(bridge.present({ sides: [] , options: OFF }), TypeError);
  await assert.rejects(bridge.present({ sides: [{ model: h.models[0], dbId: -1 }], options: OFF }), TypeError);
  await assert.rejects(bridge.present({ sides: [{ model: h.models[0], dbId: 1 }], options: { focus: 'yes', isolate: false, marker: false } }), TypeError);
  assert.equal((await bridge.present(req)).superseded, false);
});

test('listener registry removes exactly what it added (symmetric), idempotently', () => {
  const h = createBridgeHarness();
  const reg = createListenerRegistry(h.api);
  const f1 = () => {}; const f2 = () => {};
  reg.add('a', f1); reg.add('b', f2);
  assert.equal(h.viewer.listenerCount('a'), 1);
  assert.equal(h.viewer.listenerCount('b'), 1);
  assert.deepEqual(reg.removeAll(), []);
  assert.deepEqual(reg.removeAll(), []);
  assert.equal(h.viewer.listenerCount('a'), 0);
  assert.equal(h.viewer.listenerCount('b'), 0);
  assert.equal(reg.count(), 0);
});

test('createViewerBridge validates its injected ports', () => {
  const h = createBridgeHarness();
  const { THREE } = createFakeThree();
  assert.throws(() => createViewerBridge({ THREE, names: NAMES }), TypeError);
  assert.throws(() => createViewerBridge({ viewerApi: h.api, names: NAMES }), TypeError);
  assert.throws(() => createViewerBridge({ viewerApi: h.api, THREE, names: {} }), TypeError);
});

// ---- T22 additions to the T3 fakeViewer: callLog + onCall re-entrancy hooks (tests of the double itself) ----

test('fakeViewer.onCall: phase "before" runs before the state change, "after" runs after it; nth selects the call', () => {
  const m = { id: 1 };
  const v = createFakeViewer({ models: [m] });
  const seen = [];
  v.onCall('setAggregateIsolation', () => seen.push(['before', v.isolationState().length]), { phase: 'before' });
  v.onCall('setAggregateIsolation', () => seen.push(['after', v.isolationState().length]));
  v.onCall('getAllModels', () => seen.push(['2nd read']), { nth: 2 });
  v.setAggregateIsolation([{ model: m, ids: [1] }]);
  v.getAllModels(); v.getAllModels(); v.getAllModels();
  assert.deepEqual(seen, [['before', 0], ['after', 1], ['2nd read']]);
  assert.equal(v.hooksRemaining(), 0, 'one-shot');
  assert.deepEqual(v.callLog.map((e) => e.method), ['setAggregateIsolation', 'getAllModels', 'getAllModels', 'getAllModels']);
});

test('fakeViewer.onCall with an injected afterEffect failure: state changed, hook ran, then the caller sees the throw', () => {
  const m = { id: 1 };
  const v = createFakeViewer({ models: [m] });
  let during = null;
  v.failNext('setAggregateIsolation', { afterEffect: true });
  v.onCall('setAggregateIsolation', () => { during = v.isolationState(); });
  assert.throws(() => v.setAggregateIsolation([{ model: m, ids: [4] }]), /injected setAggregateIsolation failure/);
  assert.deepEqual(during, [{ model: m, ids: [4] }]);
  v.onCall('addMesh', () => { throw new Error('re-entrant'); }, { phase: 'before' });
  v.overlays.addScene('s');
  assert.throws(() => v.overlays.addMesh({}, 's'), /re-entrant/);
  assert.deepEqual(v.overlayMeshes('s'), [], 'a throwing before-hook prevents the call');
  assert.equal(v.isolationState().length, 1, 'isolationState is a raw read (not logged)');
  assert.equal(v.callLog.filter((e) => e.method === 'getAggregateIsolation').length, 0);
});
