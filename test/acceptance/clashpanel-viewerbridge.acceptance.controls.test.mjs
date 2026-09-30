// test/acceptance/clashpanel-viewerbridge.acceptance.controls.test.mjs
//
// Offline tests for the N1–N8 control machinery and the D4 bounded failure-injection wrappers
// (procedure §7, §C15, §4.3/§4.6): injection is DORMANT (refused on any object that is not a branded
// offline fake while LIVE_PATH_WIRED is false -- a real Viewer can never be injected from this
// revision), injection layers sit INSIDE the recorder (calls stay recorded and flagged injected),
// every injection has a bounded fire budget, removal restores the original by reference, and the
// control wrappers map deadlines/throws/invalid records to §7 states.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LIVE_PATH_WIRED, OFFLINE_FAKE_TARGET_BRAND, C15_INJECTION_SPECS, createFailureInjectionController, G2InjectedError, isInjectedError,
  createCallRecorder, createWrapperRegistry, recordingWrap, runControlWithDeadline, makeControlRecord, n1Record, n3Record,
  runSpySelfTestN1, runSceneOwnershipControlN3, SCENE_CLASS, G2RefusalError, CONTROL_NAMES, CONTROL_ALLOWED_STATES,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));

function fakeViewer({ branded = true } = {}) {
  const state = { isolation: [], meshes: [] };
  const viewer = {
    setAggregateIsolation(list) { state.isolation = list.map((e) => ({ ...e })); },
    getAggregateIsolation() { return state.isolation; },
    fitToView() { return 'fit'; },
    overlays: { addMesh(mesh) { state.meshes.push(mesh); return true; } },
  };
  if (branded) { viewer[OFFLINE_FAKE_TARGET_BRAND] = true; viewer.overlays[OFFLINE_FAKE_TARGET_BRAND] = true; }
  return { viewer, state };
}

function spied(viewer) {
  const recorder = createCallRecorder();
  const registry = createWrapperRegistry();
  for (const m of ['setAggregateIsolation', 'getAggregateIsolation', 'fitToView']) recordingWrap(viewer, m, { recorder, registry, label: `viewer.${m}` });
  recordingWrap(viewer.overlays, 'addMesh', { recorder, registry, label: 'overlays.addMesh' });
  return { recorder, registry };
}

test('dormancy: LIVE_PATH_WIRED is false and injection on an unbranded (real-Viewer-like) object is refused before any wrapper change', () => {
  assert.equal(LIVE_PATH_WIRED, false);
  const { viewer } = fakeViewer({ branded: false });
  const { registry } = spied(viewer);
  const before = viewer.setAggregateIsolation;
  for (const allowOfflineFakes of [false, true]) {
    const ctl = createFailureInjectionController({ registry, allowOfflineFakes });
    for (const s of Object.keys(C15_INJECTION_SPECS)) {
      assert.throws(() => ctl.install(s, { viewer, overlays: viewer.overlays }), (e) => e instanceof G2RefusalError && e.reason === 'failure-injection-dormant');
    }
    assert.deepEqual(ctl.installed(), []);
  }
  assert.equal(viewer.setAggregateIsolation, before);
  // even a branded fake needs the explicit offline opt-in
  const branded = fakeViewer();
  const s2 = spied(branded.viewer);
  assert.throws(() => createFailureInjectionController({ registry: s2.registry }).install('b', { viewer: branded.viewer }), /dormant/);
});

test('static: the only place the brand is honoured is the controller; the harness never sets it on any object', () => {
  const src = readFileSync(HARNESS, 'utf8');
  assert.equal((src.match(/\[OFFLINE_FAKE_TARGET_BRAND\]\s*=(?!=)/g) || []).length, 0);
  assert.equal((src.match(/OFFLINE_FAKE_TARGET_BRAND\]/g) || []).length, 1);
});

test('injection requires the recording wrapper (recorder outermost) and injected calls remain recorded with injected:true', () => {
  const { viewer, state } = fakeViewer();
  const { recorder, registry } = spied(viewer);
  const ctl = createFailureInjectionController({ registry, allowOfflineFakes: true });
  const h = ctl.install('b', { viewer, overlays: viewer.overlays });
  assert.throws(() => recorder.withOrigin('bridge', () => viewer.setAggregateIsolation([{ model: 1, ids: [1] }])), (e) => isInjectedError(e) && e.scenario === 'b');
  assert.deepEqual(state.isolation, []); // throw-before: no state change
  viewer.setAggregateIsolation([{ model: 1, ids: [2] }]); // budget spent: passes through
  assert.deepEqual(state.isolation, [{ model: 1, ids: [2] }]);
  const recs = recorder.records.filter((r) => r.method === 'viewer.setAggregateIsolation');
  assert.equal(recs.length, 2);
  assert.equal(recs[0].injected, true);
  assert.equal(recs[0].outcome.threw, true);
  assert.equal(recs[0].origin, 'bridge');
  assert.equal(recs[1].injected, true); // passed through the (spent) injection layer
  assert.equal(h.fires(), 1);
  assert.equal(h.remove().ok, true);
  viewer.setAggregateIsolation([]);
  assert.equal(recorder.records.at(-1).injected, false);
  assert.equal(registry.restoreAll().ok, true);
  assert.equal(registry.verifyAllRestored().ok, true);
  // no recording wrapper => refused (the recorder must be outermost)
  const bare = fakeViewer();
  assert.throws(() => createFailureInjectionController({ registry: createWrapperRegistry(), allowOfflineFakes: true }).install('b', { viewer: bare.viewer }), /no recording wrapper/);
});

test('scenario semantics: (a) 2nd addMesh; (c) throw-after-change; (d) aggregate fitToView only; (e) armed-only and bounded', () => {
  const { viewer, state } = fakeViewer();
  const { registry } = spied(viewer);
  const ctl = createFailureInjectionController({ registry, allowOfflineFakes: true });
  const owners = { viewer, overlays: viewer.overlays };
  let h = ctl.install('a', owners);
  viewer.overlays.addMesh({ n: 1 });
  assert.throws(() => viewer.overlays.addMesh({ n: 2 }), G2InjectedError);
  viewer.overlays.addMesh({ n: 3 });
  assert.equal(state.meshes.length, 2);
  assert.equal(h.fires(), 1);
  h.remove();
  h = ctl.install('c', owners);
  assert.throws(() => viewer.setAggregateIsolation([{ model: 1, ids: [9] }]), G2InjectedError);
  assert.deepEqual(state.isolation, [{ model: 1, ids: [9] }]); // state changed, then threw
  h.remove();
  h = ctl.install('d', owners);
  assert.equal(viewer.fitToView([5], {}), 'fit'); // per-model form not counted
  assert.throws(() => viewer.fitToView([{ model: {}, selection: [1] }], undefined, true), G2InjectedError);
  assert.equal(viewer.fitToView([{ model: {}, selection: [1] }]), 'fit');
  h.remove();
  h = ctl.install('e', owners);
  viewer.setAggregateIsolation([]); // not armed: passes
  h.arm();
  let thrown = 0;
  for (let i = 0; i < 20; i += 1) { try { viewer.setAggregateIsolation([]); } catch (e) { if (isInjectedError(e)) thrown += 1; } }
  assert.equal(thrown, C15_INJECTION_SPECS.e.maxFires); // bounded even while armed
  h.disarm();
  viewer.setAggregateIsolation([]);
  assert.equal(h.remove().ok, true);
  assert.deepEqual(ctl.installed(), []);
  assert.equal(registry.restoreAll().ok, true);
  for (const spec of Object.values(C15_INJECTION_SPECS)) assert.ok(Number.isFinite(spec.maxFires) && spec.maxFires >= 1);
});

test('LIFO removal: removing an outer injection out of order is refused and reported', () => {
  const { viewer } = fakeViewer();
  const { registry } = spied(viewer);
  const ctl = createFailureInjectionController({ registry, allowOfflineFakes: true });
  const h1 = ctl.install('b', { viewer });
  const h2 = ctl.install('c', { viewer });
  assert.equal(h1.remove().ok, false);
  assert.equal(h2.remove().ok, true);
  assert.equal(h1.remove().ok, true);
  const restore = registry.restoreAll();
  assert.equal(restore.ok, true);
});

test('runControlWithDeadline: timeout => TIMED_OUT (or NOT_DETECTED where not allowed), throw => NOT_DETECTED, invalid record => NOT_DETECTED', async () => {
  let fire = null;
  const timers = { setTimeout: (fn) => { fire = fn; return 1; }, clearTimeout: () => {} };
  const pending = runControlWithDeadline({ name: 'N4', fn: () => new Promise(() => {}), timers });
  fire();
  assert.equal((await pending).state, 'TIMED_OUT');
  const pending6 = runControlWithDeadline({ name: 'N6', fn: () => new Promise(() => {}), timers });
  fire();
  assert.equal((await pending6).state, 'NOT_DETECTED');
  assert.equal((await runControlWithDeadline({ name: 'N5', fn: () => { throw new Error('x'); } })).state, 'NOT_DETECTED');
  assert.equal((await runControlWithDeadline({ name: 'N5', fn: () => ({ state: 'DETECTED' }) })).state, 'NOT_DETECTED');
  assert.equal((await runControlWithDeadline({ name: 'N5', fn: () => makeControlRecord('N5', 'DETECTED_RESTORED') })).state, 'DETECTED_RESTORED');
});

test('N1 and N3 records from the Section 19/23 controls; N3 also needs the live scene observations', () => {
  const recorder = createCallRecorder();
  assert.equal(n1Record(runSpySelfTestN1({ recorder })).state, 'DETECTED');
  const silent = (obj, name, opts) => recordingWrap(obj, name, { ...opts, recorder: { ...opts.recorder, record: () => ({}) } });
  assert.equal(n1Record(runSpySelfTestN1({ recorder, wrapFn: silent })).state, 'NOT_DETECTED');
  const scenes = [{ scene: 'clash-panel-outlines:g2b', class: SCENE_CLASS.PANEL_OWNED }, { scene: 'clash-panel-markers:g2b', class: SCENE_CLASS.FOREIGN, sentinelRefId: 'o9' }];
  const presentAfterDispose = { 'clash-panel-outlines:g2b': false, 'clash-panel-markers:g2b': true };
  const r = runSceneOwnershipControlN3({ scenes, presentAfterDispose, ledger: [] });
  assert.equal(n3Record(r, { liveObservationsHold: true }).state, 'DETECTED_RESTORED');
  assert.equal(n3Record(r, { liveObservationsHold: false }).state, 'NOT_DETECTED');
  assert.equal(n3Record(runSceneOwnershipControlN3({ scenes, presentAfterDispose, ledger: [], oracle: () => ({ verdict: 'PASS', violations: [] }) }), { liveObservationsHold: true }).state, 'NOT_DETECTED');
});

test('every control constructor only emits §7-allowed states', () => {
  for (const n of CONTROL_NAMES) for (const s of CONTROL_ALLOWED_STATES[n]) assert.equal(makeControlRecord(n, s).state, s);
});
