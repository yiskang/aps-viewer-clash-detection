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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_VERDICT, CLASSIFIER, OVERALL_VERDICT, CONTROL_STATE, INTEGRITY_RESULT, CONTROL_NAMES,
  createControlResult, TOKEN_STATE, LOAD_API,
  observeF1, scoreF1, observeF2, scoreF2, observeF4, scoreF4, scoreF5, observeF7, scoreF7,
  observeF8, scoreF8, scoreF6, buildStaleOldModelEventControlResult,
  runHarness, validateResultSchema, main,
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
  assert.equal(result.checks.F1, CHECK_VERDICT.PASS);
  assert.equal(result.checks.F6, CHECK_VERDICT.PASS);
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
    assert.equal(result.checks[name], CHECK_VERDICT.BLOCKED, `checks.${name} must be BLOCKED, never missing`);
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
  assert.equal(result.checks.F1, CHECK_VERDICT.BLOCKED, 'F1 itself is BLOCKED, never silently missing or falsely PASS');
  // Every LATER check the sequence never reached (F2 onward) is still present, fail-closed --
  // never a missing object (plan §8's own "no missing objects" discipline).
  for (const name of ['F2', 'F4', 'F5', 'F6', 'F7', 'F8']) {
    assert.equal(result.checks[name], CHECK_VERDICT.BLOCKED, `checks.${name} must be BLOCKED, never missing, since the sequence never reached it`);
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
  const originalArgv = [...process.argv];
  const originalEnv = process.env.G1_F1_F8_LIVE_AUTHORIZED;
  try {
    process.argv = [...process.argv.filter((a) => a !== '--execute-live-f1-f8'), '--execute-live-f1-f8'];
    delete process.env.G1_F1_F8_LIVE_AUTHORIZED;
    await assert.rejects(() => main());

    process.argv = originalArgv.filter((a) => a !== '--execute-live-f1-f8');
    process.env.G1_F1_F8_LIVE_AUTHORIZED = 'YES';
    await assert.rejects(() => main());
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
        viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED },
        viewerStyle: { identityGatesOverall: false },
        otherObservedRemoteAssets: [],
      },
    },
    runtimeEnvelope: { viewerVersion: '7.124.2', chromium: '120', node: process.version, modelUrn: 'urn:x', initializer: { env: 'AutodeskProduction2', api: 'streamingV2' } },
    classifier: CLASSIFIER.CONFIRMED_SVF2,
    runtime: { isOTG: true, isSVF2: true },
    checks: { F1: CHECK_VERDICT.PASS, F2: CHECK_VERDICT.PASS, F3: CHECK_VERDICT.PASS, F4: CHECK_VERDICT.PASS, F5: CHECK_VERDICT.PASS, F6: CHECK_VERDICT.PASS, F7: CHECK_VERDICT.PASS, F8: CHECK_VERDICT.PASS },
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
