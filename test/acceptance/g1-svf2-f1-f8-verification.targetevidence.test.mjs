// test/acceptance/g1-svf2-f1-f8-verification.targetevidence.test.mjs
//
// Offline tests for H3-R1 (bounded remediation): the SELECTED perturbation targets of the
// `wrong-owner` and `hidden-fragment` controls must survive the page->Node bridge and be persisted
// in the atomic durable result JSON as an additive top-level `controlTargets` carrier -- without
// changing the fixed ControlResult shape. Never launches a browser, never calls main().
// Fixtures (createPageRealm, buildSharedFixture, buildStagedDeps, ...) are copied from
// g1-svf2-f1-f8-verification.finalintegration.test.mjs.


import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createViewerApi } from '../../clashpanel/viewer/viewerApi.js';
import { maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import {
  CONTROL_STATE, CONTROL_NAMES,
  CHECK_VERDICT, OVERALL_VERDICT,
  createControlResult,
  IN_PAGE_FUNCTION_REGISTRY,
  setupSharedSessionResources, observeF1, observeF2, observeF7,
  treeUnavailableControlInPage, wrongOwnerControlInPage, hiddenFragmentControlInPage,
  capacityBreachControlInPage, invalidBoundsControlInPage, boundsBeyondToleranceControlInPage,
  buildTreeUnavailableControlDep, buildWrongOwnerControlDep, buildHiddenFragmentControlDep,
  buildCapacityBreachControlDep, buildInvalidBoundsControlDep, buildBoundsBeyondToleranceControlDep,
  buildRealControls,
  runHarness, validateResultSchema, runBridgedControl,
  sanitizeControlTargetEvidence, validateControlTargetEvidence,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- identical convention to every prior task's own
// createPageRealm (session.test.mjs / controlbridge.test.mjs / mandatorycontrols1/2.test.mjs).
// ============================================================================================

function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console, structuredClone });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    context,
    call(fn, ...args) {
      return vm.runInContext(fn.name, context)(...args);
    },
  };
}

function fakeWorld(overrides = {}) {
  let live = true;
  return {
    isModelLive: () => live,
    evictModel: () => { live = false; },
    dispose: () => {},
    ...overrides,
  };
}

// Richer than mandatorycontrols1/2.test.mjs's own simpler fakeRegistry -- this file goes through
// the REAL setupSharedSessionResources (unlike those files' own direct-construction
// `publishSession` convention), which needs `registrySessionId`/`register`/`unregister` too.
// Mirrors controlbridge.test.mjs's own `fakeRegistry(world, overrides)` exactly.
function fakeRegistry(world, overrides = {}) {
  let boundModel = null;
  return {
    world,
    registrySessionId: overrides.sessionId || 'final-integration-sess-1',
    register: overrides.register || ((K, model) => { boundModel = model; }),
    bindingFor: overrides.bindingFor || (() => (boundModel ? { model: boundModel } : null)),
    unregister: overrides.unregister || (() => { boundModel = null; }),
  };
}

function fakeF7Viewer(overrides = {}) {
  return { overlays: {}, getAggregateHiddenNodes: () => [], ...overrides };
}

const FAKE_AUTODESK_EVENTS = { Viewing: { BEFORE_MODEL_UNLOAD_EVENT: 'beforeModelUnload', MODEL_REMOVED_EVENT: 'modelRemoved' } };
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const ROOT_DB_ID = 100;

function nodeBoxFiller(box) {
  return (dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = box[i]; };
}

// A single merged model/tree/enumerator fixture rich enough for ALL of: real F1 (Phase 4), real
// F2 (Phase 5), real F7 (Phase 8), AND all six bridged controls' own perturbation/re-observation
// -- the union of mandatorycontrols1.test.mjs's own buildWrongOwnerRealm/buildHiddenFragmentRealm/
// buildTreeUnavailableRealm and mandatorycontrols2.test.mjs's own buildCapacityBreachRealm/
// buildBoundsControlRealm fixtures, merged onto ONE model/session (previously each control's own
// dedicated, isolated fixture -- this is the whole point of this deliverable: prove they agree on
// a SHARED, SINGLE real session rather than each only ever having been proven in isolation).
// `capacityLimit` defaults to the REAL, imported `maxCollisionInstancesPerEpoch` (never a
// hardcoded duplicate, matching `buildCapacityBreachControlDep`'s own established convention) --
// the fixture's own baseline `getFragmentList().getCount()` (2) stays far under it; only
// `capacityBreachControlInPage`'s own patch (installed/restored entirely inside its own in-page
// execution window) ever pushes it over.
function buildSharedFixture({ capacityLimit = maxCollisionInstancesPerEpoch } = {}) {
  const children = new Map([[0, []]]);
  // TWO fragments (0 and 1), both under node 0, both owned by ROOT_DB_ID -- hidden-fragment's own
  // patch (hiddenFragmentControlInPage, this file) hardcodes dropping fragId 1 specifically
  // (mirroring the original runHiddenFragmentControl's own perturbation), so a single-fragment
  // fixture (fragId 0 only) can never let this control detect anything -- confirmed directly by
  // reading its patch (`fragId !== 1`) rather than assumed from mandatorycontrols1.test.mjs's own
  // fixture shape alone.
  const fragmentsByNode = new Map([[0, [0, 1]]]);
  const tree = {
    getRootId: () => 0,
    enumNodeChildren: (n, cb) => { for (const c of (children.get(n) || [])) cb(c); },
    enumNodeFragments: (n, cb) => { for (const f of (fragmentsByNode.get(n) || [])) cb(f); },
    // F7's own detection oracle (invalid-bounds/bounds-beyond-tolerance re-run observeF7 against
    // this): a uniform [0,0,0,10,10,0] box for every dbId, matching the F1/F4 geometry fixture
    // below exactly, so the primary pass reports ROOT_DB_ID as 'agrees' -- the baseline both
    // controls perturb away from (mandatorycontrols2.test.mjs's own buildBoundsControlRealm
    // convention, reused verbatim).
    getNodeBox: nodeBoxFiller([0, 0, 0, 10, 10, 0]),
  };
  // Task 14 fix wave (H1, see g1-svf2-f1-f8-verification.mjs's own wrongOwnerControlInPage/
  // hiddenFragmentControlInPage/capacityBreachControlInPage doc comments): a real Viewer 7.124.2
  // Model exposes fragments ONLY via `getFragmentList()` (no bare `.fragList` own property) and
  // has no bare `.tree` property at all (only `getObjectTree()`/`getInstanceTree()`). This fixture
  // used to also expose bare `model.fragList`/`model.tree` properties that were a DIFFERENT object
  // from what the accessors returned, and the fake enumerator below used to read the bare property
  // directly -- both masked H1 entirely (the bridged controls patched one object, the enumerator
  // read a different, unpatched one, so detection "worked" for the wrong reason). Fixed: exactly
  // ONE stable `fragmentList` object backs `getFragmentList()` (a real accessor returns the same
  // stored object every call, confirmed by the final reviewer against the pinned bundle), and the
  // fake enumerator now reads through `model.getFragmentList()`, matching how the REAL
  // `ViewerElementEnumerator.js` (`scanPopulation(model.getFragmentList(), ...)`, around line 92)
  // actually reads it. No bare `.fragList`/`.tree` property remains on this fixture's model -- a
  // production-realistic (accessor-only) shape, since nothing in the fixed harness code reads them
  // anymore.
  const fragmentList = { getCount: () => 2, getGeometryId: () => 1, getDbIds: () => ROOT_DB_ID };
  const model = {
    getFragmentList: () => fragmentList,
    isObjectTreeCreated: () => true,
    getObjectTree: () => tree,
    getUnitScale: () => 1,
    getUnitString: () => null,
    getGlobalOffset: () => [0, 0, 0],
    getPlacementTransform: () => null,
  };
  const enumerator = {
    // Genuinely reads `binding.model.getFragmentList()` at CALL time (unlike
    // mandatorycontrols1.test.mjs's own per-control fixtures, which return a fixed canned
    // count/mismatch regardless of the model's actual state) -- this is what lets wrong-owner's
    // and capacity-breach's own bridged patches genuinely change what the REAL observeF1 (re-run
    // via their own scratch sessions) reports, proving the patch takes effect through the same
    // enumerator the outer Phase 4 F1 check also uses, rather than each being independently faked
    // to "just work". Task 14 fix wave (H1): now reads through `getFragmentList()`, matching the
    // real `ViewerElementEnumerator.js` -- see the fixture-level doc comment above.
    resolveRoots: async (binding) => {
      const fl = binding.model.getFragmentList();
      const count = fl.getCount();
      if (count > capacityLimit) {
        const err = new Error(`capacity exceeded: ${count} > ${capacityLimit}`);
        err.name = 'CapacityExceededError';
        err.limit = capacityLimit;
        err.requested = count;
        throw err;
      }
      const roots = [{ dbId: ROOT_DB_ID, fragmentCount: 2, ownerDbIds: [ROOT_DB_ID], subtreeDigest: 'd' }];
      const actualOwner = fl.getDbIds(0);
      const mismatchCount = actualOwner === ROOT_DB_ID ? 0 : 1;
      return { roots, ownerMismatch: { count: mismatchCount }, unreachable: { count: 0 }, population: { count: 1, digest: 'd' } };
    },
  };
  const world = fakeWorld();
  const registry = fakeRegistry(world);
  const mod = {
    '/collision/index.js': { CollisionWorld: { fromViewer: async () => world } },
    '/clashtest/index.js': { createModelRegistry: () => registry },
    '/clashtest/viewer/index.js': { createViewerElementEnumerator: () => enumerator },
    '/collision/viewer/ViewerModelAdapter.js': {
      extractFragments: async () => new Map([
        [0, { fragmentId: 0, ownerDbId: ROOT_DB_ID }],
        [1, { fragmentId: 1, ownerDbId: ROOT_DB_ID }],
      ]),
      extractAllFragments: async () => ({
        records: new Map([
          [0, { fragmentId: 0, ownerDbId: ROOT_DB_ID, worldMatrix: IDENTITY_MATRIX, worldBounds: [0, 0, 0, 10, 10, 0] }],
          [1, { fragmentId: 1, ownerDbId: ROOT_DB_ID, worldMatrix: IDENTITY_MATRIX, worldBounds: [0, 0, 0, 10, 10, 0] }],
        ]),
        diagnostics: [],
      }),
    },
    '/clashtest/planning/scopeDigest.js': {
      digestSubtree: async () => ({ digest: 'd' }),
      digestPopulation: async () => ({ digest: 'd' }),
    },
    '/clashpanel/viewer/viewerApi.js': { createViewerApi },
  };
  const windowObj = { __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS, __g1: { mod } };
  const realm = createPageRealm(windowObj);
  return { realm, model, tree, world, registry, enumerator, capacityLimit };
}

// ============================================================================================
// pageEvaluate dispatcher: real (node:vm realm) for setupSharedSessionResources/observeF1/
// observeF2/observeF7 and all six bridged control in-page functions -- fake (canned, copied
// verbatim from controlbridge.test.mjs's own already-reviewed buildHappyPageEvaluate) for
// everything else (F3/F4/F6/F8/load/classifier/cleanup), none of which any of the six controls'
// own detection oracles ever touch.
// ============================================================================================

function callOrderTracker() {
  const order = [];
  return { order, record: (label) => order.push(label) };
}

const REAL_NAMES = new Set([
  'setupSharedSessionResources', 'observeF1', 'observeF2', 'observeF7',
  'treeUnavailableControlInPage', 'wrongOwnerControlInPage', 'hiddenFragmentControlInPage',
  'capacityBreachControlInPage', 'invalidBoundsControlInPage', 'boundsBeyondToleranceControlInPage',
]);

function buildTrackedPageEvaluate({ realm, model, tracker, canned = {} }) {
  return async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    tracker.record(`pageEvaluate:${name}`);
    if (name === 'documentLoadStarter' || name === 'loadDocumentNodeStarter') {
      // Bypasses the REAL in-page load-token bookkeeping entirely (this file, unlike a real run,
      // never exercises Stage 2/3's own load machinery -- already covered elsewhere) -- but the
      // REAL setupSharedSessionResources (below) needs window.__g1.loads[tokenId]/models[tokenId]
      // to genuinely exist, so this fake seeds them as a side effect, keyed by the SAME
      // Node-generated tokenId startLoad already put in `arg.tokenId`.
      const g = realm.window.__g1;
      g.loads = g.loads || {};
      g.loads[arg.tokenId] = { gen: 1, status: 'completed', api: 'loadDocumentNode' };
      g.models = g.models || {};
      g.models[arg.tokenId] = model;
      return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    if (REAL_NAMES.has(name)) {
      return realm.call(fn, arg);
    }
    if (name in canned) {
      return canned[name](arg);
    }
    throw new Error(`buildTrackedPageEvaluate: no handler for '${name}'`);
  };
}

// One simple non-indexed triangle geometry entry (F4's own frozen per-geometry snapshot shape),
// matching mandatorycontrols2.test.mjs's own `triangleGeometryEntry` exactly -- vertices
// (0,0,0),(10,0,0),(0,10,0), so under an identity world matrix its own local AABB and world-space
// bounds are both exactly [0,0,0,10,10,0], matching this file's own `getNodeBox`/geometry fixture.
function triangleGeometryEntry({ activeTriangleCount = 1 } = {}) {
  return {
    unsupported: false,
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
    positionStride: 3,
    positionOffset: 0,
    index: null,
    ranges: [{ start: 0, count: 3 }],
    activeTriangleCount,
    representativeFragId: 0,
  };
}

function buildCannedHandlers({ realm }) {
  return {
    captureModelFormatSignals: () => ({ ok: true, isOTG: true, isSVF2: true, captureErrors: [] }),
    f3InstallProbe: () => ({ ok: true }),
    f3FinalizeProbe: () => ({ ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 5, rejectionError: null }),
    // F4 is faked (real geometry-adapter-module plumbing is out of scope for THIS deliverable --
    // already covered by dedicated F4 tests elsewhere), but invalid-bounds/bounds-beyond-
    // tolerance's own scratch sessions copy f4Geometry/f4FragmentGeometryId/f4WorldMatricesByFragId
    // straight from the REAL session's own artifacts (Task 12's own established convention), so
    // this fake must still WRITE them for real, exactly as a real observeF4 would, into the SAME
    // session the rest of this fixture shares -- matching mandatorycontrols2.test.mjs's own
    // buildBoundsControlRealm pre-seeded artifacts shape (same geometry entry, same identity
    // matrix, both fragments 0 and 1 mapped to the one geometry id).
    observeF4: (sessionId) => {
      const session = realm.window.__g1.sessions[sessionId];
      session.artifacts.f4Geometry = new Map([[1, triangleGeometryEntry()]]);
      session.artifacts.f4FragmentGeometryId = new Map([[0, 1], [1, 1]]);
      session.artifacts.f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX], [1, IDENTITY_MATRIX]]);
      return { ok: true, fields: { libraryThrew: 0, libOwnerDiffersFromFragList: 0, droppedDiagnosticsCount: { 'geometry-id-undefined': 0, 'geometry-id-threw': 0 }, distinctGeometryCount: 1, renderProxyFailures: 0, geometryAdapterFailures: 0, geometriesWithNullIndex: 0, weldConsumerFailures: 0, weldConsumerSuccessCount: 1, maxActiveTriangleCount: 1, oversizedGeometryCount: 0 } };
    },
    observeF8: () => ({ ok: true, fields: { censusedRootCount: 1, censusedFragmentCount: 1, treeCheckedFragmentCount: 1, ownershipDivergenceCount: 0, treeDivergenceCount: 0, divergenceCount: 0, coverageEquationsClosed: true } }),
    sealLoads: () => ({}),
    readLoadRecordSnapshot: () => ({ present: false }),
    runInPageResourceCleanup: () => ({ ok: true, stepStatus: { removeF3Listeners: 'ran' }, cleanupFailures: [], cleanupUnresolvedOwnership: false }),
    f6InstallUnloadWiring: () => ({ ok: true }),
    f6TriggerUnload: () => ({ ok: true }),
    f6UnloadSettledPredicate: () => true,
    f6ReadUnloadSnapshot: () => ({ ok: true, unloadProbeFired: true, unloadEventModelMatchesModelBefore: true, unregisterBeforeEvict: true, bindingNullAfterUnload: true }),
    f6InstallReloadProbe: () => ({ ok: true }),
    f6ReloadProbeSettledPredicate: () => true,
    f6FinalizeReloadProbe: () => ({ ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 1, rejectionError: null, modelMatchesReloadToken: true }),
    f6Reregister: () => ({ ok: true, reregisteredOk: true }),
    f6RunLateUnloadControl: () => ({ ok: true, lateUnloadHandlerThrew: false, bindingSurvivesLateUnload: true, modelAfterStillLive: true, resolveRootsOk: true }),
    f6Cleanup: () => ({ ok: true, disposed: true, probeRemoved: true, wiringDisposed: true }),
  };
}

function buildStagedDeps({ realm, model, tracker, controlsOverrides = {} }) {
  const canned = buildCannedHandlers({ realm });
  const pageEvaluate = buildTrackedPageEvaluate({ realm, model, tracker, canned });
  const pageWaitForFunction = async (fn) => { tracker.record(`pageWaitForFunction:${fn.name}`); };
  const realControls = buildRealControls(pageEvaluate);
  return {
    pageEvaluate, pageWaitForFunction,
    loadStarter: { documentLoad: 'documentLoadStarter', loadDocumentNode: 'loadDocumentNodeStarter' },
    installF3Probe: () => pageEvaluate({ name: 'f3InstallProbe' }, undefined),
    finalizeF3Probe: (arg) => pageEvaluate({ name: 'f3FinalizeProbe' }, arg),
    setupSharedSessionResources: (tokenId) => pageEvaluate(setupSharedSessionResources, tokenId),
    controls: { ...realControls, ...controlsOverrides },
    f6Deps: {},
    nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => { tracker.record('captureViewerScriptIntegrity'); return { requestFailed: false, autodeskViewingDefined: true, attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e' }] }; },
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: 'x', sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: 'VERIFIED' }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => { tracker.record('writeResultAtomically'); },
  };
}

const STAGED_CONFIG = {
  urn: 'fake-urn', loadTimeoutMs: 1000, unloadEventName: 'beforeModelUnload', addedEventName: 'modelAdded',
  viewerVersion: '7.124.2', chromium: 'x', node: process.version, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
};

function outerWatchdogTimeoutError(controlName) {
  return Object.assign(new Error('outer-watchdog-timeout'), { outerWatchdogTimeout: true, controlName });
}

// ============================================================================================

// ============================================================================================
// Small direct-session realms for the two target-bearing in-page controls (sparse fragIds).
// ============================================================================================

const BASE_ARG = { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: null, innerTimeoutMs: 200 };

function publishSession(windowObj, { model, world, registry, artifacts, mod }) {
  windowObj.__g1 = windowObj.__g1 || {};
  const g = windowObj.__g1;
  g.loads = { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } };
  g.models = { tok: model };
  g.sessions = {
    s1: { tokenId: 'tok', tokenGen: 1, world, registry, model, K: 'K', modelVersion: 'v1', artifacts, activeControl: null },
  };
  if (mod) g.mod = mod;
}

function simpleRegistry(model) {
  return { bindingFor: () => ({ model }), unregister: () => {} };
}

function buildWrongOwnerRealm(f1PopulationRecords, { ownerMismatchCount = 1 } = {}) {
  const fragmentList = { getDbIds: () => 42, getCount: () => 0 };
  const model = { getFragmentList: () => fragmentList };
  const enumerator = {
    resolveRoots: async () => ({
      roots: [{ dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd' }],
      ownerMismatch: { count: ownerMismatchCount }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' },
    }),
  };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': {
      extractFragments: async () => new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]),
      extractAllFragments: async () => ({ records: new Map(), diagnostics: [] }),
    },
    '/clashtest/planning/scopeDigest.js': { digestSubtree: async () => ({ digest: 'x' }), digestPopulation: async () => ({ digest: 'd' }) },
  };
  const g = { __viewer: {} };
  publishSession(g, { model, world: fakeWorld(), registry: simpleRegistry(model), artifacts: { f1PopulationRecords }, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  return createPageRealm(g);
}

function buildHiddenFragmentRealm(fragIds, classes) {
  const tree = {
    getRootId: () => 0,
    enumNodeChildren: () => {},
    enumNodeFragments: (n, cb) => { for (const f of fragIds) cb(f); },
  };
  const model = { getObjectTree: () => tree, isObjectTreeCreated: () => true, getFragmentList: () => ({ getCount: () => fragIds.length }) };
  const f2 = new Map(fragIds.map((f) => [f, { ownerDbId: 500 + f, conflictingOwnerDbId: null }]));
  const g = { __viewer: {} };
  publishSession(g, {
    model, world: fakeWorld(), registry: simpleRegistry(model),
    artifacts: { f1PopulationClasses: classes, f1RootsLength: 1, f2TreeOwnerByFragId: f2 },
  });
  return createPageRealm(g);
}

const sparseRecords = () => new Map([[4242, { fragmentId: 4242, ownerDbId: 9 }], [7, { fragmentId: 7, ownerDbId: 70 }]]);

// ---- (1)+(3) selected target survives the browser-realm bridge; sparse ids retained exactly ----

test('bridge: wrong-owner selected target (sparse fragId 7) survives runBridgedControl via real in-page fn; ControlResult shape unchanged', async () => {
  const realm = buildWrongOwnerRealm(sparseRecords());
  const sink = [];
  const result = await runBridgedControl({
    pageEvaluate: (fn, arg) => realm.call(fn, arg), controlName: 'wrong-owner',
    inPageFn: wrongOwnerControlInPage, arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'wrong-owner' },
    innerTimeoutMs: 200, onTargetEvidence: (r) => sink.push(r),
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.deepEqual(Object.keys(result).sort(), ['detected', 'executed', 'reason', 'restorationRequired', 'restored', 'state']);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].controlName, 'wrong-owner');
  assert.strictEqual(sink[0].selectedFragId, 7);
  assert.strictEqual(sink[0].selectedOwnerDbId, 70);
  assert.equal(sink[0].selectionSource, 'f1PopulationRecords');
  assert.equal(sink[0].selectionRule, 'numeric-minimum');
  assert.strictEqual(sink[0].populationSize, 2);
  assert.equal(validateControlTargetEvidence('wrong-owner', sink[0]).valid, true);
  JSON.parse(JSON.stringify(sink[0])); // plain JSON only
});

test('bridge: hidden-fragment selected target (sparse fragIds 4242/9000 class L) survives via real in-page fn', async () => {
  const realm = buildHiddenFragmentRealm([9000, 4242], [{ fragId: 9000, cls: 'L' }, { fragId: 4242, cls: 'L' }]);
  const sink = [];
  const result = await runBridgedControl({
    pageEvaluate: (fn, arg) => realm.call(fn, arg), controlName: 'hidden-fragment',
    inPageFn: hiddenFragmentControlInPage, arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'hidden-fragment' },
    innerTimeoutMs: 200, onTargetEvidence: (r) => sink.push(r),
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(sink.length, 1);
  assert.strictEqual(sink[0].selectedFragId, 4242);
  assert.strictEqual(sink[0].selectedTreeOwnerDbId, 4742);
  assert.strictEqual(sink[0].actedOnFragId, 4242, '(6) acted-on fragId equals the selected authoritative fragment');
  assert.equal(sink[0].selectionRule, 'numeric-minimum');
  assert.equal(validateControlTargetEvidence('hidden-fragment', sink[0]).valid, true);
});

// ---- (5) injected owner differs from real owner ----

test('wrong-owner record proves injected owner != real owner (incl. the -999999 sentinel edge)', async () => {
  for (const realOwner of [70, -999999]) {
    const realm = buildWrongOwnerRealm(new Map([[7, { fragmentId: 7, ownerDbId: realOwner }]]));
    const sink = [];
    await runBridgedControl({
      pageEvaluate: (fn, arg) => realm.call(fn, arg), controlName: 'wrong-owner', inPageFn: wrongOwnerControlInPage,
      arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'wrong-owner' }, innerTimeoutMs: 200,
      onTargetEvidence: (r) => sink.push(r),
    });
    assert.equal(sink.length, 1);
    assert.strictEqual(sink[0].selectedOwnerDbId, realOwner);
    assert.equal(typeof sink[0].injectedOwnerDbId, 'number');
    assert.notStrictEqual(sink[0].injectedOwnerDbId, sink[0].selectedOwnerDbId);
  }
});

// ---- (4) no eligible target: fail closed, no fabricated record ----

test('no eligible target: NOT_EXECUTABLE and NO target record for either control (no 0/1 fallback)', async () => {
  const wo = buildWrongOwnerRealm(new Map());
  const s1 = [];
  const r1 = await runBridgedControl({
    pageEvaluate: (fn, arg) => wo.call(fn, arg), controlName: 'wrong-owner', inPageFn: wrongOwnerControlInPage,
    arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'wrong-owner' }, innerTimeoutMs: 200, onTargetEvidence: (r) => s1.push(r),
  });
  assert.equal(r1.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.deepEqual(s1, []);
  const hf = buildHiddenFragmentRealm([5], [{ fragId: 5, cls: 'N' }]);
  const s2 = [];
  const r2 = await runBridgedControl({
    pageEvaluate: (fn, arg) => hf.call(fn, arg), controlName: 'hidden-fragment', inPageFn: hiddenFragmentControlInPage,
    arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'hidden-fragment' }, innerTimeoutMs: 200, onTargetEvidence: (r) => s2.push(r),
  });
  assert.equal(r2.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.deepEqual(s2, []);
});

test('sanitize: malformed raw target fields are omitted (null), never coerced', () => {
  const good = { ok: true, selectedFragId: 7, selectedOwnerDbId: 70, injectedOwnerDbId: -999999, selectionSource: 'f1PopulationRecords', selectionRule: 'numeric-minimum', populationSize: 2 };
  assert.ok(sanitizeControlTargetEvidence('wrong-owner', good));
  for (const bad of [
    { ...good, selectedFragId: '7' }, { ...good, selectedOwnerDbId: null }, { ...good, injectedOwnerDbId: 70 },
    { ...good, selectedFragId: NaN }, { ...good, selectionSource: 'x' }, { ...good, populationSize: 0 },
    { ...good, selectedFragId: undefined },
  ]) {
    assert.equal(sanitizeControlTargetEvidence('wrong-owner', bad), null, JSON.stringify(bad));
  }
  assert.equal(sanitizeControlTargetEvidence('tree-unavailable', good), null);
});

// ---- (2)+(3)+(6) durable JSON through runHarness ----

test('runHarness durable result: controlTargets persisted (real in-page controls), schema-valid', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const deps = buildStagedDeps({ realm, model, tracker });
  const written = [];
  deps.writeResultAtomically = async (r) => { written.push(JSON.parse(JSON.stringify(r))); };
  const result = await runHarness(deps, STAGED_CONFIG);
  assert.equal(written.length, 1);
  const ct = written[0].controlTargets;
  assert.ok(ct && typeof ct === 'object');
  assert.strictEqual(ct['wrong-owner'].selectedFragId, 0);
  assert.strictEqual(ct['wrong-owner'].selectedOwnerDbId, ROOT_DB_ID);
  assert.notStrictEqual(ct['wrong-owner'].injectedOwnerDbId, ROOT_DB_ID);
  assert.strictEqual(ct['hidden-fragment'].selectedFragId, 0);
  assert.strictEqual(ct['hidden-fragment'].actedOnFragId, ct['hidden-fragment'].selectedFragId);
  assert.equal(validateResultSchema(written[0]).valid, true, JSON.stringify(validateResultSchema(written[0]).errors));
  assert.deepEqual(Object.keys(result.controls['wrong-owner']).sort(), ['detected', 'executed', 'reason', 'restorationRequired', 'restored', 'state']);
});

test('runHarness durable result: arbitrary sparse fragIds (4242 / 7) retained exactly through ctx.recordControlTarget', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const woRealm = buildWrongOwnerRealm(sparseRecords());
  const hfRealm = buildHiddenFragmentRealm([4242, 9000], [{ fragId: 4242, cls: 'L' }, { fragId: 9000, cls: 'L' }]);
  const deps = buildStagedDeps({
    realm, model, tracker,
    controlsOverrides: {
      wrongOwner: (ctx) => runBridgedControl({
        pageEvaluate: (fn, arg) => woRealm.call(fn, arg), controlName: 'wrong-owner', inPageFn: wrongOwnerControlInPage,
        arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'wrong-owner' }, innerTimeoutMs: ctx.controlTimeoutMs,
        onTargetEvidence: ctx.recordControlTarget,
      }),
      hiddenFragment: (ctx) => runBridgedControl({
        pageEvaluate: (fn, arg) => hfRealm.call(fn, arg), controlName: 'hidden-fragment', inPageFn: hiddenFragmentControlInPage,
        arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'hidden-fragment' }, innerTimeoutMs: ctx.controlTimeoutMs,
        onTargetEvidence: ctx.recordControlTarget,
      }),
    },
  });
  const written = [];
  deps.writeResultAtomically = async (r) => { written.push(JSON.parse(JSON.stringify(r))); };
  await runHarness(deps, STAGED_CONFIG);
  assert.strictEqual(written[0].controlTargets['wrong-owner'].selectedFragId, 7);
  assert.strictEqual(written[0].controlTargets['wrong-owner'].selectedOwnerDbId, 70);
  assert.strictEqual(written[0].controlTargets['hidden-fragment'].selectedFragId, 4242);
  assert.strictEqual(written[0].controlTargets['hidden-fragment'].selectedTreeOwnerDbId, 4742);
});

test('runHarness: a NOT_EXECUTABLE (no-eligible) control leaves NO controlTargets entry, and the result stays schema-valid', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const woRealm = buildWrongOwnerRealm(new Map());
  const deps = buildStagedDeps({
    realm, model, tracker,
    controlsOverrides: {
      wrongOwner: (ctx) => runBridgedControl({
        pageEvaluate: (fn, arg) => woRealm.call(fn, arg), controlName: 'wrong-owner', inPageFn: wrongOwnerControlInPage,
        arg: { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: 'wrong-owner' }, innerTimeoutMs: ctx.controlTimeoutMs,
        onTargetEvidence: ctx.recordControlTarget,
      }),
    },
  });
  const written = [];
  deps.writeResultAtomically = async (r) => { written.push(JSON.parse(JSON.stringify(r))); };
  const result = await runHarness(deps, STAGED_CONFIG);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal('wrong-owner' in written[0].controlTargets, false);
  assert.equal(validateResultSchema(written[0]).valid, true);
});

// ---- (7) schema validator ----

test('validateResultSchema rejects a malformed controlTargets carrier / record', async () => {
  const { realm, model } = buildSharedFixture();
  const deps = buildStagedDeps({ realm, model, tracker: callOrderTracker() });
  const written = [];
  deps.writeResultAtomically = async (r) => { written.push(JSON.parse(JSON.stringify(r))); };
  await runHarness(deps, STAGED_CONFIG);
  const base = written[0];
  assert.equal(validateResultSchema(base).valid, true);
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(base)); fn(c); return validateResultSchema(c); };
  assert.equal(mutate((c) => { delete c.controlTargets; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets = []; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets['wrong-owner'].selectedFragId = '0'; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets['wrong-owner'].injectedOwnerDbId = c.controlTargets['wrong-owner'].selectedOwnerDbId; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets['hidden-fragment'].actedOnFragId = 999; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets['capacity-breach'] = { controlName: 'capacity-breach' }; }).valid, false);
  assert.equal(mutate((c) => { c.controlTargets['wrong-owner'].controlName = 'hidden-fragment'; }).valid, false);
});
