// test/acceptance/g1-svf2-f1-f8-verification.finalintegration.test.mjs
//
// Offline, browser-free unit tests for the bounded completion pass, area 3 (Task 13, FINAL
// integration) of test/acceptance/g1-svf2-f1-f8-verification.mjs: wiring all six mandatory
// model-data controls (Tasks 10-12, all previously landed/reviewed individually) into
// `main()`'s own real `deps.controls` (via `buildRealControls`), and proving they work correctly
// TOGETHER, staged through a single fake `runHarness` sequence -- not merely individually, which
// Tasks 11/12's own dedicated test files (`.mandatorycontrols1/2.test.mjs`) already proved.
//
// AUTHORIZATION BOUNDARY (same as every prior task): this file NEVER launches a real Chromium
// browser, NEVER imports playwright, and NEVER calls `main()` with real dependencies. Every
// in-page function under test (the six bridged controls, plus `setupSharedSessionResources`/
// `observeF1`/`observeF2`/`observeF7`, which the controls' own detection oracles re-run for real)
// is reconstructed from its own source text inside an isolated `node:vm` context (this file's own
// `createPageRealm`, mirroring every prior task's own established pattern) -- never a plain
// `globalThis.window` fake. `runHarness` itself is exercised via its own injected `deps`
// contract, exactly like `controlbridge.test.mjs`'s own `buildHappyDeps`/`buildHappyPageEvaluate`
// -- this file's own `pageEvaluate` dispatches EITHER to that real `node:vm` realm (for
// `setupSharedSessionResources`/`observeF1`/`observeF2`/`observeF7` and all six bridged control
// in-page functions -- the functions this deliverable actually needs to prove interact correctly)
// OR to a small set of canned fakes (F3/F4/F6/F8/load/classifier/cleanup -- none of which any of
// the six controls' own detection oracles touch, so faking them cannot mask a real
// cross-control interaction bug; each canned shape is copied verbatim from
// `controlbridge.test.mjs`'s own already-reviewed `buildHappyPageEvaluate`).

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
  runHarness, validateResultSchema,
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
// 1. Happy path: all six REAL bridged controls, staged through a full runHarness sequence
//    against ONE shared real session/model, all report DETECTED_RESTORED, no lease overlap, no
//    leaked scratch sessions, zero net drift in the real F1/F2/F4 retained artifacts.
// ============================================================================================

test('all six bridged controls staged through a real runHarness sequence: happy path -- every control DETECTED_RESTORED, no lease overlap, no leaked scratch sessions, real F1/F2/F4 artifacts byte-for-byte unchanged end to end', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const deps = buildStagedDeps({ realm, model, tracker });

  const result = await runHarness(deps, STAGED_CONFIG);

  // Basic sanity: the real session actually got created and classification/F1-F8 genuinely ran
  // (not short-circuited by some unrelated setup failure this fixture failed to satisfy).
  assert.equal(result.sessionTainted, false, `sessionTainted unexpectedly true -- controls: ${JSON.stringify(result.controls)}`);

  for (const name of ['tree-unavailable', 'wrong-owner', 'hidden-fragment', 'capacity-breach', 'invalid-bounds', 'bounds-beyond-tolerance']) {
    assert.equal(result.controls[name].state, CONTROL_STATE.DETECTED_RESTORED, `${name}: expected DETECTED_RESTORED, got ${JSON.stringify(result.controls[name])}`);
  }

  // No lease overlap: by the time runHarness returns, no control's lease is left held (each of
  // the six controls above reported DETECTED_RESTORED, which per mapControlAttemptOutcome's own
  // contract requires `restored === true`, which per every one of the six in-page functions' own
  // `finally` block releases the lease ONLY on a fully-verified restore -- confirmed directly, not
  // merely inferred, by reading the real session's own activeControl field here).
  const session = realm.window.__g1.sessions['final-integration-sess-1'];
  assert.ok(session, 'the real session must still exist under its real registrySessionId');
  assert.equal(session.activeControl, null, 'no control may leave its lease held after a DETECTED_RESTORED result');

  // No leaked scratch sessions: wrong-owner/hidden-fragment/capacity-breach/invalid-bounds/
  // bounds-beyond-tolerance all create one (tree-unavailable does not, per its own design) --
  // every one of the 5 scratch-session keys must be gone once the harness completes.
  for (const controlId of ['wrong-owner', 'hidden-fragment', 'capacity-breach', 'invalid-bounds', 'bounds-beyond-tolerance']) {
    const scratchKey = `final-integration-sess-1::control-scratch::${controlId}`;
    assert.equal(realm.window.__g1.sessions[scratchKey], undefined, `scratch session '${scratchKey}' must be disposed, never leaked`);
  }

  // Zero net drift: the real session's own retained F1/F2 artifacts (F4's own three keys are
  // canned by this test's own observeF4 fake, so they are asserted for PRESENCE/stability rather
  // than re-verifying observeF4's own internal correctness, already covered elsewhere) must be
  // byte-for-byte identical to what the REAL, unmodified F1/F2 passes alone would have produced --
  // proven by re-deriving the expected shape directly rather than merely asserting "still
  // present".
  // JSON.stringify comparison (not assert.deepEqual): these values were constructed INSIDE the
  // node:vm realm, so their prototype chain differs from this test file's own realm's Object.
  // prototype -- deepStrictEqual would (correctly, per its own semantics) report them as
  // not-reference-equal despite identical own-enumerable-property structure; JSON.stringify
  // sidesteps that entirely and matches this file's own established cross-realm comparison
  // convention (e.g. capacityBreachControlInPage's own scratch-isolation test).
  assert.equal(session.artifacts.f1FragmentMapsByRoot.size, 1);
  assert.deepEqual([...session.artifacts.f1FragmentMapsByRoot.keys()], [100]);
  assert.equal(JSON.stringify(session.artifacts.f1PopulationClasses), JSON.stringify([{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }]));
  assert.equal(session.artifacts.f1RootsLength, 1);
  assert.ok(session.artifacts.f2TreeOwnerByFragId, 'F2 must have genuinely run and written its own retained artifact');

  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.PASS, `F1 unexpectedly not PASS: ${JSON.stringify(result.checks.F1)}`);
  assert.equal(result.checks.F2.verdict, CHECK_VERDICT.PASS, `F2 unexpectedly not PASS: ${JSON.stringify(result.checks.F2)}`);

  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

// ============================================================================================
// 2. Taint mid-sequence variant: an outer-watchdog timeout on ONE control (capacity-breach,
//    Phase 7c -- squarely between the first three REAL controls and the last two) aborts every
//    REMAINING step, including the remaining REAL controls (invalid-bounds/bounds-beyond-
//    tolerance), not just remaining Fi checks -- Task 13's own required extension of Task 10's
//    single-control taint test into this multi-REAL-control context.
// ============================================================================================

test('taint mid-sequence: an outer-watchdog-timed-out control aborts every remaining step INCLUDING remaining real controls, while every earlier real control already ran to completion', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const deps = buildStagedDeps({
    realm, model, tracker,
    controlsOverrides: {
      capacityBreach: async () => { throw outerWatchdogTimeoutError('capacity-breach'); },
    },
  });

  const result = await runHarness(deps, STAGED_CONFIG);

  assert.equal(result.sessionTainted, true);
  assert.equal(result.controls['capacity-breach'].state, CONTROL_STATE.TIMED_OUT);
  assert.equal(result.controls['capacity-breach'].reason, 'outer-watchdog-timeout');

  // Every REAL control strictly BEFORE capacity-breach (Phase 3c/4c/5c) genuinely ran to
  // completion first.
  assert.equal(result.controls['tree-unavailable'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['hidden-fragment'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F2.verdict, CHECK_VERDICT.PASS);

  // Every REMAINING control (invalid-bounds/bounds-beyond-tolerance, Phase 8c -- strictly AFTER
  // the tainting control) is a fail-closed placeholder, NEVER actually invoked -- the property
  // this deliverable specifically requires beyond Task 10's own single-control test (which never
  // had a second REAL control positioned after the tainting one to prove this against).
  assert.equal(result.controls['invalid-bounds'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['invalid-bounds'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['bounds-beyond-tolerance'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['bounds-beyond-tolerance'].reason, 'not-reached:fatal-error');
  assert.equal(tracker.order.includes('pageEvaluate:invalidBoundsControlInPage'), false, 'invalid-bounds must NEVER actually be invoked once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:boundsBeyondToleranceControlInPage'), false, 'bounds-beyond-tolerance must NEVER actually be invoked once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:observeF7'), false, 'F7 must NEVER actually be observed once tainted');

  // Phase 11 cleanup still ran regardless (the "ALWAYS runs" guarantee, unchanged by this task).
  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true);
  assert.equal(tracker.order.includes('writeResultAtomically'), true);

  assert.equal(result.overall, OVERALL_VERDICT.FAIL);

  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

// ============================================================================================
// 2b. RESTORE_FAILED now ALSO taints the session and aborts the remaining phase sequence -- Task
//     14 fix wave (M1, recommended, final bounded-pass review). A codex-review pass on Task 13's
//     own diff (request 20260928-203739-39767-8933) raised this as a High finding: `sessionTainted`
//     used to be set ONLY on an outer-watchdog rejection, so later steps kept running against a
//     possibly-still-perturbed model after a RESTORE_FAILED (or in-page TIMED_OUT) control. Three
//     prior deferrals left this as a documented tradeoff; the final bounded-pass review's own
//     independent judgment was to stop deferring and fix it now (M1), reusing the EXACT SAME
//     `sessionTainted` short-circuit `runControlSafely` already had for the outer-watchdog case
//     (`tainted(result)`, this file's own main source, additive only -- the outer-watchdog trigger
//     is unchanged). This test replaces the old "documented tradeoff" test: RESTORE_FAILED now
//     aborts every remaining step exactly like an outer-watchdog timeout does, and the overall
//     verdict is still correctly forced to FAIL (this was ALREADY guaranteed by `computeOverall`'s
//     own reviewed precedence before this fix -- M1 only changes how far the run continues after
//     the fact, never the final verdict for a run that already reached this state). The lease is
//     ALSO still correctly left held (RESTORE_FAILED never releases it), so Phase 11's
//     `restoreAllControlPatches` fallback still gets a real chance to find and record it.
// ============================================================================================

test('RESTORE_FAILED mid-sequence taints the session (Task 14 fix wave, M1): aborts every remaining step INCLUDING remaining real controls, overall verdict still correctly forced to FAIL, lease correctly left held for Phase 11', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const deps = buildStagedDeps({
    realm, model, tracker,
    controlsOverrides: {
      hiddenFragment: async () => createControlResult('hidden-fragment', {
        state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false,
        reason: 'simulated-restore-failure',
      }),
    },
  });

  const result = await runHarness(deps, STAGED_CONFIG);

  // Task 14 fix wave (M1): sessionTainted is now true for a RESTORE_FAILED control result too,
  // not only an outer-watchdog rejection.
  assert.equal(result.sessionTainted, true);
  assert.equal(result.controls['hidden-fragment'].state, CONTROL_STATE.RESTORE_FAILED);

  // Every remaining control (capacity-breach, Phase 7c, and beyond -- strictly AFTER the tainting
  // control) is now a fail-closed placeholder, NEVER actually invoked -- mirroring the
  // outer-watchdog taint test's own required property, above.
  assert.equal(result.controls['capacity-breach'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['capacity-breach'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['invalid-bounds'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['invalid-bounds'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['bounds-beyond-tolerance'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['bounds-beyond-tolerance'].reason, 'not-reached:fatal-error');
  assert.equal(tracker.order.includes('pageEvaluate:capacityBreachControlInPage'), false, 'capacity-breach must NEVER actually be invoked once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:invalidBoundsControlInPage'), false, 'invalid-bounds must NEVER actually be invoked once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:boundsBeyondToleranceControlInPage'), false, 'bounds-beyond-tolerance must NEVER actually be invoked once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:observeF7'), false, 'F7 must NEVER actually be observed once tainted');

  // Phase 11 cleanup still ran regardless (the "ALWAYS runs" guarantee, unaffected by this fix).
  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true);
  assert.equal(tracker.order.includes('writeResultAtomically'), true);

  // The overall verdict is STILL correctly forced to FAIL -- computeOverall's own reviewed
  // precedence (unchanged) treats ANY mandatory-control non-PASS-compatible state (RESTORE_FAILED
  // included) as PASS-blocking, and `fatalErrorObserved || sessionTainted` also feeds branch 1 --
  // so this can never silently produce a false PASS either before or after this fix.
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);

  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

// ============================================================================================
// 2c. An in-page-only inner timeout (NOT the outer Node-side watchdog) also taints the session --
//     Task 14 fix wave (M1). Distinct from test 2's own outer-watchdog case: here the control's
//     own `runBridgedControl` call RESOLVES (never rejects) with a well-formed
//     `ControlResult{state: TIMED_OUT}`, produced by the in-page `raceWithInnerTimeout` racing
//     `observeF1`'s own genuine `await` chain -- exactly the scenario M1 describes (the abandoned
//     detection continuation may still be reading the live model after this control's own
//     `finally` already restored/released). `runControlSafely`'s own `tainted(result)` check
//     (this file's own main source) must catch this via `result.state === CONTROL_STATE.TIMED_OUT`
//     on the RESOLVED path, not just the outer-watchdog rejection path tested above.
// ============================================================================================

test('in-page inner-timeout TIMED_OUT mid-sequence also taints the session (Task 14 fix wave, M1): aborts every remaining step, overall verdict still correctly forced to FAIL', async () => {
  const { realm, model } = buildSharedFixture();
  const tracker = callOrderTracker();
  const deps = buildStagedDeps({
    realm, model, tracker,
    controlsOverrides: {
      // A RESOLVED ControlResult (never a rejection) -- distinct from outerWatchdogTimeoutError,
      // which THROWS. This is exactly what runBridgedControl returns when the in-page control's
      // own raceWithInnerTimeout wins the race against a genuinely-awaiting observeF1/F2/F7.
      wrongOwner: async () => createControlResult('wrong-owner', {
        state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null,
        reason: 'perturbation-timeout',
      }),
    },
  });

  const result = await runHarness(deps, STAGED_CONFIG);

  assert.equal(result.sessionTainted, true);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.TIMED_OUT);
  assert.equal(result.controls['wrong-owner'].reason, 'perturbation-timeout');

  // Every remaining control (hidden-fragment, Phase 5c, and beyond -- strictly AFTER wrong-owner)
  // is a fail-closed placeholder, NEVER actually invoked.
  assert.equal(result.controls['hidden-fragment'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['hidden-fragment'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['capacity-breach'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['invalid-bounds'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['bounds-beyond-tolerance'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(tracker.order.includes('pageEvaluate:hiddenFragmentControlInPage'), false, 'hidden-fragment must NEVER actually be invoked once tainted');

  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true);
  assert.equal(tracker.order.includes('writeResultAtomically'), true);

  assert.equal(result.overall, OVERALL_VERDICT.FAIL);

  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

// ============================================================================================
// 3. buildRealControls: confirms the exact six keys `runHarness` reads from `deps.controls`, and
//    that each entry threads `sessionId`/`tokenId`/`gen`/`primaryF7Fields` from `ctx` through to
//    the (unmodified) Task 11/12 factory rather than requiring them at build time.
// ============================================================================================

test('buildRealControls: returns exactly the six keys runHarness reads from deps.controls; each entry is a (ctx) => Promise<ControlResult> function that reads sessionId/tokenId/gen/primaryF7Fields off ctx (never closure-bound at buildRealControls-call time)', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const controls = buildRealControls(pageEvaluate);

  assert.deepEqual(
    Object.keys(controls).sort(),
    ['boundsBeyondTolerance', 'capacityBreach', 'hiddenFragment', 'invalidBounds', 'treeUnavailable', 'wrongOwner'].sort(),
  );

  const ctx = { controlTimeoutMs: 321, sessionId: 's-real', tokenId: 't-real', gen: 9, primaryF7Fields: { censusedDbIds: [55] } };
  await controls.treeUnavailable(ctx);
  assert.equal(seenArg.sessionId, 's-real');
  assert.equal(seenArg.tokenId, 't-real');
  assert.equal(seenArg.gen, 9);
  assert.equal(seenArg.innerTimeoutMs, 321);

  seenArg = null;
  await controls.invalidBounds(ctx);
  assert.equal(seenArg.sessionId, 's-real');
  assert.equal(seenArg.targetDbId, 55, 'invalid-bounds must select targetDbId from THIS call\'s own ctx.primaryF7Fields, never a value captured at buildRealControls-call time');

  // A DIFFERENT ctx on a second call (simulating a later phase step with a freshly-updated
  // sessionId/primaryF7Fields, exactly like runHarness's own controlCtx() produces per call site)
  // must be reflected too -- proving no value is cached/closed-over across calls.
  seenArg = null;
  await controls.wrongOwner({ ...ctx, sessionId: 's-real-2', tokenId: 't-real-2', gen: 10 });
  assert.equal(seenArg.sessionId, 's-real-2');
  assert.equal(seenArg.tokenId, 't-real-2');
  assert.equal(seenArg.gen, 10);
});

// ============================================================================================
// 4. Realm-boundary static check across ALL SIX in-page control functions in one place (Task
//    13's own deliverable 3) -- Task 11/12 each added a per-task-scoped version of this; this is
//    the single comprehensive version covering all six together.
// ============================================================================================

function assertJsonSafeControlResult(result) {
  assert.equal(typeof result, 'object');
  assert.ok(result !== null);
  for (const [key, value] of Object.entries(result)) {
    assert.notEqual(typeof value, 'function', `field '${key}' must never be a function/live object reference`);
    if (value !== null && typeof value === 'object') {
      assert.equal(Array.isArray(value), false, `field '${key}' must never be a live-object-shaped value`);
    }
  }
  assert.doesNotThrow(() => JSON.stringify(result), 'the whole result must be JSON-serializable');
}

test('realm-boundary, all six in-page control functions together: none ever returns a live Viewer/Model/Document/FragmentList-shaped object through pageEvaluate -- only the JSON-safe {detected, restored, timedOut, reason} shape', async () => {
  const { realm } = buildSharedFixture();
  const session = realm.window.__g1.sessions || (realm.window.__g1.sessions = {});
  // Publish a minimal session directly (this test only needs to exercise the SIX in-page
  // functions' own return-shape discipline, not a full staged runHarness sequence -- lighter
  // weight than test 1/2 above, on purpose).
  const g = realm.window.__g1;
  g.loads = { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } };
  g.models = { tok: realm.window.__g1.mod && null }; // placeholder, overwritten below
  // Task 14 fix wave (H1, see g1-svf2-f1-f8-verification.mjs's own wrongOwnerControlInPage/
  // hiddenFragmentControlInPage/capacityBreachControlInPage doc comments): no bare `.fragList`/
  // `.tree` own property -- ONE stable `fragmentList` object backs `getFragmentList()`, matching
  // a real Viewer 7.124.2 Model exactly (this file's own `buildSharedFixture`, above, carries the
  // identical reasoning).
  const tree = { getRootId: () => 0, enumNodeChildren: () => {}, enumNodeFragments: () => {}, getNodeBox: nodeBoxFiller([0, 0, 0, 10, 10, 0]) };
  const fragmentList = { getCount: () => 1, getDbIds: () => ROOT_DB_ID };
  const model = {
    getFragmentList: () => fragmentList,
    isObjectTreeCreated: () => true,
    getObjectTree: () => tree,
    getUnitScale: () => 1, getUnitString: () => null, getGlobalOffset: () => [0, 0, 0], getPlacementTransform: () => null,
  };
  g.models.tok = model;
  const world = fakeWorld();
  const registry = fakeRegistry(world, { sessionId: 's1' });
  registry.register('K', model);
  g.sessions.s1 = { tokenId: 'tok', tokenGen: 1, world, registry, model, K: 'K', modelVersion: 'v1', artifacts: { f1FragmentMapsByRoot: new Map(), f1PopulationClasses: [], f1RootsLength: 0 }, activeControl: null };

  const BASE_ARG = { sessionId: 's1', tokenId: 'tok', gen: 1, innerTimeoutMs: 200 };
  const invocations = [
    [treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' }],
    [wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' }],
    [hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' }],
    [capacityBreachControlInPage, { ...BASE_ARG, controlId: 'capacity-breach', capacityLimit: maxCollisionInstancesPerEpoch }],
    [invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: ROOT_DB_ID }],
    [boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', targetDbId: ROOT_DB_ID, axisIndex: 0, delta: 1, nodeBoxPrimary: [0, 0, 0, 10, 10, 0] }],
  ];
  for (const [fn, arg] of invocations) {
    // Reset the lease between each call -- a fresh, minimal correctness precondition only (each
    // in-page function is independently responsible for its own acquire/release discipline,
    // already proven per-control in mandatorycontrols1/2.test.mjs; this loop's own job is only to
    // check the JSON-safe return-shape discipline below, regardless of whether a given call
    // reaches ok:true (wrong-owner/hidden-fragment/capacity-breach now DO, post-Task-14-H1-fix,
    // against this fixture's own accessor-only model; invalid-bounds/bounds-beyond-tolerance may
    // still report ok:false via their own observeF7 preconditions, since this minimal fixture
    // never seeds F4 artifacts -- immaterial to what this specific test proves).
    g.sessions.s1.activeControl = null;
    const result = await realm.call(fn, arg);
    assertJsonSafeControlResult(result);
  }
});

// ============================================================================================
// 5. buildXControlDep factories confirm CONTROL_NAMES coverage -- sanity that this file's own
//    six-control wiring matches the full CONTROL_NAMES set minus the three controls that need no
//    deps.controls entry (invalid-geometry-consumer/late-completion-after-timeout are synthetic-
//    only and called directly by runHarness; stale-old-model-event is F6's own step 6, copied
//    into the controls manifest, never separately invoked).
// ============================================================================================

test('CONTROL_NAMES sanity: the six keys buildRealControls wires are exactly the six mandatory model-data controls named by the bounded completion pass authorization', async () => {
  const wired = new Set(['tree-unavailable', 'wrong-owner', 'hidden-fragment', 'capacity-breach', 'invalid-bounds', 'bounds-beyond-tolerance']);
  const notWired = new Set(['invalid-geometry-consumer', 'late-completion-after-timeout', 'stale-old-model-event']);
  for (const name of CONTROL_NAMES) {
    assert.ok(wired.has(name) || notWired.has(name), `unexpected control name '${name}' -- update this test's own wired/notWired sets if CONTROL_NAMES genuinely grew`);
  }
  assert.equal(wired.size + notWired.size, CONTROL_NAMES.length, 'CONTROL_NAMES must be exactly the 9 controls this bounded pass already accounts for');
});
