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
  selectAuthoritativeFragmentTarget, selectHiddenFragmentTarget,
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
// Task 17 (bounded H1-H3 remediation pass, H3): selectAuthoritativeFragmentTarget -- pure,
// directly Node-testable (touches no `window` state). The shared selection rule both
// wrongOwnerControlInPage/hiddenFragmentControlInPage now use instead of hard-coding fragId 0/1.
// ============================================================================================

test('selectAuthoritativeFragmentTarget: selects the numerically smallest fragId key, deterministically, regardless of Map insertion order', () => {
  const outOfOrder = new Map([
    [55, { ownerDbId: 900 }],
    [7, { ownerDbId: 700 }],
    [12, { ownerDbId: 1200 }],
  ]);
  const differentOrder = new Map([
    [12, { ownerDbId: 1200 }],
    [55, { ownerDbId: 900 }],
    [7, { ownerDbId: 700 }],
  ]);
  assert.deepEqual(selectAuthoritativeFragmentTarget(outOfOrder), { fragId: 7, ownerDbId: 700 });
  assert.deepEqual(selectAuthoritativeFragmentTarget(differentOrder), { fragId: 7, ownerDbId: 700 });
});

test('selectAuthoritativeFragmentTarget: sparse/large fragIds still select the numeric minimum -- correctness is not coincidentally tied to small numbers', () => {
  const sparse = new Map([
    [1000000, { ownerDbId: 9 }],
    [3, { ownerDbId: 8 }],
    [1000, { ownerDbId: 7 }],
  ]);
  assert.deepEqual(selectAuthoritativeFragmentTarget(sparse), { fragId: 3, ownerDbId: 8 });
});

test('selectAuthoritativeFragmentTarget: null/undefined/non-Map/empty all return null (fail-closed trigger); a record with no numeric ownerDbId yields ownerDbId: null rather than throwing', () => {
  assert.equal(selectAuthoritativeFragmentTarget(null), null);
  assert.equal(selectAuthoritativeFragmentTarget(undefined), null);
  assert.equal(selectAuthoritativeFragmentTarget({}), null);
  assert.equal(selectAuthoritativeFragmentTarget(new Map()), null);
  assert.deepEqual(selectAuthoritativeFragmentTarget(new Map([[4, {}]])), { fragId: 4, ownerDbId: null });
});

// codex-review (code, medium effort, this task's own pre-commit review pass) High finding, fixed:
// `selectHiddenFragmentTarget` intersects tree-reachability (f2TreeOwnerByFragId) with F1's own
// class-'L' fragIds (f1PopulationClasses) BEFORE the numeric-minimum pick -- see its own doc
// comment (main file) for the full reasoning and the review's own concrete repro.
test('selectHiddenFragmentTarget: intersects tree-reachable fragIds with F1\'s own class-L fragIds -- a smaller but ineligible (non-L) fragId is skipped in favor of a larger eligible (L) one', () => {
  const f2 = new Map([[5, { ownerDbId: 0, conflictingOwnerDbId: null }], [7, { ownerDbId: 0, conflictingOwnerDbId: null }]]);
  const f1Classes = [{ fragId: 5, cls: 'N' }, { fragId: 7, cls: 'L' }];
  assert.deepEqual(selectHiddenFragmentTarget(f2, f1Classes), { fragId: 7, ownerDbId: 0 });
});

test('selectHiddenFragmentTarget: returns null when the intersection is empty, even though EITHER input alone is non-empty', () => {
  // f2 has fragId 5 (tree-reachable); f1Classes says fragId 5 is class N, never L -- no overlap.
  assert.equal(selectHiddenFragmentTarget(new Map([[5, { ownerDbId: 0 }]]), [{ fragId: 5, cls: 'N' }]), null);
  // f1Classes has a class-L fragId (9), but it is not present in f2 at all (never tree-reachable).
  assert.equal(selectHiddenFragmentTarget(new Map([[5, { ownerDbId: 0 }]]), [{ fragId: 9, cls: 'L' }]), null);
  // Neither input has any data at all.
  assert.equal(selectHiddenFragmentTarget(new Map(), []), null);
  assert.equal(selectHiddenFragmentTarget(null, null), null);
  assert.equal(selectHiddenFragmentTarget(new Map([[5, { ownerDbId: 0 }]]), undefined), null);
});

test('selectHiddenFragmentTarget: deterministic minimum WITHIN the eligible intersection, regardless of input order', () => {
  const f2 = new Map([[55, { ownerDbId: 1 }], [7, { ownerDbId: 2 }], [12, { ownerDbId: 3 }], [3, { ownerDbId: 4 }]]);
  const f1Classes = [{ fragId: 55, cls: 'L' }, { fragId: 7, cls: 'N' }, { fragId: 12, cls: 'L' }, { fragId: 3, cls: 'U' }];
  // Eligible intersection is {55, 12} (7 is class N, 3 is class U) -- the smaller of the two, 12.
  assert.deepEqual(selectHiddenFragmentTarget(f2, f1Classes), { fragId: 12, ownerDbId: 3 });
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
// Task 14 fix wave (H1, see wrongOwnerControlInPage's own doc comment in the main file): a real
// Viewer 7.124.2 Model has no bare `.fragList` own property -- fragments are only reachable via
// `getFragmentList()`, a real accessor that returns the SAME stored object every call. This
// fixture's own `fragmentList` is exactly that: one stable object, returned by `getFragmentList()`
// every time, never a bare `model.fragList` property.
// Task 17 (H3 fix) disposition note: `f1PopulationRecords` is now a REQUIRED precondition this
// control's own new eligibility check reads BEFORE ever acquiring the lease (see
// wrongOwnerControlInPage's own doc comment, main file) -- defaults to a Map containing exactly
// fragId 0 -> ownerDbId 10 (matching this fixture's own pre-existing `roots`/`extractFragments`
// convention, fragId 0/ownerDbId 10) so every EXISTING test using this builder's own default
// keeps exercising fragId 0 as its selected target, unchanged in spirit, without needing its own
// per-test edit -- adapted, not replaced.
function buildWrongOwnerRealm({
  ownerMismatchCount = 0,
  roots = [{ dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'd' }],
  f1PopulationRecords = new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]),
} = {}) {
  const fragmentList = { getDbIds: (id) => 42, getCount: () => 0 };
  const model = {
    getFragmentList: () => fragmentList,
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
  publishSession(g, { model, world, registry, artifacts: { f1PopulationRecords }, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  const realm = createPageRealm(g);
  return { realm, model, fragmentList, world, registry };
}

test('wrongOwnerControlInPage: DETECTED_RESTORED -- patches getFragmentList().getDbIds (Task 14 fix wave, H1), observeF1 (via scratch session) reports ownerMismatchCount > 0, restores, releases lease, disposes scratch session', async () => {
  const { realm, fragmentList } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const originalGetDbIds = fragmentList.getDbIds;

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(fragmentList.getDbIds, originalGetDbIds, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('wrongOwnerControlInPage: NOT_DETECTED -- observeF1 reports zero ownerMismatchCount, patch still restored', async () => {
  const { realm, fragmentList } = buildWrongOwnerRealm({ ownerMismatchCount: 0 });
  const originalGetDbIds = fragmentList.getDbIds;
  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });
  assert.equal(result.detected, false);
  assert.equal(fragmentList.getDbIds, originalGetDbIds);
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.NOT_DETECTED);
});

test('wrongOwnerControlInPage: RESTORE_FAILED -- getDbIds patches/restores cleanly, but the post-restoration liveness check fails (world.isModelLive -> false); lease left held for Phase 11', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
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
  const fragmentList = { getDbIds: (id) => 42, getCount: () => 0 };
  const model = { getFragmentList: () => fragmentList };
  const enumerator = { resolveRoots: () => new Promise(() => {}) }; // never resolves
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': { extractFragments: async () => new Map(), extractAllFragments: async () => ({ records: new Map(), diagnostics: [] }) },
    '/clashtest/planning/scopeDigest.js': { digestSubtree: async () => ({ digest: 'x' }), digestPopulation: async () => ({ digest: 'd' }) },
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  // Task 17 (H3 fix) disposition: adapted -- f1PopulationRecords must be present so this test's
  // own OUTER precondition (a genuinely hanging resolveRoots) is what's actually exercised, not
  // the new eligibility check (which would otherwise short-circuit before the lease is ever taken).
  publishSession(g, { model, world, registry, artifacts: { f1PopulationRecords: new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]) }, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  const realm = createPageRealm(g);
  const originalGetDbIds = fragmentList.getDbIds;

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner', innerTimeoutMs: 15 });

  assert.equal(result.timedOut, true);
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.TIMED_OUT);
  assert.equal(fragmentList.getDbIds, originalGetDbIds, 'restored despite the timeout');
});

test('wrongOwnerControlInPage: scratch-session isolation -- the REAL session\'s own artifacts.f1FragmentMapsByRoot/f1PopulationClasses/f1RootsLength/f1PopulationRecords are byte-for-byte unchanged after the control runs (observeF1 wrote only into the scratch session)', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  const session = realm.window.__g1.sessions.s1;
  // Task 17 (H3 fix) disposition: adapted -- session.artifacts must retain f1PopulationRecords
  // (now a required precondition read BEFORE lease acquisition, see wrongOwnerControlInPage's own
  // doc comment) instead of being wholesale replaced with an artifacts object that omits it. The
  // ORIGINAL version of this test replaced session.artifacts entirely with `{preexisting: ...}`,
  // which under the fix would make the control return NOT_EXECUTABLE{reason:'no-eligible-fragment'}
  // before ever creating a scratch session -- silently turning this into a vacuous non-interference
  // proof (nothing runs, so trivially nothing is touched). Also strengthened with a reference-
  // identity check on the Map itself, since JSON.stringify(session.artifacts) alone cannot detect
  // a Map whose OWN entries were mutated in place (Map serializes to `{}`).
  const originalF1PopulationRecords = new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]);
  session.artifacts = { preexisting: 'untouched-marker', f1PopulationRecords: originalF1PopulationRecords };
  const before = JSON.stringify(session.artifacts);

  await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  const after = JSON.stringify(session.artifacts);
  assert.equal(after, before, 'the real session\'s own artifacts must never be touched by observeF1 re-running against the scratch session');
  assert.equal(session.artifacts.f1PopulationRecords, originalF1PopulationRecords, 'the REAL f1PopulationRecords Map must remain the SAME reference (never reassigned/mutated by the scratch-scoped observeF1 re-run)');
  assert.equal('f1FragmentMapsByRoot' in session.artifacts, false, 'observeF1 (scratch-scoped) must never write into the REAL session\'s artifacts');
});

test('wrongOwnerControlInPage: NOT_EXECUTABLE via acquireControlLease failure -- model-mismatch', async () => {
  const { realm } = buildWrongOwnerRealm();
  realm.window.__g1.models.tok = { id: 'DIFFERENT' };
  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'model-mismatch');
});

// codex-review (code, medium effort, this task's own pre-commit review pass) Medium finding,
// fixed: this function's new pre-lease eligibility read used to be `g.sessions[sessionId]`
// UNGUARDED (`g` itself could be `undefined` if `window.__g1` was never initialized) -- a thrown
// TypeError instead of the intended structured `no-session` result. Guarded identically to
// acquireControlLease's own established pattern.
test('wrongOwnerControlInPage: NOT_EXECUTABLE -- window.__g1 entirely absent, structured no-session result, never a thrown exception (codex-review finding, Medium)', async () => {
  const realm = createPageRealm({});
  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, sessionId: 's1', controlId: 'wrong-owner' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-session');
});

test('wrongOwnerControlInPage: NOT_EXECUTABLE -- unknown sessionId (window.__g1 present but no matching session), structured no-session result, never a thrown exception', async () => {
  const { realm } = buildWrongOwnerRealm();
  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, sessionId: 'does-not-exist', controlId: 'wrong-owner' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-session');
});

// Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: this
// control used to read `model.fragList[property]`/`Object.getOwnPropertyDescriptor(fragList,
// property)` UNGUARDED, before the try/finally that owns lease release and scratch-session
// disposal -- a model exposing only `getFragmentList()` threw a TypeError OUTSIDE any cleanup
// path, leaking the lease and scratch session.
//
// Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the final reviewer verified against
// the actual pinned Viewer 7.124.2 bundle that NO real Model class exposes a bare `.fragList`
// property at all -- only `getFragmentList()`. This test's own fixture was already
// (coincidentally) the genuinely-unavailable case even before Task 14 -- `getFragmentList()`
// returns an object with NO `getDbIds` at all, so it still correctly reaches `NOT_EXECUTABLE`
// with the SAME reason string post-fix, now exercising the NEW `model.getFragmentList()` code
// path's own guard rather than the old bare-property read. Retitled to remove the stale Task 13
// framing and "production-realistic model shape" claim (a real FragmentList always has
// `getDbIds` -- this fixture's absence of it is the genuinely-unavailable case, not the
// production-realistic one). The genuinely-accessor-only POSITIVE case (a working
// `getFragmentList().getDbIds`, what a REAL Viewer 7.124.2 Model actually looks like) is already
// covered by the `DETECTED_RESTORED` test above, via `buildWrongOwnerRealm`'s own now-
// accessor-only fixture -- no separate positive test needed here.
test('wrongOwnerControlInPage: NOT_EXECUTABLE -- model exposes getFragmentList() but the returned object has no getDbIds (fragment-owner accessor genuinely unavailable); lease released and scratch session disposed, no leak', async () => {
  const model = {
    // getFragmentList() present, but the object it returns has no getDbIds at all -- the
    // genuinely-unavailable case, distinct from H1's bare-`.fragList` bug (see doc comment above).
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
  // Task 17 (H3 fix) disposition: adapted -- f1PopulationRecords must be present so this test's
  // own intended precondition (a genuinely absent getDbIds accessor) is what's actually exercised,
  // not the new eligibility check (which would otherwise short-circuit first with a DIFFERENT
  // reason and mask the accessor-unavailable case this test targets).
  publishSession(g, { model, world, registry, artifacts: { f1PopulationRecords: new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]) }, mod });
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
  const fragmentList = { getDbIds: (id) => 42, getCount: () => 0 };
  const model = { getFragmentList: () => fragmentList };
  let resolveRoots;
  const enumerator = { resolveRoots: () => new Promise((resolve) => { resolveRoots = resolve; }) };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': { extractFragments: async () => new Map(), extractAllFragments: async () => ({ records: new Map(), diagnostics: [] }) },
    '/clashtest/planning/scopeDigest.js': { digestSubtree: async () => ({ digest: 'x' }), digestPopulation: async () => ({ digest: 'd' }) },
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  // Task 17 (H3 fix) disposition: adapted -- f1PopulationRecords must be present so this test's
  // own lease-lost-mid-flight race is what's actually exercised, not the new eligibility check.
  publishSession(g, { model, world, registry, artifacts: { f1PopulationRecords: new Map([[0, { fragmentId: 0, ownerDbId: 10 }]]) }, mod });
  g.__g1.sessions.s1.binding = { model };
  g.__g1.sessions.s1.enumerator = enumerator;
  const realm = createPageRealm(g);
  const originalGetDbIds = fragmentList.getDbIds;

  const resultPromise = realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner', innerTimeoutMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  vm.runInContext(`window.__g1.sessions.s1.activeControl = null;`, realm.context);
  resolveRoots({ roots: [], ownerMismatch: { count: 1 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } });

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'lease-lost-mid-flight');
  assert.notEqual(fragmentList.getDbIds, originalGetDbIds, 'the abandoned continuation must never restore the patch itself');
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
// Task 17 (bounded H1-H3 remediation pass, H3): wrong-owner target selection is genuinely
// population-driven, never a hard-coded fragId 0.
// ============================================================================================

test('wrongOwnerControlInPage: DETECTED_RESTORED with a population that does NOT include fragId 0 or 1 -- proves selection is genuinely population-driven, not still secretly assuming 0/1 exist', async () => {
  // Inserted OUT OF NUMERIC ORDER to also prove selection never trusts Map insertion order.
  const f1PopulationRecords = new Map([
    [55, { fragmentId: 55, ownerDbId: 900 }],
    [7, { fragmentId: 7, ownerDbId: 700 }],
    [12, { fragmentId: 12, ownerDbId: 1200 }],
  ]);
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1, f1PopulationRecords });

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(result.selectedFragId, 7, 'the numerically smallest fragId -- never 0, which is not even in this population');
  assert.equal(result.selectedOwnerDbId, 700, 'the real recorded owner for the selected fragId');
  const mapped = mapControlAttemptOutcome('wrong-owner', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('wrongOwnerControlInPage: DETECTED_RESTORED with a large/sparse population {3, 1000, 1000000} -- correctness is not coincidentally tied to small numbers', async () => {
  const f1PopulationRecords = new Map([
    [1000000, { fragmentId: 1000000, ownerDbId: 55 }],
    [3, { fragmentId: 3, ownerDbId: 33 }],
    [1000, { fragmentId: 1000, ownerDbId: 66 }],
  ]);
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1, f1PopulationRecords });

  const result = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(result.selectedFragId, 3);
  assert.equal(result.selectedOwnerDbId, 33);
});

test('wrongOwnerControlInPage: NOT_EXECUTABLE -- empty f1PopulationRecords, fail-closed with no-eligible-fragment, before ever acquiring a lease or creating a scratch session', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1, f1PopulationRecords: new Map() });

  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined, 'no scratch session was ever created');
});

test('wrongOwnerControlInPage: NOT_EXECUTABLE -- f1PopulationRecords entirely absent from artifacts (F1 never ran for this session), fail-closed with no-eligible-fragment', async () => {
  const { realm } = buildWrongOwnerRealm({ ownerMismatchCount: 1 });
  delete realm.window.__g1.sessions.s1.artifacts.f1PopulationRecords;

  const raw = await realm.call(wrongOwnerControlInPage, { ...BASE_ARG, controlId: 'wrong-owner' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::wrong-owner'], undefined, 'no scratch session was ever created');
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

// Task 17 (H3 fix) disposition note: `f2TreeOwnerByFragId` is now a REQUIRED precondition this
// control's own new eligibility check reads BEFORE ever acquiring the lease (see
// hiddenFragmentControlInPage's own doc comment, main file). Auto-derived from `fragmentsByNode`
// when not explicitly passed (first-node-wins, mirroring observeF2's own real construction) --
// every EXISTING test using this builder gets a plausible artifact for free, without its own
// per-test edit -- adapted, not replaced.
function deriveTreeOwnerByFragId(fragmentsByNode) {
  const map = new Map();
  for (const [node, frags] of fragmentsByNode.entries()) {
    for (const fragId of frags) {
      if (!map.has(fragId)) map.set(fragId, { ownerDbId: node, conflictingOwnerDbId: null });
    }
  }
  return map;
}

function buildHiddenFragmentRealm({ fragmentsByNode, populationClasses, fragListCount, f2TreeOwnerByFragId }) {
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
    artifacts: {
      f1PopulationClasses: populationClasses,
      f1RootsLength: 1,
      f2TreeOwnerByFragId: f2TreeOwnerByFragId || deriveTreeOwnerByFragId(fragmentsByNode),
    },
  });
  const realm = createPageRealm(g);
  return { realm, model, tree, world, registry };
}

test('hiddenFragmentControlInPage: DETECTED_RESTORED -- patches tree.enumNodeFragments to drop the SELECTED fragId (Task 17 H3 fix: the numerically smallest fragId in f2TreeOwnerByFragId, fragId 0 for this fixture -- no longer a hard-coded 1), observeF2 (via scratch session) reports loadedButUnreachableCount > 0, restores, releases lease, disposes scratch session', async () => {
  // fragIds 0,1 are both class L and both tree-reachable BEFORE the patch; the patch drops
  // whichever fragId selectAuthoritativeFragmentTarget selects (fragId 0, the smallest of {0,1}
  // in this fixture's own auto-derived f2TreeOwnerByFragId), moving it to loaded-but-unreachable.
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

// Task 17 (H3 fix) disposition: REPLACED twice over -- first adapted from the original hard-coded-
// fragId-1 "was never reachable" premise (structurally impossible once selection is drawn from the
// tree-reachable set), then REPLACED AGAIN after a codex-review pre-commit pass (High finding,
// this task's own diff) found the first replacement's own fixture (a tree-reachable-but-non-L
// fragId) is now itself NOT a legitimate NOT_DETECTED case: `selectHiddenFragmentTarget` (above)
// was fixed to intersect tree-reachability WITH class 'L', so a population with only a non-L
// tree-reachable fragId now correctly yields NOT_EXECUTABLE (no eligible fragment at all), never a
// wasted DETECTED-oracle attempt. Genuine NOT_DETECTED is now essentially unreachable through
// target-eligibility alone (a successfully SELECTED target is, by construction, both tree-reachable
// and class 'L', which is exactly what `loadedButUnreachableCount` counts) -- NOT_DETECTED for this
// control is retained only via the RESTORE_FAILED/precondition-style paths below, which do not
// depend on target eligibility.
test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- the ONLY tree-reachable fragId is not class L in F1\'s own population (no eligible intersection of tree-reachable AND class-L), fail-closed with no-eligible-fragment (codex-review finding, High)', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [5]]]), // fragId 5 is tree-reachable, but NOT class L below
    populationClasses: [{ fragId: 5, cls: 'N' }],
    fragListCount: 1,
  });
  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'no scratch session was ever created');
});

// codex-review (code, medium effort, this task's own pre-commit review pass) Testing Gaps,
// addressed: the exact mixed-population scenario the review itself proposed as a regression proof
// for the High finding above -- a SMALLER tree-reachable fragId that is NOT eligible (class N) must
// never be selected merely because it is numerically smaller; a LARGER, genuinely eligible (class L)
// fragId must be selected and correctly detected instead.
test('hiddenFragmentControlInPage: DETECTED_RESTORED -- the numerically smallest tree-reachable fragId is class N (ineligible), a LARGER fragId is class L (eligible) -- selection correctly skips the ineligible one (codex-review finding, High)', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [5, 7]]]), // 5 (smaller, class N) and 7 (larger, class L)
    populationClasses: [{ fragId: 5, cls: 'N' }, { fragId: 7, cls: 'L' }],
    fragListCount: 2,
  });
  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  assert.equal(result.ok, true);
  assert.equal(result.selectedFragId, 7, 'must skip fragId 5 (class N, ineligible) and select 7 (class L, eligible)');
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

// codex-review (code, medium effort, this task's own pre-commit review pass) Medium finding,
// fixed: same class of bug as wrongOwnerControlInPage's own fix -- see that test's own comment.
test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- window.__g1 entirely absent, structured no-session result, never a thrown exception (codex-review finding, Medium)', async () => {
  const realm = createPageRealm({});
  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, sessionId: 's1', controlId: 'hidden-fragment' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-session');
});

test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- unknown sessionId (window.__g1 present but no matching session), structured no-session result, never a thrown exception', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, sessionId: 'does-not-exist', controlId: 'hidden-fragment' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-session');
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

// Task 17 (H3 fix) disposition: REPLACED. `observeF2`'s own hard precondition on
// `session.artifacts.f1PopulationClasses` being an array is unchanged, real, still-load-bearing
// production-analog machinery (this control's own detection re-run depends on it). But this test's
// ORIGINAL scenario -- the REAL session's own `f1PopulationClasses` genuinely `undefined`, so
// `copyArtifactKeys` never copies it into the scratch session, so observeF2's OWN internal guard
// trips for the SCRATCH session -- is now structurally unreachable THROUGH this control: the new
// pre-lease eligibility check (`selectHiddenFragmentTarget`, above) ALSO requires the REAL
// session's own `f1PopulationClasses` to be a valid array with at least one class-'L' entry
// intersecting a tree-reachable fragId, and `createControlScratchSession`'s own copy semantics
// (confirmed by direct read: `structuredClone(value)` for a defined value, skipped entirely when
// `undefined`) mean the scratch session's own copy is ALWAYS exactly as valid as the real session's
// own value whenever eligibility succeeds -- so observeF2's own precondition-failure branch can no
// longer be reached with a genuinely-eligible population. Replaced with a test proving the NEW,
// EARLIER, cheaper check now strictly subsumes the old exercised path (a missing/invalid REAL
// `f1PopulationClasses` is caught before ever creating a scratch session at all, rather than being
// caught one layer deeper by observeF2 itself).
test('hiddenFragmentControlInPage: precondition -- a REAL session with missing/invalid f1PopulationClasses is now caught by the earlier pre-lease eligibility check (no-eligible-fragment), never reaching observeF2\'s own scratch-session precondition failure', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: undefined, // deliberately NOT an array
    fragListCount: 2,
  });
  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });
  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'no scratch session was ever created -- observeF2 never even runs');
});

// Task 13 (bounded completion pass, area 3 final integration) codex-review fix, High: this
// control used to read `model.tree[property]`/`Object.getOwnPropertyDescriptor(tree, property)`
// UNGUARDED, before the try/finally that owns lease release and scratch-session disposal, so a
// model exposing only `getObjectTree()` (no bare `.tree` own property) threw a TypeError outside
// any cleanup path and leaked both.
//
// Task 14 fix wave (H1, REQUIRED, final bounded-pass review): the final reviewer verified against
// the actual pinned Viewer 7.124.2 bundle that NO real Model class defines a bare `.tree`
// property at all -- only `getObjectTree()`/`getInstanceTree()`. The test below used to assert
// `NOT_EXECUTABLE` for exactly this accessor-only shape, encoding the H1 bug (bare `model.tree`
// read, always `undefined` against a real model) as CORRECT behavior. Flipped: an accessor-only
// model is what a REAL Viewer 7.124.2 Model actually looks like, so it must now reach
// `DETECTED_RESTORED` (proving `hiddenFragmentControlInPage`'s Task 14 fix -- resolving `tree` via
// `getObjectTree()`/`getInstanceTree()`, mirroring `invalidBoundsControlInPage` -- genuinely
// works end to end against this shape). The genuinely-tree-unavailable case (neither accessor
// present) is kept as its own separate test immediately below, still correctly reaching
// `NOT_EXECUTABLE` -- proving the guard still fails closed when the tree is truly absent.
test('hiddenFragmentControlInPage: DETECTED_RESTORED -- model exposes ONLY getObjectTree() (no bare .tree own property, the REAL Viewer 7.124.2 Model shape); patches the resolved tree\'s enumNodeFragments, detects, restores, releases lease, disposes scratch session (Task 14 fix wave, H1)', async () => {
  const tree = fakeTree({ children: new Map([[0, []]]), fragmentsByNode: new Map([[0, [0, 1]]]) });
  const model = {
    // deliberately NO bare .tree own property -- getObjectTree() only, the REAL Viewer 7.124.2
    // Model shape (verified against the pinned bundle by the final bounded-pass review).
    getObjectTree: () => tree,
    isObjectTreeCreated: () => true,
    getFragmentList: () => ({ getCount: () => 2 }),
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  // Task 17 (H3 fix) disposition: adapted -- f2TreeOwnerByFragId must be present (fragIds 0 and 1,
  // both under node 0, matching this fixture's own tree shape) so the new eligibility check has a
  // real population to select from; the SELECTED target is now the numerically smallest (0), not
  // the old hard-coded 1, but detection is symmetric (dropping either 0 or 1 from this fixture's
  // own two-fragment, single-node tree still makes it loaded-but-unreachable).
  publishSession(g, {
    model, world, registry,
    artifacts: {
      f1PopulationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
      f1RootsLength: 1,
      f2TreeOwnerByFragId: new Map([[0, { ownerDbId: 0, conflictingOwnerDbId: null }], [1, { ownerDbId: 0, conflictingOwnerDbId: null }]]),
    },
  });
  const realm = createPageRealm(g);
  const originalEnumNodeFragments = tree.enumNodeFragments;

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(tree.enumNodeFragments, originalEnumNodeFragments, 'restored to the original reference');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null);
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'scratch session disposed');
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- model exposes NEITHER getObjectTree() nor getInstanceTree() (tree genuinely unavailable); lease released and scratch session disposed, no leak', async () => {
  const model = {
    isObjectTreeCreated: () => true,
    getFragmentList: () => ({ getCount: () => 0 }),
  };
  const world = fakeWorld();
  const registry = fakeRegistry(model);
  const g = { __viewer: {} };
  // Task 17 (H3 fix) disposition: adapted -- f2TreeOwnerByFragId must be present, AND
  // f1PopulationClasses must classify that same fragId 'L' (codex-review finding, High:
  // selectHiddenFragmentTarget now intersects both -- see hiddenFragmentControlInPage's own doc
  // comment), so this test's own intended precondition (a genuinely absent tree accessor) is what
  // is actually exercised, not the new eligibility check (which would otherwise short-circuit
  // first with a DIFFERENT reason).
  publishSession(g, {
    model, world, registry,
    artifacts: {
      f1PopulationClasses: [{ fragId: 0, cls: 'L' }],
      f1RootsLength: 0,
      f2TreeOwnerByFragId: new Map([[0, { ownerDbId: 0, conflictingOwnerDbId: null }]]),
    },
  });
  const realm = createPageRealm(g);

  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-tree-enumNodeFragments');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'the lease must be released, never left leaked');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'the scratch session must be disposed, never left leaked');
});

// Task 17 (H3 fix) disposition: adapted -- `f2TreeOwnerByFragId` is now a REQUIRED precondition
// this control's own new eligibility check reads from the REAL session BEFORE lease acquisition
// (see hiddenFragmentControlInPage's own doc comment), so it is no longer true that the REAL
// session must never carry this key at all; instead, this test now proves the REAL
// `f2TreeOwnerByFragId` Map ITSELF (reference and contents) is never mutated/reassigned by the
// scratch-scoped `observeF2` re-run -- the same non-interference property, reconstructed for a
// world where this artifact now legitimately pre-exists on the real session (representing the
// genuinely-already-run real Phase 5 F2).
test('hiddenFragmentControlInPage: scratch-session isolation -- the REAL session\'s own artifacts.f2TreeOwnerByFragId Map is the SAME reference, byte-for-byte unchanged; only f1PopulationClasses/f1RootsLength were ever copied (read-only) into the scratch session', async () => {
  const originalF2TreeOwnerByFragId = new Map([[0, { ownerDbId: 0, conflictingOwnerDbId: null }], [1, { ownerDbId: 0, conflictingOwnerDbId: null }]]);
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
    f2TreeOwnerByFragId: originalF2TreeOwnerByFragId,
  });
  const session = realm.window.__g1.sessions.s1;
  const before = JSON.stringify({ f1PopulationClasses: session.artifacts.f1PopulationClasses, f1RootsLength: session.artifacts.f1RootsLength });

  await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  const after = JSON.stringify({ f1PopulationClasses: session.artifacts.f1PopulationClasses, f1RootsLength: session.artifacts.f1RootsLength });
  assert.equal(after, before, 'the copied baseline fields must remain untouched (read-only copy into the scratch session)');
  assert.equal(session.artifacts.f2TreeOwnerByFragId, originalF2TreeOwnerByFragId, 'the REAL f2TreeOwnerByFragId Map must remain the SAME reference (never reassigned/mutated by the scratch-scoped observeF2 re-run)');
  assert.equal(originalF2TreeOwnerByFragId.size, 2, 'and its own contents must be untouched');
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
  // Task 17 (H3 fix) disposition: adapted -- f2TreeOwnerByFragId must be present so the new
  // eligibility check does not short-circuit before this test's own lease-lost race ever begins.
  publishSession(g, {
    model, world, registry,
    artifacts: {
      f1PopulationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
      f1RootsLength: 1,
      f2TreeOwnerByFragId: new Map([[0, { ownerDbId: 0, conflictingOwnerDbId: null }], [1, { ownerDbId: 0, conflictingOwnerDbId: null }]]),
    },
  });
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
// Task 17 (bounded H1-H3 remediation pass, H3): hidden-fragment target selection is genuinely
// population-driven, never a hard-coded fragId 1.
// ============================================================================================

test('hiddenFragmentControlInPage: DETECTED_RESTORED with a population that does NOT include fragId 0 or 1 -- proves selection is genuinely population-driven, not still secretly assuming 0/1 exist', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [7, 12, 55]]]),
    populationClasses: [{ fragId: 7, cls: 'L' }, { fragId: 12, cls: 'L' }, { fragId: 55, cls: 'L' }],
    fragListCount: 3,
  });

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(result.ok, true);
  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(result.selectedFragId, 7, 'the numerically smallest fragId -- never 1, which is not even in this population');
  const mapped = mapControlAttemptOutcome('hidden-fragment', result);
  assert.equal(mapped.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('hiddenFragmentControlInPage: DETECTED_RESTORED with a large/sparse tree-reachable population {3, 1000, 1000000} -- correctness is not coincidentally tied to small numbers', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [1000000, 3, 1000]]]),
    populationClasses: [{ fragId: 1000000, cls: 'L' }, { fragId: 3, cls: 'L' }, { fragId: 1000, cls: 'L' }],
    fragListCount: 3,
  });

  const result = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(result.detected, true);
  assert.equal(result.restored, true);
  assert.equal(result.selectedFragId, 3);
});

test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- empty f2TreeOwnerByFragId, fail-closed with no-eligible-fragment, before ever acquiring a lease or creating a scratch session', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, []]]),
    populationClasses: [],
    fragListCount: 0,
    f2TreeOwnerByFragId: new Map(),
  });

  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'no scratch session was ever created');
});

test('hiddenFragmentControlInPage: NOT_EXECUTABLE -- f2TreeOwnerByFragId entirely absent from artifacts (F2 never ran for this session), fail-closed with no-eligible-fragment', async () => {
  const { realm } = buildHiddenFragmentRealm({
    fragmentsByNode: new Map([[0, [0, 1]]]),
    populationClasses: [{ fragId: 0, cls: 'L' }, { fragId: 1, cls: 'L' }],
    fragListCount: 2,
  });
  delete realm.window.__g1.sessions.s1.artifacts.f2TreeOwnerByFragId;

  const raw = await realm.call(hiddenFragmentControlInPage, { ...BASE_ARG, controlId: 'hidden-fragment' });

  assert.equal(raw.ok, false);
  assert.equal(raw.reason, 'no-eligible-fragment');
  assert.equal(realm.window.__g1.sessions.s1.activeControl, null, 'no lease was ever acquired');
  assert.equal(realm.window.__g1.sessions['s1::control-scratch::hidden-fragment'], undefined, 'no scratch session was ever created');
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
