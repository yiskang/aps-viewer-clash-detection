// test/clashpanel/core/realEngineContract.test.mjs — Task 20: the controller against the REAL Core engine
// (createClashTestEngine from the public barrel + the P6 scripted unit executor), to catch drift between the Panel's
// doubles and real Core shapes (AC-P8, AC-P9). Only public engine methods are used. The engine runs on its own
// (macrotask) scheduling — in Node the default `interUnitYield:'animation-frame'` degrades to a macrotask
// (clashtest/util/slicer.js) — while the controller uses the fake scheduler; `until` bounds ROUNDS, not time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createEngineWorld } from '../../clashtest/support/engineWorld.mjs';
import { createScriptedExecutor } from '../../clashtest/support/scriptedExecutor.mjs';
import { createPanelController } from '../../../clashpanel/core/controller.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { runHeadline, STATEMENTS } from '../../../clashpanel/core/runReport.js';
import { createFakeCatalog } from '../support/fakeCatalog.mjs';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';
import { createRecordingBridge } from '../support/controllerHarness.mjs';
import { settle, until } from '../support/settle.mjs';

// Witness kinds must be a real library kind: an unknown kind seals `failed: unit:internal-error`.
const HARD_PAIRS = [
  { source: { modelKey: 'mA', dbId: 1 }, target: { modelKey: 'mB', dbId: 10 }, type: 'volume-overlap', witness: { kind: 'surface-crossing', point: [1, 2, 3] } },
  { source: { modelKey: 'mA', dbId: 2 }, target: { modelKey: 'mB', dbId: 10 }, type: 'volume-overlap', witness: null },
];
const SOFT_PAIRS = [
  { source: { modelKey: 'mA', dbId: 1 }, target: { modelKey: 'mA', dbId: 2 }, type: 'clearance', distance: 0.02, clearance: 0.05, witness: { sourcePoint: [0, 0, 0], targetPoint: [0.02, 0, 0] } },
];

/** Counts derivation/read calls while delegating to the real engine (the controller narrows it to the port). */
function spied(engine) {
  const counts = { summarize: 0, groupBy: 0, filter: 0, getFreshness: 0, assessNoClashClaim: 0 };
  const wrap = (owner, name) => (...args) => { counts[name] += 1; return owner[name](...args); };
  return {
    counts,
    port: {
      validateTest: (...a) => engine.validateTest(...a),
      startRun: (...a) => engine.startRun(...a),
      retainResultSet: (...a) => engine.retainResultSet(...a),
      releaseResultSet: (...a) => engine.releaseResultSet(...a),
      getPersistenceState: (...a) => engine.getPersistenceState(...a),
      getFreshness: wrap(engine, 'getFreshness'),
      assessNoClashClaim: wrap(engine, 'assessNoClashClaim'),
      derivations: { summarize: wrap(engine.derivations, 'summarize'), groupBy: wrap(engine.derivations, 'groupBy'), filter: wrap(engine.derivations, 'filter') },
      registry: engine.registry,
    },
  };
}

function setup({ pairs = HARD_PAIRS, script = {}, engineConfig = {} } = {}) {
  const w = createEngineWorld();
  const executor = createScriptedExecutor(script, { unscripted: { facts: [], pairs } });
  const engine = createClashTestEngine(w.config({ unitExecutor: executor, ...engineConfig }));
  const { port, counts } = spied(engine);
  const scheduler = createFakeScheduler();
  const catalog = createFakeCatalog({
    models: [
      { modelKey: 'mA', displayName: 'Architecture', model: w.models.get('mA'), loaded: true },
      { modelKey: 'mB', displayName: 'Structure', model: w.models.get('mB'), loaded: true },
    ],
    basis: { state: 'unverified', reason: 'no shared basis evidence' },
  });
  const bridge = createRecordingBridge();
  let n = 0;
  const controller = createPanelController({ engine: port, catalog, bridge, scheduler, mintId: () => { n += 1; return `real-${n}`; } });
  const t = {
    w, engine, executor, counts, scheduler, catalog, bridge, controller,
    vm: () => controller.getViewModel(),
    async dispatch(intent) { const out = await controller.dispatch(intent); await settle(scheduler); return out; },
    until: (predicate) => until(scheduler, predicate),
    async hardAB() {
      await t.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
      await t.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
    },
    async runAndWait() {
      await t.dispatch({ type: INTENT.RUN_START });
      await t.until(() => t.vm().run.state === 'done');
      await t.until(() => { const s = t.vm().results.state; return s !== 'running' && !t.vm().filters.busy && t.vm().run.badges?.freshness?.pending !== true; });
    },
  };
  return t;
}

test('Hard, completed with 2 real results: index, summarize, caveated mask, freshness, grouping, filters, select + present', async () => {
  const t = setup();
  await t.hardAB();
  assert.equal(t.vm().run.canRun, true);
  await t.runAndWait();
  let vm = t.vm();
  assert.equal(vm.run.doneKind, 'completed');
  assert.deepEqual(vm.run.counts, { total: 2, filtered: 2 });
  assert.equal(vm.results.state, 'list');
  assert.deepEqual(vm.results.rows.map((r) => [r.side1.modelKey, r.side1.dbId, r.side2.modelKey, r.side2.dbId, r.liveness]), [['mA', 1, 'mB', 10, 'live'], ['mA', 2, 'mB', 10, 'live']]);
  assert.deepEqual(vm.results.rows[1].badges, ['no location']);
  assert.deepEqual([vm.run.badges.coverage.value, vm.run.badges.integrity.value, vm.run.badges.freshness.value], ['full', 'clean', 'current']);
  assert.deepEqual([t.counts.summarize, t.counts.filter, t.counts.getFreshness, t.counts.assessNoClashClaim], [1, 1, 1, 0]);

  await t.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await t.until(() => t.vm().results.view === 'grouped');
  vm = t.vm();
  assert.deepEqual(vm.results.rows.map((r) => [r.kind, r.count]), [['group', 1], ['group', 1], ['group', 2]]);
  assert.equal(t.counts.groupBy, 1);
  await t.dispatch({ type: INTENT.GROUP_MODE, value: 'none' });
  await t.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  await t.until(() => t.vm().run.counts.filtered === 1);

  const first = t.vm().results.rows[0];
  await t.dispatch({ type: INTENT.NAV_SELECT, resultId: first.resultId, groupId: null });
  const call = t.bridge.calls.find((c) => c.op === 'present');
  assert.deepEqual(call.req.sides, [{ model: t.w.models.get('mA'), dbId: 1 }, { model: t.w.models.get('mB'), dbId: 10 }]);
  assert.deepEqual(call.req.point, [1, 2, 3]);
  assert.equal(t.vm().selected.resultId, first.resultId);
  assert.deepEqual([t.counts.summarize, t.counts.filter, t.counts.groupBy], [1, 1, 1]);
  await t.controller.dispose();
});

test('Soft (clearance), single participating model self-clash: real distance, gap text, closestPoints presented', async () => {
  const t = setup({ pairs: SOFT_PAIRS });
  await t.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'A', modelKey: 'mA' });
  await t.dispatch({ type: INTENT.SETUP_SELF_CLASH, value: true });
  await t.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await t.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  assert.equal(t.vm().setup.basis.state, 'verified');                        // |P| = 1 ⇒ trivially common basis
  assert.equal(t.vm().setup.basis.required, false);
  assert.equal(t.vm().run.canRun, true);
  await t.runAndWait();
  const vm = t.vm();
  assert.equal(vm.run.doneKind, 'completed');
  assert.equal(vm.results.rows[0].gap, '0.020 scene units');
  assert.equal(vm.filters.maxGap.visible, true);
  assert.equal(vm.filters.maxGap.max, 0.05);
  await t.dispatch({ type: INTENT.NAV_SELECT, resultId: vm.results.rows[0].resultId, groupId: null });
  const call = t.bridge.calls.find((c) => c.op === 'present');
  assert.deepEqual(call.req.closestPoints, { first: [0, 0, 0], second: [0.02, 0, 0] });
  await t.controller.dispose();
});

test('empty completed/full/clean run: the real claim is allowed and worded as the §7.5 claim, never bare "No clashes"', async () => {
  const t = setup({ pairs: [] });
  await t.hardAB();
  await t.runAndWait();
  await t.until(() => t.vm().results.state === 'empty-claim');
  const vm = t.vm();
  assert.equal(vm.results.message, STATEMENTS.CLAIM);
  assert.equal(t.counts.assessNoClashClaim, 1);
  assert.equal(vm.run.headline, 'Completed — 0 clashes');
  await t.controller.dispose();
});

test('Stop during a held unit: the drained unit\'s results stay browsable after the cancelled seal', async () => {
  const t = setup({ script: { '1.0': [{ facts: [], hold: true, pairs: HARD_PAIRS }] } });
  await t.hardAB();
  await t.dispatch({ type: INTENT.RUN_START });
  await t.executor.inFlight('1.0');
  await t.dispatch({ type: INTENT.RUN_STOP });
  assert.equal(t.vm().run.state, 'stopping');
  assert.equal(t.vm().results.state, 'running');                             // no list during the run (AC-P3)
  t.executor.release('1.0');
  await t.until(() => t.vm().run.state === 'done' && t.vm().run.counts.filtered !== null);
  const vm = t.vm();
  assert.equal(vm.run.doneKind, 'cancelled');
  assert.equal(vm.results.rows.length, 2);
  assert.ok(vm.run.banners.some((b) => b.id === 'cancelled'));
  await t.controller.dispose();
});

test('planning failure (model unregistered after validation): sealed failed ⇒ headline by cause, banner, no list, rows would be unavailable', async () => {
  const t = setup();
  await t.hardAB();
  assert.equal(t.vm().run.canRun, true);
  t.w.registry.unregister(t.w.models.get('mB'));                             // host unregistered it; no catalog event
  await t.runAndWait();
  const vm = t.vm();
  assert.equal(vm.run.doneKind, 'failed');
  assert.ok(vm.run.banners.some((b) => b.id === 'failed'));
  assert.equal(vm.results.rows.length, 0);
  assert.notEqual(vm.results.state, 'list');
  assert.equal(vm.results.state, 'empty-nonclaim');
  assert.ok(vm.run.diagnostics.preview.some((line) => line.includes('model-not-bound')));
  const json = JSON.parse(await t.controller.dispatch({ type: INTENT.DIAGNOSTICS_COPY }));
  assert.deepEqual(json.planningGaps, [{ phase: 'binding', cause: 'model-not-bound' }]);
  await t.controller.dispose();
});

test('AC-P8: after a real re-registration (new Model object, same key) no row resolves live; list and counts still work', async () => {
  const t = setup();
  await t.hardAB();
  await t.runAndWait();
  const reloaded = { fakeModel: 'mA-reloaded' };
  t.w.registry.unregister(t.w.models.get('mA'));
  t.w.registry.register('mA', reloaded, { modelVersion: 'v1' });
  t.catalog.addModel({ modelKey: 'mA', displayName: 'Architecture', model: reloaded, loaded: true });
  t.bridge.fireModelLeft({ model: t.w.models.get('mA'), reason: 'unload' });
  t.catalog.fire();
  await settle(t.scheduler);
  const vm = t.vm();
  assert.ok(vm.results.rows.every((r) => r.liveness === 'reloaded since run'));
  assert.deepEqual(vm.run.counts, { total: 2, filtered: 2 });
  await t.dispatch({ type: INTENT.NAV_SELECT, resultId: vm.results.rows[0].resultId, groupId: null });
  assert.deepEqual(t.bridge.calls.filter((c) => c.op === 'present').at(-1).req.sides, [{ model: t.w.models.get('mB'), dbId: 10 }]);   // only the live side
  assert.deepEqual(t.vm().selected.notes.slice(0, 1), ['Architecture is not loaded']);
  await t.controller.dispose();
});

test('no result store ⇒ persistence skipped: "held in memory" notice; Clear needs the acknowledgement; the set is then released', async () => {
  const t = setup({ engineConfig: { resultStore: null } });
  await t.hardAB();
  await t.runAndWait();
  const runId = t.engine.retentionReport().sets[0].runId;
  assert.ok(t.vm().run.banners.some((b) => /held in memory/i.test(b.text)));
  await t.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.ok(t.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'));
  assert.notEqual(t.engine.getPersistenceState(runId), null);               // still resident
  await t.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(t.engine.getPersistenceState(runId), null);                  // released with acknowledgeUnsaved
  assert.equal(t.vm().results.state, 'before-run');
  await t.controller.dispose();
});

test('capacity (maxResidentResultSets: 1): ResultCapacityError keeps the previous results; release-and-retry runs', async () => {
  const t = setup({ engineConfig: { limits: { maxResidentResultSets: 1 } } });
  await t.hardAB();
  await t.runAndWait();
  const clears = t.bridge.calls.filter((c) => c.op === 'clear').length;
  await t.dispatch({ type: INTENT.RUN_START });
  let vm = t.vm();
  const banner = vm.run.banners.find((b) => b.id === 'admission-error');
  assert.deepEqual(banner.action.intent, { type: INTENT.RUN_RELEASE_AND_RETRY });
  assert.equal(vm.run.doneKind, 'completed');
  assert.equal(vm.results.rows.length, 2);                                 // previous results preserved
  assert.equal(t.bridge.calls.filter((c) => c.op === 'clear').length, clears);   // Viewer untouched
  await t.dispatch({ type: INTENT.RUN_RELEASE_AND_RETRY });
  await t.until(() => t.vm().run.state === 'done');
  vm = t.vm();
  assert.equal(vm.run.doneKind, 'completed');
  assert.equal(t.engine.retentionReport().sets.length, 1);
  await t.controller.dispose();
});

test('single slot + unsaved (maxResidentResultSets:1, no store): Run → confirm discard → the new run is admitted and completes', async () => {
  const t = setup({ engineConfig: { resultStore: null, limits: { maxResidentResultSets: 1 } } });
  await t.hardAB();
  await t.runAndWait();
  const firstRunId = t.engine.retentionReport().sets[0].runId;
  await t.dispatch({ type: INTENT.RUN_START });
  assert.ok(t.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'));
  await t.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(t.vm().run.banners.some((b) => b.id === 'admission-error'), false);
  await t.until(() => t.vm().run.state === 'done' && t.vm().run.counts.filtered !== null);
  assert.equal(t.vm().run.doneKind, 'completed');
  assert.equal(t.engine.getPersistenceState(firstRunId), null);            // released before the new admission
  assert.equal(t.vm().results.rows.length, 2);
  await t.controller.dispose();
});

test('dispose during an active real run cancels it (panel-disposed) and releases the sealed set', async () => {
  const t = setup({ script: { '1.0': [{ facts: [], hold: true, pairs: HARD_PAIRS }] } });
  await t.hardAB();
  await t.dispatch({ type: INTENT.RUN_START });
  await t.executor.inFlight('1.0');
  let resolved = false;
  const disposing = t.controller.dispose();
  disposing.then(() => { resolved = true; });
  await settle(t.scheduler);
  assert.equal(resolved, false);                                           // held unit: done has not settled yet
  t.executor.release('1.0');
  await disposing;
  const report = t.engine.retentionReport();                               // checked immediately — no waiting loop
  assert.deepEqual([report.active.length, report.sets.length], [0, 0]);
  assert.equal(t.bridge.calls.filter((c) => c.op === 'dispose').length, 1);
});

test('RF-3: a model unloads while the real run is non-terminal — no Viewer mutation, no throw, a sealed outcome, unavailable rows', async () => {
  const t = setup({ script: { '1.0': [{ facts: [], hold: true, pairs: HARD_PAIRS }] } });
  await t.hardAB();
  await t.dispatch({ type: INTENT.RUN_START });
  await t.executor.inFlight('1.0');
  const mutating = t.bridge.calls.length;
  const modelB = t.w.models.get('mB');
  t.w.registry.unregister(modelB);                                          // what wireModelUnload does on unload
  t.catalog.removeModel('mB');
  t.bridge.fireModelLeft({ model: modelB, reason: 'unload' });
  t.bridge.fireModelLeft({ model: modelB, reason: 'removed' });
  t.catalog.fire();
  await settle(t.scheduler);
  assert.equal(t.bridge.calls.length, mutating);
  t.executor.release('1.0');
  await t.until(() => t.vm().run.state === 'done' && t.vm().results.state !== 'running' && !t.vm().filters.busy);
  const vm = t.vm();
  assert.ok(['completed', 'cancelled', 'failed', 'invalidated'].includes(vm.run.doneKind));
  assert.ok(vm.run.headline.length > 0);
  assert.ok(vm.results.rows.every((r) => r.liveness !== 'live'));          // every pair touches mB
  assert.equal(vm.run.counts.total, vm.results.rows.length);
  assert.ok(t.counts.getFreshness >= 1);
  await t.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  await t.until(() => !t.vm().filters.busy);
  assert.equal(t.bridge.calls.length, mutating);
  await t.controller.dispose();
});

test('RF-4: edit-then-revert reruns the same question — same definitionKey/revision, identical resultIds from the real engine', async () => {
  const t = setup();
  await t.hardAB();
  await t.runAndWait();
  const first = t.vm().results.rows.map((r) => r.resultId);
  const name = t.vm().setup.name;
  await t.dispatch({ type: INTENT.SETUP_NAME, value: 'temporary edit' });
  await t.dispatch({ type: INTENT.SETUP_NAME, value: name });
  await t.runAndWait();
  assert.equal(t.vm().run.doneKind, 'completed');
  assert.deepEqual(t.vm().results.rows.map((r) => r.resultId), first);
  await t.controller.dispose();
});

test('the run headline equals the wording matrix for the real sealed set (AC-P9 spot check)', async () => {
  const t = setup();
  await t.hardAB();
  await t.runAndWait();
  assert.equal(t.vm().run.headline, runHeadline({ status: 'completed', total: 2, coverage: 'full' }));
  await t.controller.dispose();
});
