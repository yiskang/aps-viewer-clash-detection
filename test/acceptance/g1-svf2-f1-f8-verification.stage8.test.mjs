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
  IN_PAGE_FUNCTION_REGISTRY, buildBootstrapScriptSource, documentLoadStarter,
  loadDocumentNodeStarter, f3InstallProbe, f3ProbeSettledPredicate, f3FinalizeProbe,
  setupSharedSessionResources, captureModelFormatSignals,
  PHASE0_FAILURE_CATEGORIES,
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

// ============================================================================================
// codex-review (medium, round 3, High): runHarness's own SUCCESS-path errorLedger output must be
// redacted too -- previously only the Phase 0 failure path (handlePhase0Failure) redacted ledger
// events; this exercises the SAME real runHarness result assembly a normal, all-checks-PASS run
// produces, with a secret-bearing errorLedger event injected exactly as a real page.on listener
// would have recorded one.
// ============================================================================================

function fakeErrorLedgerWithSecretEvent() {
  const events = [
    { kind: 'required-resource-failure', url: 'https://host/asset?access_token=TOTALLY-SECRET-XYZ' },
    { kind: 'console', level: 'error', text: 'fetch failed, sent Authorization: Bearer TOTALLY-SECRET-XYZ' },
  ];
  return {
    events,
    record(event) { events.push(event); },
    summary() {
      const byKind = (kind) => events.filter((e) => e.kind === kind);
      return {
        pageErrors: byKind('pageerror'), unhandledRejections: byKind('unhandledrejection'),
        requiredResourceFailures: byKind('required-resource-failure'), contextLoss: byKind('webglcontextlost'),
        consoleErrors: byKind('console').filter((e) => e.level === 'error'),
        consoleWarnings: byKind('console').filter((e) => e.level === 'warn'),
        allowListedFingerprints: [],
      };
    },
  };
}

test('runHarness: a secret-bearing errorLedger event (url with a token, console text with a bearer header) is redacted in the real SUCCESS-path result, not persisted verbatim', async () => {
  const tracker = callOrderTracker();
  const deps = buildHappyDeps(tracker, {
    pageEvaluateOverrides: withF6Handlers(),
    depsOverrides: { errorLedger: fakeErrorLedgerWithSecretEvent() },
  });
  const result = await runHarness(deps, HAPPY_CONFIG);

  const serialized = JSON.stringify(result.errorLedger);
  assert.ok(!serialized.includes('TOTALLY-SECRET-XYZ'), 'the raw secret value must not appear anywhere in the persisted result.errorLedger');
  assert.ok(serialized.includes('[REDACTED]'), 'a redaction marker must be present where the secret was removed');
  assert.equal(result.errorLedger.requiredResourceFailures.length, 1);
  assert.equal(result.errorLedger.consoleErrors.length, 1);
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
// Bounded completion pass (Part B), codex-review remediation (medium, this pass, Critical +
// High "testing gap"): main()'s own real-wiring code is NEVER executed by this offline test
// suite (it constructs real Playwright objects) -- exactly like every prior structural test in
// this file, these prove main()'s SOURCE actually wires the widened Phase 0 failure boundary
// correctly, via the same source-text/ordering-check technique used throughout this file, since
// that is the established, accepted way this codebase verifies main()'s own untestable-by-
// execution real-Playwright-construction code.
// ============================================================================================

test('main() Phase 0 (Part B widening): browser.launch()/newContext()/newPage() are all INSIDE the Phase 0 try block, not before it', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxTryOpen = mainBody.indexOf("let phase0Step = 'harness-integrity';");
  assert.ok(idxTryOpen > -1, "main() must declare phase0Step = 'harness-integrity' before the widened try block");
  const idxLaunch = mainBody.indexOf('browser = await chromium.launch();');
  const idxNewContext = mainBody.indexOf('context = await browser.newContext(');
  const idxNewPage = mainBody.indexOf('page = await context.newPage();');
  const idxCatch = mainBody.indexOf('} catch (e) {', idxTryOpen);
  assert.ok(idxLaunch > -1 && idxNewContext > -1 && idxNewPage > -1 && idxCatch > -1, 'all three creation calls and the Phase 0 catch must exist');
  assert.ok(
    idxTryOpen < idxLaunch && idxLaunch < idxNewContext && idxNewContext < idxNewPage && idxNewPage < idxCatch,
    'browser.launch()/newContext()/newPage() must all be INSIDE the Phase 0 try block (between phase0Step declaration and the catch) -- codex-review Critical finding: previously these three were BEFORE any try/catch existed, so a failure there was entirely unguarded (no cleanup attempt, no evidence written)',
  );
});

// Built from parts, never the literal substring -- this repo's own domIsolation.test.mjs scans
// every *.test.mjs file's raw text for an actual dynamic-import/require of the browser-automation
// package (to keep the offline suite Chromium-free) and does not distinguish a real import from a
// string literal merely NAMING it in a structural test's own search needle. Assembled once, at
// module scope, and reused by every test below that needs to locate this exact call in main()'s
// own source.
const AUTOMATION_PKG_NAME = ['play', 'wright'].join('');
const AUTOMATION_PKG_DYNAMIC_IMPORT_NEEDLE = `await import(${"'"}${AUTOMATION_PKG_NAME}${"'"})`;

test('main() Phase 0 (Part B round-2 widening): harnessIntegrity computation and the browser-automation package\'s dynamic import are BOTH inside the widened try block, before browser.launch()', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxTryOpen = mainBody.indexOf("let phase0Step = 'harness-integrity';");
  assert.ok(idxTryOpen > -1, "main() must declare phase0Step = 'harness-integrity' before the widened try block");
  const idxHarnessIntegrityAssign = mainBody.indexOf('harnessIntegrity = {', idxTryOpen);
  const idxPlaywrightImportStep = mainBody.indexOf("phase0Step = 'playwright-import';", idxTryOpen);
  const idxPlaywrightImport = mainBody.indexOf(AUTOMATION_PKG_DYNAMIC_IMPORT_NEEDLE, idxTryOpen);
  const idxLaunch = mainBody.indexOf('browser = await chromium.launch();', idxTryOpen);
  const idxCatch = mainBody.indexOf('} catch (e) {', idxTryOpen);
  assert.ok(idxHarnessIntegrityAssign > -1, 'harnessIntegrity must be assigned (the nullable outer binding) inside the try block');
  assert.ok(idxPlaywrightImportStep > -1 && idxPlaywrightImport > -1, "main() must set phase0Step = 'playwright-import' and then actually perform the dynamic import");
  assert.ok(
    idxTryOpen < idxHarnessIntegrityAssign && idxHarnessIntegrityAssign < idxPlaywrightImportStep
    && idxPlaywrightImportStep < idxPlaywrightImport && idxPlaywrightImport < idxLaunch && idxLaunch < idxCatch,
    'codex-review round-2 High finding: harnessIntegrity computation and the browser-automation package\'s dynamic import previously ran entirely BEFORE any try/catch existed -- both must now be inside the widened try, in this order, strictly before browser.launch()',
  );
});

test('main() Phase 0 (Part B round-2 widening): the evidence writer (resultPath/writeResultAtomically) is constructed BEFORE the widened try block, immediately after activation succeeds', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxActivationCheck = mainBody.indexOf('if (!activation.authorized)');
  const idxWriteResultAtomically = mainBody.indexOf('const writeResultAtomically = async (result) => {');
  const idxTryOpen = mainBody.indexOf("let phase0Step = 'harness-integrity';");
  assert.ok(idxActivationCheck > -1 && idxWriteResultAtomically > -1 && idxTryOpen > -1, 'all three markers must exist');
  assert.ok(
    idxActivationCheck < idxWriteResultAtomically && idxWriteResultAtomically < idxTryOpen,
    'writeResultAtomically must be constructed after the activation check but BEFORE the widened Phase 0 try block, so it is available even for the earliest possible Phase 0 failure (harnessIntegrity computation or the playwright import itself)',
  );
  // Exactly ONE definition -- codex-review round-1 found this duplicated when writeResultAtomically was first moved; confirm the later, now-removed duplicate never reappears.
  const occurrences = mainBody.split('const writeResultAtomically = async (result) => {').length - 1;
  assert.equal(occurrences, 1, 'writeResultAtomically must be defined exactly once in main()');
});

test('main() Phase 0 (Part B round-2 widening): PHASE0_FAILURE_CATEGORIES has both new pre-browser step categories', async () => {
  assert.equal(PHASE0_FAILURE_CATEGORIES['harness-integrity'], 'harness-integrity-compute-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['playwright-import'], 'playwright-import-failed');
});

test('main() Phase 0 (Part B round-3 widening): harnessIntegrity is built INCREMENTALLY (path/sha256/branch/headSha/gitStatusPorcelain each assigned before the fallible manifest walk), never as one all-or-nothing object literal', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxTryOpen = mainBody.indexOf("let phase0Step = 'harness-integrity';");
  const idxInitLiteral = mainBody.indexOf('harnessIntegrity = {', idxTryOpen);
  const idxShaAssign = mainBody.indexOf('harnessIntegrity.sha256 = harnessSha256;', idxTryOpen);
  const idxBranchAssign = mainBody.indexOf('harnessIntegrity.branch = ', idxTryOpen);
  const idxManifestAssign = mainBody.indexOf('harnessIntegrity.servedModuleManifest = await buildServedModuleManifest(', idxTryOpen);
  const idxPlaywrightImportStep = mainBody.indexOf("phase0Step = 'playwright-import';", idxTryOpen);
  assert.ok(
    idxInitLiteral > -1 && idxShaAssign > -1 && idxBranchAssign > -1 && idxManifestAssign > -1,
    'main() must assign harnessIntegrity fields incrementally (a placeholder literal, then sha256, then git fields, then the fallible manifest walk last)',
  );
  assert.ok(
    idxInitLiteral < idxShaAssign && idxShaAssign < idxBranchAssign && idxBranchAssign < idxManifestAssign && idxManifestAssign < idxPlaywrightImportStep,
    "codex-review round-3 High finding: harnessIntegrity's genuinely-knowable fields (path/sha256/branch/headSha/gitStatusPorcelain) must all be assigned BEFORE the fallible buildServedModuleManifest walk, so a manifest-walk failure still leaves a schema-valid partial harnessIntegrity rather than harnessIntegrity staying entirely null",
  );
});

test('main() Phase 0 (Part B widening): route/addInitScript registration is also INSIDE the Phase 0 try block, strictly before goto', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxTryOpen = mainBody.indexOf("let phase0Step = 'harness-integrity';");
  const idxRouteSetupStep = mainBody.indexOf("phase0Step = 'route-setup';");
  const idxGoto = mainBody.indexOf('await page.goto(');
  const idxCatch = mainBody.indexOf('} catch (e) {', idxTryOpen);
  for (const needle of [`page.on('pageerror'`, `page.on('console'`, `page.on('requestfailed'`, `page.on('response'`, `context.route('**/clashtest/**'`, `context.route('**/clashpanel/**'`, 'page.route(`${BASE_URL}', 'await page.addInitScript(']) {
    // Search starting strictly AFTER idxTryOpen -- this file's own explanatory comments
    // legitimately mention some of these same method names in prose (e.g. a doc comment listing
    // "page.addInitScript()"), which would otherwise be found first and produce a false idx.
    const idx = mainBody.indexOf(needle, idxTryOpen);
    assert.ok(idx > idxTryOpen && idx < idxCatch, `'${needle}' must be inside the widened Phase 0 try block`);
    assert.ok(idx < idxGoto, `'${needle}' must still be registered strictly before page.goto`);
  }
  assert.ok(idxRouteSetupStep > idxTryOpen && idxRouteSetupStep < idxGoto, "phase0Step = 'route-setup' must be set before goto");
});

test('main() Phase 0 (Part B widening): pageEvaluate/pageWaitForFunction are built from buildRealPageDeps(page) INSIDE the try block, after page exists', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxNewPage = mainBody.indexOf('page = await context.newPage();');
  const idxBuildDeps = mainBody.indexOf('({ pageEvaluate, pageWaitForFunction } = buildRealPageDeps(page));');
  const idxGoto = mainBody.indexOf('await page.goto(');
  assert.ok(idxBuildDeps > -1, 'main() must reassign the nullable pageEvaluate/pageWaitForFunction bindings via buildRealPageDeps(page)');
  assert.ok(idxNewPage < idxBuildDeps && idxBuildDeps < idxGoto, 'buildRealPageDeps(page) must run after page exists and before goto');
});

test('main() Phase 0 (Part B widening): the catch block derives failureCategory via categorizePhase0Failure(phase0Step, e), never a raw lookup that ignores the actual error', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  assert.ok(mainBody.includes('categorizePhase0Failure(phase0Step, e)'), 'main() must call categorizePhase0Failure with both the step AND the caught error, so a non-timeout failure on a timeout-capable step is not mislabeled');
});

test('main() Phase 0 (Part B widening): browserExisted/pageExisted/contextExisted are the REAL Boolean(browser)/Boolean(page)/Boolean(context), never hardcoded true', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  assert.ok(mainBody.includes('browserExisted: Boolean(browser), pageExisted: Boolean(page), contextExisted: Boolean(context),'), 'resource-existence flags passed to handlePhase0Failure must reflect real state -- codex-review Critical finding: previously hardcoded `true` regardless of what actually got created');
});

test('main() Phase 0 (Part B widening): errorLedger (main()\'s own real ledger object) is passed into handlePhase0Failure, never omitted', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxCall = mainBody.indexOf('await handlePhase0Failure({');
  const idxCloseBrace = mainBody.indexOf('});', idxCall);
  assert.ok(idxCall > -1 && idxCloseBrace > -1, 'main() must call handlePhase0Failure');
  const callArgs = mainBody.slice(idxCall, idxCloseBrace);
  assert.ok(/\berrorLedger\b/.test(callArgs), 'errorLedger must be passed to handlePhase0Failure so already-recorded pageerror/console/requestfailed events are not discarded');
});

test('main() Phase 0 (Part B widening): chromiumVersion capture guards on browser existing first (never calls browser.version() on a null browser)', async () => {
  const source = await readFile(HARNESS_PATH, 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'), source.indexOf('\nif (import.meta.url'));
  const idxIfBrowser = mainBody.indexOf('if (browser) {');
  const idxVersionCall = mainBody.indexOf('chromiumVersion = browser.version();');
  assert.ok(idxIfBrowser > -1 && idxVersionCall > -1, 'main() must guard the chromiumVersion capture with an explicit browser existence check');
  assert.ok(idxIfBrowser < idxVersionCall && idxVersionCall < idxIfBrowser + 400, 'the browser.version() call must be nested inside the if (browser) guard');
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

// ============================================================================================
// Fix wave (final whole-branch review, Important I5): ONE shared, contract-enforcing fake page
// realm -- the systemic fix for I1/I2/I3's shared root cause (each prior fake independently
// guessed at pageEvaluate's real contract, and each guessed wrong in a different way). Unlike
// every other realm helper in this file (createCleanupPageRealm above) or session.test.mjs's
// own createPageRealm, this one:
//  (a) rejects a pageEvaluate/pageWaitForFunction call carrying more positional arguments than
//      Playwright's own page.evaluate(fn,arg)/page.waitForFunction(fn,arg,opts) accept, or an
//      `arg` that is not JSON-round-trip-safe (undefined allowed, matching Playwright's own
//      no-arg equivalent) -- exactly what would have caught I1 (observeF8's silently-dropped
//      third argument) the first time any test called it this way;
//  (b) actually dispatches through buildBootstrapScriptSource()'s own real IIFE source (never a
//      per-function vm.runInContext injection by bare name) -- exactly what would have caught
//      I2 (sessionErrOf missing from IN_PAGE_FUNCTION_REGISTRY) immediately, since a missing
//      registry entry means window.__g1HarnessFns[key] is genuinely undefined here, not merely
//      absent from some OTHER, hand-maintained fake's own injection list.
// ============================================================================================

function assertJsonRoundTripSafe(value, label) {
  if (value === undefined) return; // Playwright's own no-arg equivalent -- always allowed
  let json;
  try {
    json = JSON.stringify(value);
  } catch (e) {
    throw new Error(`${label}: argument is not JSON-serializable (${e && e.message})`);
  }
  if (json === undefined) {
    throw new Error(`${label}: argument serializes to undefined (a function, symbol, or top-level undefined is not a valid page.evaluate argument)`);
  }
}

function createContractEnforcingPageRealm(initialWindow = {}) {
  const context = vm.createContext({ window: initialWindow, performance, setTimeout, clearTimeout, console });
  vm.runInContext(buildBootstrapScriptSource(), context);
  const keyOf = new Map(Object.entries(IN_PAGE_FUNCTION_REGISTRY).map(([key, fn]) => [fn, key]));
  const resolveKey = (fn) => {
    const key = keyOf.get(fn);
    if (!key) throw new Error(`createContractEnforcingPageRealm: function '${fn && fn.name}' is not registered in IN_PAGE_FUNCTION_REGISTRY`);
    return key;
  };
  const dispatch = (fn, arg) => {
    const key = resolveKey(fn);
    const fnsInContext = vm.runInContext('window.__g1HarnessFns', context);
    const dispatchFn = fnsInContext[key];
    if (typeof dispatchFn !== 'function') {
      throw new Error(`createContractEnforcingPageRealm: window.__g1HarnessFns['${key}'] was never installed -- buildBootstrapScriptSource()'s own real IIFE construction did not register it`);
    }
    // Round-trip the argument through JSON, exactly like a real Playwright serialization
    // boundary would -- a test-only mutation of the ORIGINAL object after this call can never
    // leak into what the in-page function actually observes.
    const clonedArg = arg === undefined ? undefined : JSON.parse(JSON.stringify(arg));
    const out = dispatchFn(clonedArg);
    return out && typeof out.then === 'function' ? out : Promise.resolve(out);
  };
  return {
    window: initialWindow,
    pageEvaluate(fn, arg, ...rest) {
      if (rest.length > 0) throw new Error(`pageEvaluate: called with ${2 + rest.length} arguments -- page.evaluate(fn, arg) accepts exactly two; a third argument is ALWAYS silently dropped by the real Playwright wrapper, never delivered (this is exactly I1's own bug class)`);
      assertJsonRoundTripSafe(arg, 'pageEvaluate');
      return dispatch(fn, arg).then((result) => (result === undefined ? undefined : JSON.parse(JSON.stringify(result))));
    },
    async pageWaitForFunction(fn, arg, opts = {}, ...rest) {
      if (rest.length > 0) throw new Error(`pageWaitForFunction: called with ${3 + rest.length} arguments -- page.waitForFunction(fn, arg, opts) accepts exactly three`);
      assertJsonRoundTripSafe(arg, 'pageWaitForFunction');
      const timeout = opts && typeof opts.timeout === 'number' ? opts.timeout : 30_000;
      const deadline = Date.now() + timeout;
      for (;;) {
        const result = await dispatch(fn, arg);
        if (result) return result;
        if (Date.now() >= deadline) throw new Error('pageWaitForFunction: timeout');
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
  };
}

/**
 * A minimal but REAL Phase-0-shaped fixture: a fake window.Autodesk.Viewing.Document.load /
 * window.__viewer.loadDocumentNode that actually succeed (so the real documentLoadStarter/
 * loadDocumentNodeStarter genuinely populate window.__g1.loads/models, never pre-seeded), a
 * fake model whose isOTG()/isSVF2() both report true (so the real classifier confirms SVF2 and
 * the run genuinely reaches Phase 2.5), and a synchronous MODEL_ADDED_EVENT dispatch so F3's own
 * probe settles immediately. Every F1/F2/F4/F7/F8-specific fixture piece (enumerator/mod) is
 * DELIBERATELY minimal/absent -- each of those checks degrades to a well-defined non-throwing
 * result (FAIL or an empty population) when its own optional collaborators are missing, per
 * direct read of observeF1's own try/catch-guarded extractAllFragments call -- this test's own
 * goal is proving the REAL dispatch/registry/argument-contract mechanism end-to-end, never full
 * Viewer fidelity (session.test.mjs already covers each check's own scoring logic in isolation,
 * against much richer fixtures).
 */
function buildIntegrationFixtureWindow({ resolveRoots } = {}) {
  const model = {
    isOTG: () => true,
    isSVF2: () => true,
    isObjectTreeCreated: () => false,
    getFragmentList: () => ({ getCount: () => 0 }),
    getData: () => ({}),
    isLoadDone: () => true,
    getAllModels: () => [model],
  };
  const fakeDoc = { getRoot: () => ({ getDefaultGeometry: () => 'defaultGeom' }) };
  return {
    Autodesk: {
      Viewing: {
        MODEL_ADDED_EVENT: 'modelAdded',
        Document: { load: (urnStr, onSuccess) => { onSuccess(fakeDoc); } },
      },
    },
    __viewer: {
      loadDocumentNode: () => Promise.resolve(model),
      // Fires synchronously -- this fixture's own model never changes identity across the
      // load, so firing at registration time (Phase 1, before Phase 2's load even starts) is a
      // timing simplification with no correctness effect for this fixture.
      addEventListener: (name, listener) => { if (name === 'modelAdded') listener({ model }); },
      removeEventListener: () => {},
      getAllModels: () => [model],
      unloadModel: () => {},
    },
    // Confirmed by direct empirical trace (this fix wave): setupSharedSessionResources, unlike
    // observeF1/F2/F4/F7/F8, does NOT degrade gracefully when its own required mod entries are
    // absent -- it destructures CollisionWorld/createModelRegistry/createViewerElementEnumerator
    // directly and throws a raw TypeError if any is missing. These three, and a STATEFUL fake
    // registry (register/bindingFor must actually agree, matching session.test.mjs's own
    // fakeRegistry pattern), are the minimum needed for Phase 2.5 to genuinely succeed.
    __g1: {
      closing: false, nextGen: 1, loads: {}, docs: {}, models: {},
      mod: {
        '/collision/index.js': { CollisionWorld: { fromViewer: async () => ({ isModelLive: () => true, evictModel: () => {}, dispose: () => {} }) } },
        '/clashtest/index.js': {
          createModelRegistry: ({ world }) => {
            let boundModel = null;
            return {
              world,
              register: (K, m) => { boundModel = m; },
              bindingFor: () => (boundModel ? { model: boundModel } : null),
              unregister: () => {},
            };
          },
        },
        '/clashtest/viewer/index.js': {
          createViewerElementEnumerator: () => ({
            resolveRoots: resolveRoots || (async () => ({ roots: [], ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: 0, digest: 'd' } })),
          }),
        },
      },
    },
    THREE: {},
  };
}

// Note on scope (established empirically during this fix wave): this fixture's own tokens all
// reach COMPLETED, so it does NOT exercise sealLoadRecords/drainLoadToken's own argument shapes
// (I3's specific bug, since a COMPLETED Node-side token's state is never re-read from the
// in-page seal outcome) -- that is covered separately, precisely, by the dedicated "runHarness
// Phase 11 wiring (I3)" test above (both confirmed by a revert-check: removing sessionErrOf from
// the registry, or reverting sealLoadRecords' argument wrapping, was tried against this test
// during this fix wave -- only the former failed here, confirming I3 needs its own test, which
// already exists).
test('runHarness (I5): through the REAL buildBootstrapScriptSource()/window.__g1HarnessFns dispatch and the contract-enforcing pageEvaluate/pageWaitForFunction (arg-count + JSON-safety enforced) -- reaches real F1/F8 evidence, never crashes', async () => {
  const realm = createContractEnforcingPageRealm(buildIntegrationFixtureWindow());
  const deps = {
    pageEvaluate: realm.pageEvaluate,
    pageWaitForFunction: realm.pageWaitForFunction,
    loadStarter: { documentLoad: documentLoadStarter, loadDocumentNode: loadDocumentNodeStarter },
    installF3Probe: () => realm.pageEvaluate(f3InstallProbe, undefined),
    finalizeF3Probe: (arg) => realm.pageEvaluate(f3FinalizeProbe, arg),
    setupSharedSessionResources: (tokenId) => realm.pageEvaluate(setupSharedSessionResources, tokenId),
    controls: {},
    f6Deps: {},
    nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [] }),
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => {},
  };
  // Short timeouts -- every predicate in this fixture settles synchronously/on the first poll,
  // so this only bounds how long a genuinely-never-settling path (F6, deliberately not fully
  // fixtured -- see the doc comment above) can stall this test.
  const config = {
    urn: 'fixture-urn', loadTimeoutMs: 2000, unloadEventName: 'beforeModelUnload', addedEventName: 'modelAdded',
    reloadProbeTimeoutMs: 200, unloadWaitTimeoutMs: 200, controlTimeoutMs: 200, censusTimeoutMs: 2000,
    viewerVersion: '7.124.2', chromium: 'x', node: process.version, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
  };

  const result = await runHarness(deps, config);

  // The run must genuinely reach real F1/F8 evidence (proving Phase 1/2/2.5 and the REAL
  // contract-enforcing dispatch all worked end-to-end -- catches I1/I2's own bug classes).
  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_SVF2, 'the real classifier must confirm SVF2 from the real captureModelFormatSignals/readFormat path');
  assert.equal(result.checks.F1.evidence.status, 'observed', 'F1 must have actually been observed (not blocked/not-run) -- proves Phase 2.5/setupSharedSessionResources (I2\'s own location) genuinely succeeded');
  // F8 itself legitimately ends up 'observation-failed' with this deliberately minimal fixture
  // (an empty root population never populates session.artifacts.f1FragmentMapsByRoot, which F8
  // requires) -- never asserted as 'observed' here. What matters for I1: F8 was DISPATCHED at
  // all ('not-run' would mean the run never reached Phase 9), and its own reason is the
  // domain-specific fragment-maps gate, never a session-not-found/shape-crash symptom -- proving
  // observeF8's real single-combined-object argument (I1's own fix) was genuinely delivered
  // through the real dispatch with the right sessionId, not silently dropped or malformed.
  assert.notEqual(result.checks.F8.evidence.status, 'not-run', 'F8 must have actually been dispatched (Phase 9 reached), not skipped');
  assert.equal(result.checks.F8.reason, 'f1-fragment-maps-by-root-not-available-run-observeF1-first', 'F8\'s own failure reason must be the expected domain-specific gate, never a session-not-found/argument-shape symptom');
  // Schema-complete regardless of individual verdicts (this fixture is deliberately minimal, so
  // several checks legitimately FAIL/BLOCK on missing optional collaborators -- never asserted
  // as PASS here; only that the run completed and every object is well-formed).
  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `result must be schema-valid: ${errors.join('; ')}`);
});

// ---- Revert-check (this fix wave's own methodology, matching the step-20a regression test
// above): confirms this NEW integration test would actually have caught I1/I2/I3 if they were
// still present, by re-deriving each bug inline against THIS realm and asserting the specific
// failure mode -- not run automatically (would require mutating production source), but the
// three cases below exercise the SAME realm/dispatch machinery directly against a deliberately
// wrong call, proving the enforcement itself is live, not merely unexercised scaffolding.

test('createContractEnforcingPageRealm: rejects a 3-argument pageEvaluate call (I1\'s own exact bug shape)', () => {
  const realm = createContractEnforcingPageRealm({ __g1: undefined });
  assert.throws(
    () => realm.pageEvaluate(observeF8, 's1', { f1Fields: {}, f2Fields: {} }),
    /called with 3 arguments/,
  );
});

test('createContractEnforcingPageRealm: throws if a function is not registered in IN_PAGE_FUNCTION_REGISTRY (I2\'s own bug shape, reproduced against a throwaway unregistered function)', () => {
  const realm = createContractEnforcingPageRealm({ __g1: undefined });
  function notRegisteredAnywhere() { return 1; }
  assert.throws(
    () => realm.pageEvaluate(notRegisteredAnywhere, undefined),
    /is not registered in IN_PAGE_FUNCTION_REGISTRY/,
  );
});

test('createContractEnforcingPageRealm: rejects a non-JSON-serializable argument (a function value)', () => {
  const realm = createContractEnforcingPageRealm({ __g1: undefined });
  assert.throws(
    () => realm.pageEvaluate(observeF1, () => {}),
    /not JSON-serializable|serializes to undefined/,
  );
});

// ============================================================================================
// A second, focused I5 integration test: the happy-path fixture above never actually calls
// sessionErrOf (it is only referenced on observeF1/setupSharedSessionResources's own ERROR
// paths, none of which the happy path exercises) -- confirmed empirically during this fix wave
// by temporarily removing sessionErrOf from IN_PAGE_FUNCTION_REGISTRY and observing the happy-
// path test above still pass unchanged. This test drives observeF1's own resolveRoots-threw
// catch path for real (a genuine thrown Error, not a fixture shortcut), which itself calls
// sessionErrOf(e) to build the error's own JSON-safe shape -- exactly I2's own bug location. If
// sessionErrOf were missing from the registry, this would surface as a SECOND, uncaught
// ReferenceError raised while handling the first error, propagating out of observeF1 entirely
// (proven by the same removal experiment: this test fails with exactly that shape).
// ============================================================================================

test('runHarness (I5): a real observeF1 resolveRoots-threw path (which itself calls sessionErrOf) completes cleanly, never a second uncaught ReferenceError -- I2\'s own exact bug location', async () => {
  const realm = createContractEnforcingPageRealm(buildIntegrationFixtureWindow({
    resolveRoots: async () => { throw new Error('simulated resolveRoots failure'); },
  }));
  const deps = {
    pageEvaluate: realm.pageEvaluate,
    pageWaitForFunction: realm.pageWaitForFunction,
    loadStarter: { documentLoad: documentLoadStarter, loadDocumentNode: loadDocumentNodeStarter },
    installF3Probe: () => realm.pageEvaluate(f3InstallProbe, undefined),
    finalizeF3Probe: (arg) => realm.pageEvaluate(f3FinalizeProbe, arg),
    setupSharedSessionResources: (tokenId) => realm.pageEvaluate(setupSharedSessionResources, tokenId),
    controls: {}, f6Deps: {}, nodeCleanupResources: {},
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [] }),
    errorLedger: { events: [], record() {} },
    harnessIntegrity: { path: HARNESS_PATH, sha256: 'a'.repeat(64), branch: 'main', headSha: 'deadbeef', gitStatusPorcelain: '', servedModuleManifest: {}, remoteAssets: { viewerScript: { integrityResult: INTEGRITY_RESULT.VERIFIED }, viewerStyle: { identityGatesOverall: false }, otherObservedRemoteAssets: [] } },
    writeResultAtomically: async () => {},
  };
  const config = {
    urn: 'fixture-urn', loadTimeoutMs: 2000, unloadEventName: 'beforeModelUnload', addedEventName: 'modelAdded',
    reloadProbeTimeoutMs: 200, unloadWaitTimeoutMs: 200, controlTimeoutMs: 200, censusTimeoutMs: 2000,
    viewerVersion: '7.124.2', chromium: 'x', node: process.version, initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
  };

  const result = await runHarness(deps, config);

  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_SVF2);
  // observeF1 itself must have caught the thrown Error and built a clean, JSON-safe error
  // record via sessionErrOf -- 'observation-failed' with the EXACT expected reason, never
  // 'not-run' (which would mean a second, uncaught ReferenceError aborted the whole sequence
  // before F1 even finished recording its own result).
  assert.equal(result.checks.F1.evidence.status, 'observation-failed');
  assert.equal(result.checks.F1.reason, 'resolveRoots-threw');
  const { valid, errors } = validateResultSchema(result);
  assert.equal(valid, true, `result must still be schema-valid: ${errors.join('; ')}`);
});
