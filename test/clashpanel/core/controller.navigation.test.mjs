// test/clashpanel/core/controller.navigation.test.mjs — Task 18: selection, navigation, present intents,
// restore-table triggers, model events, dispose (spec §9, §11.2, §12.2; AC-P5, AC-P6 (controller side), AC-P7,
// AC-P14, AC-P15, AC-P17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { PAGE_SIZE, FILTER_DEBOUNCE_MS } from '../../../clashpanel/core/constants.js';
import { makeHarness, makeSet, hardResults } from '../support/controllerHarness.mjs';

async function doneWith(set, harnessOptions) {
  const h = makeHarness(harnessOptions);
  await h.readyHard();
  await h.runToDone(set);
  return h;
}
const presents = (h) => h.bridge.calls.filter((c) => c.op === 'present');
const clears = (h) => h.bridge.calls.filter((c) => c.op === 'clear').length;

test('row select presents the live sides with the Hard witness point and per-toggle options (Focus on select default on)', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(10) }));
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: null });
  const [call] = presents(h);
  assert.deepEqual(call.req.sides, [{ model: h.modelA, dbId: 1002 }, { model: h.modelB, dbId: 2002 }]);
  assert.deepEqual(call.req.point, [2, 0, 0]);
  assert.equal(call.req.closestPoints, undefined);
  assert.deepEqual(call.req.options, { focus: true, isolate: false, marker: true });
  const vm = h.vm();
  assert.equal(vm.selected.resultId, 'r2');
  assert.equal(vm.selected.ordinal, 3);
  assert.deepEqual(vm.selected.side1, { modelKey: 'mA', modelName: 'Architecture', label: 'A-1002', dbId: 1002 });
  assert.equal(vm.selected.hasLocation, true);
  assert.equal(vm.selected.liveness, 'live');
  assert.deepEqual(vm.selected.actions.focus, { enabled: true, reason: null });
  assert.deepEqual(vm.selected.actions.focusOnSelect, { checked: true });
  assert.deepEqual(vm.results.rows.filter((r) => r.selected).map((r) => r.resultId), ['r2']);
  assert.equal(vm.results.nav.label, 'Clash #3');
  assert.equal(h.engine.control.summarize.successes, 1);                   // selection is not a derivation
});

test('Focus on select off ⇒ select without fit; the Focus button always fits', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(5) }));
  await h.dispatch({ type: INTENT.ACTION_FOCUS_ON_SELECT, value: false });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: null });
  await h.dispatch({ type: INTENT.NAV_NEXT });
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.deepEqual(presents(h).map((c) => c.req.options.focus), [false, false, true]);
  assert.equal(h.vm().selected.resultId, 'r2');
});

test('Soft presents closestPoints (the midpoint is the location); no point is sent', async () => {
  const set = makeSet({ runId: 'run-1', mode: 'clearance', clearance: 0.05, results: [{ a: ['mA', 1], b: ['mB', 10], distance: 0.02 }] });
  const h = await doneWith(set);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  const [call] = presents(h);
  assert.deepEqual(call.req.closestPoints, { first: [0, 0, 0], second: [0.02, 0, 0] });
  assert.equal(call.req.point, undefined);
  assert.equal(h.vm().selected.gap, '0.020 scene units');
});

test('Isolate is disabled with the bridge\'s reason when the §9.5 prerequisite fails; enabled toggles re-present without fit', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(3) }));
  h.bridge.setIsolationPrerequisite({ available: false, reason: 'Some elements are hidden — show all to enable isolation' });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  await h.dispatch({ type: INTENT.ACTION_ISOLATE, value: true });
  let vm = h.vm();
  assert.deepEqual(vm.selected.actions.isolate, { enabled: false, checked: false, reason: 'Some elements are hidden — show all to enable isolation' });
  assert.equal(presents(h).at(-1).req.options.isolate, false);
  h.bridge.setIsolationPrerequisite({ available: true, reason: null });
  await h.dispatch({ type: INTENT.ACTION_ISOLATE, value: true });
  await h.dispatch({ type: INTENT.ACTION_MARKERS, value: false });
  vm = h.vm();
  assert.deepEqual(vm.selected.actions.isolate, { enabled: true, checked: true, reason: null });
  assert.deepEqual(presents(h).at(-1).req.options, { focus: false, isolate: true, marker: false });
});

test('AC-P7: one live side ⇒ that side only + "<model> is not loaded"; no live side ⇒ nothing attempted, actions disabled, still selectable', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(4) }));
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  h.catalog.removeModel('mB');                                             // mB left the scene (hideModel-like)
  await h.settle();
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: null });
  const last = presents(h).at(-1);
  assert.deepEqual(last.req.sides, [{ model: h.modelA, dbId: 1001 }]);
  let vm = h.vm();
  assert.deepEqual(vm.selected.notes, ['Structure is not loaded']);
  assert.equal(vm.selected.liveness, 'not in scene');
  assert.equal(vm.results.rows[1].liveness, 'not in scene');
  h.engine.setBinding('mA', null);                                         // mA unregistered too
  const before = presents(h).length;
  const clearsBefore = clears(h);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: null });
  assert.equal(presents(h).length, before);                                // no Viewer action for an unresolvable side
  assert.equal(clears(h), clearsBefore + 1);                               // the previous clash is not left on screen
  vm = h.vm();
  assert.equal(vm.selected.resultId, 'r2');
  assert.equal(vm.selected.actions.focus.enabled, false);
  assert.match(vm.selected.actions.focus.reason, /unavailable/);
  assert.equal(vm.selected.actions.markers.enabled, false);
  assert.equal(vm.selected.actions.isolate.enabled, false);
  assert.equal(vm.run.counts.total, 4);                                    // list/counts keep working
});

test('AC-P5: Prev/Next walk the list across pages; the page follows the selection; ends do not wrap', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(PAGE_SIZE + 5) }));
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: `r${PAGE_SIZE - 1}`, groupId: null });
  assert.equal(h.vm().results.page.index, 0);
  await h.dispatch({ type: INTENT.NAV_NEXT });
  assert.equal(h.vm().selected.resultId, `r${PAGE_SIZE}`);
  assert.equal(h.vm().results.page.index, 1);
  await h.dispatch({ type: INTENT.NAV_PREV });
  assert.equal(h.vm().results.page.index, 0);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: `r${PAGE_SIZE + 4}`, groupId: null });
  assert.equal(h.vm().results.nav.canNext, false);
  const n = presents(h).length;
  await h.dispatch({ type: INTENT.NAV_NEXT });
  assert.equal(presents(h).length, n);
  assert.equal(h.vm().selected.resultId, `r${PAGE_SIZE + 4}`);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  assert.equal(h.vm().results.nav.canPrev, false);
});

test('AC-P17: a grouped occurrence keeps page and navScope across re-sort and filter changes; detail keyed by resultId is unchanged', async () => {
  const results = Array.from({ length: 60 }, (_, i) => ({ a: ['mA', 1000 + i], b: ['mB', 10] }));
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  const gMB10 = JSON.stringify(['element', {}, { dbId: 10, modelKey: 'mB' }]);
  const gMA1005 = JSON.stringify(['element', {}, { dbId: 1005, modelKey: 'mA' }]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: gMA1005 });       // r5 also rendered on page 0
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r5', groupId: gMB10 });
  let vm = h.vm();
  assert.equal(vm.results.page.index, 1);                                  // mB:10 members start after 60 mA headers
  assert.ok(vm.results.rows.some((r) => r.key === `${gMB10}|r5` && r.selected));
  const presentCount = presents(h).length;
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });     // rebuilt ordering: occurrence still on page 1
  vm = h.vm();
  assert.equal(vm.results.page.index, 1);
  assert.ok(vm.results.rows.some((r) => r.key === `${gMB10}|r5` && r.selected));
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-count' });       // mB:10 (60) moves to the top
  vm = h.vm();
  assert.equal(vm.results.page.index, 0);
  assert.ok(vm.results.rows.some((r) => r.key === `${gMB10}|r5` && r.selected));
  await h.dispatch({ type: INTENT.SORT_SET, value: 'group-label' });       // "Structure · B-10" sorts after every "Architecture · …"
  vm = h.vm();
  assert.equal(vm.results.page.index, 1);
  assert.ok(vm.results.rows.some((r) => r.key === `${gMB10}|r5` && r.selected));
  assert.equal(vm.selected.resultId, 'r5');
  assert.equal(presents(h).length, presentCount);                          // sort/filter never re-present
  await h.dispatch({ type: INTENT.NAV_NEXT });                             // stays inside the mB:10 group
  assert.equal(h.vm().selected.resultId, 'r6');
  assert.equal(presents(h).at(-1).req.sides.length, 2);
  assert.equal(h.vm().results.nav.label, 'Clash #7 (within its group)');
});

test('collapsing the navScope group ends group-scoped navigation: Next lands on a rendered occurrence and the page follows', async () => {
  const results = Array.from({ length: 60 }, (_, i) => ({ a: ['mA', 1000 + i], b: ['mB', 10] }));
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  const gMB10 = JSON.stringify(['element', {}, { dbId: 10, modelKey: 'mB' }]);
  const gMA1006 = JSON.stringify(['element', {}, { dbId: 1006, modelKey: 'mA' }]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: gMA1006 });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r5', groupId: gMB10 });
  assert.equal(h.vm().results.page.index, 1);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: gMB10 });           // collapse the group being navigated
  assert.equal(h.vm().results.nav.label, 'Clash #6');                        // no longer "(within its group)"
  await h.dispatch({ type: INTENT.NAV_NEXT });
  const vm = h.vm();
  assert.equal(vm.selected.resultId, 'r6');                                  // the only rendered result occurrence
  assert.equal(vm.results.page.index, 0);                                    // the page followed it
  assert.ok(vm.results.rows.some((r) => r.key === `${gMA1006}|r6` && r.selected));
});

test('AC-P5: a selection hidden by filters keeps its detail and the note; the page does not jump; Next goes to the first', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(120) }));
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r9', groupId: null });   // r9 has no witness
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 1 });
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  let vm = h.vm();
  assert.equal(vm.selected.resultId, 'r9');
  assert.equal(vm.selected.hiddenByFilters, true);
  assert.equal(vm.results.hiddenByFiltersNote, true);
  assert.equal(vm.results.page.index, 1);
  await h.dispatch({ type: INTENT.NAV_NEXT });
  vm = h.vm();
  assert.equal(vm.selected.resultId, 'r0');
  assert.equal(vm.selected.hiddenByFilters, false);
  assert.equal(vm.results.page.index, 0);
});

test('Back to All clears the Viewer and the selection only; Hide Panel clears the Viewer but keeps the selection', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(120) }));
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  await h.dispatch({ type: INTENT.NAV_PAGE, page: 1 });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r60', groupId: null });
  const c0 = clears(h);
  await h.dispatch({ type: INTENT.PANEL_HIDDEN });
  assert.equal(clears(h), c0 + 1);
  assert.equal(h.vm().selected.resultId, 'r60');                           // kept (reapply via Focus)
  await h.dispatch({ type: INTENT.ACTION_FOCUS });
  assert.equal(presents(h).at(-1).req.options.focus, true);
  await h.dispatch({ type: INTENT.ACTION_BACK_TO_ALL });
  const vm = h.vm();
  assert.equal(clears(h), c0 + 2);
  assert.equal(vm.selected, null);
  assert.equal(vm.filters.hasLocation, true);                              // filters untouched
  assert.equal(vm.results.page.index, 1);                                  // page untouched
  assert.equal(vm.run.counts.total, 120);
});

test('model left: clears only a visualization that references it (idempotent for unload+removed); results, counts and filters keep working', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(20) }));
  const c0 = clears(h);
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });          // nothing presented yet
  await h.settle();
  assert.equal(clears(h), c0);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r3', groupId: null });
  const freshness = h.engine.control.getFreshness.calls;
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });          // the same unload, second event
  await h.settle();
  assert.equal(clears(h), c0 + 1);
  assert.ok(h.engine.control.getFreshness.calls > freshness);
  const vm = h.vm();
  assert.equal(vm.selected.resultId, 'r3');                                // selection kept
  assert.ok(vm.results.rows.every((r) => r.liveness === 'not in scene'));
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  assert.equal(h.vm().run.counts.filtered, 18);
  const c1 = clears(h);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r4', groupId: null });   // mA still live: one side
  h.bridge.fireModelLeft({ model: { unrelated: true }, reason: 'removed' });      // unknown model ⇒ conservative clear
  await h.settle();
  assert.equal(clears(h), c1 + 1);
});

test('RF-3: a model unloads/hides while the run is non-terminal — no Viewer mutation, no throw; after done its rows are unavailable and the list keeps working', async () => {
  const h = makeHarness();
  await h.readyHard();
  const handle = await h.start();
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  await h.settle();
  const mutating = h.bridge.calls.length;
  h.engine.setBinding('mB', null);                                         // host unregistered (wireModelUnload)
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'removed' });          // the same unload's second event
  h.catalog.fire();
  await h.settle();
  assert.equal(h.bridge.calls.length, mutating);                           // nothing presented ⇒ nothing to clear
  assert.equal(h.vm().run.state, 'planning');                              // the run continues
  const freshness = h.engine.control.getFreshness.calls;
  handle.finish({ status: 'completed', resultSet: makeSet({ runId: handle.runId, results: hardResults(12) }) });
  await h.settle();
  assert.ok(h.engine.control.getFreshness.calls > freshness);              // re-checked for the sealed set
  let vm = h.vm();
  assert.equal(vm.run.doneKind, 'completed');
  assert.ok(vm.results.rows.every((r) => r.liveness === 'model not loaded'));
  assert.equal(vm.run.counts.total, 12);
  await h.dispatch({ type: INTENT.FILTER_HAS_LOCATION, value: true });
  assert.equal(h.vm().run.counts.filtered, 11);
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  vm = h.vm();
  assert.equal(vm.results.view, 'grouped');
  assert.ok(vm.results.rows.length > 0);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  assert.equal(h.bridge.presents.at(-1).req.sides.length, 1);              // only the live mA side
});

test('a new run drops the selection (restore table) and later outcomes of an old present are ignored', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(5) }));
  h.bridge.setManual(true);
  const pending = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: null });
  await h.settle();
  await h.runToDone(makeSet({ runId: 'run-2', results: hardResults(2) }));
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, marked: true, notes: ['late note'] });
  await pending;
  await h.settle();
  const vm = h.vm();
  assert.equal(vm.selected, null);
  assert.equal(vm.run.headline.includes('2'), true);
  assert.equal(JSON.stringify(vm).includes('late note'), false);
});

test('present outcome notes reach the detail; superseded outcomes do not', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(3) }));
  h.bridge.setManual(true);
  const first = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  const second = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r1', groupId: null });
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, marked: true, notes: ['stale'] });
  h.bridge.resolvePresent({ superseded: false, fitted: false, isolated: false, marked: true, notes: ['Framed the first live side only'] });
  await Promise.all([first, second]);
  await h.settle();
  assert.deepEqual(h.vm().selected.notes, ['Framed the first live side only']);
});

test('dispose: cancels, releases, disposes the bridge once, removes every listener; later events are inert', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(3) }));
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  assert.equal(h.bridge.listenerCount(), 1);
  const before = h.vm();
  await Promise.all([h.controller.dispose(), h.controller.dispose()]);
  assert.equal(h.bridge.listenerCount(), 0);
  assert.equal(h.bridge.calls.filter((c) => c.op === 'dispose').length, 1);
  assert.equal(h.engine.resident.size, 0);                                 // leased set released (AC-P14)
  h.catalog.fire();
  await h.settle();
  assert.equal(h.vm(), before);
  assert.equal(await h.controller.dispatch({ type: INTENT.NAV_NEXT }), undefined);
  assert.deepEqual(h.engine.forbidden, []);
});

test('a new selection never carries the previous clash\'s notes (subscriber view); a clear-only outcome still notifies, also when clear is delayed or fails', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(5) }));
  const seen = [];
  h.controller.subscribe((vm) => seen.push(vm));
  h.bridge.setManual(true);
  const p1 = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r0', groupId: null });
  await h.settle();
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, marked: true, notes: ['note A'] });
  await p1;
  await h.settle();
  assert.deepEqual(h.vm().selected.notes, ['note A']);
  h.engine.setBinding('mA', null);
  h.engine.setBinding('mB', null);
  let releaseClear;
  h.bridge.setClearImpl(() => new Promise((resolve) => { releaseClear = () => resolve({ isolation: 'none', markersRemoved: 1, notes: [] }); }));
  const mark = seen.length;
  const p2 = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r2', groupId: null });
  await h.settle();
  for (const vm of seen.slice(mark)) if (vm.selected?.resultId === 'r2') assert.equal(vm.selected.notes.includes('note A'), false);
  const beforeClear = seen.length;
  releaseClear();
  await p2;
  await h.settle();
  assert.ok(seen.length > beforeClear);                                    // the clear-only completion notified
  assert.deepEqual(seen.at(-1).selected.notes, []);

  h.engine.setBinding('mA', { modelKey: 'mA', model: h.modelA, modelVersion: 'v1', bindingGeneration: 1 });
  const p3 = h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r3', groupId: null });
  await h.settle();
  h.bridge.resolvePresent({ superseded: false, fitted: true, isolated: false, marked: true, notes: ['note B'] });
  await p3;
  h.engine.setBinding('mA', null);
  h.bridge.setClearImpl(() => Promise.reject(new Error('clear failed')));
  const before = seen.length;
  await assert.doesNotReject(h.controller.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r4', groupId: null }));
  await h.settle();
  assert.ok(seen.length > before);
  assert.deepEqual(seen.at(-1).selected.notes, []);
  assert.equal(seen.at(-1).run.banners.find((b) => b.id === 'isolation-notice').kind, 'warning');   // a failed clear is reported
});

test('freshness bursts (Panel show + catalog change + model left): coalesced per tick, older checks aborted, only the newest commits', async () => {
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.getFreshness.manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: hardResults(3) }));
  assert.equal(h.engine.control.getFreshness.calls, 1);
  void h.controller.dispatch({ type: INTENT.PANEL_SHOWN });               // three triggers in ONE tick…
  h.catalog.fire();
  h.bridge.fireModelLeft({ model: { unrelated: true }, reason: 'removed' });
  await h.settle();
  assert.equal(h.engine.control.getFreshness.calls, 2);                    // …one new check
  await h.dispatch({ type: INTENT.PANEL_SHOWN });
  h.catalog.fire();
  await h.settle();
  const signals = h.engine.control.getFreshness.args.map((args) => args[1].signal);
  assert.equal(signals.length, 4);
  assert.deepEqual(signals.map((s) => s.aborted), [true, true, true, false]);   // all but the newest aborted
  assert.equal(h.vm().run.badges.freshness.pending, true);                 // aborts are swallowed, not 'unverifiable'
  h.engine.control.getFreshness.resolveAll({ state: 'stale', reasons: ['scope-drift'] });
  await h.settle();
  assert.equal(h.vm().run.badges.freshness.value, 'stale');
  assert.equal(h.vm().run.badges.freshness.pending, false);
});

test('freshness bursts on an EMPTY set: the whole freshness+claim pair of every older check is aborted; only the newest pair commits', async () => {
  const h = makeHarness();
  await h.readyHard();
  h.engine.control.getFreshness.manual = true;
  h.engine.control.assessNoClashClaim.manual = true;
  await h.runToDone(makeSet({ runId: 'run-1', results: [] }));
  void h.controller.dispatch({ type: INTENT.PANEL_SHOWN });
  h.catalog.fire();
  h.bridge.fireModelLeft({ model: { unrelated: true }, reason: 'removed' });
  await h.settle();
  await h.dispatch({ type: INTENT.PANEL_SHOWN });
  await h.settle();
  const fresh = h.engine.control.getFreshness.args.map((a) => a[1].signal);
  const claim = h.engine.control.assessNoClashClaim.args.map((a) => a[1].signal);
  assert.equal(fresh.length, 3);
  assert.equal(claim.length, 3);
  for (let i = 0; i < 3; i += 1) assert.equal(fresh[i], claim[i]);          // one signal per check pair
  assert.deepEqual(claim.map((s) => s.aborted), [true, true, false]);
  assert.equal(h.vm().results.state, 'empty-nonclaim');                    // pending ⇒ never worded as a claim
  h.engine.control.getFreshness.resolveAll();
  h.engine.control.assessNoClashClaim.resolveAll();
  await h.settle();
  assert.equal(h.vm().results.state, 'empty-claim');
  assert.equal(h.vm().run.badges.freshness.pending, false);
});

test('dispose contract: pending until the held run is done AND its set released AND the bridge disposed; same promise; never rejects', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(3) }));
  const handle = await h.start();                                          // run-1 released at admission
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  handle.emitUnit({ unitsTotal: 1 });
  await h.settle();
  let resolved = false;
  const p = h.controller.dispose();
  p.then(() => { resolved = true; });
  assert.equal(h.controller.dispose(), p);
  await h.settle();
  assert.deepEqual(handle.cancelReasons, ['panel-disposed']);
  assert.equal(resolved, false);
  assert.equal(h.bridge.calls.filter((c) => c.op === 'dispose').length, 0);   // bridge disposed only after release
  handle.finish({ status: 'cancelled', resultSet: makeSet({ runId: handle.runId, status: 'cancelled', coverage: 'partial', results: hardResults(2) }), persistence: { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' } });
  assert.deepEqual(await p, { released: true, errors: [] });
  assert.equal(h.engine.resident.size, 0);                                 // unsaved sealed set released (acknowledged)
  assert.equal(h.bridge.calls.filter((c) => c.op === 'dispose').length, 1);

  const idle = await doneWith(makeSet({ runId: 'run-1', results: hardResults(1) }));
  assert.equal(idle.engine.resident.get('run-1').leases, 1);
  const q = idle.controller.dispose();
  await q;
  assert.equal(idle.engine.resident.size, 0);                              // no active run: resolves after release

  const failing = await doneWith(makeSet({ runId: 'run-1', results: hardResults(1) }));
  failing.bridge.dispose = () => Promise.reject(new Error('bridge teardown failed'));
  await assert.doesNotReject(failing.controller.dispose());
});

test('every INTENT value is handled by the dispatch table', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(3) }));
  const payload = {
    [INTENT.NAV_SELECT]: { resultId: 'r0', groupId: null }, [INTENT.NAV_PAGE]: { page: 0 },
    [INTENT.FILTER_MODEL]: { value: [] }, [INTENT.FILTER_ELEMENT]: { ref: null }, [INTENT.GROUP_TOGGLE]: { groupId: 'x' },
    [INTENT.SETUP_TOGGLE_MODEL]: { side: 'A', modelKey: 'mA' }, [INTENT.SETUP_USE_SELECTION]: { side: 'B' },
  };
  for (const type of Object.values(INTENT)) {
    await assert.doesNotReject(async () => { await h.controller.dispatch({ type, value: false, ...(payload[type] ?? {}) }); }, `intent ${type}`);
  }
  await h.settle();
  assert.throws(() => h.controller.dispatch({ type: 'nav/teleport' }), { name: 'TypeError', message: /unknown intent/ });
});

// Carry-forward (T14 orderedList): navNeighbor matches a scoped selection by resultId only, so navScope must always be
// the selected occurrence's OWN group. A whole-list step that lands in another group (the scope group was filtered
// out) must drop the scope — otherwise, once the filter is cleared, Next would jump to the first member of the stale group.
test('carry-forward (T14): a whole-list step into another group drops navScope; clearing the filter never jumps into the stale group', async () => {
  const results = [
    ...Array.from({ length: 60 }, (_, i) => ({ a: ['mA', 1000 + i], b: ['mB', 10] })),
    { a: ['mA', 2060], b: ['mB', 11] }, { a: ['mA', 2061], b: ['mB', 11] },
  ];
  const h = await doneWith(makeSet({ runId: 'run-1', results }));
  await h.dispatch({ type: INTENT.GROUP_MODE, value: 'element' });
  const gMB10 = JSON.stringify(['element', {}, { dbId: 10, modelKey: 'mB' }]);
  const gMB11 = JSON.stringify(['element', {}, { dbId: 11, modelKey: 'mB' }]);
  await h.dispatch({ type: INTENT.GROUP_TOGGLE, groupId: gMB11 });
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: 'r5', groupId: gMB10 });
  assert.equal(h.vm().results.nav.label, 'Clash #6 (within its group)');
  await h.dispatch({ type: INTENT.FILTER_ELEMENT, ref: { modelKey: 'mB', dbId: 11 } });   // gMB10 filtered out
  await h.dispatch({ type: INTENT.NAV_NEXT });                                // whole list ⇒ first rendered: r60 in gMB11
  assert.equal(h.vm().selected.resultId, 'r60');
  assert.equal(h.vm().results.nav.label, 'Clash #61');                        // not "(within its group)"
  await h.dispatch({ type: INTENT.FILTER_CLEAR });
  await h.dispatch({ type: INTENT.NAV_NEXT });
  assert.equal(h.vm().selected.resultId, 'r61');                              // never r0 (first member of stale gMB10)
});

// Carry-forward (T15 labels): forgetModel() alone does not supersede an in-flight warm(); a model that leaves while the
// text-filter label index is being built must not have its element names committed by that (older) pass.
test('carry-forward (T15): a model that leaves while the label index is warming never gets its element names committed', async () => {
  const h = await doneWith(makeSet({ runId: 'run-1', results: hardResults(30) }));
  const hold = h.scheduler.holdYields();
  await h.controller.dispatch({ type: INTENT.FILTER_TEXT, value: 'b-2003' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);                              // warm() read every name; its yield is held
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 0);                                // names not indexed yet
  h.engine.setBinding('mB', null);
  h.catalog.removeModel('mB');
  h.bridge.fireModelLeft({ model: h.modelB, reason: 'unload' });
  await h.settle();
  hold.release();
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 0);                                // "B-2003" came from the unloaded model
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'a-1003' });
  await h.scheduler.advance(FILTER_DEBOUNCE_MS);
  await h.settle();
  assert.equal(h.vm().run.counts.filtered, 1);                                // the live model's names still index
});
