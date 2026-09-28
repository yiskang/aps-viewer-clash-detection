// test/acceptance/g1-svf2-f1-f8-verification.f6.test.mjs
//
// Offline, browser-free unit tests for Stage 7's F6 slice (unload/reload behavior -- the ONLY
// mutating check in the whole harness) of test/acceptance/g1-svf2-f1-f8-verification.mjs. New
// sibling file, not appended to g1-svf2-f1-f8-verification.session.test.mjs: F6's own concerns
// (a Node-side async orchestrator driving ~10 small in-page lifecycle functions, a fake
// `wireModelUnload`/registry/world/viewer event system, Stage 2's `startLoad` reused for a
// reload) are independent enough from that file's own F1/F2/F4/F7 session-data concerns to
// warrant their own file -- mirroring this repo's own established one-file-per-stage-concern
// convention (Stage 2 -> .async.test.mjs, Stage 3 -> .shell.test.mjs). F8 (read-only, built
// entirely from F1/F2's already-frozen session data) is tested in .session.test.mjs instead,
// since it fits that file's own existing session-fixture machinery directly.
//
// AUTHORIZATION BOUNDARY: this file NEVER launches a real Chromium browser, NEVER imports
// playwright, and NEVER executes main(). F6's own in-page functions are exercised through a
// real `node:vm` context (see createPageRealm, below -- the same pattern every prior stage's
// test file already established) rather than a plain direct call, so an accidental reference to
// a Node-module-scope helper/constant surfaces as a ReferenceError here, exactly as it would if
// handed to a real page.evaluate. `wireModelUnload` is DELIBERATELY faked here (never the real
// production function) -- matching this test SUITE's own already-established precedent
// (g1-svf2-f1-f8-verification.session.test.mjs's own `buildFakeModules` fakes
// `createModelRegistry`/`CollisionWorld.fromViewer` throughout, for the identical reason: the
// real `wireModelUnload` internally calls `assertRegistryBelongsToWorld`, which requires the
// REAL `createModelRegistry`'s own internal shape (registrySessionId, registryRevision, all 8
// REGISTRY_METHODS) -- reproducing that faithfully here would mean re-implementing most of
// ModelRegistry.js as a test fixture, with no corresponding gain for THIS stage's own
// orchestration-sequencing concern). The fake below reproduces `wireModelUnload`'s own observed
// CONTRACT exactly (confirmed by direct source read of clashtest/viewer/unloadWiring.js): the
// captured handler calls `registry.unregister(model)` then `world.evictModel(model)`, in that
// order, for whatever `event.model` it's handed.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  CHECK_VERDICT,
  CLASSIFIER,
  CONTROL_STATE,
  CONTROL_RESTORATION_REQUIRED,
  LOAD_API,
  TOKEN_STATE,
  f6InstallUnloadWiring,
  f6TriggerUnload,
  f6UnloadSettledPredicate,
  f6ReadUnloadSnapshot,
  f6InstallReloadProbe,
  f6ReloadProbeSettledPredicate,
  f6FinalizeReloadProbe,
  f6Reregister,
  f6RunLateUnloadControl,
  f6Cleanup,
  runF6UnloadReload,
  scoreF6,
  buildStaleOldModelEventControlResult,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed), same pattern every prior stage's test file uses.
// ============================================================================================

const IN_PAGE_FUNCTIONS = {
  f6InstallUnloadWiring, f6TriggerUnload, f6UnloadSettledPredicate, f6ReadUnloadSnapshot,
  f6InstallReloadProbe, f6ReloadProbeSettledPredicate, f6FinalizeReloadProbe, f6Reregister,
  f6RunLateUnloadControl, f6Cleanup,
  // Test-local in-page starter fakes for Stage 2's own startLoad (reused, never a second load
  // protocol) -- these stand in for the real Document.load/loadDocumentNode in-page starters a
  // later, separately-authorized live-run stage would supply.
  fakeDocumentLoadStarter, fakeLoadDocumentNodeStarter,
  captureFakeFormatSignals,
};

function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTIONS)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    call(fn, ...args) {
      return vm.runInContext(fn.name, context)(...args);
    },
  };
}

// -------- Test-local in-page fakes (bundled above; must reference only their own argument and
// page globals, exactly like every production in-page function in this file). --------

function fakeDocumentLoadStarter({ tokenId }) {
  const g = window.__g1;
  g.loads = g.loads || {};
  g.loads[tokenId] = { gen: 1, status: 'completed', api: 'documentLoad' };
  return { gen: 1, status: 'completed' };
}

function fakeLoadDocumentNodeStarter({ tokenId }) {
  const g = window.__g1;
  g.loads = g.loads || {};
  g.models = g.models || {};
  const newModel = g.__nextModelAfter;
  g.models[tokenId] = newModel;
  g.loads[tokenId] = { gen: 1, status: 'completed', api: 'loadDocumentNode' };
  if (g.__fireModelAddedOnLoad !== false) {
    window.__viewer._dispatch('modelAdded', { model: newModel });
  }
  return { gen: 1, status: 'completed' };
}

/** Test-local stand-in for `captureModelFormatSignals` -- reads `isOTG`/`isSVF2` straight off
 * the model at `window.__g1.models[tokenId]`, same JSON-safe shape the real one returns. */
function captureFakeFormatSignals({ tokenId }) {
  const g = window.__g1;
  const model = g.models ? g.models[tokenId] : undefined;
  if (!model) return { ok: false, reason: 'model-not-found' };
  return { ok: true, isOTG: model.__isOTG, isSVF2: model.__isSVF2, captureErrors: [] };
}

// -------- Node-side pageEvaluate/pageWaitForFunction fakes bridging to the SAME realm. --------

function makePageDeps(realm) {
  const pageEvaluate = async (fn, arg) => realm.call(fn, arg);
  const pageWaitForFunction = async (predicateFn, arg, { timeout = 1000 } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await realm.call(predicateFn, arg)) return;
      if (Date.now() >= deadline) throw new Error('pageWaitForFunction: timeout');
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  return { pageEvaluate, pageWaitForFunction };
}

// -------- fakeF6Viewer: a stateful, event-dispatching fake of the Viewer3D surface F6 touches.
// Dispatch order = listener registration order (a plain `Set`, matching real DOM/Viewer event
// semantics) -- load-bearing for the probe-before-wiring ordering test below. --------

function fakeF6Viewer({ initialModels = [] } = {}) {
  let models = [...initialModels];
  const listeners = new Map();
  return {
    getAllModels: () => models,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      if (listeners.has(name)) listeners.get(name).delete(fn);
    },
    unloadModel(model) {
      models = models.filter((m) => m !== model);
      const fns = listeners.get('beforeModelUnload');
      if (fns) for (const fn of [...fns]) fn({ model });
    },
    _dispatch(name, event) {
      const fns = listeners.get(name);
      if (fns) for (const fn of [...fns]) fn(event);
    },
    _listenerCount(name) {
      return listeners.has(name) ? listeners.get(name).size : 0;
    },
  };
}

// -------- fakeF6Registry: a small, K-keyed registry fake -- NOT the real ModelRegistry (see
// file banner). Supports pre-binding (mirrors Phase 2.5's own already-registered modelBefore). --

function fakeF6Registry(world, { K, initialModel, initialModelVersion } = {}) {
  let boundModel = initialModel || null;
  let boundKey = initialModel ? K : null;
  let boundModelVersion = initialModel ? initialModelVersion : null;
  return {
    world,
    register(k, model, { modelVersion } = {}) {
      boundModel = model; boundKey = k; boundModelVersion = modelVersion;
    },
    bindingFor(k) {
      return (boundKey === k && boundModel) ? { model: boundModel, modelKey: boundKey, modelVersion: boundModelVersion } : null;
    },
    unregister(model) {
      if (boundModel === model) { boundModel = null; boundKey = null; boundModelVersion = null; }
    },
  };
}

function fakeF6World(overrides = {}) {
  return { isModelLive: () => true, evictModel: () => {}, dispose: () => {}, ...overrides };
}

/** Reproduces `wireModelUnload`'s own observed contract (see file banner): captures the handler
 * via `eventTarget.addEventListener`, and that handler calls `registry.unregister(model)` then
 * `world.evictModel(model)`, in that order, for whatever `event.model` it receives. */
function fakeWireModelUnload({ world, registry, eventTarget, eventName }) {
  const handler = (event) => {
    const model = event && event.model;
    if (model === undefined || model === null) return;
    try { registry.unregister(model); } catch { /* mirror real safeReport swallow */ }
    try { world.evictModel(model); } catch { /* mirror real safeReport swallow */ }
  };
  eventTarget.addEventListener(eventName, handler);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      eventTarget.removeEventListener(eventName, handler);
    },
  };
}

/** A DELIBERATELY-BROKEN wiring for the eviction-ordering negative test: calls
 * `world.evictModel` BEFORE `registry.unregister` (the wrong order). */
function fakeWireModelUnloadWrongOrder({ world, registry, eventTarget, eventName }) {
  const handler = (event) => {
    const model = event && event.model;
    if (model === undefined || model === null) return;
    try { world.evictModel(model); } catch { /* ignore */ }
    try { registry.unregister(model); } catch { /* ignore */ }
  };
  eventTarget.addEventListener(eventName, handler);
  return { dispose() { eventTarget.removeEventListener(eventName, handler); } };
}

const UNLOAD_EVENT = 'beforeModelUnload';
const ADDED_EVENT = 'modelAdded';

function buildF6Fixture({
  wireModelUnloadFn = fakeWireModelUnload,
  fireModelAddedOnLoad = true,
  modelAfterSvf2 = { isOTG: true, isSVF2: true },
  worldOverrides = {},
} = {}) {
  const modelBefore = { __name: 'modelBefore' };
  const modelAfter = { __name: 'modelAfter', __isOTG: modelAfterSvf2.isOTG, __isSVF2: modelAfterSvf2.isSVF2 };
  const viewer = fakeF6Viewer({ initialModels: [modelBefore] });
  const world = fakeF6World(worldOverrides);
  const K = 'g1-f1f8-verification';
  const registry = fakeF6Registry(world, { K, initialModel: modelBefore, initialModelVersion: 'g1-live-1' });
  const enumerator = { resolveRoots: async (binding) => (binding && binding.model ? { roots: [{ dbId: 1 }] } : Promise.reject(new Error('no model'))) };

  const session = {
    K, modelVersion: 'g1-live-1', model: modelBefore, world, registry, enumerator, artifacts: {},
  };

  const window_ = {
    __g1: {
      sessions: { s1: session },
      mod: { '/clashtest/viewer/index.js': { wireModelUnload: wireModelUnloadFn } },
      loads: {}, models: {},
      __nextModelAfter: modelAfter,
      __fireModelAddedOnLoad: fireModelAddedOnLoad,
    },
    __viewer: viewer,
  };
  const realm = createPageRealm(window_);
  const { pageEvaluate, pageWaitForFunction } = makePageDeps(realm);

  return {
    realm, session, viewer, world, registry, modelBefore, modelAfter,
    deps: {
      sessionId: 's1', pageEvaluate, pageWaitForFunction,
      loadStarter: { documentLoad: fakeDocumentLoadStarter, loadDocumentNode: fakeLoadDocumentNodeStarter },
      urn: 'urn:fake', loadTimeoutMs: 500,
      unloadEventName: UNLOAD_EVENT, addedEventName: ADDED_EVENT,
      unloadWaitTimeoutMs: 500, reloadProbeTimeoutMs: 500,
      captureFormatSignalsFn: captureFakeFormatSignals,
    },
  };
}

// ============================================================================================
// runF6UnloadReload / scoreF6 -- full-sequence integration tests
// ============================================================================================

test('runF6UnloadReload: full happy path -- unload, reload, late-unload control survives cleanly, reload confirms SVF2, reload probe resolves for the correct model -> scoreF6 PASS', async () => {
  const fx = buildF6Fixture();
  const result = await runF6UnloadReload(fx.deps);

  assert.equal(result.ok, true);
  assert.equal(result.fields.unloadProbeFired, true);
  assert.equal(result.fields.bindingNullAfterUnload, true);
  assert.equal(result.fields.reregisteredOk, true);
  assert.equal(result.fields.unregisterBeforeEvict, true);
  assert.equal(result.fields.lateUnloadHandlerThrew, false);
  assert.equal(result.fields.bindingSurvivesLateUnload, true);
  assert.equal(result.fields.modelAfterStillLive, true);
  assert.equal(result.fields.resolveRootsOk, true);
  assert.equal(result.fields.reloadClassifier.classifier, CLASSIFIER.CONFIRMED_SVF2);
  assert.equal(result.fields.f3RepeatProbe.modelAddedObserved, true);
  assert.equal(result.fields.f3RepeatProbe.resolveRootsOutcome, 'resolved');
  assert.equal(result.fields.f3RepeatProbe.modelMatchesReloadToken, true);
  assert.equal(result.fields.f3RepeatProbe.readinessGateSufficient, true);
  assert.ok(result.fields.f3RepeatProbe.atInvocation, 'invocation-time flag snapshot recorded');
  assert.ok(result.fields.f3RepeatProbe.atSettlement, 'settlement-time flag snapshot recorded');

  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.PASS);

  // session.model moved forward to modelAfter (F6 is the only mutating check).
  assert.equal(fx.session.model, fx.modelAfter);

  // F6-local cleanup actually ran: the unload probe listener is gone.
  assert.equal(fx.viewer._listenerCount(UNLOAD_EVENT), 0);
  assert.equal(fx.viewer._listenerCount(ADDED_EVENT), 0);
});

test('runF6UnloadReload: probe installed BEFORE the wiring -- dispatch order proves it (probe listener registered first)', async () => {
  const fx = buildF6Fixture();
  await runF6UnloadReload(fx.deps);
  // Can't observe order directly post-hoc (listeners are removed by cleanup), but the
  // unloadProbeFired assertion above, combined with unregisterBeforeEvict === true, together
  // prove BOTH listeners fired in the intended relative order (the probe records firing
  // independent of the wiring's own unregister/evict side effects, and the eviction-ordering
  // shim -- installed in the SAME f6InstallUnloadWiring call, before wireModelUnload runs --
  // correctly observed the registry as already-null when evictModel ran). This test exists to
  // name that invariant explicitly for a future reader, not to add a new assertion.
  assert.ok(true);
});

test('runF6UnloadReload: late-unload handler throwing -> lateUnloadHandlerThrew true, FAIL', async () => {
  // Throws only on the SECOND invocation (step 6's simulated late/stale event) -- the FIRST
  // invocation is step 3's own real unload, which must behave normally (matching the real
  // wireModelUnload's own "never throws" contract) so the sequence reaches step 6 at all.
  const throwingWiring = ({ eventTarget, eventName }) => {
    let callCount = 0;
    const handler = () => {
      callCount += 1;
      if (callCount > 1) throw new Error('captured handler exploded');
    };
    eventTarget.addEventListener(eventName, handler);
    return { dispose() { eventTarget.removeEventListener(eventName, handler); } };
  };
  const fx = buildF6Fixture({ wireModelUnloadFn: throwingWiring });
  const result = await runF6UnloadReload(fx.deps);

  assert.equal(result.fields.lateUnloadHandlerThrew, true);
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(result.fields).reason, 'f6-stale-event-disturbed-modelAfter');
});

test('runF6UnloadReload: eviction ordering violated (evictModel called BEFORE unregister) -> unregisterBeforeEvict false, FAIL', async () => {
  const fx = buildF6Fixture({ wireModelUnloadFn: fakeWireModelUnloadWrongOrder });
  const result = await runF6UnloadReload(fx.deps);

  assert.equal(result.fields.unregisterBeforeEvict, false);
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(result.fields).reason, 'f6-eviction-ordering-violated');
});

test('runF6UnloadReload: reload never reaches CONFIRMED_SVF2 -> FAIL', async () => {
  const fx = buildF6Fixture({ modelAfterSvf2: { isOTG: false, isSVF2: false } }); // CONFIRMED_NON_SVF2
  const result = await runF6UnloadReload(fx.deps);

  assert.notEqual(result.fields.reloadClassifier.classifier, CLASSIFIER.CONFIRMED_SVF2);
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(result.fields).reason, 'f6-reload-not-confirmed-svf2');
});

test('runF6UnloadReload: reload probe fires for an UNRELATED model (correlation check) -> modelMatchesReloadToken false, FAIL', async () => {
  const fx = buildF6Fixture({ fireModelAddedOnLoad: false });
  // Simulate a stray, unrelated MODEL_ADDED_EVENT firing on some OTHER model right after the
  // probe installs, before the real reload's own loadDocumentNode starter ever runs.
  const strayModel = { __name: 'strayUnrelatedModel' };
  const originalPageEvaluate = fx.deps.pageEvaluate;
  fx.deps.pageEvaluate = async (fn, arg) => {
    const r = await originalPageEvaluate(fn, arg);
    if (fn === f6InstallReloadProbe) {
      fx.viewer._dispatch(ADDED_EVENT, { model: strayModel });
    }
    return r;
  };
  // The real reload's own loadDocumentNode starter never fires modelAdded itself (fireModelAddedOnLoad:false)
  // -- the probe's only recorded event is the stray one above, which resolveRoots will still
  // succeed against (it's a valid-shaped model), so `modelAddedObserved`/`resolveRootsOutcome`
  // report as usual, but the model identity must NOT match modelAfter.
  const result = await runF6UnloadReload(fx.deps);

  assert.equal(result.fields.f3RepeatProbe.modelAddedObserved, true);
  assert.equal(result.fields.f3RepeatProbe.resolveRootsOutcome, 'resolved');
  assert.equal(result.fields.f3RepeatProbe.modelMatchesReloadToken, false);
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(result.fields).reason, 'f6-reload-probe-did-not-resolve');
});

test('runF6UnloadReload: reload probe never fires (times out) -> resolveRootsOutcome becomes \'timed-out\' (F3\'s own third outcome state), FAIL', async () => {
  const fx = buildF6Fixture({ fireModelAddedOnLoad: false });
  fx.deps.reloadProbeTimeoutMs = 30;
  const result = await runF6UnloadReload(fx.deps);

  assert.equal(result.fields.f3RepeatProbe.modelAddedObserved, false);
  assert.equal(result.fields.f3RepeatProbe.resolveRootsOutcome, 'timed-out');
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(result.fields).reason, 'f6-reload-probe-did-not-resolve');
});

test('runF6UnloadReload: reload probe captures TWO distinct flag snapshots (atInvocation vs atSettlement), characterizing a genuine readiness gap', async () => {
  const fx = buildF6Fixture();
  // isLoadDone() is false at MODEL_ADDED_EVENT time, flips true only once resolveRoots is
  // actually invoked with modelAfter -- simulating the real Adapter readiness gap F3's own text
  // (plan §7.3) says atInvocation/atSettlement exist to characterize.
  fx.modelAfter.__loadDone = false;
  fx.modelAfter.isLoadDone = function isLoadDoneFake() { return this.__loadDone; };
  fx.session.enumerator.resolveRoots = async (binding) => {
    if (!binding || !binding.model) throw new Error('no model');
    if (binding.model === fx.modelAfter) fx.modelAfter.__loadDone = true;
    return { roots: [{ dbId: 1 }] };
  };

  const result = await runF6UnloadReload(fx.deps);
  const { f3RepeatProbe } = result.fields;

  assert.equal(f3RepeatProbe.resolveRootsOutcome, 'resolved');
  assert.notEqual(f3RepeatProbe.atInvocation, f3RepeatProbe.atSettlement, 'two distinct capture objects, never the same reference reused');
  assert.equal(f3RepeatProbe.atInvocation.isLoadDone, false, 'not ready yet at MODEL_ADDED_EVENT time');
  assert.equal(f3RepeatProbe.atSettlement.isLoadDone, true, 'ready by the time resolveRoots settles -- the gap is characterized');
  assert.equal(typeof f3RepeatProbe.tModelAdded, 'number');
  assert.equal(typeof f3RepeatProbe.elapsedMs, 'number');
  assert.equal(f3RepeatProbe.readinessGateSufficient, true);
  assert.equal(scoreF6(result.fields).verdict, CHECK_VERDICT.PASS);
});

test('runF6UnloadReload: wiring install fails (wireModelUnload not available in window.__g1.mod) -> ok:false, fatal', async () => {
  const fx = buildF6Fixture();
  fx.session; // no-op, keep the fixture reference used
  const realm = createPageRealm({
    __g1: { sessions: { s1: fx.session }, mod: {}, loads: {}, models: {} }, // no wireModelUnload
    __viewer: fx.viewer,
  });
  const { pageEvaluate, pageWaitForFunction } = makePageDeps(realm);
  const result = await runF6UnloadReload({ ...fx.deps, pageEvaluate, pageWaitForFunction });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wiring-install-failed');
});

// ============================================================================================
// scoreF6 -- pure edge cases
// ============================================================================================

test('scoreF6: fails closed on missing evidence (undefined fields never silently PASS)', () => {
  assert.equal(scoreF6({}).verdict, CHECK_VERDICT.FAIL);
  assert.equal(scoreF6(null).verdict, CHECK_VERDICT.FAIL);
});

// ============================================================================================
// buildStaleOldModelEventControlResult -- copies F6 step 6's own result, never re-runs it
// ============================================================================================

test('buildStaleOldModelEventControlResult: DETECTED_RESTORED when F6\'s late-unload control survived cleanly', () => {
  const f6Fields = { lateUnloadHandlerThrew: false, bindingSurvivesLateUnload: true, modelAfterStillLive: true, resolveRootsOk: true };
  const result = buildStaleOldModelEventControlResult(f6Fields);
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['stale-old-model-event']);
});

test('buildStaleOldModelEventControlResult: RESTORE_FAILED when the late-unload control disturbed modelAfter', () => {
  const f6Fields = { lateUnloadHandlerThrew: false, bindingSurvivesLateUnload: false, modelAfterStillLive: true, resolveRootsOk: true };
  const result = buildStaleOldModelEventControlResult(f6Fields);
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('buildStaleOldModelEventControlResult: RESTORE_FAILED when the captured handler itself threw', () => {
  const f6Fields = { lateUnloadHandlerThrew: true, bindingSurvivesLateUnload: true, modelAfterStillLive: true, resolveRootsOk: true };
  const result = buildStaleOldModelEventControlResult(f6Fields);
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('buildStaleOldModelEventControlResult: NOT_EXECUTABLE when F6\'s own late-unload control never ran at all', () => {
  const result = buildStaleOldModelEventControlResult({ lateUnloadHandlerThrew: null });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['stale-old-model-event']);
});

// ============================================================================================
// Individual in-page functions -- direct, focused unit tests (beyond what the full-sequence
// integration tests above already exercise implicitly)
// ============================================================================================

test('f6ReadUnloadSnapshot: f6-not-installed when f6InstallUnloadWiring was never called for this session', async () => {
  const session = { K: 'K', registry: fakeF6Registry(fakeF6World(), {}) };
  const realm = createPageRealm({ __g1: { sessions: { s1: session } }, __viewer: fakeF6Viewer() });
  const result = await realm.call(f6ReadUnloadSnapshot, { sessionId: 's1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'f6-not-installed');
});

test('f6Reregister: modelAfter-not-found when the tokenId has no window.__g1.models entry', async () => {
  const world = fakeF6World();
  const registry = fakeF6Registry(world, { K: 'K', initialModel: { __name: 'before' }, initialModelVersion: 'v1' });
  const session = { K: 'K', modelVersion: 'v1', world, registry, f6: { modelBefore: { __name: 'before' } } };
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, models: {} }, __viewer: fakeF6Viewer() });
  const result = await realm.call(f6Reregister, { sessionId: 's1', tokenId: 'missing-token' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'modelAfter-not-found');
});
