// test/ClashFinderExtension.test.mjs
//
// Task 15 fixtures, mirroring test/RoomLocatorExtension.test.mjs's own headless-Node conventions
// (bare `check()` counter harness, no test framework, a `_world` test seam that bypasses
// CollisionWorld.fromViewer/load() entirely). Scope: the context-menu enabling condition (aggregate
// selection shape), the exact findClashes query built from viewer.getAllModels(), same/cross-model
// classification by object identity, isolate/fitToView Model-grouping, clear/restore semantics,
// diagnostics caveats, and the concurrency/staleness token guard (codex-review Question #2).
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

function makeMockViewer() {
  return {
    addEventListener() {}, removeEventListener() {},
    registerContextMenuCallback() {}, unregisterContextMenuCallback() {},
    getAggregateSelection() { return []; },
    getAllModels() { return []; },
    isolate() {}, fitToView() {},
  };
}

function makeMockModel(id) { return { id }; }

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

console.log(`\n  ${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
