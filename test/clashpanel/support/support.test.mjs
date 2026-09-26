// test/clashpanel/support/support.test.mjs
// Tests of the DOUBLES themselves (a test double whose behavior is wrong silently invalidates every later task).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DerivationAbortedError, DerivationBusyError, ReadAbortedError, ResultSetRetainedError, UnsavedResultSetError,
  ResultNotResidentError, createDerivationContext,
} from '../../../clashtest/index.js';
import { narrowEnginePort } from '../../../clashpanel/core/ports.js';
import {
  FAKE_EVENTS, FORBIDDEN_ENGINE_MEMBERS, FORBIDDEN_REGISTRY_MEMBERS, FORBIDDEN_VIEWER_METHODS, MODEL_A, MODEL_B, THEMING_METHODS,
  caveatedFilterFor, createDeferred, createFakeBridge, createFakeCatalog, createFakeEngine, createFakeModel, createFakeScheduler,
  createFakeThree, createFakeViewer, createFakeViewerApi, createJournal, deepFreeze, elementGroupsFor, emptyCompletedClean, failedSet,
  flush, hardResult, hardSet, makeSealedSet, manyResults, partialSet, softResult, softSet, summaryFor,
} from './index.mjs';

// ================================================================================================
// fakeScheduler
// ================================================================================================
test('fake scheduler: virtual time only moves in advance(); timers fire oldest first, ties in scheduling order', async () => {
  const s = createFakeScheduler({ start: 100 });
  const fired = [];
  s.setTimeout(() => fired.push('b@20'), 20);
  s.setTimeout(() => fired.push('a@10'), 10);
  s.setTimeout(() => fired.push('c@20'), 20);
  assert.equal(s.now(), 100);
  await s.advance(9);
  assert.deepEqual(fired, []);
  await s.advance(1);
  assert.deepEqual(fired, ['a@10']);
  assert.equal(s.now(), 110);
  await s.advance(10);
  assert.deepEqual(fired, ['a@10', 'b@20', 'c@20']);
  assert.equal(s.pendingTimers(), 0);
});

test('fake scheduler: clearTimeout cancels; delays are recorded; timers scheduled by a fired timer inside the window also fire', async () => {
  const s = createFakeScheduler();
  const fired = [];
  const h = s.setTimeout(() => fired.push('cancelled'), 5);
  s.clearTimeout(h);
  s.setTimeout(() => { fired.push('first'); s.setTimeout(() => fired.push('chained'), 5); }, 5);
  await s.advance(10);
  assert.deepEqual(fired, ['first', 'chained']);
  assert.deepEqual(s.delays, [5, 5, 5]);
  await assert.rejects(s.advance(-1), RangeError);
});

test('fake scheduler: yield() is counted, runs yieldHook(n), and holdYields() blocks until release', async () => {
  const s = createFakeScheduler();
  const seen = [];
  s.yieldHook = (n) => { seen.push(n); };
  await s.yield();
  await s.yield();
  assert.equal(s.yieldCount, 2);
  assert.deepEqual(seen, [1, 2]);
  s.yieldHook = null;
  const hold = s.holdYields();
  let resumed = false;
  const p = s.yield().then(() => { resumed = true; });
  await flush();
  assert.equal(resumed, false);
  hold.release();
  await p;
  assert.equal(resumed, true);
});

// ================================================================================================
// fakeCatalog
// ================================================================================================
test('fake catalog: list() returns fresh copies; mutators change state but only fire() notifies', () => {
  const c = createFakeCatalog({ models: [{ modelKey: 'k1', displayName: 'Arch' }, { modelKey: 'k2', displayName: 'Struct', loaded: false }] });
  let changes = 0;
  const off = c.onChange(() => { changes += 1; });
  const list = c.list();
  assert.deepEqual(list.map((e) => [e.modelKey, e.displayName, e.loaded]), [['k1', 'Arch', true], ['k2', 'Struct', false]]);
  list[0].loaded = false;
  assert.equal(c.list()[0].loaded, true);
  c.setLoaded('k2', true);
  assert.equal(changes, 0);
  c.fire();
  assert.equal(changes, 1);
  assert.equal(c.list()[1].loaded, true);
  off();
  c.fire();
  assert.equal(changes, 1);
  assert.equal(c.listenerCount(), 0);
});

test('fake catalog: display names and model->key mappings OUTLIVE removal; unknown ones answer null', () => {
  const c = createFakeCatalog({ models: [{ modelKey: 'k1', displayName: 'Arch' }] });
  const model = c.modelOf('k1');
  c.removeModel('k1');
  assert.deepEqual(c.list(), []);
  assert.equal(c.displayNameFor('k1'), 'Arch');
  assert.equal(c.keyOfModel(model), 'k1');
  assert.equal(c.displayNameFor('nope'), null);
  assert.equal(c.keyOfModel({}), null);
});

test('fake catalog: addModel with a known key replaces the entry (a reload = new Model object); a null key is an unidentified model', () => {
  const c = createFakeCatalog({ models: [{ modelKey: 'k1', displayName: 'Arch' }] });
  const before = c.modelOf('k1');
  const after = c.addModel({ modelKey: 'k1', displayName: 'Arch v2' });
  assert.notEqual(before, after);
  assert.equal(c.list().length, 1);
  assert.equal(c.list()[0].displayName, 'Arch v2');
  c.addModel({ modelKey: null, displayName: 'Mystery' });
  assert.deepEqual(c.list().map((e) => e.modelKey), ['k1', null]);
  assert.throws(() => c.setLoaded('missing', true), /no model/);
});

test('fake catalog: measurementBasis records a copy of the keys, supports value/function/promise, and can be omitted entirely', async () => {
  const c = createFakeCatalog({ models: [] });
  const keys = ['a', 'b'];
  assert.deepEqual(c.measurementBasis(keys), { state: 'verified', basisKey: 'fake-basis' });
  keys.push('x');
  assert.deepEqual(c.calls.measurementBasis, [['a', 'b']]);
  c.setBasis((ks) => ({ state: 'unverified', reason: `n=${ks.length}` }));
  assert.deepEqual(c.measurementBasis(['a']), { state: 'unverified', reason: 'n=1' });
  c.setBasis(Promise.resolve({ state: 'incompatible', reason: 'r' }));
  assert.deepEqual(await c.measurementBasis(['a']), { state: 'incompatible', reason: 'r' });
  assert.equal('measurementBasis' in createFakeCatalog({ omitMeasurementBasis: true }), false);
});

// ================================================================================================
// fakeEngine: handle semantics
// ================================================================================================
const sealedFor = (runId) => makeSealedSet({ runId, results: manyResults(2) });

test('fake engine: startRun is synchronous, returns a handle with the real members, and records the call', () => {
  const engine = createFakeEngine();
  const def = { testId: 't', revision: 1 };
  const h = engine.startRun(def, { persist: true });
  for (const m of ['runId', 'getSnapshot', 'subscribe', 'cancel', 'done', 'persisted']) assert.ok(m in h, m);
  assert.equal(h.runId, 'run-1');
  assert.equal(engine.startRun(def).runId, 'run-2');
  assert.deepEqual(engine.calls.startRun[0], { def, opts: { persist: true } });
  assert.equal(engine.lastHandle.runId, 'run-2');
  assert.deepEqual(h.getSnapshot(), { ...h.getSnapshot(), status: 'queued', phase: 'queued', fractionProcessed: null });
});

test('fake engine: events are state/unit/persistence only; listener errors are swallowed; subscribe validates and unsubscribes', () => {
  const h = createFakeEngine().startRun({});
  const seen = [];
  assert.throws(() => h.subscribe('nope'), TypeError);
  const off = h.subscribe((e) => seen.push(e));
  h.subscribe(() => { throw new Error('listener boom'); });
  h.emitState({ status: 'planning', phase: 'enumerating' });
  h.emitUnit({ status: 'running', phase: 'executing' });
  h.emitPersistence({ state: 'saved' });
  assert.deepEqual(seen.map((e) => e.type), ['state', 'unit', 'persistence']);
  assert.deepEqual(seen.map((e) => e.seq), [1, 2, 3]);
  assert.equal(h.getSnapshot().status, 'running');
  assert.equal('status' in seen[2], false);
  off();
  h.emitState({ status: 'running', phase: 'executing' });
  assert.equal(seen.length, 3);
  assert.equal(h.listenerCount(), 1);
});

test('fake engine: finish() emits the terminal state event, resolves done once with resultSet (null allowed), and persisted follows persistence', async () => {
  const engine = createFakeEngine();
  const h = engine.startRun({});
  const events = [];
  h.subscribe((e) => events.push(e));
  const set = sealedFor(h.runId);
  const summary = await h.finish({ status: 'completed', resultSet: set });
  assert.deepEqual(summary, { runId: 'run-1', status: 'completed', resultSet: set, persistence: { state: 'saved', timedOut: false, attempt: 1 } });
  assert.deepEqual(events[0], { type: 'state', seq: 1, status: 'completed', phase: 'terminal', terminal: true, persistence: { state: 'saved', timedOut: false, attempt: 1 } });
  assert.deepEqual(await h.persisted, { state: 'saved' });
  assert.equal(await h.finish({ status: 'failed' }), summary);
  const g = engine.startRun({});
  assert.equal((await g.finish({ status: 'failed' })).resultSet, null);
});

test('fake engine: a pending persistence settles later via finishPersisted, independent of done, and updates getPersistenceState', async () => {
  const engine = createFakeEngine();
  const h = engine.startRun({});
  await h.finish({ resultSet: sealedFor(h.runId), persistence: { state: 'pending', timedOut: true, attempt: 1 } });
  assert.equal(engine.getPersistenceState(h.runId).state, 'pending');
  let settled = false;
  h.persisted.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false);
  h.finishPersisted({ state: 'saved' });
  assert.deepEqual(await h.persisted, { state: 'saved' });
  assert.equal(engine.getPersistenceState(h.runId).state, 'saved');
  const f = engine.startRun({});
  await f.finish({ resultSet: sealedFor(f.runId), persistence: { state: 'failed', error: new Error('disk') } });
  assert.equal((await f.persisted).state, 'failed');
  assert.equal(engine.getPersistenceState(f.runId).state, 'failed');
});

test('fake engine: cancel() records the reason, moves a running run to cancelling, returns done, and can auto-finish', async () => {
  const engine = createFakeEngine();
  const h = engine.startRun({});
  h.emitState({ status: 'running', phase: 'executing' });
  const p = h.cancel('user');
  assert.deepEqual(h.cancelCalls, ['user']);
  assert.equal(h.getSnapshot().status, 'cancelling');
  await h.finish({ status: 'cancelled', resultSet: null, persistence: { state: 'skipped', reason: 'seal-failed' } });
  assert.equal((await p).status, 'cancelled');
  assert.deepEqual(h.cancelCalls, ['user']);
  await h.cancel('after terminal');
  assert.deepEqual(h.cancelCalls, ['user', 'after terminal']);
});

test('fake engine: failNextStartRun throws synchronously once (the typed-error admission failures)', () => {
  const engine = createFakeEngine();
  const err = Object.assign(new Error('capacity'), { name: 'ResultCapacityError' });
  engine.failNextStartRun(err);
  assert.throws(() => engine.startRun({}), (e) => e === err);
  assert.equal(engine.startRun({}).runId, 'run-1');
  assert.equal(engine.calls.startRun.length, 2);
});

test('fake engine: residency is strict like the real engine (lease blocks release, unsaved needs acknowledgement, non-resident is a no-op)', async () => {
  const engine = createFakeEngine();
  const h = engine.startRun({});
  await h.finish({ resultSet: sealedFor(h.runId) });
  const lease = engine.retainResultSet(h.runId);
  assert.throws(() => engine.releaseResultSet(h.runId), ResultSetRetainedError);
  lease.release();
  lease.release();
  assert.equal(engine.leases[0].releaseCalls, 2);
  engine.releaseResultSet(h.runId);
  assert.deepEqual(engine.residentRunIds(), []);
  engine.releaseResultSet('never-existed');
  assert.throws(() => engine.retainResultSet('never-existed'), ResultNotResidentError);
  const u = engine.startRun({});
  await u.finish({ resultSet: sealedFor(u.runId), persistence: { state: 'failed', error: new Error('x') } });
  assert.throws(() => engine.retainResultSet(u.runId), UnsavedResultSetError);
  assert.throws(() => engine.releaseResultSet(u.runId), UnsavedResultSetError);
  engine.releaseResultSet(u.runId, { acknowledgeUnsaved: true });
  assert.deepEqual(engine.residentRunIds(), []);
  engine.failNextRelease(new Error('release boom'));
  assert.throws(() => engine.releaseResultSet('x'), /release boom/);
});

// ================================================================================================
// fakeEngine: async spies, forbidden members, journal
// ================================================================================================
test('fake engine spies: auto mode resolves the default; hold() defers until call.resolve/reject; rejectNext scripts errors', async () => {
  const engine = createFakeEngine();
  assert.deepEqual(await engine.getFreshness('run-1'), { state: 'current', reasons: [] });
  engine.spies.groupBy.setResult((set, facets) => ({ facets, groups: [] }));
  assert.deepEqual(await engine.derivations.groupBy({}, ['element']), { facets: ['element'], groups: [] });
  engine.spies.summarize.hold();
  const p = engine.derivations.summarize({}, { signal: null });
  await flush();
  assert.equal(engine.spies.summarize.pending().length, 1);
  engine.spies.summarize.calls[0].resolve({ totalResults: 7 });
  assert.deepEqual(await p, { totalResults: 7 });
  engine.spies.filter.rejectNext(new DerivationBusyError({ limit: 2 }));
  await assert.rejects(engine.derivations.filter({}, []), (e) => e.name === 'DerivationBusyError');
  assert.deepEqual((await engine.derivations.filter({}, [])).matches, []);
});

test('fake engine spies: an AbortSignal rejects with the real abort error class (derivations vs reads) and an already-aborted signal rejects at once', async () => {
  const engine = createFakeEngine();
  engine.spies.groupBy.hold();
  engine.spies.getFreshness.hold();
  const c1 = new AbortController();
  const c2 = new AbortController();
  const g = engine.derivations.groupBy({}, ['element'], { signal: c1.signal });
  const f = engine.getFreshness('run-1', { signal: c2.signal });
  c1.abort();
  c2.abort();
  await assert.rejects(g, (e) => e instanceof DerivationAbortedError);
  await assert.rejects(f, (e) => e instanceof ReadAbortedError);
  await assert.rejects(engine.derivations.summarize({}, { signal: AbortSignal.abort() }), DerivationAbortedError);
});

test('fake engine: derivationStats tracks in-flight and the maximum concurrency across all three derivations', async () => {
  const engine = createFakeEngine();
  for (const k of ['summarize', 'groupBy', 'filter']) engine.spies[k].hold();
  const ps = [engine.derivations.summarize({}), engine.derivations.groupBy({}, []), engine.derivations.filter({}, [])];
  assert.deepEqual(engine.derivationStats(), { inFlight: 3, maxInFlight: 3, total: 3 });
  for (const k of ['summarize', 'groupBy', 'filter']) engine.spies[k].calls[0].resolve({});
  await Promise.all(ps);
  assert.deepEqual(engine.derivationStats(), { inFlight: 0, maxInFlight: 3, total: 3 });
});

test('AC-P20: every forbidden engine/registry member throws on ACCESS and is recorded; the narrowed port never touches them', () => {
  const engine = createFakeEngine({ bindings: [{ modelKey: 'k1' }] });
  for (const name of FORBIDDEN_ENGINE_MEMBERS) assert.throws(() => engine[name], /AC-P20/, name);
  for (const name of FORBIDDEN_REGISTRY_MEMBERS) assert.throws(() => engine.registry[name], /AC-P20/, name);
  assert.equal(engine.forbiddenAccess.length, FORBIDDEN_ENGINE_MEMBERS.length + FORBIDDEN_REGISTRY_MEMBERS.length);
  const clean = createFakeEngine({ bindings: [{ modelKey: 'k1' }] });
  const port = narrowEnginePort(clean);
  port.registry.bindingFor('k1');
  port.validateTest({});
  assert.deepEqual(clean.forbiddenAccess, []);
});

test('fake engine: bindingFor returns a frozen binding (or null) with generation/version, and bindings can change', () => {
  const engine = createFakeEngine({ bindings: [{ modelKey: 'k1', modelVersion: 'v9', bindingGeneration: 4 }] });
  const b = engine.registry.bindingFor('k1');
  assert.ok(Object.isFrozen(b));
  assert.deepEqual([b.modelKey, b.modelVersion, b.bindingGeneration, b.placementGeneration], ['k1', 'v9', 4, 0]);
  assert.equal(engine.registry.bindingFor('nope'), null);
  engine.setBinding({ modelKey: 'k1', bindingGeneration: 5 });
  assert.equal(engine.registry.bindingFor('k1').bindingGeneration, 5);
  engine.removeBinding('k1');
  assert.equal(engine.registry.bindingFor('k1'), null);
});

test('fake engine + fake bridge: a shared journal records cross-object call order', async () => {
  const journal = createJournal();
  const engine = createFakeEngine({ journal });
  const bridge = createFakeBridge({ journal });
  const h = engine.startRun({});
  await bridge.clear();
  h.cancel('user');
  assert.deepEqual(journal, ['engine.startRun', 'bridge.clear', 'handle.cancel']);
});

// ================================================================================================
// fakeBridge
// ================================================================================================
const req = (over = {}) => ({ sides: [{ model: {}, dbId: 1 }], options: { focus: true, isolate: false, marker: true }, ...over });

test('fake bridge: auto mode resolves default outcomes derived from the request options and the prerequisite', async () => {
  const bridge = createFakeBridge();
  assert.deepEqual(await bridge.present(req()), { superseded: false, fitted: true, isolated: false, marked: true, notes: [] });
  assert.equal((await bridge.present(req({ options: { focus: false, isolate: true, marker: false } }))).isolated, true);
  bridge.setPrerequisite({ available: false, reason: 'hidden nodes' });
  assert.equal((await bridge.present(req({ options: { focus: false, isolate: true, marker: false } }))).isolated, false);
  assert.deepEqual(bridge.checkIsolationPrerequisite(), { available: false, reason: 'hidden nodes' });
  assert.deepEqual(await bridge.clear(), { isolation: 'none', markersRemoved: 0, notes: [] });
  assert.equal(bridge.calls.present.length, 3);
});

test('fake bridge: holdAll() defers every call so a test can resolve interleavings; failNext rejects', async () => {
  const bridge = createFakeBridge().holdAll();
  const p1 = bridge.present(req());
  const p2 = bridge.present(req());
  const c = bridge.clear();
  await flush();
  assert.equal(bridge.pending('present').length, 2);
  bridge.calls.present[1].resolve({ superseded: false, fitted: true, isolated: false, marked: true, notes: [] });
  bridge.calls.present[0].resolve({ superseded: true, fitted: false, isolated: false, marked: false, notes: [] });
  bridge.calls.clear[0].resolve();
  assert.equal((await p1).superseded, true);
  assert.equal((await p2).superseded, false);
  assert.equal((await c).isolation, 'none');
  bridge.autoAll();
  bridge.failNext('present', new Error('viewer refused'));
  await assert.rejects(bridge.present(req()), /viewer refused/);
});

test('fake bridge: dispose() is idempotent; every later call is a recorded non-mutating no-op returning disposed', async () => {
  const bridge = createFakeBridge();
  let left = 0;
  bridge.onModelLeft(() => { left += 1; });
  await bridge.dispose();
  await bridge.dispose();
  assert.equal(bridge.disposed, true);
  assert.equal(bridge.calls.dispose.length, 1);
  assert.equal((await bridge.present(req())).disposed, true);
  assert.equal((await bridge.clear()).disposed, true);
  assert.equal(bridge.calls.present.length, 0);
  assert.deepEqual(bridge.calls.afterDispose.map((c) => c.kind), ['dispose', 'present', 'clear']);
  bridge.emitModelLeft({ model: {}, reason: 'unload' });
  assert.equal(left, 0);
  assert.equal(bridge.modelLeftListenerCount(), 0);
});

test('fake bridge: onModelLeft subscribes/unsubscribes, listener errors are recorded not thrown, selection is a private copy', () => {
  const m = { id: 1 };
  const bridge = createFakeBridge({ selection: [{ model: m, dbIds: [3, 4] }] });
  const seen = [];
  const off = bridge.onModelLeft((e) => seen.push(e.reason));
  bridge.onModelLeft(() => { throw new Error('cb'); });
  bridge.emitModelLeft({ model: m, reason: 'removed' });
  assert.deepEqual(seen, ['removed']);
  assert.equal(bridge.listenerErrors.length, 1);
  off();
  bridge.emitModelLeft({ model: m, reason: 'unload' });
  assert.deepEqual(seen, ['removed']);
  const s = bridge.readAggregateSelection();
  s[0].dbIds.push(99);
  assert.deepEqual(bridge.readAggregateSelection(), [{ model: m, dbIds: [3, 4] }]);
  assert.throws(() => bridge.onModelLeft(null), TypeError);
});

// ================================================================================================
// fakeThree
// ================================================================================================
test('fake THREE (r71 subset): Vector3 has NO setScalar; the required classes exist; revision is 71', () => {
  const { THREE } = createFakeThree();
  assert.equal(THREE.REVISION, '71');
  assert.equal('setScalar' in new THREE.Vector3(), false);
  assert.equal(THREE.Vector3.prototype.setScalar, undefined);
  for (const name of ['Vector3', 'Mesh', 'SphereGeometry', 'MeshBasicMaterial', 'LineBasicMaterial', 'BufferGeometry', 'Line', 'Box3']) assert.equal(typeof THREE[name], 'function', name);
  assert.equal(new THREE.Vector3(1, 2, 3).set(4, 5, 6).toArray().join(), '4,5,6');
});

test('fake THREE: Mesh/Line reject non-geometry or non-material arguments; setFromPoints demands Vector3', () => {
  const { THREE } = createFakeThree();
  assert.throws(() => new THREE.Mesh({}, new THREE.MeshBasicMaterial()), TypeError);
  assert.throws(() => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), {}), TypeError);
  assert.throws(() => new THREE.Line(null, new THREE.LineBasicMaterial()), TypeError);
  assert.throws(() => new THREE.BufferGeometry().setFromPoints([[0, 0, 0]]), TypeError);
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1, 2, 3)]);
  assert.equal(g.points.length, 1);
});

test('fake THREE: dispose() is counted; live/over-disposed resources are reportable', () => {
  const { THREE, stats } = createFakeThree();
  const shared = new THREE.SphereGeometry(1, 12, 8);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65, depthTest: false, depthWrite: false });
  const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 1, 1)]);
  assert.equal(stats.liveGeometries().length, 2);
  assert.equal(stats.liveMaterials().length, 1);
  assert.deepEqual(mat.parameters, { transparent: true, opacity: 0.65, depthTest: false, depthWrite: false });
  line.dispose();
  shared.dispose();
  mat.dispose();
  assert.equal(stats.liveGeometries().length, 0);
  assert.equal(stats.overDisposed().length, 0);
  mat.dispose();
  assert.deepEqual(stats.overDisposed(), [mat]);
});

test('fake THREE: Box3 computes bounds from points', () => {
  const { THREE } = createFakeThree();
  const b = new THREE.Box3().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 4, 6)]);
  assert.equal(b.isEmpty(), false);
  assert.deepEqual(b.getCenter().toArray(), [1, 2, 3]);
  assert.deepEqual(b.getSize().toArray(), [2, 4, 6]);
  assert.equal(new THREE.Box3().isEmpty(), true);
});

// ================================================================================================
// fakeViewer
// ================================================================================================
test('fake viewer: aggregate isolation is full-replace; [] shows everything and clears hidden state; unloaded models are ignored; {ids:[]} shows the whole model', () => {
  const a = createFakeModel({ id: 1 });
  const b = createFakeModel({ id: 2 });
  const gone = createFakeModel({ id: 3 });
  const v = createFakeViewer({ models: [a, b], hiddenNodes: [{ model: a, ids: [9] }] });
  v.setAggregateIsolation([{ model: a, ids: [3, 1] }, { model: gone, ids: [7] }, { model: b, ids: [] }]);
  assert.deepEqual(v.getAggregateIsolation(), [{ model: a, ids: [3, 1] }]);
  v.setAggregateIsolation([{ model: b, ids: [5] }]);
  assert.deepEqual(v.getAggregateIsolation(), [{ model: b, ids: [5] }]);
  assert.equal(v.getAggregateHiddenNodes().length, 1);
  v.setAggregateIsolation([]);
  assert.deepEqual(v.getAggregateIsolation(), []);
  assert.deepEqual(v.getAggregateHiddenNodes(), []);
  assert.equal(v.calls.setAggregateIsolation.length, 3);
  assert.throws(() => v.setAggregateIsolation([{ ids: [1] }]), TypeError);
  assert.throws(() => v.setAggregateIsolation('x'), TypeError);
});

test('fake viewer: overlay API is MESH FIRST, scene name SECOND (a wrong order throws), missing scenes return false', () => {
  const v = createFakeViewer();
  const mesh = { name: 'm' };
  assert.equal(v.overlays.hasScene('s'), false);
  assert.equal(v.overlays.addMesh(mesh, 's'), false);
  assert.equal(v.overlays.addScene('s'), true);
  assert.equal(v.overlays.addScene('s'), false);
  assert.equal(v.overlays.addMesh(mesh, 's'), true);
  assert.deepEqual(v.overlayMeshes('s'), [mesh]);
  assert.throws(() => v.overlays.addMesh('s', mesh), TypeError);
  assert.throws(() => v.overlays.removeMesh('s', mesh), TypeError);
  assert.throws(() => v.overlays.hasScene(mesh), TypeError);
  assert.equal(v.overlays.removeMesh(mesh, 's'), true);
  assert.equal(v.overlays.removeMesh(mesh, 's'), false);
  assert.equal(v.overlays.removeScene('s'), true);
  assert.deepEqual(v.overlayScenes(), []);
});

test('AC-P19: every theming method throws exactly "theming forbidden" and is recorded; foreign theming state is untouched', () => {
  const v = createFakeViewer();
  v.seedForeignTheming([{ dbId: 5, color: 'red' }]);
  for (const name of THEMING_METHODS) assert.throws(() => v[name](1, 2, 3), (e) => e.message === 'theming forbidden', name);
  assert.deepEqual(v.themingCalls.map((c) => c.name), [...THEMING_METHODS]);
  assert.deepEqual(v.themingState(), [{ dbId: 5, color: 'red' }]);
});

test('fake viewer: impl access, selection mutators and per-model visibility methods throw and are recorded', () => {
  const v = createFakeViewer();
  assert.throws(() => v.impl, /forbidden: viewer\.impl/);
  for (const name of FORBIDDEN_VIEWER_METHODS) assert.throws(() => v[name](1), /forbidden viewer call/, name);
  assert.deepEqual(v.forbiddenCalls, ['impl', ...FORBIDDEN_VIEWER_METHODS]);
});

test('fake viewer: fitToView supports the per-model form and the aggregate form (key must be `selection`), and the aggregate form can be switched off', () => {
  const a = createFakeModel({ id: 1 });
  const v = createFakeViewer({ models: [a] });
  v.fitToView([1, 2], a, true);
  v.fitToView([{ model: a, selection: [1] }], true);
  assert.deepEqual(v.calls.fitToView.map((c) => c.form), ['ids', 'aggregate']);
  assert.throws(() => v.fitToView([{ model: a, ids: [1] }], true), TypeError);
  assert.throws(() => v.fitToView('x', a), TypeError);
  v.aggregateFit = false;
  assert.throws(() => v.fitToView([{ model: a, selection: [1] }]), /aggregate form is not supported/);
});

test('fake viewer: failNext throws BEFORE the effect by default and AFTER it with afterEffect (the ambiguous-throw case)', () => {
  const a = createFakeModel({ id: 1 });
  const v = createFakeViewer({ models: [a] });
  v.failNext('setAggregateIsolation', { error: new Error('before') });
  assert.throws(() => v.setAggregateIsolation([{ model: a, ids: [1] }]), /before/);
  assert.deepEqual(v.getAggregateIsolation(), []);
  v.failNext('setAggregateIsolation', { error: new Error('after'), afterEffect: true });
  assert.throws(() => v.setAggregateIsolation([{ model: a, ids: [1] }]), /after/);
  assert.deepEqual(v.getAggregateIsolation(), [{ model: a, ids: [1] }]);
  assert.equal(v.injectionsRemaining(), 0);
  v.failNext('addScene', { times: 2 });
  assert.equal(v.injectionsRemaining(), 2);
  assert.throws(() => v.overlays.addScene('s'));
  assert.equal(v.overlays.hasScene('s'), false);
});

test('fake viewer: events add/remove/dispatch with `{model}` payloads and a listener log', () => {
  const v = createFakeViewer();
  const seen = [];
  const fn = (e) => seen.push(e);
  v.addEventListener(FAKE_EVENTS.BEFORE_MODEL_UNLOAD, fn);
  v.addEventListener(FAKE_EVENTS.MODEL_REMOVED, fn);
  const m = { id: 1 };
  v.dispatch(FAKE_EVENTS.BEFORE_MODEL_UNLOAD, { model: m });
  assert.deepEqual(seen, [{ type: FAKE_EVENTS.BEFORE_MODEL_UNLOAD, model: m }]);
  assert.equal(v.listenerCount(), 2);
  v.removeEventListener(FAKE_EVENTS.BEFORE_MODEL_UNLOAD, fn);
  assert.equal(v.listenerCount(FAKE_EVENTS.BEFORE_MODEL_UNLOAD), 0);
  assert.deepEqual(v.listenerLog.map((l) => l.op), ['add', 'add', 'remove']);
});

test('fake model: getObjectTree().getNodeName answers names, getInstanceTree() is tracked as deprecated, a model without a tree returns null', () => {
  const m = createFakeModel({ names: { 5: 'Wall-5' }, boxes: { 5: [0, 0, 0, 1, 2, 3] } });
  assert.equal(m.getObjectTree().getNodeName(5), 'Wall-5');
  assert.equal(m.getObjectTree().getNodeName(6), null);
  const out = new Float32Array(6);
  m.getObjectTree().getNodeBox(5, out);
  assert.deepEqual([...out], [0, 0, 0, 1, 2, 3]);
  m.getInstanceTree();
  assert.equal(m.deprecatedInstanceTreeCalls, 1);
  assert.equal(createFakeModel({ hasObjectTree: false }).getObjectTree(), null);
});

test('fake viewer api: delegates to the fake viewer, returns bounds only when the model has them, and exposes hasAggregateFit', () => {
  const a = createFakeModel({ id: 1, boxes: { 5: [0, 0, 0, 1, 1, 1] } });
  const v = createFakeViewer({ models: [a], selection: [{ model: a, selection: [5] }] });
  const api = createFakeViewerApi(v);
  assert.deepEqual(api.getAggregateSelection(), [{ model: a, selection: [5] }]);
  assert.deepEqual(api.getElementWorldBounds(a, 5), [0, 0, 0, 1, 1, 1]);
  assert.equal(api.getElementWorldBounds(a, 6), null);
  a.setBoundsMode('null');
  assert.equal(api.getElementWorldBounds(a, 5), null);
  a.setBoundsMode('throw');
  assert.throws(() => api.getElementWorldBounds(a, 5));
  assert.equal(api.hasAggregateFit(), true);
  v.aggregateFit = false;
  assert.equal(api.hasAggregateFit(), false);
  api.overlays.addScene('s');
  assert.equal(api.overlays.hasScene('s'), true);
  api.setAggregateIsolation([{ model: a, ids: [5] }]);
  assert.deepEqual(api.getAggregateIsolation(), [{ model: a, ids: [5] }]);
  assert.equal(api.getAllModels()[0], a);
});

// ================================================================================================
// resultFixtures
// ================================================================================================
test('fixtures: hardSet builds a deep-frozen sealed set with the real top-level keys, canonical pair order and JSON-string resultIds', () => {
  const set = hardSet(3, { unlocated: [1] });
  assert.deepEqual(Object.keys(set).sort(), [
    'definition', 'derivedFromRunId', 'diagnostics', 'digests', 'ledger', 'outcome', 'provenance', 'results', 'runId', 'schemaVersion', 'sealed', 'statistics', 'testRef',
  ]);
  assert.ok(Object.isFrozen(set) && Object.isFrozen(set.results[0].pair.first) && Object.isFrozen(set.provenance.models[0]));
  assert.throws(() => { set.results[0].flags.x = 1; }, TypeError);
  assert.equal(set.results.length, 3);
  for (const r of set.results) {
    assert.ok(r.pair.first.modelKey <= r.pair.second.modelKey);
    assert.deepEqual(JSON.parse(r.resultId).slice(2), [r.pair.first.modelKey, r.pair.first.dbId, r.pair.second.modelKey, r.pair.second.dbId]);
  }
  assert.equal(new Set(set.results.map((r) => r.resultId)).size, 3);
  assert.deepEqual(set.results[1].flags, { witnessUnavailable: true });
  assert.equal(set.results[1].evidence.witness, null);
  assert.deepEqual(set.results[0].flags, {});
  assert.deepEqual(set.results[0].evidence.witness.point, [0, 1, 2]);
  assert.equal(set.outcome.status, 'completed');
  assert.equal(set.provenance.runOptions.maxResultsPerRun, 100000);
});

test('fixtures: hardResult orders the pair canonically whichever way it is given and never shares object references', () => {
  const x = { modelKey: MODEL_B, dbId: 1 };
  const y = { modelKey: MODEL_A, dbId: 9 };
  const r = hardResult(x, y);
  assert.deepEqual(r.pair.first, { modelKey: MODEL_A, dbId: 9 });
  assert.notEqual(r.evaluatedAs.source, r.pair.first);
  assert.equal(hardResult(y, x).resultId, r.resultId);
});

test('fixtures: softSet carries real clearance evidence (distance, clearance, closestPoints) and the definition clearance', () => {
  const set = softSet([0.01, 0.2], { clearance: 0.5 });
  assert.equal(set.definition.mode, 'clearance');
  assert.equal(set.definition.clearance, 0.5);
  assert.deepEqual(set.results.map((r) => r.evidence.distance), [0.01, 0.2]);
  assert.deepEqual(Object.keys(set.results[0].evidence).sort(), ['clearance', 'closestPoints', 'distance']);
  assert.ok(set.results.every((r) => r.mode === 'clearance' && r.evidence.clearance === 0.5));
  assert.equal(softResult({ modelKey: MODEL_A, dbId: 1 }, { modelKey: MODEL_B, dbId: 2 }, { distance: 1 }).evidence.distance, 1);
});

test('fixtures: emptyCompletedClean / partialSet / failedSet produce the outcome, ledger and reasons the report tasks need', () => {
  const clean = emptyCompletedClean();
  assert.equal(clean.results.length, 0);
  assert.deepEqual([clean.outcome.status, clean.outcome.coverage, clean.outcome.integrity, clean.outcome.freshness], ['completed', 'full', 'clean', 'current']);
  const partial = partialSet(2);
  assert.equal(partial.outcome.coverage, 'partial');
  assert.equal(partial.ledger.units[1].outcome, 'failed');
  const capped = failedSet({ reasons: ['result-cap'], resultCount: 2, maxResultsPerRun: 2 });
  assert.deepEqual([capped.outcome.status, capped.outcome.reasons, capped.results.length, capped.provenance.runOptions.maxResultsPerRun], ['failed', ['result-cap'], 2, 2]);
  const planning = failedSet({ planningGaps: [{ phase: 'planning', cause: 'enumeration-failed' }], provenanceModels: [], definition: null });
  assert.equal(planning.definition, null);
  assert.deepEqual(planning.testRef, { testId: 'T-1', revision: null, semanticDigest: null });
  assert.deepEqual(planning.provenance.models, []);
  assert.deepEqual(planning.ledger.planningGaps, [{ phase: 'planning', cause: 'enumeration-failed' }]);
});

test('fixtures: provenance models carry bindingGeneration / modelVersion overrides for resolver tests', () => {
  const set = makeSealedSet({ provenanceModels: [{ modelKey: MODEL_A, bindingGeneration: 3, modelVersion: 'v7' }, { modelKey: MODEL_B }] });
  assert.deepEqual(set.provenance.models.map((m) => [m.modelKey, m.modelVersion, m.bindingGeneration]), [[MODEL_A, 'v7', 3], [MODEL_B, 'v1', 0]]);
});

test('fixtures: manyResults(n) yields n distinct, canonically ordered results cheaply', () => {
  const rs = manyResults(5000);
  assert.equal(rs.length, 5000);
  assert.equal(new Set(rs.map((r) => r.resultId)).size, 5000);
  for (let i = 1; i < rs.length; i += 1) assert.ok(rs[i - 1].pair.first.dbId < rs[i].pair.first.dbId);
  assert.equal(makeSealedSet({ results: rs }).results.length, 5000);
});

test('fixtures: elementGroupsFor / caveatedFilterFor / summaryFor agree with the REAL derivation context on hand-built sets', async () => {
  const ctx = createDerivationContext();
  for (const set of [hardSet(3, { unlocated: [1] }), softSet(), partialSet(2), emptyCompletedClean()]) {
    assert.deepEqual(await ctx.groupBy(set, ['element']), elementGroupsFor(set));
    assert.deepEqual(await ctx.filter(set, [{ facet: 'caveated', op: 'eq', value: true }]), caveatedFilterFor(set));
    const real = await ctx.summarize(set);
    const mine = summaryFor(set);
    for (const key of Object.keys(mine)) assert.deepEqual(mine[key], real[key], key);
  }
});

test('fixtures: createDeferred and deepFreeze behave', async () => {
  const d = createDeferred();
  d.resolve(5);
  assert.equal(await d.promise, 5);
  const o = deepFreeze({ a: { b: [1, { c: 2 }] } });
  assert.throws(() => { o.a.b[1].c = 3; }, TypeError);
});
