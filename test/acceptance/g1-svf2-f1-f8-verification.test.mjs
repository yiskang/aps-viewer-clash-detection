// test/acceptance/g1-svf2-f1-f8-verification.test.mjs
//
// Offline, browser-free unit tests for the Stage-1 "contract" layer of
// test/acceptance/g1-svf2-f1-f8-verification.mjs (readFormat, describeError, the Token state
// machine, computeOverall, and the ControlResult factory/validator). Run under
// `npm run test:offline` (auto-discovered by scripts/run-tests.mjs via the `*.test.mjs`
// naming convention -- no package.json change needed). This file imports only pure functions;
// it never triggers the module's guarded main() entrypoint and never touches a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIFIER,
  CHECK_VERDICT,
  OVERALL_VERDICT,
  CONTROL_STATE,
  INTEGRITY_RESULT,
  TOKEN_STATE,
  readFormat,
  DESCRIBE_ERROR_MAX_DEPTH,
  describeError,
  createToken,
  transitionToken,
  isTokenLive,
  TokenTransitionError,
  CONTROL_RESTORATION_REQUIRED,
  CONTROL_NAMES,
  createControlResult,
  validateControlResult,
  computeOverall,
} from './g1-svf2-f1-f8-verification.mjs';

// ============================================================================================
// readFormat -- §4.1 fail-closed format classifier
// ============================================================================================

function fakeModel(isOTG, isSVF2) {
  const model = {};
  if (isOTG !== undefined) model.isOTG = () => isOTG;
  if (isSVF2 !== undefined) model.isSVF2 = () => isSVF2;
  return model;
}

test('readFormat: otg=true, svf2=true -> CONFIRMED_SVF2', () => {
  const result = readFormat(fakeModel(true, true));
  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_SVF2);
});

test('readFormat: otg=false, svf2=false -> CONFIRMED_NON_SVF2', () => {
  const result = readFormat(fakeModel(false, false));
  assert.equal(result.classifier, CLASSIFIER.CONFIRMED_NON_SVF2);
});

test('readFormat: otg=true, svf2=false (disagree, ordering A) -> CONTRADICTORY', () => {
  const result = readFormat(fakeModel(true, false));
  assert.equal(result.classifier, CLASSIFIER.CONTRADICTORY);
});

test('readFormat: otg=false, svf2=true (disagree, ordering B) -> CONTRADICTORY', () => {
  const result = readFormat(fakeModel(false, true));
  assert.equal(result.classifier, CLASSIFIER.CONTRADICTORY);
});

test('readFormat: only isOTG present (ordering A) -> INDETERMINATE_PARTIAL', () => {
  const result = readFormat(fakeModel(true, undefined));
  assert.equal(result.classifier, CLASSIFIER.INDETERMINATE_PARTIAL);
  assert.equal(result.otg, true);
  assert.equal(result.svf2, 'UNAVAILABLE');
});

test('readFormat: only isSVF2 present (ordering B) -> INDETERMINATE_PARTIAL', () => {
  const result = readFormat(fakeModel(undefined, true));
  assert.equal(result.classifier, CLASSIFIER.INDETERMINATE_PARTIAL);
  assert.equal(result.otg, 'UNAVAILABLE');
  assert.equal(result.svf2, true);
});

test('readFormat: neither isOTG nor isSVF2 present -> INDETERMINATE_UNAVAILABLE', () => {
  const result = readFormat({});
  assert.equal(result.classifier, CLASSIFIER.INDETERMINATE_UNAVAILABLE);
  assert.equal(result.otg, 'UNAVAILABLE');
  assert.equal(result.svf2, 'UNAVAILABLE');
});

// ============================================================================================
// describeError -- §4.2 bounded, JSON-safe, secret-redacting serializer
// ============================================================================================

test('describeError: plain Error instance', () => {
  const err = new Error('boom');
  const result = describeError(err);
  assert.equal(result.name, 'Error');
  assert.equal(result.message, 'boom');
  assert.equal(result.code, null);
  assert.equal(result.reason, null);
  assert.equal(typeof result.stack, 'string');
  assert.equal(result.truncated, false);
  assert.deepEqual(result.redactions, []);
});

test('describeError: circular reference is detected and broken, never thrown', () => {
  const err = { name: 'CircErr', message: 'self-referential' };
  err.details = { self: err };
  const result = describeError(err);
  assert.deepEqual(result.details.self, { circular: true });
});

test('describeError: a typed array field is normalized to a plain, serializable structure', () => {
  const err = { name: 'TypedErr', message: 'has buffer', details: { payload: new Uint8Array([1, 2, 3, 4, 5]) } };
  const result = describeError(err);
  assert.deepEqual(result.details.payload, {
    typedArray: 'Uint8Array',
    length: 5,
    sample: [1, 2, 3, 4, 5],
    truncated: false,
  });
});

test('describeError: a bearer-token-shaped string is redacted and recorded in redactions', () => {
  const err = new Error('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz.123456');
  const result = describeError(err);
  assert.equal(result.message.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
  assert.ok(result.message.includes('[REDACTED]'));
  assert.ok(result.redactions.length >= 1);
});

test('describeError: a deeply nested object is truncated at the documented depth cap, never silently dropped', () => {
  function buildNested(depth) {
    if (depth === 0) return { marker: 'LEAF_SHOULD_NOT_APPEAR' };
    return { child: buildNested(depth - 1) };
  }
  // Nested well past DESCRIBE_ERROR_MAX_DEPTH so the leaf marker cannot survive.
  const err = { name: 'DeepError', message: 'nested', details: buildNested(DESCRIBE_ERROR_MAX_DEPTH + 4) };
  const result = describeError(err);
  assert.equal(result.truncated, true, 'top-level truncated flag must be set');
  assert.equal(JSON.stringify(result).includes('LEAF_SHOULD_NOT_APPEAR'), false, 'the marker beyond the depth cap must never appear');
  assert.equal(JSON.stringify(result).includes('"truncated":true'), true, 'a truncated:true marker must appear at the cap boundary, not a silent drop');
});

test('describeError: Document.load-style rejection ({code, message, errors}) retains structured detail', () => {
  const rejection = {
    code: 'LOAD_FAILED',
    message: 'load error',
    errors: [{ code: 4, message: 'net::ERR_CONNECTION_RESET' }],
  };
  const result = describeError(rejection);
  assert.equal(result.code, 'LOAD_FAILED');
  assert.equal(result.message, 'load error');
  assert.equal(Array.isArray(result.errors), true);
  assert.deepEqual(result.errors[0], { code: 4, message: 'net::ERR_CONNECTION_RESET' });
});

test('describeError: null/undefined input never throws', () => {
  assert.equal(describeError(null).message, 'null');
  assert.equal(describeError(undefined).message, 'undefined');
});

// ============================================================================================
// Token state machine -- §6.4a named paragraphs (generic per-operation token)
// ============================================================================================

test('Token: mints a unique id and starts in state "active"', () => {
  const token = createToken({ operation: 'test-op' });
  assert.equal(token.state, TOKEN_STATE.ACTIVE);
  assert.equal(typeof token.id, 'string');
  assert.ok(token.id.length > 0);
});

test('Token: two hundred minted tokens never share an id', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(createToken().id);
  assert.equal(ids.size, 200);
});

test('Token: legal transition active -> completed succeeds', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.COMPLETED);
  assert.equal(token.state, TOKEN_STATE.COMPLETED);
});

test('Token: legal transition active -> timed-out succeeds', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.TIMED_OUT);
  assert.equal(token.state, TOKEN_STATE.TIMED_OUT);
});

test('Token: legal transition active -> disposed succeeds', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.DISPOSED);
  assert.equal(token.state, TOKEN_STATE.DISPOSED);
});

test('Token: legal transition timed-out -> abandoned (the one post-teardown transition) succeeds', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.TIMED_OUT);
  transitionToken(token, TOKEN_STATE.ABANDONED);
  assert.equal(token.state, TOKEN_STATE.ABANDONED);
});

test('Token: illegal transition completed -> timed-out is rejected', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.COMPLETED);
  assert.throws(() => transitionToken(token, TOKEN_STATE.TIMED_OUT), TokenTransitionError);
  assert.equal(token.state, TOKEN_STATE.COMPLETED, 'a rejected transition must leave the token unmodified');
});

test('Token: illegal transition disposed -> abandoned is rejected', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.DISPOSED);
  assert.throws(() => transitionToken(token, TOKEN_STATE.ABANDONED), TokenTransitionError);
});

test('Token: illegal transition active -> abandoned directly (skipping timed-out) is rejected', () => {
  const token = createToken();
  assert.throws(() => transitionToken(token, TOKEN_STATE.ABANDONED), TokenTransitionError);
});

test('Token: illegal transition timed-out -> completed is rejected', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.TIMED_OUT);
  assert.throws(() => transitionToken(token, TOKEN_STATE.COMPLETED), TokenTransitionError);
});

test('Token: illegal transition timed-out -> disposed is rejected', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.TIMED_OUT);
  assert.throws(() => transitionToken(token, TOKEN_STATE.DISPOSED), TokenTransitionError);
});

test('Token: illegal transition out of the terminal state abandoned is rejected', () => {
  const token = createToken();
  transitionToken(token, TOKEN_STATE.TIMED_OUT);
  transitionToken(token, TOKEN_STATE.ABANDONED);
  assert.throws(() => transitionToken(token, TOKEN_STATE.COMPLETED), TokenTransitionError);
});

test('isTokenLive: true only while active, false in every other state', () => {
  const active = createToken();
  assert.equal(isTokenLive(active), true);

  const completed = createToken();
  transitionToken(completed, TOKEN_STATE.COMPLETED);
  assert.equal(isTokenLive(completed), false);

  const disposed = createToken();
  transitionToken(disposed, TOKEN_STATE.DISPOSED);
  assert.equal(isTokenLive(disposed), false);

  const abandoned = createToken();
  transitionToken(abandoned, TOKEN_STATE.TIMED_OUT);
  transitionToken(abandoned, TOKEN_STATE.ABANDONED);
  assert.equal(isTokenLive(abandoned), false);

  const timedOut = createToken();
  transitionToken(timedOut, TOKEN_STATE.TIMED_OUT);
  assert.equal(isTokenLive(timedOut), false, 'timed-out is not live -- it is the drain/abandon-pending state');
});

// ============================================================================================
// ControlResult factory/validator -- §6.3a
// ============================================================================================

test('CONTROL_RESTORATION_REQUIRED: exactly the nine mandatory controls with their fixed classification', () => {
  assert.deepEqual(CONTROL_NAMES, [
    'tree-unavailable',
    'wrong-owner',
    'late-completion-after-timeout',
    'hidden-fragment',
    'invalid-geometry-consumer',
    'capacity-breach',
    'invalid-bounds',
    'bounds-beyond-tolerance',
    'stale-old-model-event',
  ]);
  assert.deepEqual(CONTROL_RESTORATION_REQUIRED, {
    'tree-unavailable': true,
    'wrong-owner': true,
    'late-completion-after-timeout': false,
    'hidden-fragment': true,
    'invalid-geometry-consumer': false,
    'capacity-breach': true,
    'invalid-bounds': true,
    'bounds-beyond-tolerance': true,
    'stale-old-model-event': true,
  });
});

test('createControlResult: a valid record for each of the 5 states passes', () => {
  const detectedRestored = createControlResult('tree-unavailable', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  assert.equal(detectedRestored.state, CONTROL_STATE.DETECTED_RESTORED);
  assert.equal(detectedRestored.restorationRequired, true);

  const notDetected = createControlResult('wrong-owner', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored: true, reason: 'harness-guard-defect' });
  assert.equal(notDetected.state, CONTROL_STATE.NOT_DETECTED);

  const restoreFailed = createControlResult('capacity-breach', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false, reason: 'restore-assertion-failed' });
  assert.equal(restoreFailed.state, CONTROL_STATE.RESTORE_FAILED);

  const timedOut = createControlResult('invalid-bounds', { state: CONTROL_STATE.TIMED_OUT, executed: true, detected: null, restored: null, reason: 'perturbation-timeout' });
  assert.equal(timedOut.state, CONTROL_STATE.TIMED_OUT);

  const notExecutable = createControlResult('late-completion-after-timeout', { state: CONTROL_STATE.NOT_EXECUTABLE, executed: false, detected: null, restored: null, reason: 'blocked-by-fatal' });
  assert.equal(notExecutable.state, CONTROL_STATE.NOT_EXECUTABLE);
  assert.equal(notExecutable.restorationRequired, false, 'late-completion-after-timeout is an isolated synthetic control, restorationRequired must be false');
});

test('validateControlResult: rejects a restorationRequired value that disagrees with CONTROL_RESTORATION_REQUIRED', () => {
  const malformed = {
    state: CONTROL_STATE.DETECTED_RESTORED,
    executed: true,
    detected: true,
    restored: true,
    restorationRequired: false, // wrong -- 'tree-unavailable' is fixed to true
    reason: null,
  };
  const validation = validateControlResult('tree-unavailable', malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('restorationRequired')));
});

test('validateControlResult: rejects an out-of-enum state', () => {
  const malformed = { state: 'BOGUS_STATE', executed: true, detected: true, restored: true, restorationRequired: true, reason: null };
  const validation = validateControlResult('tree-unavailable', malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes('state')));
});

test('createControlResult: throws rather than permissively emitting DETECTED_RESTORED for an unearned input', () => {
  assert.throws(() => createControlResult('tree-unavailable', { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: false, restored: true }));
});

// ============================================================================================
// computeOverall -- §6.3 six-branch precedence
// ============================================================================================

function cleanChecks() {
  return { F1: CHECK_VERDICT.PASS, F2: CHECK_VERDICT.PASS, F3: CHECK_VERDICT.PASS, F4: CHECK_VERDICT.PASS, F5: CHECK_VERDICT.PASS, F6: CHECK_VERDICT.PASS, F7: CHECK_VERDICT.PASS, F8: CHECK_VERDICT.PASS };
}

function cleanControls() {
  const controls = {};
  for (const name of CONTROL_NAMES) {
    controls[name] = createControlResult(name, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  }
  return controls;
}

function baseCleanInput(overrides = {}) {
  return {
    fatalErrorObserved: false,
    cleanupUnresolvedOwnership: false,
    viewerScriptIntegrity: INTEGRITY_RESULT.VERIFIED,
    classifier: CLASSIFIER.CONFIRMED_SVF2,
    checks: cleanChecks(),
    controls: cleanControls(),
    cleanupFailures: [],
    ...overrides,
  };
}

// -- Branch 1: fatal / cleanup-unresolved / integrity-fail(-closed) --

test('computeOverall branch 1: fatalErrorObserved -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ fatalErrorObserved: true })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1: cleanupUnresolvedOwnership -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ cleanupUnresolvedOwnership: true })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1: viewerScriptIntegrity MISMATCH -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.MISMATCH })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1: viewerScriptIntegrity FETCH_FAILED -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.FETCH_FAILED })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1 (fail-closed): missing viewerScriptIntegrity -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: undefined })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1 (fail-closed): null viewerScriptIntegrity -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: null })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 1 (fail-closed): out-of-enum viewerScriptIntegrity -> FAIL', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: 'NOT_A_REAL_VALUE' })), OVERALL_VERDICT.FAIL);
});

// -- Branch 2: classifier stop --

test('computeOverall branch 2: classifier != CONFIRMED_SVF2 -> BLOCKED', () => {
  assert.equal(computeOverall(baseCleanInput({ classifier: CLASSIFIER.CONFIRMED_NON_SVF2 })), OVERALL_VERDICT.BLOCKED);
  assert.equal(computeOverall(baseCleanInput({ classifier: CLASSIFIER.CONTRADICTORY })), OVERALL_VERDICT.BLOCKED);
  assert.equal(computeOverall(baseCleanInput({ classifier: CLASSIFIER.INDETERMINATE_PARTIAL })), OVERALL_VERDICT.BLOCKED);
  assert.equal(computeOverall(baseCleanInput({ classifier: CLASSIFIER.INDETERMINATE_UNAVAILABLE })), OVERALL_VERDICT.BLOCKED);
});

// -- Branch 3: any Fi FAIL or any mandatory control != DETECTED_RESTORED --

test('computeOverall branch 3: an Fi FAIL -> FAIL', () => {
  const checks = { ...cleanChecks(), F4: CHECK_VERDICT.FAIL };
  assert.equal(computeOverall(baseCleanInput({ checks })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 3: a mandatory control not DETECTED_RESTORED -> FAIL', () => {
  const controls = cleanControls();
  controls['wrong-owner'] = createControlResult('wrong-owner', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored: true });
  assert.equal(computeOverall(baseCleanInput({ controls })), OVERALL_VERDICT.FAIL);
});

test('computeOverall branch 3: a missing control record is treated as non-DETECTED_RESTORED -> FAIL', () => {
  const controls = cleanControls();
  delete controls['hidden-fragment'];
  assert.equal(computeOverall(baseCleanInput({ controls })), OVERALL_VERDICT.FAIL);
});

// -- Branch 4: identity unavailable/ambiguous, nothing left to bury --

test('computeOverall branch 4: viewerScriptIntegrity CAPTURE_UNAVAILABLE (all else clean) -> BLOCKED', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.BLOCKED);
});

test('computeOverall branch 4: viewerScriptIntegrity PROVENANCE_AMBIGUOUS (all else clean) -> BLOCKED', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS })), OVERALL_VERDICT.BLOCKED);
});

// -- Branch 5: all-clean PASS --

test('computeOverall branch 5: fully clean run -> PASS', () => {
  assert.equal(computeOverall(baseCleanInput()), OVERALL_VERDICT.PASS);
});

// -- Branch 6: default PARTIAL --

test('computeOverall branch 6: an Fi BLOCKED (no failure) -> PARTIAL', () => {
  const checks = { ...cleanChecks(), F3: CHECK_VERDICT.BLOCKED };
  assert.equal(computeOverall(baseCleanInput({ checks })), OVERALL_VERDICT.PARTIAL);
});

test('computeOverall branch 6: an Fi NOT_EVIDENCED (no failure) -> PARTIAL', () => {
  const checks = { ...cleanChecks(), F5: CHECK_VERDICT.NOT_EVIDENCED };
  assert.equal(computeOverall(baseCleanInput({ checks })), OVERALL_VERDICT.PARTIAL);
});

test('computeOverall branch 6: a non-empty (resolved-ownership) cleanupFailures list -> PARTIAL', () => {
  assert.equal(computeOverall(baseCleanInput({ cleanupFailures: [{ step: 'remove-listener', resolved: true }] })), OVERALL_VERDICT.PARTIAL);
});

// -- Worked negative cases (plan §6.3, lines ~800): each assumes every Fi PASS, all nine
//    controls DETECTED_RESTORED, cleanupFailures empty -- i.e. exactly the run that would
//    otherwise have yielded PASS. --

test('worked negative case (i)/(ii)/(iii): same-URL/redirect/service-worker MISMATCH -> FAIL, never PASS', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.MISMATCH })), OVERALL_VERDICT.FAIL);
});

test('worked negative case (iv): body unavailable -> CAPTURE_UNAVAILABLE -> BLOCKED, never PASS', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.BLOCKED);
});

test('worked negative case (v): captured body matches but a second, uncaptured serve occurred -> PROVENANCE_AMBIGUOUS -> BLOCKED, never PASS', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS })), OVERALL_VERDICT.BLOCKED);
});

// -- Worked cases proving a real failure is never buried by unresolved identity (plan §6.3,
//    lines ~802): each assumes viewerScriptIntegrity is CAPTURE_UNAVAILABLE or
//    PROVENANCE_AMBIGUOUS -- i.e. exactly the condition that, before this precedence fix,
//    produced BLOCKED regardless of anything else. --

test('worked case (i): an Fi FAIL with unresolved identity -> FAIL, not BLOCKED', () => {
  const checks = { ...cleanChecks(), F4: CHECK_VERDICT.FAIL };
  assert.equal(computeOverall(baseCleanInput({ checks, viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.FAIL);
});

test('worked case (ii): a mandatory control NOT_DETECTED with unresolved identity -> FAIL, not BLOCKED', () => {
  const controls = cleanControls();
  controls['wrong-owner'] = createControlResult('wrong-owner', { state: CONTROL_STATE.NOT_DETECTED, executed: true, detected: false, restored: true });
  assert.equal(computeOverall(baseCleanInput({ controls, viewerScriptIntegrity: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS })), OVERALL_VERDICT.FAIL);
});

test('worked case (iii): a mandatory control RESTORE_FAILED with unresolved identity -> FAIL, not BLOCKED', () => {
  const controls = cleanControls();
  controls['capacity-breach'] = createControlResult('capacity-breach', { state: CONTROL_STATE.RESTORE_FAILED, executed: true, detected: true, restored: false });
  assert.equal(computeOverall(baseCleanInput({ controls, viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.FAIL);
});

test('worked case (iv): cleanupUnresolvedOwnership true (with unresolved identity too) -> FAIL via branch 1, before classifier/Fi/control evaluation', () => {
  assert.equal(computeOverall(baseCleanInput({ cleanupUnresolvedOwnership: true, viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.FAIL);
});

test('worked case (v): no Fi FAIL, no non-DETECTED_RESTORED control, cleanupFailures empty, but identity CAPTURE_UNAVAILABLE/PROVENANCE_AMBIGUOUS -> BLOCKED (nothing left to bury)', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE })), OVERALL_VERDICT.BLOCKED);
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS })), OVERALL_VERDICT.BLOCKED);
});

test('worked case (vi): viewerScriptIntegrity VERIFIED and every other condition clean -> PASS', () => {
  assert.equal(computeOverall(baseCleanInput({ viewerScriptIntegrity: INTEGRITY_RESULT.VERIFIED })), OVERALL_VERDICT.PASS);
});
