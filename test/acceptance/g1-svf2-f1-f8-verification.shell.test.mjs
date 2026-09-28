// test/acceptance/g1-svf2-f1-f8-verification.shell.test.mjs
//
// Offline, browser-free unit tests for Stage 3 of test/acceptance/g1-svf2-f1-f8-verification.mjs
// (the runtime-shell slice: route resolution, the served-module manifest builder, Viewer
// response-body identity classification, the error ledger, F3 scoring, the tree-unavailable
// control, and Phase 0-3 orchestration). New sibling file (not appended to Stage 1/2's files),
// same rationale as Stage 2's own choice: this stage's concerns (filesystem-fixture-backed
// manifest building, page-routing resolution, phase orchestration against fakes) are
// independent enough from Stage 1's pure contract layer and Stage 2's async/cleanup machinery
// to warrant their own file. Auto-discovered by scripts/run-tests.mjs (`*.test.mjs`).
//
// AUTHORIZATION BOUNDARY: this file NEVER launches a real Chromium browser, NEVER imports
// playwright, and NEVER executes main(). Every page-interaction dependency is a plain fake
// object/function constructed in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  TOKEN_STATE,
  CLASSIFIER,
  CHECK_VERDICT,
  CONTROL_STATE,
  INTEGRITY_RESULT,
  CONTROL_RESTORATION_REQUIRED,
  createControlResult,
  LOAD_API,
  resolveClashtestModulePath,
  SERVED_MODULE_ENTRY_POINTS,
  buildServedModuleManifest,
  EXPECTED_VIEWER_SHA256,
  classifyViewerScriptIntegrity,
  CONSOLE_ERROR_ALLOWLIST,
  classifyLedgerEvent,
  scoreF3Readiness,
  captureModelFormatSignals,
  buildFormatSignalShim,
  runTreeUnavailableControl,
  runSetupThroughClassification,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// 1. Route resolution
// ============================================================================================

const FAKE_CLASHTEST_DIR = '/fake/repo/clashtest';

test('resolveClashtestModulePath: a valid nested .js path resolves ok', () => {
  const result = resolveClashtestModulePath('/clashtest/viewer/index.js', FAKE_CLASHTEST_DIR);
  assert.equal(result.ok, true);
  assert.equal(result.absolutePath, path.join(FAKE_CLASHTEST_DIR, 'viewer', 'index.js'));
});

test('resolveClashtestModulePath: a path-traversal attempt is rejected with 404', () => {
  const result = resolveClashtestModulePath('/clashtest/../../../etc/passwd', FAKE_CLASHTEST_DIR);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('resolveClashtestModulePath: a non-.js extension is rejected with 404', () => {
  const result = resolveClashtestModulePath('/clashtest/data.json', FAKE_CLASHTEST_DIR);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('resolveClashtestModulePath: a sibling-directory escape disguised as a prefix match is rejected', () => {
  // e.g. '/fake/repo/clashtest-evil/x.js' must not be accepted just because it starts with the
  // same string prefix as FAKE_CLASHTEST_DIR (missing path separator check would allow this).
  const result = resolveClashtestModulePath('/clashtest/../clashtest-evil/x.js', FAKE_CLASHTEST_DIR);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('resolveClashtestModulePath: URL-encoded traversal is decoded and still rejected', () => {
  const result = resolveClashtestModulePath('/clashtest/%2e%2e/%2e%2e/etc/passwd.js', FAKE_CLASHTEST_DIR);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

// ============================================================================================
// 2. Served-module manifest builder (fixture files under a scratch temp directory)
// ============================================================================================

test('buildServedModuleManifest: discovers a multi-hop transitive chain and produces stable, correct hashes', async (t) => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'g1-manifest-test-'));
  t.after(async () => { await rm(scratchDir, { recursive: true, force: true }); });

  // a.js -> b.js -> c.js (a multi-hop transitive chain), plus a named export-from and a bare
  // side-effect import, and one bare package specifier that must be SKIPPED (not a repo file).
  await writeFile(path.join(scratchDir, 'a.js'), "import { b } from './b.js';\nimport './sideEffectOnly.js';\nexport { b };\n");
  await writeFile(path.join(scratchDir, 'b.js'), "export { c as b } from './c.js';\n");
  await writeFile(path.join(scratchDir, 'c.js'), "import THREE from 'three';\nexport const c = 1;\n");
  await writeFile(path.join(scratchDir, 'sideEffectOnly.js'), "console.log('loaded');\n");

  const manifest = await buildServedModuleManifest(['/a.js'], { rootDir: scratchDir });

  assert.deepEqual(Object.keys(manifest).sort(), ['/a.js', '/b.js', '/c.js', '/sideEffectOnly.js']);
  // 'three' (a bare package specifier) must never appear as a discovered/hashed module.
  assert.ok(!Object.keys(manifest).some((k) => k.includes('three')));

  // Stable and independently cross-checkable: recompute one hash directly.
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const cContents = await readFile(path.join(scratchDir, 'c.js'), 'utf8');
  const expectedCHash = createHash('sha256').update(cContents, 'utf8').digest('hex');
  assert.equal(manifest['/c.js'], expectedCHash);

  // Stable across repeated calls.
  const manifest2 = await buildServedModuleManifest(['/a.js'], { rootDir: scratchDir });
  assert.deepEqual(manifest, manifest2);
});

test('buildServedModuleManifest: handles import * as ns and export * from re-exports', async (t) => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'g1-manifest-test2-'));
  t.after(async () => { await rm(scratchDir, { recursive: true, force: true }); });

  await writeFile(path.join(scratchDir, 'entry.js'), "import * as ns from './ns.js';\nexport * from './reexport.js';\n");
  await writeFile(path.join(scratchDir, 'ns.js'), 'export const x = 1;\n');
  await writeFile(path.join(scratchDir, 'reexport.js'), 'export const y = 2;\n');

  const manifest = await buildServedModuleManifest(['/entry.js'], { rootDir: scratchDir });
  assert.deepEqual(Object.keys(manifest).sort(), ['/entry.js', '/ns.js', '/reexport.js']);
});

test('buildServedModuleManifest: an unreadable discovered module throws rather than silently omitting it', async (t) => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'g1-manifest-test3-'));
  t.after(async () => { await rm(scratchDir, { recursive: true, force: true }); });

  await writeFile(path.join(scratchDir, 'entry.js'), "import { x } from './missing.js';\n");

  await assert.rejects(() => buildServedModuleManifest(['/entry.js'], { rootDir: scratchDir }));
});

test('buildServedModuleManifest: an injected readFileFn is honored (never coupled to real repo file contents)', async () => {
  const fakeFiles = { '/entry.js': "import './dep.js';\n", '/dep.js': 'export const z = 1;\n' };
  const manifest = await buildServedModuleManifest(['/entry.js'], {
    rootDir: '/does/not/exist',
    readFileFn: async (absPath) => {
      const key = '/' + path.relative('/does/not/exist', absPath).split(path.sep).join('/');
      if (!(key in fakeFiles)) throw new Error(`no such fake file: ${key}`);
      return fakeFiles[key];
    },
  });
  assert.deepEqual(Object.keys(manifest).sort(), ['/dep.js', '/entry.js']);
});

test('SERVED_MODULE_ENTRY_POINTS: matches the plan §5 module list exactly', () => {
  assert.deepEqual(SERVED_MODULE_ENTRY_POINTS, [
    '/clashtest/viewer/index.js',
    '/clashtest/index.js',
    '/collision/viewer/ViewerModelAdapter.js',
    '/collision/viewer/ViewerGeometryAdapter.js',
    '/clashtest/planning/scopeDigest.js',
    '/collision/index.js',
    '/collision/constants.js',
  ]);
});

// ============================================================================================
// 3. Viewer response-body identity classification
// ============================================================================================

function verifiedResponse(overrides = {}) {
  return {
    status: 200, redirectChainComplete: true, fromServiceWorker: false,
    bodyOutcome: 'captured', decodedByteLength: 10_948_159, sha256: EXPECTED_VIEWER_SHA256,
    ...overrides,
  };
}

test('classifyViewerScriptIntegrity: VERIFIED -- a single matching attributable response', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse()] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.VERIFIED);
});

test('classifyViewerScriptIntegrity: FETCH_FAILED -- a requestfailed event', () => {
  const result = classifyViewerScriptIntegrity({ requestFailed: true, autodeskViewingDefined: false, attributableResponses: [] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.FETCH_FAILED);
});

test('classifyViewerScriptIntegrity: FETCH_FAILED -- final status >= 400', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ status: 404 })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.FETCH_FAILED);
});

test('classifyViewerScriptIntegrity: FETCH_FAILED -- no response ever observed and Autodesk.Viewing never defined', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: false, attributableResponses: [] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.FETCH_FAILED);
});

test('classifyViewerScriptIntegrity: MISMATCH -- captured non-empty body, wrong sha256', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ sha256: 'deadbeef'.repeat(8) })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.MISMATCH);
});

test('classifyViewerScriptIntegrity: PROVENANCE_AMBIGUOUS -- script executed but no attributable response observed', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS);
});

test('classifyViewerScriptIntegrity: PROVENANCE_AMBIGUOUS -- redirect chain not fully reconstructed', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ redirectChainComplete: false })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS);
});

test('classifyViewerScriptIntegrity: PROVENANCE_AMBIGUOUS -- more than one attributable response, not all matched', () => {
  const result = classifyViewerScriptIntegrity({
    autodeskViewingDefined: true,
    attributableResponses: [verifiedResponse(), verifiedResponse({ bodyOutcome: 'capture-failed', sha256: null })],
  });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS);
});

test('classifyViewerScriptIntegrity: CAPTURE_UNAVAILABLE -- response.body() rejected', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ bodyOutcome: 'capture-failed', sha256: null, decodedByteLength: null })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
});

test('classifyViewerScriptIntegrity: CAPTURE_UNAVAILABLE -- empty body (e.g. a 304 whose body is not the full bundle)', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ status: 304, bodyOutcome: 'empty', sha256: null, decodedByteLength: 0 })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
});

test('classifyViewerScriptIntegrity: CAPTURE_UNAVAILABLE -- still unresolved when Phase 11 closed the page', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ bodyOutcome: 'pending-at-close', sha256: null, decodedByteLength: null })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
});

// -- the plan's own 5 "worked negative cases", one level lower than Stage 1's computeOverall
// tests: does the raw capture data classify to the right integrityResult in the first place. --

test('worked negative case (i): same-URL, same-length CDN replacement -- different decoded bytes -> MISMATCH', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ sha256: 'a'.repeat(64) })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.MISMATCH);
});

test('worked negative case (ii): redirect to different bytes -- chain reconstructed, final body hashed differs -> MISMATCH', () => {
  const result = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ redirectChainComplete: true, sha256: 'b'.repeat(64) })] });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.MISMATCH);
});

test('worked negative case (iii): service-worker-served different bytes -> MISMATCH; identical bytes -> VERIFIED', () => {
  const differentBytes = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ fromServiceWorker: true, sha256: 'c'.repeat(64) })] });
  assert.equal(differentBytes.integrityResult, INTEGRITY_RESULT.MISMATCH);
  const identicalBytes = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ fromServiceWorker: true })] });
  assert.equal(identicalBytes.integrityResult, INTEGRITY_RESULT.VERIFIED);
});

test('worked negative case (iv): body unavailable (response.body() rejects, or an empty 304 body) -> CAPTURE_UNAVAILABLE, never PASS-compatible', () => {
  const rejected = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ bodyOutcome: 'capture-failed', sha256: null, decodedByteLength: null })] });
  assert.equal(rejected.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
  const empty304 = classifyViewerScriptIntegrity({ autodeskViewingDefined: true, attributableResponses: [verifiedResponse({ status: 304, bodyOutcome: 'empty', sha256: null, decodedByteLength: 0 })] });
  assert.equal(empty304.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
});

test('worked negative case (v): captured body matches but the script request was also served a second time without capture -> PROVENANCE_AMBIGUOUS', () => {
  const result = classifyViewerScriptIntegrity({
    autodeskViewingDefined: true,
    attributableResponses: [verifiedResponse(), verifiedResponse({ bodyOutcome: 'pending-at-close', sha256: null, decodedByteLength: null })],
  });
  assert.equal(result.integrityResult, INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS);
});

// ============================================================================================
// 4. Error ledger classification
// ============================================================================================

test('classifyLedgerEvent: every always-fatal category is fatal', () => {
  assert.equal(classifyLedgerEvent({ kind: 'pageerror' }, {}).fatal, true);
  assert.equal(classifyLedgerEvent({ kind: 'unhandledrejection' }, {}).fatal, true);
  assert.equal(classifyLedgerEvent({ kind: 'required-resource-failure' }, {}).fatal, true);
  assert.equal(classifyLedgerEvent({ kind: 'webglcontextlost' }, {}).fatal, true);
});

test('classifyLedgerEvent: crash/close observed while closeIntent is unset is fatal', () => {
  assert.equal(classifyLedgerEvent({ kind: 'crash' }, {}).fatal, true);
  assert.equal(classifyLedgerEvent({ kind: 'close' }, { closeIntent: undefined }).fatal, true);
});

test('classifyLedgerEvent: crash/close observed after closeIntent === "cleanup" is expected teardown, never fatal', () => {
  assert.equal(classifyLedgerEvent({ kind: 'crash' }, { closeIntent: 'cleanup' }).fatal, false);
  assert.equal(classifyLedgerEvent({ kind: 'close' }, { closeIntent: 'cleanup' }).fatal, false);
});

test('classifyLedgerEvent: console.error not matched by the (empty) allow-list is fatal', () => {
  assert.deepEqual(CONSOLE_ERROR_ALLOWLIST, []);
  const result = classifyLedgerEvent({ kind: 'console', level: 'error', message: 'boom' }, {});
  assert.equal(result.fatal, true);
});

test('classifyLedgerEvent: console.warn/info/log are never fatal', () => {
  assert.equal(classifyLedgerEvent({ kind: 'console', level: 'warn', message: 'x' }, {}).fatal, false);
  assert.equal(classifyLedgerEvent({ kind: 'console', level: 'info', message: 'x' }, {}).fatal, false);
  assert.equal(classifyLedgerEvent({ kind: 'console', level: 'log', message: 'x' }, {}).fatal, false);
});

test('classifyLedgerEvent: an unrecognized event kind throws rather than silently passing', () => {
  assert.throws(() => classifyLedgerEvent({ kind: 'bogus' }, {}));
});

// ============================================================================================
// 5. F3 readiness scoring
// ============================================================================================

test('scoreF3Readiness: resolveRoots rejecting (including an ObjectTreeUnavailableError-shaped cause) -> FAIL', () => {
  const err = new Error('tree unavailable');
  err.name = 'ObjectTreeUnavailableError';
  const result = scoreF3Readiness({ modelAddedObserved: true, resolveRootsOutcome: 'rejected', rejectionError: err });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'resolve-roots-rejected');
  assert.equal(result.error.name, 'ObjectTreeUnavailableError');
});

test('scoreF3Readiness: MODEL_ADDED_EVENT never observed -> FAIL, reason model-added-never-observed', () => {
  const result = scoreF3Readiness({ modelAddedObserved: false });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'model-added-never-observed');
});

test('scoreF3Readiness: never settling within the timeout -> FAIL, reason readiness-never-settled', () => {
  const result = scoreF3Readiness({ modelAddedObserved: true, resolveRootsOutcome: 'timed-out' });
  assert.equal(result.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.reason, 'readiness-never-settled');
});

test('scoreF3Readiness: resolved -> PASS', () => {
  const result = scoreF3Readiness({ modelAddedObserved: true, resolveRootsOutcome: 'resolved' });
  assert.equal(result.verdict, CHECK_VERDICT.PASS);
});

// ============================================================================================
// §4.1 format-signal capture bridge
// ============================================================================================

test('buildFormatSignalShim + readFormat: a successful capture builds a working shim', async () => {
  const { readFormat } = await import('./g1-svf2-f1-f8-verification.mjs');
  const shim = buildFormatSignalShim({ ok: true, isOTG: true, isSVF2: true, captureErrors: [] });
  const result = readFormat(shim);
  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_SVF2);
});

test('buildFormatSignalShim: UNAVAILABLE omits the method entirely (readFormat sees it as absent, not false)', async () => {
  const { readFormat } = await import('./g1-svf2-f1-f8-verification.mjs');
  const shim = buildFormatSignalShim({ ok: true, isOTG: true, isSVF2: 'UNAVAILABLE', captureErrors: [] });
  assert.equal('isSVF2' in shim, false);
  const result = readFormat(shim);
  assert.equal(result.classifier, CLASSIFIER.INDETERMINATE_PARTIAL);
});

test('buildFormatSignalShim: throws on an unsuccessful capture (never silently builds a bogus shim)', () => {
  assert.throws(() => buildFormatSignalShim({ ok: false, reason: 'model-not-found' }));
});

test('buildFormatSignalShim: throws on a capture ERROR (isOTG threw in-page) -- never silently downgrades to UNAVAILABLE', () => {
  assert.throws(() => buildFormatSignalShim({ ok: true, isOTG: null, isSVF2: true, captureErrors: [{ signal: 'isOTG', error: {} }] }));
});

test('captureModelFormatSignals: missing/generation-mismatched record -> not ok', () => {
  globalThis.window = { __g1: { loads: { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } }, models: { tok: {} } } };
  try {
    const result = captureModelFormatSignals({ tokenId: 'tok', gen: 999 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-or-generation-mismatch');
  } finally {
    delete globalThis.window;
  }
});

test('captureModelFormatSignals: a non-completed loadDocumentNode record -> not ok', () => {
  globalThis.window = { __g1: { loads: { tok: { gen: 1, status: 'timed-out', api: 'loadDocumentNode' } }, models: {} } };
  try {
    const result = captureModelFormatSignals({ tokenId: 'tok', gen: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-completed-loadDocumentNode-record');
  } finally {
    delete globalThis.window;
  }
});

test('captureModelFormatSignals: a throwing isOTG() is captured as an error, never silently UNAVAILABLE', () => {
  const model = {
    isOTG: () => { throw new Error('broken'); },
    isSVF2: () => true,
  };
  globalThis.window = { __g1: { loads: { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } }, models: { tok: model } } };
  try {
    const result = captureModelFormatSignals({ tokenId: 'tok', gen: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.isOTG, null, 'a capture ERROR is null, never the UNAVAILABLE string sentinel');
    assert.equal(result.isSVF2, true);
    assert.equal(result.captureErrors.length, 1);
    assert.equal(result.captureErrors[0].signal, 'isOTG');
  } finally {
    delete globalThis.window;
  }
});

test('captureModelFormatSignals: each live method is invoked at most once', () => {
  let otgCalls = 0;
  const model = { isOTG: () => { otgCalls += 1; return true; }, isSVF2: () => true };
  globalThis.window = { __g1: { loads: { tok: { gen: 1, status: 'completed', api: 'loadDocumentNode' } }, models: { tok: model } } };
  try {
    captureModelFormatSignals({ tokenId: 'tok', gen: 1 });
    assert.equal(otgCalls, 1);
  } finally {
    delete globalThis.window;
  }
});

// ============================================================================================
// 6. tree-unavailable control
// ============================================================================================

function fakeModelBefore() {
  return {
    isObjectTreeCreated: () => true,
    getObjectTree: (onSuccess) => onSuccess({}),
  };
}

test('CONTROL_RESTORATION_REQUIRED["tree-unavailable"] cross-check: must be true (plan line 843)', () => {
  assert.equal(CONTROL_RESTORATION_REQUIRED['tree-unavailable'], true);
});

test('tree-unavailable control: DETECTED_RESTORED -- gate correctly classifies the patch as a readiness failure, restores cleanly', async () => {
  const model = fakeModelBefore();
  const world = { isModelLive: () => true };
  const registry = { bindingFor: () => ({ model }) };
  const result = await runTreeUnavailableControl({
    modelBefore: model, world, registry, registryKey: 'K',
    checkReadiness: async (m) => ({ ready: m.isObjectTreeCreated() }), // sees the patched (false) value while active
  });
  assert.equal(result.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(result.restorationRequired, true);
  assert.equal(model.isObjectTreeCreated(), true, 'restored to the original after the control');
});

test('tree-unavailable control: NOT_DETECTED -- the gate silently passes the patched model', async () => {
  const model = fakeModelBefore();
  const result = await runTreeUnavailableControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkReadiness: async () => ({ ready: true }), // never notices the patch
  });
  assert.equal(result.state, CONTROL_STATE.NOT_DETECTED);
});

test('tree-unavailable control: RESTORE_FAILED -- detected, but the post-restoration liveness check fails', async () => {
  const model = fakeModelBefore();
  const result = await runTreeUnavailableControl({
    modelBefore: model, world: { isModelLive: () => false }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkReadiness: async () => ({ ready: false }),
  });
  assert.equal(result.state, CONTROL_STATE.RESTORE_FAILED);
});

test('tree-unavailable control: TIMED_OUT -- checkReadiness never settles inside the control deadline', async () => {
  const model = fakeModelBefore();
  const result = await runTreeUnavailableControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkReadiness: () => new Promise(() => {}), // never resolves
    controlTimeoutMs: 20,
  });
  assert.equal(result.state, CONTROL_STATE.TIMED_OUT);
});

test('tree-unavailable control: NOT_EXECUTABLE -- no modelBefore', async () => {
  const result = await runTreeUnavailableControl({ modelBefore: null, checkReadiness: async () => ({ ready: false }) });
  assert.equal(result.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(result.executed, false);
});

test('tree-unavailable control: createControlResult validates the produced record (never a permissive shortcut)', async () => {
  const model = fakeModelBefore();
  const result = await runTreeUnavailableControl({
    modelBefore: model, world: { isModelLive: () => true }, registry: { bindingFor: () => ({ model }) }, registryKey: 'K',
    checkReadiness: async () => ({ ready: false }),
  });
  assert.equal(result.restorationRequired, CONTROL_RESTORATION_REQUIRED['tree-unavailable']);
});

// ============================================================================================
// 7. Phase 0-3 orchestration
// ============================================================================================

function fakePageEvaluateFor(responses) {
  // responses: array of {status:'completed'|'timed-out', gen} matching each successive
  // pageEvaluate(starter, args) call in order, OR a function keyed by the starter itself.
  let call = 0;
  return async (fn, args) => {
    if (fn && fn.__kind === 'captureFormatSignals') return fn.__result;
    const r = responses[call];
    call += 1;
    return { tokenId: args.tokenId, gen: 1, status: r.status, outcome: r.status === 'completed' ? { kind: 'success', error: null } : null };
  };
}

function fakeStarter(kind) {
  const fn = () => {};
  fn.__kind = kind;
  return fn;
}

test('runSetupThroughClassification: a clean CONFIRMED_SVF2 path reaches Phase 3', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({ modelAddedObserved: true, resolveRootsOutcome: 'resolved' }),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true, sessionId: 's1', postconditions: { registryWorldMatches: true, bindingModelMatches: true, worldModelIsLive: true }, error: null }),
  });

  assert.equal(result.phaseReached, 'phase3');
  assert.equal(result.classifier.classifier, CLASSIFIER.CONFIRMED_SVF2);
  assert.equal(result.checks.F3.verdict, CHECK_VERDICT.PASS);
  assert.equal(result.docLoad.token.state, TOKEN_STATE.COMPLETED);
  assert.equal(result.loadDocumentNode.token.state, TOKEN_STATE.COMPLETED);
});

test('runSetupThroughClassification: CONFIRMED_NON_SVF2 stops before Phase 2.5/Phase 3', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: false, isSVF2: false, captureErrors: [] };

  let setupCalled = false;
  let finalizeCalled = false;

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => { finalizeCalled = true; return {}; },
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => { setupCalled = true; return { ok: true }; },
  });

  assert.equal(result.phaseReached, 'classifier-stop');
  assert.equal(result.classifier.classifier, CLASSIFIER.CONFIRMED_NON_SVF2);
  assert.deepEqual(result.checks, {});
  assert.equal(setupCalled, false, 'Phase 2.5 must never run on a classifier stop');
  assert.equal(finalizeCalled, false, 'Phase 3 F3-finalize must never run on a classifier stop');
});

test('runSetupThroughClassification: CONTRADICTORY stops before Phase 3', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: false, captureErrors: [] };

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({}),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.phaseReached, 'classifier-stop');
  assert.equal(result.classifier.classifier, CLASSIFIER.CONTRADICTORY);
});

test('runSetupThroughClassification: INDETERMINATE_UNAVAILABLE stops before Phase 3', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: 'UNAVAILABLE', isSVF2: 'UNAVAILABLE', captureErrors: [] };

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({}),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.phaseReached, 'classifier-stop');
  assert.equal(result.classifier.classifier, CLASSIFIER.INDETERMINATE_UNAVAILABLE);
});

test('runSetupThroughClassification: a load timeout stops at "load", classifier never runs', async () => {
  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({}),
    pageEvaluate: fakePageEvaluateFor([{ status: 'timed-out' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.phaseReached, 'load');
  assert.equal(result.classifier, null);
  assert.equal(result.loadDocumentNode, null, 'loadDocumentNode must never be minted when Document.load itself timed out');
});

test('runSetupThroughClassification: a capture failure (isOTG()/isSVF2() threw in-page) sets fatalErrorObserved -- fix round 1 regression', async () => {
  // Reviewer's exact concern: a thrown isOTG()/isSVF2() (captureFailure: true) is a genuinely
  // broken/throwing runtime, not a benign "never confirmed SVF2" outcome -- it must set
  // fatalErrorObserved, exactly like the structurally analogous Phase 2.5 postcondition-failure
  // branch does, so it is never indistinguishable by shape from an ordinary classifier-stop
  // (CONFIRMED_NON_SVF2/CONTRADICTORY/INDETERMINATE_*). Drives the capture failure end-to-end
  // through the real orchestration function (not just captureModelFormatSignals in isolation).
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: null, isSVF2: true, captureErrors: [{ signal: 'isOTG', error: { name: 'Error', message: 'broken' } }] };

  let setupCalled = false;
  let finalizeCalled = false;

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => { finalizeCalled = true; return {}; },
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => { setupCalled = true; return { ok: true }; },
  });

  assert.equal(result.phaseReached, 'classifier-stop');
  assert.equal(result.captureFailure, true);
  assert.equal(result.fatalErrorObserved, true, 'a capture failure must set fatalErrorObserved, never leave it undefined/falsy');
  assert.equal(result.classifier, null);
  assert.equal(setupCalled, false, 'Phase 2.5 must never run after a capture failure');
  assert.equal(finalizeCalled, false, 'Phase 3 F3-finalize must never run after a capture failure');
});

test('runSetupThroughClassification: a Phase 2.5 setup-postcondition failure is fatal, F3 never runs', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };

  let finalizeCalled = false;
  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => { finalizeCalled = true; return {}; },
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: false, sessionId: null, postconditions: { registryWorldMatches: false, bindingModelMatches: true, worldModelIsLive: true }, error: 'registry.world mismatch' }),
  });

  assert.equal(result.phaseReached, 'phase2.5-setup-failed');
  assert.equal(result.fatalErrorObserved, true);
  assert.equal(finalizeCalled, false);
});

test('runSetupThroughClassification: F3 resolveRoots rejecting (incl. ObjectTreeUnavailableError) -> FAIL', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };
  const err = new Error('tree unavailable'); err.name = 'ObjectTreeUnavailableError';

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({ modelAddedObserved: true, resolveRootsOutcome: 'rejected', rejectionError: err }),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.phaseReached, 'phase3');
  assert.equal(result.checks.F3.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.checks.F3.reason, 'resolve-roots-rejected');
});

test('runSetupThroughClassification: F3 MODEL_ADDED_EVENT never observed -> FAIL with reason model-added-never-observed', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({ modelAddedObserved: false }),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.checks.F3.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.checks.F3.reason, 'model-added-never-observed');
});

test('runSetupThroughClassification: F3 readiness timeout -> FAIL with reason readiness-never-settled', async () => {
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };

  const result = await runSetupThroughClassification({
    installF3Probe: async () => {},
    finalizeF3Probe: async () => ({ modelAddedObserved: true, resolveRootsOutcome: 'timed-out' }),
    pageEvaluate: fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }]),
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });
  assert.equal(result.checks.F3.verdict, CHECK_VERDICT.FAIL);
  assert.equal(result.checks.F3.reason, 'readiness-never-settled');
});

test('runSetupThroughClassification: installF3Probe runs strictly before the load call', async () => {
  const order = [];
  const captureFn = () => {};
  captureFn.__kind = 'captureFormatSignals';
  captureFn.__result = { ok: true, isOTG: true, isSVF2: true, captureErrors: [] };

  await runSetupThroughClassification({
    installF3Probe: async () => { order.push('install'); },
    finalizeF3Probe: async () => ({ modelAddedObserved: true, resolveRootsOutcome: 'resolved' }),
    pageEvaluate: async (fn, args) => { order.push('load'); return fakePageEvaluateFor([{ status: 'completed' }, { status: 'completed' }])(fn, args); },
    pageWaitForFunction: async () => true,
    loadStarter: { documentLoad: fakeStarter('doc'), loadDocumentNode: fakeStarter('ldn') },
    captureFormatSignalsFn: captureFn,
    loadTimeoutMs: 30_000,
    urn: 'urn:fake',
    setupSharedSessionResources: async () => ({ ok: true }),
  });

  assert.equal(order[0], 'install');
  assert.equal(order[1], 'load');
});
