// test/clashpanel/core/testsManager.core.test.mjs — spec §26.2/§26.2a/§26.4/§26.8 with a scriptable editor (§26.11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { draftReduce } from '../../../clashpanel/core/draft.js';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { makeManagerHarness, lastRunOf, defaultLoad } from '../support/fakeEditor.mjs';

const loads = (h) => h.editor.dispatched.filter((i) => i.type === INTENT.TEST_LOAD);
const MODELS_AB = Object.freeze([{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }]);
/** The active record references mA (Set A) and mB (Set B) and has a sealed summary over both. */
function referencingAB(h) {
  const draft = [{ type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' }].reduce(draftReduce, h.editor.test.draft);
  h.editor.set({ draft, lastRun: lastRunOf('run-1', 2, { models: MODELS_AB }) });
  assert.equal(h.row('test-1').readiness.state, 'setup-complete');
  assert.equal(h.row('test-1').modelsChanged, false);
}

test('construction asserts the editor surface, the ports and the editor test snapshot', () => {
  const h = makeManagerHarness();
  assert.throws(() => createTestsManager({ ...h.ports, editor: {} }), /editor\.getViewModel is required/);
  assert.throws(() => createTestsManager({ ...h.ports, bridge: {} }), /bridge\.onModelLeft is required/);
  assert.throws(() => createTestsManager({ ...h.ports, editor: { ...h.editor, getViewModel: () => ({ version: 0 }) } }), /no valid `test` snapshot/);
});

test('the initial record is the editor test ("Clash test 1"), active, in the editor view', () => {
  const h = makeManagerHarness();
  const vm = h.vm();
  assert.equal(vm.view, 'editor');
  assert.equal(vm.activeTestId, 'test-1');
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.name, t.active]), [['test-1', 'Clash test 1', true]]);
  assert.equal(h.manager.getViewModel().editor, h.editor.getViewModel());
  assert.equal(h.manager.getViewModel(), h.manager.getViewModel(), 'identity-stable between changes');
});

test('draft sync by identity and summary reduction once per runId; Clear results keeps the summary (§26.2a)', () => {
  const h = makeManagerHarness();
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Walls' }) });
  assert.equal(h.row('test-1').name, 'Walls');
  h.editor.set({ lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported');
  assert.equal(h.row('test-1').resultsText, null);
  h.editor.set({}, { runPatch: { state: 'idle' } });
  assert.equal(h.row('test-1').status.text, 'Completed — 2 clashes reported');
  assert.equal(h.row('test-1').resultsText, 'Results not held — open and re-run to view');
});

test('AC-M1: Create mints a testId and the next "Clash test <N>", loads it and commits on the exact testId', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  const [load] = loads(h);
  assert.equal(load.testId, 'new-1');
  assert.equal(load.draft.testId, 'new-1');
  assert.equal(load.draft.name, 'Clash test 2');
  assert.equal(load.acknowledgeUnsaved, false);
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'new-1');
  assert.equal(vm.view, 'editor');
  assert.equal(vm.count, 2);
  assert.equal(vm.live, 'Created “Clash test 2”.');
  assert.equal(h.row('test-1').active, false);
});

test('Create is refused while a run is active: no load is dispatched', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: 0 } } });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(loads(h).length, 0);
  assert.deepEqual(h.vm().create, { enabled: false, reason: 'Stop the running test first.' });
});

test('Open loads the record\'s exact draft and testId; opening the active test only switches the view (§26.8)', async () => {
  const h = makeManagerHarness();
  const initial = h.editor.test.draft;
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });
  const before = h.editor.dispatched.length;
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  assert.equal(h.editor.dispatched.length, before, 'nothing reaches the editor');
  assert.equal(h.vm().view, 'editor');
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'test-1' });
  const load = loads(h).at(-1);
  assert.equal(load.testId, 'test-1');
  assert.equal(load.draft, initial, 'the snapshotted frozen draft itself');
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().live, 'Opened “Clash test 1”.');
});

test('AC-M16: a refused Create leaves activeTestId unchanged, removes the new record and shows a notice', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => ({ ok: false, testId: editor.test.testId, version: 1, releaseStuck: false, reason: 'run-active' }));
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().activeTestId, 'test-1');
  assert.equal(h.vm().count, 1);
  assert.equal(h.vm().notice, 'Could not create “Clash test 2”: stop the running test first.');
});

test('AC-M7: Duplicate adds "<name> copy"/"copy 2" with new testIds, keeps the active test, and is allowed while running', async () => {
  const h = makeManagerHarness();
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  const vm = h.vm();
  assert.deepEqual(vm.tests.map((t) => [t.testId, t.name]), [['test-1', 'Clash test 1'], ['new-1', 'Clash test 1 copy'], ['new-2', 'Clash test 1 copy 2']]);
  assert.equal(vm.activeTestId, 'test-1');
  assert.equal(loads(h).length, 0);
  assert.deepEqual(h.row('new-1').status, { kind: 'not-run', text: 'Not run' });
  assert.equal(vm.live, 'Duplicated “Clash test 1” as “Clash test 1 copy 2”.');
});

test('duplicating the active test reads its CURRENT draft even before the notification was observed', async () => {
  const h = makeManagerHarness();
  h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value: 'Unseen edit' }) }, { notify: false });
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.equal(h.row('new-1').name, 'Unseen edit copy');
});

test('§26.8 routing: SETUP_NEW_TEST performs Create; a UI TEST_LOAD is dropped; other intents reach the editor unchanged', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().count, 2);
  assert.equal(h.editor.dispatched.some((i) => i.type === INTENT.SETUP_NEW_TEST), false);
  const n = h.editor.dispatched.length;
  await h.dispatch({ type: INTENT.TEST_LOAD, testId: 'test-1', draft: h.editor.test.draft });
  assert.equal(h.editor.dispatched.length, n);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'x' });
  assert.deepEqual(h.editor.dispatched.at(-1), { type: INTENT.SETUP_NAME, value: 'x' });
  assert.throws(() => h.manager.dispatch(null), { name: 'TypeError' });
});

test('§26.3: with unsaved held results Open creates an awaiting pending operation and dispatches nothing', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  h.editor.set({ heldUnsaved: true, lastRun: lastRunOf('run-1', 2) }, { runPatch: { state: 'done' } });
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'new-1' });
  assert.equal(loads(h).length, 0);
  const vm = h.vm();
  assert.deepEqual(vm.pending, { operationId: 'op-1', kind: 'switch', sourceTestId: 'test-1', targetTestId: 'new-1' });
  assert.match(vm.confirm.text, /Opening another test discards them/);
  assert.equal(vm.tests[1].actions.duplicate.enabled, false);
});

test('a colliding, empty or throwing minted id is refused before any record mutation (Codex plan review I3)', async () => {
  for (const bad of [() => 'test-1', () => '', () => { throw new Error('no entropy'); }]) {
    const h = makeManagerHarness({ mintId: bad });
    await h.dispatch({ type: MANAGER_INTENT.CREATE });
    await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
    const vm = h.vm();
    assert.equal(vm.count, 1);
    assert.equal(vm.tests[0].name, 'Clash test 1', 'the existing record is never overwritten');
    assert.equal(loads(h).length, 0);
    assert.equal(vm.notice, 'A new test id could not be created; nothing was changed.');
  }
});

test('run-progress notifications that change no record do not recompute names/readiness (Codex plan review Q1)', () => {
  const h = makeManagerHarness();
  h.manager.getViewModel();
  const listCalls = h.catalog.calls.list;
  for (let i = 1; i <= 50; i += 1) {
    h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: i } } });
    h.manager.getViewModel();
  }
  assert.equal(h.catalog.calls.list, listCalls, 'derived rows reused');
  assert.equal(h.row('test-1').status.text, 'Running — 50 found', 'the live status still follows the editor');
  h.catalog.fire();
  h.manager.getViewModel();
  assert.ok(h.catalog.calls.list > listCalls, 'a §26.6 trigger recomputes');
});

test('catalog changes and model-left events rebuild the ViewModel without any engine run call', () => {
  const h = makeManagerHarness();
  const v1 = h.manager.getViewModel();
  h.catalog.fire();
  const v2 = h.manager.getViewModel();
  assert.notEqual(v2, v1);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.notEqual(h.manager.getViewModel(), v2);
  assert.equal(h.engine.startCalls.length, 0);
});

test('H1 / AC-M10: a model-left event ALONE — catalog and binding snapshot unchanged — marks referencing rows missing and changed at once', () => {
  const h = makeManagerHarness();
  referencingAB(h);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.deepEqual(h.catalog.list().map((e) => e.modelKey), ['mA', 'mB'], 'the catalog still lists mB (BEFORE_MODEL_UNLOAD precedes any catalog change)');
  assert.notEqual(h.engine.registry.bindingFor('mB'), null, 'and its binding is still readable');
  const row = h.row('test-1');
  assert.equal(row.readiness.state, 'models-missing');
  assert.equal(row.readiness.text, 'Structure is not loaded');
  assert.equal(row.modelsChanged, true);
  assert.equal(row.modelsChangedText, 'Models changed since this run');
  assert.equal(row.setB, 'Structure (not loaded)');
  h.catalog.fire();                                                // a catalog notification that STILL lists mB reconciles nothing
  assert.equal(h.row('test-1').readiness.state, 'models-missing');
  assert.equal(h.row('test-1').modelsChanged, true);
  h.bridge.fireModelLeft({ model: { unknown: true }, reason: 'removed' });   // a model without a key attributes nothing
  assert.equal(h.row('test-1').readiness.text, 'Structure is not loaded');
  assert.equal(h.engine.startCalls.length, 0);
});

test('H1: removal — the catalog drops the model after (or without) the event; the row stays missing and changed', () => {
  const h = makeManagerHarness();
  referencingAB(h);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  h.catalog.removeModel('mB');
  h.catalog.fire();
  assert.equal(h.row('test-1').readiness.state, 'models-missing');
  assert.equal(h.row('test-1').modelsChanged, true);
  const g = makeManagerHarness();                                   // removal with no model-left event at all
  referencingAB(g);
  g.catalog.removeModel('mB');
  g.catalog.fire();
  assert.equal(g.row('test-1').readiness.state, 'models-missing');
  assert.equal(g.row('test-1').modelsChanged, true);
});

test('H1: same-key re-entry after an observed removal recomputes to setup-complete, in either event/catalog order', () => {
  for (const eventFirst of [true, false]) {
    const h = makeManagerHarness();
    referencingAB(h);
    if (eventFirst) h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
    h.catalog.removeModel('mB');
    h.catalog.fire();
    if (!eventFirst) h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });   // the catalog already dropped it: nothing to mark
    assert.equal(h.row('test-1').readiness.state, 'models-missing');
    h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });   // showModel: same key + Model
    h.catalog.fire();
    assert.equal(h.row('test-1').readiness.state, 'setup-complete', `eventFirst=${eventFirst}`);
    assert.equal(h.row('test-1').modelsChanged, false);
    assert.equal(h.row('test-1').setB, 'Structure');
  }
});

test('seam (e): the manager pushes its complete referenced-key scope to the editor once per change; a UI copy is dropped (G-A2)', async () => {
  const h = makeManagerHarness();
  assert.deepEqual(h.editor.labelScopes, [], 'the editor starts with the empty scope; nothing to push');
  referencingAB(h);
  assert.deepEqual(h.editor.labelScopes.at(-1), ['mA', 'mB']);
  const n = h.editor.labelScopes.length;
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: { resultsFound: 1 } } });
  assert.equal(h.editor.labelScopes.length, n, 'no push while the scope is unchanged');
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.equal(h.editor.labelScopes.length, n, 'the duplicate references the same keys');
  await h.dispatch({ type: INTENT.TEST_LABEL_SCOPE, modelKeys: ['forged'] });
  assert.equal(h.editor.labelScopes.length, n, 'a UI-sent TEST_LABEL_SCOPE never reaches the editor');
});

test('AC-M12: dispose drops every record and removes the editor, catalog and model-left listeners', async () => {
  const h = makeManagerHarness();
  const cat = h.catalog.listenerCount();
  const left = h.bridge.listenerCount();
  assert.equal(h.editor.subscriberCount(), 1);
  h.manager.dispose();
  assert.equal(h.editor.subscriberCount(), 0);
  assert.equal(h.catalog.listenerCount(), cat - 1);
  assert.equal(h.bridge.listenerCount(), left - 1);
  assert.equal(h.vm().count, 0);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.vm().count, 0);
});

// ── Carry-forward rulings (Task 7 implementation; additive to the plan's tests) ──────────────────────────────────

// Task 9 (Codex advisor finding, adopted): a throw/rejection/malformed answer is NOT a plain failure — the editor may
// have mutated before failing — so it is compensated ONCE (M1); it still never leaves state stuck or a record behind.
test('carry-forward (1): a REJECTED or unreadable TEST_LOAD is compensated once — no stuck state, no record left', async () => {
  const hostile = new Proxy({}, { get() { throw new Error('hostile result'); } });
  for (const script of [() => Promise.reject(new Error('hostile intent getter')), () => { throw new Error('sync throw'); }, () => hostile, () => 'nonsense']) {
    const h = makeManagerHarness();
    h.editor.scriptLoad(script);
    await h.dispatch({ type: MANAGER_INTENT.CREATE });
    const vm = h.vm();
    assert.equal(vm.activeTestId, 'test-1');
    assert.equal(vm.count, 1, 'the Create record is removed');
    assert.equal(vm.pending, null, 'no pending operation is left behind');
    assert.equal(vm.create.enabled, true, 'not busy: no activation or recovery is left behind');
    assert.equal(vm.fault, null);
    assert.equal(loads(h).length, 2, 'the failed load + exactly one compensating load');
    assert.equal(loads(h)[1].testId, 'test-1');
    assert.equal(vm.notice, 'The test editor was restored to “Clash test 1”.');
    await h.dispatch({ type: MANAGER_INTENT.CREATE });               // the next Create proceeds normally
    assert.equal(h.vm().activeTestId, 'new-2');
  }
});

test('carry-forward (1): an editor that throws on the post-load re-read never leaves the activation stuck', async () => {
  const h = makeManagerHarness();
  h.editor.scriptLoad((intent, editor) => {
    const result = defaultLoad(intent, editor);
    const original = editor.getViewModel;
    editor.getViewModel = () => { editor.getViewModel = original; throw new Error('editor re-read failure'); };
    return result;
  });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });                 // resolves; never rejects
  const vm = h.vm();
  assert.equal(vm.activeTestId, 'test-1', 'nothing is committed on an unreadable editor');
  assert.equal(vm.pending, null);
  assert.equal(vm.create.enabled, true, 'not busy: the activation was cleared');
  // The editor itself DID load new-1: that divergence is Task 9's recovery scope, deliberately not pinned here.
});

test('carry-forward (2): a throwing catalog name lookup never breaks derivation', () => {
  const h = makeManagerHarness();
  referencingAB(h);
  h.catalog.displayNameFor = () => { throw new Error('host name failure'); };
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  const row = h.row('test-1');
  assert.equal(row.readiness.state, 'models-missing');
  assert.equal(row.readiness.text, 'Model mB is not loaded');
  assert.equal(row.setB, 'Model mB (not loaded)');
});

test('§26.8: hiding then showing the panel keeps every record, the active test and the draft; no Viewer-mutating bridge call', async () => {
  const h = makeManagerHarness();
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  const edited = draftReduce(h.editor.test.draft, { type: 'name', value: 'Edited before hide' });
  h.editor.set({ draft: edited });
  const before = h.vm();
  const bridgeCalls = h.bridge.calls.length;
  const n = h.editor.dispatched.length;
  await h.dispatch({ type: INTENT.PANEL_HIDDEN });
  await h.dispatch({ type: INTENT.PANEL_SHOWN });
  await h.settle();
  const after = h.vm();
  assert.deepEqual(after.tests.map((t) => [t.testId, t.name]), before.tests.map((t) => [t.testId, t.name]));
  assert.equal(after.count, 2);
  assert.equal(after.activeTestId, before.activeTestId);
  assert.equal(after.fault, null);
  assert.equal(h.row('test-1').name, 'Edited before hide');
  assert.equal(h.editor.test.draft, edited, 'the editor draft is intact');
  assert.equal(h.bridge.calls.length, bridgeCalls, 'no Viewer-mutating bridge call');
  assert.deepEqual(h.editor.dispatched.slice(n).map((i) => i.type), [INTENT.PANEL_HIDDEN, INTENT.PANEL_SHOWN], 'only the two passthrough intents; no TEST_LOAD');
});

test('M2: manager.liveSeq increments once per announcement (identical text included) and not on non-announcing paths', async () => {
  const h = makeManagerHarness();
  const rename = (value) => h.editor.set({ draft: draftReduce(h.editor.test.draft, { type: 'name', value }) });
  assert.equal(h.vm().liveSeq, 0);
  await h.dispatch({ type: MANAGER_INTENT.CREATE });                   // announces (1)
  rename('Same');
  await h.dispatch({ type: MANAGER_INTENT.OPEN, testId: 'test-1' });   // announces (2)
  await h.dispatch({ type: MANAGER_INTENT.CREATE });                   // announces (3)
  rename('Same');
  assert.equal(h.vm().liveSeq, 3);
  await h.dispatch({ type: MANAGER_INTENT.VIEW_LIST });                // does not announce
  assert.equal(h.vm().liveSeq, 3);
  h.editor.set({ runActive: true }, { runPatch: { state: 'running', progress: null } });
  await h.dispatch({ type: MANAGER_INTENT.CREATE });                   // refused while running: no announcement
  assert.equal(h.vm().liveSeq, 3);
  h.editor.set({ runActive: false }, { runPatch: { state: 'idle', progress: null } });
  const confirmDelete = async (testId) => {
    await h.dispatch({ type: MANAGER_INTENT.DELETE, testId });
    await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: h.vm().confirm.operationId });
  };
  await confirmDelete('new-1');
  const first = h.vm();
  assert.equal(first.live, 'Deleted “Same” for this session.');
  assert.equal(first.liveSeq, 4);
  await confirmDelete('new-2');
  const second = h.vm();
  assert.equal(second.live, first.live, 'two distinct deletions produced identical announcement text');
  assert.equal(second.liveSeq, 5, 'but a distinct announcement identity');
});

test('M2: liveSeq advances for Duplicate and for Reset', async () => {
  const h = makeManagerHarness();
  assert.equal(h.vm().liveSeq, 0);
  await h.dispatch({ type: MANAGER_INTENT.DUPLICATE, testId: 'test-1' });
  assert.equal(h.vm().liveSeq, 1);
  assert.match(h.vm().live, /^Duplicated /);
  h.editor.set({ lastRun: lastRunOf('run-1', 2) });
  await h.dispatch({ type: MANAGER_INTENT.RESET, testId: 'test-1' });
  const op = h.vm().confirm;
  if (op !== null) await h.dispatch({ type: MANAGER_INTENT.CONFIRM, operationId: op.operationId });
  assert.match(h.vm().live, /^Reset the results/);
  assert.equal(h.vm().liveSeq, 2);
});
