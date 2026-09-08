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
//
// Task 15 (M3, Batch 3) additions: real Soft Clash visualization coverage (two endpoint markers +
// one connecting line per witness-bearing clearance pair, in a separate overlay scene/color from
// Hard Clash's own markers). Unlike this file's own Task 14-era comment further down (now stale --
// see the fake `window.THREE` section below), Soft Clash's real implementation DOES need a fake
// `window.THREE` fixture, since `_ensureSoftClashOverlay`/`_addSoftClashVisualization` reach for the
// real Viewer's r71 global exactly like Hard Clash's own `_ensureMarkerOverlay`/`_addMarkers` do --
// this file installs its own copy of that fixture (extended with THREE.Line/LineBasicMaterial/
// BufferGeometry), matching test/ClashFinderExtension.test.mjs's own fixture in spirit but kept as
// this file's own separate copy (each `*.test.mjs` file runs in its own `node --test` process, so
// nothing is shared or leaked between them).
import { readFile } from 'node:fs/promises';
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

// `viewer.overlays.*` mock -- extended for Task 15 with `_addMeshCalls`/`_removeMeshCalls` logs (in
// ADDITION to the pre-existing `_scenes` introspection seam, kept for the tests that already used
// it) so tests can assert not just "which meshes ended up in which scene" but "exactly how many
// addMesh/removeMesh calls fired, with which scene name each time" -- the brief's own Step 1 sketch
// explicitly wants an exact call COUNT ("addMesh fired 6 times"), which a Set-based scene snapshot
// alone cannot distinguish from, e.g., the same mesh being added twice.
function makeMockOverlays() {
  const scenes = new Map();
  const addMeshCalls = [];
  const removeMeshCalls = [];
  return {
    _scenes: scenes,
    _addMeshCalls: addMeshCalls,
    _removeMeshCalls: removeMeshCalls,
    hasScene(name) { return scenes.has(name); },
    addScene(name) { if (!scenes.has(name)) scenes.set(name, new Set()); },
    addMesh(mesh, name) { addMeshCalls.push({ mesh, name }); scenes.get(name)?.add(mesh); },
    removeMesh(mesh, name) { removeMeshCalls.push({ mesh, name }); scenes.get(name)?.delete(mesh); },
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
    isolate() {}, setAggregateIsolation() {}, fitToView() {},
    overlays: makeMockOverlays(),
  };
}

// Task 15: `_computeMarkerRadius` (reused as-is by Soft Clash's own `_addSoftClashVisualization`,
// via its own new min/max-radius parameters) calls `model.getInstanceTree()` for every model in
// `dbIdsByModel` -- every mock model here must expose it (returning `undefined`, i.e. "this model's
// object tree has not loaded", the same defensively-handled case `_computeMarkerRadius` already
// falls back to minRadius for) or that call throws a TypeError. This file's own tests don't exercise
// radius-clamping math itself (that is test/ClashFinderExtension.test.mjs's own dedicated coverage
// via its richer `boxesByDbId`-driven fixture) -- only that Soft Clash's visualization renders at
// all without crashing on a real dbIdsByModel Map.
function makeMockModel(id) {
  return { id, getInstanceTree() { return undefined; } };
}

// === fake window.THREE — the r71 subset Soft Clash's own visualization touches (Task 15) ==========
// Node has no `window` global and this repo must never import the npm `three` package into
// ClashFinderExtension.js -- see test/ClashFinderExtension.test.mjs's own identical rationale for
// its Hard Clash fixture. This file installs its OWN copy (each `*.test.mjs` file runs in its own
// `node --test` process, so nothing here leaks into or is shared with that sibling file), extended
// with THREE.Line/THREE.LineBasicMaterial/THREE.BufferGeometry -- the three APIs Hard Clash's own
// marker overlay never needed, confirmed available on the real pinned r71 bundle (see this task's
// dispatch context: THREE.Line/LineBasicMaterial construction and BufferGeometry#setFromPoints all
// source-verified against the real viewer3D.js). setFromPoints specifically is NOT proven by the
// Viewer's own gizmo/measurement-tool code -- that code actually calls a DIFFERENT, webpack-imported
// "modern three" module (`three__WEBPACK_IMPORTED_MODULE_0___default()`), not the r71 `window.THREE`
// global this extension uses. The real load-bearing evidence for setFromPoints on r71 `window.THREE`
// is a separate, explicit backport shim found in the same bundle:
// `defineFunctionIfMissing(THREE?.BufferGeometry?.prototype, 'setFromPoints', function
// setFromPoints(points) {...})`, which installs the method directly onto the r71 THREE global when
// missing.
class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class FakeSphere {
  constructor() { this.center = new FakeVector3(); this.radius = 0; }
}

// Minimal Box3 -- this file's own mock models always return `getInstanceTree() -> undefined` (see
// makeMockModel above), so `_computeMarkerRadius`'s loop never adds anything to this box and it is
// ALWAYS empty by the time `isEmpty()` is checked; radius-clamping arithmetic itself is exercised by
// test/ClashFinderExtension.test.mjs's own richer fixture, not duplicated here.
class FakeBox3 {
  isEmpty() { return true; }
}

class FakeSphereGeometry {
  constructor(radius, widthSegments, heightSegments) {
    this.radius = radius; this.widthSegments = widthSegments; this.heightSegments = heightSegments;
  }
  dispose() {}
}

class FakeMeshBasicMaterial {
  constructor(params) { Object.assign(this, params); }
  dispose() {}
}

class FakeLineBasicMaterial {
  constructor(params) { Object.assign(this, params); }
  dispose() {}
}

class FakeMesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new FakeVector3();
    this.scale = new FakeVector3(1, 1, 1);
  }
  updateMatrixWorld() {}
}

// setFromPoints -- real THREE.BufferGeometry.prototype.setFromPoints -- is fed an array of
// THREE.Vector3-shaped points; this fake just records them (arithmetic fidelity is not the point
// here, only that the two endpoint positions this file's tests supply reach the resulting line).
class FakeBufferGeometry {
  setFromPoints(points) { this.points = points; return this; }
  dispose() {}
}

class FakeLine {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; }
}

// Installed once, at module load -- `node --test` runs each `*.test.mjs` file in its own process
// (isolation: 'process' is the default), so this global does not leak into other test files.
globalThis.window = globalThis.window ?? {};
globalThis.window.THREE = {
  Vector3: FakeVector3,
  Box3: FakeBox3,
  Sphere: FakeSphere,
  SphereGeometry: FakeSphereGeometry,
  MeshBasicMaterial: FakeMeshBasicMaterial,
  LineBasicMaterial: FakeLineBasicMaterial,
  Mesh: FakeMesh,
  BufferGeometry: FakeBufferGeometry,
  Line: FakeLine,
};

// Task 15: production module-level constants this file's own assertions need to compare against.
// Not exported by ClashFinderExtension.js (matching MARKER_OVERLAY_NAME/MARKER_COLOR's own existing
// precedent of staying internal, non-exported constants) -- these literals are kept in exact sync
// with the real values in wwwroot/extensions/ClashFinderExtension.js by this comment's own cross-
// reference; a mismatch here would make every assertion below fail loudly, not silently pass.
const SOFT_CLASH_OVERLAY_NAME = 'clash-finder-soft-markers';
const SOFT_CLASH_COLOR = 0x2b8fff;
const MARKER_OVERLAY_NAME = 'clash-finder-markers'; // Hard Clash's own overlay scene name
const MARKER_COLOR = 0xff6a00; // Hard Clash's own marker color

// Bypasses fromViewer/load() to inject a controllable fake world directly (same seam the sibling
// Hard Clash test file uses), while still mirroring exactly what load() itself would have set on
// `_clearance` -- so onContextMenu/target() tests below observe the same post-load() state without
// paying for a real (mocked) load() round-trip each time. `_latestSoftClashActionToken` needs no
// mirroring here: it is initialized once in the constructor (fix-wave, post-Batch-3 review) and
// load() never touches it, so the constructor's own `new ClashFinderExtension(...)` call above
// already leaves it at 0, exactly matching real post-load() state.
function extensionWithFakeWorld(viewer = makeMockViewer(), options = {}) {
  const ext = new ClashFinderExtension(viewer, options);
  const world = makeFakeWorld();
  ext._world = world; // test seam: bypass fromViewer/load() to inject a controllable fake world
  ext._clearance = options.defaultClearance ?? ClashFinderExtension.DEFAULT_CLEARANCE;
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
});

// === _latestSoftClashActionToken is initialized to 0 by the CONSTRUCTOR, not by load() (fix-wave,
// post-Batch-3 review): asserts immediately after construction (before load() ever runs) AND that a
// non-zero value set before load() survives load() untouched -- proving load() genuinely never
// (re-)assigns this field, matching Hard Clash's own _latestActionToken discipline exactly ==========
{
  const ext = new ClashFinderExtension(makeMockViewer(), {});
  check('_latestSoftClashActionToken is 0 immediately after construction, before load() ever runs', ext._latestSoftClashActionToken, 0);
}
await withFakeFromViewer(async () => makeFakeWorld(), async () => {
  const ext = new ClashFinderExtension(makeMockViewer(), {});
  ext._latestSoftClashActionToken = 7; // simulate an in-flight query's token before a (re-)load()
  await ext.load();
  check('load() does NOT reset a pre-existing _latestSoftClashActionToken back to 0', ext._latestSoftClashActionToken, 7);
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
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 30, model: modelB },
      witness: { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] },
    }],
    statistics: { diagnostics: [] },
  });
  const aggCalls = [], fitToViewCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = (dbIds, model) => fitToViewCalls.push({ dbIds: [...dbIds], model });
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, {});
  const softClashEntry = menu.find((m) => m.title === 'Find Soft Clashes');
  await softClashEntry.target();
  check('setAggregateIsolation called exactly once for this reconcile', aggCalls.length, 1);
  check('that call\'s array has one entry per involved model (source + target)', aggCalls[0]?.length, 2);
  check('fitToView called once per involved model', fitToViewCalls.length, 2);
  check('notify reports the clash count', notified, '1 clashes found (0 in this model, 1 in other models)');
  // Task 15: real visualization -- one pair renders two markers + one line (3 objects), all in
  // SOFT_CLASH_OVERLAY_NAME, tracked in _activeSoftClashObjects for later teardown.
  check('_activeSoftClashObjects tracks the 3 rendered objects (2 markers + 1 line)', ext._activeSoftClashObjects.length, 3);
  check('all 3 objects were added to the SOFT_CLASH_OVERLAY_NAME scene',
    viewer.overlays._addMeshCalls.filter((c) => c.name === SOFT_CLASH_OVERLAY_NAME).length, 3);
  check('none of them were added to Hard Clash\'s own MARKER_OVERLAY_NAME scene',
    viewer.overlays._addMeshCalls.filter((c) => c.name === MARKER_OVERLAY_NAME).length, 0);
  const [sourceMesh, targetMesh, line] = ext._activeSoftClashObjects;
  check('the source marker mesh is positioned at witness.sourcePoint',
    `${sourceMesh.position.x},${sourceMesh.position.y},${sourceMesh.position.z}`, '1,2,3');
  check('the target marker mesh is positioned at witness.targetPoint',
    `${targetMesh.position.x},${targetMesh.position.y},${targetMesh.position.z}`, '4,5,6');
  check('the connecting line carries both endpoint points', line.geometry.points.length, 2);
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
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Soft Clashes').target(); // isolates modelA + modelB
  aggCalls.length = 0;

  const boom = new Error('soft clash engine exploded');
  world.findClashes = async () => { throw boom; };
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Soft Clashes').target();

  check('a genuine Soft Clash failure clears the PRIOR query\'s isolation -- exactly one setAggregateIsolation call with an empty array',
    aggCalls.length === 1 && aggCalls[0]?.length === 0, true);
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

  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  const alerts = [];
  ext._notifyUser = (message) => { alerts.push(message); };
  // Hard Clash's success path calls _addMarkers, which reaches for the real Viewer's `window.THREE`
  // global. This file DOES install a fake window.THREE (Task 15, see the top of this file) since
  // Soft Clash's own visualization now needs one too -- but _addMarkers is still stubbed out here on
  // purpose: this test is about action-token independence, not marker-overlay geometry, and the
  // pairs below carry no `witness`, so Hard Clash's real _addMarkers would just no-op anyway; the
  // stub keeps that irrelevant-to-this-test fact from needing re-justification here.
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
  check('Soft Clash resolving with no soft clashes found still triggers exactly one setAggregateIsolation call',
    aggCalls.length, 1);
  check('...with an empty array (nothing isolated yet -- Hard Clash is still in flight)', aggCalls[0]?.length, 0);

  // Hard Clash's own (slower) call finally resolves. It must NOT observe itself as stale merely
  // because a Soft Clash action ran and completed in between -- the two tokens are independent.
  hardCall.resolve({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 99, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  await hardPromise;
  check('Hard Clash setAggregateIsolation effects ARE observable despite an interleaved Soft Clash action',
    aggCalls.some((call) => call.some((e) => e.ids.includes(10))) && aggCalls.some((call) => call.some((e) => e.ids.includes(99))), true);
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

  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
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
  check('Soft Clash setAggregateIsolation effects ARE observable despite an interleaved Hard Clash action (mirror direction)',
    aggCalls.some((call) => call.some((e) => e.ids.includes(10))) && aggCalls.some((call) => call.some((e) => e.ids.includes(77))), true);
  check('Soft Clash notify fired (not silently discarded as stale, mirror direction)',
    alerts.some((m) => /^1 clashes found/.test(m)), true);
}

// === Task 15: a successful Find Soft Clashes result renders two markers + one line per pair =======
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2), modelC = makeMockModel(3);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB, modelC];
  world.findClashes = async () => ({
    pairs: [
      {
        source: { modelId: 1, dbId: 10, model: modelA },
        target: { modelId: 2, dbId: 30, model: modelB },
        witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 0, 0] },
      },
      {
        source: { modelId: 1, dbId: 10, model: modelA },
        target: { modelId: 3, dbId: 40, model: modelC },
        witness: { sourcePoint: [5, 5, 5], targetPoint: [6, 6, 6] },
      },
    ],
    statistics: { diagnostics: [] },
  });
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  const softAddMeshCalls = viewer.overlays._addMeshCalls;
  check('addMesh fired exactly 6 times (2 markers + 1 line, per pair, for 2 pairs)', softAddMeshCalls.length, 6);
  check('every addMesh call used SOFT_CLASH_OVERLAY_NAME',
    softAddMeshCalls.every((c) => c.name === SOFT_CLASH_OVERLAY_NAME), true);
  check('no addMesh call ever used Hard Clash\'s own MARKER_OVERLAY_NAME',
    softAddMeshCalls.some((c) => c.name === MARKER_OVERLAY_NAME), false);
  check('_activeSoftClashObjects tracks all 6 rendered objects', ext._activeSoftClashObjects.length, 6);
}

// === Task 15: markers/line use SOFT_CLASH_COLOR, distinct from Hard Clash MARKER_COLOR ==============
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 30, model: modelB },
      witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] },
    }],
    statistics: { diagnostics: [] },
  });
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  const [sourceMesh, targetMesh, line] = ext._activeSoftClashObjects;
  check('the source marker mesh uses SOFT_CLASH_COLOR', sourceMesh.material.color, SOFT_CLASH_COLOR);
  check('the target marker mesh uses SOFT_CLASH_COLOR', targetMesh.material.color, SOFT_CLASH_COLOR);
  check('the connecting line uses SOFT_CLASH_COLOR', line.material.color, SOFT_CLASH_COLOR);
  check('the source marker mesh does NOT use Hard Clash\'s MARKER_COLOR',
    sourceMesh.material.color === MARKER_COLOR, false);
  check('SOFT_CLASH_COLOR and MARKER_COLOR are themselves distinct literals', SOFT_CLASH_COLOR === MARKER_COLOR, false);
}

// === Task 15: zero-result Find Soft Clashes clears any prior soft-clash visualization, adds nothing
// new ==================================================================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 30, model: modelB },
      witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] },
    }],
    statistics: { diagnostics: [] },
  });
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup: the first (non-empty) call populated 3 objects', ext._activeSoftClashObjects.length, 3);
  check('setup: the overlay scene holds 3 meshes/lines', viewer.overlays._scenes.get(SOFT_CLASH_OVERLAY_NAME).size, 3);
  viewer.overlays._addMeshCalls.length = 0; // reset the observation window before the zero-result call

  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [] } });
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Soft Clashes').target();
  check('a zero-result call clears _activeSoftClashObjects entirely', ext._activeSoftClashObjects.length, 0);
  check('a zero-result call removes every prior object from the overlay scene',
    viewer.overlays._scenes.get(SOFT_CLASH_OVERLAY_NAME).size, 0);
  check('a zero-result call adds NOTHING new (no addMesh calls at all)', viewer.overlays._addMeshCalls.length, 0);
}

// === Task 15: a subsequent Find Clashes call does not clear Soft Clash markers, and vice versa
// (independent overlays) ==============================================================================
// [narrow fix, post-Batch-3; reworked per codex-review Important #1 follow-up] Strengthened (not
// replaced) with a real isolate()-call/_isolatedModels union check. The FIRST version of this
// strengthening (now superseded) had Hard Clash and Soft Clash target the SAME dbId (30) on the
// shared model -- a clobbering (pre-fix) implementation and a genuinely unioning one both end up
// calling isolate([30], modelB) in that scenario, so those assertions passed under BOTH the bug and
// the fix and proved nothing. This version gives Hard Clash and Soft Clash DISTINCT dbIds on the
// shared modelB (30 vs. 31, then 30 vs. 32 after Soft Clash's own second run) specifically so a
// clobbering implementation would produce a visibly different (wrong, single-dbId) result from a
// unioning one -- and keeps real (unstubbed) _addMarkers/_addSoftClashVisualization rendering, so the
// discriminating isolate() assertions sit alongside genuine, real overlay-presence assertions for
// both actions, not a stubbed-out approximation of either.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  // Each setAggregateIsolation call carries the FULL current union as one snapshot (unlike the old
  // per-model isolate() calls, which only ever described the delta for one model at a time) -- so
  // "the call for model X" now means "model X's own entry inside the MOST RECENT snapshot".
  const lastCallForModel = (model) => aggCalls.at(-1)?.find((e) => e.model === model);

  // First: a successful Find Soft Clashes isolates modelB:31 and populates the SOFT_CLASH_OVERLAY_NAME
  // scene with real geometry (2 markers + 1 line).
  world.findClashes = async () => ({
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 31, model: modelB },
      witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] },
    }],
    statistics: { diagnostics: [] },
  });
  const menuSoft1 = [];
  ext.onContextMenu(menuSoft1, {});
  await menuSoft1.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup: Soft Clash populated its own 3 objects (real, unstubbed rendering)', ext._activeSoftClashObjects.length, 3);
  check('setup: Soft Clash isolated modelB:31', lastCallForModel(modelB)?.ids.includes(31), true);
  const softObjectsAfterFirstRun = [...ext._activeSoftClashObjects];

  // Then: a successful Find Clashes (Hard Clash) run isolates modelB:30 -- a DIFFERENT dbId on the
  // SAME model Soft Clash just isolated. This is the exact defect scenario the whole fix exists for
  // (Soft Clash then Hard Clash): a clobbering implementation calls isolate([30], modelB), losing 31;
  // a genuinely unioning one calls isolate([30, 31], modelB).
  world.findClashes = async () => ({
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 30, model: modelB },
      witness: { point: [9, 9, 9] },
    }],
    statistics: { diagnostics: [] },
  });
  const menuHard = [];
  ext.onContextMenu(menuHard, {});
  await menuHard.find((m) => m.title === 'Find Clashes').target();
  check('Find Clashes populated its own Hard Clash marker (1 object, real unstubbed rendering)', ext._activeMarkers.length, 1);
  check('Soft Clash\'s _activeSoftClashObjects is untouched by Find Clashes',
    ext._activeSoftClashObjects.length, 3);
  check('Soft Clash\'s own SOFT_CLASH_OVERLAY_NAME scene still holds all 3 of its objects',
    softObjectsAfterFirstRun.every((obj) => viewer.overlays._scenes.get(SOFT_CLASH_OVERLAY_NAME).has(obj)), true);
  check('Find Clashes\' marker landed in MARKER_OVERLAY_NAME, not SOFT_CLASH_OVERLAY_NAME',
    viewer.overlays._scenes.get(SOFT_CLASH_OVERLAY_NAME).size, 3);
  // The genuinely discriminating check: proves this is a real UNION, not a clobber -- would FAIL
  // under the pre-fix single-Set behavior (which would leave only [30]).
  const afterHardCall = lastCallForModel(modelB);
  check('after Hard Clash runs, the setAggregateIsolation entry for shared modelB still includes Soft\'s own dbId 31',
    afterHardCall.ids.includes(31), true);
  check('...and now also includes Hard\'s own dbId 30', afterHardCall.ids.includes(30), true);
  check('...and the entry has EXACTLY those 2 dbIds (proves no stray/lost entries either direction)',
    [...afterHardCall.ids].sort().join(','), '30,31');

  // Finally (mirror direction): a subsequent Find Soft Clashes run replaces Soft's OWN contribution
  // (31 -> 32) while Hard Clash's own dbId 30 -- untouched by this action -- must survive the union.
  const hardMarkerAfterFirstRun = [...ext._activeMarkers];
  const menuSoft2 = [];
  ext.onContextMenu(menuSoft2, {});
  world.findClashes = async () => ({
    pairs: [{
      source: { modelId: 1, dbId: 10, model: modelA },
      target: { modelId: 2, dbId: 32, model: modelB },
      witness: { sourcePoint: [2, 2, 2], targetPoint: [3, 3, 3] },
    }],
    statistics: { diagnostics: [] },
  });
  await menuSoft2.find((m) => m.title === 'Find Soft Clashes').target();
  check('Hard Clash\'s _activeMarkers is untouched by a subsequent Find Soft Clashes',
    ext._activeMarkers.length, 1);
  check('Hard Clash\'s own marker object identity is unchanged', ext._activeMarkers[0] === hardMarkerAfterFirstRun[0], true);
  check('Hard Clash\'s own MARKER_OVERLAY_NAME scene still holds its 1 marker',
    viewer.overlays._scenes.get(MARKER_OVERLAY_NAME).size, 1);
  // Soft Clash's own second run replaced its own 3 objects with a new 3 (clear-then-add, same as
  // every earlier "Find Soft Clashes clears its own PRIOR visualization" test above establishes).
  check('Soft Clash\'s second run still (independently) replaced its own 3 objects', ext._activeSoftClashObjects.length, 3);

  // The genuinely discriminating check for the replace direction: Soft's OLD dbId (31) must be gone,
  // Soft's NEW dbId (32) must be present, and Hard's own dbId (30) -- untouched by this action --
  // must still be present. A clobbering implementation would leave only [32].
  const afterSecondSoftCall = lastCallForModel(modelB);
  check('after Soft Clash\'s second run, modelB\'s setAggregateIsolation entry no longer includes the OLD Soft dbId 31',
    afterSecondSoftCall.ids.includes(31), false);
  check('...includes Soft\'s NEW dbId 32', afterSecondSoftCall.ids.includes(32), true);
  check('...and STILL includes Hard\'s own untouched dbId 30 -- proves union survives a same-model replace on the OTHER action',
    afterSecondSoftCall.ids.includes(30), true);
  check('...and the entry has EXACTLY those 2 dbIds', [...afterSecondSoftCall.ids].sort().join(','), '30,32');

  check('modelA (the shared source model) still carries the common source dbId 10',
    lastCallForModel(modelA)?.ids.includes(10), true);
  check('_isolatedModels still reflects both models after the Soft-Hard-Soft sequence', ext._isolatedModels.size, 2);
  check('_isolatedModels has modelA', ext._isolatedModels.has(modelA), true);
  check('_isolatedModels has modelB', ext._isolatedModels.has(modelB), true);
}

// === Task 16 (M3 Batch 3): lifecycle wiring -- Soft Clash's own independent cleanup, wired into
// unload() and _onBeforeModelUnload(), as ADDITIONAL, INDEPENDENT try/finally rungs alongside Hard
// Clash's own existing cleanup chain -- never nested inside it. A codex-advisor consult (this task's
// own dispatch) confirmed the mathematically necessary shape: plain SEQUENTIAL sibling try/finally
// statements do NOT achieve mutual independence (an uncaught throw from the first statement skips the
// second one entirely) -- the only way to guarantee "a throw on either side never prevents the other
// side's cleanup from running" is to wrap the existing (unchanged) Hard Clash body in a NEW outermost
// try, with Soft Clash's own cleanup in that new try's finally. This mirrors the SAME "wrap the
// existing block in an outer finally to add one more independent cleanup concern" idiom this file's
// own unload() already uses once (dispose+listener-removal, wrapped by isolation+marker-cleanup). ===

// Populates BOTH Hard Clash (_activeMarkers/_isolatedModels) and Soft Clash
// (_activeSoftClashObjects/_softClashGeometry/_softClashMaterial/_softClashLineMaterial) visualization
// state via two real, successful context-menu actions -- so the lifecycle tests below can distinguish
// "both sides cleared together" from "only one side cleared".
async function extensionWithBothVisualizationsPopulated() {
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  viewer.isolate = () => {}; viewer.fitToView = () => {};
  world.findClashes = async (query) => {
    if (query.mode === 'clearance') {
      return {
        pairs: [{
          source: { modelId: 1, dbId: 10, model: modelA },
          target: { modelId: 2, dbId: 30, model: modelB },
          witness: { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] },
        }],
        statistics: { diagnostics: [] },
      };
    }
    return {
      pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB }, witness: { kind: 'surface-crossing', point: [0, 0, 0] } }],
      statistics: { diagnostics: [] },
    };
  };
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Clashes').target();
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  return { ext, viewer, world, modelA, modelB };
}

// === model unload (_onBeforeModelUnload) clears BOTH Hard Clash and Soft Clash visualization -- no
// partial preservation of either side ==================================================================
{
  const { ext, viewer, modelA } = await extensionWithBothVisualizationsPopulated();
  check('setup: Hard Clash markers are active before the model-unload event', ext._activeMarkers.length, 1);
  check('setup: Soft Clash objects are active before the model-unload event', ext._activeSoftClashObjects.length, 3);
  check('setup: isolation is active before the model-unload event', ext._isolatedModels.size, 2);

  ext._onBeforeModelUnload({ model: modelA });
  check('model unload clears Hard Clash markers', ext._activeMarkers.length, 0);
  check('model unload ALSO clears Soft Clash visualization objects', ext._activeSoftClashObjects.length, 0);
  check('model unload clears isolation for both', ext._isolatedModels.size, 0);
  check('Soft Clash overlay scene still holds nothing after model unload (objects were removed one by one)',
    viewer.overlays._scenes.get('clash-finder-soft-markers')?.size ?? 0, 0);
}

// === extension unload() disposes the soft-clash shared geometry/material/line-material and removes
// its own overlay scene, mirroring Hard Clash's own existing teardown discipline exactly ============
{
  const { ext, viewer } = await extensionWithBothVisualizationsPopulated();
  const geometry = ext._softClashGeometry;
  const material = ext._softClashMaterial;
  const lineMaterial = ext._softClashLineMaterial;
  check('setup: soft-clash shared geometry/material/line-material exist before unload()', [geometry, material, lineMaterial].every(Boolean), true);
  check('setup: soft-clash overlay scene exists before unload()', viewer.overlays.hasScene('clash-finder-soft-markers'), true);
  let geometryDisposed = 0, materialDisposed = 0, lineMaterialDisposed = 0;
  geometry.dispose = () => { geometryDisposed += 1; };
  material.dispose = () => { materialDisposed += 1; };
  lineMaterial.dispose = () => { lineMaterialDisposed += 1; };

  ext.unload();
  check('soft-clash shared geometry is disposed exactly once', geometryDisposed, 1);
  check('soft-clash shared material is disposed exactly once', materialDisposed, 1);
  check('soft-clash shared line material is disposed exactly once', lineMaterialDisposed, 1);
  check('_softClashGeometry reference is cleared after unload()', ext._softClashGeometry, null);
  check('_softClashMaterial reference is cleared after unload()', ext._softClashMaterial, null);
  check('_softClashLineMaterial reference is cleared after unload()', ext._softClashLineMaterial, null);
  check('the soft-clash overlay scene itself is removed, not merely emptied', viewer.overlays.hasScene('clash-finder-soft-markers'), false);
  // Hard Clash's own teardown must still have run too -- unload() clears BOTH, never just one.
  check('Hard Clash markers are also torn down by the same unload() call', ext._activeMarkers.length, 0);
  check('Hard Clash overlay scene is also removed by the same unload() call', viewer.overlays.hasScene('clash-finder-markers'), false);
}

// === a throwing _clearSoftClashVisualization does NOT prevent Hard Clash's own cleanup from running
// (unload()) — independence in this direction ==========================================================
{
  const { ext, viewer } = await extensionWithBothVisualizationsPopulated();
  ext._clearSoftClashVisualization = () => { throw new Error('boom-soft'); };
  let thrown = null;
  try { ext.unload(); } catch (err) { thrown = err; }
  check('unload() propagates the Soft Clash side\'s own thrown error', thrown?.message, 'boom-soft');
  check('Hard Clash markers are STILL torn down despite the Soft Clash throw', ext._activeMarkers.length, 0);
  check('Hard Clash overlay scene is STILL removed despite the Soft Clash throw', viewer.overlays.hasScene('clash-finder-markers'), false);
  check('Hard Clash shared marker geometry is STILL cleared despite the Soft Clash throw', ext._markerGeometry, null);
  check('Hard Clash shared marker material is STILL cleared despite the Soft Clash throw', ext._markerMaterial, null);
  check('isolation is STILL cleared despite the Soft Clash throw', ext._isolatedModels.size, 0);
}

// === the reverse: a throwing Hard Clash cleanup step (_clearMarkers) does NOT prevent Soft Clash's
// own cleanup from running (unload()) — independence in the OTHER direction =========================
{
  const { ext, viewer } = await extensionWithBothVisualizationsPopulated();
  ext._clearMarkers = () => { throw new Error('boom-hard'); };
  let thrown = null;
  try { ext.unload(); } catch (err) { thrown = err; }
  check('unload() propagates the Hard Clash side\'s own thrown error', thrown?.message, 'boom-hard');
  check('Soft Clash visualization objects are STILL torn down despite the Hard Clash throw', ext._activeSoftClashObjects.length, 0);
  check('Soft Clash overlay scene is STILL removed despite the Hard Clash throw', viewer.overlays.hasScene('clash-finder-soft-markers'), false);
  check('Soft Clash shared geometry is STILL cleared despite the Hard Clash throw', ext._softClashGeometry, null);
  check('Soft Clash shared material is STILL cleared despite the Hard Clash throw', ext._softClashMaterial, null);
  check('Soft Clash shared line material is STILL cleared despite the Hard Clash throw', ext._softClashLineMaterial, null);
}

// === _onBeforeModelUnload: a throwing _clearSoftClashVisualization does NOT prevent Hard Clash's own
// model-unload cleanup (evictModel/_clearIsolation/_clearMarkers/_isolatedModels.delete) from running =
{
  const { ext, viewer, modelA } = await extensionWithBothVisualizationsPopulated();
  ext._clearSoftClashVisualization = () => { throw new Error('boom-soft-model-unload'); };
  let thrown = null;
  try { ext._onBeforeModelUnload({ model: modelA }); } catch (err) { thrown = err; }
  check('_onBeforeModelUnload propagates the Soft Clash side\'s own thrown error', thrown?.message, 'boom-soft-model-unload');
  check('Hard Clash markers are STILL torn down despite the Soft Clash throw', ext._activeMarkers.length, 0);
  check('isolation is STILL cleared despite the Soft Clash throw', ext._isolatedModels.size, 0);
  check('the evicted model is STILL dropped from _isolatedModels bookkeeping despite the Soft Clash throw',
    ext._isolatedModels.has(modelA), false);
}

// === _onBeforeModelUnload: the reverse -- a throwing Hard Clash cleanup step (_clearMarkers) does NOT
// prevent Soft Clash's own cleanup (_clearSoftClashVisualization) from running ========================
{
  const { ext, modelA } = await extensionWithBothVisualizationsPopulated();
  ext._clearMarkers = () => { throw new Error('boom-hard-model-unload'); };
  let thrown = null;
  try { ext._onBeforeModelUnload({ model: modelA }); } catch (err) { thrown = err; }
  check('_onBeforeModelUnload propagates the Hard Clash side\'s own thrown error', thrown?.message, 'boom-hard-model-unload');
  check('Soft Clash visualization objects are STILL torn down despite the Hard Clash throw', ext._activeSoftClashObjects.length, 0);
}

// === model unload also bumps _latestSoftClashActionToken, exactly mirroring why Hard Clash's own
// _latestActionToken is bumped -- a Soft Clash findClashes promise that already resolved but whose
// target() continuation had not yet run must see a now-stale token, not silently re-apply itself ===
{
  const { ext, modelA } = await extensionWithBothVisualizationsPopulated();
  const tokenBefore = ext._latestSoftClashActionToken;
  ext._onBeforeModelUnload({ model: modelA });
  check('_onBeforeModelUnload bumps _latestSoftClashActionToken', ext._latestSoftClashActionToken > tokenBefore, true);
}

// === unload() also bumps _latestSoftClashActionToken, alongside _latestActionToken, at the very top
// (both tokens invalidated before anything else runs) =================================================
{
  const { ext } = await extensionWithBothVisualizationsPopulated();
  const tokenBefore = ext._latestSoftClashActionToken;
  ext.unload();
  check('unload() bumps _latestSoftClashActionToken', ext._latestSoftClashActionToken > tokenBefore, true);
}

// === [narrow fix, post-Batch-3] Hard -> Soft preserves visibility for both result sets: firing Find
// Soft Clashes after Find Clashes must UNION their own isolation contributions for any model both
// share (modelB below), not have Soft Clash's own isolation silently replace Hard Clash's -- the bug
// this whole fix exists to close. modelC is isolated by Soft Clash only, proving the union still
// covers a model Hard Clash never touched. ============================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2), modelC = makeMockModel(3);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB, modelC];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return {
        pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Clashes').target();

  world.findClashes = async (query) => {
    if (query.mode === 'clearance') {
      return {
        pairs: [
          { source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } },
          { source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 3, dbId: 50, model: modelC } },
        ],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Soft Clashes').target();

  // Each setAggregateIsolation call carries the full current union as one snapshot -- "the call for
  // model X" means model X's own entry inside the MOST RECENT snapshot.
  const lastCallForModel = (model) => aggCalls.at(-1)?.find((e) => e.model === model);
  const modelBFinal = lastCallForModel(modelB);
  check('after Hard then Soft, the FINAL setAggregateIsolation entry for the shared modelB includes Hard\'s own dbId (30)',
    modelBFinal.ids.includes(30), true);
  check('...and ALSO includes Soft\'s own dbId (31) -- a true union, not a replacement',
    modelBFinal.ids.includes(31), true);
  check('modelC (Soft Clash only) is isolated too', lastCallForModel(modelC).ids.includes(50), true);
  check('_isolatedModels reflects the full union of models touched by either action (A, B, C)', ext._isolatedModels.size, 3);
  check('_isolatedModels has modelC', ext._isolatedModels.has(modelC), true);
}

// === [narrow fix, post-Batch-3] Mirror direction: Soft -> Hard preserves visibility for both result
// sets ==================================================================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2), modelC = makeMockModel(3);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB, modelC];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'clearance') {
      return {
        pairs: [
          { source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } },
          { source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 3, dbId: 50, model: modelC } },
        ],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Soft Clashes').target();

  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return {
        pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Clashes').target();

  const lastCallForModel = (model) => aggCalls.at(-1)?.find((e) => e.model === model);
  const modelBFinal = lastCallForModel(modelB);
  check('after Soft then Hard, the FINAL setAggregateIsolation entry for the shared modelB includes Soft\'s own dbId (31)',
    modelBFinal.ids.includes(31), true);
  check('...and ALSO includes Hard\'s own dbId (30) -- a true union, not a replacement (mirror direction)',
    modelBFinal.ids.includes(30), true);
  check('modelC (Soft Clash only) is still isolated after Hard Clash runs', lastCallForModel(modelC).ids.includes(50), true);
  check('_isolatedModels reflects the full union of models touched by either action (A, B, C), mirror direction',
    ext._isolatedModels.size, 3);
}

// === [narrow fix, post-Batch-3] Clearing/failing one mode leaves the other mode's isolation intact:
// Hard Clash succeeds, then Soft Clash genuinely fails (throws) -- Hard Clash's own isolation must
// still be applied afterward, not cleared ==============================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return {
        pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Clashes').target();
  check('setup: Hard Clash isolated both models', ext._isolatedModels.size, 2);

  world.findClashes = async () => { throw new Error('soft clash blew up'); };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Soft Clashes').target();

  const lastCallForModel = (model) => aggCalls.at(-1)?.find((e) => e.model === model);
  check('after a genuine Soft Clash failure, Hard Clash\'s own modelB isolation is STILL applied (not cleared)',
    lastCallForModel(modelB)?.ids.includes(30), true);
  check('_isolatedModels still has both models Hard Clash isolated', ext._isolatedModels.size, 2);
  check('_isolatedModels still has modelA', ext._isolatedModels.has(modelA), true);
  check('_isolatedModels still has modelB', ext._isolatedModels.has(modelB), true);
}

// === Mirror direction: Soft Clash succeeds, then Hard Clash resolves with zero pairs -- Soft Clash's
// own isolation must survive =============================================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'clearance') {
      return {
        pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } }],
        statistics: { diagnostics: [] },
      };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup (mirror): Soft Clash isolated both models', ext._isolatedModels.size, 2);

  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [] } }); // Hard Clash: zero pairs
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Clashes').target();

  const lastCallForModel = (model) => aggCalls.at(-1)?.find((e) => e.model === model);
  check('after Hard Clash resolves with zero pairs, Soft Clash\'s own modelB isolation is STILL applied (mirror direction)',
    lastCallForModel(modelB)?.ids.includes(31), true);
  check('_isolatedModels still has both models Soft Clash isolated (mirror direction)', ext._isolatedModels.size, 2);
}

// === [narrow fix, post-Batch-3] Clearing both restores normal Viewer visibility: after both actions
// have contributed isolation, driving both to empty (via unload()) triggers exactly one
// setAggregateIsolation([]) call -- the documented clear-all case -- and leaves _isolatedModels empty =
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return {
        pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
        statistics: { diagnostics: [] },
      };
    }
    return {
      pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } }],
      statistics: { diagnostics: [] },
    };
  };
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Clashes').target();
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup: both models are isolated before clearing', ext._isolatedModels.size, 2);

  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  ext.unload();

  check('unload() triggers exactly one setAggregateIsolation call', aggCalls.length, 1);
  check('that call\'s array is empty -- both modelA and modelB are un-isolated in one clear-all call',
    aggCalls[0]?.length, 0);
  check('_isolatedModels is empty after both actions\' contributions are cleared together', ext._isolatedModels.size, 0);
}

// === [narrow fix, post-Batch-3, codex-advisor follow-up] _reconcileIsolation() correctly handles BOTH
// a replaced (not merely added) contribution for a model already in the union, AND a model dropping
// out of the union entirely once both actions clear it -- not just the "one action never touches a
// model" cases the tests above already cover ===========================================================
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  // Hard contributes modelB:{30}; Soft contributes modelB:{31}.
  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }], statistics: { diagnostics: [] } };
    }
    return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } }], statistics: { diagnostics: [] } };
  };
  const menu1 = [];
  ext.onContextMenu(menu1, {});
  await menu1.find((m) => m.title === 'Find Clashes').target();
  await menu1.find((m) => m.title === 'Find Soft Clashes').target();

  // Hard now REPLACES its own contribution for modelB with a different dbId (32, not 30) -- a fresh
  // Find Clashes run, not merely an additional one.
  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 32, model: modelB } }], statistics: { diagnostics: [] } };
    }
    return { pairs: [], statistics: { diagnostics: [] } };
  };
  const menu2 = [];
  ext.onContextMenu(menu2, {});
  await menu2.find((m) => m.title === 'Find Clashes').target();

  const lastCallForModelB = aggCalls.at(-1)?.find((e) => e.model === modelB);
  check('after Hard replaces its own contribution, the final setAggregateIsolation entry for modelB no longer includes the OLD dbId 30',
    lastCallForModelB.ids.includes(30), false);
  check('...still includes Soft\'s own untouched dbId 31', lastCallForModelB.ids.includes(31), true);
  check('...and includes Hard\'s NEW dbId 32', lastCallForModelB.ids.includes(32), true);

  // Now clear BOTH actions' own contributions for modelB entirely (Hard: zero pairs; Soft: genuine
  // failure) -- modelB (and everything else) must drop out of the union entirely, folded into the
  // aggregate call's own full-replace semantics (no separate per-model "un-isolate" entry needed).
  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') return { pairs: [], statistics: { diagnostics: [] } };
    throw new Error('soft clash blew up (removal test)');
  };
  const menu3 = [];
  ext.onContextMenu(menu3, {});
  await menu3.find((m) => m.title === 'Find Clashes').target();
  await menu3.find((m) => m.title === 'Find Soft Clashes').target();

  check('once both actions\' own contributions for modelB are gone, the final setAggregateIsolation call\'s array no longer has a modelB entry at all',
    aggCalls.at(-1)?.some((e) => e.model === modelB), false);
  check('...and that final call\'s array is empty entirely (both actions fully cleared)', aggCalls.at(-1)?.length, 0);
  check('_isolatedModels no longer includes modelB once both actions have dropped it', ext._isolatedModels.has(modelB), false);
}

// === [Task 1, M3-adjacent aggregate-isolation fix] `_reconcileIsolation()` now makes exactly ONE
// `viewer.setAggregateIsolation(isolation)` call per reconcile, replacing the old per-model
// `viewer.isolate()` loop (and its own separate drop-out loop) this file's own now-removed
// "commits its bookkeeping INCREMENTALLY" tests exercised. With only one Viewer call, there is no
// more partial-loop failure mode to prove `_isolatedModels` survives correctly -- the call either
// throws (nothing was committed to the Viewer, so `_isolatedModels` is left at its PRIOR value) or
// succeeds (everything in `isolation` was committed atomically, so `_isolatedModels` becomes exactly
// the union's own key set). These two tests drive `_reconcileIsolation()` directly (setting the two
// contribution Maps and calling it), mirroring the removed tests' own direct-call pattern.

// (a) Happy path: after a non-empty union, `_isolatedModels` equals the union's own key set.
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2), modelC = makeMockModel(3);
  viewer.setAggregateIsolation = () => {};
  ext._hardIsolationByModel = new Map([[modelA, new Set([10])], [modelB, new Set([20])]]);
  ext._softIsolationByModel = new Map([[modelB, new Set([21])], [modelC, new Set([30])]]);
  ext._reconcileIsolation();
  check('happy path: _isolatedModels is exactly the union key set', ext._isolatedModels.size, 3);
  check('happy path: every union model is recorded',
    [modelA, modelB, modelC].every((m) => ext._isolatedModels.has(m)), true);

  ext._hardIsolationByModel = new Map();
  ext._softIsolationByModel = new Map();
  ext._reconcileIsolation();
  check('happy path: clearing both contributions empties _isolatedModels', ext._isolatedModels.size, 0);
}

// (b) Throw path: a throwing setAggregateIsolation() propagates uncaught AND `_isolatedModels` is left
// completely unchanged from whatever it was before the failing call -- seeded here with a prior
// successful reconcile so the test can prove the failing call didn't touch it.
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2), modelC = makeMockModel(3);

  // Seed a prior successful reconcile: modelA and modelB isolated.
  viewer.setAggregateIsolation = () => {};
  ext._hardIsolationByModel = new Map([[modelA, new Set([10])], [modelB, new Set([20])]]);
  ext._reconcileIsolation();
  check('setup: a clean reconcile records both models', ext._isolatedModels.size, 2);
  const isolatedModelsBefore = new Set(ext._isolatedModels);

  // Now a fresh reconcile (replacing Hard's contribution with modelC only) fails entirely.
  viewer.setAggregateIsolation = () => { throw new Error('setAggregateIsolation blew up'); };
  ext._hardIsolationByModel = new Map([[modelC, new Set([30])]]);
  let threw = false;
  try { ext._reconcileIsolation(); } catch { threw = true; }

  check('throw path: the setAggregateIsolation() failure still propagates uncaught (no swallow/retry added)', threw, true);
  check('throw path: _isolatedModels is completely unchanged from before the failing call (same size)',
    ext._isolatedModels.size, isolatedModelsBefore.size);
  check('throw path: _isolatedModels still has modelA (nothing committed to the Viewer, so nothing changed)',
    ext._isolatedModels.has(modelA), true);
  check('throw path: _isolatedModels still has modelB', ext._isolatedModels.has(modelB), true);
  check('throw path: _isolatedModels does NOT have modelC -- the failing call never got committed',
    ext._isolatedModels.has(modelC), false);
}

// === [Task 1, M3-adjacent aggregate-isolation fix] regression coverage for the switch to
// `viewer.setAggregateIsolation` -- multi-model Hard+Soft union applied as ONE aggregate call, one
// mode's clear preserving the other's contribution, and clearing both restoring the full aggregate
// view (`setAggregateIsolation([])`, the documented clear-all case). ===================================

// (1) Multi-model Hard + Soft union applied as one aggregate operation.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  // Hard Clash's own pair is entirely within modelA (source dbId 10, target dbId 11) -> Hard
  // contributes modelA:{10,11}. Soft Clash's own pair spans modelA (source dbId 10) and modelB
  // (target dbId 20) -> Soft contributes modelA:{10}, modelB:{20}. The union genuinely spans two
  // models, per the brief's own "Hard on modelA, Soft on modelB" scenario.
  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 1, dbId: 11, model: modelA } }], statistics: { diagnostics: [] } };
    }
    return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 20, model: modelB } }], statistics: { diagnostics: [] } };
  };
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Clashes').target(); // Hard: isolates modelA:{10,11}
  await menu.find((m) => m.title === 'Find Soft Clashes').target(); // Soft: isolates modelA:{10} + modelB:{20}

  // Each action's own reconcile fires its own setAggregateIsolation call (2 total across the two
  // actions) -- the relevant one for this assertion is the LAST call, which reflects the full union
  // of both actions' own contributions applied as ONE aggregate operation.
  check('two reconciles fired (one per action), each its own single setAggregateIsolation call', aggCalls.length, 2);
  const lastCall = aggCalls.at(-1);
  check('that call\'s array has exactly one entry per model in the union (modelA, modelB)', lastCall.length, 2);
  const forA = lastCall.find((e) => e.model === modelA);
  const forB = lastCall.find((e) => e.model === modelB);
  check('modelA\'s entry carries the correctly-unioned dbIds from BOTH actions (Hard\'s 10,11 and Soft\'s own 10)',
    forA?.ids.slice().sort().join(','), '10,11');
  check('modelB\'s entry carries Soft\'s own dbId', forB?.ids.slice().sort().join(','), '20');
}

// (2) Clearing one mode preserves the other mode's model/dbId isolation.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  // Hard contributes modelA:{10} + modelB:{30}; Soft contributes modelA:{10} + modelB:{31} -- a
  // DISTINCT dbId on the shared modelB (both actions also touch the common source model modelA),
  // so clearing Hard only must leave Soft's own untouched model/dbIds -- both modelA's and modelB's --
  // fully intact, with only Hard's own dbId 30 gone.
  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }], statistics: { diagnostics: [] } };
    }
    return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 31, model: modelB } }], statistics: { diagnostics: [] } };
  };
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Clashes').target();
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup: both modelA and modelB are isolated before clearing Hard', ext._isolatedModels.size, 2);
  aggCalls.length = 0;

  // Clear Hard Clash's own contribution only -- Soft's own model/dbId isolation must survive untouched.
  ext._setHardIsolation(new Map());

  check('clearing Hard triggers exactly one setAggregateIsolation call', aggCalls.length, 1);
  const afterClear = aggCalls[0];
  const forA = afterClear.find((e) => e.model === modelA);
  const forB = afterClear.find((e) => e.model === modelB);
  check('Soft\'s own modelA entry is still present, untouched', forA?.ids.includes(10), true);
  check('Soft\'s own modelB entry is still present, untouched', forB?.ids.includes(31), true);
  check('Hard\'s own dbId 30 for modelB is gone', forB?.ids.includes(30), false);
  check('the array has exactly Soft\'s own two remaining entries (modelA, modelB)', afterClear.length, 2);
}

// (3) Clearing both restores the full aggregate view -- setAggregateIsolation([]), the documented
// clear-all case.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  const aggCalls = [];
  viewer.setAggregateIsolation = (isolation) => aggCalls.push(isolation.map((e) => ({ model: e.model, ids: [...e.ids] })));
  viewer.fitToView = () => {};
  ext._addMarkers = () => {};

  world.findClashes = async (query) => {
    if (query.mode === 'volume-overlap') {
      return { pairs: [], statistics: { diagnostics: [] } };
    }
    return { pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 20, model: modelB } }], statistics: { diagnostics: [] } };
  };
  const menu = [];
  ext.onContextMenu(menu, {});
  await menu.find((m) => m.title === 'Find Clashes').target();
  await menu.find((m) => m.title === 'Find Soft Clashes').target();
  check('setup: both models are isolated before clearing both', ext._isolatedModels.size, 2);
  aggCalls.length = 0;

  ext._clearIsolation();

  check('clearing both triggers exactly one setAggregateIsolation call', aggCalls.length, 1);
  check('that call\'s array is empty -- setAggregateIsolation([]), the documented clear-all case',
    aggCalls[0]?.length, 0);
  check('_isolatedModels is empty after clearing both', ext._isolatedModels.size, 0);
}

// (4) No per-model `viewer.isolate(...)` call sites remain in the reconciliation path -- a source-text
// regression guard mirroring this file's own existing "never imports the npm three package" pattern.
{
  const source = await readFile(new URL('../wwwroot/extensions/ClashFinderExtension.js', import.meta.url), 'utf8');
  check('ClashFinderExtension.js contains no this._viewer.isolate( call site',
    /this\._viewer\.isolate\(/.test(source), false);
  check('ClashFinderExtension.js DOES call this._viewer.setAggregateIsolation(',
    /this\._viewer\.setAggregateIsolation\(/.test(source), true);
}

// === r71/r185 isolation: Soft Clash's own visualization code never imports the npm "three" package --
// permanent regression guard, mirroring test/ClashFinderExtension.test.mjs's own identical check ====
{
  const source = await readFile(new URL('../wwwroot/extensions/ClashFinderExtension.js', import.meta.url), 'utf8');
  check('ClashFinderExtension.js never imports the collision library\'s r185 three package (ESM from-clause)',
    /from\s+['"]three['"]/.test(source), false);
  check('ClashFinderExtension.js never requires the three package (CJS require)',
    /require\(['"]three['"]\)/.test(source), false);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
