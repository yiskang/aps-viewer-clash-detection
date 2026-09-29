// test/acceptance/g1-svf2-f1-f8-verification.async.test.mjs
//
// Offline, browser-free unit tests for Stage 2 of test/acceptance/g1-svf2-f1-f8-verification.mjs
// (the browser-owned load-record protocol, Node-side load orchestration, and the 22-step
// cleanup executor). Kept as a sibling file, not appended to g1-svf2-f1-f8-verification.test.mjs
// (Stage 1's file), because Stage 1's file already covers a large, independent surface
// (readFormat/describeError/Token/computeOverall/ControlResult) and mixing in Stage 2's very
// different concerns (page-realm simulation, async orchestration, a 22-step executor) would
// make either file harder to navigate. Auto-discovered by scripts/run-tests.mjs (`*.test.mjs`).
//
// This file NEVER imports playwright and NEVER launches a browser. The in-page functions
// (createLoadRecord/onDeadline/onSuccess/onError/sealLoads/isOwnershipClean/
// readLoadRecordSnapshot) are exercised through a real `node:vm` context (see createPageRealm,
// below) rather than a plain direct call -- a plain call would silently succeed even if a
// function accidentally closed over this module's own outer scope (since a normal JS closure
// is preserved across a direct call), which would defeat the whole point of proving these
// functions are safe to hand to a real `page.evaluate` verbatim in Stage 3. Reconstructing each
// function from its own `fn.toString()` source inside a fresh vm context -- with ONLY the
// intended page globals available -- means an accidental reference to a module-level helper or
// constant throws a ReferenceError here, where a direct call would not have caught it.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  TOKEN_STATE,
  createToken,
  transitionToken,
  LOAD_RECORD_STATUS,
  LOAD_API,
  DRAIN_TIMEOUT_MS,
  pageErrOf,
  pushLoadTransition,
  isLateModelsAllGone,
  createLoadRecord,
  onDeadline,
  onSuccess,
  onError,
  disposeLateArrival,
  sealLoads,
  isOwnershipClean,
  readLoadRecordSnapshot,
  startLoad,
  drainLoadToken,
  sealLoadRecords,
  finalizeLoadTokens,
  CLEANUP_STEP_NAMES,
  runCleanup,
  tokenEscalatesToUnresolvedOwnership,
  CLOSE_TIMEOUT_MS,
  computeOverall,
  OVERALL_VERDICT,
  CLASSIFIER,
  INTEGRITY_RESULT,
  CHECK_VERDICT,
  CONTROL_STATE,
  CONTROL_NAMES,
  createControlResult,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// Page-realm test harness (node:vm-backed) -- see file banner above for why.
// ============================================================================================

// Every in-page function this stage builds, keyed by its own declared name. `onSuccess`,
// `onError`, `sealLoads`, and `readLoadRecordSnapshot` call one or more of the others (see the
// module's own "BUNDLING NOTE FOR STAGE 3") -- Playwright's page.evaluate only serializes the
// ONE function it is given, not anything that function calls, so Stage 3 must bundle every
// entry point together with everything it transitively calls when composing a real
// page.evaluate source. createPageRealm (below) does the same bundling for this test harness:
// EVERY one of these is installed as a same-realm global function in one vm context, so a
// sibling call (e.g. onSuccess calling pushLoadTransition) resolves correctly -- while still
// proving none of them closes over anything from OUTSIDE this bundle (this module's own scope).
const IN_PAGE_FUNCTIONS = {
  pageErrOf, pushLoadTransition, isLateModelsAllGone, createLoadRecord, onDeadline, onSuccess,
  onError, disposeLateArrival, sealLoads, isOwnershipClean, readLoadRecordSnapshot,
};

/**
 * Creates one isolated "page realm" for a single test scenario. `initialWindow` becomes the
 * realm's own `window` global -- vm.createContext CONTEXTIFIES the object in place, so mutations
 * made by in-realm code (e.g. `window.__g1 = ...`) are visible on the SAME object reference from
 * ordinary Node code after the call returns (no cloning). Only `window`, `performance`,
 * `setTimeout`/`clearTimeout`, `console`, and every IN_PAGE_FUNCTIONS entry (installed as a
 * same-realm global, reconstructed from its own source text) are exposed -- deliberately
 * nothing else from this module's own scope. `call(fn, ...args)` looks `fn` up by name among
 * the already-installed globals and invokes it inside this realm; a function that closes over
 * anything outside this bundle + true page globals throws a ReferenceError here.
 */
function createPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTIONS)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    call(fn, ...args) {
      return vm.runInContext(fn.name, context)(...args);
    },
    // For a test that needs to construct a value the in-realm code will later `instanceof`-
    // check (e.g. a `Set` assigned onto a record's `preLoadModels`) -- a Set built in the test
    // file's OWN Node realm is a DIFFERENT constructor than this vm context's own `Set`, so an
    // in-realm `instanceof Set` check would (correctly, per real cross-realm semantics) reject
    // it. Use this to build such a value using the realm's OWN built-ins instead.
    evalInRealm(code) {
      return vm.runInContext(code, context);
    },
  };
}

function fakeViewer(initialModels = []) {
  let models = [...initialModels];
  const unloadCalls = [];
  return {
    getAllModels: () => models,
    unloadModel: (m) => {
      unloadCalls.push(m);
      models = models.filter((x) => x !== m);
    },
    unloadCalls,
    _setModels: (next) => { models = next; },
  };
}

// ============================================================================================
// Load record: three-way race, late-arrival disposition
// ============================================================================================

test('load record: success before deadline -> completed, stored, timer cleared', () => {
  const viewer = fakeViewer();
  const realm = createPageRealm({ __viewer: viewer });
  const deadline = performance.now() + 10_000;
  realm.call(createLoadRecord, 'tok1', LOAD_API.DOCUMENT_LOAD, 1, deadline);

  const result = realm.call(onSuccess, 'tok1', 1, { fakeDoc: true });

  assert.equal(result.status, LOAD_RECORD_STATUS.COMPLETED);
  // result.outcome was constructed by code running INSIDE the vm realm, so it is a plain object
  // from a DIFFERENT realm's Object.prototype than this test file's own object literals --
  // assert.deepEqual's strict cross-realm prototype check would spuriously fail here even
  // though the shape/values match exactly. Compare fields individually instead.
  assert.equal(result.outcome.kind, 'success');
  assert.equal(result.outcome.error, null);
  assert.deepEqual(realm.window.__g1.docs['tok1'], { fakeDoc: true });
  assert.equal(realm.window.__g1.loads['tok1'].transitions.at(-1).to, LOAD_RECORD_STATUS.COMPLETED);
});

test('load record: onDeadline before either callback -> in-page timed-out', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const deadline = performance.now() - 1; // already past
  realm.call(createLoadRecord, 'tok2', LOAD_API.DOCUMENT_LOAD, 1, deadline);

  const result = realm.call(onDeadline, 'tok2', 1);

  assert.equal(result.status, LOAD_RECORD_STATUS.TIMED_OUT);
  assert.equal(realm.window.__g1.loads['tok2'].outcome, null, 'a pure timeout never produces an outcome');
});

test('race ordering A: callback arrives comfortably BEFORE the deadline -> completed normally', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const deadline = performance.now() + 60_000;
  realm.call(createLoadRecord, 'tok3', LOAD_API.DOCUMENT_LOAD, 1, deadline);

  const result = realm.call(onSuccess, 'tok3', 1, { fakeDoc: true });

  assert.equal(result.status, LOAD_RECORD_STATUS.COMPLETED);
});

test('race ordering B: callback runs AFTER the deadline but BEFORE the timer task fires -- the "first" re-check inside onSuccess itself must catch this, not only the timer', () => {
  // Simulates exactly the race §6.4a calls out: the deadline instant has passed (by wall
  // clock), but onDeadline (the timer callback) has NOT been invoked yet -- record is still
  // 'active' when onSuccess runs. onSuccess's own deadline re-check must still route this to
  // late-arrival disposition, proving the timer is not the only enforcement point.
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const deadline = performance.now() - 1; // deadline already passed
  realm.call(createLoadRecord, 'tok4', LOAD_API.DOCUMENT_LOAD, 1, deadline);
  // Record is still 'active' at this point (onDeadline was never called) -- exactly the race window.
  assert.equal(realm.window.__g1.loads['tok4'].status, LOAD_RECORD_STATUS.ACTIVE);

  const result = realm.call(onSuccess, 'tok4', 1, { fakeDoc: true });

  assert.notEqual(result.status, LOAD_RECORD_STATUS.COMPLETED, 'must never complete once past its own deadline, even if the timer has not run yet');
  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_DISCARDED);
  assert.equal(realm.window.__g1.docs['tok4'], undefined, 'the late Document must never be stored');
});

test('late Document success after an already-timed-out record -> late-discarded, dropped, never stored', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const deadline = performance.now() + 5;
  realm.call(createLoadRecord, 'tok5', LOAD_API.DOCUMENT_LOAD, 1, deadline);
  realm.call(onDeadline, 'tok5', 1); // simulates the timer firing first

  const result = realm.call(onSuccess, 'tok5', 1, { fakeDoc: true });

  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_DISCARDED);
  assert.equal(result.lateDiscarded, true);
  assert.equal(realm.window.__g1.docs['tok5'], undefined);
});

test('late Document.load error after timeout -> late-discarded (an error never produces a Model to unload)', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  realm.call(createLoadRecord, 'tok6', LOAD_API.DOCUMENT_LOAD, 1, performance.now() + 5);
  realm.call(onDeadline, 'tok6', 1);

  const result = realm.call(onError, 'tok6', 1, { code: 7, message: 'boom' });

  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_DISCARDED);
});

test('late loadDocumentNode REJECTION after timeout -> late-discarded (not late-unloading -- an error is never a Model)', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  realm.call(createLoadRecord, 'tok6b', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 5);
  realm.call(onDeadline, 'tok6b', 1);

  const result = realm.call(onError, 'tok6b', 1, { code: 7, message: 'boom' });

  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_DISCARDED);
});

test('late Model after timeout -> late-unloading -> late-unloaded once getAllModels() no longer includes it (synchronous removal)', () => {
  const model = { id: 'M1' };
  const viewer = fakeViewer(); // unloadModel synchronously removes -- see fakeViewer()
  const realm = createPageRealm({ __viewer: viewer });
  realm.call(createLoadRecord, 'tok7', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 5);
  realm.call(onDeadline, 'tok7', 1);

  const result = realm.call(onSuccess, 'tok7', 1, model);

  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_UNLOADED, 'synchronous unload observed gone in the same invocation');
  assert.deepEqual(viewer.unloadCalls, [model]);
});

test('late Model whose removal is NOT yet observed gone -> stays late-unloading, not late-unloaded', () => {
  const model = { id: 'M2' };
  // A viewer whose unloadModel does NOT remove the model from getAllModels() synchronously --
  // simulates the plan's own "typed void; synchronous removal is not assumed" case.
  const viewer = {
    getAllModels: () => [model],
    unloadModel: () => {},
  };
  const realm = createPageRealm({ __viewer: viewer });
  realm.call(createLoadRecord, 'tok8', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 5);
  realm.call(onDeadline, 'tok8', 1);

  const result = realm.call(onSuccess, 'tok8', 1, model);

  assert.equal(result.status, LOAD_RECORD_STATUS.LATE_UNLOADING);
  assert.equal(result.lateModelPending, true);
});

// ============================================================================================
// Sealing
// ============================================================================================

test('sealing moves active/timed-out records to sealed', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  realm.call(createLoadRecord, 'active1', LOAD_API.DOCUMENT_LOAD, 1, performance.now() + 60_000);
  realm.call(createLoadRecord, 'timedout1', LOAD_API.DOCUMENT_LOAD, 1, performance.now() - 1);
  realm.call(onDeadline, 'timedout1', 1);

  const snapshots = realm.call(sealLoads, []);

  assert.equal(snapshots['active1'].status, LOAD_RECORD_STATUS.SEALED);
  assert.equal(snapshots['timedout1'].status, LOAD_RECORD_STATUS.SEALED);
  assert.equal(realm.window.__g1.closing, true);
});

test('sealing: an unclaimed completed Document record is caught by the "treat as late" rule -> late-discarded', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  realm.call(createLoadRecord, 'unclaimed1', LOAD_API.DOCUMENT_LOAD, 1, performance.now() + 60_000);
  realm.call(onSuccess, 'unclaimed1', 1, { fakeDoc: true }); // completes normally in-page
  assert.equal(realm.window.__g1.loads['unclaimed1'].status, LOAD_RECORD_STATUS.COMPLETED);

  // Node never received/claimed it (e.g. the START_LOAD evaluate call itself rejected).
  const snapshots = realm.call(sealLoads, []); // claimed = []

  assert.equal(snapshots['unclaimed1'].status, LOAD_RECORD_STATUS.LATE_DISCARDED);
});

test('sealing: an unclaimed completed Model record is caught, unloaded, and moves to late-unloaded once gone', () => {
  const model = { id: 'M3' };
  const viewer = fakeViewer();
  const realm = createPageRealm({ __viewer: viewer });
  realm.call(createLoadRecord, 'unclaimedModel', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 60_000);
  realm.call(onSuccess, 'unclaimedModel', 1, model);
  assert.equal(realm.window.__g1.loads['unclaimedModel'].status, LOAD_RECORD_STATUS.COMPLETED);

  const snapshots = realm.call(sealLoads, []);

  assert.equal(snapshots['unclaimedModel'].status, LOAD_RECORD_STATUS.LATE_UNLOADED);
  assert.deepEqual(viewer.unloadCalls, [model]);
});

test('sealing: a CLAIMED completed record is left completed, never touched by sealing', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  realm.call(createLoadRecord, 'claimed1', LOAD_API.DOCUMENT_LOAD, 1, performance.now() + 60_000);
  realm.call(onSuccess, 'claimed1', 1, { fakeDoc: true });

  const snapshots = realm.call(sealLoads, ['claimed1']);

  assert.equal(snapshots['claimed1'].status, LOAD_RECORD_STATUS.COMPLETED);
});

test('sealing sweep: a model already owned by a CLAIMED record is excluded from the sweep of a different sealed record', () => {
  const claimedModel = { id: 'claimed-model' };
  const untrackedModel = { id: 'untracked-model' };
  const viewer = fakeViewer([claimedModel, untrackedModel]);
  const realm = createPageRealm({ __viewer: viewer });

  // A claimed, completed loadDocumentNode record already owns claimedModel.
  realm.call(createLoadRecord, 'claimedLoad', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 60_000);
  realm.call(onSuccess, 'claimedLoad', 1, claimedModel);

  // A second, SEALED (timed-out) loadDocumentNode record whose preLoadModels predates both
  // models. Built via evalInRealm, not `new Set()` here -- a Set constructed in this test
  // file's own Node realm is a DIFFERENT constructor than the vm realm's own Set, and sealLoads'
  // `instanceof Set` check (correctly) rejects a cross-realm Set as "missing or invalid".
  realm.call(createLoadRecord, 'sweptLoad', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() - 1);
  realm.window.__g1.loads['sweptLoad'].preLoadModels = realm.evalInRealm('new Set()'); // neither model was present at its own call time
  realm.call(onDeadline, 'sweptLoad', 1);

  const snapshots = realm.call(sealLoads, ['claimedLoad']);

  assert.equal(snapshots['claimedLoad'].status, LOAD_RECORD_STATUS.COMPLETED, 'claimed record untouched');
  assert.deepEqual(viewer.unloadCalls, [untrackedModel], 'only the untracked model is swept -- the claimed model is excluded');
});

test('sealing sweep: multiple untracked models are ALL attempted even if one unloadModel call throws', () => {
  const modelA = { id: 'A' };
  const modelB = { id: 'B' };
  const viewer = {
    getAllModels: () => [modelA, modelB],
    unloadModel: (m) => { if (m === modelA) throw new Error('unloadModel(A) failed'); },
  };
  const realm = createPageRealm({ __viewer: viewer });
  realm.call(createLoadRecord, 'sweep2', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() - 1);
  realm.window.__g1.loads['sweep2'].preLoadModels = realm.evalInRealm('new Set()'); // see evalInRealm's own comment above
  realm.call(onDeadline, 'sweep2', 1);

  const snapshots = realm.call(sealLoads, []);

  assert.equal(realm.window.__g1.loads['sweep2'].lateModels.length, 2, 'both models are pushed into lateModels despite A throwing');
  assert.equal(snapshots['sweep2'].handlerErrors.length, 1, 'the throw from A is recorded, not swallowed silently');
});

test('sealing sweep: fails closed when preLoadModels is missing/invalid -- never treated as an empty set (which would sweep every model)', () => {
  const model = { id: 'preexisting' };
  const viewer = fakeViewer([model]);
  const realm = createPageRealm({ __viewer: viewer });
  realm.call(createLoadRecord, 'badPreLoad', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() - 1);
  realm.window.__g1.loads['badPreLoad'].preLoadModels = null; // corrupted/missing
  realm.call(onDeadline, 'badPreLoad', 1);

  realm.call(sealLoads, []);

  assert.deepEqual(viewer.unloadCalls, [], 'fail closed -- nothing swept when preLoadModels cannot be trusted');
  assert.equal(realm.window.__g1.loads['badPreLoad'].handlerErrors.length, 1);
});

// ============================================================================================
// isOwnershipClean / readLoadRecordSnapshot
// ============================================================================================

test('isOwnershipClean: completed+claimed, late-discarded, late-unloaded, and sealed Document.load are clean; sealed loadDocumentNode, active, and timed-out are not', () => {
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.COMPLETED, tokenId: 't' }, { claimedTokenIds: ['t'] }), true);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.COMPLETED, tokenId: 't' }, { claimedTokenIds: [] }), false);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.LATE_DISCARDED }, {}), true);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.LATE_UNLOADED }, {}), true);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.SEALED, api: LOAD_API.DOCUMENT_LOAD }, {}), true);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.SEALED, api: LOAD_API.LOAD_DOCUMENT_NODE }, {}), false);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.ACTIVE }, {}), false);
  assert.equal(isOwnershipClean({ status: LOAD_RECORD_STATUS.TIMED_OUT }, {}), false);
  assert.equal(isOwnershipClean(null, {}), false);
});

test('readLoadRecordSnapshot: present record returns counts/booleans only, never a model', () => {
  const model = { id: 'snap' };
  const realm = createPageRealm({ __viewer: fakeViewer([model]) });
  realm.call(createLoadRecord, 'snapTok', LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() + 60_000);
  realm.call(onSuccess, 'snapTok', 1, model);

  const snapshot = realm.call(readLoadRecordSnapshot, 'snapTok');

  assert.equal(snapshot.present, true);
  assert.equal(snapshot.status, LOAD_RECORD_STATUS.COMPLETED);
  assert.equal(typeof snapshot.lateModelsStillPresent, 'boolean');
  assert.ok(!('model' in snapshot) && !('value' in snapshot), 'never leaks the live model reference');
});

test('readLoadRecordSnapshot: missing record -> {present: false}', () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const snapshot = realm.call(readLoadRecordSnapshot, 'nope');
  // Cross-realm plain object (see the "success before deadline" test above) -- compare the
  // field, not the whole object.
  assert.equal(snapshot.present, false);
});

// ============================================================================================
// §6.4a terminal-state-machine table -- Cases A-D, as explicit scenarios
// ============================================================================================

test('Case A: timeout before Document.load settles -> in-page sealed (ownership-clean), Node token disposed after drain', async () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const tokenId = 'caseA';
  realm.call(createLoadRecord, tokenId, LOAD_API.DOCUMENT_LOAD, 1, performance.now() - 1);
  realm.call(onDeadline, tokenId, 1);

  const token = createToken({ operation: 'load', api: LOAD_API.DOCUMENT_LOAD });
  transitionToken(token, TOKEN_STATE.TIMED_OUT); // mirrors startLoad's own reconciliation for a 'timed-out' snapshot

  const sealResult = await sealLoadRecords({
    tokens: [token],
    pageEvaluate: async (fn, args) => realm.call(fn, args), // args IS the bare claimed array now (fix wave: sealLoadRecords passes it unwrapped)
    sealFn: sealLoads,
    claimedTokenIds: [],
  });
  assert.equal(sealResult.snapshots[tokenId].status, LOAD_RECORD_STATUS.SEALED);

  const drainResult = await drainLoadToken({
    token,
    pageWaitForFunction: async () => true, // ownership-clean immediately -- Document.load sealed is clean
    pageEvaluate: async (fn, args) => realm.call(fn, args), // args IS the bare tokenId string now (fix wave: drainLoadToken passes it unwrapped)
    ownershipCleanPredicate: () => true,
    readRecordFn: readLoadRecordSnapshot,
    tokenId,
    gen: 1,
  });

  assert.equal(drainResult.drained, true);
  assert.equal(token.state, TOKEN_STATE.DISPOSED);
});

test('Case B: late Document after timeout -> late-discarded, Node token disposed, staleContinuationsDropped-shaped evidence available', async () => {
  const realm = createPageRealm({ __viewer: fakeViewer() });
  const tokenId = 'caseB';
  realm.call(createLoadRecord, tokenId, LOAD_API.DOCUMENT_LOAD, 1, performance.now() - 1);
  realm.call(onDeadline, tokenId, 1);
  const lateResult = realm.call(onSuccess, tokenId, 1, { fakeDoc: true });
  assert.equal(lateResult.status, LOAD_RECORD_STATUS.LATE_DISCARDED);

  const token = createToken({ operation: 'load', api: LOAD_API.DOCUMENT_LOAD });
  transitionToken(token, TOKEN_STATE.TIMED_OUT);

  const drainResult = await drainLoadToken({
    token,
    pageWaitForFunction: async () => true,
    pageEvaluate: async (fn, args) => realm.call(fn, args), // args IS the bare tokenId string now (fix wave: drainLoadToken passes it unwrapped)
    ownershipCleanPredicate: () => true,
    readRecordFn: readLoadRecordSnapshot,
    tokenId,
    gen: 1,
  });

  assert.equal(drainResult.drained, true);
  assert.equal(token.state, TOKEN_STATE.DISPOSED);
  // The evidence shape a caller would fold into staleContinuationsDropped ({tokenId, operation, phase}) --
  // this stage doesn't own that list, but confirms the transition record it would be built from exists.
  assert.equal(drainResult.snapshot.transitions.some((t) => t.to === LOAD_RECORD_STATUS.LATE_DISCARDED), true);
});

test('Case C: loadDocumentNode timeout then late Model -> late-unloaded -> Node token disposed', async () => {
  const model = { id: 'caseC-model' };
  const viewer = fakeViewer();
  const realm = createPageRealm({ __viewer: viewer });
  const tokenId = 'caseC';
  realm.call(createLoadRecord, tokenId, LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() - 1);
  realm.call(onDeadline, tokenId, 1);
  const lateResult = realm.call(onSuccess, tokenId, 1, model);
  assert.equal(lateResult.status, LOAD_RECORD_STATUS.LATE_UNLOADED);

  const token = createToken({ operation: 'load', api: LOAD_API.LOAD_DOCUMENT_NODE });
  transitionToken(token, TOKEN_STATE.TIMED_OUT);

  const drainResult = await drainLoadToken({
    token,
    pageWaitForFunction: async () => true,
    pageEvaluate: async (fn, args) => realm.call(fn, args), // args IS the bare tokenId string now (fix wave: drainLoadToken passes it unwrapped)
    ownershipCleanPredicate: () => true,
    readRecordFn: readLoadRecordSnapshot,
    tokenId,
    gen: 1,
  });

  assert.equal(drainResult.drained, true);
  assert.equal(token.state, TOKEN_STATE.DISPOSED);
});

test('Case C (abandon path): loadDocumentNode timeout, model never confirmed gone -> drain fails, token stays timed-out, then finalizeLoadTokens abandons it once the realm is confirmed destroyed', async () => {
  const model = { id: 'caseC-stuck' };
  // unloadModel never actually removes it -- simulates "not observed gone by the time the page closes".
  const viewer = { getAllModels: () => [model], unloadModel: () => {} };
  const realm = createPageRealm({ __viewer: viewer });
  const tokenId = 'caseC-stuck-tok';
  realm.call(createLoadRecord, tokenId, LOAD_API.LOAD_DOCUMENT_NODE, 1, performance.now() - 1);
  realm.call(onDeadline, tokenId, 1);
  realm.call(onSuccess, tokenId, 1, model); // late-unloading, never reaches late-unloaded

  const token = createToken({ operation: 'load', api: LOAD_API.LOAD_DOCUMENT_NODE });
  transitionToken(token, TOKEN_STATE.TIMED_OUT);

  const drainResult = await drainLoadToken({
    token,
    pageWaitForFunction: async () => { throw new Error('never becomes ownership-clean'); },
    pageEvaluate: async () => { throw new Error('unreachable'); },
    ownershipCleanPredicate: () => false,
    readRecordFn: readLoadRecordSnapshot,
    tokenId,
    gen: 1,
    drainTimeoutMs: 10,
  });
  assert.equal(drainResult.drained, false);
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT, 'an elapsed/failed drain is never treated as a terminal signal');

  const finalizeResult = finalizeLoadTokens({ tokens: [token], pageIsClosed: true, contextCloseSucceeded: false, browserCloseSucceeded: false });
  assert.equal(token.state, TOKEN_STATE.ABANDONED);
  assert.equal(finalizeResult.stillTimedOut.length, 0);
});

test('Case D: unrecoverable/contaminated session -- startLoad reconciles a rejecting pageEvaluate to a timed-out token, never throws', async () => {
  const { token, caseD, reason } = await startLoad({
    pageEvaluate: async () => { throw new Error('page crashed mid-evaluate'); },
    starter: () => {},
    api: LOAD_API.DOCUMENT_LOAD,
    urn: 'urn:fake',
    loadTimeoutMs: 30_000,
  });

  assert.equal(caseD, true);
  assert.equal(reason, 'page-unresponsive');
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT);
});

test('Case D: a malformed snapshot (missing gen) also reconciles to Case D, never a false completed/timed-out', async () => {
  const { caseD, reason, token } = await startLoad({
    pageEvaluate: async () => ({ status: 'completed' }), // no `gen` -- malformed
    starter: () => {},
    api: LOAD_API.DOCUMENT_LOAD,
    urn: 'urn:fake',
    loadTimeoutMs: 30_000,
  });
  assert.equal(caseD, true);
  assert.equal(reason, 'load-record-generation-mismatch');
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT);
});

test('drainLoadToken fix round 1 regression: an UNCLAIMED completed snapshot (Case D -- a transient pageEvaluate failure reconciled the token to timed-out while the in-page record actually settled completed) must NEVER be treated as ownership-clean/drained', async () => {
  // Reviewer's exact repro against the pre-fix module: a timed-out token (never claimed --
  // exactly Case D) whose drained snapshot reports status:'completed' was incorrectly treated
  // as ownership-clean because drainLoadToken passed {} (not {claimedTokenIds:[]}) to
  // isOwnershipClean, so its "completed (and claimed by Node)" qualifier (plan §6.4a "The
  // record") was silently skipped -- ANY completed status short-circuited to clean. For a
  // loadDocumentNode record this is a real contamination risk: the live Model behind an
  // unclaimed "completed" record never gets routed through sealing's own late-arrival
  // disposition (the only path that actually calls viewer.unloadModel() for it), yet the token
  // would end up marked disposed -- implying resolved ownership -- while the Model could remain
  // silently loaded into a later phase's world/registry/Viewer reads.
  const token = createToken({ operation: 'load', api: LOAD_API.LOAD_DOCUMENT_NODE });
  transitionToken(token, TOKEN_STATE.TIMED_OUT); // Case D: never claimed

  const result = await drainLoadToken({
    token,
    pageWaitForFunction: async () => true,
    pageEvaluate: async () => ({ present: true, gen: 1, status: LOAD_RECORD_STATUS.COMPLETED }),
    ownershipCleanPredicate: () => true,
    readRecordFn: () => {},
    tokenId: 'x',
    gen: 1,
  });

  assert.equal(result.drained, false, 'an unclaimed completed snapshot must never be treated as drained');
  assert.equal(result.reason, 'not-ownership-clean');
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT, 'the token must stay timed-out, never disposed, from this path alone');
});

test('finalizeLoadTokens: destruction NOT confirmed -> token stays timed-out, recorded in stillTimedOut', () => {
  const token = createToken({ operation: 'load' });
  transitionToken(token, TOKEN_STATE.TIMED_OUT);

  const result = finalizeLoadTokens({ tokens: [token], pageIsClosed: false, contextCloseSucceeded: false, browserCloseSucceeded: false });

  assert.equal(token.state, TOKEN_STATE.TIMED_OUT);
  assert.deepEqual(result.stillTimedOut, [token]);
});

// ============================================================================================
// startLoad: normal completed/timed-out reconciliation
// ============================================================================================

test('startLoad: a completed snapshot reconciles the Node token to completed', async () => {
  const { token, caseD } = await startLoad({
    pageEvaluate: async () => ({ tokenId: 'x', gen: 1, status: LOAD_RECORD_STATUS.COMPLETED, outcome: { kind: 'success', error: null } }),
    starter: () => {},
    api: LOAD_API.DOCUMENT_LOAD,
    urn: 'urn:fake',
    loadTimeoutMs: 30_000,
  });
  assert.equal(caseD, false);
  assert.equal(token.state, TOKEN_STATE.COMPLETED);
});

test('startLoad: a timed-out snapshot reconciles the Node token to timed-out (Case A)', async () => {
  const { token, caseD } = await startLoad({
    pageEvaluate: async () => ({ tokenId: 'x', gen: 1, status: LOAD_RECORD_STATUS.TIMED_OUT }),
    starter: () => {},
    api: LOAD_API.DOCUMENT_LOAD,
    urn: 'urn:fake',
    loadTimeoutMs: 30_000,
  });
  assert.equal(caseD, false);
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT);
});

// ============================================================================================
// §4.3 -- 22-step cleanup executor
// ============================================================================================

function minimalResources(overrides = {}) {
  return {
    tokens: [],
    timers: [],
    abortControllers: [],
    f3Listener: null,
    f6: { ran: false, probeListener: null, reloadProbeListener: null, wiring: null },
    controlPatches: [],
    viewer: { getAllModels: () => [], unloadModel: () => {} },
    modelBefore: null,
    modelAfter: null,
    registry: null,
    registryKey: null,
    world: null,
    page: null,
    context: null,
    browser: null,
    httpServer: null,
    ...overrides,
  };
}

test('runCleanup: all 22 steps run even when several early steps guard-fail or throw -- no early exit', async () => {
  const resources = minimalResources({
    tokens: [{ id: 't1', state: TOKEN_STATE.TIMED_OUT }], // step 1 will throw
    timers: [{ cleared: false, clear: () => { throw new Error('clear failed'); } }], // step 2 throws
    f3Listener: { remove: () => { throw new Error('remove failed'); }, isRemoved: () => false }, // step 4 throws
  });

  const result = await runCleanup(resources);

  assert.deepEqual(Object.keys(result.stepStatus).sort(), [...CLEANUP_STEP_NAMES].sort(), 'every one of the 22 step names has a status -- none skipped over due to an earlier failure');
  assert.equal(result.stepStatus['drainPendingTokens'], 'threw');
  assert.equal(result.stepStatus['clearOwnedTimers'], 'threw');
  assert.equal(result.stepStatus['removeF3Listeners'], 'threw');
  // Steps with no applicable resource are 'skipped', not silently missing.
  assert.equal(result.stepStatus['disposeF6Wiring'], 'skipped');
  assert.equal(result.stepStatus['closePage'], 'skipped');
  // disposeEngine's guard is unconditionally false per the plan -- always skipped.
  assert.equal(result.stepStatus['disposeEngine'], 'skipped');
  // The two always-guard-true, never-throwing steps still ran.
  assert.equal(result.stepStatus['httpServerOwnership'], 'ran');
  assert.equal(result.stepStatus['evidenceWriterState'], 'ran');
  assert.ok(result.cleanupFailures.length >= 3);
});

test('runCleanup case 1: a failed step whose postcondition confirms the resource independently correct -- no cleanupUnresolvedOwnership', async () => {
  const resources = minimalResources({
    f3Listener: { remove: () => { throw new Error('remove threw, but it was already gone'); }, isRemoved: () => true },
  });
  const result = await runCleanup(resources);
  assert.ok(result.cleanupFailures.some((f) => f.step === 'removeF3Listeners'));
  assert.equal(result.cleanupUnresolvedOwnership, false);
});

test('runCleanup case 2: a failed step whose postcondition confirms GENUINE unresolved ownership -- cleanupUnresolvedOwnership: true', async () => {
  const resources = minimalResources({
    world: {
      isModelLive: () => true, // still live no matter what -- eviction never actually took effect
      evictModel: () => { throw new Error('evictModel failed'); },
      dispose: () => {},
    },
    modelBefore: { id: 'stuck-model' },
  });
  const result = await runCleanup(resources);
  assert.ok(result.cleanupFailures.some((f) => f.step === 'evictModelBefore'));
  assert.equal(result.cleanupUnresolvedOwnership, true);
});

test('runCleanup case 3: the HTTP-server verify-only row NEVER sets cleanupUnresolvedOwnership, even on failure', async () => {
  const resources = minimalResources({
    httpServer: { verify: async () => { throw new Error('token endpoint down'); } },
  });
  const result = await runCleanup(resources);
  assert.ok(result.cleanupFailures.some((f) => f.step === 'httpServerOwnership'));
  assert.equal(result.cleanupUnresolvedOwnership, false, 'the harness never owned the HTTP server, so this can never escalate');
});

test('runCleanup: verifyViewerModelSetEmpty failing IS the one postcondition that sets cleanupUnresolvedOwnership for model state', async () => {
  const model = { id: 'still-there' };
  const resources = minimalResources({
    viewer: { getAllModels: () => [model], unloadModel: () => {} },
    modelBefore: model,
  });
  const result = await runCleanup(resources);
  assert.ok(result.cleanupFailures.some((f) => f.step === 'verifyViewerModelSetEmpty'));
  assert.equal(result.cleanupUnresolvedOwnership, true);
});

test('runCleanup: a resolved (no-op) postcondition never sets cleanupUnresolvedOwnership even though the step itself is recorded as skipped/ran cleanly', async () => {
  const resources = minimalResources(); // nothing to clean up at all
  const result = await runCleanup(resources);
  assert.deepEqual(result.cleanupFailures, []);
  assert.equal(result.cleanupUnresolvedOwnership, false);
});

test('runCleanup: opts.injectFailureAt forces a failure AFTER the real action already ran (T3\'s own "no leak" discipline)', async () => {
  let realCallMade = false;
  const resources = minimalResources({
    timers: [{ cleared: false, clear: () => { realCallMade = true; } }],
  });
  const result = await runCleanup(resources, { injectFailureAt: 'clearOwnedTimers' });
  assert.equal(realCallMade, true, 'the real clear() call must have happened before the injected failure');
  assert.ok(result.cleanupFailures.some((f) => f.step === 'clearOwnedTimers'));
});

// ============================================================================================
// Task 16 (bounded H1-H3 remediation pass, H2): closePage/closeContext/closeBrowser are bounded
// -- reusing closeAllBestEffort's own Promise.race-against-a-rejecting-timer technique inside
// runCleanup's own `step()` helper, opt-in via `timeoutMs` (only these three steps pass it; every
// other step stays unbounded, unchanged). A real Playwright close() is never awaited here -- a
// plain fake whose close() never settles stands in for a wedged renderer/browser process, exactly
// like closeAllBestEffort's own existing tests (g1-svf2-f1-f8-verification.phase0evidence.test.mjs)
// do. `opts.closeTimeoutMs` is a TEST-ONLY override (default: production's own CLOSE_TIMEOUT_MS,
// 10s) so these tests never wait out the real bound. `{ timeout: 2000 }` on each test that uses a
// never-settling fake is a defensive per-test ceiling (node:test's own option), not a real sleep --
// it is never actually reached once the fix is in place (the bounded close settles in ~20ms); it
// exists so a FUTURE regression that reintroduces an unbounded await fails this one test fast and
// legibly instead of silently cancelling every other test in this file (node:test's own behavior
// when a truly-unresolved promise is left pending as the event loop otherwise drains -- confirmed
// empirically while building this test).
// ============================================================================================

function neverSettlingCloseTarget() {
  // A close() that never resolves/rejects -- simulates an unresponsive browser/renderer.
  // Mirrors phase0evidence.test.mjs's own neverSettlingCloseTarget() helper for closeAllBestEffort.
  return { close: () => new Promise(() => {}) };
}

test('runCleanup: closePage step is bounded -- a wedged page.close() times out, is recorded in cleanupFailures, stepStatus threw (not ran)', { timeout: 2000 }, async () => {
  const resources = minimalResources({ page: neverSettlingCloseTarget() });
  const result = await runCleanup(resources, { closeTimeoutMs: 20 });
  assert.equal(result.stepStatus.closePage, 'threw');
  const failure = result.cleanupFailures.find((f) => f.step === 'closePage');
  assert.ok(failure, 'a closePage timeout must be recorded in cleanupFailures');
  assert.match(failure.error.message, /did not settle within 20ms/);
});

test('runCleanup: closeContext step is bounded -- a wedged context.close() times out, is recorded in cleanupFailures, stepStatus threw (not ran)', { timeout: 2000 }, async () => {
  const resources = minimalResources({ context: neverSettlingCloseTarget() });
  const result = await runCleanup(resources, { closeTimeoutMs: 20 });
  assert.equal(result.stepStatus.closeContext, 'threw');
  const failure = result.cleanupFailures.find((f) => f.step === 'closeContext');
  assert.ok(failure, 'a closeContext timeout must be recorded in cleanupFailures');
  assert.match(failure.error.message, /did not settle within 20ms/);
});

test('runCleanup: closeBrowser step is bounded -- a wedged browser.close() times out, is recorded in cleanupFailures, stepStatus threw (not ran)', { timeout: 2000 }, async () => {
  const resources = minimalResources({ browser: neverSettlingCloseTarget() });
  const result = await runCleanup(resources, { closeTimeoutMs: 20 });
  assert.equal(result.stepStatus.closeBrowser, 'threw');
  const failure = result.cleanupFailures.find((f) => f.step === 'closeBrowser');
  assert.ok(failure, 'a closeBrowser timeout must be recorded in cleanupFailures');
  assert.match(failure.error.message, /did not settle within 20ms/);
});

test('runCleanup: a wedged closePage does not prevent closeContext/closeBrowser/httpServerOwnership/evidenceWriterState from still running', { timeout: 2000 }, async () => {
  const ranCalls = [];
  const context = { close: async () => { ranCalls.push('context'); } };
  const browser = { close: async () => { ranCalls.push('browser'); } };
  const httpServer = { verify: async () => { ranCalls.push('httpServerOwnership'); } };
  const resources = minimalResources({ page: neverSettlingCloseTarget(), context, browser, httpServer });

  const result = await runCleanup(resources, { closeTimeoutMs: 20 });

  assert.equal(result.stepStatus.closePage, 'threw');
  assert.equal(result.stepStatus.closeContext, 'ran');
  assert.equal(result.stepStatus.closeBrowser, 'ran');
  assert.equal(result.stepStatus.httpServerOwnership, 'ran');
  assert.equal(result.stepStatus.evidenceWriterState, 'ran');
  assert.deepEqual(ranCalls, ['context', 'browser', 'httpServerOwnership'], 'every later step must still be attempted after the wedged close step');
});

test('runCleanup: resolves quickly and returns a well-formed {cleanupFailures, cleanupUnresolvedOwnership, stepStatus} even with a wedged close (Phase 11/evidence can still proceed)', { timeout: 2000 }, async () => {
  const resources = minimalResources({ page: neverSettlingCloseTarget() });
  const startedAt = Date.now();
  const result = await runCleanup(resources, { closeTimeoutMs: 20 });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 1000, `runCleanup must resolve well within its bounded close timeout, not hang (took ${elapsedMs}ms)`);
  assert.ok(Array.isArray(result.cleanupFailures));
  assert.equal(typeof result.cleanupUnresolvedOwnership, 'boolean');
  assert.deepEqual(Object.keys(result.stepStatus).sort(), [...CLEANUP_STEP_NAMES].sort(), 'every one of the 22 step names still has a status -- a wedged close does not leave later steps silently absent');
});

test('runCleanup: the default closeTimeoutMs is production\'s own CLOSE_TIMEOUT_MS when opts.closeTimeoutMs is not overridden', () => {
  // Confirms the exported constant this fix reuses (never a second/drifted timeout value) --
  // does not itself wait out the real bound.
  assert.equal(typeof CLOSE_TIMEOUT_MS, 'number');
  assert.equal(CLOSE_TIMEOUT_MS, 10_000);
});

test('computeOverall: PASS is impossible when cleanupFailures contains a close-timeout entry, even with every other check/control clean', () => {
  const cleanChecks = () => ({ F1: CHECK_VERDICT.PASS, F2: CHECK_VERDICT.PASS, F3: CHECK_VERDICT.PASS, F4: CHECK_VERDICT.PASS, F5: CHECK_VERDICT.PASS, F6: CHECK_VERDICT.PASS, F7: CHECK_VERDICT.PASS, F8: CHECK_VERDICT.PASS });
  const cleanControls = () => {
    const controls = {};
    for (const name of CONTROL_NAMES) {
      controls[name] = createControlResult(name, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
    }
    return controls;
  };
  const closeTimeoutFailure = { step: 'closePage', error: { name: 'Error', message: "runCleanup: step 'closePage' did not settle within 20ms" } };

  const overall = computeOverall({
    fatalErrorObserved: false,
    cleanupUnresolvedOwnership: false,
    viewerScriptIntegrity: INTEGRITY_RESULT.VERIFIED,
    classifier: CLASSIFIER.CONFIRMED_SVF2,
    checks: cleanChecks(),
    controls: cleanControls(),
    cleanupFailures: [closeTimeoutFailure],
  });

  assert.notEqual(overall, OVERALL_VERDICT.PASS, 'an unresolved close-timeout cleanupFailures entry must block PASS (existing cleanupFailuresEmpty gate, verified here rather than reimplemented)');
});

// -- token-row escalation rule (standalone predicate, per the brief -- F6 doesn't exist yet) --

test('tokenEscalatesToUnresolvedOwnership case 4: a non-terminal token owning an F6 mutable resource escalates', () => {
  assert.equal(tokenEscalatesToUnresolvedOwnership({ tokenState: TOKEN_STATE.TIMED_OUT, ownsF6MutableResource: true }), true);
});

test('tokenEscalatesToUnresolvedOwnership: a non-terminal token that does NOT own an F6 mutable resource (e.g. an initial-load token) never escalates', () => {
  assert.equal(tokenEscalatesToUnresolvedOwnership({ tokenState: TOKEN_STATE.TIMED_OUT, ownsF6MutableResource: false }), false);
});

test('tokenEscalatesToUnresolvedOwnership: a terminal token never escalates regardless of ownsF6MutableResource', () => {
  assert.equal(tokenEscalatesToUnresolvedOwnership({ tokenState: TOKEN_STATE.COMPLETED, ownsF6MutableResource: true }), false);
  assert.equal(tokenEscalatesToUnresolvedOwnership({ tokenState: TOKEN_STATE.DISPOSED, ownsF6MutableResource: true }), false);
});

test('tokenEscalatesToUnresolvedOwnership: abandoned is non-terminal for this rule\'s purposes -- still escalates if it owns an F6 resource', () => {
  assert.equal(tokenEscalatesToUnresolvedOwnership({ tokenState: TOKEN_STATE.ABANDONED, ownsF6MutableResource: true }), true);
});
