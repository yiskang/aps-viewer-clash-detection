// test/clashpanel/core/controller.setupRun.test.mjs — Task 16: setup, validation state, run/stop, supersession,
// residency (spec §6, §7, §7.6; AC-P1, AC-P3, AC-P14, AC-P15, AC-P18, AC-P20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultCapacityError, RunQueueFullError } from '../../../clashtest/index.js';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { SOFT_UNAVAILABLE_TEXT, READINESS_POLL_MS } from '../../../clashpanel/core/constants.js';
import { SOFT_CHECKING_TEXT } from '../../../clashpanel/core/viewModel.js';
import { definitionKey } from '../../../clashpanel/core/draft.js';
import { createPanelController } from '../../../clashpanel/core/controller.js';
import { makeHarness, makeSet, createScriptedEngine, createRecordingBridge } from '../support/controllerHarness.mjs';
import { createFakeCatalog } from '../support/fakeCatalog.mjs';
import { createFakeScheduler } from '../support/fakeScheduler.mjs';

const twoResults = () => makeSet({ runId: 'run-1', results: [{ a: ['mA', 1], b: ['mB', 10] }, { a: ['mA', 2], b: ['mB', 10] }] });

test('ViewModel is frozen, identical until state changes, and subscribers see every change', async () => {
  const h = makeHarness();
  await h.settle();
  const vm1 = h.vm();
  assert.ok(Object.isFrozen(vm1) && Object.isFrozen(vm1.setup) && Object.isFrozen(vm1.setup.models));
  assert.equal(h.vm(), vm1);                                             // same object while nothing changed
  const seen = [];
  const off = h.controller.subscribe((vm) => seen.push(vm.version));
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Walls vs ducts' });
  const vm2 = h.vm();
  assert.notEqual(vm2, vm1);
  assert.ok(vm2.version > vm1.version);
  assert.equal(vm2.setup.name, 'Walls vs ducts');
  assert.equal(seen.at(-1), vm2.version);
  off();
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'again' });
  assert.equal(seen.at(-1), vm2.version);                                 // unsubscribed
  assert.deepEqual(Object.keys(vm2).sort(), ['filters', 'results', 'run', 'selected', 'setup', 'version']);
  assert.equal(vm2.selected, null);
  assert.equal(vm2.results.state, 'before-run');
});

test('unknown or malformed intents throw TypeError synchronously', () => {
  const h = makeHarness();
  assert.throws(() => h.controller.dispatch({ type: 'nope/never' }), { name: 'TypeError', message: /unknown intent/ });
  assert.throws(() => h.controller.dispatch(null), TypeError);
  assert.throws(() => h.controller.dispatch({}), TypeError);
});

test('setup: model checklist, scope text, validation ready ⇒ Run enabled; unregistered / loading models block Run', async () => {
  const h = makeHarness();
  await h.settle();
  assert.equal(h.vm().run.canRun, false);                                  // empty sets
  assert.equal(h.vm().setup.validation.state, 'blocked');
  await h.readyHard();
  const vm = h.vm();
  assert.equal(vm.setup.validation.state, 'ready');
  assert.equal(vm.run.canRun, true);
  assert.deepEqual(vm.setup.models.map((m) => [m.modelKey, m.inA, m.inB, m.ready, m.registered, m.note]),
    [['mA', true, false, true, true, null], ['mB', false, true, true, true, null]]);
  assert.deepEqual(vm.setup.scope, { A: 'Architecture', B: 'Structure' });
  assert.equal(vm.setup.clearance.visible, false);                        // Hard has no tolerance/clearance control

  h.catalog.setLoaded('mB', false);                                        // readiness change…
  h.catalog.fire();                                                        // …announced through onChange
  await h.settle();
  assert.equal(h.vm().run.canRun, false);
  assert.equal(h.vm().setup.models[1].note, 'Model Structure is still loading');
  h.catalog.setLoaded('mB', true);
  h.engine.setBinding('mB', null);                                         // host unregistered it
  h.catalog.fire();
  await h.settle();
  assert.equal(h.vm().run.canRun, false);
  assert.equal(h.vm().setup.models[1].registered, false);
  assert.equal(h.engine.forbidden.length, 0);                             // never tries to (re-)register (AC-P20)
});

test('AC-P18: Soft availability is async and fail-closed; pending counts as unavailable', async () => {
  const h = makeHarness({ basis: { state: 'unverified', reason: 'units differ' } });
  await h.readyHard();
  await h.controller.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  const vm = h.vm();
  assert.equal(vm.setup.softAvailability.available, false);
  assert.equal(vm.setup.softAvailability.pending, false);
  assert.ok(vm.setup.softAvailability.explanation.startsWith(SOFT_UNAVAILABLE_TEXT));
  assert.equal(vm.setup.clearance.visible, false);
  assert.equal(vm.run.canRun, false);                                      // Soft selected + unavailable ⇒ Run disabled
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'hard' });
  assert.equal(h.vm().run.canRun, true);                                   // Hard unaffected

  const v = makeHarness({ basis: { state: 'verified', basisKey: 'shared' } });
  await v.readyHard();
  await v.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await v.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  assert.equal(v.vm().setup.softAvailability.available, true);
  assert.equal(v.vm().setup.clearance.visible, true);
  assert.equal(v.vm().run.canRun, true);

  // Pending: a basis verdict that never settles keeps Soft unavailable (and Run disabled) until it does.
  const p = makeHarness({ basis: () => new Promise(() => {}) });
  await p.readyHard();
  await p.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await p.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  assert.equal(p.vm().setup.softAvailability.pending, true);
  assert.equal(p.vm().setup.softAvailability.available, false);
  assert.equal(p.vm().setup.softAvailability.explanation, null);          // never "not a verified basis" while checking
  assert.equal(p.vm().run.canRun, false);
  const texts = p.vm().setup.validation.messages.map((m) => m.text);
  assert.ok(texts.includes(SOFT_CHECKING_TEXT));
  assert.equal(texts.some((t) => t.startsWith(SOFT_UNAVAILABLE_TEXT)), false);
});

test('AC-P3: RUN_START admits one run; during the run there is no list and no ETA, Stop is enabled in every non-terminal state', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  assert.equal(h.engine.startCalls.length, 1);
  assert.equal(h.engine.startCalls[0].runOptions, undefined);              // no run option invented (AC-P1)
  const seen = [];
  const check = () => {
    const vm = h.vm();
    seen.push(vm.run.state);
    assert.equal(vm.run.canStop, true);
    assert.equal(vm.run.canRun, false);
    assert.equal(vm.results.state, 'running');
    assert.deepEqual(vm.results.rows, []);
    assert.deepEqual(Object.keys(vm.run.progress).sort(), ['caveatCount', 'elapsedText', 'fraction', 'resultsFound', 'unitsEvaluated', 'unitsTotal']);
  };
  check();                                                                // preparing
  handle.emitState({ status: 'planning', phase: 'enumerating' }); await h.settle(); check();
  handle.emitUnit({ unitsTotal: 4, unitsEvaluated: 1, fractionProcessed: 0.25, resultsFound: 3 }); await h.settle(); check();
  assert.equal(h.vm().run.progress.fraction, 0.25);
  assert.equal(h.vm().run.setup, undefined);
  assert.equal(h.vm().setup.collapsed, true);                              // setup collapses when a run starts
  await h.dispatch({ type: INTENT.RUN_START });                            // own run non-terminal ⇒ ignored
  assert.equal(h.engine.startCalls.length, 1);
  await h.dispatch({ type: INTENT.RUN_STOP });
  check();
  assert.deepEqual(handle.cancelReasons, ['user']);
  handle.emitState({ status: 'cancelled', phase: 'finalizing' }); await h.settle(); check();
  assert.deepEqual(seen, ['preparing', 'planning', 'running', 'stopping', 'finalizing']);
  handle.finish({ status: 'cancelled', resultSet: makeSet({ runId: handle.runId, status: 'cancelled', coverage: 'partial', results: [] }) });
  await h.settle();
  assert.equal(h.vm().run.state, 'done');
  assert.equal(h.vm().run.doneKind, 'cancelled');
  assert.equal(h.vm().run.canStop, false);
});

test('"Waiting for another run": the preparing poll re-reads the snapshot and stops once the run moves on', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  assert.equal(h.scheduler.pendingTimers(), 1);                            // one low-frequency poll while preparing
  await h.scheduler.advance(READINESS_POLL_MS);
  await h.settle();
  assert.equal(h.vm().run.waitingForOtherRun, true);
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  await h.scheduler.advance(READINESS_POLL_MS);
  await h.settle();
  assert.equal(h.vm().run.waitingForOtherRun, false);
  assert.equal(h.scheduler.pendingTimers(), 0);
});

test('new run: bridge.clear + release happen ONLY after startRun returns a handle; admission failure preserves everything', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  assert.equal(h.vm().run.doneKind, 'completed');
  const lease = h.engine.resident.get('run-1');
  assert.equal(lease.leases, 1);                                           // saved ⇒ leased
  const clearsBefore = h.bridge.calls.filter((c) => c.op === 'clear').length;

  h.engine.failNextStart(new RunQueueFullError({ limit: 1, queued: 1 }));
  await h.dispatch({ type: INTENT.RUN_START });
  let vm = h.vm();
  assert.equal(vm.run.state, 'done');                                      // previous results still displayed
  assert.equal(vm.run.doneKind, 'completed');
  assert.equal(h.engine.resident.get('run-1').leases, 1);                  // nothing released
  assert.equal(h.bridge.calls.filter((c) => c.op === 'clear').length, clearsBefore);   // Viewer untouched
  const banner = vm.run.banners.find((b) => b.id === 'admission-error');
  assert.equal(banner.kind, 'error');
  assert.equal(banner.action, undefined);

  await h.dispatch({ type: INTENT.RUN_START });                            // admitted this time
  vm = h.vm();
  assert.equal(h.engine.startCalls.length, 3);
  assert.equal(h.bridge.calls.filter((c) => c.op === 'clear').length, clearsBefore + 1);
  assert.equal(h.engine.resident.has('run-1'), false);                     // previous set released after admission
  assert.equal(vm.run.state, 'preparing');
  assert.equal(vm.run.banners.some((b) => b.id === 'admission-error'), false);
});

test('ResultCapacityError caused by the Panel\'s own set offers release-and-retry; RUN_RELEASE_AND_RETRY releases then runs', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  h.engine.failNextStart(new ResultCapacityError({ cap: 1, active: [], retained: ['run-1'], held: [] }));
  await h.dispatch({ type: INTENT.RUN_START });
  const banner = h.vm().run.banners.find((b) => b.id === 'admission-error');
  assert.deepEqual(banner.action, { label: 'Release previous results and retry', intent: { type: INTENT.RUN_RELEASE_AND_RETRY } });
  assert.equal(h.engine.resident.has('run-1'), true);
  await h.dispatch({ type: INTENT.RUN_RELEASE_AND_RETRY });
  assert.equal(h.engine.resident.has('run-1'), false);
  assert.equal(h.vm().run.state, 'preparing');
  assert.equal(h.engine.startCalls.length, 3);
});

test('AC-P14: unsaved (skipped) results need an explicit acknowledgement before Clear or a new Run discards them', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults(), { persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' } });
  let vm = h.vm();
  assert.ok(vm.run.banners.some((b) => /held in memory/i.test(b.text)));
  assert.equal(h.engine.resident.get('run-1').leases, 0);                  // engine-held, not leased

  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  vm = h.vm();
  assert.equal(vm.run.state, 'done');                                      // not cleared yet
  const confirm = vm.run.banners.find((b) => b.id === 'confirm-discard-unsaved');
  assert.deepEqual(confirm.action.intent, { type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(h.engine.resident.has('run-1'), true);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(h.engine.resident.has('run-1'), false);                     // released with acknowledgeUnsaved
  assert.equal(h.vm().run.state, 'idle');
  assert.equal(h.vm().results.state, 'before-run');

  // Run over unsaved results (explicitly confirmed path): confirmation → RELEASE (acknowledged) → admission
  // (startRun). An ordinary, unconfirmed replacement stays admission → release.
  const handle = await h.runToDone(makeSet({ runId: 'run-2', results: [] }), { persistence: { state: 'failed', timedOut: false, attempt: 1 } });
  assert.equal(handle.runId, 'run-2');
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.engine.startCalls.length, 2);                             // asked, not started
  assert.ok(h.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'));
  await h.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(h.engine.startCalls.length, 3);
  assert.equal(h.engine.resident.has('run-2'), false);
});

test('single resident slot (Core-exact admission): an ordinary Run over a SAVED set fails admission and keeps it; a CONFIRMED discard of an unsaved set releases it before startRun', async () => {
  const saved = makeHarness({ capacity: 1 });
  await saved.readyHard();
  await saved.runToDone(twoResults());                                     // saved ⇒ leased ⇒ holds the only slot
  const clears = saved.bridge.calls.filter((c) => c.op === 'clear').length;
  await saved.dispatch({ type: INTENT.RUN_START });
  let vm = saved.vm();
  assert.equal(saved.engine.startCalls.length, 2);
  assert.equal(vm.run.doneKind, 'completed');                              // previous results preserved (§7.6)
  assert.equal(saved.engine.resident.get('run-1').leases, 1);
  assert.equal(saved.bridge.calls.filter((c) => c.op === 'clear').length, clears);
  assert.deepEqual(vm.run.banners.find((b) => b.id === 'admission-error').action.intent, { type: INTENT.RUN_RELEASE_AND_RETRY });

  const unsaved = makeHarness({ capacity: 1 });
  await unsaved.readyHard();
  await unsaved.runToDone(twoResults(), { persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' } });
  await unsaved.dispatch({ type: INTENT.RUN_START });
  assert.equal(unsaved.engine.startCalls.length, 1);                      // asked first
  await unsaved.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  vm = unsaved.vm();
  assert.equal(unsaved.engine.startCalls.length, 2);
  assert.equal(vm.run.state, 'preparing');                                 // admitted: the slot was freed first
  assert.equal(unsaved.engine.resident.has('run-1'), false);
  assert.equal(vm.run.banners.some((b) => b.id === 'admission-error'), false);
});

test('a failed release (stuck lease) shows the release-error banner; the next Clear/Run retries it and recovers', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  h.engine.failNextLeaseRelease(new Error('lease release failed'));        // ⇒ releaseResultSet refuses (lease live)
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  let vm = h.vm();
  assert.equal(vm.run.state, 'idle');                                      // the display is cleared regardless
  assert.ok(vm.run.banners.some((b) => b.id === 'release-error'));
  assert.equal(h.engine.resident.get('run-1').leases, 1);                  // still stuck
  const handle = await h.start();                                           // Run: release() retries the stuck entry
  vm = h.vm();
  assert.equal(h.engine.resident.has('run-1'), false);
  assert.equal(vm.run.banners.some((b) => b.id === 'release-error'), false);
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: [] }) });
  await h.settle();
  h.engine.failNextRelease(new Error('store busy'));                        // releaseResultSet itself fails on Run
  await h.dispatch({ type: INTENT.RUN_START });
  assert.ok(h.vm().run.banners.some((b) => b.id === 'release-error'));
  assert.equal(h.engine.resident.has(handle.runId), true);
  h.engine.lastHandle.finish({ status: 'completed', resultSet: makeSet({ runId: h.engine.lastHandle.runId, results: [] }) });
  await h.settle();
  await h.runToDone(makeSet({ runId: 'x', results: [] }));                 // the next Run's release() retries…
  assert.equal(h.engine.resident.has(handle.runId), false);                 // …and recovers
});

test('A-1: capacity 1 + a STUCK release of the Panel\'s own set ⇒ Run offers release-and-retry (not "other runs"); release-and-retry retries the stuck release and the run starts', async () => {
  const h = makeHarness({ capacity: 1 });
  await h.readyHard();
  await h.runToDone(twoResults());                                         // saved ⇒ leased ⇒ holds the only slot
  h.engine.failNextLeaseRelease(new Error('lease release failed'));
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });                        // display cleared; run-1 is now stuck
  assert.equal(h.engine.resident.get('run-1').leases, 1);
  assert.ok(h.vm().run.banners.some((b) => b.id === 'release-error'));
  await h.dispatch({ type: INTENT.RUN_START });                            // ordinary Run: Core rejects (capacity)
  assert.equal(h.engine.startCalls.length, 2);
  const banner = h.vm().run.banners.find((b) => b.id === 'admission-error');
  assert.ok(banner, 'admission-error banner shown');
  assert.doesNotMatch(banner.text, /other runs/);
  assert.deepEqual(banner.action?.intent, { type: INTENT.RUN_RELEASE_AND_RETRY });
  await h.dispatch({ type: INTENT.RUN_RELEASE_AND_RETRY });
  const vm = h.vm();
  assert.equal(h.engine.startCalls.length, 3);
  assert.equal(h.engine.resident.has('run-1'), false);                     // the stuck release was retried first
  assert.equal(vm.run.state, 'preparing');                                  // …and the new run was admitted
  assert.equal(vm.run.banners.some((b) => b.id === 'admission-error'), false);
  assert.equal(vm.run.banners.some((b) => b.id === 'release-error'), false);
});

test('dispose: a transient late-set release failure is retried before resolving {released:true}; a permanent one resolves {released:false, errors} without rejecting', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  await h.settle();
  const p = h.controller.dispose();
  h.engine.failNextRelease(new Error('transient'));
  handle.finish({ status: 'cancelled', resultSet: makeSet({ runId: handle.runId, status: 'cancelled', coverage: 'partial', results: [] }) });
  const outcome = await p;
  assert.equal(outcome.released, true);
  assert.equal(h.engine.resident.size, 0);

  const g = makeHarness();
  await g.readyHard();
  const h2 = await g.start();
  h2.emitState({ status: 'planning', phase: 'enumerating' });
  await g.settle();
  g.engine.setReleaseFailure(new Error('permanent'));
  const q = g.controller.dispose();
  h2.finish({ status: 'cancelled', resultSet: makeSet({ runId: h2.runId, status: 'cancelled', coverage: 'partial', results: [] }) });
  const bad = await q;
  assert.equal(bad.released, false);
  assert.ok(bad.errors.length > 0);
  assert.equal(g.controller.dispose(), q);                                  // same promise on repeat
  assert.equal(g.bridge.calls.filter((c) => c.op === 'dispose').length, 1); // the bridge is still disposed
});

test('AC-P14: pending → saved upgrades to a lease (Clear then needs no confirmation); pending → failed keeps it unsaved', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.runToDone(twoResults(), { persistence: { state: 'pending', timedOut: true, attempt: 1 } });
  assert.equal(h.engine.resident.get('run-1').leases, 0);
  handle.resolvePersisted({ state: 'saved' });
  await h.settle();
  assert.equal(h.engine.resident.get('run-1').leases, 1);
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.engine.resident.has('run-1'), false);
  assert.equal(h.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'), false);

  const g = makeHarness();
  await g.readyHard();
  const h2 = await g.runToDone(twoResults(), { persistence: { state: 'pending', timedOut: true, attempt: 1 } });
  h2.resolvePersisted({ state: 'failed', error: new Error('disk') });
  await g.settle();
  await g.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.ok(g.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'));
  assert.equal(g.engine.resident.has('run-1'), true);
});

test('setup collapse: auto on run start, user toggle, auto-expand on admission failure; diagnostics preview + copy', async () => {
  const h = makeHarness();
  await h.readyHard();
  assert.equal(h.vm().setup.collapsed, false);
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_COLLAPSED });
  assert.equal(h.vm().setup.collapsed, true);
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_COLLAPSED });
  assert.equal(h.vm().setup.collapsed, false);
  const set = makeSet({ runId: 'run-1', status: 'failed', coverage: 'partial', reasons: ['planning:model-not-bound'], ledger: { planningGaps: [{ phase: 'binding', cause: 'model-not-bound' }] }, diagnosticsTruncated: true });
  await h.runToDone(set);
  assert.equal(h.vm().setup.collapsed, false);                            // re-expanded on failure
  const diag = h.vm().run.diagnostics;
  assert.equal(diag.available, true);
  assert.ok(diag.preview.length <= 10);
  assert.ok(diag.preview.some((l) => l.includes('model-not-bound')));
  assert.ok(diag.preview.includes('Diagnostic detail was truncated'));
  const text = await h.controller.dispatch({ type: INTENT.DIAGNOSTICS_COPY });
  assert.equal(typeof text, 'string');
  assert.equal(JSON.parse(text).diagnostics.truncated, true);
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_COLLAPSED });               // collapse, then fail an admission
  h.engine.failNextStart(new RunQueueFullError({ limit: 1, queued: 1 }));
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.vm().setup.collapsed, false);
  const empty = makeHarness();
  assert.equal(await empty.controller.dispatch({ type: INTENT.DIAGNOSTICS_COPY }), null);
  assert.equal(empty.vm().run.diagnostics, null);
});

test('a foreign isolation change reported by bridge.clear() becomes an isolation notice; the next clean clear removes it', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  h.bridge.setClearOutcome({ isolation: 'skipped-external', markersRemoved: 0, notes: [] });
  await h.runToDone(makeSet({ runId: 'run-2', results: [] }));             // new run ⇒ clear()
  const notice = h.vm().run.banners.find((b) => b.id === 'isolation-notice');
  assert.deepEqual({ kind: notice.kind, text: notice.text }, { kind: 'info', text: 'Isolation was changed elsewhere, so the Panel left it as is.' });
  h.bridge.setClearOutcome({ isolation: 'failed', markersRemoved: 0, notes: [] });
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  assert.equal(h.vm().run.banners.find((b) => b.id === 'isolation-notice').kind, 'warning');
  h.bridge.setClearOutcome({ isolation: 'restored', markersRemoved: 2, notes: [] });
  await h.runToDone(makeSet({ runId: 'run-3', results: [] }));
  assert.equal(h.vm().run.banners.some((b) => b.id === 'isolation-notice'), false);
});

test('a null resultSet (fallback seal failed) ⇒ failed headline, error results state, setup re-expanded', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(null, { status: 'failed', persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'seal-failed' } });
  const vm = h.vm();
  assert.equal(vm.run.doneKind, 'failed');
  assert.equal(vm.results.state, 'error');
  assert.ok(vm.run.headline.length > 0 && vm.run.headline !== 'No clashes');
  assert.equal(vm.setup.collapsed, false);
});

test('AC-P15 + AC-P14: dispose during an active run cancels it; the late done releases its own set and changes nothing', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  await h.settle();
  const before = h.vm();
  const p1 = h.controller.dispose();
  const p2 = h.controller.dispose();
  assert.equal(p1, p2);                                                    // idempotent
  let resolved = false;
  p1.then(() => { resolved = true; });
  await h.settle();
  assert.deepEqual(handle.cancelReasons, ['panel-disposed']);
  assert.equal(resolved, false);                                           // waits for the cancelled run's done
  handle.finish({ status: 'cancelled', resultSet: makeSet({ runId: handle.runId, status: 'cancelled', coverage: 'partial', results: [{ a: ['mA', 1], b: ['mB', 10] }] }) });
  await p1;
  assert.equal(h.engine.resident.size, 0);                                 // released BEFORE dispose resolved
  assert.equal(h.bridge.calls.filter((c) => c.op === 'dispose').length, 1);
  await h.settle();
  assert.equal(h.vm(), before);                                            // display unchanged after dispose
  h.catalog.fire();                                                        // listener removed: no throw, no change
  await h.settle();
  assert.equal(h.vm(), before);
  await h.controller.dispatch({ type: INTENT.RUN_START });                 // no-op after dispose
  assert.equal(h.engine.startCalls.length, 1);
});

test('setupChangedSinceRun: set by an edit after a run, cleared by the next admitted run; New test clears results', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  assert.equal(h.vm().setup.setupChangedSinceRun, false);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Renamed' });
  assert.equal(h.vm().setup.setupChangedSinceRun, true);
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  const vm = h.vm();
  assert.equal(vm.setup.setupChangedSinceRun, false);
  assert.equal(vm.setup.name, 'Clash test 2');
  assert.equal(vm.run.state, 'idle');
  assert.equal(h.engine.resident.size, 0);
});

test('AC-P20: the controller works on the narrowed port; forbidden engine members are never reached', async () => {
  const h = makeHarness();
  await h.readyHard();
  await h.runToDone(twoResults());
  await h.dispatch({ type: INTENT.RESULTS_CLEAR });
  await h.controller.dispose();
  assert.deepEqual(h.engine.forbidden, []);
  const scheduler = createFakeScheduler();
  const catalog = createFakeCatalog({ models: [] });
  const noDerivations = { ...createScriptedEngine(), derivations: undefined };
  assert.throws(() => createPanelController({ engine: noDerivations, catalog, bridge: createRecordingBridge(), scheduler, mintId: () => 'x' }), TypeError);
});

test('RF-1: a double Run in one tick admits exactly once — also when that admission fails (one banner)', async () => {
  const h = makeHarness();
  await h.readyHard();
  await Promise.all([h.controller.dispatch({ type: INTENT.RUN_START }), h.controller.dispatch({ type: INTENT.RUN_START })]);
  await h.settle();
  assert.equal(h.engine.startCalls.length, 1);
  await h.dispatch({ type: INTENT.RUN_START });                            // own run non-terminal ⇒ ignored
  assert.equal(h.engine.startCalls.length, 1);

  const g = makeHarness();
  await g.readyHard();
  g.engine.failNextStart(new RunQueueFullError({ limit: 1, queued: 1 }));
  g.engine.failNextStart(new RunQueueFullError({ limit: 1, queued: 1 }));
  await Promise.all([g.controller.dispatch({ type: INTENT.RUN_START }), g.controller.dispatch({ type: INTENT.RUN_START })]);
  await g.settle();
  assert.equal(g.engine.startCalls.length, 1);
  assert.equal(g.vm().run.banners.filter((b) => b.id === 'admission-error').length, 1);
  await g.dispatch({ type: INTENT.RUN_START });                            // a later, separate click tries again
  assert.equal(g.engine.startCalls.length, 2);
});

test('RF-2: two catalog models with the same display name are distinguishable in the setup checklist and scope', async () => {
  const h = makeHarness({ displayNames: { mA: 'Model', mB: 'Model' } });
  await h.readyHard();
  const vm = h.vm();
  assert.deepEqual(vm.setup.models.map((m) => m.displayName), ['Model · …mA', 'Model · …mB']);
  assert.deepEqual(vm.setup.scope, { A: 'Model · …mA', B: 'Model · …mB' });
});

test('RF-4: setup edits during a run never touch that run; edit-then-revert reruns with the same definitionKey and revision', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  const def1 = h.engine.startCalls[0].definition;
  const frozen = JSON.stringify(def1);
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Edited while running' });
  assert.equal(h.vm().setup.setupChangedSinceRun, true);
  assert.equal(JSON.stringify(def1), frozen);                              // the running run's identity is untouched
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: [{ a: ['mA', 1], b: ['mB', 10] }] }) });
  await h.settle();
  assert.equal(h.vm().run.doneKind, 'completed');                          // its results are displayed as sealed
  assert.equal(h.vm().setup.setupChangedSinceRun, true);                   // …and flagged as the previous setup
  await h.dispatch({ type: INTENT.SETUP_NAME, value: def1.name });         // revert
  await h.dispatch({ type: INTENT.RUN_START });
  const def2 = h.engine.startCalls[1].definition;
  assert.equal(definitionKey(def2), definitionKey(def1));
  assert.equal(def2.revision, def1.revision);                              // same question ⇒ same revision (stable resultIds)
  h.engine.lastHandle.finish({ status: 'completed', resultSet: makeSet({ runId: 'run-2', results: [] }) });
  await h.settle();
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'A different question' });
  await h.dispatch({ type: INTENT.RUN_START });
  const def3 = h.engine.startCalls[2].definition;
  assert.ok(def3.revision > def2.revision);                                // a changed definition bumps
  h.engine.lastHandle.finish({ status: 'completed', resultSet: makeSet({ runId: 'run-3', results: [] }) });
  await h.settle();
  await h.dispatch({ type: INTENT.SETUP_NAME, value: def1.name });
  await h.dispatch({ type: INTENT.RUN_START });
  const def4 = h.engine.startCalls[3].definition;
  assert.equal(definitionKey(def4), definitionKey(def1));
  assert.ok(def4.revision > def3.revision);                                // monotone: an old revision is never reused
});

test('Use current selection maps Viewer selection to element entries through keyOfModel (unknown models skipped)', async () => {
  const h = makeHarness();
  h.bridge.setSelection([{ model: h.modelA, dbIds: [5, 3, 5] }, { model: { stranger: true }, dbIds: [9] }]);
  await h.dispatch({ type: INTENT.SETUP_USE_SELECTION, side: 'A' });
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });
  assert.equal(h.vm().setup.scope.A, '2 elements in Architecture');
  assert.equal(h.vm().setup.models[0].inA, true);
  await h.dispatch({ type: INTENT.RUN_START });
  const def = h.engine.startCalls[0].definition;
  assert.deepEqual(def.selectionA.entries, [{ kind: 'elements', modelKey: 'mA', dbIds: [3, 5] }]);
});
