// test/ClashFinderExtension.softClash.test.mjs
//
// Task 14 (M3, Batch 3): "Find Soft Clashes" context-menu action. Mirrors
// test/ClashFinderExtension.test.mjs's own headless-Node conventions exactly (bare `check()`
// counter harness, no node:test/assert -- that generic convention describes the collision/ library
// tests, not this Viewer-extension sibling file, which this file must match instead) -- a `_world`
// test seam that bypasses CollisionWorld.fromViewer/load() entirely for every test that does not
// itself need to exercise load()'s own validation/registration ordering.
//
// Scope: `defaultClearance` resolution/validation as the FIRST statement in load() (before
// CollisionWorld.fromViewer and before any listener/menu registration); the second, independent
// "Find Soft Clashes" context-menu entry; its findClashes({mode:'clearance', clearance}) call shape;
// and the binding global constraint that Hard Clash's `_latestActionToken` and Soft Clash's own
// `_latestSoftClashActionToken` are separate counters that never cancel each other's in-flight run.
import { ClashFinderExtension, EXTENSION_ID } from '../wwwroot/extensions/ClashFinderExtension.js';
import { CollisionWorld } from '../collision/index.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}

// A fake CollisionWorld exposing ONLY the public surface ClashFinderExtension may touch -- same
// shape as test/ClashFinderExtension.test.mjs's own makeFakeWorld.
function makeFakeWorld() {
  let disposed = false;
  return {
    findClashes: async () => ({ pairs: [], statistics: { diagnostics: [] } }),
    evictModel(model) { /* no-op unless overridden per test */ },
    dispose() { disposed = true; },
    _isDisposed: () => disposed,
  };
}

// Minimal `viewer.overlays.*` mock -- this file's own tests never exercise the marker/overlay path
// (Soft Clash visualization is a Task 15 stub in this task), but ClashFinderExtension's constructor
// and unload() reference `viewer.overlays`, so a mock viewer must still carry a harmless one.
function makeMockOverlays() {
  const scenes = new Map();
  return {
    _scenes: scenes,
    hasScene(name) { return scenes.has(name); },
    addScene(name) { if (!scenes.has(name)) scenes.set(name, new Set()); },
    addMesh(mesh, name) { scenes.get(name)?.add(mesh); },
    removeMesh(mesh, name) { scenes.get(name)?.delete(mesh); },
    clearScene(name) { scenes.get(name)?.clear(); },
    removeScene(name) { scenes.delete(name); },
  };
}

function makeMockViewer() {
  return {
    addEventListener() {}, removeEventListener() {},
    registerContextMenuCallback() {}, unregisterContextMenuCallback() {},
    getAggregateSelection() { return []; },
    getAllModels() { return []; },
    isolate() {}, fitToView() {},
    overlays: makeMockOverlays(),
  };
}

function makeMockModel(id) {
  return { id };
}

// Bypasses fromViewer/load() to inject a controllable fake world directly (same seam the sibling
// Hard Clash test file uses), while still mirroring exactly what load() itself would have set on
// `_clearance`/`_latestSoftClashActionToken` -- so onContextMenu/target() tests below observe the
// same post-load() state without paying for a real (mocked) load() round-trip each time.
function extensionWithFakeWorld(viewer = makeMockViewer(), options = {}) {
  const ext = new ClashFinderExtension(viewer, options);
  const world = makeFakeWorld();
  ext._world = world; // test seam: bypass fromViewer/load() to inject a controllable fake world
  ext._clearance = options.defaultClearance ?? ClashFinderExtension.DEFAULT_CLEARANCE;
  ext._latestSoftClashActionToken = 0;
  return { ext, viewer, world };
}

// Runs `body` with CollisionWorld.fromViewer temporarily replaced by `fakeFromViewer` -- CollisionWorld
// is a plain (non-frozen) class, so its own static method is safely restorable, and `node --test`
// runs each `*.test.mjs` file in its own process, so this never leaks into other test files.
async function withFakeFromViewer(fakeFromViewer, body) {
  const original = CollisionWorld.fromViewer;
  CollisionWorld.fromViewer = fakeFromViewer;
  try {
    await body();
  } finally {
    CollisionWorld.fromViewer = original;
  }
}

// === DEFAULT_CLEARANCE is exposed as a static class field, matching MIN/MAX_MARKER_RADIUS's own
// existing test-introspection precedent ==============================================================
check('DEFAULT_CLEARANCE is exposed as a static class field', ClashFinderExtension.DEFAULT_CLEARANCE, 0.05);

// === load() with no options resolves _clearance to DEFAULT_CLEARANCE (0.05) =======================
await withFakeFromViewer(async () => makeFakeWorld(), async () => {
  const ext = new ClashFinderExtension(makeMockViewer(), {});
  await ext.load();
  check('load() with no options resolves _clearance to DEFAULT_CLEARANCE (0.05)', ext._clearance, 0.05);
  check('load() initializes _latestSoftClashActionToken to 0', ext._latestSoftClashActionToken, 0);
});

// === load() with a valid defaultClearance option uses the override =================================
await withFakeFromViewer(async () => makeFakeWorld(), async () => {
  const ext = new ClashFinderExtension(makeMockViewer(), { defaultClearance: 0.2 });
  await ext.load();
  check('load() with a valid defaultClearance option uses the override', ext._clearance, 0.2);
});

// === load() with an invalid defaultClearance fails load() itself, BEFORE any registration ==========
// Covers every invalid shape the brief names: non-positive, NaN, Infinity, and non-number.
for (const bad of [0, -1, NaN, Infinity, 'nope']) {
  const registerCalls = [];
  const viewer = makeMockViewer();
  viewer.registerContextMenuCallback = (...args) => registerCalls.push(['registerContextMenuCallback', ...args]);
  viewer.addEventListener = (...args) => registerCalls.push(['addEventListener', ...args]);
  const ext = new ClashFinderExtension(viewer, { defaultClearance: bad });
  await withFakeFromViewer(
    async (...args) => { registerCalls.push(['CollisionWorld.fromViewer', ...args]); return makeFakeWorld(); },
    async () => {
      let threw = null;
      try {
        await ext.load();
      } catch (err) {
        threw = err;
      }
      check(`load() with invalid defaultClearance=${bad} rejects`, threw !== null, true);
      check(`load() with invalid defaultClearance=${bad} leaves nothing registered (not even CollisionWorld.fromViewer)`,
        registerCalls.length, 0);
    },
  );
}

// === context-menu gains a "Find Soft Clashes" entry alongside "Find Clashes" =======================
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [42] }];
  const menu = [];
  ext.onContextMenu(menu, {});
  const titles = menu.map((m) => m.title);
  check('menu still includes "Find Clashes"', titles.includes('Find Clashes'), true);
  check('menu also includes "Find Soft Clashes"', titles.includes('Find Soft Clashes'), true);
  check('exactly two menu entries (no more, no fewer)', menu.length, 2);
}

// === "Find Soft Clashes" invokes findClashes with mode:clearance and the resolved clearance value ==
{
  const { ext, viewer, world } = extensionWithFakeWorld(makeMockViewer(), { defaultClearance: 0.3 });
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [42] }];
  viewer.getAllModels = () => [modelA, modelB];
  let capturedQuery = null;
  world.findClashes = async (query) => { capturedQuery = query; return { pairs: [], statistics: { diagnostics: [] } }; };
  const menu = [];
  ext.onContextMenu(menu, {});
  const softClashEntry = menu.find((m) => m.title === 'Find Soft Clashes');
  await softClashEntry.target();
  check('findClashes was called exactly once', capturedQuery !== null, true);
  check('mode is "clearance"', capturedQuery.mode, 'clearance');
  check('clearance is the resolved _clearance value', capturedQuery.clearance, ext._clearance);
  check('clearance equals the overridden 0.3', capturedQuery.clearance, 0.3);
  check('target.targets is an array', Array.isArray(capturedQuery.target.targets), true);
  check('target.targets built from every loaded model, source model NOT filtered out',
    capturedQuery.target.targets.map((t) => (t.model === modelA ? 'A' : t.model === modelB ? 'B' : '?')).join(','), 'A,B');
  check('source.model is the selected entry\'s model', capturedQuery.source.model === modelA, true);
  check('source.dbIds is exactly [selected dbId]', capturedQuery.source.dbIds.join(','), '42');
  check('groupBy is dbId', capturedQuery.groupBy, 'dbId');
}

// === "Find Soft Clashes" success path isolates/fits/visualizes/notifies, mirroring "Find Clashes" ==
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const isolateCalls = [], fitToViewCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = (dbIds, model) => fitToViewCalls.push({ dbIds: [...dbIds], model });
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, {});
  const softClashEntry = menu.find((m) => m.title === 'Find Soft Clashes');
  await softClashEntry.target();
  check('isolate called once per involved model (source + target)', isolateCalls.length, 2);
  check('fitToView called once per involved model', fitToViewCalls.length, 2);
  check('notify reports the clash count', notified, '1 clashes found (0 in this model, 1 in other models)');
  // check()'s own actual===expected comparison cannot compare arrays by value -- compare length and
  // each pair's identity (===, matching the pairs array findClashes itself returned) instead.
  check('_activeSoftClashObjects tracks the pairs (Task 15 stub): same length', ext._activeSoftClashObjects.length, 1);
  check('_activeSoftClashObjects tracks the pairs (Task 15 stub): source dbId', ext._activeSoftClashObjects[0]?.source?.dbId, 10);
  check('_activeSoftClashObjects tracks the pairs (Task 15 stub): target dbId', ext._activeSoftClashObjects[0]?.target?.dbId, 30);
}

// === "No clashes found" is reported unconditionally on a clean soft-clash result ===================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA];
  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [] } });
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, {});
  const softClashEntry = menu.find((m) => m.title === 'Find Soft Clashes');
  await softClashEntry.target();
  check('zero pairs: reports exactly "No clashes found." with no caveat', notified, 'No clashes found.');
}

// === a genuine (non-superseded) Soft Clash failure clears isolation and surfaces a visible error ===
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Soft Clashes').target(); // isolates modelA + modelB
  isolateCalls.length = 0;

  const boom = new Error('soft clash engine exploded');
  world.findClashes = async () => { throw boom; };
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Soft Clashes').target();

  const clears = isolateCalls.filter((c) => c.dbIds.length === 0).map((c) => c.model);
  check('a genuine Soft Clash failure clears the PRIOR query\'s isolation', clears.length, 2);
  check('the failure surfaces a VISIBLE notification', /Find Soft Clashes failed/.test(notified), true);
  check('the failure notification names the underlying error', /soft clash engine exploded/.test(notified), true);
  check('_activeSoftClashObjects is reset on failure too', ext._activeSoftClashObjects.length, 0);
}

// === Find Soft Clashes and Find Clashes use SEPARATE action tokens -- firing one does not cancel an
// in-flight run of the other (Global Constraint, binding) ===========================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAllModels = () => [modelA, modelB];
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];

  const pending = [];
  world.findClashes = (query) => new Promise((resolve) => { pending.push({ query, resolve }); });

  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const alerts = [];
  ext._notifyUser = (message) => { alerts.push(message); };
  // Hard Clash's success path calls _addMarkers, which reaches for the real Viewer's `window.THREE`
  // global -- absent in this headless process (this file, unlike its sibling
  // ClashFinderExtension.test.mjs, never installs a fake window.THREE, since Soft Clash's own
  // visualization needs no such fixture). Stubbed out here since this test is about action-token
  // independence, not marker-overlay geometry.
  ext._addMarkers = () => {};

  const menu = [];
  ext.onContextMenu(menu, {});
  const hardEntry = menu.find((m) => m.title === 'Find Clashes');
  const softEntry = menu.find((m) => m.title === 'Find Soft Clashes');

  // Fire Hard Clash first (slow, unresolved), then Soft Clash (fast, resolves first).
  const hardPromise = hardEntry.target();
  const softPromise = softEntry.target();
  check('both Hard Clash and Soft Clash calls reached findClashes', pending.length, 2);

  const hardCall = pending.find((p) => p.query.mode === 'volume-overlap');
  const softCall = pending.find((p) => p.query.mode === 'clearance');
  check('exactly one pending call is the Hard Clash (volume-overlap) query', hardCall !== undefined, true);
  check('exactly one pending call is the Soft Clash (clearance) query', softCall !== undefined, true);

  // The Soft Clash call resolves FIRST, while Hard Clash is still in flight.
  softCall.resolve({ pairs: [], statistics: { diagnostics: [] } });
  await softPromise;
  check('Soft Clash resolving does not itself touch isolate (no soft clashes found)', isolateCalls.length, 0);

  // Hard Clash's own (slower) call finally resolves. It must NOT observe itself as stale merely
  // because a Soft Clash action ran and completed in between -- the two tokens are independent.
  hardCall.resolve({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 99, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  await hardPromise;
  check('Hard Clash isolate effects ARE observable despite an interleaved Soft Clash action',
    isolateCalls.some((c) => c.dbIds.includes(10)) && isolateCalls.some((c) => c.dbIds.includes(99)), true);
  check('Hard Clash notify fired (not silently discarded as stale)',
    alerts.some((m) => /^1 clashes found/.test(m)), true);
}

// === Mirror direction: firing Find Clashes does not cancel an in-flight Find Soft Clashes either ===
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAllModels = () => [modelA, modelB];
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];

  const pending = [];
  world.findClashes = (query) => new Promise((resolve) => { pending.push({ query, resolve }); });

  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const alerts = [];
  ext._notifyUser = (message) => { alerts.push(message); };
  // See the primary-direction test above for why this stub is needed in this headless process.
  ext._addMarkers = () => {};

  const menu = [];
  ext.onContextMenu(menu, {});
  const hardEntry = menu.find((m) => m.title === 'Find Clashes');
  const softEntry = menu.find((m) => m.title === 'Find Soft Clashes');

  // Fire Soft Clash first (slow, unresolved), then Hard Clash (fast, resolves first).
  const softPromise = softEntry.target();
  const hardPromise = hardEntry.target();
  check('both Soft Clash and Hard Clash calls reached findClashes (mirror direction)', pending.length, 2);

  const hardCall = pending.find((p) => p.query.mode === 'volume-overlap');
  const softCall = pending.find((p) => p.query.mode === 'clearance');

  hardCall.resolve({ pairs: [], statistics: { diagnostics: [] } });
  await hardPromise;

  softCall.resolve({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 77, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  await softPromise;
  check('Soft Clash isolate effects ARE observable despite an interleaved Hard Clash action (mirror direction)',
    isolateCalls.some((c) => c.dbIds.includes(10)) && isolateCalls.some((c) => c.dbIds.includes(77)), true);
  check('Soft Clash notify fired (not silently discarded as stale, mirror direction)',
    alerts.some((m) => /^1 clashes found/.test(m)), true);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
