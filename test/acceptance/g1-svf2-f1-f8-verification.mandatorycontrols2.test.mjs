// test/acceptance/g1-svf2-f1-f8-verification.mandatorycontrols2.test.mjs
//
// Offline, browser-free unit tests for the bounded completion pass, area 3 (Task 12) of
// test/acceptance/g1-svf2-f1-f8-verification.mjs: the bridged, in-page-realm versions of the
// LAST THREE of the six mandatory controls -- `capacity-breach` (Phase 7c), `invalid-bounds`
// (Phase 8c), `bounds-beyond-tolerance` (Phase 8c) -- built on Task 10's shared foundation and
// Task 12's own shared-helper extraction (`raceWithInnerTimeout`/`checkSessionLiveness`, also
// retrofitted onto Task 11's own three controls in the SAME production file -- see
// `g1-svf2-f1-f8-verification.mandatorycontrols1.test.mjs`, whose own suite staying 100% green
// after that retrofit is this task's own behavior-preservation proof, re-run as part of
// `npm run test:offline` every time this file runs alongside it).
//
// AUTHORIZATION BOUNDARY (same as every prior stage/task): this file NEVER launches a real
// Chromium browser, NEVER imports playwright, and NEVER calls `main()`/`runHarness` with real
// dependencies. Every in-page function under test is reconstructed from its own source text
// inside an isolated `node:vm` context (this file's own `createPageRealm`, mirroring
// `session.test.mjs`'s/`controlbridge.test.mjs`'s/`mandatorycontrols1.test.mjs`'s own
// established pattern) -- never a plain `globalThis.window` fake.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createViewerApi } from '../../clashpanel/viewer/viewerApi.js';
import { maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
import {
  CONTROL_STATE, CONTROL_RESTORATION_REQUIRED,
  IN_PAGE_FUNCTION_REGISTRY,
  mapControlAttemptOutcome,
  selectBoundsBeyondToleranceTarget,
  capacityBreachControlInPage, invalidBoundsControlInPage, boundsBeyondToleranceControlInPage,
  buildCapacityBreachControlDep, buildInvalidBoundsControlDep, buildBoundsBeyondToleranceControlDep,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- identical convention to mandatorycontrols1.test.mjs.
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

function fakeRegistry(model, overrides = {}) {
  return {
    bindingFor: overrides.bindingFor || (() => ({ model })),
    unregister: overrides.unregister || (() => {}),
    ...overrides,
  };
}

function publishSession(windowObj, { sessionId = 's1', tokenId = 'tok', gen = 1, model, world, registry, K = 'K', artifacts = {}, mod } = {}) {
  windowObj.__g1 = windowObj.__g1 || {};
  const g = windowObj.__g1;
  g.loads = g.loads || {};
  g.loads[tokenId] = { gen, status: 'completed', api: 'loadDocumentNode' };
  g.models = g.models || {};
  g.models[tokenId] = model;
  g.sessions = g.sessions || {};
  g.sessions[sessionId] = {
    tokenId, tokenGen: gen, world, registry, model, K, modelVersion: 'v1',
    artifacts, activeControl: null,
  };
  if (mod) g.mod = mod;
  return sessionId;
}

const BASE_ARG = { sessionId: 's1', tokenId: 'tok', gen: 1, controlId: null, innerTimeoutMs: 200 };

// codex-review fix (see g1-svf2-f1-f8-verification.mjs's own capacityBreachControlInPage doc
// comment): capacityLimit is now a required, passed-in argument (no more in-page hardcoded
// duplicate) -- every capacity-breach test below must supply it.
const CAPACITY_ARG = { controlId: 'capacity-breach', capacityLimit: 20000 };

// ============================================================================================
// capacity-breach (Phase 7c) -- scratch session, no copyArtifactKeys (structurally identical to
// wrong-owner, Task 11)
// ============================================================================================

class FakeCapacityExceededError extends Error {
  constructor(limit, requested) {
    super(`capacity exceeded: ${requested} > ${limit}`);
    this.name = 'CapacityExceededError';
    this.limit = limit;
    this.requested = requested;
  }
}

// Task 14 fix wave (H1, see capacityBreachControlInPage's own doc comment in the main file): a
// real Viewer 7.124.2 Model has no bare `.fragList` own property -- fragments are only reachable
// via `getFragmentList()`, a real accessor that returns the SAME stored object every call. This
// fixture's own `fragmentList` is exactly that: one stable object, returned by `getFragmentList()`
// every time, never a bare `model.fragList` property. The fake enumerator now reads through
// `getFragmentList()` too, matching the real `ViewerElementEnumerator.js`.
function buildCapacityBreachRealm({
  enforceLimit = true, limit = 20000,
  roots = [{ dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd' }],
  resolveRootsOverride = null,
} = {}) {
  const fragmentList = { getCount: () => 5 };
  const model = {
    getFragmentList: () => fragmentList,
  };
  const enumerator = {
    resolveRoots: resolveRootsOverride || (async (binding) => {
      const count = binding.model.getFragmentList().getCount();
      if (enforceLimit && count > limit) throw new FakeCapacityExceededError(limit, count);
      return { roots, ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } };
    }),
  };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': {
      extractFragments: async () => new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]),
      extractAllFragments: async () => ({ records: new Map(), diagnostics: [] }),
    },
    '/clashtest/planning/scopeDigest.js': {
      digestSubtree: async () => ({ digest: 'x' }),
      digestPopulation: async () => ({ digest: 'd' }),
    },
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry, artifacts: {}, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  const realm = createPageRealm(g);
  return { realm, model, fragmentList, world, registry };
}

test('capacityBreachControlInPage: DETECTED_RESTORED -- patches getFragmentList().getCount over the limit (Task 14 fix wave, H1), observeF1 (via scratch session) reports resolveRoots-threw with a CapacityExceededError, restores, releases lease, disposes scratch session', async () => {
  const { realm, fragmentList } = buildCapacityBreachRealm({ enforceLimit: true, limit: 20000 });
  const originalGetCount = fragmentList.getCount;

  const result = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(fragmentList.getCount, originalGetCount, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::capacity-breach'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('capacity-breach', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('capacityBreachControlInPage: NOT_DETECTED -- enforcement never fires (fixture does not actually enforce the limit), patch still restored', async () => {
  const { realm, fragmentList } = buildCapacityBreachRealm({ enforceLimit: false });
  const originalGetCount = fragmentList.getCount;
  const result = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });
  assert.equal(result.detected, false);
  assert.equal(fragmentList.getCount, originalGetCount);
  const mapped = mapControlAttemptOutcome('capacity-breach', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('capacityBreachControlInPage: RESTORE_FAILED -- getCount patches/restores cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease left held for Phase 11', async () => {
  const { realm } = buildCapacityBreachRealm({ enforceLimit: true, limit: 20000 });
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });

  const result = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('capacity-breach', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease remains held on restore failure');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::capacity-breach'], undefined, 'scratch session still disposed regardless of restore outcome');
});

test('capacityBreachControlInPage: TIMED_OUT -- observeF1 (via resolveRoots) never resolves within innerTimeoutMs, patch still restored', async () => {
  const { realm, fragmentList } = buildCapacityBreachRealm({ resolveRootsOverride: () => new Promise(() => {}) });
  const originalGetCount = fragmentList.getCount;

  const result = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG, innerTimeoutMs: 15 });

  assert.equal(result.timedOut, true);
  const mapped = mapControlAttemptOutcome('capacity-breach', result);
  assert.equal(mapped.state, CONTROL_STATE.TIMED_OUT);
  assert.equal(fragmentList.getCount, originalGetCount, 'restored despite the timeout');
});

test('capacityBreachControlInPage: scratch-session isolation -- the REAL session\'s own artifacts are byte-for-byte unchanged after the control runs (observeF1 wrote only into the scratch session)', async () => {
  const { realm } = buildCapacityBreachRealm({ enforceLimit: true, limit: 20000 });
  const session = realm.window.__g1.sessions.s1;
  session.artifacts = { preexisting: 'untouched-marker' };
  const before = JSON.stringify(session.artifacts);

  await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });

  const after = JSON.stringify(session.artifacts);
  assert.equal(after, before, 'the real session\'s own artifacts must never be touched by observeF1 re-running against the scratch session');
  assert.equal('f1FragmentMapsByRoot' in session.artifacts, false, 'observeF1 (scratch-scoped) must never write into the REAL session\'s artifacts');
});

test('capacityBreachControlInPage: NOT_EXECUTABLE via acquireControlLease failure -- lease-already-held', async () => {
  const { realm } = buildCapacityBreachRealm();
  realm.window.__g1.sessions.s1.activeControl = { controlId: 'someone-else', tokenId: 'tok', gen: 1, acquiredAt: Date.now(), patches: [] };
  const raw = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'lease-already-held');
});

test('capacityBreachControlInPage: lease-lost-mid-flight -- abandons cleanly, never restores, never releases a lease it no longer holds', async () => {
  let resolveRoots;
  const { realm, fragmentList } = buildCapacityBreachRealm({
    resolveRootsOverride: () => new Promise((resolve) => { resolveRoots = resolve; }),
  });
  const originalGetCount = fragmentList.getCount;

  const resultPromise = realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG, innerTimeoutMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
  resolveRoots({ roots: [], ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } });

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  assert.notEqual(fragmentList.getCount, originalGetCount, 'the abandoned continuation must never restore the patch itself');
  assert.ok(realm.window.__g1.sessions['s1::control-scratch::capacity-breach'], 'the abandoned continuation must NOT dispose the scratch session it can no longer prove it owns');
  const mapped = mapControlAttemptOutcome('capacity-breach', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// codex-review Critical finding, fixed -- see capacityBreachControlInPage's own doc comment in
// g1-svf2-f1-f8-verification.mjs for the full reasoning: an earlier version read `model.fragList`
// unguarded, BEFORE the try/finally that owns cleanup, so a model shape exposing only
// `getFragmentList()` threw a TypeError OUTSIDE any cleanup path, leaking the just-acquired lease
// (zero recorded patches, so Phase 11's own fallback restore has nothing to act on) and the
// just-created scratch session.
//
// Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the final reviewer verified against
// the actual pinned Viewer 7.124.2 bundle that NO real Model class exposes a bare `.fragList`
// property at all -- only `getFragmentList()`. The test below used to assert `NOT_EXECUTABLE` for
// exactly an accessor-only model exposing a WORKING `getFragmentList().getCount`, encoding the H1
// bug (bare `model.fragList` read, always `undefined` against a real model) as CORRECT behavior.
// Flipped: an accessor-only model with a working `getCount` is what a REAL Viewer 7.124.2 Model
// actually looks like, so it must now reach `DETECTED_RESTORED` (this is exactly
// `buildCapacityBreachRealm`'s own now-accessor-only shape, so this scenario is already fully
// covered by the DETECTED_RESTORED test above -- no separate positive test needed here). The
// genuinely-unavailable case (the returned object has no `getCount` at all) is kept as its own
// test immediately below, still correctly reaching `NOT_EXECUTABLE` -- proving the guard still
// fails closed when the fragment-count accessor is truly absent.
test('capacityBreachControlInPage: NOT_EXECUTABLE -- model exposes getFragmentList() but the returned object has no getCount (fragment-count accessor genuinely unavailable); lease released and scratch session disposed, no leak', async () => {
  const model = {
    // getFragmentList() present, but the object it returns has no getCount at all -- the
    // genuinely-unavailable case, distinct from H1's bare-`.fragList` bug (see doc comment above).
    getFragmentList: () => ({}),
  };
  const enumerator = { resolveRoots: async () => ({ roots: [], ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } }) };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': { extractFragments: async () => new Map(), extractAllFragments: async () => ({ records: new Map(), diagnostics: [] }) },
    '/clashtest/planning/scopeDigest.js': { digestSubtree: async () => ({ digest: 'x' }), digestPopulation: async () => ({ digest: 'd' }) },
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry, artifacts: {}, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  const realm = createPageRealm(g);

  const raw = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-fragList-getCount');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'the lease must be released, never left leaked');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::capacity-breach'], undefined, 'the scratch session must be disposed, never left leaked');
});

test('capacityBreachControlInPage: NOT_EXECUTABLE -- capacityLimit is missing/non-numeric; lease released and scratch session disposed, no leak', async () => {
  const { realm } = buildCapacityBreachRealm();
  const raw = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, controlId: 'capacity-breach' /* capacityLimit deliberately omitted */ });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-fragList-getCount');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::capacity-breach'], undefined);
});

test('buildCapacityBreachControlDep: capacityLimit defaults to the REAL imported maxCollisionInstancesPerEpoch constant (codex-review fix -- no more in-page hardcoded duplicate)', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const dep = buildCapacityBreachControlDep({ pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 1 });
  await dep({ controlTimeoutMs: 200 });
  assert.equal(seenArg.capacityLimit, maxCollisionInstancesPerEpoch, 'must default to the REAL, imported Node-side constant, never a hardcoded duplicate');
});

// ============================================================================================
// invalid-bounds (Phase 8c) / bounds-beyond-tolerance (Phase 8c) -- shared F7 fixture. Both
// controls re-run observeF7 (via scratch session, WITH copyArtifactKeys) -- reusing the SAME
// real, unmodified createViewerApi/getElementWorldBounds session.test.mjs's own F7 fixture
// convention already established for observeF7 itself.
// ============================================================================================

const FAKE_AUTODESK_EVENTS = { Viewing: { BEFORE_MODEL_UNLOAD_EVENT: 'beforeModelUnload', MODEL_REMOVED_EVENT: 'modelRemoved' } };
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function fakeF7Mod() {
  return { '/clashpanel/viewer/viewerApi.js': { createViewerApi } };
}

function fakeF7Viewer(overrides = {}) {
  return { overlays: {}, getAggregateHiddenNodes: () => [], ...overrides };
}

// One simple non-indexed triangle geometry entry (F4's own frozen per-geometry snapshot shape)
// -- vertices (0,0,0),(10,0,0),(0,10,0), so under an identity world matrix its own local AABB
// and world-space bounds are both exactly [0,0,0,10,10,0]. Mirrors session.test.mjs's own
// `triangleGeometryEntry` exactly.
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

function nodeBoxFiller(box) {
  return (dbId, buffer) => { for (let i = 0; i < 6; i += 1) buffer[i] = box[i]; };
}

// Builds a full session realm whose real F1/F4 artifacts + model are shaped so observeF7
// reports dbId 100 as 'agrees' by default (the primary-pass baseline both controls perturb away
// from). getObjectTree() returns the SAME tree object every call (a real Model's cached
// InstanceTree would), matching session.test.mjs's own `fakeModelForBoundsControl` convention.
function buildBoundsControlRealm({ getNodeBoxImpl = nodeBoxFiller([0, 0, 0, 10, 10, 0]) } = {}) {
  const tree = { getNodeBox: getNodeBoxImpl };
  const model = {
    getUnitScale: () => 1,
    getUnitString: () => null,
    getGlobalOffset: () => [0, 0, 0],
    getPlacementTransform: () => null,
    getFragmentList: () => ({}),
    getObjectTree: () => tree,
  };
  const rootFragments = new Map([[100, new Map([[0, {}]])]]);
  const f4Geometry = new Map([[1, triangleGeometryEntry()]]);
  const f4FragmentGeometryId = new Map([[0, 1]]);
  const f4WorldMatricesByFragId = new Map([[0, IDENTITY_MATRIX]]);
  const artifacts = { f1FragmentMapsByRoot: rootFragments, f4Geometry, f4FragmentGeometryId, f4WorldMatricesByFragId };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: fakeF7Viewer(), Autodesk: FAKE_AUTODESK_EVENTS };
  publishSession(g, { model, world, registry, artifacts, mod: fakeF7Mod() });
  const realm = createPageRealm(g);
  return { realm, model, tree, world, registry };
}

// ============================================================================================
// invalid-bounds
// ============================================================================================

test('invalidBoundsControlInPage: DETECTED_RESTORED -- patches tree.getNodeBox to NaN for targetDbId, observeF7 (via scratch session) reports viewerApiNull, restores, releases lease, disposes scratch session', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;

  const result = await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 100 });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(tree.getNodeBox, originalGetNodeBox, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::invalid-bounds'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('invalid-bounds', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('invalidBoundsControlInPage: NOT_DETECTED -- targetDbId is not a censused dbId, so the perturbation never actually applies during observeF7\'s own walk; patch still restored', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;
  const result = await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 999 });
  assert.equal(result.detected, false);
  assert.equal(tree.getNodeBox, originalGetNodeBox);
  const mapped = mapControlAttemptOutcome('invalid-bounds', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('invalidBoundsControlInPage: RESTORE_FAILED -- getNodeBox patches/restores cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease left held for Phase 11', async () => {
  const { realm } = buildBoundsControlRealm();
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });

  const result = await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 100 });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('invalid-bounds', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease remains held on restore failure');
});

// observeF7 (like observeF1/observeF2) is fully synchronous -- confirmed by direct source read: it
// is declared `async` but never contains an `await`. Exactly like Task 11's own
// hiddenFragmentControlInPage (whose own detection oracle, observeF2, is equally synchronous),
// this means there is no genuine way to make the RACED detection call hang past innerTimeoutMs --
// a microtask-resolved (even instantly-settled) promise always wins a race against ANY setTimeout
// macrotask, including one scheduled with 0/negative ms, per the JS event-loop's own microtask-
// before-macrotask ordering guarantee. Task 11's own test suite has no dedicated TIMED_OUT test
// for hiddenFragmentControlInPage for the identical reason (confirmed by inspecting
// mandatorycontrols1.test.mjs directly) -- this is the SAME documented, structural limitation,
// not a new gap this task introduces. The two-tier-timeout MECHANISM itself (raceWithInnerTimeout
// correctly producing a TIMED_OUT-shaped result with the patch still restored) is already proven
// directly by capacityBreachControlInPage's own TIMED_OUT test above (observeF1 DOES genuinely
// await resolveRoots) and by Task 11's own tree-unavailable/wrong-owner TIMED_OUT tests -- all
// three controls in THIS file share the exact same `raceWithInnerTimeout` primitive (post-
// retrofit), so its correctness does not need re-proving per control.

test('invalidBoundsControlInPage: scratch-session isolation -- the REAL session\'s own artifacts (f1FragmentMapsByRoot/f4Geometry/f4FragmentGeometryId/f4WorldMatricesByFragId) are completely unaffected -- observeF7 never writes into session.artifacts at all (confirmed by direct source read); the scratch session only ever holds read-only copies', async () => {
  const { realm } = buildBoundsControlRealm();
  const session = realm.window.__g1.sessions.s1;
  const artifactKeysBefore = Object.keys(session.artifacts).sort();
  const f1Before = session.artifacts.f1FragmentMapsByRoot;
  const f1SizeBefore = f1Before.size;

  await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 100 });

  assert.deepEqual(Object.keys(session.artifacts).sort(), artifactKeysBefore, 'no new artifact keys introduced into the REAL session');
  assert.equal(session.artifacts.f1FragmentMapsByRoot, f1Before, 'same Map reference -- never replaced');
  assert.equal(session.artifacts.f1FragmentMapsByRoot.size, f1SizeBefore, 'the REAL session\'s own f1FragmentMapsByRoot is untouched');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::invalid-bounds'], undefined, 'scratch session disposed');
});

test('invalidBoundsControlInPage: lease-lost-mid-flight -- the lease is cleared from inside a synchronous callback observeF7 itself invokes (model.getUnitScale, called BEFORE the per-dbId bounds loop) during its own walk, before this control interprets the result; abandons cleanly', async () => {
  const { realm, tree, model } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;
  let cleared = false;
  const originalGetUnitScale = model.getUnitScale;
  model.getUnitScale = () => {
    if (!cleared) {
      cleared = true;
      vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
    }
    return originalGetUnitScale();
  };

  const result = await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 100 });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  assert.notEqual(tree.getNodeBox, originalGetNodeBox, 'the abandoned continuation must never restore the patch itself');
  assert.ok(realm.window.__g1.sessions['s1::control-scratch::invalid-bounds'], 'the abandoned continuation must NOT dispose the scratch session it can no longer prove it owns');
  const mapped = mapControlAttemptOutcome('invalid-bounds', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// ============================================================================================
// bounds-beyond-tolerance
// ============================================================================================

// axisIndex 0 ('x'), a large-but-finite delta -- shifts dbId 100's box by +1000 on x, well
// outside any tolerance bracket, so boundsAgreement classifies 'disagrees' (never a weaker
// state, per the original's own doc comment).
const BBT_ARGS = { targetDbId: 100, axisIndex: 0, delta: 1000, nodeBoxPrimary: [0, 0, 0, 10, 10, 0] };

test('boundsBeyondToleranceControlInPage: DETECTED_RESTORED -- shifts the target box by delta on axisIndex, observeF7 (via scratch session) reports disagrees, restores (bit-exact oracle passes), releases lease, disposes scratch session', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;

  const result = await realm.call(boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', ...BBT_ARGS });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(tree.getNodeBox, originalGetNodeBox, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::bounds-beyond-tolerance'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('bounds-beyond-tolerance', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(mapped.restorationRequired, CONTROL_RESTORATION_REQUIRED['bounds-beyond-tolerance']);
});

test('boundsBeyondToleranceControlInPage: NOT_DETECTED -- targetDbId is not censused, so the perturbation never applies; patch still restored', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;
  const result = await realm.call(boundsBeyondToleranceControlInPage, {
    ...BASE_ARG, controlId: 'bounds-beyond-tolerance', targetDbId: 999, axisIndex: 0, delta: 1000, nodeBoxPrimary: [0, 0, 0, 10, 10, 0],
  });
  assert.equal(result.detected, false);
  assert.equal(tree.getNodeBox, originalGetNodeBox);
  const mapped = mapControlAttemptOutcome('bounds-beyond-tolerance', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('boundsBeyondToleranceControlInPage: RESTORE_FAILED via the ordinary liveness oracle -- descriptor restores cleanly, but world.isModelLive -> false; lease left held for Phase 11', async () => {
  const { realm } = buildBoundsControlRealm();
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });

  const result = await realm.call(boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', ...BBT_ARGS });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('bounds-beyond-tolerance', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease remains held on restore failure');
});

// The stronger restoration oracle, proven to earn its keep: a scenario where the property
// descriptor IS correctly reinstalled (membersRestored: true) and world/registry liveness both
// pass, but the bit-exact re-read via the REAL getElementWorldBounds does NOT match the
// primary-pass nodeBoxPrimary (deliberately mismatched here, simulating the model's true bounds
// having drifted since the primary F7 pass) -- proving this stronger check catches something the
// weaker "descriptor was reinstalled" check alone would have missed entirely.
test('boundsBeyondToleranceControlInPage: RESTORE_FAILED via the STRONGER bit-exact oracle -- the descriptor IS correctly reinstalled (the weaker check alone would say restored:true), but the re-read via the real getElementWorldBounds does NOT bit-exact-match a deliberately mismatched primary-pass nodeBoxPrimary', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;
  const mismatchedNodeBoxPrimary = [0, 0, 0, 10, 10, 0.5]; // real re-read will be [0,0,0,10,10,0]

  const result = await realm.call(boundsBeyondToleranceControlInPage, {
    ...BASE_ARG, controlId: 'bounds-beyond-tolerance', targetDbId: 100, axisIndex: 0, delta: 1000, nodeBoxPrimary: mismatchedNodeBoxPrimary,
  });

  assert.equal(tree.getNodeBox, originalGetNodeBox, 'the descriptor itself IS correctly restored -- a descriptor-only check would say "restored: true" here');
  assert.equal(result.detected, true);
  assert.equal(result.restored, false, 'the STRONGER bit-exact oracle must still fail restoration');
  const mapped = mapControlAttemptOutcome('bounds-beyond-tolerance', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
});

test('boundsBeyondToleranceControlInPage: perturbation-not-representable mid-flight -- the live buffer shift (delta: Infinity) is non-finite; the patch still calls through to the original result, restoration still runs unconditionally, ok:false is returned', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;

  const result = await realm.call(boundsBeyondToleranceControlInPage, {
    ...BASE_ARG, controlId: 'bounds-beyond-tolerance', targetDbId: 100, axisIndex: 0, delta: Infinity, nodeBoxPrimary: [0, 0, 0, 10, 10, 0],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'perturbation-not-representable');
  assert.equal(tree.getNodeBox, originalGetNodeBox, 'restoration still ran unconditionally despite the not-representable outcome');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'lease released -- restoration succeeded');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::bounds-beyond-tolerance'], undefined, 'scratch session still disposed');
});

// codex-review DISCLOSED, documented residual (see boundsBeyondToleranceControlInPage's own doc
// comment in g1-svf2-f1-f8-verification.mjs for the full reasoning, including why the ORIGINAL
// already-accepted Node-side runBoundsBeyondToleranceControl has the identical characteristic):
// when perturbationRepresentable is false AND the post-restore liveness check ALSO genuinely
// fails, the returned shape is STILL {ok:false, reason:'perturbation-not-representable'} -- it
// does not distinguish "nothing was ever attempted" from "attempted, and restoration actually
// failed." This test proves the ACTUAL session state is still handled correctly regardless (the
// lease is genuinely left HELD, exactly as a real RESTORE_FAILED would leave it, so Phase 11's
// own fallback -- which reads session.activeControl directly, never this function's return value
// -- still sees and can act on it) -- only this function's OWN returned diagnostic is imprecise
// in this specific combined case, which is what is disclosed, not silently hidden.
test('boundsBeyondToleranceControlInPage: DISCLOSED residual -- perturbation-not-representable AND a genuine liveness failure combined; the returned shape says perturbation-not-representable, but the lease is correctly left HELD (not released) because restoration actually failed, matching a real RESTORE_FAILED outcome\'s own lease-retention behavior', async () => {
  const { realm, tree } = buildBoundsControlRealm();
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });
  const originalGetNodeBox = tree.getNodeBox;

  const result = await realm.call(boundsBeyondToleranceControlInPage, {
    ...BASE_ARG, controlId: 'bounds-beyond-tolerance', targetDbId: 100, axisIndex: 0, delta: Infinity, nodeBoxPrimary: [0, 0, 0, 10, 10, 0],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'perturbation-not-representable', 'the RETURNED diagnostic does not distinguish this from the simpler not-representable case (disclosed, not fixed)');
  assert.equal(tree.getNodeBox, originalGetNodeBox, 'the descriptor itself IS restored');
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'the lease is correctly left HELD -- restoration genuinely failed (liveness check), so Phase 11 still gets a real chance via session.activeControl directly');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::bounds-beyond-tolerance'], undefined, 'scratch session is still disposed regardless');
});

test('boundsBeyondToleranceControlInPage: scratch-session isolation -- the REAL session\'s own artifacts are completely unaffected', async () => {
  const { realm } = buildBoundsControlRealm();
  const session = realm.window.__g1.sessions.s1;
  const artifactKeysBefore = Object.keys(session.artifacts).sort();
  const f1Before = session.artifacts.f1FragmentMapsByRoot;

  await realm.call(boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', ...BBT_ARGS });

  assert.deepEqual(Object.keys(session.artifacts).sort(), artifactKeysBefore);
  assert.equal(session.artifacts.f1FragmentMapsByRoot, f1Before);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::bounds-beyond-tolerance'], undefined);
});

test('boundsBeyondToleranceControlInPage: lease-lost-mid-flight -- cleared from inside model.getUnitScale during observeF7\'s own synchronous walk; abandons cleanly', async () => {
  const { realm, tree, model } = buildBoundsControlRealm();
  const originalGetNodeBox = tree.getNodeBox;
  let cleared = false;
  const originalGetUnitScale = model.getUnitScale;
  model.getUnitScale = () => {
    if (!cleared) {
      cleared = true;
      vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
    }
    return originalGetUnitScale();
  };

  const result = await realm.call(boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', ...BBT_ARGS });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  assert.notEqual(tree.getNodeBox, originalGetNodeBox, 'the abandoned continuation must never restore the patch itself');
  assert.ok(realm.window.__g1.sessions['s1::control-scratch::bounds-beyond-tolerance'], 'the abandoned continuation must NOT dispose the scratch session it can no longer prove it owns');
  const mapped = mapControlAttemptOutcome('bounds-beyond-tolerance', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// ============================================================================================
// selectBoundsBeyondToleranceTarget-driven Node-side wrapper: the perturbation-not-representable
// early-exit path -- no lease acquired, page never entered at all.
// ============================================================================================

test('buildBoundsBeyondToleranceControlDep: NOT_EXECUTABLE -- no dbId agreed in the primary pass; pageEvaluate is NEVER called (page never entered)', async () => {
  let pageEvaluateCalled = false;
  const pageEvaluate = async () => { pageEvaluateCalled = true; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const dep = buildBoundsBeyondToleranceControlDep({
    pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 1,
    primaryF7Fields: { boundsAgreement: { 100: 'disagrees' }, boundsScalePerDbId: {} },
  });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'perturbation-not-representable');
  assert.equal(pageEvaluateCalled, false, 'the page must never be entered when nothing qualifies for perturbation');
});

test('buildBoundsBeyondToleranceControlDep: NOT_EXECUTABLE -- target selected, but refBox/nodeBoxPrimary/S_a are missing from primaryF7Fields; pageEvaluate is NEVER called', async () => {
  let pageEvaluateCalled = false;
  const pageEvaluate = async () => { pageEvaluateCalled = true; return {}; };
  const dep = buildBoundsBeyondToleranceControlDep({
    pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 1,
    primaryF7Fields: {
      boundsAgreement: { 100: 'agrees' },
      boundsScalePerDbId: { 100: { x: { S_a: 10 } } },
      // fragmentBoundsUnion/elementWorldBounds deliberately absent
    },
  });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'perturbation-not-representable');
  assert.equal(pageEvaluateCalled, false);
});

test('buildBoundsBeyondToleranceControlDep: plumbing -- valid target computes delta/axisIndex/nodeBoxPrimary and forwards them into the in-page arg; end-to-end against the REAL in-page function via a node:vm realm', async () => {
  const { realm } = buildBoundsControlRealm();
  const pageEvaluate = async (fn, arg) => realm.call(fn, arg);
  const primaryF7Fields = {
    boundsAgreement: { 100: 'agrees' },
    boundsScalePerDbId: { 100: { x: { S_a: 10 }, y: { S_a: 10 }, z: { S_a: 10 } } },
    fragmentBoundsUnion: { 100: [0, 0, 0, 10, 10, 0] },
    elementWorldBounds: { 100: [0, 0, 0, 10, 10, 0] },
  };
  const dep = buildBoundsBeyondToleranceControlDep({ pageEvaluate, sessionId: BASE_ARG.sessionId, tokenId: BASE_ARG.tokenId, gen: BASE_ARG.gen, primaryF7Fields });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['bounds-beyond-tolerance']);
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
});

// ============================================================================================
// buildInvalidBoundsControlDep / buildCapacityBreachControlDep -- plumbing + end-to-end
// ============================================================================================

test('buildInvalidBoundsControlDep: NOT_EXECUTABLE -- no censused dbId available; pageEvaluate is NEVER called', async () => {
  let pageEvaluateCalled = false;
  const pageEvaluate = async () => { pageEvaluateCalled = true; return {}; };
  const dep = buildInvalidBoundsControlDep({ pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 1, primaryF7Fields: { censusedDbIds: [] } });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'precondition-unmet');
  assert.equal(pageEvaluateCalled, false);
});

test('buildInvalidBoundsControlDep: plumbing -- targetDbId is the lowest sorted censusedDbId; sessionId/tokenId/gen are closure-bound, controlTimeoutMs comes from ctx', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const dep = buildInvalidBoundsControlDep({
    pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 3,
    primaryF7Fields: { censusedDbIds: [300, 100, 200] },
  });

  const result = await dep({ controlTimeoutMs: 777 });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(seenArg.sessionId, 's1');
  assert.equal(seenArg.tokenId, 'tok');
  assert.equal(seenArg.gen, 3);
  assert.equal(seenArg.controlId, 'invalid-bounds');
  assert.equal(seenArg.targetDbId, 300, 'the FIRST element of censusedDbIds as given, not re-sorted here (observeF7 already sorts it ascending)');
  assert.equal(seenArg.innerTimeoutMs, 777);
});

test('buildInvalidBoundsControlDep: end-to-end against the REAL in-page function via a node:vm realm (not just a fake pageEvaluate)', async () => {
  const { realm } = buildBoundsControlRealm();
  const pageEvaluate = async (fn, arg) => realm.call(fn, arg);
  const dep = buildInvalidBoundsControlDep({
    pageEvaluate, sessionId: BASE_ARG.sessionId, tokenId: BASE_ARG.tokenId, gen: BASE_ARG.gen,
    primaryF7Fields: { censusedDbIds: [100] },
  });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['invalid-bounds']);
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
});

test('buildCapacityBreachControlDep: returns a (ctx) => Promise<ControlResult> function; sessionId/tokenId/gen are closure-bound, controlTimeoutMs comes from ctx', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const dep = buildCapacityBreachControlDep({ pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 3 });
  assert.equal(typeof dep, 'function');
  const result = await dep({ controlTimeoutMs: 777 });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(seenArg.sessionId, 's1');
  assert.equal(seenArg.tokenId, 'tok');
  assert.equal(seenArg.gen, 3);
  assert.equal(seenArg.controlId, 'capacity-breach');
  assert.equal(seenArg.innerTimeoutMs, 777);
});

test('buildCapacityBreachControlDep: end-to-end against the REAL in-page function via a node:vm realm (not just a fake pageEvaluate)', async () => {
  const { realm } = buildCapacityBreachRealm({ enforceLimit: true, limit: 20000 });
  const pageEvaluate = async (fn, arg) => realm.call(fn, arg);
  const dep = buildCapacityBreachControlDep({ pageEvaluate, sessionId: BASE_ARG.sessionId, tokenId: BASE_ARG.tokenId, gen: BASE_ARG.gen });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['capacity-breach']);
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
});

// ============================================================================================
// Realm-boundary static check (all three controls): never returns a live Viewer/Model/
// Document/FragmentList-shaped object through pageEvaluate -- only the JSON-safe
// {detected, restored, timedOut, reason} shape (or the ok:false precondition shape).
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

test('realm-boundary: capacityBreachControlInPage never returns a live object', async () => {
  const { realm } = buildCapacityBreachRealm({ enforceLimit: true, limit: 20000 });
  const result = await realm.call(capacityBreachControlInPage, { ...BASE_ARG, ...CAPACITY_ARG });
  assertJsonSafeControlResult(result);
});

test('realm-boundary: invalidBoundsControlInPage never returns a live object', async () => {
  const { realm } = buildBoundsControlRealm();
  const result = await realm.call(invalidBoundsControlInPage, { ...BASE_ARG, controlId: 'invalid-bounds', targetDbId: 100 });
  assertJsonSafeControlResult(result);
});

test('realm-boundary: boundsBeyondToleranceControlInPage never returns a live object', async () => {
  const { realm } = buildBoundsControlRealm();
  const result = await realm.call(boundsBeyondToleranceControlInPage, { ...BASE_ARG, controlId: 'bounds-beyond-tolerance', ...BBT_ARGS });
  assertJsonSafeControlResult(result);
});

// ============================================================================================
// selectBoundsBeyondToleranceTarget sanity re-check (Node-side, pure, unchanged by this task --
// already covered by session.test.mjs; one direct confirmation here that this file's own
// buildBoundsBeyondToleranceControlDep calls it correctly, not a full re-test of its own logic).
// ============================================================================================

test('selectBoundsBeyondToleranceTarget: sanity -- still the lowest sorted agreeing dbId with a finite/normal/positive S_a (unchanged by this task)', () => {
  const fields = {
    boundsAgreement: { 300: 'agrees', 100: 'disagrees', 200: 'agrees' },
    boundsScalePerDbId: {
      200: { x: { S_a: 5 }, y: { S_a: 5 }, z: { S_a: 5 } },
      300: { x: { S_a: 9 }, y: { S_a: 9 }, z: { S_a: 9 } },
    },
  };
  assert.deepEqual(selectBoundsBeyondToleranceTarget(fields), { dbId: 200, axis: 'x' });
});
