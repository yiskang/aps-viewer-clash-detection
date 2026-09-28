// test/acceptance/g1-svf2-f1-f8-verification.controlbridge.test.mjs
//
// Offline, browser-free unit tests for the bounded completion pass, area 3 shared foundation
// (Task 10) of test/acceptance/g1-svf2-f1-f8-verification.mjs: the exclusive page-owned control
// lease (`acquireControlLease`/`releaseControlLease`/`recordControlPatch`), the isolated scratch-
// artifact namespace (`createControlScratchSession`/`disposeControlScratchSession`), the generic
// Node-side two-tier-timeout wrapper (`runBridgedControl`/`mapControlAttemptOutcome`), the
// `sessionTainted` short-circuit wired into `runControlSafely`/`runHarness`'s own Phase 3c-10
// sequence, and the new real `restoreAllControlPatches` fallback step in
// `runInPageResourceCleanup`. New sibling file (mirrors this repo's own established one-file-
// per-stage/task-concern convention, e.g. `.importmap.test.mjs`/`.phase0evidence.test.mjs`).
//
// This task builds ONLY the shared foundation every one of the six mandatory controls will use
// -- it does NOT implement any control's own mutation/detection logic (Tasks 11/12), so every
// test here exercises a SYNTHETIC/fake control, never a real one.
//
// AUTHORIZATION BOUNDARY (same as every prior stage/task): this file NEVER launches a real
// Chromium browser, NEVER imports playwright, and NEVER calls `main()` or `runHarness` with real
// dependencies -- every test uses fakes. Every in-page function under test is reconstructed from
// its own source text inside an isolated `node:vm` context (this file's own `createPageRealm`,
// mirroring `session.test.mjs`'s own established pattern) -- never a plain `globalThis.window`
// fake -- so an accidental Node-module closure reference surfaces as a ReferenceError here
// exactly as it would against a real page.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  CHECK_VERDICT, OVERALL_VERDICT, CONTROL_STATE, CONTROL_NAMES, CONTROL_RESTORATION_REQUIRED,
  INTEGRITY_RESULT,
  createControlResult,
  IN_PAGE_FUNCTION_REGISTRY,
  setupSharedSessionResources,
  recordControlPatch, acquireControlLease, releaseControlLease,
  createControlScratchSession, disposeControlScratchSession,
  mapControlAttemptOutcome, runBridgedControl,
  runInPageResourceCleanup,
  runHarness, validateResultSchema,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- derived directly from IN_PAGE_FUNCTION_REGISTRY
// (the production file's own single source of truth for "every function a real page bootstrap
// installs"), exactly like session.test.mjs's own `createPageRealm` -- never a hand-picked
// subset, so a missing/renamed production registry entry surfaces here automatically.
// ============================================================================================

function createPageRealm(initialWindow = {}) {
  // `structuredClone` is a standard global in both a real browser page and modern Node.js, but
  // `node:vm`'s own context does not inherit it automatically -- inject it explicitly, exactly
  // like `performance`/`setTimeout`/`clearTimeout`/`console` already are, for
  // `createControlScratchSession`'s own use (this file's first in-page function needing it).
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console, structuredClone });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    // Exposed (unlike session.test.mjs's own createPageRealm) because several tests below need
    // to exercise `recordControlPatch`/`acquireControlLease` inline against a LIVE `session`/
    // `target` object -- those cannot cross `call`'s own plain-argument convention (a `target`
    // being patched, e.g. `{getDbIds: fn}`, must stay the SAME live object reference across the
    // acquire/patch/record/cleanup sequence, never re-serialized).
    context,
    call(fn, ...args) {
      return vm.runInContext(fn.name, context)(...args);
    },
  };
}

// Genuinely STATEFUL fakes (unlike a shape-only stub) -- `register`/`unregister`/`evictModel`
// actually mutate tracked state, so `runInPageResourceCleanup`'s own postcondition-based
// `checkOwnership` checks (unregisterModelBefore/evictModelBefore/verifyViewerModelSetEmpty)
// correctly see a CLEAN teardown after a normal unregister/evict, rather than spuriously
// reporting `cleanupUnresolvedOwnership` for concerns entirely outside this file's own tests
// (Task 10 tests `restoreAllControlPatches` specifically, never these other steps' own
// correctness -- already covered by stage8.test.mjs's own dedicated cleanup tests).
function fakeWorld(overrides = {}) {
  let live = true;
  return {
    isModelLive: () => live,
    evictModel: () => { live = false; },
    dispose: () => {},
    ...overrides,
  };
}

function fakeRegistry(world, overrides = {}) {
  let boundModel = null;
  return {
    world,
    registrySessionId: overrides.sessionId || 'regsess-cb1',
    register: overrides.register || ((K, model) => { boundModel = model; }),
    bindingFor: overrides.bindingFor || (() => (boundModel ? { model: boundModel } : null)),
    unregister: overrides.unregister || (() => { boundModel = null; }),
  };
}

function buildFakeModules({ world, registry, enumerator } = {}) {
  return {
    '/collision/index.js': { CollisionWorld: { fromViewer: world || (async () => fakeWorld()) } },
    '/clashtest/index.js': { createModelRegistry: registry || (({ world: w }) => fakeRegistry(w)) },
    '/clashtest/viewer/index.js': { createViewerElementEnumerator: enumerator || (() => ({ resolveRoots: async () => ({}) })) },
  };
}

// Publishes a real, node:vm-constructed session via the real setupSharedSessionResources (never
// a hand-built session object) -- so `tokenGen`/`activeControl` are genuinely whatever that
// function actually produces, not what this file's own tests assume it produces.
async function realmWithPublishedSession({ model = { id: 'M' }, tokenId = 'tok', gen = 7 } = {}) {
  const mod = buildFakeModules();
  const window_ = {
    __g1: { loads: { [tokenId]: { gen, status: 'completed', api: 'loadDocumentNode' } }, models: { [tokenId]: model }, mod },
    // `runInPageResourceCleanup`'s later steps (verifyViewerModelSetEmpty etc.) call
    // `viewer.getAllModels()`/`removeEventListener` even when there's nothing to unload -- a
    // minimal-but-complete fake, matching this repo's own `fakeCleanupWorld`/
    // `fakeCleanupRegistry` convention (stage8.test.mjs).
    __viewer: { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} },
  };
  const realm = createPageRealm(window_);
  const receipt = await realm.call(setupSharedSessionResources, tokenId);
  assert.equal(receipt.ok, true, 'fixture setup must itself succeed');
  return { realm, sessionId: receipt.sessionId, tokenId, gen, model };
}

// ============================================================================================
// 1. Lease acquire/release (deliverable 1)
// ============================================================================================

test('acquireControlLease: happy path -- sets session.activeControl with an empty patches array', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  const result = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(result.ok, true);
  const session = realm.window.__g1.sessions[sessionId];
  assert.equal(session.activeControl.controlId, 'wrong-owner');
  assert.equal(session.activeControl.tokenId, tokenId);
  assert.equal(session.activeControl.gen, gen);
  // Cross-realm array -- length check, not deepEqual (this file's own documented gotcha,
  // session.test.mjs's own `cleanupFailures.length` precedent: an array built INSIDE the vm
  // realm has a DIFFERENT realm's own Array.prototype, so assert.deepEqual's reference-equality
  // check on the prototype chain spuriously fails despite matching shape/values).
  assert.equal(session.activeControl.patches.length, 0);
  assert.equal(typeof session.activeControl.acquiredAt, 'number');
});

test('acquireControlLease: no-session -- unknown sessionId', async () => {
  const { realm, tokenId, gen } = await realmWithPublishedSession();
  const result = realm.call(acquireControlLease, { sessionId: 'nope', tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-session');
});

test('acquireControlLease: load-record-mismatch -- stale gen on the command', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  const result = realm.call(acquireControlLease, { sessionId, tokenId, gen: gen + 1, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'load-record-mismatch');
});

test('acquireControlLease: load-record-mismatch -- the underlying loads[tokenId] record itself no longer matches (e.g. status changed)', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.window.__g1.loads[tokenId].status = 'timed-out';
  const result = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'load-record-mismatch');
});

test('acquireControlLease: load-record-mismatch -- wrong tokenId (session was constructed from a different token)', async () => {
  const { realm, sessionId, gen } = await realmWithPublishedSession({ tokenId: 'tok' });
  realm.window.__g1.loads['other'] = { gen, status: 'completed', api: 'loadDocumentNode' };
  realm.window.__g1.models['other'] = { id: 'M2' };
  const result = realm.call(acquireControlLease, { sessionId, tokenId: 'other', gen, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'load-record-mismatch');
});

test('acquireControlLease: model-mismatch -- window.__g1.models[tokenId] no longer === session.model', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.window.__g1.models[tokenId] = { id: 'DIFFERENT-MODEL' };
  const result = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'model-mismatch');
});

test('acquireControlLease: lease-already-held -- a second acquire while one is already held is rejected', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  const first = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(first.ok, true);
  const second = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'hidden-fragment' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'lease-already-held');
  // The FIRST control's own lease must be untouched by the rejected second attempt.
  assert.equal(realm.window.__g1.sessions[sessionId].activeControl.controlId, 'wrong-owner');
});

test('acquireControlLease: precondition order -- no-session is checked before every other precondition', async () => {
  // A command that would ALSO fail load-record-mismatch/model-mismatch, against a session that
  // does not exist at all, must still report 'no-session' -- the FIRST failure's own reason.
  const { realm } = await realmWithPublishedSession();
  const result = realm.call(acquireControlLease, { sessionId: 'missing', tokenId: 'wrong-tok', gen: 999, controlId: 'x' });
  assert.equal(result.reason, 'no-session');
});

test('releaseControlLease: happy path -- clears session.activeControl', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  const result = realm.call(releaseControlLease, { sessionId, controlId: 'wrong-owner' });
  assert.equal(result.ok, true);
  assert.equal(realm.window.__g1.sessions[sessionId].activeControl, null);
});

test('releaseControlLease: no-active-lease -- nothing held (no session at all)', async () => {
  const { realm } = await realmWithPublishedSession();
  const result = realm.call(releaseControlLease, { sessionId: 'missing', controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-active-lease');
});

test('releaseControlLease: no-active-lease -- session exists but no lease is held', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const result = realm.call(releaseControlLease, { sessionId, controlId: 'wrong-owner' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-active-lease');
});

test('releaseControlLease: controlId-mismatch -- a DIFFERENT control cannot release this lease', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  const result = realm.call(releaseControlLease, { sessionId, controlId: 'hidden-fragment' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'controlId-mismatch');
  // The lease must remain held by its ACTUAL owner, untouched by the rejected release.
  assert.equal(realm.window.__g1.sessions[sessionId].activeControl.controlId, 'wrong-owner');
});

// ============================================================================================
// 2. recordControlPatch (deliverable 1)
// ============================================================================================

test('recordControlPatch: throws if no active lease exists on the session', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  assert.throws(
    () => vm.runInContext(
      `recordControlPatch(window.__g1.sessions[${JSON.stringify(sessionId)}], { target: {}, property: 'x' })`,
      realm.context,
    ),
    /no active control lease/,
  );
});

test('recordControlPatch: throws if target/property are missing', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.throws(
    () => vm.runInContext(
      `recordControlPatch(window.__g1.sessions[${JSON.stringify(sessionId)}], { target: null, property: 'x' })`,
      realm.context,
    ),
    /target\/property required/,
  );
});

test('recordControlPatch: full lifecycle -- installedDescriptor captured (post-patch), originalDescriptor preserved (pre-patch), patches array grows', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });

  const report = vm.runInContext(
    `(() => {
      const session = window.__g1.sessions[${JSON.stringify(sessionId)}];
      const target = { getDbIds: () => 1 };
      const originalDescriptor = Object.getOwnPropertyDescriptor(target, 'getDbIds');
      const original = target.getDbIds;
      target.getDbIds = () => -1;
      const record = recordControlPatch(session, { target, property: 'getDbIds', originalDescriptor });
      return {
        patchesLength: session.activeControl.patches.length,
        installedIsPatched: record.installedDescriptor.value === target.getDbIds,
        originalIsRecorded: record.originalDescriptor.value === original,
      };
    })();`,
    realm.context,
  );

  assert.equal(report.patchesLength, 1);
  assert.equal(report.installedIsPatched, true);
  assert.equal(report.originalIsRecorded, true);
});

// ============================================================================================
// 3. Scratch artifact namespace (deliverable 2)
// ============================================================================================

test('createControlScratchSession: copies only the named artifact keys, each independently', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const session = realm.window.__g1.sessions[sessionId];
  session.artifacts = {
    plainObj: { a: 1, nested: { b: 2 } },
    arr: [1, 2, 3],
    aMap: new Map([['k1', 'v1'], ['k2', 'v2']]),
    untouchedKey: { shouldNeverBeCopied: true },
  };

  const result = realm.call(createControlScratchSession, sessionId, {
    controlId: 'wrong-owner', copyArtifactKeys: ['plainObj', 'arr', 'aMap'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.scratchSessionId, `${sessionId}::control-scratch::wrong-owner`);

  const scratch = realm.window.__g1.sessions[result.scratchSessionId];
  assert.ok(scratch, 'scratch session must be published under the returned key');
  assert.equal(Object.keys(scratch.artifacts).sort().join(','), 'aMap,arr,plainObj');
  assert.equal('untouchedKey' in scratch.artifacts, false, 'a key NOT named in copyArtifactKeys must never be copied');

  // Live references preserved (same model/world/registry/binding), never copied.
  assert.equal(scratch.model, session.model);
  assert.equal(scratch.world, session.world);
  assert.equal(scratch.registry, session.registry);
  assert.equal(scratch.tokenId, session.tokenId);
  assert.equal(scratch.tokenGen, session.tokenGen);
});

test('createControlScratchSession: a Map artifact is copied as an INDEPENDENT Map -- mutating the copy never touches the original', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const session = realm.window.__g1.sessions[sessionId];
  session.artifacts = { aMap: new Map([['k1', 'v1']]) };

  const result = realm.call(createControlScratchSession, sessionId, { controlId: 'wrong-owner', copyArtifactKeys: ['aMap'] });
  const scratch = realm.window.__g1.sessions[result.scratchSessionId];

  assert.notEqual(scratch.artifacts.aMap, session.artifacts.aMap, 'must be a genuinely different Map object');
  scratch.artifacts.aMap.set('k2', 'v2');
  scratch.artifacts.aMap.delete('k1');
  assert.equal(session.artifacts.aMap.has('k1'), true, 'original Map must be untouched by the copy\'s own add/delete');
  assert.equal(session.artifacts.aMap.has('k2'), false, 'original Map must be untouched by the copy\'s own add/delete');
  assert.equal(session.artifacts.aMap.size, 1);
});

test('createControlScratchSession: a plain object/array artifact is deep-copied via structuredClone -- mutating a nested value never touches the original', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const session = realm.window.__g1.sessions[sessionId];
  session.artifacts = { plainObj: { nested: { count: 1 } }, arr: [{ x: 1 }] };

  const result = realm.call(createControlScratchSession, sessionId, { controlId: 'wrong-owner', copyArtifactKeys: ['plainObj', 'arr'] });
  const scratch = realm.window.__g1.sessions[result.scratchSessionId];

  scratch.artifacts.plainObj.nested.count = 999;
  scratch.artifacts.arr[0].x = 999;
  assert.equal(session.artifacts.plainObj.nested.count, 1, 'original nested object must be untouched');
  assert.equal(session.artifacts.arr[0].x, 1, 'original array element must be untouched');
});

test('createControlScratchSession: no-session', async () => {
  const { realm } = await realmWithPublishedSession();
  const result = realm.call(createControlScratchSession, 'missing', { controlId: 'x', copyArtifactKeys: [] });
  assert.equal(result.ok, false);
  assert.equal(result.scratchSessionId, null);
  assert.equal(result.reason, 'no-session');
});

test('disposeControlScratchSession: removes the scratch session cleanly and is a no-op if called twice', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  realm.window.__g1.sessions[sessionId].artifacts = { k: {} };
  const created = realm.call(createControlScratchSession, sessionId, { controlId: 'wrong-owner', copyArtifactKeys: ['k'] });
  assert.ok(realm.window.__g1.sessions[created.scratchSessionId]);

  const disposedOnce = realm.call(disposeControlScratchSession, created.scratchSessionId);
  assert.equal(disposedOnce.ok, true);
  assert.equal(realm.window.__g1.sessions[created.scratchSessionId], undefined);

  const disposedTwice = realm.call(disposeControlScratchSession, created.scratchSessionId);
  assert.equal(disposedTwice.ok, true, 'a second dispose of an already-gone key must never throw');
});

// ============================================================================================
// 4. setupSharedSessionResources: deliverable 6 (tokenGen threading), strictly additive
// ============================================================================================

test('setupSharedSessionResources: the published session now carries tokenGen matching the load record\'s own gen (deliverable 6)', async () => {
  const { realm, sessionId, gen } = await realmWithPublishedSession({ gen: 42 });
  const session = realm.window.__g1.sessions[sessionId];
  assert.equal(session.tokenGen, 42);
  assert.equal(gen, 42);
  assert.equal(session.activeControl, null, 'no control has ever acquired this fresh session\'s lease yet');
});

// ============================================================================================
// 5. runBridgedControl / mapControlAttemptOutcome (deliverable 3)
// ============================================================================================

test('mapControlAttemptOutcome: all 4 meaningful {detected,restored,timedOut} combinations map to the correct CONTROL_STATE', () => {
  const r1 = mapControlAttemptOutcome('wrong-owner', { detected: true, restored: true, timedOut: false });
  assert.equal(r1.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(r1.detected, true);
  assert.equal(r1.restored, true);

  const r2 = mapControlAttemptOutcome('wrong-owner', { detected: false, restored: true, timedOut: false });
  assert.equal(r2.state, CONTROL_STATE.NOT_DETECTED);

  const r3 = mapControlAttemptOutcome('wrong-owner', { detected: true, restored: false, timedOut: false });
  assert.equal(r3.state, CONTROL_STATE.RESTORE_FAILED);

  const r4 = mapControlAttemptOutcome('wrong-owner', { detected: true, restored: true, timedOut: true });
  assert.equal(r4.state, CONTROL_STATE.TIMED_OUT);
  assert.equal(r4.detected, null, 'a TIMED_OUT result never carries a real detected value');
  assert.equal(r4.restored, null, 'a TIMED_OUT result never carries a real restored value');
});

test('mapControlAttemptOutcome: restorationRequired always matches Stage 1\'s own fixed classification, per control', () => {
  for (const name of CONTROL_NAMES) {
    const r = mapControlAttemptOutcome(name, { detected: true, restored: true, timedOut: false });
    assert.equal(r.restorationRequired, CONTROL_RESTORATION_REQUIRED[name]);
  }
});

test('runBridgedControl: normal resolution (ok:true) -- 5th meaningful case, ok:false precondition failure maps to NOT_EXECUTABLE', async () => {
  const pageEvaluate = async () => ({ ok: false, reason: 'no-model-before' });
  const result = await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50,
  });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.executed, false);
  assert.equal(result.reason, 'no-model-before');
});

test('runBridgedControl: normal resolution (ok:true) -- attempted outcome mapped through mapControlAttemptOutcome, never producing NOT_EXECUTABLE', async () => {
  const pageEvaluate = async () => ({ ok: true, detected: true, restored: true, timedOut: false, reason: null });
  const result = await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50,
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
});

test('runBridgedControl: malformed in-page result (no ok field at all) is treated as NOT_EXECUTABLE, never assumed successful', async () => {
  const pageEvaluate = async () => ({ detected: true, restored: true }); // missing `ok` entirely
  const result = await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50,
  });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'malformed-in-page-result');
});

// codex-review (code, high effort, Task 10's own pre-commit review pass) Critical #1: string
// booleans (or any non-boolean value in detected/restored/timedOut) must NEVER be coerced by
// truthiness into a false DETECTED_RESTORED -- reproduced directly by the review with
// `{detected: "false", restored: "false", timedOut: false}` (a plausible serialization mistake:
// a control's own in-page code stringifying values before returning them).
test('runBridgedControl: a STRING "false" for detected/restored must never be coerced truthy -- malformed booleans are NOT_EXECUTABLE, never mapped to DETECTED_RESTORED', async () => {
  const pageEvaluate = async () => ({ ok: true, detected: 'false', restored: 'false', timedOut: false });
  const result = await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50,
  });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE, 'a string "false" must never be truthiness-coerced into a real true/DETECTED_RESTORED');
  assert.equal(result.reason, 'malformed-in-page-result');
});

test('runBridgedControl: a non-boolean timedOut (e.g. 0/1/undefined) is malformed -- NOT_EXECUTABLE, never silently treated as false', async () => {
  const pageEvaluate = async () => ({ ok: true, detected: true, restored: true, timedOut: 0 });
  const result = await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50,
  });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.reason, 'malformed-in-page-result');
});

test('runBridgedControl: outer-watchdog timeout -- specially-tagged rejection, NEVER a plain TIMED_OUT ControlResult at this layer', async () => {
  // Never-resolving pageEvaluate + an absurdly small outerTimeoutMs deterministically triggers
  // the OUTER watchdog (mirrors this file's own established `checkCapacity: () =>
  // new Promise(() => {})` + small controlTimeoutMs convention, session.test.mjs).
  const pageEvaluate = () => new Promise(() => {});
  await assert.rejects(
    runBridgedControl({ pageEvaluate, controlName: 'capacity-breach', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 5, outerTimeoutMs: 15 }),
    (e) => {
      assert.equal(e.outerWatchdogTimeout, true);
      assert.equal(e.controlName, 'capacity-breach');
      assert.notEqual(e.constructor && e.state, CONTROL_STATE.TIMED_OUT, 'must be a rejection, never a resolved ControlResult');
      return true;
    },
  );
});

test('runBridgedControl: an ordinary pageEvaluate rejection (not a timeout) propagates unchanged, never tagged as outerWatchdogTimeout', async () => {
  const pageEvaluate = async () => { throw new Error('page crashed'); };
  await assert.rejects(
    runBridgedControl({ pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {}, arg: {}, innerTimeoutMs: 50 }),
    (e) => {
      assert.equal(e.message, 'page crashed');
      assert.notEqual(e.outerWatchdogTimeout, true);
      return true;
    },
  );
});

test('runBridgedControl: merges innerTimeoutMs into the arg handed to inPageFn (every bridged control races its OWN in-page timer against it)', async () => {
  let seenArg = null;
  const pageEvaluate = async (fn, arg) => { seenArg = arg; return { ok: true, detected: true, restored: true, timedOut: false }; };
  await runBridgedControl({
    pageEvaluate, controlName: 'wrong-owner', inPageFn: function fakeInPageFn() {},
    arg: { sessionId: 's1', targetDbId: 42 }, innerTimeoutMs: 1234,
  });
  assert.equal(seenArg.sessionId, 's1');
  assert.equal(seenArg.targetDbId, 42);
  assert.equal(seenArg.innerTimeoutMs, 1234);
});

// ============================================================================================
// 6. runControlSafely + sessionTainted -- MULTI-STEP fake sequence (deliverable 4)
// ============================================================================================
//
// A comprehensive, minimal-but-schema-valid "happy path" fake runHarness deps/config, mirroring
// this repo's own established convention (stage8.test.mjs's own buildHappyDeps/buildHappyPageEvaluate)
// but local to this file. ONE control (capacity-breach, Phase 7c -- squarely in the MIDDLE of
// the Phase 3c-10 sequence) is made to reject with an outerWatchdogTimeout-tagged error, proving
// every step both BEFORE and AFTER it behaves correctly.
// ============================================================================================

function callOrderTracker() {
  const order = [];
  return { order, record: (label) => order.push(label) };
}

function buildHappyPageEvaluate(tracker, overrides = {}) {
  const handlers = {
    captureModelFormatSignals: () => ({ ok: true, isOTG: true, isSVF2: true, captureErrors: [] }),
    setupSharedSessionResources: () => ({ ok: true, sessionId: 's1', postconditions: { registryWorldMatches: true, bindingModelMatches: true, worldModelIsLive: true }, error: null }),
    f3InstallProbe: () => ({ ok: true }),
    f3FinalizeProbe: () => ({ ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 5, rejectionError: null }),
    observeF1: () => ({ ok: true, fields: { ownerMismatchCount: 0, unreachableCount: 0, populationCount: 1, rootsLength: 1, rootsCompared: 1, sizeMismatch: 0, ownersMismatch: 0, subtreeDigestMismatch: 0, populationDigestEqual: true, maxRootFragmentCount: 1, sumRootFragmentCount: 1, maxPerDbIdFragmentCount: 1 } }),
    observeF2: () => ({ ok: true, fields: { isObjectTreeCreated: true, treeReachableCount: 1, classL: 1, classN: 0, classU: 0, loadedButUnreachableCount: 0, fragListCount: 1, rootsLength: 1, accountingBalanced: true, maxChildrenPerNode: 0 } }),
    observeF4: () => ({ ok: true, fields: { libraryThrew: 0, libOwnerDiffersFromFragList: 0, droppedDiagnosticsCount: { 'geometry-id-undefined': 0, 'geometry-id-threw': 0 }, distinctGeometryCount: 1, renderProxyFailures: 0, geometryAdapterFailures: 0, geometriesWithNullIndex: 0, weldConsumerFailures: 0, weldConsumerSuccessCount: 1, maxActiveTriangleCount: 1, oversizedGeometryCount: 0 } }),
    observeF7: () => ({ ok: true, fields: { boundsAgreement: {}, unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true, placementNotInvertible: false, nonFiniteAxisDbIds: [] } }),
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
    ...overrides,
  };
  return async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    tracker.record(`pageEvaluate:${name}`);
    if (!(name in handlers)) throw new Error(`buildHappyPageEvaluate: no fake handler for '${name}'`);
    return handlers[name](arg);
  };
}

function buildHappyDeps(tracker, { controlsOverrides = {}, pageEvaluateOverrides = {} } = {}) {
  const pageEvaluate = buildHappyPageEvaluate(tracker, pageEvaluateOverrides);
  const pageWaitForFunction = async (fn) => { tracker.record(`pageWaitForFunction:${fn.name}`); };
  const fakePageEvaluateWithLoad = async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    if (name === 'documentLoadStarter' || name === 'loadDocumentNodeStarter') {
      tracker.record(`pageEvaluate:${name}`);
      return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    return pageEvaluate(fn, arg);
  };
  const detectedRestored = (name) => createControlResult(name, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  return {
    pageEvaluate: fakePageEvaluateWithLoad,
    pageWaitForFunction,
    loadStarter: { documentLoad: 'documentLoadStarter', loadDocumentNode: 'loadDocumentNodeStarter' },
    installF3Probe: () => fakePageEvaluateWithLoad({ name: 'f3InstallProbe' }, undefined),
    finalizeF3Probe: (arg) => fakePageEvaluateWithLoad({ name: 'f3FinalizeProbe' }, arg),
    setupSharedSessionResources: (tokenId) => fakePageEvaluateWithLoad({ name: 'setupSharedSessionResources' }, tokenId),
    controls: {
      treeUnavailable: async () => detectedRestored('tree-unavailable'),
      wrongOwner: async () => detectedRestored('wrong-owner'),
      lateCompletionAfterTimeout: async () => detectedRestored('late-completion-after-timeout'),
      hiddenFragment: async () => detectedRestored('hidden-fragment'),
      invalidGeometryConsumer: async () => detectedRestored('invalid-geometry-consumer'),
      capacityBreach: async () => detectedRestored('capacity-breach'),
      invalidBounds: async () => detectedRestored('invalid-bounds'),
      boundsBeyondTolerance: async () => detectedRestored('bounds-beyond-tolerance'),
      ...controlsOverrides,
    },
    f6Deps: {},
    nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => { tracker.record('captureViewerScriptIntegrity'); return { requestFailed: false, autodeskViewingDefined: true, attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e' }] }; },
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: 'x', sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => { tracker.record('writeResultAtomically'); },
  };
}

const HAPPY_CONFIG = {
  urn: 'fake-urn', loadTimeoutMs: 1000, unloadEventName: 'beforeModelUnload', addedEventName: 'modelAdded',
  viewerVersion: '7.124.2', chromium: 'x', node: process.version, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
};

function outerWatchdogTimeoutError(controlName) {
  return Object.assign(new Error('outer-watchdog-timeout'), { outerWatchdogTimeout: true, controlName });
}

test('runControlSafely + sessionTainted: an outer-watchdog-timed-out MID-SEQUENCE control taints the session and short-circuits every REMAINING step, while every EARLIER step ran normally, and Phase 11 cleanup still runs', async () => {
  const tracker = callOrderTracker();
  // capacity-breach is Phase 7c -- squarely between F5 (Phase 7, pure/no pageEvaluate) and F7
  // (Phase 8). Everything from Phase 3c through F5/Phase 7 must run normally; everything from F7
  // (Phase 8) through F6/stale-old-model-event (Phase 10) must be short-circuited.
  const deps = buildHappyDeps(tracker, {
    controlsOverrides: {
      capacityBreach: async () => { throw outerWatchdogTimeoutError('capacity-breach'); },
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  // (a) the causing control's own result is TIMED_OUT-shaped with the specific reason.
  assert.equal(result.controls['capacity-breach'].state, CONTROL_STATE.TIMED_OUT);
  assert.equal(result.controls['capacity-breach'].executed, true);
  assert.equal(result.controls['capacity-breach'].detected, null);
  assert.equal(result.controls['capacity-breach'].restored, null);
  assert.equal(result.controls['capacity-breach'].reason, 'outer-watchdog-timeout');

  // (b) sessionTainted surfaces at the top level.
  assert.equal(result.sessionTainted, true);

  // Steps BEFORE the tainting control (Phase 3c through Phase 7 inclusive) ran for real.
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F2.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F4.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F5.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.controls['tree-unavailable'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['late-completion-after-timeout'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['hidden-fragment'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['invalid-geometry-consumer'].state, CONTROL_STATE.DETECTED_RESTORED);

  // (c) every SUBSEQUENT step (F7, F8, F6, invalid-bounds, bounds-beyond-tolerance,
  // stale-old-model-event) is a fail-closed placeholder, NEVER actually invoked.
  assert.equal(result.checks.F7.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F7.reason, 'not-reached:fatal-error');
  assert.equal(result.checks.F8.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F6.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.controls['invalid-bounds'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['invalid-bounds'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['bounds-beyond-tolerance'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['stale-old-model-event'].state, CONTROL_STATE.NOT_EXECUTABLE);

  assert.equal(tracker.order.includes('pageEvaluate:observeF7'), false, 'F7 must NEVER actually be observed once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:observeF8'), false, 'F8 must NEVER actually be observed once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:f6InstallUnloadWiring'), false, 'F6 must NEVER actually run once tainted');

  // (d) Phase 11 cleanup still ran regardless (the "ALWAYS runs" guarantee, unchanged).
  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true);
  assert.equal(tracker.order.includes('writeResultAtomically'), true);

  // Overall verdict: a mandatory control's own TIMED_OUT state already forces FAIL via the
  // existing, unmodified computeOverall precedence -- confirmed here as an end-to-end check.
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);

  // Schema-valid despite the short-circuit -- every checks.F*/controls.* is still present.
  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

test('runControlSafely + sessionTainted: an EARLY outer-watchdog timeout (Phase 3c\'s own tree-unavailable) short-circuits EVERY remaining Fi check too, including F1', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    controlsOverrides: {
      treeUnavailable: async () => { throw outerWatchdogTimeoutError('tree-unavailable'); },
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  assert.equal(result.sessionTainted, true);
  assert.equal(result.controls['tree-unavailable'].state, CONTROL_STATE.TIMED_OUT);
  // F1 (Phase 4) never even ran -- the taint happened at the VERY FIRST gated step.
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F1.reason, 'not-reached:fatal-error');
  assert.equal(tracker.order.includes('pageEvaluate:observeF1'), false);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);
});

test('runControlSafely + sessionTainted (Task 15, H1 fix): a GENERIC control throw (not outer-watchdog-tagged) ALSO taints the session and short-circuits every REMAINING step, while every EARLIER step ran normally, overall stays FAIL, and Phase 11 cleanup/evidence-write still run', async () => {
  const tracker = callOrderTracker();
  // capacity-breach is Phase 7c -- squarely between F5 (Phase 7) and F7 (Phase 8), mirroring the
  // sibling outer-watchdog test above exactly, but for a plain (non-outer-watchdog-tagged) throw:
  // the review's own explicit instruction (H1) was to replace the old
  // `sessionTainted === false` assertion with proof that later phases do not execute.
  const deps = buildHappyDeps(tracker, {
    controlsOverrides: {
      capacityBreach: async () => { throw new Error('ordinary bug, not a watchdog timeout'); },
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  // (1) A generic control throw now taints the session too.
  assert.equal(result.sessionTainted, true, 'a generic control throw must taint the session (H1 fix)');
  assert.equal(result.controls['capacity-breach'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['capacity-breach'].reason, 'control-threw');

  // Steps BEFORE the throwing control (Phase 3c through Phase 7 inclusive) ran for real --
  // provable "earlier phases ran".
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F2.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F4.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F5.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.controls['tree-unavailable'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['wrong-owner'].state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.controls['hidden-fragment'].state, CONTROL_STATE.DETECTED_RESTORED);

  // (2) Later phases cannot execute -- provable "later phases don't run", mirroring the sibling
  // outer-watchdog test's own assertion pattern exactly.
  assert.equal(result.checks.F7.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F7.reason, 'not-reached:fatal-error');
  assert.equal(result.checks.F8.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F8.reason, 'not-reached:fatal-error');
  assert.equal(result.checks.F6.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(result.checks.F6.reason, 'not-reached:fatal-error');
  assert.equal(result.controls['invalid-bounds'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['invalid-bounds'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['bounds-beyond-tolerance'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['bounds-beyond-tolerance'].reason, 'not-reached:fatal-error');
  assert.equal(result.controls['stale-old-model-event'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.controls['stale-old-model-event'].reason, 'not-reached:fatal-error');

  assert.equal(tracker.order.includes('pageEvaluate:observeF7'), false, 'F7 must NEVER actually be observed once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:observeF8'), false, 'F8 must NEVER actually be observed once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:f6InstallUnloadWiring'), false, 'F6 must NEVER actually run once tainted');

  // (5) Phase 11 cleanup still ran regardless (the "ALWAYS runs" guarantee, unchanged), and the
  // evidence write path is unaffected by a mid-sequence generic throw -- (4) durable evidence.
  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true);
  assert.equal(tracker.order.includes('writeResultAtomically'), true);

  // (3) Overall verdict remains FAIL -- already true via fatalErrorObserved, asserted explicitly.
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);

  // (4) Durable evidence: schema-valid despite the mid-sequence generic throw + short-circuit.
  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `expected a schema-valid result, got errors: ${JSON.stringify(errors)}`);
});

test('sessionTainted: happy path (no watchdog timeout anywhere) -- explicitly false in the persisted result, schema-valid', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker);
  const result = await runHarness(deps, HAPPY_CONFIG);
  assert.equal(result.sessionTainted, false);
  assert.equal(result.overall, OVERALL_VERDICT.PASS);
  const { valid } = validateResultSchema(result);
  assert.equal(valid, true);
});

// ============================================================================================
// 7. Phase 11: skip sealLoadRecords/drainLoadToken when tainted; watchdog-wrap the in-page
//    cleanup call itself (deliverable 4's last bullet + the second codex-advisor consult's own
//    finding 5).
// ============================================================================================

test('Phase 11: once sessionTainted, sealLoadRecords/drainLoadToken are SKIPPED (never issued against a possibly-wedged page), but the protected page-cleanup call still runs', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    controlsOverrides: { treeUnavailable: async () => { throw outerWatchdogTimeoutError('tree-unavailable'); } },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  assert.equal(result.sessionTainted, true);
  assert.equal(tracker.order.includes('pageEvaluate:sealLoads'), false, 'sealLoadRecords must never be issued once tainted');
  assert.equal(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), true, 'the ONE protected cleanup call must still run');
  assert.ok(result.cleanupFailures.some((f) => f.step === 'sealLoadRecords' && f.reason === 'skipped-session-tainted'));
  assert.ok(result.cleanupFailures.some((f) => f.step === 'drainPendingTokens' && f.reason === 'skipped-session-tainted'));
});

test('Phase 11: a hung runInPageResourceCleanup invocation is time-boxed by the outer watchdog -- runHarness completes (never hangs), records a distinct cleanupFailures entry, and cleanupUnresolvedOwnership becomes true', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: {
      // Never-resolving fake for THIS ONE dispatch name only -- every other handler stays happy.
      runInPageResourceCleanup: () => new Promise(() => {}),
    },
  });
  const result = await runHarness(deps, { ...HAPPY_CONFIG, controlTimeoutMs: 10, cleanupWatchdogTimeoutMs: 15 });

  assert.ok(
    result.cleanupFailures.some((f) => f.step === 'in-page-cleanup-watchdog-timeout'),
    `expected an 'in-page-cleanup-watchdog-timeout' cleanupFailures entry, got: ${JSON.stringify(result.cleanupFailures)}`,
  );
  assert.equal(result.cleanupUnresolvedOwnership, true);
  // runHarness itself still completed and wrote its result -- proof it never actually hung.
  assert.equal(tracker.order.includes('writeResultAtomically'), true);
});

// ============================================================================================
// 8. Cleanup fallback restoration -- restoreAllControlPatches (deliverable 5), exercised
//    directly against the REAL runInPageResourceCleanup via node:vm (never the runHarness-level
//    fake used above).
// ============================================================================================

function installLeaseAndPatch(realm, sessionId, { controlId, property = 'getDbIds', makeNonConfigurable = false } = {}) {
  return vm.runInContext(
    `(() => {
      const g = window.__g1;
      const session = g.sessions[${JSON.stringify(sessionId)}];
      const acquire = acquireControlLease({ sessionId: ${JSON.stringify(sessionId)}, tokenId: session.tokenId, gen: session.tokenGen, controlId: ${JSON.stringify(controlId)} });
      if (!acquire.ok) throw new Error('fixture setup: acquireControlLease failed: ' + acquire.reason);
      const target = { [${JSON.stringify(property)}]: () => 'original' };
      const originalDescriptor = Object.getOwnPropertyDescriptor(target, ${JSON.stringify(property)});
      const original = target[${JSON.stringify(property)}];
      if (${makeNonConfigurable}) {
        Object.defineProperty(target, ${JSON.stringify(property)}, { value: () => 'patched-nonconfigurable', writable: false, configurable: false, enumerable: true });
      } else {
        target[${JSON.stringify(property)}] = () => 'patched';
      }
      recordControlPatch(session, { target, property: ${JSON.stringify(property)}, originalDescriptor });
      window.__probe = { target, original };
      return { ok: true };
    })();`,
    realm.context,
  );
}

test('restoreAllControlPatches: a control that acquired a lease, patched a property, and never released/restored (simulating an outer-watchdog scenario) -- cleanup detects it, restores correctly, verifies via postcondition, and clears the lease', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const setup = installLeaseAndPatch(realm, sessionId, { controlId: 'wrong-owner' });
  assert.equal(setup.ok, true);

  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'ran');
  assert.equal(result.cleanupUnresolvedOwnership, false);

  const probe = vm.runInContext('window.__probe', realm.context);
  assert.equal(probe.target.getDbIds, probe.original, 'the patched property must be restored to the ORIGINAL function reference');
  assert.equal(realm.window.__g1.sessions[sessionId].activeControl, null, 'the lease must be released once fully restored');
});

test('restoreAllControlPatches: a property that cannot be restored (made non-configurable) is correctly recorded as a cleanupFailures entry and contributes to cleanupUnresolvedOwnership, never silently ignored', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  installLeaseAndPatch(realm, sessionId, { controlId: 'wrong-owner', makeNonConfigurable: true });

  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'threw');
  assert.ok(result.cleanupFailures.some((f) => f.step === 'restoreAllControlPatches'));
  assert.equal(result.cleanupUnresolvedOwnership, true);
  // The lease must NOT be cleared -- a partial/failed restoration must never look "done".
  assert.ok(realm.window.__g1.sessions[sessionId].activeControl, 'the lease must remain held when restoration genuinely failed');
});

test('restoreAllControlPatches: multiple patches are restored in REVERSE order, and one failing does not prevent the others from being attempted', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  vm.runInContext(
    `(() => {
      const session = window.__g1.sessions[${JSON.stringify(sessionId)}];
      acquireControlLease({ sessionId: ${JSON.stringify(sessionId)}, tokenId: session.tokenId, gen: session.tokenGen, controlId: 'wrong-owner' });

      const order = [];
      const targetA = { propA: () => 'A-original' };
      const descA = Object.getOwnPropertyDescriptor(targetA, 'propA');
      const originalA = targetA.propA;
      targetA.propA = () => 'A-patched';
      recordControlPatch(session, { target: targetA, property: 'propA', originalDescriptor: descA });

      const targetB = { propB: () => 'B-original' };
      const descB = Object.getOwnPropertyDescriptor(targetB, 'propB');
      Object.defineProperty(targetB, 'propB', { value: () => 'B-patched-nonconfigurable', writable: false, configurable: false, enumerable: true });
      recordControlPatch(session, { target: targetB, property: 'propB', originalDescriptor: descB });

      window.__probe2 = { targetA, originalA };
    })();`,
    realm.context,
  );

  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  // targetB's patch cannot be restored (non-configurable) -- but targetA's own restoration must
  // still have been ATTEMPTED and SUCCEEDED despite targetB's own failure.
  const probe2 = vm.runInContext('window.__probe2', realm.context);
  assert.equal(probe2.targetA.propA, probe2.originalA, 'targetA must still be restored despite targetB failing');
  assert.equal(result.stepStatus.restoreAllControlPatches, 'threw');
  assert.equal(result.cleanupUnresolvedOwnership, true);
});

test('restoreAllControlPatches: an originally-ABSENT own property (delete-vs-restore path) is deleted back to absent, not left as an own property with a stale value', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  vm.runInContext(
    `(() => {
      const session = window.__g1.sessions[${JSON.stringify(sessionId)}];
      acquireControlLease({ sessionId: ${JSON.stringify(sessionId)}, tokenId: session.tokenId, gen: session.tokenGen, controlId: 'wrong-owner' });
      const target = {}; // 'getDbIds' does NOT exist as an own property yet
      const originalDescriptor = Object.getOwnPropertyDescriptor(target, 'getDbIds') || null;
      target.getDbIds = () => 'patched';
      recordControlPatch(session, { target, property: 'getDbIds', originalDescriptor });
      window.__probe3 = { target };
    })();`,
    realm.context,
  );

  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'ran');
  const probe3 = vm.runInContext('window.__probe3', realm.context);
  assert.equal(Object.prototype.hasOwnProperty.call(probe3.target, 'getDbIds'), false, 'the property must be deleted back to genuinely absent, not merely undefined');
});

test('restoreAllControlPatches: no active lease at all (nothing to restore) -- step is skipped, never a false failure', async () => {
  const { realm, sessionId } = await realmWithPublishedSession();
  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'skipped');
  assert.equal(result.cleanupUnresolvedOwnership, false);
});

// codex-review (code, high effort, Task 10's own pre-commit review pass) Important #4: a lease
// that was ACQUIRED but never recorded a single patch (e.g. the control hung/timed-out between
// acquiring its lease and its first recordControlPatch call) must NEVER be silently reported as
// 'skipped' with cleanupUnresolvedOwnership left false -- fail closed instead: the step must
// fire, refuse to clear the lease, and flag it.
test('restoreAllControlPatches: a lease held with ZERO recorded patches is NOT silently skipped -- fails closed, records a cleanupFailures entry, sets cleanupUnresolvedOwnership, and does NOT release the lease', async () => {
  const { realm, sessionId, tokenId, gen } = await realmWithPublishedSession();
  const acquired = realm.call(acquireControlLease, { sessionId, tokenId, gen, controlId: 'wrong-owner' });
  assert.equal(acquired.ok, true);
  // Deliberately never record any patch -- simulates a control interrupted between acquiring
  // its lease and its first mutation.
  assert.equal(realm.window.__g1.sessions[sessionId].activeControl.patches.length, 0);

  const result = await realm.call(runInPageResourceCleanup, { sessionId });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'threw');
  assert.ok(result.cleanupFailures.some((f) => f.step === 'restoreAllControlPatches'));
  assert.equal(result.cleanupUnresolvedOwnership, true);
  assert.ok(realm.window.__g1.sessions[sessionId].activeControl, 'the lease must remain held -- cleanup cannot prove it safe to release');
});

test('runInPageResourceCleanup: session-not-found -- restoreAllControlPatches is genuinely \'skipped\', not the old stub value', async () => {
  const realm = createPageRealm({ __g1: { sessions: {} }, __viewer: { getAllModels: () => [] } });
  const result = await realm.call(runInPageResourceCleanup, { sessionId: 'missing' });
  assert.equal(result.stepStatus.restoreAllControlPatches, 'skipped');
});
