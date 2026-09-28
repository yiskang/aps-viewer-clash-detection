// test/acceptance/g1-svf2-f1-f8-verification.mandatorycontrols1.test.mjs
//
// Offline, browser-free unit tests for the bounded completion pass, area 3 (Task 11) of
// test/acceptance/g1-svf2-f1-f8-verification.mjs: the bridged, in-page-realm versions of THREE
// of the six mandatory controls -- `tree-unavailable` (Phase 3c), `wrong-owner` (Phase 4c),
// `hidden-fragment` (Phase 5c) -- built on Task 10's shared foundation (control lease, scratch
// artifact namespace, `runBridgedControl`). The other three (`capacity-breach`, `invalid-bounds`,
// `bounds-beyond-tolerance`) are Task 12's own separate sibling file.
//
// AUTHORIZATION BOUNDARY (same as every prior stage/task): this file NEVER launches a real
// Chromium browser, NEVER imports playwright, and NEVER calls `main()`/`runHarness` with real
// dependencies. Every in-page function under test is reconstructed from its own source text
// inside an isolated `node:vm` context (this file's own `createPageRealm`, mirroring
// `session.test.mjs`'s/`controlbridge.test.mjs`'s own established pattern) -- never a plain
// `globalThis.window` fake.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  CONTROL_STATE, CONTROL_RESTORATION_REQUIRED,
  IN_PAGE_FUNCTION_REGISTRY,
  acquireControlLease, releaseControlLease, recordControlPatch,
  mapControlAttemptOutcome, runBridgedControl,
  treeUnavailableControlInPage, wrongOwnerControlInPage, hiddenFragmentControlInPage,
  buildTreeUnavailableControlDep, buildWrongOwnerControlDep, buildHiddenFragmentControlDep,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- derived directly from IN_PAGE_FUNCTION_REGISTRY,
// exactly like session.test.mjs/controlbridge.test.mjs's own createPageRealm.
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

// Directly builds window.__g1 state (session + matching load/model records) -- mirrors
// session.test.mjs's own buildF1Session/buildF2Session direct-construction convention, extended
// with the lease-required fields (tokenId/tokenGen/activeControl) controlbridge.test.mjs's own
// realmWithPublishedSession gets "for free" via the real setupSharedSessionResources. Built
// directly here (not via setupSharedSessionResources) so each control's own fixture (fragList/
// tree/isObjectTreeCreated shapes) can be tailored per test without also having to satisfy
// CollisionWorld/ModelRegistry/enumerator construction.
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

// ============================================================================================
// tree-unavailable (Phase 3c) -- no scratch session
// ============================================================================================

function buildTreeUnavailableRealm() {
  const model = {
    isObjectTreeCreated: () => true,
    getObjectTree: (onSuccess, onError) => onError(new Error('original getObjectTree failure')),
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry });
  const realm = createPageRealm(g);
  return { realm, model, world, registry };
}

test('treeUnavailableControlInPage: DETECTED_RESTORED -- patches isObjectTreeCreated/getObjectTree, detects, restores both members, releases the lease', async () => {
  const { realm, model } = buildTreeUnavailableRealm();
  const originalIsObjectTreeCreated = model.isObjectTreeCreated;
  const originalGetObjectTree = model.getObjectTree;

  const result = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(result.timedOut, false);
  assert.equal(model.isObjectTreeCreated, originalIsObjectTreeCreated, 'isObjectTreeCreated must be restored to the original reference');
  assert.equal(model.getObjectTree, originalGetObjectTree, 'getObjectTree must be restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'lease released on full restore success');

  const mapped = mapControlAttemptOutcome('tree-unavailable', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// `treeUnavailableControlInPage` ALWAYS overwrites BOTH `isObjectTreeCreated`/`getObjectTree`
// with its own deterministic, synchronous patches (byte-for-byte copied from the original
// `runTreeUnavailableControl` -- see that function, above) -- so, unlike wrong-owner/hidden-
// fragment (which race against genuinely async, injected `observeF1`/`observeF2`), a fixture's
// OWN `getObjectTree` behavior is never actually consulted by the readiness kernel once the
// control has installed its own patch. NOT_DETECTED/TIMED_OUT are therefore only reachable here
// by making the property assignment ITSELF a silent no-op (a non-configurable, non-writable own
// property -- a real, if unusual, Viewer-model shape this control's own restore-from-descriptor
// discipline must also tolerate): the assignment silently fails (non-strict-mode script
// semantics, matching what a real, non-'use strict' page script would also do), so the ORIGINAL
// method stays installed and genuinely governs the readiness kernel's own behavior.

test('treeUnavailableControlInPage: NOT_DETECTED -- isObjectTreeCreated is non-configurable/non-writable, so the control\'s own patch assignment is silently swallowed (a real "the perturbation never applied" case); the readiness kernel still sees the ORIGINAL (true) value', async () => {
  const model = { getObjectTree: (onSuccess, onError) => onError(new Error('x')) };
  Object.defineProperty(model, 'isObjectTreeCreated', {
    value: () => true, writable: false, configurable: false, enumerable: true,
  });
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry });
  const realm = createPageRealm(g);
  const originalIsObjectTreeCreated = model.isObjectTreeCreated;

  const result = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' });

  assert.equal(result.detected, false);
  assert.equal(result.timedOut, false);
  const mapped = mapControlAttemptOutcome('tree-unavailable', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'restoration still succeeds regardless of detection outcome (nothing to undo here)');
  assert.equal(model.isObjectTreeCreated, originalIsObjectTreeCreated, 'still the original -- it was never really mutable');
});

test('treeUnavailableControlInPage: RESTORE_FAILED -- both members patch/restore cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease is left HELD for Phase 11', async () => {
  const model = { isObjectTreeCreated: () => true, getObjectTree: (onSuccess, onError) => onError(new Error('x')) };
  const world = fakeWorld({ isModelLive: () => false });
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry });
  const realm = createPageRealm(g);

  const result = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('tree-unavailable', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease must remain held when this control\'s own restore attempt fails -- Phase 11 gets a real chance');
});

test('treeUnavailableControlInPage: TIMED_OUT -- getObjectTree is non-configurable/non-writable (the control\'s own patch is silently swallowed), and the ORIGINAL getObjectTree never calls onSuccess/onError -- a genuine hang; isObjectTreeCreated (genuinely patchable) is STILL restored', async () => {
  const model = { isObjectTreeCreated: () => true };
  Object.defineProperty(model, 'getObjectTree', {
    value: () => { /* never calls onSuccess/onError -- a genuine hang */ },
    writable: false, configurable: false, enumerable: true,
  });
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry });
  const realm = createPageRealm(g);
  const originalIsObjectTreeCreated = model.isObjectTreeCreated;

  const result = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable', innerTimeoutMs: 15 });

  assert.equal(result.timedOut, true);
  const mapped = mapControlAttemptOutcome('tree-unavailable', result);
  assert.equal(mapped.state, CONTROL_STATE.TIMED_OUT);
  assert.equal(mapped.detected, null);
  assert.equal(mapped.restored, null);
  assert.equal(model.isObjectTreeCreated, originalIsObjectTreeCreated, 'the genuinely-patchable member must STILL be restored despite the timeout -- the whole point of the two-tier design');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'lease released -- restoration succeeded even though detection timed out');
});

test('treeUnavailableControlInPage: NOT_EXECUTABLE via acquireControlLease failure -- stale gen', async () => {
  const { realm } = buildTreeUnavailableRealm();
  const raw = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable', gen: 999 });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'load-record-mismatch');
});

test('treeUnavailableControlInPage: lease-lost-mid-flight -- the lease is cleared out from under the continuation between the await and result interpretation; abandons cleanly', async () => {
  // getObjectTree is non-configurable/non-writable (the control's own patch assignment silently
  // fails, per the two tests above), and the ORIGINAL getObjectTree is delayed via setTimeout --
  // giving a genuine async gap for the lease-clearing macrotask to interleave with, exactly like
  // the TIMED_OUT test above but resolving BEFORE the outer race times out.
  const delayedModel = { isObjectTreeCreated: () => true };
  Object.defineProperty(delayedModel, 'getObjectTree', {
    value: (onSuccess, onError) => { setTimeout(() => onError(new Error('x')), 5); },
    writable: false, configurable: false, enumerable: true,
  });
  const world = fakeWorld();
  const registry = fakeRegistry(delayedModel);
  const g = { __viewer: {} };
  publishSession(g, { model: delayedModel, world, registry });
  const realm = createPageRealm(g);

  const originalIsObjectTreeCreated = delayedModel.isObjectTreeCreated;

  const resultPromise = realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable', innerTimeoutMs: 200 });
  // Clear the lease from OUTSIDE, simulating Phase 11's fallback restoration racing ahead of this
  // continuation's own resumption after its `await` (the delayed getObjectTree's own onError,
  // firing at t=5ms) -- this fires at t=1ms, strictly before that.
  await new Promise((resolve) => setTimeout(resolve, 1));
  vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.detected, false);
  assert.equal(result.restored, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  // The abandoned continuation must NEVER have restored the patch itself (Phase 11 already did,
  // or will) -- `isObjectTreeCreated` (the one genuinely-patchable member in this fixture) is
  // still the CONTROL's own patched value, not the original, proving no self-restoration
  // happened after the lease was lost.
  assert.notEqual(delayedModel.isObjectTreeCreated, originalIsObjectTreeCreated);

  // Confirm the brief's own required property: this shape flows through mapControlAttemptOutcome
  // (never the runBridgedControl "malformed" catch-all) to a PASS-blocking state.
  const mapped = mapControlAttemptOutcome('tree-unavailable', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('treeUnavailableControlInPage: non-interference proof -- session.artifacts is byte-for-byte unchanged after this control runs (it never touches session.artifacts at all)', async () => {
  const { realm } = buildTreeUnavailableRealm();
  realm.window.__g1.sessions.s1.artifacts = { fakeF3Marker: { some: 'data' }, nested: [1, 2, 3] };
  const before = JSON.stringify(realm.window.__g1.sessions.s1.artifacts);

  await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' });

  const after = JSON.stringify(realm.window.__g1.sessions.s1.artifacts);
  assert.equal(after, before, 'session.artifacts must be completely untouched -- this control patches only session.model members');
  // checks.F3 itself is Node-side-only and never stored under window.__g1 at all (confirmed by
  // direct read of runHarness: `checks.F3 = buildCheckRecord(...)` is a local variable in
  // runHarness's own closure, never written into session.artifacts or any other page-owned
  // structure) -- so "session.artifacts never mutated" is the complete, sufficient proof that
  // F3's own retained result cannot possibly have been corrupted by this control, since there is
  // no page-owned channel through which such corruption could occur.
});

// ============================================================================================
// wrong-owner (Phase 4c) -- scratch session, no copyArtifactKeys
// ============================================================================================

// codex-review (code, high effort, this task's own pre-commit review pass) Critical #1: the
// ORIGINAL version of this fixture used `roots: []`, which never entered observeF1's own
// per-root loop and completely hid a genuine bug (the scratch session's own
// `f1FragmentMapsByRoot` was never seeded -- `observeF1` threw on its first `.set()` call
// against any real, non-empty model). Fixed at the SOURCE (`wrongOwnerControlInPage`, above);
// this fixture now defaults to ONE real root specifically so every test using it (not just a
// single dedicated regression test) exercises the `.set()` path, per the review's own
// recommendation.
function buildWrongOwnerRealm({ ownerMismatchCount = 0, roots = [{ dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd' }] } = {}) {
  const model = {
    fragList: { getDbIds: (id) => 42 },
    getFragmentList: () => ({ getCount: () => 0 }),
  };
  const enumerator = {
    resolveRoots: async () => ({
      roots,
      ownerMismatch: { count: ownerMismatchCount },
      unreachable: { count: 0 },
      population: { count: 0, digest: 'd' },
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
  return { realm, model, world, registry };
}

test('wrongOwnerControlInPage: DETECTED_RESTORED -- patches fragList.getDbIds, observeF1 (via scratch session) reports ownerMismatchCount > 0, restores, releases lease, disposes scratch session', async () => {
  const { realm, model } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const originalGetDbIds = model.fragList.getDbIds;

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(model.fragList.getDbIds, originalGetDbIds, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('wrongOwnerControlInPage: NOT_DETECTED -- observeF1 reports zero ownerMismatchCount, patch still restored', async () => {
  const { realm, model } = buildWrongOwnerRealm({ ownerMismatchCount: 0 });
  const originalGetDbIds = model.fragList.getDbIds;
  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });
  assert.equal(result.detected, false);
  assert.equal(model.fragList.getDbIds, originalGetDbIds);
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('wrongOwnerControlInPage: RESTORE_FAILED -- getDbIds patches/restores cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease left held for Phase 11', async () => {
  const { realm, model } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease remains held on restore failure');
  // Scratch session is still disposed regardless of restore outcome (independent of the lease).
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined);
});

test('wrongOwnerControlInPage: TIMED_OUT -- observeF1 never resolves within innerTimeoutMs, patch still restored', async () => {
  const model = { fragList: { getDbIds: (id) => 42 }, getFragmentList: () => ({ getCount: () => 0 }) };
  const enumerator = { resolveRoots: () => new Promise(() => {}) }; // never resolves
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
  const originalGetDbIds = model.fragList.getDbIds;

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner', innerTimeoutMs: 15 });

  assert.equal(result.timedOut, true);
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.TIMED_OUT);
  assert.equal(model.fragList.getDbIds, originalGetDbIds, 'restored despite the timeout');
});

test('wrongOwnerControlInPage: scratch-session isolation -- the REAL session\'s own artifacts.f1FragmentMapsByRoot/f1PopulationClasses/f1RootsLength/f1PopulationRecords are byte-for-byte unchanged after the control runs (observeF1 wrote only into the scratch session)', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const session = realm.window.__g1.sessions.s1;
  session.artifacts = { preexisting: 'untouched-marker' };
  const before = JSON.stringify(session.artifacts);

  await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  const after = JSON.stringify(session.artifacts);
  assert.equal(after, before, 'the real session\'s own artifacts must never be touched by observeF1 re-running against the scratch session');
  assert.equal('f1FragmentMapsByRoot' in session.artifacts, false, 'observeF1 (scratch-scoped) must never write into the REAL session\'s artifacts');
});

test('wrongOwnerControlInPage: NOT_EXECUTABLE via acquireControlLease failure -- model-mismatch', async () => {
  const { realm } = buildWrongOwnerRealm();
  realm.window.__g1.models.tok = { id: 'DIFFERENT' };
  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'model-mismatch');
});

// Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: this
// control used to read `model.fragList[property]`/`Object.getOwnPropertyDescriptor(fragList,
// property)` UNGUARDED, before the try/finally that owns lease release and scratch-session
// disposal -- a model exposing only `getFragmentList()` (no bare `.fragList` own property, the
// SAME production-realistic shape `capacityBreachControlInPage`'s own already-approved fix
// guards against, Task 12) threw a TypeError OUTSIDE any cleanup path, leaking the lease and
// scratch session. This test proves the fix, mirroring capacityBreachControlInPage's own
// identical regression test in mandatorycontrols2.test.mjs.
test('wrongOwnerControlInPage: NOT_EXECUTABLE -- model exposes only getFragmentList() (no bare .fragList own property, matching a production-realistic model shape); lease released and scratch session disposed, no leak (Task 13 codex-review fix)', async () => {
  const model = {
    // deliberately NO .fragList own property -- getFragmentList() only, as a real Viewer Model
    // conventionally exposes.
    getFragmentList: () => ({ getCount: () => 0 }),
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

  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-fragList-getDbIds');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'the lease must be released, never left leaked');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined, 'the scratch session must be disposed, never left leaked');
});

test('wrongOwnerControlInPage: lease-lost-mid-flight -- abandons cleanly, never restores, never releases a lease it no longer holds', async () => {
  const model = { fragList: { getDbIds: (id) => 42 }, getFragmentList: () => ({ getCount: () => 0 }) };
  let resolveRoots;
  const enumerator = { resolveRoots: () => new Promise((resolve) => { resolveRoots = resolve; }) };
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
  const originalGetDbIds = model.fragList.getDbIds;

  const resultPromise = realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner', innerTimeoutMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
  resolveRoots({ roots: [], ownerMismatch: { count: 1 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } });

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  assert.notEqual(model.fragList.getDbIds, originalGetDbIds, 'the abandoned continuation must never restore the patch itself');
  // codex-review (code, high effort, this task's own pre-commit review pass) Important #2: the
  // abandoned continuation must never dispose a scratch session it can no longer prove it still
  // owns -- confirmed here: the scratch session remains present after abandonment (a disclosed,
  // pre-existing residual: nothing else currently disposes it either -- see the production
  // function's own doc comment).
  assert.ok(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], 'the abandoned continuation must NOT dispose the scratch session it can no longer prove it owns');
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// ============================================================================================
// hidden-fragment (Phase 5c) -- scratch session WITH copyArtifactKeys
// ============================================================================================

function fakeTree({ children, fragmentsByNode }) {
  return {
    getRootId: () => 0,
    enumNodeChildren: (n, cb) => { for (const c of (children.get(n) || [])) cb(c); },
    enumNodeFragments: (n, cb) => { for (const f of (fragmentsByNode.get(n) || [])) cb(f); },
  };
}

function buildHiddenFragmentRealm({ fragmentsByNode, populationClasses, fragListCount }) {
  const tree = fakeTree({ children: new Map([[0, []]]), fragmentsByNode });
  const model = {
    tree,
    isObjectTreeCreated: () => true,
    getObjectTree: () => model.tree,
    getFragmentList: () => ({ getCount: () => fragListCount }),
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, {
    model, world, registry,
    artifacts: { f1PopulationClasses: populationClasses, f1RootsLength: 1 },
  });
  const realm = createPageRealm(g);
  return { realm, model, tree, world, registry };
}

test('hiddenFragmentControlInPage: DETECTED_RESTORED -- patches tree.enumNodeFragments to drop fragId 1, observeF2 (via scratch session) reports loadedButUnreachableCount > 0, restores, releases lease, disposes scratch session', async () => {
  // fragIds 0,1 are both class L and both tree-reachable BEFORE the patch; the patch drops
  // fragId 1 from whichever node reports it, moving it to loaded-but-unreachable.
  const { realm, model, tree } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  const originalEnumNodeFragments = tree.enumNodeFragments;

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(model.tree.enumNodeFragments, originalEnumNodeFragments, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('hiddenFragmentControlInPage: NOT_DETECTED -- fragId 1 was never reachable anyway (dropping it changes nothing observable)', async () => {
  const { realm, model, tree } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0]]]), // fragId 1 never enumerated by this node regardless
    populationClasses: [{ fragId: 0, cls: 'L' }],
    fragListCount: 1,
  });
  const originalEnumNodeFragments = tree.enumNodeFragments;
  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  assert.equal(result.detected, false);
  assert.equal(model.tree.enumNodeFragments, originalEnumNodeFragments);
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('hiddenFragmentControlInPage: RESTORE_FAILED -- enumNodeFragments patches/restores cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease left held for Phase 11', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  realm.window.__g1.sessions.s1.world = fakeWorld({ isModelLive: () => false });

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(result.detected, true);
  assert.equal(result.restored, false);
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.RESTORE_FAILED);
  assert.ok(realm.window.__g1.sessions.s1.activeControl, 'lease remains held on restore failure');
});

test('hiddenFragmentControlInPage: precondition -- observeF2 requires f1PopulationClasses; a session missing it never reaches DETECTED_RESTORED (observeF2-threw-equivalent path)', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: undefined, // deliberately NOT an array -- observeF2's own hard precondition
    fragListCount: 2,
  });
  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  // observeF2 returns {ok:false, reason:'f1-population-classes-not-available-run-observeF1-first'}
  // for the SCRATCH session too (copyArtifactKeys never copied a non-array value) -- the control
  // must treat this the same as any other non-ok check result: detected:false, still restored.
  assert.equal(result.detected, false);
  assert.equal(result.restored, true, 'the patch must still be restored even though observeF2 itself could not run');
});

// Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: same class
// of bug as wrongOwnerControlInPage's own fix above -- this control used to read
// `model.tree[property]`/`Object.getOwnPropertyDescriptor(tree, property)` UNGUARDED, before the
// try/finally that owns lease release and scratch-session disposal, so a model exposing only
// `getObjectTree()` (no bare `.tree` own property, a production-realistic shape) threw a
// TypeError outside any cleanup path and leaked both. This test proves the fix.
test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- model exposes only getObjectTree() (no bare .tree own property, matching a production-realistic model shape); lease released and scratch session disposed, no leak (Task 13 codex-review fix)', async () => {
  const model = {
    // deliberately NO .tree own property -- getObjectTree() only, as a real Viewer Model
    // conventionally exposes.
    getObjectTree: () => ({ getRootId: () => 0, enumNodeChildren: () => {}, enumNodeFragments: () => {} }),
    isObjectTreeCreated: () => true,
    getFragmentList: () => ({ getCount: () => 0 }),
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry, artifacts: { f1PopulationClasses: [], f1RootsLength: 0 } });
  const realm = createPageRealm(g);

  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-tree-enumNodeFragments');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'the lease must be released, never left leaked');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'the scratch session must be disposed, never left leaked');
});

test('hiddenFragmentControlInPage: scratch-session isolation -- the REAL session\'s own artifacts.f2TreeOwnerByFragId (and everything else) is byte-for-byte unchanged; only f1PopulationClasses/f1RootsLength were ever copied (read-only) into the scratch session', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  const session = realm.window.__g1.sessions.s1;
  const before = JSON.stringify({ f1PopulationClasses: session.artifacts.f1PopulationClasses, f1RootsLength: session.artifacts.f1RootsLength });

  await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  const after = JSON.stringify({ f1PopulationClasses: session.artifacts.f1PopulationClasses, f1RootsLength: session.artifacts.f1RootsLength });
  assert.equal(after, before, 'the copied baseline fields must remain untouched (read-only copy into the scratch session)');
  assert.equal('f2TreeOwnerByFragId' in session.artifacts, false, 'observeF2 (scratch-scoped) must never write into the REAL session\'s artifacts');
});

test('hiddenFragmentControlInPage: lease-lost-mid-flight -- abandons cleanly, never restores, never releases a lease it no longer holds', async () => {
  const tree = {
    getRootId: () => 0,
    enumNodeChildren: (n, cb) => { if (n === 0) cb(1); },
    enumNodeFragments: (n, cb) => { cb(0); cb(1); },
  };
  const model = { tree, isObjectTreeCreated: () => true, getObjectTree: () => model.tree, getFragmentList: () => ({ getCount: () => 2 }) };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  publishSession(g, { model, world, registry, artifacts: { f1PopulationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }], f1RootsLength: 1 } });
  const realm = createPageRealm(g);
  const originalEnumNodeFragments = tree.enumNodeFragments;

  // observeF2 is synchronous (never actually awaits), so there is no natural async gap to race
  // against for this control -- instead, directly exercise the SAME abandon path the hard
  // requirement describes by clearing the lease between the (synchronous, already-settled)
  // detection call and the control's own re-check, using a monkeypatched observeF2 wrapper is
  // not available here (observeF2 is a free identifier inside the in-page realm) -- so this test
  // clears the lease via a zero-delay macrotask scheduled from inside a patched enumNodeFragments
  // (the walk observeF2 itself performs), proving the re-check genuinely fires AFTER observeF2
  // has already returned but BEFORE this control interprets the result.
  let clearedDuringWalk = false;
  tree.enumNodeFragments = function patchedForRaceTest(node, callback, recursive) {
    if (!clearedDuringWalk) {
      clearedDuringWalk = true;
      vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
    }
    return originalEnumNodeFragments.call(this, node, callback, recursive);
  };

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment', innerTimeoutMs: 200 });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  // codex-review (code, high effort, this task's own pre-commit review pass) Important #2: same
  // as wrongOwnerControlInPage's own lease-lost test above -- the abandoned continuation must
  // never dispose a scratch session it can no longer prove it still owns.
  assert.ok(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], 'the abandoned continuation must NOT dispose the scratch session it can no longer prove it owns');
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
  assert.notEqual(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
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

test('realm-boundary: treeUnavailableControlInPage never returns a live object', async () => {
  const { realm } = buildTreeUnavailableRealm();
  const result = await realm.call(treeUnavailableControlInPage, { ...BASE_ARG, controlId: 'tree-unavailable' });
  assertJsonSafeControlResult(result);
});

test('realm-boundary: wrongOwnerControlInPage never returns a live object', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });
  assertJsonSafeControlResult(result);
});

test('realm-boundary: hiddenFragmentControlInPage never returns a live object', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  assertJsonSafeControlResult(result);
});

// ============================================================================================
// Node-side wrapper factories (buildTreeUnavailableControlDep/buildWrongOwnerControlDep/
// buildHiddenFragmentControlDep) -- thin glue over runBridgedControl, exercised WITHOUT a real
// page (a fake pageEvaluate dispatching to the real in-page functions via a node:vm realm, or a
// trivially fake pageEvaluate for the plumbing-only assertions).
// ============================================================================================

test('buildWrongOwnerControlDep: returns a (ctx) => Promise<ControlResult> function; sessionId/tokenId/gen are closure-bound, controlTimeoutMs comes from ctx', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
  const dep = buildWrongOwnerControlDep({ pageEvaluate, sessionId: 's1', tokenId: 'tok', gen: 3 });
  assert.equal(typeof dep, 'function');
  const result = await dep({ controlTimeoutMs: 777 });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(seenArg.sessionId, 's1');
  assert.equal(seenArg.tokenId, 'tok');
  assert.equal(seenArg.gen, 3);
  assert.equal(seenArg.controlId, 'wrong-owner');
  assert.equal(seenArg.innerTimeoutMs, 777);
});

test('buildTreeUnavailableControlDep / buildHiddenFragmentControlDep: same plumbing contract as buildWrongOwnerControlDep', async () => {
  for (const [build, controlId] of [
    [buildTreeUnavailableControlDep, 'tree-unavailable'],
    [buildHiddenFragmentControlDep, 'hidden-fragment'],
  ]) {
    let seenArg = null;
    const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false, reason: null }; };
    const dep = build({ pageEvaluate, sessionId: 's2', tokenId: 'tok2', gen: 9 });
    const result = await dep({ controlTimeoutMs: 111 });
    assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
    assert.equal(seenArg.controlId, controlId);
    assert.equal(seenArg.sessionId, 's2');
    assert.equal(seenArg.innerTimeoutMs, 111);
  }
});

test('buildWrongOwnerControlDep: end-to-end against the REAL in-page function via a node:vm realm (not just a fake pageEvaluate)', async () => {
  const { realm, model } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const pageEvaluate = async (fn, arg) => realm.call(fn, arg);
  const dep = buildWrongOwnerControlDep({ pageEvaluate, sessionId: BASE_ARG.sessionId, tokenId: BASE_ARG.tokenId, gen: BASE_ARG.gen });

  const result = await dep({ controlTimeoutMs: 200 });

  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['wrong-owner']);
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
});
