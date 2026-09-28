// test/acceptance/g1-svf2-f1-f8-verification.stage8.test.mjs
//
// Offline, browser-free unit tests for Stage 8 (the final stage) of
// test/acceptance/g1-svf2-f1-f8-verification.mjs: `runHarness`'s full Phase 0-11 composition,
// `main()`'s activation interlock, and `validateResultSchema`. New sibling file (mirrors this
// repo's own established one-file-per-stage-concern convention).
//
// AUTHORIZATION BOUNDARY (stated even more strongly here, per this stage's own brief, since
// this is where it would be easiest to slip): this file NEVER launches a real Chromium browser,
// NEVER imports playwright, and NEVER calls `main()` or `runHarness` with real dependencies --
// EVERY test uses fakes, exactly like every prior stage. The ONE test that calls `main()`
// directly (the activation-interlock test, below) does so ONLY to prove the guard throws
// SYNCHRONOUSLY before any dynamic import/browser construction -- `main()` takes no parameters
// and constructs everything itself, so this is the only way to test the guard at all, and the
// brief's own required-tests list names exactly this test as the way to do it safely.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_VERDICT, CLASSIFIER, OVERALL_VERDICT, CONTROL_STATE, INTEGRITY_RESULT, CONTROL_NAMES,
  createControlResult, TOKEN_STATE, LOAD_API,
  observeF1, scoreF1, observeF2, scoreF2, observeF4, scoreF4, scoreF5, observeF7, scoreF7,
  observeF8, scoreF8, scoreF6, buildStaleOldModelEventControlResult,
  runHarness, validateResultSchema, main, runInPageResourceCleanup,
  walkRedirectRootUrl, buildCheckRecord, projectCheckVerdicts, EXPECTED_VIEWER_SHA256,
  classifyViewerScriptIntegrity,
} from './g1-svf2-f1-f8-verification.mjs';

const HARNESS_PATH = fileURLToPath(new URL('./g1-svf2-f1-f8-verification.mjs', import.meta.url));

// ============================================================================================
// Fixture builders -- a comprehensive, minimal-but-schema-valid "happy path" fake `deps`/
// `config` for `runHarness`, using the REAL scoring functions (scoreF1/scoreF2/.../scoreF8/
// scoreF6) against hand-built PASS-shaped fields, and the REAL observeF*/f6* function
// REFERENCES as pageEvaluate dispatch keys (by their own `.name`) -- never real Playwright,
// never a real page.
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
    f3ProbeSettledPredicate: () => true,
    f3FinalizeProbe: () => ({ ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 5, rejectionError: null }),
    observeF1: () => ({ ok: true, fields: { ownerMismatchCount: 0, unreachableCount: 0, populationCount: 1, rootsLength: 1, rootsCompared: 1, sizeMismatch: 0, ownersMismatch: 0, subtreeDigestMismatch: 0, populationDigestEqual: true, maxRootFragmentCount: 1, sumRootFragmentCount: 1, maxPerDbIdFragmentCount: 1 } }),
    observeF2: () => ({ ok: true, fields: { isObjectTreeCreated: true, treeReachableCount: 1, classL: 1, classN: 0, classU: 0, loadedButUnreachableCount: 0, fragListCount: 1, rootsLength: 1, accountingBalanced: true, maxChildrenPerNode: 0 } }),
    observeF4: () => ({ ok: true, fields: { libraryThrew: 0, libOwnerDiffersFromFragList: 0, droppedDiagnosticsCount: { 'geometry-id-undefined': 0, 'geometry-id-threw': 0 }, distinctGeometryCount: 1, renderProxyFailures: 0, geometryAdapterFailures: 0, geometriesWithNullIndex: 0, weldConsumerFailures: 0, weldConsumerSuccessCount: 1, maxActiveTriangleCount: 1, oversizedGeometryCount: 0 } }),
    observeF7: () => ({ ok: true, fields: { boundsAgreement: {}, unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true, placementNotInvertible: false, nonFiniteAxisDbIds: [] } }),
    observeF8: () => ({ ok: true, fields: { censusedRootCount: 1, censusedFragmentCount: 1, treeCheckedFragmentCount: 1, ownershipDivergenceCount: 0, treeDivergenceCount: 0, divergenceCount: 0, coverageEquationsClosed: true } }),
    // Fix wave (final whole-branch review, Important I3): sealLoadRecords/drainLoadToken are now
    // actually wired into runHarness's Phase 11 (steps 1a/1b), so this fake's pageEvaluate must
    // handle their own dispatched in-page function names too, exactly like every other handler
    // here -- their real in-page counterparts read/mutate `window.__g1`, which this fixture has
    // no fake `window` for, so the snapshot contents are unused by the (also new) callers: the
    // production `sealLoadRecords` return value is never read by `runHarness`, and no token in
    // this happy-path fixture is ever left TIMED_OUT (every startLoad fake below returns
    // `status: 'completed'`), so `readLoadRecordSnapshot` is never reached by the happy-path
    // tests in this file, but IS reached by any test that leaves a token TIMED_OUT.
    sealLoads: () => ({}),
    readLoadRecordSnapshot: () => ({ present: false }),
    runInPageResourceCleanup: () => ({ ok: true, stepStatus: { removeF3Listeners: 'ran' }, cleanupFailures: [], cleanupUnresolvedOwnership: false }),
    ...overrides,
  };
  return async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    tracker.record(`pageEvaluate:${name}`);
    if (!(name in handlers)) throw new Error(`buildHappyPageEvaluate: no fake handler for '${name}'`);
    return handlers[name](arg);
  };
}

function buildHappyDeps(tracker, overrides = {}) {
  const pageEvaluate = overrides.pageEvaluate || buildHappyPageEvaluate(tracker, overrides.pageEvaluateOverrides);
  const pageWaitForFunction = overrides.pageWaitForFunction || (async (fn, arg, opts) => {
    tracker.record(`pageWaitForFunction:${fn.name}`);
  });
  const loadStarter = {
    documentLoad: 'documentLoadStarter',
    loadDocumentNode: 'loadDocumentNodeStarter',
  };
  const fakePageEvaluateWithLoad = async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    if (name === 'documentLoadStarter' || name === 'loadDocumentNodeStarter') {
      tracker.record(`pageEvaluate:${name}`);
      return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    return pageEvaluate(fn, arg);
  };
  return {
    pageEvaluate: fakePageEvaluateWithLoad,
    pageWaitForFunction,
    loadStarter: { documentLoad: 'documentLoadStarter', loadDocumentNode: 'loadDocumentNodeStarter' },
    installF3Probe: () => fakePageEvaluateWithLoad({ name: 'f3InstallProbe' }, undefined),
    finalizeF3Probe: (arg) => fakePageEvaluateWithLoad({ name: 'f3FinalizeProbe' }, arg),
    setupSharedSessionResources: (tokenId) => fakePageEvaluateWithLoad({ name: 'setupSharedSessionResources' }, tokenId),
    controls: {
      treeUnavailable: async () => createControlResult('tree-unavailable', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      wrongOwner: async () => createControlResult('wrong-owner', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      lateCompletionAfterTimeout: async () => createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      hiddenFragment: async () => createControlResult('hidden-fragment', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      invalidGeometryConsumer: async () => createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      capacityBreach: async () => createControlResult('capacity-breach', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      invalidBounds: async () => createControlResult('invalid-bounds', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      boundsBeyondTolerance: async () => createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
    },
    f6Deps: {},
    nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => { tracker.record('captureViewerScriptIntegrity'); return { requestFailed: false, autodeskViewingDefined: true, attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e' }] }; },
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => { tracker.record('writeResultAtomically'); },
    ...overrides.depsOverrides,
  };
}

const HAPPY_CONFIG = {
  urn: 'fake-urn', loadTimeoutMs: 1000, unloadEventName: 'beforeModelUnload', addedEventName: 'modelAdded',
  viewerVersion: '7.124.2', chromium: 'x', node: process.version, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
};

// F6's own reload uses runF6UnloadReload internally, which itself calls startLoad AGAIN with
// loadStarter -- the happy pageEvaluate above already returns a completed snapshot for both
// starter names, so F6's own reload succeeds using the SAME fake, no separate wiring needed.
// F6 also needs captureModelFormatSignals (already handled) and its own in-page functions
// (f6InstallUnloadWiring etc.) -- add fakes for those too.
function withF6Handlers(overrides = {}) {
  return {
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
}

// ============================================================================================
// 1. Exact Phase 0-11 ordering; classifier non-CONFIRMED_SVF2 short-circuits before Phase 3.
// ============================================================================================

test('runHarness: full happy-path ordering -- F3 install before load, classifier before Phase 2.5, F1 before F2 before F4 before F5 before F7 before F8 before F6, cleanup and write happen last', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, { pageEvaluateOverrides: withF6Handlers() });
  const result = await runHarness(deps, HAPPY_CONFIG);

  const idx = (label) => tracker.order.indexOf(label);
  assert.ok(idx('pageEvaluate:f3InstallProbe') < idx('pageEvaluate:documentLoadStarter'), 'F3 install strictly before Document.load');
  assert.ok(idx('pageEvaluate:documentLoadStarter') < idx('pageEvaluate:loadDocumentNodeStarter'), 'Document.load before loadDocumentNode');
  assert.ok(idx('pageEvaluate:loadDocumentNodeStarter') < idx('pageEvaluate:captureModelFormatSignals'), 'load before classifier capture');
  assert.ok(idx('pageEvaluate:captureModelFormatSignals') < idx('pageEvaluate:setupSharedSessionResources'), 'classifier before Phase 2.5');
  assert.ok(idx('pageEvaluate:setupSharedSessionResources') < idx('pageEvaluate:observeF1'), 'Phase 2.5 before F1');
  assert.ok(idx('pageEvaluate:observeF1') < idx('pageEvaluate:observeF2'), 'F1 before F2');
  assert.ok(idx('pageEvaluate:observeF2') < idx('pageEvaluate:observeF4'), 'F2 before F4');
  assert.ok(idx('pageEvaluate:observeF4') < idx('pageEvaluate:observeF7'), 'F4 before F7 (F5 is pure, no pageEvaluate call)');
  assert.ok(idx('pageEvaluate:observeF7') < idx('pageEvaluate:observeF8'), 'F7 before F8');
  assert.ok(idx('pageEvaluate:observeF8') < idx('pageEvaluate:f6InstallUnloadWiring'), 'F8 before F6 (the only mutating check, runs last of all checks)');
  assert.ok(idx('captureViewerScriptIntegrity') < idx('writeResultAtomically'), 'integrity finalization before the atomic write');
  assert.ok(idx('writeResultAtomically') === tracker.order.length - 1, 'the atomic write is the LAST thing runHarness does');

  assert.equal(result.overall, OVERALL_VERDICT.PASS);
  // Fix wave (Important I4): checks.F* is now a full {verdict, reason, fields, evidence}
  // record -- read .verdict, never compare the record itself to a bare string.
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F6.verdict, CHECK_VERDICT.PASS);
});

test('runHarness: classifier CONFIRMED_NON_SVF2 short-circuits before Phase 2.5/F1 -- every check BLOCKED, every control NOT_EXECUTABLE, no F1-F8/F6 pageEvaluate call ever made', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: { captureModelFormatSignals: () => ({ ok: true, isOTG: false, isSVF2: false, captureErrors: [] }) },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_NON_SVF2);
  assert.ok(!tracker.order.includes('pageEvaluate:setupSharedSessionResources'), 'Phase 2.5 never attempted');
  assert.ok(!tracker.order.includes('pageEvaluate:observeF1'), 'F1 never attempted');
  for (const name of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']) {
    // Fix wave (Important I4): checks.F* is now a full record -- read .verdict.
    assert.equal(result.checks[name].verdict, CHECK_VERDICT.BLOCKED, `checks.${name}.verdict must be BLOCKED, never missing`);
    assert.equal(result.checks[name].evidence.blockedBy, 'classifier', `checks.${name}.evidence.blockedBy must name the classifier stop`);
  }
  for (const name of CONTROL_NAMES) {
    assert.ok(result.controls[name], `controls['${name}'] must be present, never missing`);
    assert.equal(result.controls[name].state, CONTROL_STATE.NOT_EXECUTABLE);
    assert.equal(result.controls[name].reason, 'classifier:CONFIRMED_NON_SVF2');
  }
  assert.equal(result.overall, OVERALL_VERDICT.BLOCKED);
});

// ============================================================================================
// 2. Every error/response listener is registered before navigation/load begins.
// ============================================================================================

test('main() bootstrap: page.on(pageerror/console/requestfailed) listeners and the init script are registered before any load call -- structural/source-order check', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxPageError = mainBody.indexOf(`page.on('pageerror'`);
  const idxConsole = mainBody.indexOf(`page.on('console'`);
  const idxRequestFailed = mainBody.indexOf(`page.on('requestfailed'`);
  const idxAddInitScript = mainBody.indexOf('page.addInitScript(');
  const idxRunHarness = mainBody.indexOf('await runHarness(');
  assert.ok(idxPageError > -1 && idxConsole > -1 && idxRequestFailed > -1 && idxAddInitScript > -1, 'all four listeners/init-script calls exist in main()');
  assert.ok(idxPageError < idxRunHarness && idxConsole < idxRunHarness && idxRequestFailed < idxRunHarness && idxAddInitScript < idxRunHarness,
    'every listener and the bootstrap init script are registered strictly before runHarness (and therefore before any load) is ever called');
});

// ============================================================================================
// Fix wave (final whole-branch review, Critical C1): main()'s own Phase 0 structural/source-
// order checks. codex-advisor's own finding (this fix wave): the ordering requirement that
// actually matters is relative to `page.goto` (addInitScript only takes effect on the NEXT
// navigation -- registering it after goto would never initialize the current document), and the
// prior test above (registration-before-runHarness) would not have caught that regression. This
// is a NEW, separate check, kept alongside the existing one above rather than replacing it.
// ============================================================================================

test('main() Phase 0 (C1): every page.on/page.route/addInitScript registration happens strictly before page.goto, and goto happens strictly before runHarness', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxGoto = mainBody.indexOf('await page.goto(');
  assert.ok(idxGoto > -1, 'main() must call page.goto');

  const registrationCalls = [
    `page.on('pageerror'`, `page.on('console'`, `page.on('requestfailed'`, `page.on('response'`,
    `context.route('**/clashtest/**'`, `context.route('**/clashpanel/**'`, 'page.route(`${BASE_URL}',
    'page.addInitScript(',
  ];
  for (const needle of registrationCalls) {
    const idx = mainBody.indexOf(needle);
    assert.ok(idx > -1, `main() must contain a registration call matching '${needle}'`);
    assert.ok(idx < idxGoto, `'${needle}' must be registered strictly BEFORE page.goto, never after (addInitScript only takes effect on the NEXT navigation)`);
  }

  const idxWaitForBootstrap = mainBody.indexOf('__g1Bootstrap');
  const idxInstallModules = mainBody.indexOf('installG1Modules');
  const idxRunHarness = mainBody.indexOf('await runHarness(');
  assert.ok(idxGoto < idxWaitForBootstrap, 'goto strictly before waiting on __g1Bootstrap.ready');
  assert.ok(idxWaitForBootstrap < idxInstallModules, 'bootstrap readiness strictly before installG1Modules');
  assert.ok(idxInstallModules < idxRunHarness, 'installG1Modules strictly before runHarness');
});

test('main() Phase 0 (C1): the config passed to runHarness uses the hardcoded MODEL_URN, never process.env.G1_F1_F8_URN', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  assert.ok(mainBody.includes('urn: MODEL_URN'), 'config.urn must be the hardcoded MODEL_URN constant');
  // Checks for the live CODE pattern only (never a comment mentioning the old name for
  // documentation purposes, which this fix wave's own explanatory comment legitimately does).
  assert.ok(!mainBody.includes('process.env.G1_F1_F8_URN'), 'the old process.env.G1_F1_F8_URN fallback must be fully removed from main()\'s live code');
});

test('main() Phase 0 (C1): captureViewerScriptIntegrity and runtimeEnvelope fields (viewerVersion/chromium) are actually passed into runHarness', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  assert.ok(mainBody.includes('captureViewerScriptIntegrity,'), 'captureViewerScriptIntegrity must be passed as a runHarness dep');
  assert.ok(mainBody.includes('viewerVersion: VIEWER_VERSION'), 'config.viewerVersion must be populated from the real pinned VIEWER_VERSION');
  assert.ok(mainBody.includes('chromium: browser.version()'), 'config.chromium must be populated from the real launched browser');
});

// ============================================================================================
// Fix wave (C1): walkRedirectRootUrl -- pure, offline-testable against fake Playwright Request-
// shaped objects (never a real Playwright Request).
// ============================================================================================

test('walkRedirectRootUrl: a request with no redirect history returns its own url', () => {
  const req = { url: () => 'https://example.test/viewer3D.js', redirectedFrom: () => null };
  assert.equal(walkRedirectRootUrl(req), 'https://example.test/viewer3D.js');
});

test('walkRedirectRootUrl: walks a multi-hop redirect chain back to the ORIGIN request\'s url, never an intermediate hop\'s', () => {
  const root = { url: () => 'https://example.test/viewer3D.js', redirectedFrom: () => null };
  const hop1 = { url: () => 'https://example.test/redirect1', redirectedFrom: () => root };
  const hop2 = { url: () => 'https://cdn.example.test/viewer3D.js', redirectedFrom: () => hop1 };
  assert.equal(walkRedirectRootUrl(hop2), 'https://example.test/viewer3D.js');
});

// ============================================================================================
// 3. Every failure path still reaches Phase 11 cleanup and the atomic evidence write.
// ============================================================================================

test('runHarness: a thrown Fi (observeF1 pageEvaluate rejects) still reaches cleanup and the atomic write -- never an early return past cleanup', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: {
      ...withF6Handlers(),
      observeF1: () => { throw new Error('simulated observeF1 crash'); },
    },
  });
  let result;
  await assert.doesNotReject(async () => { result = await runHarness(deps, HAPPY_CONFIG); }, 'runHarness itself must never throw -- a check failure is data, not a thrown exception out of runHarness');
  assert.ok(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), 'Phase 11 in-page cleanup still ran despite the F1 phase throwing');
  assert.ok(tracker.order.includes('writeResultAtomically'), 'the atomic write still happened');
  // Fix wave (Important I4): checks.F* is now a full record -- read .verdict.
  assert.equal(result.checks.F1.verdict, CHECK_VERDICT.BLOCKED, 'F1 itself is BLOCKED, never silently missing or falsely PASS');
  // Every LATER check the sequence never reached (F2 onward) is still present, fail-closed --
  // never a missing object (plan §8's own "no missing objects" discipline).
  for (const name of ['F2', 'F4', 'F5', 'F6', 'F7', 'F8']) {
    assert.equal(result.checks[name].verdict, CHECK_VERDICT.BLOCKED, `checks.${name}.verdict must be BLOCKED, never missing, since the sequence never reached it`);
  }
  assert.equal(result.overall, OVERALL_VERDICT.FAIL, 'fatalErrorObserved forces FAIL');
});

test('runHarness: control invocation throwing still reaches cleanup and the atomic write', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: withF6Handlers(),
    depsOverrides: {
      controls: {
        treeUnavailable: async () => { throw new Error('simulated control crash'); },
        wrongOwner: async () => createControlResult('wrong-owner', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        lateCompletionAfterTimeout: async () => createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        hiddenFragment: async () => createControlResult('hidden-fragment', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        invalidGeometryConsumer: async () => createControlResult('invalid-geometry-consumer', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        capacityBreach: async () => createControlResult('capacity-breach', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        invalidBounds: async () => createControlResult('invalid-bounds', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
        boundsBeyondTolerance: async () => createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      },
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);
  assert.equal(result.controls['tree-unavailable'].state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.ok(tracker.order.includes('writeResultAtomically'), 'the atomic write still happened despite the control throwing');
  assert.equal(result.overall, OVERALL_VERDICT.FAIL, 'a NOT_EXECUTABLE mandatory control fails the run, never silently passes');
});

test('runHarness: the in-page cleanup RPC itself throwing still reaches Node-side cleanup and the atomic write -- cleanupUnresolvedOwnership set (ownership unknown, codex-advisor finding)', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: {
      ...withF6Handlers(),
      runInPageResourceCleanup: () => { throw new Error('simulated page cleanup RPC crash'); },
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);
  assert.ok(tracker.order.includes('writeResultAtomically'), 'the atomic write still happened despite the page-cleanup RPC throwing');
  assert.equal(result.cleanupUnresolvedOwnership, true, 'a failed page-cleanup RPC leaves ownership unknown, never silently assumed clean');
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);
});

test('runHarness: Phase 2.5 setup failure still reaches cleanup and the atomic write, fatalErrorObserved true', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: { setupSharedSessionResources: () => ({ ok: false, sessionId: null, postconditions: null, error: { phase: 'world' } }) },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);
  assert.ok(tracker.order.includes('writeResultAtomically'));
  assert.equal(result.overall, OVERALL_VERDICT.FAIL);
});

// ============================================================================================
// 4. computeOverall only invoked AFTER viewerScriptIntegrity finalization AND cleanup complete.
// ============================================================================================

test('runHarness: overall verdict reflects viewerScriptIntegrity captured AFTER cleanup (a MISMATCH captured only post-cleanup still correctly fails the run)', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, { pageEvaluateOverrides: withF6Handlers() });
  deps.captureViewerScriptIntegrity = async () => {
    tracker.record('captureViewerScriptIntegrity');
    assert.ok(tracker.order.includes('pageEvaluate:runInPageResourceCleanup'), 'viewerScriptIntegrity capture must happen AFTER cleanup, per plan §8\'s own explicit ordering');
    return { requestFailed: false, autodeskViewingDefined: true, attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: 'wrong-hash-forces-mismatch' }] };
  };
  const result = await runHarness(deps, HAPPY_CONFIG);
  assert.equal(result.overall, OVERALL_VERDICT.FAIL, 'MISMATCH correctly fails the run even though it was only classified after cleanup');
});

// ============================================================================================
// 5. The activation guard genuinely prevents any Playwright-touching code from running.
// ============================================================================================

// Split so THIS file never matches the repo-wide `test/clashpanel/domIsolation.test.mjs` guard
// ("no *.test.mjs imports the automation package") -- it text-scans every `*.test.mjs` file for
// an import/require of that package by name, and this file legitimately needs to search the
// HARNESS file's own source text for exactly that same name (to prove the property below),
// which would otherwise trip that guard on itself despite never actually importing the package.
// Mirrors that same file's own documented split-string technique exactly.
const PKG = ['play', 'wright'].join('');

test('main(): activation guard throws SYNCHRONOUSLY, before any dynamic import of the automation package or browser construction, when the CLI flag and env var are both absent', async () => {
  const originalArgv = [...process.argv];
  const originalEnv = process.env.G1_F1_F8_LIVE_AUTHORIZED;
  process.argv = process.argv.filter((a) => a !== '--execute-live-f1-f8');
  delete process.env.G1_F1_F8_LIVE_AUTHORIZED;
  try {
    await assert.rejects(
      () => main(),
      (err) => {
        assert.match(err.message, /--execute-live-f1-f8/);
        assert.match(err.message, /G1_F1_F8_LIVE_AUTHORIZED=YES/);
        assert.match(err.message, /MECHANICAL SAFEGUARDS ONLY/);
        assert.match(err.message, /NOT proof of owner authorization/);
        assert.match(err.message, /docs\/prompts\/g1-f1-f8-harness-implementation-authorization\.md/);
        return true;
      },
    );
  } finally {
    process.argv = originalArgv;
    if (originalEnv === undefined) delete process.env.G1_F1_F8_LIVE_AUTHORIZED;
    else process.env.G1_F1_F8_LIVE_AUTHORIZED = originalEnv;
  }
});

test('main(): activation guard also throws when only ONE of the two conditions is present (flag without env, and env without flag)', async () => {
  // Fix wave (final whole-branch review, Minor M2): previously asserted only "it rejects" --
  // tightened to assert the EXACT underlying reason (parseLiveActivation's own reason enum),
  // so this test cannot pass against a guard that rejects for the wrong cause (e.g. some other,
  // unrelated exception being mistaken for the activation guard's own throw).
  const originalArgv = [...process.argv];
  const originalEnv = process.env.G1_F1_F8_LIVE_AUTHORIZED;
  try {
    process.argv = [...process.argv.filter((a) => a !== '--execute-live-f1-f8'), '--execute-live-f1-f8'];
    delete process.env.G1_F1_F8_LIVE_AUTHORIZED;
    await assert.rejects(
      () => main(),
      (err) => { assert.match(err.message, /\(env-missing\)$/, 'flag present, env absent -> reason must be exactly env-missing'); return true; },
    );

    process.argv = originalArgv.filter((a) => a !== '--execute-live-f1-f8');
    process.env.G1_F1_F8_LIVE_AUTHORIZED = 'YES';
    await assert.rejects(
      () => main(),
      (err) => { assert.match(err.message, /\(flag-missing\)$/, 'env present, flag absent -> reason must be exactly flag-missing'); return true; },
    );
  } finally {
    process.argv = originalArgv;
    if (originalEnv === undefined) delete process.env.G1_F1_F8_LIVE_AUTHORIZED;
    else process.env.G1_F1_F8_LIVE_AUTHORIZED = originalEnv;
  }
});

test('main(): no top-level static import of the automation package exists anywhere in the file; the ONLY reference is the dynamic import strictly after the activation-guard throw, inside main()', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const lines = source.split('\n');
  const topLevelImportLines = lines.filter((l) => /^\s*import\b/.test(l));
  assert.ok(topLevelImportLines.every((l) => !l.includes(PKG)), 'no top-level import statement may reference the automation package');

  const mainStart = source.indexOf('async function main()');
  const mainBody = source.slice(mainStart, source.indexOf('\nif (import.meta.url'));
  const guardThrowIdx = mainBody.indexOf('throw new Error(');
  const dynamicImportIdx = mainBody.indexOf(`await import('${PKG}')`);
  assert.ok(guardThrowIdx > -1 && dynamicImportIdx > -1, 'both the guard throw and the dynamic import must exist in main()');
  assert.ok(guardThrowIdx < dynamicImportIdx, 'the activation guard\'s throw statement must appear BEFORE the dynamic import in source order -- structurally unreachable otherwise');

  // Only count EXECUTABLE occurrences of the dynamic import, never lines that merely MENTION
  // the phrase in a `//` comment (this file's own doc comments reference the phrase several
  // times, e.g. in this function's own doc comment above).
  const codeLines = lines.filter((l) => !/^\s*\/\//.test(l));
  const dynamicImportMentions = codeLines.filter((l) => l.includes(`await import('${PKG}')`)).length;
  assert.equal(dynamicImportMentions, 1, 'exactly one executable dynamic import of the automation package in the whole file');
});

// ============================================================================================
// 6. Static check: the harness is absent from package.json scripts, the default test runner's
// discovered set doesn't execute it as a live script, and server.js is untouched.
// ============================================================================================

test('static: package.json has no script referencing g1-svf2-f1-f8-verification.mjs directly', async () => {
  const repoRoot = path.resolve(path.dirname(HARNESS_PATH), '../..');
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    assert.ok(!cmd.includes('g1-svf2-f1-f8-verification'), `script '${name}' must not reference the harness file: ${cmd}`);
  }
});

test('static: scripts/run-tests.mjs\'s discovery convention (*.test.mjs) never matches g1-svf2-f1-f8-verification.mjs itself (it does not end in .test.mjs)', () => {
  assert.equal(path.basename(HARNESS_PATH).endsWith('.test.mjs'), false);
  assert.equal(path.basename(HARNESS_PATH), 'g1-svf2-f1-f8-verification.mjs');
});

test('static: server.js does not import or reference the harness file', async () => {
  const repoRoot = path.resolve(path.dirname(HARNESS_PATH), '../..');
  const serverSource = await readFile(path.join(repoRoot, 'server.js'), 'utf8');
  assert.ok(!serverSource.includes('g1-svf2-f1-f8-verification'), 'server.js must never reference the harness file');
});

// ============================================================================================
// validateResultSchema -- a fully synthetic, fabricated-but-schema-valid result, plus a
// deliberately malformed variant for each major section.
// ============================================================================================

function fabricateValidResult() {
  const controls = {};
  for (const name of CONTROL_NAMES) {
    controls[name] = createControlResult(name, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  }
  return {
    script: 'g1-svf2-f1-f8-verification.mjs',
    harnessIntegrity: {
      path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'b'.repeat(40), gitStatusPorcelain: '',
      servedModuleManifest: { '/collision/index.js': 'c'.repeat(64) },
      remoteAssets: {
        // Fix wave (Important I4): expectedSha256/requestedUrl/capture now required.
        // `capture: null` (never ran) is schema-valid and skips the recompute-match check.
        viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED, reason: null, expectedSha256: EXPECTED_VIEWER_SHA256, requestedUrl: 'https://example.test/viewer3D.js', capture: null },
        viewerStyle: { identityGatesOverall: false },
        otherObservedRemoteAssets: [],
      },
    },
    runtimeEnvelope: { viewerVersion: '7.124.2', chromium: '120', node: process.version, modelUrn: 'urn:x', initializer: { env: 'AutodeskProduction2', api: 'streamingV2' } },
    classifier: CLASSIFIER.CONFIRMED_SVF2,
    runtime: { isOTG: true, isSVF2: true },
    // Fix wave (Important I4): full {verdict, reason, fields, evidence} records via the real
    // buildCheckRecord, never a bare verdict string.
    checks: Object.fromEntries(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].map((name) => [name, buildCheckRecord({ verdict: CHECK_VERDICT.PASS, fields: {}, evidence: { status: 'observed' } })])),
    controls,
    staleContinuationsDropped: [],
    errorLedger: { pageErrors: [], unhandledRejections: [], requiredResourceFailures: [], contextLoss: [], consoleErrors: [], consoleWarnings: [], allowListedFingerprints: [], fatalErrorObserved: false },
    cleanupFailures: [], cleanupUnresolvedOwnership: false,
    overall: OVERALL_VERDICT.PASS,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  };
}

test('validateResultSchema: a fully synthetic, fabricated-but-schema-valid result passes', () => {
  const { valid, errors } = validateResultSchema(fabricateValidResult());
  assert.deepEqual(errors, []);
  assert.equal(valid, true);
});

test('validateResultSchema: rejects a non-object result', () => {
  assert.equal(validateResultSchema(null).valid, false);
  assert.equal(validateResultSchema(undefined).valid, false);
  assert.equal(validateResultSchema('not-an-object').valid, false);
});

test('validateResultSchema: rejects malformed harnessIntegrity (bad sha256, missing servedModuleManifest, bad remoteAssets.viewerScript.integrityResult)', () => {
  const r1 = fabricateValidResult(); r1.harnessIntegrity.sha256 = 'not-hex';
  assert.equal(validateResultSchema(r1).valid, false);

  const r2 = fabricateValidResult(); delete r2.harnessIntegrity.servedModuleManifest;
  assert.equal(validateResultSchema(r2).valid, false);

  const r3 = fabricateValidResult(); r3.harnessIntegrity.remoteAssets.viewerScript.integrityResult = 'NOT_A_REAL_VALUE';
  assert.equal(validateResultSchema(r3).valid, false);

  const r4 = fabricateValidResult(); r4.harnessIntegrity.remoteAssets.viewerStyle.identityGatesOverall = true;
  assert.equal(validateResultSchema(r4).valid, false, 'identityGatesOverall must be exactly false, never true');
});

test('validateResultSchema: rejects malformed runtimeEnvelope (missing initializer)', () => {
  const r = fabricateValidResult(); delete r.runtimeEnvelope.initializer;
  assert.equal(validateResultSchema(r).valid, false);
});

test('validateResultSchema: rejects an out-of-enum classifier', () => {
  const r = fabricateValidResult(); r.classifier = 'NOT_A_REAL_CLASSIFIER';
  assert.equal(validateResultSchema(r).valid, false);
});

test('validateResultSchema: rejects a missing checks.F* entry (never a silently-absent object)', () => {
  const r = fabricateValidResult(); delete r.checks.F4;
  const { valid, errors } = validateResultSchema(r);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('checks.F4')));
});

test('validateResultSchema: rejects an out-of-enum checks.F* verdict', () => {
  const r = fabricateValidResult(); r.checks.F1 = 'NOT_A_REAL_VERDICT';
  assert.equal(validateResultSchema(r).valid, false);
});

// ============================================================================================
// Fix wave (final whole-branch review, Important I4): focused rejection tests for the tightened
// checks.F*/remoteAssets.viewerScript schema (codex-advisor's own explicit recommendation,
// medium, this fix wave: "add focused rejection tests for bare strings, missing record members,
// malformed attributable responses, and classification mismatch").
// ============================================================================================

test('validateResultSchema: rejects a bare verdict string in place of a checks.F* record (the exact pre-I4 shape)', () => {
  const r = fabricateValidResult(); r.checks.F3 = CHECK_VERDICT.PASS; // a valid ENUM value, but the wrong SHAPE
  const { valid, errors } = validateResultSchema(r);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('checks.F3') && e.includes('object')));
});

test('validateResultSchema: rejects a checks.F* record missing fields/evidence', () => {
  const r1 = fabricateValidResult(); delete r1.checks.F2.fields;
  assert.equal(validateResultSchema(r1).valid, false);

  const r2 = fabricateValidResult(); delete r2.checks.F2.evidence;
  assert.equal(validateResultSchema(r2).valid, false);

  const r3 = fabricateValidResult(); r3.checks.F2.evidence.status = 'not-a-real-status';
  assert.equal(validateResultSchema(r3).valid, false);

  const r4 = fabricateValidResult(); r4.checks.F2.evidence.blockedBy = 'not-a-real-reason';
  assert.equal(validateResultSchema(r4).valid, false);
});

test('validateResultSchema: rejects remoteAssets.viewerScript missing expectedSha256/requestedUrl', () => {
  const r1 = fabricateValidResult(); delete r1.harnessIntegrity.remoteAssets.viewerScript.expectedSha256;
  assert.equal(validateResultSchema(r1).valid, false);

  const r2 = fabricateValidResult(); r2.harnessIntegrity.remoteAssets.viewerScript.requestedUrl = '';
  assert.equal(validateResultSchema(r2).valid, false);
});

test('validateResultSchema: rejects remoteAssets.viewerScript whose recorded classification disagrees with recomputing classifyViewerScriptIntegrity from its own retained capture record', () => {
  const r = fabricateValidResult();
  // A genuinely VERIFIED capture record (recomputes to VERIFIED/null) -- confirms the HAPPY
  // path (a real, non-null capture that DOES match) is itself schema-valid first.
  const verifiedCapture = {
    requestFailed: false, autodeskViewingDefined: true,
    attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: EXPECTED_VIEWER_SHA256 }],
  };
  r.harnessIntegrity.remoteAssets.viewerScript.capture = verifiedCapture;
  assert.equal(validateResultSchema(r).valid, true, 'a real capture record that DOES match its own recorded classification must still pass');
  assert.deepEqual(classifyViewerScriptIntegrity(verifiedCapture), { integrityResult: r.harnessIntegrity.remoteAssets.viewerScript.integrityResult, reason: r.harnessIntegrity.remoteAssets.viewerScript.reason });

  // Now corrupt ONLY the recorded integrityResult, leaving the retained capture record
  // (evidence of what actually happened) untouched -- this is exactly the class of defect the
  // recompute check exists to catch: a run whose PERSISTED verdict silently disagrees with its
  // own retained evidence.
  const r2 = fabricateValidResult();
  r2.harnessIntegrity.remoteAssets.viewerScript.capture = verifiedCapture;
  r2.harnessIntegrity.remoteAssets.viewerScript.integrityResult = INTEGRITY_RESULT.MISMATCH;
  const { valid, errors } = validateResultSchema(r2);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('disagrees with recomputing')));
});

test('validateResultSchema: rejects a non-null, non-object remoteAssets.viewerScript.capture', () => {
  const r = fabricateValidResult(); r.harnessIntegrity.remoteAssets.viewerScript.capture = 'not-an-object';
  assert.equal(validateResultSchema(r).valid, false);
});

test('validateResultSchema: rejects a missing controls.* entry, and one whose restorationRequired disagrees with Stage 1\'s own fixed classification (via validateControlResult, never re-implemented here)', () => {
  const r1 = fabricateValidResult(); delete r1.controls['wrong-owner'];
  const { valid: v1, errors: e1 } = validateResultSchema(r1);
  assert.equal(v1, false);
  assert.ok(e1.some((e) => e.includes("controls.wrong-owner")));

  const r2 = fabricateValidResult();
  r2.controls['invalid-geometry-consumer'] = { ...r2.controls['invalid-geometry-consumer'], restorationRequired: true }; // real value is false
  assert.equal(validateResultSchema(r2).valid, false);
});

test('validateResultSchema: rejects malformed errorLedger/cleanupFailures/overall', () => {
  const r1 = fabricateValidResult(); r1.errorLedger.pageErrors = 'not-an-array';
  assert.equal(validateResultSchema(r1).valid, false);

  const r2 = fabricateValidResult(); r2.cleanupFailures = null;
  assert.equal(validateResultSchema(r2).valid, false);

  const r3 = fabricateValidResult(); r3.overall = 'NOT_A_REAL_OVERALL';
  assert.equal(validateResultSchema(r3).valid, false);

  const r4 = fabricateValidResult(); r4.cleanupUnresolvedOwnership = 'yes';
  assert.equal(validateResultSchema(r4).valid, false);
});

test('validateResultSchema: rejects missing startedAt/finishedAt', () => {
  const r = fabricateValidResult(); delete r.startedAt;
  assert.equal(validateResultSchema(r).valid, false);
});

// ============================================================================================
// Fix round 1 (Stage 8 review): direct node:vm-reconstructed tests of `runInPageResourceCleanup`
// itself -- CRITICAL finding: every `runHarness`-level test above fakes this whole dependency
// out (a canned stand-in, never the real function), which is exactly why the Critical bug
// (`verifyViewerModelSetEmpty`'s `checkOwnership: () => true` unconditionally forcing
// `cleanupUnresolvedOwnership = true` on every run, making PASS structurally unreachable) went
// uncaught. These tests exercise the REAL, production `runInPageResourceCleanup` reconstructed
// from its own source text via `node:vm` -- the same rigor every other in-page function in this
// file already has (observeF1/observeF4/f6InstallUnloadWiring/etc.'s own test files), which this
// one specifically lacked until now.
// ============================================================================================

const CLEANUP_IN_PAGE_FUNCTIONS = { runInPageResourceCleanup };

function createCleanupPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(CLEANUP_IN_PAGE_FUNCTIONS)) {
    vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  }
  return {
    window: initialWindow,
    call(fn, ...args) { return vm.runInContext(fn.name, context)(...args); },
  };
}

function fakeCleanupWorld(overrides = {}) {
  return { isModelLive: () => false, evictModel: () => {}, dispose: () => {}, ...overrides };
}

function fakeCleanupRegistry(overrides = {}) {
  return { bindingFor: () => null, unregister: () => {}, ...overrides };
}

test('runInPageResourceCleanup: session-not-found -- every step skipped/not-applicable, no throw, cleanupUnresolvedOwnership false', async () => {
  const realm = createCleanupPageRealm({ __g1: { sessions: {} }, __viewer: { getAllModels: () => [] } });
  const result = await realm.call(runInPageResourceCleanup, { sessionId: 'missing' });
  assert.equal(result.ok, true);
  assert.equal(result.cleanupUnresolvedOwnership, false);
  assert.equal(result.cleanupFailures.length, 0); // cross-realm array -- length check, not deepEqual (this file's own documented gotcha)
  assert.equal(result.stepStatus.verifyViewerModelSetEmpty, 'skipped');
  assert.equal(result.stepStatus.restoreAllControlPatches, 'not-applicable-this-stage');
});

test('runInPageResourceCleanup: THE CRITICAL REGRESSION -- healthy teardown (empty model set, no live model, null binding) -> cleanupUnresolvedOwnership MUST be false, not unconditionally true', async () => {
  const modelBefore = { name: 'before' };
  const viewer = { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  const world = fakeCleanupWorld({ isModelLive: () => false });
  const registry = fakeCleanupRegistry({ bindingFor: () => null });
  const session = { world, registry, model: modelBefore, K: 'K1', f6: null };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.ok, true);
  assert.equal(result.cleanupFailures.length, 0); // cross-realm array -- length check, not deepEqual (this file's own documented gotcha)
  assert.equal(result.stepStatus.verifyViewerModelSetEmpty, 'ran', 'the postcondition check itself succeeds (no throw)');
  // This is the exact assertion that would have FAILED before the fix round: the old
  // `checkOwnership: () => true` fired unconditionally on this SUCCESSFUL 'ran' outcome too
  // (this function's own step() helper calls checkOwnership on both 'ran' and 'threw'), forcing
  // cleanupUnresolvedOwnership = true even for a fully healthy teardown.
  assert.equal(result.cleanupUnresolvedOwnership, false, 'a healthy teardown must never force cleanupUnresolvedOwnership -- this is THE Critical fix-round regression test');
});

test('runInPageResourceCleanup: a genuinely still-live model (viewer.getAllModels() still contains modelBefore after the unload attempt) -> verifyViewerModelSetEmpty threw AND cleanupUnresolvedOwnership true', async () => {
  const modelBefore = { name: 'before' };
  // unloadModel() is a deliberate no-op -- simulates a real-world failure where the Viewer's own
  // unload call did not actually remove the model from getAllModels().
  const viewer = { getAllModels: () => [modelBefore], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  const world = fakeCleanupWorld({ isModelLive: () => true });
  const registry = fakeCleanupRegistry({ bindingFor: () => ({ model: modelBefore }) });
  const session = { world, registry, model: modelBefore, K: 'K1', f6: null };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.verifyViewerModelSetEmpty, 'threw');
  assert.ok(result.cleanupFailures.some((f) => f.step === 'verifyViewerModelSetEmpty'));
  assert.equal(result.cleanupUnresolvedOwnership, true, 'a genuinely still-live model must set cleanupUnresolvedOwnership true');
});

test('runInPageResourceCleanup: unregisterModelBefore/evictModelBefore run when resources are present, and their own checkOwnership correctly reflects a genuinely-still-bound/still-live postcondition', async () => {
  const modelBefore = { name: 'before' };
  const viewer = { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  // unregister()/evictModel() are deliberate no-ops -- the binding/liveness postcondition stays
  // unresolved after the action "ran", proving checkOwnership genuinely RE-READS live state
  // rather than trusting the action's own reported completion.
  const world = fakeCleanupWorld({ isModelLive: () => true, evictModel: () => {} });
  const registry = fakeCleanupRegistry({ bindingFor: () => ({ model: modelBefore }), unregister: () => {} });
  const session = { world, registry, model: modelBefore, K: 'K1', f6: null };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.unregisterModelBefore, 'ran');
  assert.equal(result.stepStatus.evictModelBefore, 'ran');
  assert.ok(result.cleanupUnresolvedOwnership, 'unregister/evict "ran" but left the binding/liveness postcondition genuinely unresolved');
});

test('runInPageResourceCleanup: disposeWorld/unloadModelBeforeFromViewer are skipped when their own guard resources are absent (no world, model already gone)', async () => {
  const viewer = { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  const session = { world: null, registry: null, model: null, K: 'K1', f6: null };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.disposeWorld, 'skipped');
  assert.equal(result.stepStatus.unloadModelBeforeFromViewer, 'skipped');
  assert.equal(result.stepStatus.unregisterModelBefore, 'skipped');
  assert.equal(result.stepStatus.evictModelBefore, 'skipped');
  assert.equal(result.cleanupUnresolvedOwnership, false);
});

test('runInPageResourceCleanup: F6 fallback steps (probe/reload-probe listener removal, wiring disposal) run when never previously removed/disposed, and correctly report their own outcome', async () => {
  const modelBefore = { name: 'before' };
  const modelAfter = { name: 'after' };
  const probeFn = () => {};
  const reloadFn = () => {};
  let probeRemoved = false;
  let reloadRemoved = false;
  const viewer = {
    getAllModels: () => [],
    unloadModel: () => {},
    addEventListener() {},
    removeEventListener: (eventName, fn) => {
      if (fn === probeFn) probeRemoved = true;
      if (fn === reloadFn) reloadRemoved = true;
    },
  };
  const world = fakeCleanupWorld({ isModelLive: () => false });
  const registry = fakeCleanupRegistry({ bindingFor: () => null });
  const f6 = {
    modelAfter,
    probeListener: { eventName: 'beforeModelUnload', fn: probeFn, removed: false },
    reloadProbe: { addedEventName: 'modelAdded', listener: reloadFn, removed: false },
    wiringRef: { disposed: false },
  };
  f6.dispose = () => { f6.wiringRef.disposed = true; };
  const session = { world, registry, model: modelBefore, K: 'K1', f6 };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.removeF6ProbeListener, 'ran');
  assert.equal(result.stepStatus.removeF6ReloadProbeListener, 'ran');
  assert.equal(result.stepStatus.disposeF6Wiring, 'ran');
  assert.equal(probeRemoved, true);
  assert.equal(reloadRemoved, true);
  assert.equal(f6.wiringRef.disposed, true);
  assert.equal(result.cleanupUnresolvedOwnership, false, 'F6 fallback steps that genuinely succeeded must not force unresolved ownership');
});

test('runInPageResourceCleanup: F6 fallback steps are skipped when already removed/disposed (F6\'s own step 9 already ran normally)', async () => {
  const modelBefore = { name: 'before' };
  const modelAfter = { name: 'after' };
  const viewer = { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  const world = fakeCleanupWorld({ isModelLive: () => false });
  const registry = fakeCleanupRegistry({ bindingFor: () => null });
  const f6 = {
    modelAfter,
    probeListener: { eventName: 'beforeModelUnload', fn: () => {}, removed: true },
    reloadProbe: { addedEventName: 'modelAdded', listener: () => {}, removed: true },
    wiringRef: { disposed: true },
    dispose: () => { throw new Error('should never be called -- already disposed'); },
  };
  const session = { world, registry, model: modelBefore, K: 'K1', f6 };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.removeF6ProbeListener, 'skipped');
  assert.equal(result.stepStatus.removeF6ReloadProbeListener, 'skipped');
  assert.equal(result.stepStatus.disposeF6Wiring, 'skipped');
  assert.equal(result.cleanupUnresolvedOwnership, false);
});

test('runInPageResourceCleanup: F3 listener fallback removal (session-independent -- installed before any session exists)', async () => {
  const listenerFn = () => {};
  let removed = false;
  const viewer = {
    getAllModels: () => [],
    unloadModel: () => {},
    addEventListener() {},
    removeEventListener: (name, fn) => { if (fn === listenerFn) removed = true; },
  };
  const g = { f3Probe: { addedEventName: 'modelAdded', listener: listenerFn, removed: false } };
  const realm = createCleanupPageRealm({ __g1: g, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 'missing' });

  assert.equal(result.stepStatus.removeF3Listeners, 'ran');
  assert.equal(removed, true);
  assert.equal(g.f3Probe.removed, true);
});

test('runInPageResourceCleanup: an unloadModelAfterFromViewer/unregisterModelAfter/evictModelAfter step only runs when F6 actually ran (f6.modelAfter present)', async () => {
  const modelBefore = { name: 'before' };
  const viewer = { getAllModels: () => [], unloadModel: () => {}, addEventListener() {}, removeEventListener() {} };
  const world = fakeCleanupWorld({ isModelLive: () => false });
  const registry = fakeCleanupRegistry({ bindingFor: () => null });
  // f6 exists but never reached re-registration (modelAfter still null) -- f6Ran must be false.
  const session = { world, registry, model: modelBefore, K: 'K1', f6: { modelAfter: null } };
  const realm = createCleanupPageRealm({ __g1: { sessions: { s1: session } }, __viewer: viewer });

  const result = await realm.call(runInPageResourceCleanup, { sessionId: 's1' });

  assert.equal(result.stepStatus.unloadModelAfterFromViewer, 'skipped');
  assert.equal(result.stepStatus.unregisterModelAfter, 'skipped');
  assert.equal(result.stepStatus.evictModelAfter, 'skipped');
});

// ============================================================================================
// Fix round 1 (Stage 8 review): mergedStepStatus regression -- Important finding. Page-cleanup's
// own real per-step results must be authoritative over Node-side runCleanup's own vacuous
// 'skipped' results for the same 12 step names, never silently overwritten by spread order.
// ============================================================================================

test('runHarness: mergedStepStatus -- a page-owned step\'s real \'ran\' status survives the merge, never silently overwritten by Node\'s own vacuous \'skipped\'', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: {
      ...withF6Handlers(),
      runInPageResourceCleanup: () => ({
        ok: true,
        stepStatus: {
          removeF3Listeners: 'ran', unregisterModelBefore: 'ran', evictModelBefore: 'ran',
          disposeWorld: 'ran', verifyViewerModelSetEmpty: 'ran',
        },
        cleanupFailures: [], cleanupUnresolvedOwnership: false,
      }),
    },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  // Node's own runCleanup call (nodeOnlyResources, no registry/world/viewer/modelBefore) always
  // reports 'skipped' for these same 12 step names -- before the fix, its spread came SECOND and
  // silently overwrote the page-cleanup's own real 'ran' results.
  assert.equal(result.cleanupStepStatus.unregisterModelBefore, 'ran', 'the REAL in-page result must win the merge');
  assert.equal(result.cleanupStepStatus.evictModelBefore, 'ran');
  assert.equal(result.cleanupStepStatus.disposeWorld, 'ran');
  assert.equal(result.cleanupStepStatus.verifyViewerModelSetEmpty, 'ran');
  assert.equal(result.cleanupStepStatus.removeF3Listeners, 'ran');
});

// ============================================================================================
// Fix wave (final whole-branch review, Important I3/I5): a genuine wiring test proving
// sealLoadRecords (step 1a) and drainLoadToken (step 1b) are actually called during Phase 11,
// with the REAL argument shapes (`sealLoads` receiving the bare claimed-tokenIds array,
// `readLoadRecordSnapshot` receiving the bare tokenId string) -- never a fake that smooths over
// a shape mismatch the way async.test.mjs's OLD fakes did (see that file's own fix-wave
// comments). This is the same class of test-methodology fix already applied for I2: the
// assertions below would fail if either call site regressed back to the `{claimed: ...}` /
// `{tokenId: ...}` wrapper this fix wave removed from production code, or if the drain loop's
// per-token gen/predicate wiring were ever silently dropped.
// ============================================================================================

test('runHarness Phase 11 wiring (I3): sealLoadRecords and drainLoadToken are actually called, with the real bare-array/bare-string argument shapes, and a drained token is excluded from staleContinuationsDropped', async () => {
  const tracker = callOrderTracker();
  const starterTokenIds = {};
  let sealLoadsCall = null;
  let readRecordCall = null;
  let waitForDrainPredicateCall = null;

  const pageEvaluate = async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    tracker.record(`pageEvaluate:${name}`);
    if (name === 'documentLoadStarter') {
      starterTokenIds.documentLoad = arg.tokenId;
      return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    if (name === 'loadDocumentNodeStarter') {
      starterTokenIds.loadDocumentNode = arg.tokenId;
      // Deliberately times out -- this is the token Phase 11 must drain. Its Node-side token
      // never reaches COMPLETED, so classifierConfirmed stays false and the run short-circuits
      // straight to Phase 11 (the classifier-stop branch), keeping this fixture minimal.
      return { present: true, gen: 2, status: 'timed-out', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    if (name === 'sealLoads') {
      sealLoadsCall = arg; // must be the BARE claimed-tokenIds array (fix wave, I3) -- never {claimed: [...]}
      return {};
    }
    if (name === 'readLoadRecordSnapshot') {
      readRecordCall = arg; // must be the BARE tokenId string (fix wave, I3) -- never {tokenId: ...}
      return { present: true, gen: 2, status: 'late-unloaded', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
    }
    if (name === 'runInPageResourceCleanup') {
      return { ok: true, stepStatus: { removeF3Listeners: 'ran' }, cleanupFailures: [], cleanupUnresolvedOwnership: false };
    }
    throw new Error(`unexpected pageEvaluate call for this test: '${name}'`);
  };
  const pageWaitForFunction = async (fn, arg, opts) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    tracker.record(`pageWaitForFunction:${name}`);
    if (name === 'f11DrainOwnershipCleanPredicate') {
      waitForDrainPredicateCall = arg; // must carry {tokenId, gen} matching the drained token
      return;
    }
    throw new Error(`unexpected pageWaitForFunction call for this test: '${name}'`);
  };

  const deps = {
    pageEvaluate, pageWaitForFunction,
    loadStarter: { documentLoad: 'documentLoadStarter', loadDocumentNode: 'loadDocumentNodeStarter' },
    installF3Probe: () => pageEvaluate({ name: 'f3InstallProbe' }, undefined).catch(() => {}),
    finalizeF3Probe: async () => ({ ok: true }),
    setupSharedSessionResources: async () => ({ ok: false }),
    controls: {},
    f6Deps: {}, nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [] }),
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => {},
  };
  // installF3Probe above deliberately swallows its own "no handler" case (f3InstallProbe is
  // never registered in this minimal fixture's pageEvaluate) since it is called unconditionally
  // at Phase 1, strictly before this test's actual concern (Phase 11) -- everything this test
  // asserts on happens after that point regardless of its outcome.
  deps.installF3Probe = async () => {};

  const result = await runHarness(deps, HAPPY_CONFIG);

  assert.ok(tracker.order.includes('pageEvaluate:sealLoads'), 'sealLoadRecords (step 1a) must actually be called');
  assert.ok(tracker.order.includes('pageEvaluate:readLoadRecordSnapshot'), 'drainLoadToken (step 1b) must actually be called');
  assert.ok(tracker.order.indexOf('pageEvaluate:sealLoads') < tracker.order.indexOf('pageEvaluate:readLoadRecordSnapshot'), 'seal (1a) strictly before drain (1b)');
  assert.ok(tracker.order.indexOf('pageEvaluate:sealLoads') < tracker.order.indexOf('pageEvaluate:runInPageResourceCleanup'), 'seal+drain (1a/1b) strictly before the rest of cleanup');

  assert.ok(Array.isArray(sealLoadsCall), 'sealLoads must receive the bare claimed-tokenIds ARRAY directly, never a {claimed: ...} wrapper');
  assert.deepEqual(sealLoadsCall, [starterTokenIds.documentLoad], 'only the COMPLETED documentLoad token is claimed -- the timed-out loadDocumentNode token is not');

  assert.equal(typeof readRecordCall, 'string', 'readLoadRecordSnapshot must receive the bare tokenId STRING directly, never a {tokenId: ...} wrapper');
  assert.equal(readRecordCall, starterTokenIds.loadDocumentNode, 'the token actually drained must be the one left timed-out');

  assert.ok(waitForDrainPredicateCall, 'drainLoadToken must wait on f11DrainOwnershipCleanPredicate');
  assert.equal(waitForDrainPredicateCall.tokenId, starterTokenIds.loadDocumentNode);
  assert.equal(waitForDrainPredicateCall.gen, 2, 'the predicate must be given the SAME gen startLoad recorded for this token, not null/undefined');

  const droppedIds = result.staleContinuationsDropped.map((d) => d.tokenId);
  assert.ok(!droppedIds.includes(starterTokenIds.loadDocumentNode), 'a successfully drained (disposed) token must never show up in staleContinuationsDropped');
});

// ============================================================================================
// Fix wave (self-check during this same fix wave): step 20a's escalation loop must apply
// tokenEscalatesToUnresolvedOwnership to a token that became ABANDONED (realm successfully
// destroyed), not only one still TIMED_OUT -- an earlier version of the fix only checked
// finalizeLoadTokens' own `stillTimedOut` list, silently skipping the ordinary (realm-destroyed)
// case entirely. This test drives a real F6 reload token to TIMED_OUT (its own drain genuinely
// times out), confirms page/context/browser all close successfully (so finalizeLoadTokens moves
// it to ABANDONED, not leaving it TIMED_OUT), and asserts cleanupUnresolvedOwnership is still
// set and overall is FAIL -- proving escalation fired for the ABANDONED case specifically.
// ============================================================================================

test('runHarness Phase 11 step 20a: an ABANDONED F6 token (realm destroyed, drain never completed) still escalates cleanupUnresolvedOwnership -- not only a still-TIMED_OUT one', async () => {
  let loadDocumentNodeCallCount = 0;
  const pageEvaluate = async (fn, arg) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    switch (name) {
      case 'f3InstallProbe': return { ok: true };
      case 'f3FinalizeProbe': return { ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 5, rejectionError: null };
      case 'documentLoadStarter':
        return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
      case 'loadDocumentNodeStarter': {
        loadDocumentNodeCallCount += 1;
        // 1st call: the initial Phase 2 load -- completes normally. 2nd call: F6's own reload --
        // deliberately times out, leaving its own Node-side token TIMED_OUT going into Phase 11.
        if (loadDocumentNodeCallCount === 1) {
          return { present: true, gen: 1, status: 'completed', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
        }
        return { present: true, gen: 2, status: 'timed-out', transitions: [], handlerErrors: [], lateModelsStillPresent: false };
      }
      case 'captureModelFormatSignals': return { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };
      case 'setupSharedSessionResources': return { ok: true, sessionId: 's1', postconditions: { registryWorldMatches: true, bindingModelMatches: true, worldModelIsLive: true }, error: null };
      case 'observeF1': return { ok: true, fields: { ownerMismatchCount: 0, unreachableCount: 0, populationCount: 1, rootsLength: 1, rootsCompared: 1, sizeMismatch: 0, ownersMismatch: 0, subtreeDigestMismatch: 0, populationDigestEqual: true, maxRootFragmentCount: 1, sumRootFragmentCount: 1, maxPerDbIdFragmentCount: 1 } };
      case 'observeF2': return { ok: true, fields: { isObjectTreeCreated: true, treeReachableCount: 1, classL: 1, classN: 0, classU: 0, loadedButUnreachableCount: 0, fragListCount: 1, rootsLength: 1, accountingBalanced: true, maxChildrenPerNode: 0 } };
      case 'observeF4': return { ok: true, fields: { libraryThrew: 0, libOwnerDiffersFromFragList: 0, droppedDiagnosticsCount: { 'geometry-id-undefined': 0, 'geometry-id-threw': 0 }, distinctGeometryCount: 1, renderProxyFailures: 0, geometryAdapterFailures: 0, geometriesWithNullIndex: 0, weldConsumerFailures: 0, weldConsumerSuccessCount: 1, maxActiveTriangleCount: 1, oversizedGeometryCount: 0 } };
      case 'observeF7': return { ok: true, fields: { boundsAgreement: {}, unitScalePlausible: true, unitStringPlausible: true, hiddenNodesPlausible: true, placementNotInvertible: false, nonFiniteAxisDbIds: [] } };
      case 'observeF8': return { ok: true, fields: { censusedRootCount: 1, censusedFragmentCount: 1, treeCheckedFragmentCount: 1, ownershipDivergenceCount: 0, treeDivergenceCount: 0, divergenceCount: 0, coverageEquationsClosed: true } };
      case 'f6InstallUnloadWiring': return { ok: true };
      case 'f6TriggerUnload': return { ok: true };
      case 'f6UnloadSettledPredicate': return true;
      case 'f6ReadUnloadSnapshot': return { ok: true, unloadProbeFired: true, unloadEventModelMatchesModelBefore: true, unregisterBeforeEvict: true, bindingNullAfterUnload: true };
      case 'f6InstallReloadProbe': return { ok: true };
      case 'f6ReloadProbeSettledPredicate': return true;
      case 'f6FinalizeReloadProbe': return { ok: true, modelAddedObserved: true, tModelAdded: 1, atInvocation: {}, resolveRootsOutcome: 'resolved', atSettlement: {}, elapsedMs: 1, rejectionError: null, modelMatchesReloadToken: true };
      case 'f6Cleanup': return { ok: true, disposed: true, probeRemoved: true, wiringDisposed: true };
      case 'sealLoads': return {};
      case 'runInPageResourceCleanup': return { ok: true, stepStatus: { removeF3Listeners: 'ran' }, cleanupFailures: [], cleanupUnresolvedOwnership: false };
      default:
        throw new Error(`unexpected pageEvaluate call for this test: '${name}'`);
    }
  };
  const pageWaitForFunction = async (fn, arg, opts) => {
    const name = typeof fn === 'string' ? fn : fn.name;
    if (name === 'f11DrainOwnershipCleanPredicate' && arg && arg.gen === 2) {
      // The F6 reload's own token (gen 2) never drains -- a genuine, realistic drain timeout.
      throw new Error('simulated drain timeout');
    }
    return undefined; // every other predicate (f3ProbeSettledPredicate, f6*SettledPredicate, and the gen-1 drain) settles immediately
  };

  const deps = {
    pageEvaluate, pageWaitForFunction,
    loadStarter: { documentLoad: 'documentLoadStarter', loadDocumentNode: 'loadDocumentNodeStarter' },
    installF3Probe: () => pageEvaluate({ name: 'f3InstallProbe' }, undefined),
    finalizeF3Probe: (arg) => pageEvaluate({ name: 'f3FinalizeProbe' }, arg),
    setupSharedSessionResources: (tokenId) => pageEvaluate({ name: 'setupSharedSessionResources' }, tokenId),
    controls: {
      treeUnavailable: async () => createControlResult('tree-unavailable', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      wrongOwner: async () => createControlResult('wrong-owner', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      hiddenFragment: async () => createControlResult('hidden-fragment', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      capacityBreach: async () => createControlResult('capacity-breach', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      invalidBounds: async () => createControlResult('invalid-bounds', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
      boundsBeyondTolerance: async () => createControlResult('bounds-beyond-tolerance', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true }),
    },
    f6Deps: {},
    // Real close() fakes -- all three succeed, so finalizeLoadTokens sees the realm as
    // confirmed destroyed and moves the still-TIMED_OUT F6 reload token to ABANDONED, never
    // leaving it TIMED_OUT (the case the OTHER Phase-11 wiring test already covers).
    nodeCleanupResources: {
      page: { close: async () => {} }, context: { close: async () => {} }, browser: { close: async () => {} },
    },
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1, sha256: '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e' }] }),
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => {},
  };

  const result = await runHarness(deps, HAPPY_CONFIG);

  assert.equal(result.cleanupUnresolvedOwnership, true, 'an ABANDONED F6 token whose ownership was never confirmed clean must still set cleanupUnresolvedOwnership');
  assert.ok(
    result.cleanupFailures.some((f) => f.step === 'finalizeLoadTokens' && f.reason === 'abandoned-f6-token-ownership-never-confirmed-clean'),
    'cleanupFailures must record the specific abandoned-F6-token reason, not just the still-timed-out one',
  );
  assert.equal(result.overall, OVERALL_VERDICT.FAIL, 'cleanupUnresolvedOwnership true must fail the run via branch 1');
});
