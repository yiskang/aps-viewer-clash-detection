// test/acceptance/g1-svf2-f1-f8-verification.phase0evidence.test.mjs
//
// Offline, browser-free unit tests for the bounded G1 harness completion pass's Part B (see
// docs/prompts/for-claude-g1-harness-bounded-completion-pass.md and
// .superpowers/sdd/g1-f1-f8-harness/briefs/task-9-brief.md): a Phase 0 failure must produce a
// durable, schema-shaped-as-far-as-possible FAIL evidence object, written through the same
// atomic-write mechanism the success path uses.
//
// This file NEVER launches a browser, NEVER imports playwright, and NEVER calls `main()` --
// every test exercises `handlePhase0Failure`/`closeAllBestEffort` directly, using fakes for
// `captureViewerScriptIntegrity`/`closeAllFn`/`writeResultAtomically`, exactly like every prior
// stage's own offline tests in this suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handlePhase0Failure,
  closeAllBestEffort,
  CLOSE_TIMEOUT_MS,
  PHASE0_FAILURE_CATEGORIES,
  PHASE0_TIMEOUT_CAPABLE_STEPS,
  isPlaywrightTimeoutError,
  categorizePhase0Failure,
  redactLedgerString,
  redactLedgerEventForEvidence,
  validateResultSchema,
  OVERALL_VERDICT,
  CHECK_VERDICT,
  CONTROL_STATE,
  CONTROL_NAMES,
  INTEGRITY_RESULT,
  CLASSIFIER,
  EXPECTED_VIEWER_SHA256,
  VIEWER_SCRIPT_URL,
  describeError,
  DESCRIBE_ERROR_MAX_TOTAL_BYTES,
} from './g1-svf2-f1-f8-verification.mjs';

// A minimal, schema-shaped harnessIntegrity input, matching exactly what main() has ALREADY
// computed before Phase 0 begins (path/sha256/branch/headSha/gitStatusPorcelain/
// servedModuleManifest -- never remoteAssets, which handlePhase0Failure itself adds).
function fakeHarnessIntegrityInput() {
  return {
    path: 'test/acceptance/g1-svf2-f1-f8-verification.mjs',
    sha256: 'a'.repeat(64),
    branch: 'feature/g1-svf2-f1-f8-harness',
    headSha: 'b'.repeat(40),
    gitStatusPorcelain: '',
    servedModuleManifest: { '/collision/index.js': 'c'.repeat(64) },
  };
}

function fakeRuntimeEnvelope() {
  return {
    viewerVersion: '7.124.2', chromium: 'Chromium/120.0.0.0', node: process.version,
    modelUrn: 'urn:fake', initializer: { env: 'AutodeskProduction2', api: 'streamingV2' },
  };
}

function baseArgs(overrides = {}) {
  return {
    error: new Error('simulated Phase 0 failure'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['module-install'],
    startedAt: new Date().toISOString(),
    harnessIntegrityInput: fakeHarnessIntegrityInput(),
    runtimeEnvelope: fakeRuntimeEnvelope(),
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [] }),
    closeAllFn: async () => ({ closeFailures: [] }),
    writeResultAtomically: async () => {},
    consoleErrorFn: () => {},
    ...overrides,
  };
}

// ============================================================================================
// PHASE0_FAILURE_CATEGORIES / categorizePhase0Failure -- real catch-site-derived categories,
// widened (codex-review, medium, this pass, Critical) to cover the FULL Phase 0 sequence main()
// actually performs (browser launch through module install), and (High) to distinguish an
// ACTUAL Playwright timeout from a same-step non-timeout failure (e.g. a connection failure)
// rather than assuming every goto/bootstrap-ready rejection is a timeout.
// ============================================================================================

test('PHASE0_FAILURE_CATEGORIES has all seven real Phase 0 step categories', () => {
  assert.equal(PHASE0_FAILURE_CATEGORIES['browser-launch'], 'browser-launch-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['context-create'], 'context-create-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['page-create'], 'page-create-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['route-setup'], 'route-or-init-script-setup-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES.goto, 'goto-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['bootstrap-ready'], 'bootstrap-ready-failed');
  assert.equal(PHASE0_FAILURE_CATEGORIES['module-install'], 'module-install-failed');
});

test('isPlaywrightTimeoutError: recognizes a real Playwright TimeoutError by name', () => {
  const err = new Error('page.goto: Timeout 30000ms exceeded.');
  err.name = 'TimeoutError';
  assert.equal(isPlaywrightTimeoutError(err), true);
});

test('isPlaywrightTimeoutError: recognizes a timeout by message even if name differs', () => {
  const err = new Error('Timeout 30000ms exceeded while waiting for event "load"');
  assert.equal(isPlaywrightTimeoutError(err), true);
});

test('isPlaywrightTimeoutError: a non-timeout error (connection refused) is NOT a timeout', () => {
  const err = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:8080/__g1-f1f8__');
  assert.equal(isPlaywrightTimeoutError(err), false);
});

test('isPlaywrightTimeoutError: null/undefined -> false, never throws', () => {
  assert.equal(isPlaywrightTimeoutError(null), false);
  assert.equal(isPlaywrightTimeoutError(undefined), false);
});

test('categorizePhase0Failure: goto step, a real timeout -> goto-timeout', () => {
  const err = new Error('page.goto: Timeout 30000ms exceeded.');
  err.name = 'TimeoutError';
  assert.equal(categorizePhase0Failure('goto', err), 'goto-timeout');
});

test('categorizePhase0Failure: goto step, a non-timeout failure -> goto-failed, never mislabeled as a timeout', () => {
  const err = new Error('net::ERR_CONNECTION_REFUSED');
  assert.equal(categorizePhase0Failure('goto', err), 'goto-failed');
});

test('categorizePhase0Failure: bootstrap-ready step, a real timeout -> bootstrap-ready-timeout', () => {
  const err = new Error('page.waitForFunction: Timeout 30000ms exceeded.');
  err.name = 'TimeoutError';
  assert.equal(categorizePhase0Failure('bootstrap-ready', err), 'bootstrap-ready-timeout');
});

test('categorizePhase0Failure: bootstrap-ready step, a page crash (non-timeout) -> bootstrap-ready-failed', () => {
  const err = new Error('Page crashed');
  assert.equal(categorizePhase0Failure('bootstrap-ready', err), 'bootstrap-ready-failed');
});

test('categorizePhase0Failure: a step that is not timeout-capable (module-install) never gets a -timeout suffix, even given a timeout-shaped error', () => {
  const err = new Error('Timeout exceeded');
  err.name = 'TimeoutError';
  assert.equal(categorizePhase0Failure('module-install', err), 'module-install-failed');
});

test('categorizePhase0Failure: the newly-widened harness-assembly steps produce their own honest categories', () => {
  assert.equal(categorizePhase0Failure('browser-launch', new Error('boom')), 'browser-launch-failed');
  assert.equal(categorizePhase0Failure('context-create', new Error('boom')), 'context-create-failed');
  assert.equal(categorizePhase0Failure('page-create', new Error('boom')), 'page-create-failed');
  assert.equal(categorizePhase0Failure('route-setup', new Error('boom')), 'route-or-init-script-setup-failed');
});

test('categorizePhase0Failure: an unrecognized step falls back to phase-0-unknown-failure, never throws', () => {
  assert.equal(categorizePhase0Failure('some-future-step', new Error('boom')), 'phase-0-unknown-failure');
});

test('PHASE0_TIMEOUT_CAPABLE_STEPS contains exactly goto and bootstrap-ready', () => {
  assert.deepEqual([...PHASE0_TIMEOUT_CAPABLE_STEPS].sort(), ['bootstrap-ready', 'goto']);
});

// ============================================================================================
// closeAllBestEffort -- reports which close(s) failed instead of blanket-swallowing.
// ============================================================================================

test('closeAllBestEffort: all three close cleanly -> no closeFailures', async () => {
  const calls = [];
  const mk = (name) => ({ close: async () => { calls.push(name); } });
  const { closeFailures } = await closeAllBestEffort({ page: mk('page'), context: mk('context'), browser: mk('browser') });
  assert.deepEqual(closeFailures, []);
  assert.deepEqual(calls, ['page', 'context', 'browser']);
});

test('closeAllBestEffort: one of the three close() calls rejects -> reported, and the other two still run', async () => {
  const calls = [];
  const page = { close: async () => { calls.push('page'); } };
  const context = { close: async () => { calls.push('context'); throw new Error('context close boom'); } };
  const browser = { close: async () => { calls.push('browser'); } };
  const { closeFailures } = await closeAllBestEffort({ page, context, browser });
  assert.deepEqual(calls, ['page', 'context', 'browser'], 'a failure closing one resource must not prevent attempting the other two');
  assert.equal(closeFailures.length, 1);
  assert.equal(closeFailures[0].resource, 'context');
  assert.equal(closeFailures[0].error.message, 'context close boom');
});

test('closeAllBestEffort: multiple close() calls reject -> each is reported, not just the first', async () => {
  const page = { close: async () => { throw new Error('page boom'); } };
  const context = { close: async () => { throw new Error('context boom'); } };
  const browser = { close: async () => { throw new Error('browser boom'); } };
  const { closeFailures } = await closeAllBestEffort({ page, context, browser });
  assert.equal(closeFailures.length, 3);
  assert.deepEqual(closeFailures.map((f) => f.resource).sort(), ['browser', 'context', 'page']);
});

test('closeAllBestEffort: never throws itself, even when every close() rejects', async () => {
  const boom = { close: async () => { throw new Error('boom'); } };
  await assert.doesNotReject(async () => closeAllBestEffort({ page: boom, context: boom, browser: boom }));
});

// ============================================================================================
// closeAllBestEffort -- codex-review (medium, round 2, High): an unbounded close() can hang
// forever, blocking evidence-writing/rethrow indefinitely. Each close() now races an independent
// timeout, recorded as an ordinary cleanup failure -- never blocking the next resource.
// ============================================================================================

function neverSettlingCloseTarget() {
  // A close() that never resolves/rejects -- simulates an unresponsive browser/renderer.
  return { close: () => new Promise(() => {}) };
}

test('closeAllBestEffort: a never-settling close() times out (bounded, small timeoutMs for a fast test) and is recorded as a cleanup failure, not an infinite hang', async () => {
  const hung = neverSettlingCloseTarget();
  const { closeFailures } = await closeAllBestEffort({ page: hung, context: undefined, browser: undefined, timeoutMs: 20 });
  assert.equal(closeFailures.length, 1);
  assert.equal(closeFailures[0].resource, 'page');
  assert.match(closeFailures[0].error.message, /did not settle within 20ms/);
});

test('closeAllBestEffort: a timed-out close() does not block the NEXT resource from being attempted', async () => {
  const hungPage = neverSettlingCloseTarget();
  const calls = [];
  const context = { close: async () => { calls.push('context'); } };
  const browser = { close: async () => { calls.push('browser'); } };
  const { closeFailures } = await closeAllBestEffort({ page: hungPage, context, browser, timeoutMs: 20 });
  assert.deepEqual(calls, ['context', 'browser'], 'context and browser must both still be attempted after page times out');
  assert.equal(closeFailures.length, 1);
  assert.equal(closeFailures[0].resource, 'page');
});

test('closeAllBestEffort: the default timeoutMs is CLOSE_TIMEOUT_MS when not overridden', async () => {
  // Confirms the exported constant matches what main() actually uses as its default (never a
  // silently-drifted duplicate value) -- does not itself wait out the real timeout.
  assert.equal(typeof CLOSE_TIMEOUT_MS, 'number');
  assert.ok(CLOSE_TIMEOUT_MS > 0);
});

// ============================================================================================
// redactLedgerString / redactLedgerEventForEvidence -- codex-review (medium, round 2, High):
// already-recorded errorLedger events (url/text) can carry secret-shaped substrings; these must
// be redacted before being persisted into Phase 0 evidence, reusing the SAME redaction machinery
// describeError itself uses (never a bespoke/independent regime).
// ============================================================================================

test('redactLedgerString: redacts a bearer token embedded in free text', () => {
  const out = redactLedgerString('failed request, header was Authorization: Bearer abc.def-ghi_123');
  assert.ok(!out.includes('abc.def-ghi_123'), 'the raw token must not survive redaction');
  assert.match(out, /\[REDACTED\]/);
});

test('redactLedgerString: redacts a sensitive query parameter in a URL', () => {
  const out = redactLedgerString('https://developer.api.autodesk.com/foo?access_token=SUPER-SECRET-VALUE&x=1');
  assert.ok(!out.includes('SUPER-SECRET-VALUE'), 'the raw token value must not survive redaction');
  // redactSensitiveQueryParams reconstructs the string via a real URL/URLSearchParams object,
  // which percent-encodes the [REDACTED] placeholder's brackets -- decode before matching.
  assert.match(decodeURIComponent(out), /access_token=\[REDACTED\]/);
  assert.ok(out.includes('x=1'), 'a non-sensitive query param must be left alone');
});

test('redactLedgerString: an oversized string is bounded, never persisted verbatim', () => {
  const huge = 'x'.repeat(50_000);
  const out = redactLedgerString(huge);
  assert.ok(Buffer.byteLength(out, 'utf8') < huge.length, 'the output must be shorter than the unbounded input');
});

test('redactLedgerString: a non-string value passes through unchanged, never throws', () => {
  assert.equal(redactLedgerString(null), null);
  assert.equal(redactLedgerString(undefined), undefined);
  assert.equal(redactLedgerString(42), 42);
});

test('redactLedgerEventForEvidence: redacts a required-resource-failure event\'s url field', () => {
  const event = { kind: 'required-resource-failure', url: 'https://host/file?token=SECRETVALUE' };
  const out = redactLedgerEventForEvidence(event);
  assert.ok(!out.url.includes('SECRETVALUE'));
  assert.equal(out.kind, 'required-resource-failure', 'non-string fields must be preserved unchanged');
});

test('redactLedgerEventForEvidence: redacts a console event\'s text field', () => {
  const event = { kind: 'console', level: 'error', text: 'Authorization: Bearer SECRETVALUE failed' };
  const out = redactLedgerEventForEvidence(event);
  assert.ok(!out.text.includes('SECRETVALUE'));
  assert.equal(out.level, 'error');
});

test('redactLedgerEventForEvidence: a pageerror event (already describeError-shaped) is left unchanged -- never re-processed', () => {
  const event = { kind: 'pageerror', error: describeError(new Error('boom')) };
  const out = redactLedgerEventForEvidence(event);
  assert.deepEqual(out, event);
});

test('redactLedgerEventForEvidence: never mutates the input event', () => {
  const event = { kind: 'console', level: 'error', text: 'Authorization: Bearer SECRETVALUE' };
  const frozenCopy = JSON.parse(JSON.stringify(event));
  redactLedgerEventForEvidence(event);
  assert.deepEqual(event, frozenCopy, 'the original event object must be untouched');
});

test('redactLedgerEventForEvidence: null/non-object input passes through unchanged, never throws', () => {
  assert.equal(redactLedgerEventForEvidence(null), null);
  assert.equal(redactLedgerEventForEvidence(undefined), undefined);
});

// ============================================================================================
// handlePhase0Failure -- codex-review (medium, round 2, High) regression: a secret-bearing
// errorLedger event must NOT survive verbatim into the persisted evidence.
// ============================================================================================

test('handlePhase0Failure: a secret-bearing errorLedger event (url with a token, console text with a bearer header) is redacted, not persisted verbatim', async () => {
  const secretUrl = 'https://host/asset?access_token=TOTALLY-SECRET-ABC123';
  const secretConsoleText = 'fetch failed, sent Authorization: Bearer TOTALLY-SECRET-ABC123';
  const ledger = fakeErrorLedger([
    { kind: 'required-resource-failure', url: secretUrl },
    { kind: 'console', level: 'error', text: secretConsoleText },
  ]);

  const { evidence } = await handlePhase0Failure(baseArgs({ errorLedger: ledger }));

  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes('TOTALLY-SECRET-ABC123'), 'the raw secret value must not appear anywhere in the persisted evidence');
  assert.ok(serialized.includes('[REDACTED]'), 'a redaction marker must be present where the secret was removed');
});

// ============================================================================================
// handlePhase0Failure -- required property 1: a simulated module-import failure reaches the
// evidence writer and produces a FAIL-verdict, schema-shaped evidence object.
// ============================================================================================

test('handlePhase0Failure: a simulated module-install failure produces PHASE_0/FAIL evidence matching validateResultSchema', async () => {
  const writes = [];
  const args = baseArgs({
    error: new Error("g1-svf2-f1-f8-verification.mjs: installG1Modules failed for: /collision/index.js"),
    failureCategory: PHASE0_FAILURE_CATEGORIES['module-install'],
    writeResultAtomically: async (result) => { writes.push(result); },
  });
  const { evidence, evidenceWriteError } = await handlePhase0Failure(args);

  assert.equal(evidenceWriteError, null);
  assert.equal(writes.length, 1, 'writeResultAtomically must be called exactly once');
  assert.strictEqual(writes[0], evidence, 'the written object must be the same evidence object returned');

  assert.equal(evidence.phase, 'PHASE_0');
  assert.equal(evidence.failureCategory, 'module-install-failed');
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL, 'a Phase 0 failure must always compute to FAIL via computeOverall (rule 1)');

  const { valid, errors } = validateResultSchema(evidence);
  assert.ok(valid, `evidence must satisfy validateResultSchema: ${JSON.stringify(errors)}`);
});

// ============================================================================================
// codex-review (medium, round 3, High): a manifest-walk (or other late-in-computation)
// harnessIntegrity failure previously left harnessIntegrityInput entirely `null` -- these tests
// confirm the DOWNSTREAM contract main() now relies on: a PARTIAL-but-valid harnessIntegrity
// (every field except servedModuleManifest genuinely known, servedModuleManifest honestly `{}`)
// still satisfies validateResultSchema in full, and a TRULY absent harnessIntegrity (the much
// rarer case -- main()'s own self-read failing) is a disclosed, structurally-unavoidable partial
// result that still never reaches PASS.
// ============================================================================================

test('handlePhase0Failure: a PARTIAL harnessIntegrityInput (servedModuleManifest empty, every other field known -- main()\'s own incremental-build contract after a manifest-walk failure) satisfies validateResultSchema in full', async () => {
  const partial = {
    ...fakeHarnessIntegrityInput(),
    servedModuleManifest: {}, // honestly empty -- the manifest walk itself is what failed
  };
  const { evidence } = await handlePhase0Failure(baseArgs({
    error: new Error('buildServedModuleManifest: cannot read discovered module'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['harness-integrity'],
    harnessIntegrityInput: partial,
  }));
  const { valid, errors } = validateResultSchema(evidence);
  assert.ok(valid, `a partial-but-otherwise-complete harnessIntegrity must still satisfy validateResultSchema in full: ${JSON.stringify(errors)}`);
  assert.deepEqual(evidence.harnessIntegrity.servedModuleManifest, {});
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
});

test('handlePhase0Failure: a fully-absent harnessIntegrityInput (null) is a disclosed, honest partial -- validateResultSchema reports the missing integrity fields, but overall NEVER reaches PASS', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({
    error: new Error('cannot read own harness source'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['harness-integrity'],
    harnessIntegrityInput: null,
  }));
  const { valid, errors } = validateResultSchema(evidence);
  assert.equal(valid, false, 'a fully-absent harnessIntegrity is structurally unable to satisfy the schema -- this is expected/honest, not silently papered over');
  assert.ok(errors.some((e) => e.includes('harnessIntegrity')), 'the reported errors must name the missing harnessIntegrity fields');
  assert.notEqual(evidence.overall, OVERALL_VERDICT.PASS, 'partial/invalid evidence must never be labeled PASS regardless of schema validity');
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
});

test('handlePhase0Failure: failureCategory varies correctly across all three real Phase 0 steps', async () => {
  for (const category of Object.values(PHASE0_FAILURE_CATEGORIES)) {
    const { evidence } = await handlePhase0Failure(baseArgs({ failureCategory: category }));
    assert.equal(evidence.failureCategory, category);
    assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
  }
});

test('handlePhase0Failure: every checks.F1-F8 entry is BLOCKED/not-run/blockedBy fatal-error, never missing', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs());
  for (const name of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']) {
    const c = evidence.checks[name];
    assert.ok(c, `checks.${name} must be present, never missing`);
    assert.equal(c.verdict, CHECK_VERDICT.BLOCKED);
    assert.equal(c.evidence.status, 'not-run');
    assert.equal(c.evidence.blockedBy, 'fatal-error');
  }
});

test('handlePhase0Failure: every mandatory control is NOT_EXECUTABLE, never missing', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs());
  for (const name of CONTROL_NAMES) {
    const c = evidence.controls[name];
    assert.ok(c, `controls.${name} must be present, never missing`);
    assert.equal(c.state, CONTROL_STATE.NOT_EXECUTABLE);
    assert.equal(c.executed, false);
  }
});

test('handlePhase0Failure: partial evidence is never labeled PASS, across every viewerScriptIntegrity variant', async () => {
  const variants = [
    async () => ({ requestFailed: true, autodeskViewingDefined: false, attributableResponses: [] }), // FETCH_FAILED-ish
    async () => ({ requestFailed: false, autodeskViewingDefined: true, attributableResponses: [] }), // CAPTURE_UNAVAILABLE
    async () => { throw new Error('capture threw'); }, // capture-threw -> CAPTURE_UNAVAILABLE
    async () => ({
      requestFailed: false, autodeskViewingDefined: true,
      attributableResponses: [{ status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 10948159, sha256: EXPECTED_VIEWER_SHA256 }],
    }), // a genuinely VERIFIED identity
  ];
  for (const captureViewerScriptIntegrity of variants) {
    const { evidence } = await handlePhase0Failure(baseArgs({ captureViewerScriptIntegrity }));
    assert.notEqual(evidence.overall, OVERALL_VERDICT.PASS, 'fatalErrorObserved:true must always force FAIL, even when identity is independently VERIFIED');
    assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
  }
});

// ============================================================================================
// required property 2: a simulated Viewer-asset-identity-state variant (attributableResponses
// already has data before the failure) is preserved correctly in the written evidence.
// ============================================================================================

test('handlePhase0Failure: a captured attributableResponses record (identity already known) is preserved verbatim in harnessIntegrity.remoteAssets', async () => {
  const captureRecord = {
    requestFailed: false, autodeskViewingDefined: true,
    attributableResponses: [{
      status: 200, redirectChainComplete: true, fromServiceWorker: false,
      bodyOutcome: 'captured', decodedByteLength: 10948159, sha256: EXPECTED_VIEWER_SHA256,
    }],
  };
  const { evidence } = await handlePhase0Failure(baseArgs({
    captureViewerScriptIntegrity: async () => captureRecord,
  }));
  const vs = evidence.harnessIntegrity.remoteAssets.viewerScript;
  assert.equal(vs.integrityResult, INTEGRITY_RESULT.VERIFIED, 'a real matching captured body must classify as VERIFIED even though the run is still FAIL overall');
  assert.equal(vs.expectedSha256, EXPECTED_VIEWER_SHA256);
  assert.equal(vs.requestedUrl, VIEWER_SCRIPT_URL);
  assert.deepEqual(vs.capture, captureRecord, 'the full capture record must be retained verbatim, not summarized away');
});

test('handlePhase0Failure: captureViewerScriptIntegrity not a function -> CAPTURE_UNAVAILABLE, capture-function-not-injected, never throws', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({ captureViewerScriptIntegrity: undefined }));
  const vs = evidence.harnessIntegrity.remoteAssets.viewerScript;
  assert.equal(vs.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
  assert.equal(vs.reason, 'capture-function-not-injected');
  assert.equal(vs.capture, null);
});

test('handlePhase0Failure: captureViewerScriptIntegrity itself throwing -> CAPTURE_UNAVAILABLE/capture-threw, never propagates', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({
    captureViewerScriptIntegrity: async () => { throw new Error('capture exploded'); },
  }));
  const vs = evidence.harnessIntegrity.remoteAssets.viewerScript;
  assert.equal(vs.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
  assert.equal(vs.reason, 'capture-threw');
  assert.equal(vs.capture, null);
});

// ============================================================================================
// required property 3: a simulated cleanup failure AFTER a Phase 0 failure: the original Phase
// 0 failure remains primary/reported, and the cleanup failure is a separate field.
// ============================================================================================

test('handlePhase0Failure: a cleanup (close) failure is recorded separately, and never promoted over the primary Phase 0 error', async () => {
  const primaryError = new Error('primary Phase 0 failure: goto timed out');
  const closeFailureRecord = { resource: 'context', error: describeError(new Error('context close boom')) };
  const { evidence } = await handlePhase0Failure(baseArgs({
    error: primaryError,
    failureCategory: PHASE0_FAILURE_CATEGORIES.goto,
    closeAllFn: async () => ({ closeFailures: [closeFailureRecord] }),
  }));

  // Primary failure stays primary -- evidence.error/failureCategory describe the ORIGINAL error.
  assert.equal(evidence.error.message, 'primary Phase 0 failure: goto timed out');
  assert.equal(evidence.failureCategory, 'goto-failed');

  // Cleanup failure is retained as its own, separate field -- never dropped, never merged into
  // evidence.error, never overwriting failureCategory.
  assert.deepEqual(evidence.cleanupFailures, [closeFailureRecord]);
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL, 'still FAIL -- both rule-1 causes (fatal error AND a cleanup failure) agree, neither is silently dropped');
});

test('handlePhase0Failure: closeAllFn itself is actually invoked (cleanup runs) even though it is a Phase 0 failure path', async () => {
  let closeAllFnCalled = false;
  await handlePhase0Failure(baseArgs({
    closeAllFn: async () => { closeAllFnCalled = true; return { closeFailures: [] }; },
  }));
  assert.equal(closeAllFnCalled, true);
});

test('handlePhase0Failure: no closeAllFn provided -> cleanupFailures defaults to an empty array, never throws', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({ closeAllFn: undefined }));
  assert.deepEqual(evidence.cleanupFailures, []);
});

// ============================================================================================
// required property 4: a simulated evidence-WRITE failure is surfaced distinctly, not silently
// swallowed.
// ============================================================================================

test('handlePhase0Failure: writeResultAtomically rejecting is surfaced as evidenceWriteError, not silently swallowed', async () => {
  const loggedArgs = [];
  const { evidenceWriteError, evidence } = await handlePhase0Failure(baseArgs({
    writeResultAtomically: async () => { throw new Error('disk full'); },
    consoleErrorFn: (...args) => { loggedArgs.push(args); },
  }));
  assert.ok(evidenceWriteError, 'a write failure must be surfaced, never silently dropped');
  assert.equal(evidenceWriteError.message, 'disk full');
  assert.equal(loggedArgs.length, 1, 'the write failure must be logged distinctly');
  // The evidence object itself was still fully constructed (assembly succeeded; only the write
  // failed) -- still returned to the caller so main() could, if it chose to, retry or inspect it.
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
});

test('handlePhase0Failure: does not throw even when writeResultAtomically rejects', async () => {
  await assert.doesNotReject(async () => handlePhase0Failure(baseArgs({
    writeResultAtomically: async () => { throw new Error('disk full'); },
  })));
});

test('handlePhase0Failure: no writeResultAtomically provided -> evidenceWriteError stays null, never throws', async () => {
  const { evidenceWriteError } = await handlePhase0Failure(baseArgs({ writeResultAtomically: undefined }));
  assert.equal(evidenceWriteError, null);
});

// ============================================================================================
// required property 5: redaction/bounded serialization -- handlePhase0Failure actually calls
// describeError (never a bespoke/unbounded JSON.stringify(error)).
// ============================================================================================

test('handlePhase0Failure: evidence.error is produced via describeError -- an oversized error is bounded, not serialized verbatim', async () => {
  const hugeStack = 'at fakeFrame\n'.repeat(20_000); // comfortably over DESCRIBE_ERROR_MAX_TOTAL_BYTES
  const err = new Error('oversized');
  err.stack = hugeStack;
  const { evidence } = await handlePhase0Failure(baseArgs({ error: err }));
  const serializedBytes = Buffer.byteLength(JSON.stringify(evidence.error), 'utf8');
  assert.ok(
    serializedBytes <= DESCRIBE_ERROR_MAX_TOTAL_BYTES * 1.5,
    `evidence.error (${serializedBytes} bytes) must stay bounded near DESCRIBE_ERROR_MAX_TOTAL_BYTES (${DESCRIBE_ERROR_MAX_TOTAL_BYTES}), not the original ~${hugeStack.length}-byte unbounded stack`,
  );
  assert.deepEqual(evidence.error, describeError(err), 'evidence.error must be exactly what describeError(error) itself produces -- never a second, independent serialization');
});

test('handlePhase0Failure: evidence.errorLedger.requiredResourceFailures[0].error is also describeError-shaped, never a raw Error object', async () => {
  const err = new Error('module install boom');
  const { evidence } = await handlePhase0Failure(baseArgs({ error: err }));
  assert.equal(evidence.errorLedger.requiredResourceFailures.length, 1);
  assert.deepEqual(evidence.errorLedger.requiredResourceFailures[0].error, describeError(err));
  assert.equal(evidence.errorLedger.fatalErrorObserved, true);
});

test('handlePhase0Failure: never persists a credential/token -- no field mentions /api/auth/token or an access_token-shaped value', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs());
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes('/api/auth/token'), 'evidence must never reference the token endpoint');
  assert.ok(!/access_token/i.test(serialized), 'evidence must never reference an access token field');
});

// ============================================================================================
// codex-review (medium, this pass, High): already-recorded errorLedger events (pageerror/
// console/requestfailed, collected by main()'s own listeners BEFORE Phase 0's primary failure)
// must be merged into the evidence, never discarded -- they can be exactly what explains WHY a
// later step (e.g. bootstrap-ready) timed out.
// ============================================================================================

function fakeErrorLedger(events) {
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

test('handlePhase0Failure: already-recorded errorLedger events are merged into the evidence, not discarded', async () => {
  const pageErrorEvent = { kind: 'pageerror', error: describeError(new Error('in-page crash')) };
  const requiredResourceFailureEvent = { kind: 'required-resource-failure', url: `${VIEWER_SCRIPT_URL}` };
  const consoleErrorEvent = { kind: 'console', level: 'error', text: 'Failed to load resource' };
  const ledger = fakeErrorLedger([pageErrorEvent, requiredResourceFailureEvent, consoleErrorEvent]);

  const { evidence } = await handlePhase0Failure(baseArgs({
    error: new Error('bootstrap-ready timed out'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['bootstrap-ready'],
    errorLedger: ledger,
  }));

  assert.deepEqual(evidence.errorLedger.pageErrors, [pageErrorEvent]);
  assert.deepEqual(evidence.errorLedger.consoleErrors, [consoleErrorEvent]);
  // The already-observed required-resource-failure is PRESENT, and the synthetic phase-0-failure
  // entry is APPENDED after it -- neither replaces the other.
  assert.equal(evidence.errorLedger.requiredResourceFailures.length, 2);
  assert.deepEqual(evidence.errorLedger.requiredResourceFailures[0], requiredResourceFailureEvent);
  assert.equal(evidence.errorLedger.requiredResourceFailures[1].kind, 'phase-0-failure');
  assert.equal(evidence.errorLedger.fatalErrorObserved, true);
});

test('handlePhase0Failure: no errorLedger provided -> degrades to empty arrays plus the one synthetic entry, never throws', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({ errorLedger: undefined }));
  assert.deepEqual(evidence.errorLedger.pageErrors, []);
  assert.deepEqual(evidence.errorLedger.consoleErrors, []);
  assert.equal(evidence.errorLedger.requiredResourceFailures.length, 1);
  assert.equal(evidence.errorLedger.requiredResourceFailures[0].kind, 'phase-0-failure');
});

test('handlePhase0Failure: an errorLedger without a summary() function is ignored, never throws', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({ errorLedger: { events: [] } }));
  assert.deepEqual(evidence.errorLedger.pageErrors, []);
  assert.equal(evidence.errorLedger.requiredResourceFailures.length, 1);
});

// ============================================================================================
// Additional structural properties (explicit fields the authorization requires).
// ============================================================================================

test('handlePhase0Failure: records resourcesExisted and cleanupAttempted explicitly, never as an implicit assumption', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({ browserExisted: true, pageExisted: true, contextExisted: true }));
  assert.deepEqual(evidence.resourcesExisted, { browser: true, page: true, context: true });
  assert.equal(evidence.cleanupAttempted, true);
});

test('handlePhase0Failure: resourcesExisted correctly reflects an early failure (e.g. browser launch itself failed) where nothing exists yet', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs({
    error: new Error('chromium.launch() failed'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['browser-launch'],
    browserExisted: false, pageExisted: false, contextExisted: false,
  }));
  assert.deepEqual(evidence.resourcesExisted, { browser: false, page: false, context: false });
  assert.equal(evidence.failureCategory, 'browser-launch-failed');
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
});

test('handlePhase0Failure: startedAt/finishedAt are both non-empty ISO-8601-shaped strings, finishedAt not before startedAt', async () => {
  const startedAt = new Date(Date.now() - 5000).toISOString();
  const { evidence } = await handlePhase0Failure(baseArgs({ startedAt }));
  assert.equal(evidence.startedAt, startedAt);
  assert.ok(typeof evidence.finishedAt === 'string' && evidence.finishedAt.length > 0);
  assert.ok(new Date(evidence.finishedAt).getTime() >= new Date(evidence.startedAt).getTime());
});

test('handlePhase0Failure: classifier is INDETERMINATE_UNAVAILABLE (Phase 0 never reaches the classifier)', async () => {
  const { evidence } = await handlePhase0Failure(baseArgs());
  assert.equal(evidence.classifier, CLASSIFIER.INDETERMINATE_UNAVAILABLE);
  assert.deepEqual(evidence.runtime, { isOTG: null, isSVF2: null });
});
