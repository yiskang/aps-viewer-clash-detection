// test/clashpanel/core/controller.loadTest.test.mjs — spec §26.2 (a)/(c), CTM-1, Work review M1 (editor half).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';

const SAVED = { state: 'saved', timedOut: false, attempt: 1 };
const PENDING = { state: 'pending', timedOut: true, attempt: 1 };
const otherAB = (id = 'T-other') => [
  { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' },
].reduce(draftReduce, createDraft({ testId: id, testNumber: 7 }));

async function sealed(h, persistence = SAVED) {
  await h.readyHard();
  const handle = await h.start();
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence });
  await h.settle();
  return handle;
}
function watch(h) { const ids = []; h.controller.subscribe((vm) => ids.push(vm.test.testId)); return ids; }
const clears = (h) => h.bridge.calls.filter((c) => c.op === 'clear').length;

test('TEST_LOAD adopts the supplied draft, retires the displayed set, forces Soft re-evaluation, notifies once', async () => {
  const h = makeHarness();
  await sealed(h);
  const ids = watch(h);
  const clearsBefore = clears(h);
  const basisBefore = h.catalog.calls.measurementBasis.length;
  const d = otherAB();
  const pending = h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: d, acknowledgeUnsaved: false });
  assert.deepEqual(ids, ['T-other'], 'one SYNCHRONOUS notification, only with the supplied testId');
  const loadedVersion = h.vm().version;
  assert.equal(h.catalog.calls.measurementBasis.length, basisBefore + 1, 'same participants, still re-evaluated (reEvaluateSoft)');
  const out = await pending;
  assert.deepEqual(out, { ok: true, testId: 'T-other', version: loadedVersion, releaseStuck: false });
  assert.equal(h.vm().test.draft, d, 'the supplied frozen draft itself');
  assert.equal(clears(h), clearsBefore + 1);
  assert.equal(h.engine.resident.size, 0, 'outgoing saved set released');
  assert.equal(h.vm().test.lastRun, null);
  assert.equal(h.vm().run.state, 'idle');
  await h.settle();
  assert.ok(ids.every((id) => id === 'T-other'), 'later async notifications (Soft verdict) carry the same testId');
});

for (const [label, intent, reason] of [
  ['empty testId', { testId: '', draft: otherAB() }, 'invalid-test-id'],
  ['missing testId', { draft: otherAB() }, 'invalid-test-id'],
  ['draft for another testId', { testId: 'T-x', draft: otherAB('T-y') }, 'invalid-draft'],
  ['unfrozen draft', { testId: 'T-other', draft: { ...otherAB() } }, 'invalid-draft'],
  ['no draft', { testId: 'T-other' }, 'invalid-draft'],
  // Work plan review M1: exact canonical form and a total validator — still zero mutation and no notification.
  ['draft with an extra field', { testId: 'T-other', draft: Object.freeze({ ...otherAB(), extra: 1 }) }, 'invalid-draft'],
  ['lastRun.revision differing from revision', { testId: 'T-other', draft: Object.freeze({ ...otherAB(), lastRun: Object.freeze({ definitionKey: 'k', revision: 2 }) }) }, 'invalid-draft'],
  ['draft with a throwing accessor', { testId: 'T-other', draft: Object.freeze(Object.defineProperty({ ...otherAB() }, 'name', { get() { throw new Error('hostile'); }, enumerable: true })) }, 'invalid-draft'],
  ['proxy draft with a throwing trap', { testId: 'T-other', draft: new Proxy(otherAB(), { ownKeys() { throw new Error('hostile'); } }) }, 'invalid-draft'],
]) {
  test(`TEST_LOAD rejects ${label} atomically: zero mutation, no notification, no Viewer call`, async () => {
    const h = makeHarness();
    await sealed(h);
    const before = h.vm();
    const ids = watch(h);
    const clearsBefore = clears(h);
    const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, ...intent });
    assert.deepEqual(out, { ok: false, testId: 'test-1', version: before.version, releaseStuck: false, reason });
    assert.equal(h.vm(), before, 'same frozen ViewModel object: nothing changed');
    assert.deepEqual(ids, []);
    assert.equal(clears(h), clearsBefore);
    assert.equal(h.engine.resident.size, 1, 'held set untouched');
  });
}

test('TEST_LOAD is refused while a run is active, and for unsaved results without acknowledgeUnsaved', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.start();
  const running = h.vm();
  assert.equal((await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() })).reason, 'run-active');
  assert.equal(h.vm(), running);

  const u = makeHarness();
  await sealed(u, PENDING);
  const before = u.vm();
  assert.equal((await u.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() })).reason, 'unsaved-results');
  assert.equal(u.vm(), before);
  const ok = await u.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB(), acknowledgeUnsaved: true });
  assert.equal(ok.ok, true);
  assert.equal(u.engine.resident.size, 0, 'unsaved set released only with the acknowledgement');
});

test('TEST_LOAD on a disposed editor resolves {ok:false, reason:"disposed"}', async () => {
  const h = makeHarness();
  await h.controller.dispose();
  const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'disposed');
});

test('a stuck release still loads, reports releaseStuck, keeps the release-error banner and the retry list', async () => {
  const h = makeHarness();
  await sealed(h);
  h.engine.setReleaseFailure(new Error('store down'));
  const out = await h.controller.dispatch({ type: INTENT.TEST_LOAD, testId: 'T-other', draft: otherAB() });
  assert.equal(out.ok, true);
  assert.equal(out.releaseStuck, true);
  assert.ok(h.vm().run.banners.some((b) => b.id === 'release-error'), 'existing release-error banner (viewModel.js controllerBanners)');
  h.engine.setReleaseFailure(null);
});

test('CONFIRM_CANCEL clears the editor confirmation and does nothing else; a no-op without one (§26.2 (c))', async () => {
  const h = makeHarness();
  await h.settle();                                                 // let the construction-time Soft check finish first
  const idle = h.vm();
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.vm(), idle, 'no confirmation pending: nothing happens');
  await sealed(h, PENDING);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().test.pendingConfirm, true);
  await h.dispatch({ type: INTENT.CONFIRM_CANCEL });
  assert.equal(h.vm().test.pendingConfirm, false);
  assert.equal(h.engine.resident.size, 1, 'results still held');
  assert.equal(h.vm().run.state, 'done');
});

test('standalone New test keeps the §23.5 in-place semantics (AC-M13)', async () => {
  const h = makeHarness();
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().test.testId, 'test-2');
  assert.equal(h.vm().test.draft.name, 'Clash test 2');
});

test('seam (e) TEST_LABEL_SCOPE: the editor disambiguates over the supplied scope; identical scope and bad payloads are no-ops (G-A2)', async () => {
  const h = makeHarness({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  h.catalog.removeModel('mB');                                     // mB unloaded: only a referenced scope still knows it
  h.catalog.fire();
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  assert.equal(h.vm().setup.scope.A, 'Arch', 'standalone editor (empty scope): unchanged behavior');
  const viewerCalls = h.bridge.calls.length;
  const ids = watch(h);
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['mB', 'mA', 'mB'] });
  assert.equal(ids.length, 1, 'one notification for a changed scope');
  assert.equal(h.vm().setup.scope.A, 'Arch · …mA');
  assert.equal(h.vm().setup.models.find((m) => m.modelKey === 'mA').displayName, 'Arch · …mA');
  const same = h.vm();
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['mA', 'mB'] });
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: 'mB' });
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE });
  assert.equal(h.vm(), same, 'identical scope / non-array payload: no change, no notification');
  assert.equal(ids.length, 1);
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: [] });
  assert.equal(h.vm().setup.scope.A, 'Arch', 'shrinking the scope invalidates the names again');
  assert.equal(h.bridge.calls.length, viewerCalls, 'never touches the Viewer');
  assert.equal(h.engine.startCalls.length, 0);
});
