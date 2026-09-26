// test/clashpanel/viewer/ViewerBridge.transaction.test.mjs — T25 targeted transaction tests
// (Tier B; fakes only — live Viewer behaviour is gate G2 / PG-1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerBridge, BRIDGE_NOTE } from '../../../clashpanel/viewer/ViewerBridge.js';
import { targetFor, ISOLATION_REASON, ISOLATION_NOTE } from '../../../clashpanel/viewer/isolation.js';
import { createBridgeHarness, NAMES, sameIsolation } from '../support/viewerFaults.mjs';
import { createFakeModel } from '../support/fakeViewer.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

const ON = { focus: true, isolate: true, marker: true };
const MUTATORS = new Set(['addScene', 'addMesh', 'removeMesh', 'removeScene', 'setAggregateIsolation', 'fitToView']);

function setup({ prior = [], bounds = true } = {}) {
  const m1 = createFakeModel({ id: 1, boxes: bounds ? { 1: [0, 0, 0, 1, 1, 1], 3: [5, 0, 0, 6, 1, 1] } : {} });
  const m2 = createFakeModel({ id: 2, boxes: bounds ? { 2: [2, 0, 0, 3, 1, 1], 4: [7, 0, 0, 8, 1, 1] } : {} });
  const m3 = createFakeModel({ id: 3 });
  const h = createBridgeHarness({ models: [m1, m2, m3], isolation: typeof prior === 'function' ? prior(m3) : prior });
  const { THREE, stats } = createFakeThree();
  const bridge = createViewerBridge({ viewerApi: h.api, THREE, names: NAMES });
  const A = { sides: [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], point: [0.5, 0.5, 0.5], options: ON };
  const B = { sides: [{ model: m1, dbId: 3 }, { model: m2, dbId: 4 }], point: [5.5, 0.5, 0.5], options: ON };
  return { h, stats, bridge, A, B, m1, m2, m3 };
}

test('happy path: markers, one isolation reconcile, aggregate fit; ledger holds exactly this token\'s resources', async () => {
  const { h, bridge, A } = setup();
  const o = await bridge.present(A);
  assert.deepEqual({ superseded: o.superseded, fitted: o.fitted, isolated: o.isolated, marked: o.marked }, { superseded: false, fitted: true, isolated: true, marked: true });
  assert.equal(o.notes.includes(BRIDGE_NOTE.FAILED), false);
  assert.equal(h.panelMeshes().length, 3);
  assert.ok(sameIsolation(h.isolation(), targetFor(A.sides)));
  const ledger = bridge.inspectLedger();
  assert.equal(ledger.markerMeshes.length, 3);
  assert.deepEqual(new Set(ledger.markerMeshes), new Set(h.panelMeshes()));
  assert.equal(ledger.isolation.confirmed, true);
  assert.equal(h.callsOf('setAggregateIsolation').length, 1);
  h.assertNoTheming();
});

test('mutation order: reads → markers → isolation → fit last', async () => {
  const { h, bridge, A, m1, m2 } = setup();
  let boundsReadAtFirstMutation = -1;
  h.viewer.onCall('addScene', () => { boundsReadAtFirstMutation = m1.boundsCalls.length + m2.boundsCalls.length; }, { phase: 'before' });
  await bridge.present(A);
  const order = h.log.map((e) => e.method).filter((m) => MUTATORS.has(m));
  assert.equal(order[0], 'addScene', 'the first mutation is the marker scene');
  assert.equal(boundsReadAtFirstMutation, 2, 'both element bounds were read before any mutation');
  assert.ok(order.lastIndexOf('addMesh') < order.indexOf('setAggregateIsolation'));
  const firstFit = order.indexOf('fitToView');
  assert.ok(order.indexOf('setAggregateIsolation') < firstFit);
  assert.ok(order.slice(firstFit).every((m) => m === 'fitToView'), 'fit is the last step');
});

test('write-ahead: the intent is in the ledger BEFORE each Viewer mutation', async () => {
  const { h, bridge, A } = setup();
  const seen = [];
  h.viewer.onCall('addMesh', (mesh) => {
    seen.push(['mesh recorded', bridge.inspectLedger().markerMeshes.includes(mesh) && !h.panelMeshes().includes(mesh)]);
  }, { phase: 'before' });
  h.viewer.onCall('setAggregateIsolation', () => {
    const rec = bridge.inspectLedger().isolation;
    seen.push(['isolation pending', rec !== null && rec.confirmed === false && sameIsolation(rec.target, targetFor(A.sides))]);
  });
  await bridge.present(A);
  assert.deepEqual(seen, [['mesh recorded', true], ['isolation pending', true]]);
});

test('the token is re-checked before EVERY mutation: invalidated mid-step ⇒ no further add/isolate/fit', async () => {
  // addMesh #1: invalidated between the Soft spheres; addMesh #3 (the line): right before the outline
  // scene would be created; getAggregateHiddenNodes: a read inside the isolation step, right before
  // setAggregateIsolation would run.
  for (const [during, nth] of [['addMesh', 1], ['addMesh', 3], ['getAggregateHiddenNodes', 1]]) {
    const { h, bridge, A } = setup();
    const req = { ...A, point: undefined, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } };
    let cleared;
    let at = -1;
    h.viewer.onCall(during, () => { cleared = bridge.clear(); at = h.log.length; }, { nth });
    const o = await bridge.present(req);
    await cleared;
    assert.equal(o.superseded, true, during);
    const after = h.log.slice(at).map((e) => e.method).filter((m) => MUTATORS.has(m));
    assert.ok(after.every((m) => m === 'removeMesh'), `${during}: only cleanup after invalidation, got ${after}`);
    assert.deepEqual(h.panelMeshes(), []);
    assert.deepEqual(h.isolation(), []);
  }
});

test('a newer successful present releases the previous ledger first; isolation is replaced with prior kept', async () => {
  const { h, bridge, A, B, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await bridge.present(A);
  const oldMeshes = h.panelMeshes();
  h.log.length = 0;
  await bridge.present(B);
  const order = h.log.map((e) => e.method).filter((m) => MUTATORS.has(m));
  assert.deepEqual(order.slice(0, 3), ['removeMesh', 'removeMesh', 'removeMesh'], 'old meshes removed before any new add');
  assert.ok(h.callsOf('removeMesh').every((e) => oldMeshes.includes(e.args[0])));
  assert.equal(h.callsOf('setAggregateIsolation').length, 1, 'one reconcile, no intermediate restore');
  assert.ok(h.panelMeshes().every((m) => !oldMeshes.includes(m)), 'only B\'s meshes remain');
  assert.deepEqual((await bridge.clear()).isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }], 'the ORIGINAL prior, not A\'s target');
});

test('a present without Isolate after an isolated one restores the prior (guarded) before drawing', async () => {
  const { h, bridge, A, B } = setup();
  await bridge.present(A);
  const o = await bridge.present({ ...B, options: { focus: false, isolate: false, marker: true } });
  assert.equal(o.isolated, false);
  assert.deepEqual(h.isolation(), []);
  assert.equal(bridge.inspectLedger().isolation, null);
  assert.equal((await bridge.clear()).isolation, 'none');
});

test('a stale completion never clears a newer token\'s resources', async () => {
  const { h, bridge, A, B } = setup();
  let pb;
  let drawnByA = [];
  // B arrives while A is inside its isolation step (reading the pre-image), after A drew its markers.
  h.viewer.onCall('getAggregateIsolation', () => { drawnByA = h.panelMeshes(); pb = bridge.present(B); }, { phase: 'before' });
  const oa = await bridge.present(A);
  const ob = await pb;
  assert.equal(drawnByA.length, 3, 'A had drawn its markers when it was superseded');
  assert.equal(oa.superseded, true);
  assert.equal(ob.superseded, false);
  assert.equal(h.panelMeshes().length, 3);
  assert.ok(h.panelMeshes().every((m) => !drawnByA.includes(m)), 'only B\'s meshes remain');
  assert.ok(sameIsolation(h.isolation(), targetFor(B.sides)));
});

test('removeMesh failures during cleanup are retried; a double failure is noted and dispose removes it later', async () => {
  for (const mode of ['before', 'after']) {
    const { h, bridge, A } = setup();
    await bridge.present(A);
    h.failAt('removeMesh', mode);
    const c = await bridge.clear();
    assert.equal(c.markersRemoved, 3);
    assert.deepEqual(h.panelMeshes(), [], `retry after a throw ${mode}`);
  }
  const { h, bridge, A } = setup();
  await bridge.present(A);
  h.failAt('removeMesh', 'before');
  h.failAt('removeMesh', 'before');
  const c = await bridge.clear();
  assert.equal(c.markersRemoved, 2);
  assert.deepEqual(c.notes, [BRIDGE_NOTE.REMOVE_FAILED]);
  assert.equal(h.panelMeshes().length, 1);
  await bridge.dispose();
  assert.deepEqual(h.panelMeshes(), []);
});

test('clear reports isolation "failed" (with a note) when the restore keeps throwing or the state is unreadable', async () => {
  const s1 = setup();
  await s1.bridge.present(s1.A);
  s1.h.failAt('setAggregateIsolation', 'before');
  s1.h.failAt('setAggregateIsolation', 'before');
  const c1 = await s1.bridge.clear();
  assert.deepEqual({ isolation: c1.isolation, markersRemoved: c1.markersRemoved, notes: c1.notes }, { isolation: 'failed', markersRemoved: 3, notes: [ISOLATION_NOTE.RESTORE_FAILED] });
  assert.deepEqual(s1.h.panelMeshes(), [], 'markers are still removed');
  const s2 = setup();
  await s2.bridge.present(s2.A);
  s2.h.failAt('getAggregateIsolation', 'before');
  const c2 = await s2.bridge.clear();
  assert.equal(c2.isolation, 'failed');
  assert.deepEqual(c2.notes, [ISOLATION_NOTE.UNREADABLE_AT_RESTORE]);
  assert.equal(s2.h.callsOf('setAggregateIsolation').length, 1, 'no blind restore when unreadable');
});

test('no location ⇒ note "no location"; outlines still mark; no bounds and no point ⇒ marked:false, fit and isolate still apply', async () => {
  const s1 = setup();
  const o1 = await s1.bridge.present({ ...s1.A, point: undefined });
  assert.equal(o1.marked, true);
  assert.ok(o1.notes.includes(BRIDGE_NOTE.NO_LOCATION));
  assert.equal(o1.notes.includes(BRIDGE_NOTE.NO_BOUNDS), false);
  const s2 = setup({ bounds: false });
  const o2 = await s2.bridge.present({ ...s2.A, point: undefined });
  assert.deepEqual({ fitted: o2.fitted, isolated: o2.isolated, marked: o2.marked }, { fitted: true, isolated: true, marked: false });
  assert.deepEqual(o2.notes.slice(0, 2), [BRIDGE_NOTE.NO_LOCATION, BRIDGE_NOTE.NO_BOUNDS]);
  assert.deepEqual(s2.h.panelMeshes(), []);
});

test('a side whose model left the scene is skipped (note); isolation only reconciles live models', async () => {
  const { h, bridge, A, m1, m2 } = setup();
  h.viewer.removeModel(m2);
  const o = await bridge.present(A);
  assert.ok(o.notes.includes(BRIDGE_NOTE.NOT_IN_SCENE));
  assert.deepEqual(h.callsOf('setAggregateIsolation').map((e) => e.args[0]), [[{ model: m1, ids: [1] }]]);
  assert.ok(h.callsOf('fitToView').every((e) => e.args[1] !== m2));
});

test('unreadable isolation at present ⇒ Isolate reported unavailable, no setAggregateIsolation, markers kept', async () => {
  const { h, bridge, A } = setup();
  h.failAt('getAggregateIsolation', 'before');
  const o = await bridge.present(A);
  assert.equal(o.isolated, false);
  assert.equal(o.marked, true);
  assert.ok(o.notes.includes(ISOLATION_REASON.UNREADABLE));
  assert.deepEqual(h.callsOf('setAggregateIsolation'), []);
});

test('AC-P6: after every awaited restore-table trigger no Panel mesh remains and isolation is restored or skipped', async () => {
  const { h, bridge, A, B, m1, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  const prior = [{ model: m3, ids: [9] }];
  await bridge.present(A);
  await bridge.present(B);                                  // change selected clash
  assert.equal(h.panelMeshes().length, 3);
  assert.equal((await bridge.clear()).isolation, 'restored'); // Back to All / new run / hide panel
  assert.deepEqual(h.panelMeshes(), []); assert.deepEqual(h.isolation(), prior);
  await bridge.present(A);
  h.viewer.dispatch(h.api.eventNames.BEFORE_MODEL_UNLOAD, { model: m1 });   // controller reacts with clear()
  await bridge.clear();
  assert.deepEqual(h.panelMeshes(), []); assert.deepEqual(h.isolation(), prior);
  await bridge.present(A);
  h.viewer.setIsolationState([{ model: m3, ids: [1] }]);
  assert.equal((await bridge.clear()).isolation, 'skipped-external');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [1] }]);
  await bridge.present(B);
  await bridge.dispose();                                    // extension unload / dispose
  assert.deepEqual(h.panelMeshes(), []);
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [1] }]);
  assert.equal(h.hasScene(NAMES.overlayMarkers), false);
  h.assertNoTheming();
});

test('F2: a failed isolation restore KEEPS the pre-image — a later clear() (or dispose()) restores the user\'s isolation', async () => {
  for (const finish of ['clear', 'dispose']) {
    const { h, bridge, A, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
    await bridge.present(A);
    h.failAt('setAggregateIsolation', 'before');
    h.failAt('setAggregateIsolation', 'before');
    const first = await bridge.clear();
    assert.equal(first.isolation, 'failed');
    assert.deepEqual(h.panelMeshes(), [], 'markers are still removed');
    if (finish === 'clear') assert.equal((await bridge.clear()).isolation, 'restored');
    else await bridge.dispose();
    assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }], `${finish} restored the original isolation`);
  }
});

test('F3: a mesh whose exact removal failed twice stays in the ledger and is retried by the next present and clear', async () => {
  const { h, bridge, A, B } = setup();
  await bridge.present(A);
  h.failAt('removeMesh', 'before');
  h.failAt('removeMesh', 'before');                                   // both attempts on the SAME mesh
  const c1 = await bridge.clear();
  assert.deepEqual(c1.notes, [BRIDGE_NOTE.REMOVE_FAILED]);
  const [orphan] = h.panelMeshes();
  assert.equal(h.panelMeshes().length, 1);
  assert.deepEqual(bridge.inspectLedger().markerMeshes, [orphan], 'held stays non-null until every resource is gone');
  h.log.length = 0;
  await bridge.present(B);
  assert.equal(h.callsOf('removeMesh')[0].args[0], orphan, 'the replacement present retries the orphan first');
  assert.equal(h.panelMeshes().length, 3);
  assert.equal(h.panelMeshes().includes(orphan), false);
  await bridge.clear();
  assert.deepEqual(h.panelMeshes(), []);
  assert.equal(bridge.inspectLedger(), null);
});

test('F5: default overlay scene names are instance-scoped — two bridges on ONE viewer never touch each other', async () => {
  const h = createBridgeHarness();
  const [m1, m2] = h.models;
  const b1 = createViewerBridge({ viewerApi: h.api, THREE: createFakeThree().THREE });
  const b2 = createViewerBridge({ viewerApi: h.api, THREE: createFakeThree().THREE });
  const opts = { focus: false, isolate: false, marker: true };
  await b1.present({ sides: [{ model: m1, dbId: 1 }], point: [0, 0, 0], options: opts });
  await b2.present({ sides: [{ model: m2, dbId: 2 }], point: [1, 1, 1], options: opts });
  const scenes = h.viewer.overlayScenes();
  assert.equal(scenes.length, 2, 'one marker scene per bridge');
  assert.notEqual(scenes[0], scenes[1]);
  const b2Mesh = h.viewer.overlayMeshes(scenes[1]);
  await b1.clear();
  assert.deepEqual(h.viewer.overlayMeshes(scenes[0]), []);
  assert.deepEqual(h.viewer.overlayMeshes(scenes[1]), b2Mesh, 'the other bridge\'s marker survives clear()');
  await b1.dispose();
  assert.deepEqual(h.viewer.overlayScenes(), [scenes[1]], 'only the disposed bridge\'s scene is removed');
  assert.deepEqual(h.viewer.overlayMeshes(scenes[1]), b2Mesh);
  await b2.dispose();
  assert.deepEqual(h.viewer.overlayScenes(), []);
});

test('F6: an addScene that throws after creating the scene leaks nothing; a mesh that cannot be removed keeps its scene', async () => {
  const s1 = setup();
  s1.h.failAt('addScene', 'after');
  const o = await s1.bridge.present(s1.A);
  assert.ok(o.notes.includes(BRIDGE_NOTE.FAILED));
  await s1.bridge.dispose();
  assert.equal(s1.h.hasScene(NAMES.overlayMarkers), false, 'write-ahead scene record ⇒ removed at dispose');
  const s2 = setup();
  await s2.bridge.present({ ...s2.A, point: undefined, options: { focus: false, isolate: false, marker: true } });
  const [kept] = s2.h.viewer.overlayMeshes(NAMES.overlayOutlines);
  // removeMesh calls: #1,#2 = clear on outline 1 (+ retry) fail; #3 = outline 2 succeeds; #4,#5 = dispose's
  // ledger retry of outline 1 (+ retry) fail; #6 = dispose's leftover sweep fails. (FIFO hooks: the nth:2 one
  // becomes head after #2, counts #3 and fires on #4.)
  s2.h.failAt('removeMesh', 'before');
  s2.h.failAt('removeMesh', 'before');
  s2.h.failAt('removeMesh', 'before', 2);
  s2.h.failAt('removeMesh', 'before');
  s2.h.failAt('removeMesh', 'before');
  assert.deepEqual((await s2.bridge.clear()).notes, [BRIDGE_NOTE.REMOVE_FAILED]);
  await s2.bridge.dispose();
  assert.equal(s2.h.pendingFaults(), 0);
  assert.equal(s2.h.hasScene(NAMES.overlayOutlines), true, 'never removeScene under an unremoved Panel mesh');
  assert.deepEqual(s2.h.viewer.overlayMeshes(NAMES.overlayOutlines), [kept]);
});

test('F4: a foreign isolation change made inside the getAggregateHiddenNodes() read becomes the pre-image and is never clobbered', async () => {
  const { h, bridge, A, m3 } = setup();
  const F = [{ model: m3, ids: [5] }];
  h.viewer.onCall('getAggregateHiddenNodes', () => h.viewer.setIsolationState(F));
  const o = await bridge.present(A);
  assert.equal(o.isolated, true);
  assert.deepEqual(bridge.inspectLedger().isolation.preImage, F);
  assert.equal((await bridge.clear()).isolation, 'restored');
  assert.deepEqual(h.isolation(), F, 'the foreign state is what the Panel restores to');
});

// ---- Carry-forward additions (T18 AC-P16, T22, T24): extra pins; the brief tests above are unchanged. ----

import { createIsolationSession } from '../../../clashpanel/viewer/isolation.js';

// Every Viewer call a present makes (in order) as [method, nth-of-that-method] — used to inject an
// invalidation at EACH call point of an otherwise identical run.
async function callPoints(run) {
  const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await run.before(s);
  const from = s.h.log.length;
  await s.bridge.present(run.req(s));
  const seen = new Map();
  return s.h.log.slice(from).map((e) => { const n = (seen.get(e.method) ?? 0) + 1; seen.set(e.method, n); return [e.method, n]; });
}

const RUNS = {
  'from empty': { before: async () => {}, req: (s) => s.A },
  'replacing a prior presentation': { before: async (s) => { await s.bridge.present(s.B); }, req: (s) => s.A },
  'soft (closest points), replacing': {
    before: async (s) => { await s.bridge.present(s.B); },
    req: (s) => ({ ...s.A, point: undefined, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } }),
  },
};
const LATE_MUTATORS = new Set(['addScene', 'addMesh', 'fitToView']);

test('AC-P16 resource survival: a clear() issued at ANY Viewer call of an in-flight present leaves none of its resources', async () => {
  let cases = 0;
  for (const [label, run] of Object.entries(RUNS)) {
    const points = await callPoints(run);
    assert.ok(points.length > 10, `${label}: the sweep covers the whole present`);
    for (const [method, nth] of points) {
      for (const phase of ['before', 'after']) {
        const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
        const prior = [{ model: s.m3, ids: [9] }];
        await run.before(s);
        let cleared;
        let at = -1;
        s.h.viewer.onCall(method, () => { cleared = s.bridge.clear(); at = s.h.log.length; }, { nth, phase });
        const o = await s.bridge.present(run.req(s));
        const c = await cleared;
        const where = `${label} · ${method}#${nth} ${phase}`;
        assert.ok(at >= 0, `${where}: hook fired`);
        assert.equal(o.superseded, true, `${where}: the in-flight present is superseded`);
        assert.equal(o.fitted, false, where);
        const late = s.h.log.slice(at).map((e) => e.method).filter((m) => LATE_MUTATORS.has(m));
        assert.deepEqual(late, [], `${where}: no add/fit after the invalidation`);
        assert.deepEqual(s.h.panelMeshes(), [], `${where}: no Panel mesh survives`);
        assert.ok(sameIsolation(s.h.isolation(), prior), `${where}: isolation back to the prior`);
        assert.equal(s.bridge.inspectLedger(), null, `${where}: ledger empty`);
        assert.ok(['restored', 'none'].includes(c.isolation), `${where}: clear outcome ${c.isolation}`);
        s.h.assertNoTheming();
        cases += 1;
      }
    }
  }
  assert.ok(cases > 60);
});

test('dispose() during an in-flight present (at ANY Viewer call) invalidates its token and leaves nothing Panel-owned', async () => {
  for (const [label, run] of Object.entries(RUNS)) {
    const points = await callPoints(run);
    for (const [method, nth] of points) {
      for (const phase of ['before', 'after']) {
        const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
        const prior = [{ model: s.m3, ids: [9] }];
        await run.before(s);
        let disposing;
        let at = -1;
        s.h.viewer.onCall(method, () => { disposing = s.bridge.dispose(); at = s.h.log.length; }, { nth, phase });
        const o = await s.bridge.present(run.req(s));
        assert.equal(await disposing, undefined);
        const where = `${label} · ${method}#${nth} ${phase}`;
        assert.equal(o.superseded, true, `${where}: mid-flight token invalidated by dispose`);
        assert.equal(o.fitted, false, where);
        const late = s.h.log.slice(at).map((e) => e.method).filter((m) => LATE_MUTATORS.has(m));
        assert.deepEqual(late, [], `${where}: no add/fit after dispose was called`);
        assert.deepEqual(s.h.panelMeshes(), [], where);
        assert.equal(s.h.hasScene(NAMES.overlayMarkers), false, where);
        assert.equal(s.h.hasScene(NAMES.overlayOutlines), false, where);
        assert.ok(sameIsolation(s.h.isolation(), prior), where);
        s.h.log.length = 0;
        const after = await s.bridge.present(s.A);
        assert.equal(after.disposed, true, where);
        assert.deepEqual(s.h.log.map((e) => e.method).filter((m) => MUTATORS.has(m)), [], `${where}: disposed no-op`);
        s.h.assertNoTheming();
      }
    }
  }
});

// A throw from a step with NO local try/catch (the scene-membership test in step 1) reaches present()'s
// outer catch: FAILED note, superseded = !isLive(t), never rejects, and the held ledger is still released.
function poisonedSceneApi(h, onThrow) {
  let armed = false;
  const api = new Proxy(h.api, {
    get(t, prop, r) {
      if (prop !== 'getAllModels') return Reflect.get(t, prop, r);
      return () => {
        const list = t.getAllModels();
        if (!armed) return list;
        armed = false;
        return new Proxy(list, { get(a, p, rr) { if (p === 'includes') return () => { onThrow(); throw new Error('scene list broke'); }; return Reflect.get(a, p, rr); } });
      };
    },
  });
  return { api, arm: () => { armed = true; } };
}

test('present() outer catch fallback: a throw outside the transaction try ⇒ FAILED, superseded:false, held released', async () => {
  const { h, A, B, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  const { THREE } = createFakeThree();
  const p = poisonedSceneApi(h, () => {});
  const bridge = createViewerBridge({ viewerApi: p.api, THREE, names: NAMES });
  assert.equal((await bridge.present(A)).isolated, true);
  p.arm();
  const o = await bridge.present(B);
  assert.deepEqual({ superseded: o.superseded, marked: o.marked, isolated: o.isolated, fitted: o.fitted }, { superseded: false, marked: false, isolated: false, fitted: false });
  assert.equal(o.notes[0], BRIDGE_NOTE.FAILED);
  assert.deepEqual(h.panelMeshes(), [], 'the previous presentation held in the ledger is released by the fallback');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }]);
  assert.equal(bridge.inspectLedger(), null);
  assert.equal((await bridge.present(A)).superseded, false, 'the queue is not wedged');
});

test('present() outer catch fallback: invalidated before the throw ⇒ superseded:true (= !isLive(t)) with FAILED', async () => {
  const { h, A } = setup();
  const { THREE } = createFakeThree();
  let bridge;
  let cleared;
  const p = poisonedSceneApi(h, () => { cleared = bridge.clear(); });
  bridge = createViewerBridge({ viewerApi: p.api, THREE, names: NAMES });
  p.arm();
  const o = await bridge.present(A);
  assert.equal(o.superseded, true);
  assert.deepEqual([...o.notes], [BRIDGE_NOTE.FAILED]);
  assert.equal((await cleared).isolation, 'none');
  assert.deepEqual(h.panelMeshes(), []);
});

// T24 carry-forward extras, pinned against the session the transaction consumes (isolation.js unchanged).
test('T24 extra: a replacement apply that throws before the state change, then restore() ⇒ restored to the ORIGINAL pre-image', () => {
  const { h, m1, m2, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  const session = createIsolationSession(h.api);
  assert.equal(session.apply([{ model: m1, dbId: 1 }]).applied, true);
  h.failAt('setAggregateIsolation', 'before');
  assert.throws(() => session.apply([{ model: m2, dbId: 2 }]), /injected setAggregateIsolation failure/);
  assert.equal(session.owns(), true, 'the pending replacement record is kept');
  assert.deepEqual(session.restore(), { isolation: 'restored', notes: [] });
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }]);
  assert.equal(session.owns(), false);
});

test('T24 extra: restore({beforeMutation}) throwing keeps the record; a later restore() restores', () => {
  const { h, m1, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  const session = createIsolationSession(h.api);
  session.apply([{ model: m1, dbId: 1 }]);
  assert.throws(() => session.restore({ beforeMutation: () => { throw new Error('stale'); } }), /stale/);
  assert.equal(session.owns(), true);
  assert.equal(session.restore().isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }]);
});

test('T24 extra (nuance, pinned as-is): a confirmed record whose state is already back at the pre-image reports skipped-external', () => {
  const { h, m1, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  const session = createIsolationSession(h.api);
  session.apply([{ model: m1, dbId: 1 }]);
  h.viewer.setIsolationState([{ model: m3, ids: [9] }]);
  const before = h.callsOf('setAggregateIsolation').length;
  assert.equal(session.restore().isolation, 'skipped-external');
  assert.equal(h.callsOf('setAggregateIsolation').length, before, 'no mutation');
  assert.equal(session.owns(), false);
});

// ---- Fix round 1 (review finding): a replacement isolation that does NOT apply must not leave the previous
// target on screen under the new markers; a non-isolating replacement reports its restore notes. ----

test('fix: a replacement present whose isolation apply does not apply restores the previous isolation (guarded)', async () => {
  const faults = {
    'getAggregateIsolation unreadable inside apply': (h) => h.failAt('getAggregateIsolation', 'before'),
    // getAllModels #1 = step-1 scene read, #2 = the scene read inside isolation.apply
    'getAllModels throws inside apply': (h) => h.viewer.onCall('getAllModels', () => { throw new Error('scene read failed'); }, { nth: 2, phase: 'before' }),
  };
  for (const [label, arm] of Object.entries(faults)) {
    const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
    const { h, bridge, A, B, m3 } = s;
    assert.equal((await bridge.present(A)).isolated, true, label);
    const aMeshes = h.panelMeshes();
    arm(h);
    const o = await bridge.present(B);
    assert.equal(o.superseded, false, label);
    assert.equal(o.isolated, false, `${label}: the outcome never claims isolation`);
    assert.equal(o.marked, true, label);
    const ledger = bridge.inspectLedger();
    assert.equal(ledger.markerMeshes.length, 3, label);
    assert.deepEqual(new Set(ledger.markerMeshes), new Set(h.panelMeshes()), `${label}: only B's markers are held`);
    assert.ok(h.panelMeshes().every((m) => !aMeshes.includes(m)), label);
    const restored = sameIsolation(h.isolation(), [{ model: m3, ids: [9] }]);
    const failedNoted = o.notes.some((n) => Object.values(ISOLATION_NOTE).includes(n)) && ledger.isolation !== null;
    assert.ok(restored || failedNoted, `${label}: prior restored (got ${JSON.stringify(h.isolation().map((e) => e.ids))}) or failure noted with the record kept`);
    assert.equal(sameIsolation(h.isolation(), targetFor(A.sides)), false, `${label}: A's target is not left under B's markers`);
    h.assertNoTheming();
  }
});

test('fix: a non-isolating replacement reports a failed restore of the previous isolation in its outcome', async () => {
  const cases = {
    'restore keeps throwing': [(h) => { h.failAt('setAggregateIsolation', 'before'); h.failAt('setAggregateIsolation', 'before'); }, ISOLATION_NOTE.RESTORE_FAILED],
    'unreadable at restore': [(h) => h.failAt('getAggregateIsolation', 'before'), ISOLATION_NOTE.UNREADABLE_AT_RESTORE],
  };
  for (const [label, [arm, note]] of Object.entries(cases)) {
    const { h, bridge, A, B, m3 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
    await bridge.present(A);
    arm(h);
    const o = await bridge.present({ ...B, options: { focus: false, isolate: false, marker: true } });
    assert.ok(o.notes.includes(note), `${label}: note surfaced (got ${o.notes})`);
    assert.notEqual(bridge.inspectLedger().isolation, null, `${label}: record kept for the next cleanup`);
    assert.equal((await bridge.clear()).isolation, 'restored', label);
    assert.deepEqual(h.isolation(), [{ model: m3, ids: [9] }], label);
    h.assertNoTheming();
  }
  // skipped-external: the isolation module attaches no note (the state is someone else's) — foreign state untouched.
  const { h, bridge, A, B, m3 } = setup();
  await bridge.present(A);
  h.viewer.setIsolationState([{ model: m3, ids: [5] }]);
  const o = await bridge.present({ ...B, options: { focus: false, isolate: false, marker: true } });
  assert.equal(o.isolated, false);
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [5] }]);
  assert.equal(bridge.inspectLedger().isolation, null);
});

// ── B-1: a model LEAVES the scene (the fake's removeModel drops its isolation entry) before an awaited clear() ──

test('B-1 (i): the only isolated model departs ⇒ clear() restores the prior state; nothing stranded, record dropped', async () => {
  const { h, bridge, m1, m3 } = setup({ prior: (m) => [{ model: m, ids: [42] }] });
  const o = await bridge.present({ sides: [{ model: m1, dbId: 1 }, { model: m1, dbId: 3 }], point: [0.5, 0.5, 0.5], options: ON });
  assert.equal(o.isolated, true);
  h.viewer.removeModel(m1);
  h.viewer.dispatch(h.api.eventNames.BEFORE_MODEL_UNLOAD, { model: m1 });
  const c = await bridge.clear();
  assert.equal(c.isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [42] }], 'the prior isolation is back');
  assert.equal((await bridge.clear()).isolation, 'none', 'record dropped: nothing left to restore');
});

test('B-1 (ii): two-model isolation, one model departs ⇒ the still-loaded part of the prior state is restored', async () => {
  const { h, bridge, A, m1, m2 } = setup({ prior: (m3) => [] });
  h.viewer.setIsolationState([{ model: m1, ids: [7] }, { model: m2, ids: [8] }]);    // prior covers both models
  assert.equal((await bridge.present(A)).isolated, true);
  assert.ok(sameIsolation(h.isolation(), targetFor(A.sides)));
  h.viewer.removeModel(m2);
  const c = await bridge.clear();
  assert.equal(c.isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m1, ids: [7] }], 'm1 back at its prior; the departed m2 is not written');
  const last = h.viewer.calls.setAggregateIsolation.at(-1);
  assert.ok(last.every((e) => e.model !== m2), 'no write names the departed model');
  assert.equal((await bridge.clear()).isolation, 'none', 'record dropped');
});

test('B-1 (iii): a model departs AND a still-loaded model was changed by someone else ⇒ skipped-external, no write', async () => {
  const { h, bridge, A, m1, m2, m3 } = setup({ prior: (m) => [{ model: m, ids: [42] }] });
  await bridge.present(A);
  h.viewer.removeModel(m2);
  h.viewer.setIsolationState([{ model: m1, ids: [5] }]);                              // foreign change on a loaded model
  const writes = h.callsOf('setAggregateIsolation').length;
  const c = await bridge.clear();
  assert.equal(c.isolation, 'skipped-external');
  assert.equal(h.callsOf('setAggregateIsolation').length, writes, 'foreign state is never overwritten');
  assert.deepEqual(h.isolation(), [{ model: m1, ids: [5] }]);
  assert.ok(m3);
});

test('B-1 (iv): the scene read fails at restore ⇒ failed, no write, record KEPT and a later clear() restores', async () => {
  const { h, bridge, A, m2, m3 } = setup({ prior: (m) => [{ model: m, ids: [42] }] });
  await bridge.present(A);
  h.viewer.removeModel(m2);
  const writes = h.callsOf('setAggregateIsolation').length;
  h.viewer.onCall('getAllModels', () => { throw new Error('scene read failed'); }, { phase: 'before' });
  const c = await bridge.clear();
  assert.equal(c.isolation, 'failed');
  assert.ok(c.notes.includes(ISOLATION_NOTE.SCENE_UNREADABLE_AT_RESTORE));
  assert.equal(h.callsOf('setAggregateIsolation').length, writes, 'no blind write');
  const retry = await bridge.clear();
  assert.equal(retry.isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [42] }]);
});

test('B-1 (v): apply() after a model departs keeps ownership (projected compare) ⇒ the original prior survives', async () => {
  const { h, bridge, A, m1, m2, m3 } = setup({ prior: (m) => [{ model: m, ids: [42] }] });
  await bridge.present(A);
  h.viewer.removeModel(m2);
  const o = await bridge.present({ sides: [{ model: m1, dbId: 3 }], point: [5.5, 0.5, 0.5], options: ON });
  assert.equal(o.isolated, true);
  assert.deepEqual(h.isolation(), [{ model: m1, ids: [3] }]);
  assert.equal((await bridge.clear()).isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m3, ids: [42] }], 'the pre-image is the original prior, not the leftover');
});
