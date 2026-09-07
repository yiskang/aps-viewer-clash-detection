// test/ClashFinderExtension.test.mjs
//
// Task 15 fixtures, mirroring test/RoomLocatorExtension.test.mjs's own headless-Node conventions
// (bare `check()` counter harness, no test framework, a `_world` test seam that bypasses
// CollisionWorld.fromViewer/load() entirely). Scope: the context-menu enabling condition (aggregate
// selection shape), the exact findClashes query built from viewer.getAllModels(), same/cross-model
// classification by object identity, isolate/fitToView Model-grouping, clear/restore semantics,
// diagnostics caveats, and the concurrency/staleness token guard (codex-review Question #2).
//
// Task 8 (M2.1) additions below: witness marker overlay coverage (_ensureMarkerOverlay,
// _computeMarkerRadius, _addMarkers, _clearMarkers). These need a fake `window.THREE` -- Node has
// no `window` global and this repo must never import the npm `three` package into
// ClashFinderExtension.js -- so this file installs a minimal-but-arithmetically-faithful THREE
// fixture (see "fake window.THREE" section below) rather than stubbing the math away.
import { readFile } from 'node:fs/promises';
import { ClashFinderExtension, EXTENSION_ID } from '../wwwroot/extensions/ClashFinderExtension.js';
import { EXTENSION_ID as ROOM_LOCATOR_EXTENSION_ID } from '../wwwroot/extensions/RoomLocatorExtension.js';

let passes = 0, failures = 0;
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  ok ? passes++ : failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}${note ? `  (${note})` : ''}`);
}

// A fake CollisionWorld exposing ONLY the public surface ClashFinderExtension may touch. Unlike
// RoomLocatorExtension's own fake, ClashFinderExtension never calls admitModel/isLeaseValid itself
// (findClashes's own internal admission handles that) — only findClashes, evictModel, and dispose.
function makeFakeWorld() {
  let disposed = false;
  return {
    findClashes: async () => ({ pairs: [], statistics: { diagnostics: [] } }),
    evictModel(model) { /* no-op unless overridden per test */ },
    dispose() { disposed = true; },
    _isDisposed: () => disposed,
  };
}

// A minimal `viewer.overlays.*` mock covering the exact public facade Task 7 finding 1 identified
// as the correct API (not the internal viewer.impl.* path): addScene/hasScene/addMesh/removeMesh/
// clearScene/removeScene. Tracks scene names and their meshes in a plain Map so tests can assert on
// both "does the scene exist" and "which meshes are in it" without reaching into Viewer internals.
function makeMockOverlays() {
  const scenes = new Map(); // sceneName -> Set<mesh>
  return {
    _scenes: scenes, // test-only introspection seam, not part of the real viewer.overlays surface
    hasScene(name) { return scenes.has(name); },
    addScene(name) { if (!scenes.has(name)) scenes.set(name, new Set()); },
    addMesh(name, mesh) { scenes.get(name)?.add(mesh); },
    removeMesh(name, mesh) { scenes.get(name)?.delete(mesh); },
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

// `boxesByDbId` is an optional `{ [dbId]: { min: [x,y,z], max: [x,y,z] } }` map, consumed only by
// the marker-radius tests below via `getInstanceTree().getNodeBox(dbId, dst)`. Every other existing
// call site in this file passes only `id` and is unaffected.
function makeMockModel(id, { boxesByDbId = {} } = {}) {
  return {
    id,
    getInstanceTree() {
      return {
        // Source-verified against the pinned Viewer 7.124.2 bundle (viewer3D.js,
        // ObjectTree.prototype.getNodeBox / InstanceTreeAccess.prototype.getNodeBox): `dst` is a
        // FLAT 6-number array (min-x,min-y,min-z,max-x,max-y,max-z), never a THREE.Box3 -- Task 7's
        // own recorded finding 6 assumed the latter, which this mock deliberately does NOT match,
        // so a `_computeMarkerRadius` implementation that mishandles the real shape fails here too.
        getNodeBox(dbId, dst) {
          const box = boxesByDbId[dbId];
          if (!box) return;
          dst[0] = box.min[0]; dst[1] = box.min[1]; dst[2] = box.min[2];
          dst[3] = box.max[0]; dst[4] = box.max[1]; dst[5] = box.max[2];
        },
      };
    },
  };
}

// === fake window.THREE — the r71 subset ClashFinderExtension.js touches ===========================
// Node has no `window` global and this file must never import the npm `three` package (r185, the
// collision library's own dependency) -- installing a real THREE build here would risk exactly the
// confusion Global Constraints forbid in the production file. Vector3/Box3/Sphere reproduce real
// r71 arithmetic (union, getCenter, size, getBoundingSphere, setFromArray, isEmpty) exactly as
// source-verified against the pinned Viewer 7.124.2 bundle, so radius-clamping math is exercised
// faithfully rather than stubbed to a constant.
class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
}

class FakeSphere {
  constructor() { this.center = new FakeVector3(); this.radius = 0; }
}

class FakeBox3 {
  constructor() {
    this.min = new FakeVector3(Infinity, Infinity, Infinity);
    this.max = new FakeVector3(-Infinity, -Infinity, -Infinity);
  }
  union(box) { this.min.min(box.min); this.max.max(box.max); return this; }
  isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
  setFromArray(array, offset = 0) {
    this.min.set(array[offset], array[offset + 1], array[offset + 2]);
    this.max.set(array[offset + 3], array[offset + 4], array[offset + 5]);
    return this;
  }
  getCenter(target = new FakeVector3()) { return target.addVectors(this.min, this.max).multiplyScalar(0.5); }
  size(target = new FakeVector3()) { return target.subVectors(this.max, this.min); }
  getBoundingSphere(target = new FakeSphere()) {
    target.center = this.getCenter();
    target.radius = this.size().length() * 0.5;
    return target;
  }
}

class FakeSphereGeometry {
  constructor(radius, widthSegments, heightSegments) {
    this.radius = radius; this.widthSegments = widthSegments; this.heightSegments = heightSegments;
  }
}

class FakeMeshBasicMaterial {
  constructor(params) { Object.assign(this, params); }
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

// Installed once, at module load -- `node --test` runs each `*.test.mjs` file in its own process
// (isolation: 'process' is the default), so this global does not leak into other test files in the
// same `npm test` run.
globalThis.window = globalThis.window ?? {};
globalThis.window.THREE = {
  Vector3: FakeVector3,
  Box3: FakeBox3,
  Sphere: FakeSphere,
  SphereGeometry: FakeSphereGeometry,
  MeshBasicMaterial: FakeMeshBasicMaterial,
  Mesh: FakeMesh,
};

function extensionWithFakeWorld(viewer = makeMockViewer()) {
  const ext = new ClashFinderExtension(viewer, {});
  const world = makeFakeWorld();
  ext._world = world; // test seam: bypass fromViewer/load() to inject a controllable fake world
  return { ext, viewer, world };
}

// Captures whatever `_notifyUser` puts in front of the user, matching RoomLocatorExtension's own
// fixture: this headless process has no `alert` global, exactly why the production helper falls
// back to console.warn.
async function withCapturedAlerts(body) {
  const alerts = [];
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'alert');
  const original = globalThis.alert;
  globalThis.alert = (message) => alerts.push(message);
  try { await body(alerts); } finally {
    if (had) globalThis.alert = original; else delete globalThis.alert;
  }
  return alerts;
}

// === EXTENSION_ID is a distinct string literal from RoomLocatorExtension's own ===================
check('EXTENSION_ID is exactly Autodesk.Sandbox.ClashFinder', EXTENSION_ID, 'Autodesk.Sandbox.ClashFinder');
check('EXTENSION_ID is distinct from RoomLocatorExtension.EXTENSION_ID', EXTENSION_ID !== ROOM_LOCATOR_EXTENSION_ID, true);

// === context-menu entry appears only when aggregate selection is exactly one model, one dbId =====
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [42] }];
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  check('menu entry appears for exactly one model, one dbId', menu.length, 1);
  check('menu entry title is "Find Clashes"', menu[0]?.title, 'Find Clashes');
}

// === context-menu entry does NOT appear for no selection ==========================================
{
  const { ext, viewer } = extensionWithFakeWorld();
  viewer.getAggregateSelection = () => [];
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: false });
  check('no menu entry for empty aggregate selection', menu.length, 0);
}

// === context-menu entry does NOT appear for multiple models or multiple dbIds selected ============
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [
    { model: modelA, selection: [1] },
    { model: modelB, selection: [2] },
  ];
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  check('no menu entry when aggregate selection spans multiple models', menu.length, 0);
}
{
  const { ext, viewer } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1, 2] }];
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  check('no menu entry when one model has multiple dbIds selected', menu.length, 0);
}

// === Find Clashes calls findClashes with targets built from viewer.getAllModels() =================
// Source exclusion is NOT the extension's job (CollisionWorld's own source self-exclusion handles
// it internally) -- the source's own model must appear in targets, unfiltered.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [42] }];
  viewer.getAllModels = () => [modelA, modelB];
  let capturedQuery = null;
  world.findClashes = async (query) => { capturedQuery = query; return { pairs: [], statistics: { diagnostics: [] } }; };
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('source.model is the selected entry\'s model', capturedQuery.source.model === modelA, true);
  check('source.dbIds is exactly [selected dbId]', capturedQuery.source.dbIds.join(','), '42');
  check('target.targets built from EVERY loaded model, source model NOT manually filtered out',
    capturedQuery.target.targets.map((t) => (t.model === modelA ? 'A' : t.model === modelB ? 'B' : '?')).join(','), 'A,B');
  check('target.targets entries omit dbIds (whole-model scope)',
    capturedQuery.target.targets.every((t) => !('dbIds' in t)), true);
  check('mode is the fixed volume-overlap Hard Clash mode', capturedQuery.mode, 'volume-overlap');
  check('groupBy is dbId', capturedQuery.groupBy, 'dbId');
  check('broadPhase is not explicitly passed (left to default)', 'broadPhase' in capturedQuery, false);
}

// === "<N> clashes found" / "No clashes found" reporting matches result.pairs.length ===============
// Spec §2 step 11: this report is UNCONDITIONAL on every Find Clashes call -- unlike
// RoomLocatorExtension's own silent-on-clean-success convention, "No clashes found" / "<N> clashes
// found" is always surfaced, with the diagnostics caveat (step 12) only ever ADDITIVE to it.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA];
  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [] } });
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('zero pairs, no diagnostics: reports exactly "No clashes found." with no caveat appended', notified, 'No clashes found.');
}
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA];
  const modelB = makeMockModel(2);
  world.findClashes = async () => ({
    pairs: [
      { source: { modelId: 1, dbId: 1, model: modelA }, target: { modelId: 1, dbId: 2, model: modelA } },
      { source: { modelId: 1, dbId: 1, model: modelA }, target: { modelId: 2, dbId: 3, model: modelB } },
    ],
    statistics: { diagnostics: [] },
  });
  let notified = '';
  viewer.getAllModels = () => [modelA, modelB];
  const originalNotify = ext._notifyUser.bind(ext);
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('report reflects result.pairs.length (2 clashes found)', /^2 clashes found/.test(notified), true);
  ext._notifyUser = originalNotify;
}

// === same-model vs cross-model classification compares pair.target.model by ===, never modelId ===
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(7); // deliberately SAME numeric id as modelB below
  const modelB = makeMockModel(7); // same modelId, DIFFERENT object -- a modelId-based compare would misclassify
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [
      { source: { modelId: 7, dbId: 1, model: modelA }, target: { modelId: 7, dbId: 2, model: modelA } }, // same-model (same OBJECT)
      { source: { modelId: 7, dbId: 1, model: modelA }, target: { modelId: 7, dbId: 3, model: modelB } }, // cross-model (same modelId, different object)
    ],
    statistics: { diagnostics: [] },
  });
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('classification by object identity: 1 same-model + 1 cross-model despite identical modelId values',
    notified, '2 clashes found (1 in this model, 1 in other models)');
}

// === isolate/fitToView are called per involved Model object, always with an explicit model arg ====
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA];
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 1, dbId: 20, model: modelA } }],
    statistics: { diagnostics: [] },
  });
  const isolateCalls = [], fitToViewCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = (dbIds, model) => fitToViewCalls.push({ dbIds: [...dbIds], model });
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('isolate called exactly once (single involved model)', isolateCalls.length, 1);
  check('isolate call carries an explicit model arg, even for the single-model case (Critical #4)',
    isolateCalls[0]?.model === modelA, true);
  check('isolate dbIds include both the source element and the clashing element',
    isolateCalls[0]?.dbIds.slice().sort().join(','), '10,20');
  check('fitToView called exactly once, mirroring isolate', fitToViewCalls.length, 1);
  check('fitToView call carries an explicit model arg', fitToViewCalls[0]?.model === modelA, true);
}
{
  // Two distinct models involved -- one isolate/fitToView pair PER Model object.
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target();
  check('isolate called once per involved Model object (source model + target model)', isolateCalls.length, 2);
  const forA = isolateCalls.find((c) => c.model === modelA);
  const forB = isolateCalls.find((c) => c.model === modelB);
  check('modelA isolate carries only the source dbId', forA?.dbIds.join(','), '10');
  check('modelB isolate carries only the clashing dbId', forB?.dbIds.join(','), '30');
}

// === clearing/restoring visualization calls viewer.isolate([], model) per involved model ==========
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  viewer.getAllModels = () => [modelA, modelB];
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target(); // first call: isolates modelA + modelB
  isolateCalls.length = 0; // reset observation window

  // Second call: a clean negative result. Must clear the PREVIOUSLY isolated models (A and B),
  // even though this call itself produces no new isolation.
  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [] } });
  const menu2 = [];
  ext.onContextMenu(menu2, { hasSelected: true });
  await menu2[0].target();
  const clears = isolateCalls.filter((c) => c.dbIds.length === 0).map((c) => c.model);
  check('a "No clashes found" outcome clears every previously-isolated model', clears.length, 2);
  check('previously-isolated modelA is cleared via isolate([], modelA)', clears.includes(modelA), true);
  check('previously-isolated modelB is cleared via isolate([], modelB)', clears.includes(modelB), true);
}

// === non-empty diagnostics surface a visible caveat, on BOTH empty and non-empty outcomes =========
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA];
  const diagnostics = [{ scope: 'pair', reason: 'crossing-budget-exhausted' }];
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 1, model: modelA }, target: { modelId: 1, dbId: 2, model: modelA } }],
    statistics: { diagnostics },
  });
  const alerts = await withCapturedAlerts(async () => {
    const menu = [];
    ext.onContextMenu(menu, { hasSelected: true });
    await menu[0].target();
  });
  check('non-empty diagnostics on a NON-EMPTY result surfaces a visible caveat', alerts.length, 1);
  check('the caveat says the result may be incomplete', /may be incomplete/.test(alerts[0] || ''), true);
  check('the caveat names the diagnostic reason', /crossing-budget-exhausted/.test(alerts[0] || ''), true);
  check('describeDiagnostics summarizes count + distinct reasons',
    ClashFinderExtension.describeDiagnostics(diagnostics), '1 diagnostic(s): crossing-budget-exhausted');
}
{
  // ...and the empty-result + diagnostics case must NOT read as a plain "no clashes found".
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [1] }];
  viewer.getAllModels = () => [modelA];
  world.findClashes = async () => ({ pairs: [], statistics: { diagnostics: [{ scope: 'fragment', reason: 'geometry-not-yet-available' }] } });
  const alerts = await withCapturedAlerts(async () => {
    const menu = [];
    ext.onContextMenu(menu, { hasSelected: true });
    await menu[0].target();
  });
  check('empty result + diagnostics is NOT reported as a bare "no clashes found"', alerts.length, 1);
  check('the empty-result caveat still names the reason', /geometry-not-yet-available/.test(alerts[0] || ''), true);
}

// === a stale in-flight Find Clashes result never overwrites a NEWER selection's visualization =====
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAllModels = () => [modelA, modelB];

  const pending = [];
  world.findClashes = (query) => new Promise((resolve) => { pending.push({ query, resolve }); });

  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const alerts = [];
  ext._notifyUser = (message) => { alerts.push(message); };

  // First (older, slower) action: select dbId 10 in modelA.
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  const menu1 = [];
  ext.onContextMenu(menu1, { hasSelected: true });
  const promise1 = menu1[0].target(); // starts findClashes call #1, suspends at its own await

  // Second (newer, faster) action fires BEFORE call #1 resolves: select dbId 20 in modelA.
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [20] }];
  const menu2 = [];
  ext.onContextMenu(menu2, { hasSelected: true });
  const promise2 = menu2[0].target(); // starts findClashes call #2, suspends at its own await

  check('both stale and fresh calls actually reached findClashes', pending.length, 2);

  // The NEWER call (#2) resolves first and its effects must be observable.
  pending[1].resolve({
    pairs: [{ source: { modelId: 1, dbId: 20, model: modelA }, target: { modelId: 2, dbId: 99, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  await promise2;
  check('newer call\'s isolate effects ARE observable', isolateCalls.some((c) => c.dbIds.includes(20)), true);
  const isolateCountAfterNewer = isolateCalls.length;
  const alertCountAfterNewer = alerts.length;

  // The OLDER call (#1) finally resolves LATE, after being superseded -- its isolate/fitToView/notify
  // must NOT run at all: no error, no notify, no isolate/fitToView call.
  pending[0].resolve({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 1, dbId: 11, model: modelA } }],
    statistics: { diagnostics: [] },
  });
  await promise1;
  check('a superseded (stale) resolution adds NO further isolate/fitToView calls', isolateCalls.length, isolateCountAfterNewer);
  check('a superseded (stale) resolution triggers NO notify call', alerts.length, alertCountAfterNewer);
  check('a superseded (stale) resolution never isolates the OLD dbId 10', isolateCalls.some((c) => c.dbIds.includes(10)), false);
}

// === [review fix, codex-review Important #2] a genuine (non-superseded) rejection clears prior
// isolation and surfaces a visible failure -- distinct from the superseded-call case above, where
// silence is correct because nothing actually failed.
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAllModels = () => [modelA, modelB];
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const menu1 = [];
  ext.onContextMenu(menu1, { hasSelected: true });
  await menu1[0].target(); // succeeds: isolates modelA + modelB
  check('setup: first query isolated 2 models', isolateCalls.filter((c) => c.dbIds.length > 0).length, 2);
  isolateCalls.length = 0;

  // Second query (same or different element) genuinely FAILS -- not superseded by anything.
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [11] }];
  const boom = new Error('collision engine exploded');
  world.findClashes = async () => { throw boom; };
  let notified = '';
  ext._notifyUser = (message) => { notified = message; };
  const menu2 = [];
  ext.onContextMenu(menu2, { hasSelected: true });
  await menu2[0].target();

  const clears = isolateCalls.filter((c) => c.dbIds.length === 0).map((c) => c.model);
  check('a genuine failure clears the PRIOR query\'s isolation (not left looking like this query\'s result)', clears.length, 2);
  check('the failure surfaces a VISIBLE notification, not just console.error', /Find Clashes failed/.test(notified), true);
  check('the failure notification names the underlying error', /collision engine exploded/.test(notified), true);
}

// === unload() ordering: dispose(), then listener/menu removal =====================================
{
  const { ext, world } = extensionWithFakeWorld();
  const order = [];
  world.dispose = () => order.push('dispose');
  ext._viewer.removeEventListener = () => order.push('removeEventListener');
  ext._viewer.unregisterContextMenuCallback = () => order.push('unregisterContextMenuCallback');
  ext.unload();
  check('unload() order: dispose first, then listener+menu removal', order.join(','), 'dispose,removeEventListener,unregisterContextMenuCallback');
}

// === [review fix, codex-review Important #3] unload() hardening: listener/menu removal still
// happens even when dispose() throws (a repeated unload() call, matching RoomLocatorExtension's own
// documented "accepted, imperfect" scenario -- hardened here rather than carried over verbatim). ===
{
  const { ext, world } = extensionWithFakeWorld();
  const order = [];
  world.dispose = () => { order.push('dispose'); throw new Error('WorldDisposedError: already disposed'); };
  ext._viewer.removeEventListener = () => order.push('removeEventListener');
  ext._viewer.unregisterContextMenuCallback = () => order.push('unregisterContextMenuCallback');
  let thrown = null;
  try { ext.unload(); } catch (err) { thrown = err; }
  check('a throwing dispose() still lets listener/menu removal run (finally-based hardening)',
    order.join(','), 'dispose,removeEventListener,unregisterContextMenuCallback');
  check('dispose()\'s own exception still propagates to the caller (not swallowed)', thrown?.message, 'WorldDisposedError: already disposed');
}

// === [review fix, codex-review Important #3] unload() clears every previously-isolated model ======
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1), modelB = makeMockModel(2);
  viewer.getAllModels = () => [modelA, modelB];
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  world.findClashes = async () => ({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 2, dbId: 30, model: modelB } }],
    statistics: { diagnostics: [] },
  });
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  await menu[0].target(); // isolates modelA + modelB
  isolateCalls.length = 0;
  ext.unload();
  const clears = isolateCalls.filter((c) => c.dbIds.length === 0).map((c) => c.model);
  check('unload() clears every model this extension had isolated', clears.length, 2);
  check('unload() clears modelA', clears.includes(modelA), true);
  check('unload() clears modelB', clears.includes(modelB), true);
}

// === [review fix, codex-review Important #3] unload()-vs-resolved-promise race: a findClashes call
// that RESOLVED before unload() ran, but whose continuation had not yet executed (a pending
// microtask), must see a stale token once unload() has bumped it and apply NO isolate/fitToView/
// notify effects at all -- the extension already tore down by the time that continuation runs. =====
{
  const { ext, viewer, world } = extensionWithFakeWorld();
  const modelA = makeMockModel(1);
  viewer.getAllModels = () => [modelA];
  viewer.getAggregateSelection = () => [{ model: modelA, selection: [10] }];
  const isolateCalls = [];
  viewer.isolate = (dbIds, model) => isolateCalls.push({ dbIds: [...dbIds], model });
  viewer.fitToView = () => {};
  const alerts = [];
  ext._notifyUser = (message) => { alerts.push(message); };

  let capturedResolve;
  world.findClashes = () => new Promise((resolve) => { capturedResolve = resolve; });
  const menu = [];
  ext.onContextMenu(menu, { hasSelected: true });
  const promise = menu[0].target(); // suspends at its own await, inside findClashes

  // unload() runs BEFORE this in-flight call's continuation ever gets a chance to run.
  ext.unload();
  check('unload() bumped the action token before the pending call could resolve', ext._latestActionToken > 0, true);

  // The pending findClashes call finally resolves (successfully) AFTER unload() already tore down.
  capturedResolve({
    pairs: [{ source: { modelId: 1, dbId: 10, model: modelA }, target: { modelId: 1, dbId: 20, model: modelA } }],
    statistics: { diagnostics: [] },
  });
  await promise;
  check('a post-unload resolution applies NO isolate/fitToView calls', isolateCalls.length, 0);
  check('a post-unload resolution triggers NO notify call', alerts.length, 0);
}

// === BEFORE_MODEL_UNLOAD_EVENT handler evicts the model in the world ==============================
{
  const { ext, world } = extensionWithFakeWorld();
  const model = makeMockModel(99);
  let evicted = null;
  world.evictModel = (m) => { evicted = m; };
  ext._onBeforeModelUnload({ model });
  check('BEFORE_MODEL_UNLOAD_EVENT handler calls world.evictModel with the exact model object', evicted === model, true);
}
{
  const { ext } = extensionWithFakeWorld();
  let threw = false;
  try { ext._onBeforeModelUnload({}); } catch (err) { threw = /event\.model/.test(err.message); }
  check('BEFORE_MODEL_UNLOAD_EVENT handler fails clearly if event.model is ever undefined', threw, true);
}

// === Task 8 (M2.1): witness marker overlay ==========================================================

// === ClashFinderExtension.js never imports the npm three package — permanent regression guard,
// not a TDD-red step (the import genuinely doesn't exist before Task 8 either) ======================
{
  const source = await readFile(new URL('../wwwroot/extensions/ClashFinderExtension.js', import.meta.url), 'utf8');
  check('ClashFinderExtension.js never imports the collision library\'s r185 three package (ESM from-clause)',
    /from\s+['"]three['"]/.test(source), false);
  check('ClashFinderExtension.js never requires the three package (CJS require)',
    /require\(['"]three['"]\)/.test(source), false);
}

// === the marker overlay scene and shared geometry/material are created lazily, on first marker,
// not at construction =================================================================================
{
  const { ext, viewer } = extensionWithFakeWorld();
  check('marker overlay scene does not exist before any markers are added', viewer.overlays.hasScene('clash-finder-markers'), false);
  ext._addMarkers([{ witness: { kind: 'surface-crossing', point: [1, 2, 3] } }]);
  check('marker overlay scene is created lazily on the first _addMarkers call', viewer.overlays.hasScene('clash-finder-markers'), true);
  check('one active marker recorded for one witness-bearing pair', ext._activeMarkers.length, 1);
  check('the marker mesh was actually added to the overlay scene', viewer.overlays._scenes.get('clash-finder-markers').has(ext._activeMarkers[0]), true);
}

// === multiple markers share one geometry and one material instance — Global Constraint: no
// per-marker geometry/material duplication ============================================================
{
  const { ext } = extensionWithFakeWorld();
  ext._addMarkers([
    { witness: { kind: 'surface-crossing', point: [0, 0, 0] } },
    { witness: { kind: 'containment', point: [1, 1, 1] } },
  ]);
  check('two witness-bearing pairs produce two active markers', ext._activeMarkers.length, 2);
  check('all markers share the same geometry instance', ext._activeMarkers[0].geometry === ext._activeMarkers[1].geometry, true);
  check('all markers share the same material instance', ext._activeMarkers[0].material === ext._activeMarkers[1].material, true);
}

// === shared geometry/material are not recreated across separate _addMarkers calls, either =========
{
  const { ext } = extensionWithFakeWorld();
  ext._addMarkers([{ witness: { kind: 'surface-crossing', point: [0, 0, 0] } }]);
  const [geometry, material] = [ext._markerGeometry, ext._markerMaterial];
  ext._addMarkers([{ witness: { kind: 'containment', point: [1, 1, 1] } }]);
  check('shared geometry is not recreated on a second _addMarkers call', ext._markerGeometry === geometry, true);
  check('shared material is not recreated on a second _addMarkers call', ext._markerMaterial === material, true);
}

// === _ensureMarkerOverlay guards against re-registering the same scene name (Task 7 finding 1:
// the internal viewer.impl.createOverlayScene does NOT guard this; the public addScene does — this
// extension must still only call it once) =============================================================
{
  const { ext, viewer } = extensionWithFakeWorld();
  let addSceneCalls = 0;
  const originalAddScene = viewer.overlays.addScene.bind(viewer.overlays);
  viewer.overlays.addScene = (name) => { addSceneCalls += 1; originalAddScene(name); };
  ext._addMarkers([{ witness: { kind: 'surface-crossing', point: [0, 0, 0] } }]);
  ext._addMarkers([{ witness: { kind: 'containment', point: [1, 1, 1] } }]);
  check('addScene is called at most once across multiple _addMarkers calls', addSceneCalls, 1);
}

// === a null-witness ClashPair produces no marker =====================================================
{
  const { ext } = extensionWithFakeWorld();
  ext._addMarkers([{ witness: null }, { witness: { kind: 'containment', point: [1, 1, 1] } }]);
  check('a null-witness pair contributes no marker; only the witness-bearing pair does', ext._activeMarkers.length, 1);
}

// === when EVERY pair's witness is null, the overlay scene stays absent — "lazy" all the way
// through, not just on the very first call =============================================================
{
  const { ext, viewer } = extensionWithFakeWorld();
  ext._addMarkers([{ witness: null }]);
  check('overlay scene stays absent when no pair carries a witness', viewer.overlays.hasScene('clash-finder-markers'), false);
  check('_activeMarkers stays empty when no pair carries a witness', ext._activeMarkers.length, 0);
}

// === marker mesh position is set from witness.point ==================================================
{
  const { ext } = extensionWithFakeWorld();
  ext._addMarkers([{ witness: { kind: 'surface-crossing', point: [3, 4, 5] } }]);
  const [mesh] = ext._activeMarkers;
  check('marker mesh position.x matches witness.point[0]', mesh.position.x, 3);
  check('marker mesh position.y matches witness.point[1]', mesh.position.y, 4);
  check('marker mesh position.z matches witness.point[2]', mesh.position.z, 5);
}

// === marker radius is clamped between MIN_MARKER_RADIUS and MAX_MARKER_RADIUS regardless of
// scene scale — dbIdsByModel drives the bounding-sphere computation via getInstanceTree().getNodeBox,
// the exact shape _addMarkers's own dbIdsByModel argument has at its real onContextMenu call site ===
{
  const tinyModel = makeMockModel(101, { boxesByDbId: { 10: { min: [0, 0, 0], max: [0.0001, 0.0001, 0.0001] } } });
  const { ext } = extensionWithFakeWorld();
  const tinyRadius = ext._computeMarkerRadius(new Map([[tinyModel, new Set([10])]]));
  check('a tiny bounding geometry still clamps the radius UP to MIN_MARKER_RADIUS', tinyRadius >= ClashFinderExtension.MIN_MARKER_RADIUS, true);
  check('MIN_MARKER_RADIUS is exposed as a static class field', typeof ClashFinderExtension.MIN_MARKER_RADIUS, 'number');
}
{
  const bigModel = makeMockModel(102, { boxesByDbId: { 20: { min: [-100000, -100000, -100000], max: [100000, 100000, 100000] } } });
  const { ext } = extensionWithFakeWorld();
  const bigRadius = ext._computeMarkerRadius(new Map([[bigModel, new Set([20])]]));
  check('a huge (km-scale) bounding geometry still clamps the radius DOWN to MAX_MARKER_RADIUS', bigRadius <= ClashFinderExtension.MAX_MARKER_RADIUS, true);
  check('MAX_MARKER_RADIUS is exposed as a static class field', typeof ClashFinderExtension.MAX_MARKER_RADIUS, 'number');
}

// === _computeMarkerRadius correctly reads getNodeBox's real flat 6-number output (min-x,min-y,
// min-z,max-x,max-y,max-z), NOT a THREE.Box3 — source-verified against the pinned Viewer 7.124.2
// bundle; a wrong assumption here would silently compute an empty box (isEmpty() stays true) and
// never touch this branch, so this asserts the radius actually reflects the real box's size, not
// just that it lands in range ==========================================================================
{
  const model = makeMockModel(103, { boxesByDbId: { 30: { min: [0, 0, 0], max: [2, 2, 2] } } });
  const { ext } = extensionWithFakeWorld();
  const radius = ext._computeMarkerRadius(new Map([[model, new Set([30])]]));
  // bounding sphere of a [0,0,0]-[2,2,2] box: center (1,1,1), radius = sqrt(3*2^2)/2 = sqrt(12)/2 ≈ 1.732
  // MARKER_RADIUS_FRACTION (0.01 per the plan default) * 1.732 ≈ 0.0173, clamped up to MIN_MARKER_RADIUS
  check('a small-but-nonzero real box still clamps to MIN_MARKER_RADIUS (0.01 fraction of ~1.73 is below MIN)',
    radius, ClashFinderExtension.MIN_MARKER_RADIUS);
}

// === an empty dbIdsByModel (no dbIds at all) falls back to MIN_MARKER_RADIUS, not an
// Infinity-derived MAX_MARKER_RADIUS — an empty box has no real measurement to report ================
{
  const { ext } = extensionWithFakeWorld();
  check('an empty dbIdsByModel falls back to MIN_MARKER_RADIUS, never a misleading MAX', ext._computeMarkerRadius(new Map()), ClashFinderExtension.MIN_MARKER_RADIUS);
  check('_computeMarkerRadius defaults dbIdsByModel to empty when omitted entirely', ext._computeMarkerRadius(), ClashFinderExtension.MIN_MARKER_RADIUS);
}

// === _clearMarkers removes every active marker mesh from the overlay scene and resets state =======
{
  const { ext, viewer } = extensionWithFakeWorld();
  ext._addMarkers([
    { witness: { kind: 'surface-crossing', point: [0, 0, 0] } },
    { witness: { kind: 'containment', point: [1, 1, 1] } },
  ]);
  check('setup: two markers were added to the overlay scene', viewer.overlays._scenes.get('clash-finder-markers').size, 2);
  ext._clearMarkers();
  check('_clearMarkers empties _activeMarkers', ext._activeMarkers.length, 0);
  check('_clearMarkers removes every mesh from the overlay scene', viewer.overlays._scenes.get('clash-finder-markers').size, 0);
}

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
