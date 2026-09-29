// test/acceptance/g1-svf2-f1-f8-verification.cleanupliveness.test.mjs
//
// H2-R1 (bounded remediation): real Playwright liveness adapters for runCleanup's closePage/
// closeContext/closeBrowser steps. Offline only -- fake Playwright-like objects exposing
// isClosed()/isConnected(); every case goes through the real exported adapter helper.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCleanup,
  buildPlaywrightCleanupResources,
  computeOverall,
  CHECK_VERDICT,
  CONTROL_NAMES,
  CONTROL_STATE,
  CLASSIFIER,
  INTEGRITY_RESULT,
  OVERALL_VERDICT,
  createControlResult,
} from './g1-svf2-f1-f8-verification.mjs';

const never = () => new Promise(() => {});

function baseResources(overrides = {}) {
  return {
    tokens: [], timers: [], abortControllers: [], f3Listener: null,
    f6: { ran: false, probeListener: null, reloadProbeListener: null, wiring: null },
    controlPatches: [], viewer: { getAllModels: () => [], unloadModel: () => {} },
    modelBefore: null, modelAfter: null, registry: null, registryKey: null, world: null,
    httpServer: null, ...overrides,
  };
}

function fakePage({ closed, close = never } = {}) { return { close, isClosed: () => closed }; }
function fakeBrowser({ connected, close = never } = {}) { return { close, isConnected: () => connected }; }

function cleanInput(result) {
  const checks = {}; for (const k of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']) checks[k] = CHECK_VERDICT.PASS;
  const controls = {};
  for (const n of CONTROL_NAMES) controls[n] = createControlResult(n, { state: CONTROL_STATE.DETECTED_RESTORED, executed: true, detected: true, restored: true });
  return {
    fatalErrorObserved: false, cleanupUnresolvedOwnership: result.cleanupUnresolvedOwnership,
    viewerScriptIntegrity: INTEGRITY_RESULT.VERIFIED, classifier: CLASSIFIER.CONFIRMED_SVF2,
    checks, controls, cleanupFailures: result.cleanupFailures,
    controlTargets: { 'wrong-owner': { controlName: 'wrong-owner', selectedFragId: 7, selectedOwnerDbId: 42, injectedOwnerDbId: -999999, selectionSource: 'f1PopulationRecords', selectionRule: 'numeric-minimum', populationSize: 3 }, 'hidden-fragment': { controlName: 'hidden-fragment', selectedFragId: 4242, selectedTreeOwnerDbId: 9, actedOnFragId: 4242, selectionSource: 'f2TreeOwnerByFragId-intersect-f1PopulationClasses-L', selectionRule: 'numeric-minimum', populationSize: 5 } },
  };
}

async function run(pw) {
  return runCleanup(baseResources(buildPlaywrightCleanupResources(pw)), { closeTimeoutMs: 20 });
}

test('adapter: null/absent resources stay null; adapters expose close/confirmStillAlive/livenessObservation', () => {
  assert.deepEqual(buildPlaywrightCleanupResources({}), { page: null, context: null, browser: null });
  const a = buildPlaywrightCleanupResources({ page: fakePage({ closed: false }), context: { close() {}, isClosed: () => true }, browser: fakeBrowser({ connected: true }) });
  assert.equal(a.page.livenessObservation, 'page.isClosed()');
  assert.equal(a.context.livenessObservation, 'context.isClosed()');
  assert.equal(a.browser.livenessObservation, 'browser.isConnected()');
  assert.equal(a.page.confirmStillAlive(), true);
  assert.equal(a.context.confirmStillAlive(), false);
  assert.equal(a.browser.confirmStillAlive(), true);
  assert.equal(typeof a.page.close, 'function');
});

test('page close timeout + isClosed()===false -> unresolved, evidence, overall FAIL', { timeout: 2000 }, async () => {
  const r = await run({ page: fakePage({ closed: false }) });
  assert.equal(r.cleanupUnresolvedOwnership, true);
  const f = r.cleanupFailures.find((x) => x.step === 'closePage');
  assert.equal(f.resourceType, 'page');
  assert.equal(f.livenessObservation, 'page.isClosed()===false');
  assert.equal(f.ownership, 'unresolved');
  assert.equal(computeOverall(cleanInput(r)), OVERALL_VERDICT.FAIL);
});

test('context close timeout + isClosed()===false -> unresolved, evidence, overall FAIL', { timeout: 2000 }, async () => {
  const r = await run({ context: { close: never, isClosed: () => false } });
  assert.equal(r.cleanupUnresolvedOwnership, true);
  const f = r.cleanupFailures.find((x) => x.step === 'closeContext');
  assert.equal(f.resourceType, 'context');
  assert.equal(f.livenessObservation, 'context.isClosed()===false');
  assert.equal(f.ownership, 'unresolved');
  assert.equal(computeOverall(cleanInput(r)), OVERALL_VERDICT.FAIL);
});

test('browser close timeout + isConnected()===true -> unresolved, evidence, overall FAIL', { timeout: 2000 }, async () => {
  const r = await run({ browser: fakeBrowser({ connected: true }) });
  assert.equal(r.cleanupUnresolvedOwnership, true);
  const f = r.cleanupFailures.find((x) => x.step === 'closeBrowser');
  assert.equal(f.resourceType, 'browser');
  assert.equal(f.livenessObservation, 'browser.isConnected()===true');
  assert.equal(f.ownership, 'unresolved');
  assert.equal(computeOverall(cleanInput(r)), OVERALL_VERDICT.FAIL);
});

test('close rejects/times out but resource is confirmed closed/disconnected -> NOT unresolved (PARTIAL)', { timeout: 2000 }, async () => {
  const r = await run({
    page: fakePage({ closed: true }),
    context: { close: () => Promise.reject(new Error('boom')), isClosed: () => true },
    browser: fakeBrowser({ connected: false }),
  });
  assert.equal(r.cleanupUnresolvedOwnership, false);
  for (const s of ['closePage', 'closeContext', 'closeBrowser']) {
    const f = r.cleanupFailures.find((x) => x.step === s);
    assert.ok(f);
    assert.equal(f.ownership, undefined);
  }
  assert.equal(computeOverall(cleanInput(r)), OVERALL_VERDICT.PARTIAL);
});

test('a wedged alive page does not block later steps; later resources still closed', { timeout: 2000 }, async () => {
  const calls = [];
  const r = await run({
    page: fakePage({ closed: false }),
    context: { close: async () => { calls.push('context'); }, isClosed: () => true },
    browser: { close: async () => { calls.push('browser'); }, isConnected: () => false },
  });
  assert.deepEqual(calls, ['context', 'browser']);
  assert.equal(r.stepStatus.closePage, 'threw');
  assert.equal(r.stepStatus.closeContext, 'ran');
  assert.equal(r.stepStatus.closeBrowser, 'ran');
  assert.equal(r.stepStatus.evidenceWriterState, 'ran');
  assert.equal(r.cleanupUnresolvedOwnership, true);
});

test('liveness API throwing -> indeterminate: not unresolved, no escape, failure still recorded', { timeout: 2000 }, async () => {
  const r = await run({
    page: { close: never, isClosed: () => { throw new Error('target gone'); } },
    browser: { close: never, isConnected: () => { throw new Error('conn gone'); } },
  });
  assert.equal(r.cleanupUnresolvedOwnership, false);
  assert.equal(r.stepStatus.closePage, 'threw');
  assert.equal(r.stepStatus.closeBrowser, 'threw');
  assert.equal(r.stepStatus.evidenceWriterState, 'ran');
  const f = r.cleanupFailures.find((x) => x.step === 'closePage');
  assert.ok(f);
  assert.equal(f.ownership, undefined);
});

test('liveness absent (raw resource without adapter) -> indeterminate, existing classification kept', { timeout: 2000 }, async () => {
  const r = await runCleanup(baseResources({ page: { close: never } }), { closeTimeoutMs: 20 });
  assert.equal(r.cleanupUnresolvedOwnership, false);
  assert.equal(r.cleanupFailures.find((x) => x.step === 'closePage').ownership, undefined);
});

test('evidence fields survive JSON serialization into the final result shape', { timeout: 2000 }, async () => {
  const r = await run({ page: fakePage({ closed: false }), browser: fakeBrowser({ connected: true }) });
  const persisted = JSON.parse(JSON.stringify({ cleanupFailures: r.cleanupFailures, cleanupUnresolvedOwnership: r.cleanupUnresolvedOwnership }));
  assert.equal(persisted.cleanupUnresolvedOwnership, true);
  const p = persisted.cleanupFailures.find((x) => x.step === 'closePage');
  assert.deepEqual({ resourceType: p.resourceType, livenessObservation: p.livenessObservation, ownership: p.ownership },
    { resourceType: 'page', livenessObservation: 'page.isClosed()===false', ownership: 'unresolved' });
  assert.ok(p.error && p.error.message, 'original error retained');
  const b = persisted.cleanupFailures.find((x) => x.step === 'closeBrowser');
  assert.equal(b.livenessObservation, 'browser.isConnected()===true');
});
