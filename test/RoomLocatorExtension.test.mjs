// test/RoomLocatorExtension.test.mjs
//
// Fixtures ported from the Task 21 brief's Step 1, restricted to this task's scope: room-dbId cache
// mechanics, admit-before-search, resurrection races, and unload ordering. No live Viewer needed
// (Task 22 owns the live acceptance test).
//
// Import-path correction vs. the brief's own literal snippet (batch4-reconciliation-notes.md item 0):
// `collision/` lives at the repo root, a SIBLING of `wwwroot/`, not nested inside it — every landed
// collision test imports `../collision/...`, never `../wwwroot/collision/...`.
import { RoomLocatorExtension } from '../wwwroot/extensions/RoomLocatorExtension.js';
// Error classes come from the library's single public entry point (collision/index.js re-exports
// them), matching the import contract that module's own header states.
import { WorldDisposedError, ModelEvictedError } from '../collision/index.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}
async function checkRejects(name, promise, ErrorClass, note = '') {
  try { await promise; check(name, 'resolved', ErrorClass.name, note); }
  catch (err) { check(name, err instanceof ErrorClass ? err.constructor.name : `${err?.constructor?.name}: ${err?.message}`, ErrorClass.name, note); }
}

// A fake CollisionWorld exposing ONLY the public surface RoomLocatorExtension may touch, with fully
// controllable admitModel/isLeaseValid/evictModel/dispose semantics matching the real contract
// (this plan's Global Constraints ModelLease/ModelLifecycleEntry shapes) so every race fixture below is
// deterministic without a real Viewer.
function makeFakeWorld() {
  const modelLifecycle = new Map();
  let nextEpoch = 1;
  let disposed = false;
  return {
    _modelLifecycle: modelLifecycle,
    admitModel(model) {
      if (disposed) throw new WorldDisposedError();
      const existing = modelLifecycle.get(model);
      if (existing?.state === 'evicted') throw new ModelEvictedError(model.id);
      if (existing?.state === 'live') return { model, epoch: existing.epoch };
      const epoch = nextEpoch++;
      modelLifecycle.set(model, { state: 'live', epoch });
      return { model, epoch };
    },
    isLeaseValid(lease) {
      if (disposed) return false;
      const entry = modelLifecycle.get(lease.model);
      return entry?.state === 'live' && entry.epoch === lease.epoch;
    },
    isModelLive(model) {
      if (disposed) throw new WorldDisposedError();
      return modelLifecycle.get(model)?.state === 'live';
    },
    evictModel(model) {
      if (disposed) return;
      modelLifecycle.set(model, { state: 'evicted' });
    },
    dispose() { disposed = true; },
    findClashes: async () => ({ pairs: [], statistics: { diagnostics: [] } }),
    _setDisposed(v) { disposed = v; },
  };
}

function makeMockViewer() {
  return {
    addEventListener() {}, removeEventListener() {},
    registerContextMenuCallback() {}, unregisterContextMenuCallback() {},
  };
}

function makeMockModel(id) { return { id, search() { throw new Error('override in test'); } }; }

async function extensionWithFakeWorld() {
  const ext = new RoomLocatorExtension(makeMockViewer(), {});
  const world = makeFakeWorld();
  ext._world = world; // test seam: bypass fromViewer/load() to inject a controllable fake world
  return { ext, world };
}

// === first-ever room search must succeed (round 13 regression) ============
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(1);
  ext._currentModel = model;
  let searchCalls = 0;
  model.search = (text, onSuccess) => { searchCalls++; onSuccess([100, 101]); };
  const dbIds = await ext._resolveRoomDbIds(model);
  check('first-ever room search succeeds (no prior lifecycle entry)', dbIds.length, 2);
  check('first-ever room search: admit-then-validate-lease, not have-I-seen-this liveness', searchCalls, 1);
}

// === room-search promise rejects, second call triggers fresh search =======
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(2);
  ext._currentModel = model;
  let searchCalls = 0;
  model.search = (text, onSuccess, onError) => {
    searchCalls++;
    if (searchCalls === 1) onError(new Error('search failed'));
    else onSuccess([200]);
  };
  await checkRejects('first search rejects', ext._resolveRoomDbIds(model), Error);
  const dbIds = await ext._resolveRoomDbIds(model);
  check('second call triggers a fresh model.search, not a replayed rejection', searchCalls, 2);
  check('second call resolves normally', dbIds.length, 1);
}

// === model evicted mid-search, callback fires late with success (round 12) ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(3);
  ext._currentModel = model;
  let capturedOnSuccess;
  model.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const promise = ext._resolveRoomDbIds(model);
  world.evictModel(model);
  capturedOnSuccess([300]); // late, successful callback after eviction
  await checkRejects('late success callback after eviction: original promise rejects ModelEvictedError', promise, ModelEvictedError);
  let findClashesCalled = false;
  const originalFindClashes = world.findClashes;
  world.findClashes = async (...args) => { findClashesCalled = true; return originalFindClashes(...args); };
  check('resurrection: findClashes never called on a resurrected rejection', findClashesCalled, false);
}

// === same, but a NEW model object loads under the same numeric modelId ====
{
  const { ext, world } = await extensionWithFakeWorld();
  const oldModel = makeMockModel(4);
  ext._currentModel = oldModel;
  let capturedOnSuccess;
  oldModel.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const stalePromise = ext._resolveRoomDbIds(oldModel);
  world.evictModel(oldModel);
  const newModel = makeMockModel(4); // same numeric id, different object
  newModel.search = (text, onSuccess) => onSuccess([400]);
  const freshPromise = ext._resolveRoomDbIds(newModel);
  capturedOnSuccess([999]); // stale callback fires after both eviction and the new model's own admission
  await checkRejects('stale search still rejects the ORIGINAL caller', stalePromise, ModelEvictedError);
  const freshDbIds = await freshPromise;
  check('fresh locateElementByRoom against the new object succeeds independently', freshDbIds.length, 1);
}

// === world disposed while search in flight ==================================
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(5);
  ext._currentModel = model;
  let capturedOnSuccess;
  model.search = (text, onSuccess) => { capturedOnSuccess = onSuccess; };
  const promise = ext._resolveRoomDbIds(model);
  world.dispose();
  capturedOnSuccess([500]);
  await checkRejects('world disposed mid-search, late success: rejects WorldDisposedError not ModelEvictedError', promise, WorldDisposedError);
  check('cache slot deleted (identity-guarded)', ext._roomCache.has(model), false);
}
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(6);
  ext._currentModel = model;
  let capturedOnError;
  model.search = (text, onSuccess, onError) => { capturedOnError = onError; };
  const promise = ext._resolveRoomDbIds(model);
  world.dispose();
  capturedOnError(new Error('search failed'));
  await checkRejects('world disposed mid-search, late error callback: rejects WorldDisposedError', promise, WorldDisposedError);
}

// === admitModel throws immediately for a tombstoned model (never calls search) ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(7);
  world.evictModel(model); // tombstone before any search ever starts
  let searchCalled = false;
  model.search = () => { searchCalled = true; };
  await checkRejects('admitModel on already-evicted model rejects before model.search is ever called', ext._resolveRoomDbIds(model), ModelEvictedError);
  check('model.search never called on a pre-evicted model', searchCalled, false);
}

// === unload() ordering: dispose(), then listener/menu removal, then cache clear ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(8);
  ext._currentModel = model;
  model.search = (text, onSuccess) => onSuccess([800]);
  await ext._resolveRoomDbIds(model); // populate the cache
  const order = [];
  world.dispose = () => order.push('dispose');
  ext._viewer.removeEventListener = () => order.push('removeEventListener');
  ext._viewer.unregisterContextMenuCallback = () => order.push('unregisterContextMenuCallback');
  const originalClear = ext._roomCache.clear.bind(ext._roomCache);
  ext._roomCache.clear = () => { order.push('cacheClear'); originalClear(); };
  ext.unload();
  check('unload() order: dispose first, then listener+menu removal, then cache clear', order.join(','), 'dispose,removeEventListener,unregisterContextMenuCallback,cacheClear');
}

// === BEFORE_MODEL_UNLOAD_EVENT handler drops cache entry unconditionally ===
{
  const { ext, world } = await extensionWithFakeWorld();
  const model = makeMockModel(9);
  ext._currentModel = model;
  model.search = (text, onSuccess) => onSuccess([900]);
  await ext._resolveRoomDbIds(model);
  check('cache populated before eviction', ext._roomCache.has(model), true);
  ext._onBeforeModelUnload({ model });
  check('BEFORE_MODEL_UNLOAD_EVENT handler drops the cache entry unconditionally', ext._roomCache.has(model), false);
  check('BEFORE_MODEL_UNLOAD_EVENT handler evicts the model in the world', world._modelLifecycle.get(model)?.state, 'evicted');
}
{
  const { ext } = await extensionWithFakeWorld();
  // Defensive check: event.model undefined must fail clearly, not silently no-op or throw a cryptic TypeError.
  let threw = false;
  try { ext._onBeforeModelUnload({}); } catch (err) { threw = /event\.model/.test(err.message); }
  check('BEFORE_MODEL_UNLOAD_EVENT handler fails clearly if event.model is ever undefined (typings say event: any)', threw, true);
}

// === fix round 1, Finding 1: the model is resolved at ACTION time, not from a load() snapshot ===
// Reproduces this app's REAL sequence (wwwroot/main.js): initViewer() constructs the Viewer and loads
// its extensions FIRST, and loadModel() runs later — so load() always sees `viewer.model` undefined
// and `_currentModel` stays null forever. Before the fix, locateElementByRoom passed that null
// straight to world.admitModel(), which throws (the real CollisionWorld keys a WeakMap by the model),
// and onContextMenu's catch swallowed it: "Locate Room" silently did nothing, every time.
{
  const viewer = makeMockViewer();
  const ext = new RoomLocatorExtension(viewer, {});
  ext._world = makeFakeWorld();
  check('extension constructed before any model exists: _currentModel is null', ext._currentModel, null);
  const model = makeMockModel(10);
  model.search = (text, onSuccess) => onSuccess([1000, 1001]);
  viewer.model = model; // the model loads LATER, exactly as loadModel() does in the real app
  let clashSourceModel = null;
  ext._world.findClashes = async ({ source, target }) => {
    clashSourceModel = source.model;
    return { pairs: [{ source: { dbId: source.dbIds[0] }, target: { dbId: target.dbIds[0] } }], statistics: { diagnostics: [] } };
  };
  let rooms = null, thrown = null;
  try { rooms = await ext.locateElementByRoom(42); } catch (err) { thrown = err; }
  check('locateElementByRoom resolves the live viewer.model at call time when _currentModel was never set',
    thrown ? `threw ${thrown.constructor.name}: ${thrown.message}` : rooms.join(','), '1000');
  check('locateElementByRoom acted on the live viewer model object', clashSourceModel === model, true);
}
{
  // ...and with genuinely no model anywhere, it fails CLEARLY rather than repeating the silent null.
  const { ext } = await extensionWithFakeWorld();
  let message = '';
  try { await ext.locateElementByRoom(1); } catch (err) { message = err.message; }
  check('locateElementByRoom with no model at all throws a clear error, not a cryptic null failure', /no model is loaded/.test(message), true);
}

// === fix round 1, Finding 2: a SYNCHRONOUS model.search throw must not poison the cache ==========
// thisPromise is cached before model.search runs (deliberate, see the implementation comment). If
// search throws synchronously, no callback ever settles that promise — before the fix it stayed in
// _roomCache permanently pending, so every later call took the cache-hit fast path and hung forever.
{
  const { ext } = await extensionWithFakeWorld();
  const model = makeMockModel(11);
  const boom = new Error('property database not loaded');
  let searchCalls = 0;
  model.search = (text, onSuccess) => {
    searchCalls++;
    if (searchCalls === 1) throw boom;
    onSuccess([1100]);
  };
  let caught = null;
  try { await ext._resolveRoomDbIds(model); } catch (err) { caught = err; }
  check('synchronous model.search throw: first call rejects with that very error', caught === boom, true);
  check('synchronous model.search throw: no permanently-pending cache entry left behind', ext._roomCache.has(model), false);
  // Raced against a timeout so a regression reports a clean FAIL instead of hanging the whole file.
  const hungSentinel = new Promise((resolve) => { setTimeout(() => resolve('HUNG (cached forever-pending promise)'), 250); });
  const secondCall = ext._resolveRoomDbIds(model).then((dbIds) => dbIds.length, (err) => `rejected: ${err.message}`);
  const outcome = await Promise.race([secondCall, hungSentinel]);
  check('after a synchronous search throw, the second call resolves via a fresh search (never hangs)', outcome, 1);
  check('after a synchronous search throw, the second call really did re-invoke model.search', searchCalls, 2);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
