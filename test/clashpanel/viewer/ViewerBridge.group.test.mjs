// test/clashpanel/viewer/ViewerBridge.group.test.mjs — Addendum B3: ViewerBridge.presentGroup() (spec §27.3/§27.4/§27.7,
// AC-GP5/GP6/GP12). Tier B; fakes only — live aggregate fit/isolation is the headed implementation-package gate.
// presentGroup is a SIBLING of present(): independently validated, arbitrary participant cardinality, defensive
// {model,dbId} de-duplication, the SAME queue/token/held ledger/guarded isolation/fit/rollback/clear/dispose, and NO
// marker, closest-point marker or outline resource (Option A).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerBridge, BRIDGE_NOTE } from '../../../clashpanel/viewer/ViewerBridge.js';
import { targetFor, ISOLATION_NOTE, ISOLATION_REASON } from '../../../clashpanel/viewer/isolation.js';
import { FIT_NOTE } from '../../../clashpanel/viewer/fit.js';
import { createBridgeHarness, NAMES, sameIsolation } from '../support/viewerFaults.mjs';
import { createFakeModel } from '../support/fakeViewer.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

const ON = { focus: true, isolate: true };
const MUTATORS = new Set(['addScene', 'addMesh', 'removeMesh', 'removeScene', 'setAggregateIsolation', 'fitToView']);
const MARKER_CALLS = new Set(['addScene', 'addMesh']);
const LATE_MUTATORS = new Set(['addScene', 'addMesh', 'setAggregateIsolation', 'fitToView']);

function setup({ prior = [] } = {}) {
  const box = (x) => [x, 0, 0, x + 1, 1, 1];
  const m1 = createFakeModel({ id: 1, boxes: { 1: box(0), 3: box(4), 5: box(8) } });
  const m2 = createFakeModel({ id: 2, boxes: { 1: box(12), 2: box(2), 4: box(6) } });
  const m3 = createFakeModel({ id: 3, boxes: { 6: box(16) } });
  const m4 = createFakeModel({ id: 4 });
  const h = createBridgeHarness({ models: [m1, m2, m3, m4], isolation: typeof prior === 'function' ? prior(m4) : prior });
  const { THREE, stats } = createFakeThree();
  const bridge = createViewerBridge({ viewerApi: h.api, THREE, names: NAMES });
  // A single-clash request (markers on) and two group requests.
  const A = { sides: [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], point: [0.5, 0.5, 0.5], options: { focus: true, isolate: true, marker: true } };
  const G = { participants: [{ model: m1, dbId: 1 }, { model: m1, dbId: 3 }, { model: m2, dbId: 2 }, { model: m3, dbId: 6 }], options: ON };
  const G2 = { participants: [{ model: m1, dbId: 5 }, { model: m2, dbId: 4 }], options: ON };
  return { h, stats, bridge, A, G, G2, m1, m2, m3, m4 };
}

const boundsReads = (...ms) => ms.reduce((n, m) => n + m.boundsCalls.length, 0);
const mutations = (h, from = 0) => h.log.slice(from).map((e) => e.method).filter((m) => MUTATORS.has(m));

// ── Request validation (independent of present()) ──────────────────────────────────────────────────────────────

test('presentGroup validates its own request: non-empty participants of {model, dbId}; options {focus, isolate} booleans; no marker option', async () => {
  const { h, bridge, m1 } = setup();
  const p = { model: m1, dbId: 1 };
  const bad = {
    'no request': undefined,
    'null request': null,
    'participants missing': { options: ON },
    'participants not an array': { participants: p, options: ON },
    'participants empty': { participants: [], options: ON },
    'a present()-shaped request (sides)': { sides: [p], options: ON },
    'participant null': { participants: [null], options: ON },
    'participant without model': { participants: [{ dbId: 1 }], options: ON },
    'participant model not an object': { participants: [{ model: 'm1', dbId: 1 }], options: ON },
    'participant negative dbId': { participants: [{ model: m1, dbId: -1 }], options: ON },
    'participant fractional dbId': { participants: [{ model: m1, dbId: 1.5 }], options: ON },
    'participant string dbId': { participants: [{ model: m1, dbId: '1' }], options: ON },
    'one bad participant among good ones': { participants: [p, p, { model: m1 }], options: ON },
    'options missing': { participants: [p] },
    'focus not boolean': { participants: [p], options: { focus: 1, isolate: true } },
    'isolate not boolean': { participants: [p], options: { focus: true } },
    'marker option present (Option A: groups have no markers)': { participants: [p], options: { focus: true, isolate: true, marker: false } },
  };
  for (const [label, req] of Object.entries(bad)) {
    await assert.rejects(bridge.presentGroup(req), TypeError, label);
  }
  assert.deepEqual(h.log, [], 'an invalid request never reaches the Viewer');
  assert.equal(bridge.inspectLedger(), null);
});

test('an invalid presentGroup does not invalidate an in-flight presentation (no token is taken)', async () => {
  const { bridge, G } = setup();
  const pending = bridge.presentGroup(G);
  await assert.rejects(bridge.presentGroup({ participants: [], options: ON }), TypeError);
  const o = await pending;
  assert.equal(o.superseded, false);
  assert.equal(o.isolated, true);
});

test('present() keeps its own contract: rejects 0 or >2 sides and a presentGroup-shaped request (AC-GP5)', async () => {
  const { h, bridge, m1, m2, m3 } = setup();
  const opts = { focus: true, isolate: true, marker: true };
  await assert.rejects(bridge.present({ sides: [], options: opts }), TypeError, '0 sides');
  await assert.rejects(bridge.present({ sides: [{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }, { model: m3, dbId: 6 }], options: opts }), TypeError, '3 sides');
  await assert.rejects(bridge.present({ participants: [{ model: m1, dbId: 1 }], options: opts }), TypeError, 'participants are not sides');
  await assert.rejects(bridge.present({ sides: [{ model: m1, dbId: 1 }], options: { focus: true, isolate: true } }), TypeError, 'present still requires marker');
  assert.deepEqual(h.log, []);
});

// ── Arbitrary cardinality, one and many models, de-duplication ─────────────────────────────────────────────────

test('one participant: per-model fit, one isolation reconcile, outcome without a witness', async () => {
  const { h, bridge, m1 } = setup();
  const o = await bridge.presentGroup({ participants: [{ model: m1, dbId: 3 }], options: ON });
  assert.deepEqual({ ...o }, { superseded: false, fitted: true, isolated: true, participants: 1, notes: [] });
  assert.equal('marked' in o, false, 'no marker/witness field is invented');
  assert.ok(Object.isFrozen(o) && Object.isFrozen(o.notes));
  assert.deepEqual(h.callsOf('setAggregateIsolation').map((e) => e.args[0]), [[{ model: m1, ids: [3] }]]);
  assert.deepEqual(h.callsOf('fitToView').map((e) => e.args.slice(0, 2)), [[[3], m1]]);
});

test('many participants in ONE model: one isolation entry for that model, one per-model fit of every id', async () => {
  const { h, bridge, m1 } = setup();
  const participants = [5, 1, 3].map((dbId) => ({ model: m1, dbId }));
  const o = await bridge.presentGroup({ participants, options: ON });
  assert.equal(o.isolated, true);
  assert.equal(o.fitted, true);
  assert.equal(o.participants, 3);
  assert.deepEqual(h.callsOf('setAggregateIsolation').map((e) => e.args[0]), [[{ model: m1, ids: [1, 3, 5] }]]);
  assert.deepEqual(h.viewer.calls.fitToView.map((c) => [c.form, c.args[0], c.args[1]]), [['ids', [1, 3, 5], m1]]);
});

test('more than two models and more than two participants: ONE aggregate isolation reconcile and ONE aggregate fit', async () => {
  const { h, bridge, G, m1, m2, m3 } = setup();
  const o = await bridge.presentGroup(G);
  assert.deepEqual({ ...o }, { superseded: false, fitted: true, isolated: true, participants: 4, notes: [] });
  const iso = h.callsOf('setAggregateIsolation');
  assert.equal(iso.length, 1, 'one aggregate isolation operation');
  assert.ok(sameIsolation(iso[0].args[0], [{ model: m1, ids: [1, 3] }, { model: m2, ids: [2] }, { model: m3, ids: [6] }]));
  assert.ok(sameIsolation(h.isolation(), targetFor(G.participants)));
  const fits = h.viewer.calls.fitToView;
  assert.equal(fits.length, 1);
  assert.equal(fits[0].form, 'aggregate');
  assert.deepEqual(fits[0].args[0].map((e) => [e.model, e.selection]), [[m1, [1, 3]], [m2, [2]], [m3, [6]]], 'the union of every live participant, keyed `selection`');
  assert.equal(bridge.inspectLedger().isolation.confirmed, true);
});

test('arbitrary cardinality: dozens of participants across models are one reconcile + one fit (no artificial limit)', async () => {
  const { h, bridge, m1, m2, m3 } = setup();
  const participants = [];
  for (let i = 0; i < 40; i++) participants.push({ model: [m1, m2, m3][i % 3], dbId: 100 + i });
  const o = await bridge.presentGroup({ participants, options: ON });
  assert.equal(o.participants, 40);
  assert.equal(h.callsOf('setAggregateIsolation').length, 1);
  assert.equal(h.viewer.calls.fitToView.length, 1);
  assert.equal(h.isolation().reduce((n, e) => n + e.ids.length, 0), 40);
});

test('defensive de-duplication: identical {model, dbId} collapse; equal dbIds in different models stay distinct', async () => {
  const { h, bridge, m1, m2 } = setup();
  const participants = [{ model: m1, dbId: 1 }, { model: m1, dbId: 1 }, { model: m2, dbId: 1 }, { model: m1, dbId: 1 }, { model: m2, dbId: 1 }];
  const o = await bridge.presentGroup({ participants, options: ON });
  assert.equal(o.participants, 2, 'two unique participants');
  assert.ok(sameIsolation(h.isolation(), [{ model: m1, ids: [1] }, { model: m2, ids: [1] }]));
  assert.deepEqual(h.viewer.calls.fitToView[0].args[0].map((e) => [e.model, e.selection]), [[m1, [1]], [m2, [1]]]);
});

test('the request is snapshotted at call time: mutating the caller\'s array afterwards changes nothing', async () => {
  const { h, bridge, m1, m2 } = setup();
  const participants = [{ model: m1, dbId: 1 }];
  const pending = bridge.presentGroup({ participants, options: ON });
  participants.push({ model: m2, dbId: 2 });
  participants[0].dbId = 3;
  const o = await pending;
  assert.equal(o.participants, 1);
  assert.deepEqual(h.isolation(), [{ model: m1, ids: [1] }]);
});

// ── No marker / outline / witness resources (Option A, AC-GP6) ─────────────────────────────────────────────────

test('a group presentation creates NO marker, closest-point marker or outline: no overlay scene/mesh, no THREE object, no bounds read', async () => {
  const { h, stats, bridge, G, m1, m2, m3 } = setup();
  const o = await bridge.presentGroup({ ...G, point: [1, 1, 1], closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } });   // stray witness fields are ignored
  assert.equal(o.isolated, true);
  assert.deepEqual(h.log.map((e) => e.method).filter((m) => MARKER_CALLS.has(m)), []);
  assert.equal(h.hasScene(NAMES.overlayMarkers), false);
  assert.equal(h.hasScene(NAMES.overlayOutlines), false);
  assert.deepEqual(h.panelMeshes(), []);
  assert.equal(stats.created.mesh.length + stats.created.line.length, 0);
  assert.equal(boundsReads(m1, m2, m3), 0, 'no element bounds are read (no outline/radius)');
  assert.deepEqual(bridge.inspectLedger().markerMeshes, []);
  h.assertNoTheming();                                    // also: no Viewer selection / visibility mutator
});

// ── Shared ledger: replacing / being replaced by a single-clash presentation ───────────────────────────────────

test('a group replacing a marked single-clash presentation removes its exact meshes first; isolation is replaced with the prior kept', async () => {
  const { h, bridge, A, G, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await bridge.present(A);
  const oldMeshes = h.panelMeshes();
  assert.equal(oldMeshes.length, 3);
  const from = h.log.length;
  const o = await bridge.presentGroup(G);
  assert.equal(o.isolated, true);
  const order = mutations(h, from);
  assert.deepEqual(order.slice(0, 3), ['removeMesh', 'removeMesh', 'removeMesh'], 'previous markers released before anything else');
  assert.deepEqual(order.slice(3), ['setAggregateIsolation', 'fitToView'], 'then one reconcile (no intermediate restore), fit last');
  assert.deepEqual(h.panelMeshes(), []);
  assert.deepEqual(bridge.inspectLedger().markerMeshes, []);
  assert.equal((await bridge.clear()).isolation, 'restored');
  assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }], 'the ORIGINAL prior, not A\'s target');
});

test('a single-clash present after a group replaces the aggregate isolation (prior kept) and draws its unchanged markers', async () => {
  const { h, bridge, A, G, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await bridge.presentGroup(G);
  const o = await bridge.present(A);
  assert.deepEqual({ fitted: o.fitted, isolated: o.isolated, marked: o.marked }, { fitted: true, isolated: true, marked: true });
  assert.equal(h.panelMeshes().length, 3, 'location + two outlines, exactly as before (AC-GP12)');
  assert.ok(sameIsolation(h.isolation(), targetFor(A.sides)));
  await bridge.clear();
  assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }]);
  assert.deepEqual(h.panelMeshes(), []);
});

test('group → group replacement is one reconcile; Isolate off restores the prior (guarded) and Focus off never fits', async () => {
  const { h, bridge, G, G2, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await bridge.presentGroup(G);
  let from = h.log.length;
  await bridge.presentGroup(G2);
  assert.deepEqual(mutations(h, from), ['setAggregateIsolation', 'fitToView']);
  assert.ok(sameIsolation(h.isolation(), targetFor(G2.participants)));
  from = h.log.length;
  const o = await bridge.presentGroup({ ...G, options: { focus: false, isolate: false } });
  assert.deepEqual({ fitted: o.fitted, isolated: o.isolated }, { fitted: false, isolated: false });
  assert.deepEqual(mutations(h, from), ['setAggregateIsolation'], 'only the guarded restore');
  assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }]);
  assert.equal(bridge.inspectLedger().isolation, null);
  assert.equal((await bridge.clear()).isolation, 'none');
});

test('fit: Focus off ⇒ no camera call; aggregate fit unavailable ⇒ first-only note; a failing fit only adds a note (never rolled back)', async () => {
  const s1 = setup();
  await s1.bridge.presentGroup({ ...s1.G, options: { focus: false, isolate: true } });
  assert.deepEqual(s1.h.viewer.calls.fitToView, []);
  const s2 = setup();
  s2.h.viewer.aggregateFit = false;
  const o2 = await s2.bridge.presentGroup(s2.G);
  assert.equal(o2.fitted, true);
  assert.deepEqual([...o2.notes], [FIT_NOTE.FIRST_ONLY]);
  const s3 = setup();
  s3.h.failAt('fitToView', 'before');
  const o3 = await s3.bridge.presentGroup({ participants: [{ model: s3.m1, dbId: 1 }], options: ON });
  assert.deepEqual({ fitted: o3.fitted, isolated: o3.isolated }, { fitted: false, isolated: true });
  assert.deepEqual([...o3.notes], [FIT_NOTE.FAILED]);
  assert.deepEqual(s3.h.isolation(), [{ model: s3.m1, ids: [1] }], 'isolation stays: fit is outside the transaction');
});

test('participants whose model left the scene are skipped with a note; none live ⇒ no isolate/fit and a held isolation is restored', async () => {
  const { h, bridge, G, m1, m2, m3, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  h.viewer.removeModel(m3);
  const o = await bridge.presentGroup(G);
  assert.ok(o.notes.includes(BRIDGE_NOTE.NOT_IN_SCENE));
  assert.equal(o.participants, 3);
  assert.ok(sameIsolation(h.callsOf('setAggregateIsolation')[0].args[0], [{ model: m1, ids: [1, 3] }, { model: m2, ids: [2] }]));
  assert.ok(h.viewer.calls.fitToView[0].args[0].every((e) => e.model !== m3));
  h.viewer.removeModel(m1);
  h.viewer.removeModel(m2);
  const from = h.log.length;
  const none = await bridge.presentGroup(G);
  assert.deepEqual({ fitted: none.fitted, isolated: none.isolated, participants: none.participants }, { fitted: false, isolated: false, participants: 0 });
  assert.ok(none.notes.includes(BRIDGE_NOTE.NOT_IN_SCENE));
  assert.ok(mutations(h, from).every((m) => m === 'setAggregateIsolation'), 'only the guarded restore');
  assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }]);
});

test('Isolate prerequisite not met (hidden nodes) ⇒ isolated:false with the reason; fit still applies; nothing written', async () => {
  const { h, bridge, G, m4 } = setup();
  h.viewer.setHiddenNodes([{ model: m4, ids: [2] }]);
  const o = await bridge.presentGroup(G);
  assert.equal(o.isolated, false);
  assert.equal(o.fitted, true);
  assert.deepEqual([...o.notes], [ISOLATION_REASON.HIDDEN]);
  assert.deepEqual(h.callsOf('setAggregateIsolation'), []);
});

// ── Injected failures at every mutating step (incl. a throw AFTER the Viewer state changed) ─────────────────────

test('injected failure at each mutating step: fail-closed FAILED outcome, previous + own resources released, prior isolation back', async () => {
  // Each case: [label, arrange-before (state to replace), method, nth, phase-of-failure]
  const cases = [
    ['isolation reconcile throws before', async () => {}, 'setAggregateIsolation', 1, 'before'],
    ['isolation reconcile throws AFTER changing state', async () => {}, 'setAggregateIsolation', 1, 'after'],
    ['replacing a group: reconcile throws AFTER changing state', async (s) => { await s.bridge.presentGroup(s.G2); }, 'setAggregateIsolation', 1, 'after'],
    ['replacing a marked clash: reconcile throws AFTER changing state', async (s) => { await s.bridge.present(s.A); }, 'setAggregateIsolation', 1, 'after'],
  ];
  for (const [label, arrange, method, nth, phase] of cases) {
    const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
    await arrange(s);
    s.h.failAt(method, phase, nth);
    const fitsBefore = s.h.viewer.calls.fitToView.length;
    const o = await s.bridge.presentGroup(s.G);
    assert.equal(o.superseded, false, label);
    assert.deepEqual({ fitted: o.fitted, isolated: o.isolated }, { fitted: false, isolated: false }, label);
    assert.ok(o.notes.includes(BRIDGE_NOTE.FAILED), `${label}: ${o.notes}`);
    assert.deepEqual(s.h.isolation(), [{ model: s.m4, ids: [9] }], `${label}: rolled back to the prior`);
    assert.deepEqual(s.h.panelMeshes(), [], label);
    assert.equal(s.bridge.inspectLedger(), null, `${label}: ledger empty`);
    assert.equal(s.h.viewer.calls.fitToView.length, fitsBefore, `${label}: no fit after a failed transaction`);
    assert.equal((await s.bridge.presentGroup(s.G)).isolated, true, `${label}: queue not wedged`);
    s.h.assertNoTheming();
  }
});

test('injected failure removing a previous marker: retried; a double failure is noted, the mesh stays held and is retried later', async () => {
  const s1 = setup();
  await s1.bridge.present(s1.A);
  s1.h.failAt('removeMesh', 'after');
  const o1 = await s1.bridge.presentGroup(s1.G);
  assert.equal(o1.isolated, true);
  assert.deepEqual(s1.h.panelMeshes(), []);
  const s2 = setup();
  await s2.bridge.present(s2.A);
  s2.h.failAt('removeMesh', 'before');
  s2.h.failAt('removeMesh', 'before');
  const o2 = await s2.bridge.presentGroup(s2.G);
  assert.ok(o2.notes.includes(BRIDGE_NOTE.REMOVE_FAILED));
  assert.equal(o2.isolated, true);
  const [orphan] = s2.h.panelMeshes();
  assert.deepEqual(s2.bridge.inspectLedger().markerMeshes, [orphan], 'the orphan stays in the ONE ledger');
  await s2.bridge.clear();
  assert.deepEqual(s2.h.panelMeshes(), []);
  assert.equal(s2.bridge.inspectLedger(), null);
});

test('injected failure in the guarded restore of a non-isolating group: the failure note is surfaced and the record kept', async () => {
  for (const [label, arm, note] of [
    ['restore keeps throwing', (h) => { h.failAt('setAggregateIsolation', 'before'); h.failAt('setAggregateIsolation', 'before'); }, ISOLATION_NOTE.RESTORE_FAILED],
    ['unreadable at restore', (h) => h.failAt('getAggregateIsolation', 'before'), ISOLATION_NOTE.UNREADABLE_AT_RESTORE],
  ]) {
    const { h, bridge, G, G2, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
    await bridge.presentGroup(G);
    arm(h);
    const o = await bridge.presentGroup({ ...G2, options: { focus: false, isolate: false } });
    assert.ok(o.notes.includes(note), `${label}: ${o.notes}`);
    assert.notEqual(bridge.inspectLedger().isolation, null, `${label}: record kept`);
    assert.equal((await bridge.clear()).isolation, 'restored', label);
    assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }], label);
  }
});

// ── Supersession / clear / dispose at EVERY Viewer call of an in-flight presentGroup ────────────────────────────

async function callPoints(run) {
  const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await run.before(s);
  const from = s.h.log.length;
  await s.bridge.presentGroup(s.G);
  const seen = new Map();
  return s.h.log.slice(from).map((e) => { const n = (seen.get(e.method) ?? 0) + 1; seen.set(e.method, n); return [e.method, n]; });
}

const RUNS = {
  'from empty': { before: async () => {} },
  'replacing a group': { before: async (s) => { await s.bridge.presentGroup(s.G2); } },
  'replacing a marked clash': { before: async (s) => { await s.bridge.present(s.A); } },
};

test('clear() issued at ANY Viewer call of an in-flight presentGroup: superseded, no later add/isolate/fit, nothing left, prior back', async () => {
  let cases = 0;
  for (const [label, run] of Object.entries(RUNS)) {
    const points = await callPoints(run);
    assert.ok(points.length >= 5, `${label}: the sweep covers the whole presentGroup (${points.length})`);
    for (const [method, nth] of points) {
      for (const phase of ['before', 'after']) {
        const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
        await run.before(s);
        let cleared;
        let at = -1;
        s.h.viewer.onCall(method, () => { cleared = s.bridge.clear(); at = s.h.log.length; }, { nth, phase });
        const o = await s.bridge.presentGroup(s.G);
        const c = await cleared;
        const where = `${label} · ${method}#${nth} ${phase}`;
        assert.ok(at >= 0, `${where}: hook fired`);
        assert.equal(o.superseded, true, where);
        assert.equal(o.fitted, false, where);
        const late = s.h.log.slice(at).map((e) => e.method).filter((m) => LATE_MUTATORS.has(m));
        // a restore write (setAggregateIsolation back to the prior) by the cleanup is allowed; nothing else.
        assert.ok(late.every((m) => m === 'setAggregateIsolation'), `${where}: no add/fit after invalidation, got ${late}`);
        assert.deepEqual(s.h.panelMeshes(), [], where);
        assert.deepEqual(s.h.isolation(), [{ model: s.m4, ids: [9] }], `${where}: prior back`);
        assert.equal(s.bridge.inspectLedger(), null, where);
        assert.ok(['restored', 'none'].includes(c.isolation), `${where}: ${c.isolation}`);
        s.h.assertNoTheming();
        cases += 1;
      }
    }
  }
  assert.ok(cases > 20, `${cases}`);
});

test('dispose() at ANY Viewer call of an in-flight presentGroup: superseded, nothing Panel-owned left, later calls are disposed no-ops', async () => {
  for (const [label, run] of Object.entries(RUNS)) {
    const points = await callPoints(run);
    for (const [method, nth] of points) {
      for (const phase of ['before', 'after']) {
        const s = setup({ prior: (m) => [{ model: m, ids: [9] }] });
        await run.before(s);
        let disposing;
        let at = -1;
        s.h.viewer.onCall(method, () => { disposing = s.bridge.dispose(); at = s.h.log.length; }, { nth, phase });
        const o = await s.bridge.presentGroup(s.G);
        assert.equal(await disposing, undefined);
        const where = `${label} · ${method}#${nth} ${phase}`;
        assert.equal(o.superseded, true, where);
        const late = s.h.log.slice(at).map((e) => e.method).filter((m) => m === 'addScene' || m === 'addMesh' || m === 'fitToView');
        assert.deepEqual(late, [], where);
        assert.deepEqual(s.h.panelMeshes(), [], where);
        assert.equal(s.h.hasScene(NAMES.overlayMarkers), false, where);
        assert.equal(s.h.hasScene(NAMES.overlayOutlines), false, where);
        assert.deepEqual(s.h.isolation(), [{ model: s.m4, ids: [9] }], where);
        s.h.log.length = 0;
        const after = await s.bridge.presentGroup(s.G);
        assert.deepEqual({ ...after }, { superseded: true, fitted: false, isolated: false, participants: 0, notes: [], disposed: true }, where);
        assert.deepEqual(mutations(s.h), [], `${where}: disposed no-op`);
        s.h.assertNoTheming();
      }
    }
  }
});

test('interleavings: present ⇄ presentGroup ⇄ presentGroup — a stale completion never clears the newest token\'s resources', async () => {
  // (a) presentGroup arrives while a marked present is inside its isolation step.
  {
    const { h, bridge, A, G } = setup();
    let pg;
    h.viewer.onCall('getAggregateIsolation', () => { pg = bridge.presentGroup(G); }, { phase: 'before' });
    const oa = await bridge.present(A);
    const og = await pg;
    assert.equal(oa.superseded, true);
    assert.equal(og.superseded, false);
    assert.deepEqual(h.panelMeshes(), [], 'A\'s markers were released; the group draws none');
    assert.ok(sameIsolation(h.isolation(), targetFor(G.participants)));
  }
  // (b) a marked present arrives while a presentGroup is inside its isolation step.
  {
    const { h, bridge, A, G } = setup();
    let pa;
    h.viewer.onCall('getAggregateIsolation', () => { pa = bridge.present(A); }, { phase: 'before' });
    const og = await bridge.presentGroup(G);
    const oa = await pa;
    assert.equal(og.superseded, true);
    assert.equal(oa.superseded, false);
    assert.equal(h.panelMeshes().length, 3);
    assert.ok(sameIsolation(h.isolation(), targetFor(A.sides)));
  }
  // (c) group → group: the second arrives during the first's fit.
  {
    const { h, bridge, G, G2 } = setup();
    let p2;
    h.viewer.onCall('fitToView', () => { p2 = bridge.presentGroup(G2); }, { phase: 'before' });
    const o1 = await bridge.presentGroup(G);
    const o2 = await p2;
    assert.equal(o1.superseded, true);
    assert.equal(o1.fitted, false, 'the stale group never moved the camera');
    assert.equal(o2.superseded, false);
    assert.ok(sameIsolation(h.isolation(), targetFor(G2.participants)));
  }
  // (d) queued (not yet started) presentGroup superseded by a later one is a no-op.
  {
    const { h, bridge, G, G2 } = setup();
    const p1 = bridge.presentGroup(G);
    const p2 = bridge.presentGroup(G2);
    assert.equal((await p1).superseded, true);
    assert.equal((await p2).superseded, false);
    assert.equal(h.callsOf('setAggregateIsolation').length, 1, 'the superseded one never touched the Viewer');
  }
});

test('clear() and dispose() release a group presentation exactly like a single-clash one', async () => {
  const s1 = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await s1.bridge.presentGroup(s1.G);
  const c = await s1.bridge.clear();
  assert.deepEqual({ ...c, notes: [...c.notes] }, { isolation: 'restored', markersRemoved: 0, notes: [] });
  assert.deepEqual(s1.h.isolation(), [{ model: s1.m4, ids: [9] }]);
  assert.equal(s1.bridge.inspectLedger(), null);
  const s2 = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  await s2.bridge.presentGroup(s2.G);
  await s2.bridge.dispose();
  assert.deepEqual(s2.h.isolation(), [{ model: s2.m4, ids: [9] }]);
  assert.equal(s2.bridge.inspectDisposal().disposed, true);
  s2.h.assertNoTheming();
});

// A throw from step 1 (outside the transaction try) reaches presentGroup()'s outer catch: FAILED, never rejects,
// the held ledger is still released, and the queue is not wedged.
test('presentGroup outer catch fallback: FAILED, superseded:false, held released, queue not wedged', async () => {
  const { h, A, G, m4 } = setup({ prior: (m) => [{ model: m, ids: [9] }] });
  let armed = false;
  const api = new Proxy(h.api, {
    get(t, prop, r) {
      if (prop !== 'getAllModels') return Reflect.get(t, prop, r);
      return () => {
        const list = t.getAllModels();
        if (!armed) return list;
        armed = false;
        return new Proxy(list, { get(a, p, rr) { if (p === 'includes') return () => { throw new Error('scene list broke'); }; return Reflect.get(a, p, rr); } });
      };
    },
  });
  const bridge = createViewerBridge({ viewerApi: api, THREE: createFakeThree().THREE, names: NAMES });
  await bridge.present(A);
  armed = true;
  const o = await bridge.presentGroup(G);
  assert.deepEqual({ superseded: o.superseded, isolated: o.isolated, fitted: o.fitted }, { superseded: false, isolated: false, fitted: false });
  assert.equal(o.notes[0], BRIDGE_NOTE.FAILED);
  assert.deepEqual(h.panelMeshes(), []);
  assert.deepEqual(h.isolation(), [{ model: m4, ids: [9] }]);
  assert.equal(bridge.inspectLedger(), null);
  assert.equal((await bridge.presentGroup(G)).superseded, false);
});
