// test/clashpanel/core/testsManager.integration.test.mjs — spec §26 with the REAL editor controller and the scripted
// engine/catalog/bridge doubles (no Viewer, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';
import { until } from '../support/settle.mjs';
import { createTestsManager } from '../../../clashpanel/core/testsManager.js';
import { INTENT, MANAGER_INTENT } from '../../../clashpanel/core/intents.js';
import { STATEMENTS } from '../../../clashpanel/core/runReport.js';

const SAVED = { state: 'saved', timedOut: false, attempt: 1 };
const PENDING = { state: 'pending', timedOut: true, attempt: 1 };

function setup(opts) {
  const h = makeHarness(opts);
  let n = 0;
  const manager = createTestsManager({ editor: h.controller, engine: h.engine, catalog: h.catalog, bridge: h.bridge, scheduler: h.scheduler,
    mintId: () => { n += 1; return `new-${n}`; } });
  const m = {
    manager,
    vm: () => manager.getViewModel().manager,
    ed: () => h.controller.getViewModel(),
    row: (id) => manager.getViewModel().manager.tests.find((t) => t.testId === id),
    async do(intent) { const out = await manager.dispatch(intent); await h.settle(); return out; },
  };
  return { h, m };
}
async function selectAB(m) {
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
}
async function runToSeal(h, m, { n = 3, persistence = SAVED, status = 'completed', resultSet } = {}) {
  await m.do({ type: INTENT.RUN_START });
  const handle = h.engine.lastHandle;
  handle.finish({ status, resultSet: resultSet === undefined ? makeSet({ runId: handle.runId, results: hardResults(n) }) : resultSet, persistence });
  await h.settle();
  return handle;
}
const confirm = (m) => m.do({ type: MANAGER_INTENT.CONFIRM, operationId: m.vm().confirm.operationId });

test('AC-M2/M6/M14: k tests hold at most one set; edits and revision survive switches; an unchanged rerun reuses the revision', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.SETUP_NAME, value: 'X walls' });
  await runToSeal(h, m);
  assert.equal(h.engine.resident.size, 1);
  const xDraft = m.ed().test.draft;
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.notEqual(m.vm().activeTestId, X);
  assert.equal(h.engine.resident.size, 0, 'outgoing saved set released; non-active tests hold nothing');
  await selectAB(m);
  await runToSeal(h, m);
  assert.equal(h.engine.resident.size, 1);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  assert.equal(h.engine.resident.size, 0);
  assert.equal(m.ed().test.draft, xDraft, 'X\'s exact draft (incl. revision/lastRun) is back');
  await runToSeal(h, m);
  const calls = h.engine.startCalls;
  assert.equal(calls.at(-1).definition.testId, X);
  assert.equal(calls.at(-1).definition.revision, calls[0].definition.revision, 'unchanged definition → same revision → same resultIds');
  await m.do({ type: INTENT.SETUP_NAME, value: 'X walls v2' });
  await runToSeal(h, m);
  assert.equal(calls.at(-1).definition.revision, calls[0].definition.revision + 1);
  assert.ok(h.engine.resident.size <= 1);
});

test('AC-M2: an unsaved set is released only after the single confirmation (§23.5 copy for New test)', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m, { persistence: PENDING });
  await m.do({ type: INTENT.SETUP_NEW_TEST });                     // manager-hosted: New test = Create
  assert.equal(m.vm().confirm.text, 'The current results are held in memory only. Starting a new test discards them — discard?');
  assert.equal(h.engine.resident.size, 1, 'nothing released before consent');
  await confirm(m);
  assert.equal(h.engine.resident.size, 0);
  assert.equal(m.vm().count, 2);
});

test('AC-M3: Create/Open/Delete-active/Reset-active refused while the run is non-terminal; Duplicate allowed', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  const vm = m.vm();
  const other = vm.tests.find((t) => !t.active).testId;
  assert.deepEqual(vm.create, { enabled: false, reason: 'Stop the running test first.' });
  assert.equal(m.row(X).actions.delete.enabled, false);
  assert.equal(m.row(X).actions.reset.enabled, false);
  assert.equal(m.row(other).actions.open.enabled, false);
  assert.equal(m.row(X).status.kind, 'running');
  await m.do({ type: MANAGER_INTENT.OPEN, testId: other });
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.equal(m.vm().activeTestId, X);
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  assert.equal(m.vm().count, 3);
  assert.equal(h.engine.startCalls.length, 1);
});

test('AC-M4: after a switch, late derivation/freshness outcomes of the outgoing test change neither the editor nor the Viewer', async () => {
  const { h, m } = setup();
  h.engine.control.summarize.manual = true;
  h.engine.control.getFreshness.manual = true;
  await selectAB(m);
  await runToSeal(h, m);
  assert.ok(h.engine.control.summarize.pending.length >= 1 && h.engine.control.getFreshness.pending.length >= 1);
  const viewerCalls = h.bridge.calls.length;
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.equal(h.bridge.calls.length, viewerCalls + 1);
  assert.equal(h.bridge.calls.at(-1).op, 'clear', 'the switch\'s single queued clear()');
  const after = m.ed();
  h.engine.control.summarize.resolveAll();
  h.engine.control.getFreshness.resolveAll();
  await h.settle();
  const late = m.ed();
  assert.equal(late.test.testId, after.test.testId);
  assert.equal(late.results.state, 'before-run');
  assert.equal(late.run.state, 'idle');
  assert.equal(h.bridge.presents.length, 0);
});

test('AC-M4: a late basis verdict for the outgoing participants is dropped (setupGen)', async () => {
  const { h, m } = setup();
  const resolvers = [];
  h.catalog.setBasis(() => new Promise((resolve) => { resolvers.push(resolve); }));
  await m.do({ type: INTENT.SETUP_MODE, value: 'soft' });
  await m.do({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await selectAB(m);
  const X = m.vm().activeTestId;
  assert.equal(resolvers.length, 1, 'X evaluation pending');
  await m.do({ type: MANAGER_INTENT.DUPLICATE, testId: X });
  const Y = m.vm().tests.at(-1).testId;
  await m.do({ type: MANAGER_INTENT.OPEN, testId: Y });
  assert.equal(resolvers.length, 2, 'Y forced its own evaluation');
  resolvers[0]({ state: 'verified', basisKey: 'late' });
  await h.settle();
  assert.equal(m.ed().setup.softChecking, true, 'the outgoing verdict did not commit to Y');
  resolvers[1]({ state: 'unverified', reason: 'differ' });
  await h.settle();
  assert.equal(m.ed().setup.softChecking, false);
  assert.equal(m.ed().setup.basis.required, true);
});

test('AC-M5: a non-active test shows its last status/count and "Results not held"; opening it shows the editor idle', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m, { n: 0 });
  await m.do({ type: MANAGER_INTENT.CREATE });
  assert.deepEqual(m.row(X).status, { kind: 'completed', text: 'Completed — 0 clashes reported' });
  assert.equal(m.row(X).resultsText, 'Results not held — open and re-run to view');
  assert.doesNotMatch(JSON.stringify(m.vm()), /no clashes/i);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  const ed = m.ed();
  assert.equal(ed.run.state, 'idle');
  assert.equal(ed.results.state, 'before-run');
  assert.equal(ed.test.lastRun, null);
  assert.deepEqual(ed.setup.scope, { A: 'Architecture', B: 'Structure' });
});

test('AC-M9: Clear results keeps the summary; Reset returns to "Not run" keeping testId, draft and revision', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m);
  await m.do({ type: INTENT.RESULTS_CLEAR });
  assert.equal(m.row(X).status.text, 'Completed — 3 clashes reported');
  assert.equal(m.row(X).resultsText, 'Results not held — open and re-run to view');
  await m.do({ type: MANAGER_INTENT.RESET, testId: X });
  assert.deepEqual(m.row(X).status, { kind: 'not-run', text: 'Not run' });
  assert.equal(m.vm().activeTestId, X);
  await runToSeal(h, m);
  assert.equal(h.engine.startCalls.at(-1).definition.revision, h.engine.startCalls[0].definition.revision);
});

test('AC-M15: a seal followed in the next intents by Clear results and Create still leaves that run\'s summary', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  const handle = h.engine.lastHandle;
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(2) }), persistence: SAVED });
  await until(h.scheduler, () => m.ed().run.state === 'done');
  await Promise.all([m.manager.dispatch({ type: INTENT.RESULTS_CLEAR }), m.manager.dispatch({ type: MANAGER_INTENT.CREATE })]);
  await h.settle();
  assert.equal(m.row(X).status.text, 'Completed — 2 clashes reported');
  assert.equal(m.row(X).resultCount, 2);
  assert.equal(m.vm().count, 2);
});

test('AC-M15: a seal immediately followed by Reset deliberately empties the summary', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await m.do({ type: INTENT.RUN_START });
  h.engine.lastHandle.finish({ status: 'completed', resultSet: makeSet({ runId: h.engine.lastHandle.runId, results: hardResults(2) }), persistence: SAVED });
  await until(h.scheduler, () => m.ed().run.state === 'done');
  await m.do({ type: MANAGER_INTENT.RESET, testId: X });
  assert.deepEqual(m.row(X).status, { kind: 'not-run', text: 'Not run' });
});

test('AC-M16: a confirmed switch whose release is stuck commits, shows the release-error banner, keeps the retry list', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m, { persistence: PENDING });
  h.engine.setReleaseFailure(new Error('store down'));
  await m.do({ type: MANAGER_INTENT.CREATE });
  await confirm(m);
  assert.equal(m.vm().activeTestId, 'new-1');
  assert.ok(m.ed().run.banners.some((b) => b.id === 'release-error'));
  assert.equal(h.engine.resident.size, 1, 'the stuck set stays for the residency retry');
  h.engine.setReleaseFailure(null);
  m.manager.dispose();
  await h.controller.dispose();
  assert.equal(h.engine.resident.size, 0, 'retried by disposeAll');
});

test('AC-M17: planning-stage cancel and failure rows read the §7.3 headline, no count, no "Models changed"', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m, { status: 'cancelled', resultSet: null });
  assert.deepEqual(m.row(X).status, { kind: 'cancelled', text: 'Stopped before any results' });
  assert.equal(m.row(X).resultCount, null);
  assert.equal(m.row(X).resultsText, null);
  await runToSeal(h, m, { status: 'failed', resultSet: null });
  assert.deepEqual(m.row(X).status, { kind: 'failed', text: STATEMENTS.NO_RESULT_SET });
  h.catalog.removeModel('mB');
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).modelsChanged, false, 'models: [] never marks a row');
});

test('AC-M19: an inactive multi-model Soft test without a basis reads setup-complete; opening it blocks Run on the §23 rule', async () => {
  const { h, m } = setup({ basis: { state: 'unverified', reason: 'models differ' } });
  const X = m.vm().activeTestId;
  await m.do({ type: MANAGER_INTENT.CREATE });
  const Y = m.vm().activeTestId;
  await m.do({ type: INTENT.SETUP_MODE, value: 'soft' });
  await m.do({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await selectAB(m);
  await m.do({ type: MANAGER_INTENT.OPEN, testId: X });
  assert.equal(m.row(Y).readiness.state, 'setup-complete');
  assert.doesNotMatch(m.row(Y).readiness.text, /\bready\b/i);
  assert.equal(m.row(Y).modeText, 'Soft (clearance 0.05)');
  await m.do({ type: MANAGER_INTENT.OPEN, testId: Y });
  assert.equal(m.ed().setup.basis.required, true);
  assert.equal(m.ed().run.canRun, false);
  void h;
});

test('AC-M10 / Review Focus 3: readiness and "models changed" follow catalog and model-left events, with no freshness/claim/derivation read', async () => {
  const { h, m } = setup();
  const X = m.vm().activeTestId;
  await selectAB(m);
  await runToSeal(h, m);
  await m.do({ type: MANAGER_INTENT.CREATE });                     // X inactive with a summary; the editor is idle
  const reads = () => ['getFreshness', 'assessNoClashClaim', 'summarize', 'groupBy', 'filter'].map((k) => h.engine.control[k].calls);
  const before = reads();
  const rowsBefore = JSON.stringify(m.vm().tests);
  h.catalog.addModel({ modelKey: 'mC', displayName: 'MEP', model: { label: 'C' }, loaded: true });
  h.catalog.fire();
  await h.settle();
  assert.equal(JSON.stringify(m.vm().tests), rowsBefore, 'an unrelated new model changes no record');
  // Work plan review H1: the event ALONE — the catalog snapshot and the binding are deliberately left unchanged.
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  assert.ok(h.catalog.list().some((e) => e.modelKey === 'mB'), 'catalog still lists mB');
  assert.notEqual(h.engine.registry.bindingFor('mB'), null, 'binding still readable');
  assert.equal(m.row(X).readiness.state, 'models-missing');
  assert.equal(m.row(X).readiness.text, 'Structure is not loaded');
  assert.equal(m.row(X).modelsChanged, true);
  assert.equal(m.row(X).modelsChangedText, 'Models changed since this run');
  h.catalog.fire();                                                // a notification still listing mB reconciles nothing
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing');
  h.catalog.removeModel('mB');                                     // the authoritative removal follows
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing');
  assert.equal(m.row(X).modelsChanged, true);
  h.catalog.addModel({ modelKey: 'mB', displayName: 'Structure', model: h.modelB, loaded: true });   // showModel: same key + Model
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'setup-complete');
  assert.equal(m.row(X).modelsChanged, false);
  h.catalog.removeModel('mB');
  const reloaded = { label: 'B2' };
  h.catalog.addModel({ modelKey: 'mB2', displayName: 'Structure', model: reloaded, loaded: true });   // reload under a NEW key
  h.engine.setBinding('mB2', { modelKey: 'mB2', model: reloaded, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 });
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).readiness.state, 'models-missing', 'never re-bound by name/URN');
  assert.deepEqual(reads(), before, 'no freshness/claim/derivation read for any record');
});

test('AC-M11: Set A/B summaries disambiguate host names across every referenced key; "(not loaded)" once absent', async () => {
  const { h, m } = setup({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  const X = m.vm().activeTestId;
  await selectAB(m);
  assert.equal(m.row(X).setA, 'Arch · …mA');
  assert.equal(m.row(X).setB, 'Arch · …mB');
  h.catalog.removeModel('mB');
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(X).setB, 'Arch · …mB (not loaded)', 'still disambiguated: the record keeps mB known (CTM-2)');
  assert.equal(m.ed().setup.scope.A, m.row(X).setA, 'G-A2: the active editor shows the identical label');
});

test('AC-M11 / CTM-2 / G-A2 seam (e): the same modelKey has the identical label in the list and the editor, incl. an unloaded same-host-name model referenced only by another test', async () => {
  const { h, m } = setup({ displayNames: { mA: 'Arch', mB: 'Arch' } });
  const X = m.vm().activeTestId;
  await selectAB(m);                                               // X references mA + mB
  await m.do({ type: MANAGER_INTENT.CREATE });
  const Y = m.vm().activeTestId;
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });   // Y references mA only
  h.catalog.removeModel('mB');                                     // mB unloaded; only record X still references it
  h.catalog.fire();
  await h.settle();
  assert.equal(m.row(Y).setA, 'Arch · …mA', 'list: mA is disambiguated against the referenced, unloaded mB');
  assert.equal(m.ed().setup.scope.A, m.row(Y).setA, 'editor Set A summary: the identical label (fails without seam (e))');
  assert.equal(m.ed().setup.models.find((e) => e.modelKey === 'mA').displayName, m.row(Y).setA, 'editor model list: identical');
  assert.equal(m.row(X).setB, 'Arch · …mB (not loaded)');
  // Invalidation: deleting X removes mB from the referenced scope; list and editor drop the suffix together.
  await m.do({ type: MANAGER_INTENT.DELETE, testId: X });
  await confirm(m);
  assert.equal(m.vm().count, 1);
  assert.equal(m.row(Y).setA, 'Arch');
  assert.equal(m.ed().setup.scope.A, 'Arch');
  // Invalidation: a referenced key re-added by an edit of the active draft re-disambiguates both views.
  await m.do({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
  assert.equal(m.row(Y).setA, 'Arch · …mA');
  assert.equal(m.ed().setup.scope.A, 'Arch · …mA');
});

test('AC-M12: manager dispose then editor dispose leaves no listener and holds nothing', async () => {
  const { h, m } = setup();
  await selectAB(m);
  await runToSeal(h, m);
  m.manager.dispose();
  assert.equal(h.catalog.listenerCount(), 1, 'only the editor\'s own listener remains');
  assert.equal(h.bridge.listenerCount(), 1);
  const out = await h.controller.dispose();
  assert.equal(out.released, true);
  assert.equal(h.catalog.listenerCount(), 0);
  assert.equal(h.bridge.listenerCount(), 0);
  assert.equal(h.engine.resident.size, 0);
});
