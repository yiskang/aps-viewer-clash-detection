// test/clashpanel/core/controller.basis.test.mjs — owner decision 2026-10-07: Soft needs a measurement basis, not a verified
// one. The user may attest a unit or choose raw model units; the run record says exactly that and never `verified`.
// Also documents precisely what "New test" resets and that it is a no-op while a run is active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT } from '../../../clashpanel/core/intents.js';
import { READY_TEXT, NOT_READY_TEXT } from '../../../clashpanel/core/viewModel.js';
import { makeHarness, makeSet, makeFakeModel, hardResults } from '../support/controllerHarness.mjs';

const BASIS_LABEL = 'Measurement basis (at run start)';
const basisLine = (vm) => vm.run.details.lines.find((l) => l.label === BASIS_LABEL)?.value;
const stripNegated = (text) => text.replace(/not verified/g, '');            // "user-supplied, not verified" must not read as verified

/** Two models, and NO host measurementBasis at all (the catalog cannot say anything about a common basis). */
async function noHostBasisHarness() {
  const h = makeHarness();
  delete h.catalog.measurementBasis;
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  return h;
}

function addModelC(h) {
  const model = makeFakeModel('C', (dbId) => `C-${dbId}`);
  h.catalog.addModel({ modelKey: 'mC', displayName: 'Mechanical', model, loaded: true });
  h.engine.setBinding('mC', { modelKey: 'mC', model, modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 });
  h.catalog.fire();
}

const softSet = (runId = 'run-1') => makeSet({ runId, mode: 'clearance', clearance: 0.05, results: [{ a: ['mA', 1], b: ['mB', 10], distance: 0.01 }] });

test('user-supplied is never verified: Soft with no host basis is blocked with basis-required until a unit is set, then Run starts and the record says user-supplied', async () => {
  const h = await noHostBasisHarness();
  let vm = h.vm();
  assert.equal(vm.run.canRun, false);
  assert.equal(vm.setup.basis.required, true);
  assert.equal(vm.setup.basis.state, 'unavailable');
  assert.deepEqual(vm.setup.validation.messages.filter((m) => m.control === 'basis').map((m) => m.text), ['Choose the units/basis for this Soft test.']);
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.engine.startCalls.length, 0);                              // blocked: nothing was admitted

  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'cm' });
  vm = h.vm();
  assert.equal(vm.run.canRun, true);
  assert.equal(vm.setup.basis.state, 'user-supplied');
  assert.equal(vm.setup.basis.value, 'cm');
  assert.equal(vm.setup.basis.unitLabel, 'cm');
  assert.equal(vm.setup.basis.status, 'User-supplied: all selected models are in cm. Not verified.');
  assert.match(vm.setup.summary, /Soft \(clearance 0\.05 cm \(user-supplied\)\)/);

  await h.runToDone(softSet());
  assert.equal(h.engine.startCalls.length, 1);
  assert.equal(h.engine.startCalls[0].definition.mode, 'clearance');
  assert.equal(h.engine.startCalls[0].definition.clearance, 0.05);          // the typed number, unconverted
  const line = basisLine(h.vm());
  assert.match(line, /user-supplied/);
  assert.match(line, /"cm"/);
  assert.doesNotMatch(stripNegated(line), /verified/);                      // only ever "not verified"
  assert.doesNotMatch(line, /^verified/);
});

test('raw model units: state raw-model-units, run details say raw and not verified, clearance unchanged', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'raw' });
  const vm = h.vm();
  assert.equal(vm.run.canRun, true);
  assert.equal(vm.setup.basis.state, 'raw-model-units');
  assert.equal(vm.setup.basis.unitLabel, 'model units (raw)');
  assert.equal(vm.setup.basis.status, 'Raw model units. Not verified — no physical unit is implied.');
  assert.match(vm.setup.summary, /model units \(raw, unverified\)/);
  await h.runToDone(softSet());
  assert.equal(h.engine.startCalls[0].definition.clearance, 0.05);
  const line = basisLine(h.vm());
  assert.match(line, /^raw model units, not verified/);
  assert.doesNotMatch(stripNegated(line), /verified/);
});

test('every host verdict other than `verified` never yields state verified, with or without an attestation', async () => {
  const verdicts = [
    { state: 'unverified', reason: 'units differ' }, { state: 'incompatible', reason: 'frames differ' },
    { state: 'unknown', reason: 'no data' }, null, 'verified', { state: 'VERIFIED', basisKey: 'k' }, { basisKey: 'k' },
  ];
  for (const basis of verdicts) {
    const h = makeHarness({ basis });
    await h.readyHard();
    await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
    await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
    const tag = JSON.stringify(basis) ?? 'undefined';
    assert.notEqual(h.vm().setup.basis.state, 'verified', tag);
    assert.equal(h.vm().run.canRun, false, tag);
    for (const value of ['mm', 'raw']) {
      await h.dispatch({ type: INTENT.SETUP_BASIS, value });
      assert.notEqual(h.vm().setup.basis.state, 'verified', `${tag}/${value}`);
    }
    await h.runToDone(softSet());
    assert.doesNotMatch(stripNegated(basisLine(h.vm())), /verified/, tag);
  }
});

test('a genuinely verified host verdict records verified and needs no attestation; a stale attestation does not downgrade it', async () => {
  const h = makeHarness({ basis: { state: 'verified', basisKey: 'shared-frame' } });
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  assert.equal(h.vm().setup.basis.state, 'verified');
  assert.equal(h.vm().setup.basis.required, false);
  assert.equal(h.vm().setup.basis.unitLabel, 'scene units');
  await h.runToDone(softSet());
  assert.equal(basisLine(h.vm()), 'verified (shared-frame)');
});

test('SETUP_BASIS ignores non-string and unknown values', async () => {
  const h = await noHostBasisHarness();
  for (const value of [undefined, null, 5, 'km', 'verified', {}]) {
    await h.dispatch({ type: INTENT.SETUP_BASIS, value });
    assert.equal(h.vm().setup.basis.value, '', String(value));
    assert.equal(h.vm().setup.basis.state, 'unavailable', String(value));
  }
});

test('invalid, zero and negative clearance are still rejected with a basis set (the number is validated independently)', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  for (const bad of ['', 'abc', '0', '-1', '-0.05']) {
    await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: bad });
    const vm = h.vm();
    assert.equal(vm.run.canRun, false, bad);
    assert.equal(vm.setup.validation.state, 'blocked', bad);
    assert.ok(vm.setup.clearance.error !== null, bad);
    assert.equal(vm.setup.basis.error, null, bad);                           // the basis is fine; the number is the problem
    await h.dispatch({ type: INTENT.RUN_START });
    assert.equal(h.engine.startCalls.length, 0, bad);
  }
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  assert.equal(h.vm().run.canRun, true);
});

test('participant change drops the attestation: A+B attested, switch to A+C => basis-required again; switching back needs a fresh attestation', async () => {
  const h = await noHostBasisHarness();
  addModelC(h);
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  assert.equal(h.vm().run.canRun, true);
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });   // B out
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mC' });   // C in
  let vm = h.vm();
  assert.equal(vm.setup.basis.value, '');
  assert.equal(vm.setup.basis.state, 'unavailable');
  assert.equal(vm.run.canRun, false);
  assert.ok(vm.setup.validation.messages.some((m) => m.control === 'basis'));
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mC' });
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });   // back to A+B
  vm = h.vm();
  assert.equal(vm.setup.basis.value, '');                                          // the old attestation is gone for good
  assert.equal(vm.run.canRun, false);
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'raw' });
  assert.equal(h.vm().run.canRun, true);
  await h.dispatch({ type: INTENT.SETUP_SELF_CLASH, value: true });                // participants {A,B} -> {A}: a single model
  assert.equal(h.vm().setup.basis.value, '');
  assert.equal(h.vm().setup.basis.state, 'verified');                              // one model: trivially a common basis
  assert.equal(h.vm().run.canRun, true);
});

test('Hard stays ready regardless of the basis: no basis request, no basis state, not blocked by a missing host basis', async () => {
  for (const basis of [{ state: 'incompatible', reason: 'frames differ' }, { state: 'verified', basisKey: 'b' }, () => new Promise(() => {})]) {
    const h = makeHarness({ basis });
    await h.readyHard();
    const vm = h.vm();
    assert.equal(vm.run.canRun, true);
    assert.equal(vm.run.headline, READY_TEXT);
    assert.equal(vm.setup.basis.required, false);
    assert.equal(vm.setup.basis.state, null);
    assert.equal(vm.setup.clearance.visible, false);
    assert.equal(vm.setup.validation.messages.some((m) => m.control === 'basis'), false);
  }
  const g = await noHostBasisHarness();
  await g.dispatch({ type: INTENT.SETUP_MODE, value: 'hard' });
  assert.equal(g.vm().run.canRun, true);
  await g.runToDone(makeSet({ runId: 'run-1', results: hardResults(2) }));
  assert.equal(g.engine.startCalls[0].definition.mode, 'volume-overlap');
  assert.equal(g.vm().run.details.lines.some((l) => l.label === BASIS_LABEL), false);
});

test('idle headline: "Ready to run" only when Run is enabled, otherwise "Not ready to run"', async () => {
  const h = makeHarness();
  await h.settle();
  assert.equal(h.vm().run.canRun, false);
  assert.equal(h.vm().run.headline, NOT_READY_TEXT);
  assert.equal(NOT_READY_TEXT, 'Not ready to run');
  assert.equal(READY_TEXT, 'Ready to run');
  await h.readyHard();
  assert.equal(h.vm().run.canRun, true);
  assert.equal(h.vm().run.headline, READY_TEXT);
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });                       // clearance empty ⇒ blocked again
  assert.equal(h.vm().run.canRun, false);
  assert.equal(h.vm().run.headline, NOT_READY_TEXT);
});

// ---- New test: exactly what it resets -------------------------------------------------------------------------------
test('New test resets: name, mode, clearance, basis, sets, selfClash, results/displayed, hasRun/setupChanged, setup re-expanded, filters/selection/Viewer state', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Custom name' });
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'ft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.25' });
  await h.runToDone(makeSet({ runId: 'run-1', mode: 'clearance', clearance: 0.25, results: [
    { a: ['mA', 1], b: ['mB', 10], distance: 0.01 }, { a: ['mA', 2], b: ['mB', 11], distance: 0.02 }] }));
  await h.dispatch({ type: INTENT.SETUP_NAME, value: 'Custom name 2' });             // an edit after the run
  await h.dispatch({ type: INTENT.FILTER_TEXT, value: 'A-1' });
  await h.settle(8);
  await h.dispatch({ type: INTENT.NAV_SELECT, resultId: h.vm().results.rows[0].resultId, groupId: null });

  const before = h.vm();
  assert.equal(before.setup.collapsed, true);                                       // collapsed by the run
  assert.equal(before.setup.setupChangedSinceRun, true);
  assert.equal(before.setup.basis.value, 'ft');
  assert.notEqual(before.selected, null);
  assert.equal(before.filters.text, 'A-1');
  assert.equal(before.run.state, 'done');
  assert.equal(h.engine.resident.has('run-1'), true);
  const clearsBefore = h.bridge.calls.filter((c) => c.op === 'clear').length;

  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  const vm = h.vm();
  // setup draft
  assert.equal(vm.setup.name, 'Clash test 2');
  assert.equal(vm.setup.mode, 'hard');
  assert.equal(vm.setup.clearance.value, '');
  assert.equal(vm.setup.basis.value, '');                                          // the basis attestation is reset
  assert.equal(vm.setup.basis.state, null);
  assert.equal(vm.setup.selfClash, false);
  assert.equal(vm.setup.models.every((m) => !m.inA && !m.inB), true);               // both sets emptied
  assert.equal(vm.run.canRun, false);
  assert.equal(vm.run.headline, NOT_READY_TEXT);
  // run / results
  assert.equal(vm.setup.setupChangedSinceRun, false);
  assert.equal(vm.setup.collapsed, false);                                          // setup re-expanded
  assert.equal(vm.run.state, 'idle');
  assert.equal(vm.run.details, null);
  assert.equal(vm.results.state, 'before-run');
  assert.equal(vm.selected, null);                                                  // selected clash dropped
  assert.equal(vm.filters.text, '');                                                // filters back to defaults
  assert.equal(vm.filters.active, false);
  assert.equal(h.engine.resident.size, 0);                                          // result set released
  // Viewer: markers / isolation / selection cleared through the bridge
  assert.equal(h.bridge.calls.filter((c) => c.op === 'clear').length, clearsBefore + 1);
  // a new run after New test starts from a clean record: Hard, and no basis line from the previous Soft run
  await h.readyHard();
  await h.runToDone(makeSet({ runId: 'run-2', results: hardResults(2) }));
  assert.equal(h.engine.startCalls.at(-1).definition.mode, 'volume-overlap');
  assert.equal(h.vm().run.details.lines.some((l) => l.label === BASIS_LABEL), false);
});

test('New test does not reuse an attestation: re-selecting the same models and Soft after New test asks for the basis again', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  assert.equal(h.vm().run.canRun, true);
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  assert.equal(h.vm().setup.basis.value, '');
  assert.equal(h.vm().setup.basis.required, true);
  assert.equal(h.vm().run.canRun, false);
});

test('New test is a no-op while a run is active, and vm.setup.newTest.enabled is false exactly then', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  assert.equal(h.vm().setup.newTest.enabled, true);
  const handle = await h.start();
  assert.notEqual(h.vm().run.state, 'idle');
  assert.equal(h.vm().setup.newTest.enabled, false);
  const during = h.vm();
  const clearsBefore = h.bridge.calls.filter((c) => c.op === 'clear').length;
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm(), during);                                                    // nothing changed at all (same ViewModel object)
  assert.equal(h.vm().setup.name, 'Clash test 1');
  assert.equal(h.vm().setup.basis.value, 'mm');
  assert.equal(h.vm().setup.mode, 'soft');
  assert.equal(h.bridge.calls.filter((c) => c.op === 'clear').length, clearsBefore);
  assert.notEqual(h.vm().run.state, 'idle');                                       // the live run was not touched
  handle.emitState({ status: 'planning', phase: 'enumerating' });
  handle.finish({ status: 'completed', resultSet: softSet() });
  await h.settle();
  assert.equal(h.vm().setup.newTest.enabled, true);                                // enabled again once the run is terminal
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.equal(h.vm().setup.name, 'Clash test 2');
  assert.equal(h.vm().setup.basis.value, '');
});

test('New test with unsaved results asks for confirmation first and resets nothing until confirmed', async () => {
  const h = await noHostBasisHarness();
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  await h.runToDone(softSet(), { persistence: { state: 'pending', timedOut: true, attempt: 1 } });
  await h.dispatch({ type: INTENT.SETUP_NEW_TEST });
  assert.ok(h.vm().run.banners.some((b) => b.id === 'confirm-discard-unsaved'));
  assert.equal(h.vm().setup.name, 'Clash test 1');
  assert.equal(h.vm().setup.basis.value, 'mm');
  await h.dispatch({ type: INTENT.RESULTS_CLEAR_CONFIRMED });
  assert.equal(h.vm().setup.name, 'Clash test 2');
  assert.equal(h.vm().setup.basis.value, '');
  assert.equal(h.vm().results.state, 'before-run');
});

// ---- controlled-promise races: the host basis verdict is a promise the test resolves by hand ---------------------------
/** Every host measurementBasis(keys) call returns its own pending promise; the test settles it explicitly. */
function controlledBasisHarness() {
  const h = makeHarness();
  const pending = [];
  h.catalog.setBasis((keys) => new Promise((resolve) => { pending.push({ keys: keys.join(','), resolve }); }));
  const settleKeys = async (keys, verdict) => {
    const hits = pending.filter((p) => p.keys === keys);
    assert.ok(hits.length > 0, `no pending host call for ${keys}`);
    for (const p of hits) p.resolve(verdict);
    await h.settle();
  };
  return { h, pending, settleKeys };
}

test('race: a stale verified verdict for A+B resolving after the set changed to A+C never makes A+C Soft verified or ready', async () => {
  const { h, settleKeys } = controlledBasisHarness();
  addModelC(h);
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mB' });   // B out
  await h.dispatch({ type: INTENT.SETUP_TOGGLE_MODEL, side: 'B', modelKey: 'mC' });   // C in: A+C evaluation is pending
  assert.equal(h.vm().run.canRun, false);
  await settleKeys('mA,mB', { state: 'verified', basisKey: 'old-ab' });               // the OLD verdict arrives late
  let vm = h.vm();
  assert.equal(vm.run.canRun, false);
  assert.notEqual(vm.setup.basis.state, 'verified');
  assert.equal(vm.setup.softChecking, true);   // still waiting for A+C
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.engine.startCalls.length, 0);
  await settleKeys('mA,mC', { state: 'unverified', reason: 'frames differ' });        // the CURRENT verdict decides
  vm = h.vm();
  assert.notEqual(vm.setup.basis.state, 'verified');
  assert.equal(vm.run.canRun, false);
  assert.equal(vm.setup.basis.required, true);
});

test('race: unverified -> verified after the user attested records verified only from the host verdict; verified -> unverified makes basis-required again', async () => {
  const { h, settleKeys } = controlledBasisHarness();
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await settleKeys('mA,mB', { state: 'unverified', reason: 'units differ' });
  assert.equal(h.vm().setup.basis.required, true);
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'mm' });
  assert.equal(h.vm().setup.basis.state, 'user-supplied');                            // attested, never verified
  assert.equal(h.vm().run.canRun, true);

  h.catalog.fire();                                                                   // host re-evaluates: now verified
  await h.settle();
  await settleKeys('mA,mB', { state: 'verified', basisKey: 'shared' });
  let vm = h.vm();
  assert.equal(vm.setup.basis.state, 'verified');
  assert.equal(vm.setup.basis.required, false);
  assert.equal(vm.run.canRun, true);                                                  // ready without needing the attestation
  await h.runToDone(softSet());
  assert.equal(basisLine(h.vm()), 'verified (shared)');

  // reverse: verified, no attestation -> host turns unverified => basis-required again
  const r = controlledBasisHarness();
  await r.h.readyHard();
  await r.h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await r.h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await r.settleKeys('mA,mB', { state: 'verified', basisKey: 'shared' });
  assert.equal(r.h.vm().run.canRun, true);
  assert.equal(r.h.vm().setup.basis.value, '');
  r.h.catalog.fire();
  await r.h.settle();
  await r.settleKeys('mA,mB', { state: 'unverified', reason: 'changed' });
  vm = r.h.vm();
  assert.equal(vm.setup.basis.state, 'unavailable');
  assert.equal(vm.setup.basis.required, true);
  assert.equal(vm.run.canRun, false);
  assert.ok(vm.setup.validation.messages.some((m) => m.control === 'basis'));
});

test('race: a catalog-change re-evaluation keeps an existing attestation; while pending Run is blocked (soft-checking), once unverified settles the attestation applies', async () => {
  const { h, settleKeys } = controlledBasisHarness();
  await h.readyHard();
  await h.dispatch({ type: INTENT.SETUP_MODE, value: 'soft' });
  await h.dispatch({ type: INTENT.SETUP_CLEARANCE, value: '0.05' });
  await settleKeys('mA,mB', { state: 'unverified', reason: 'units differ' });
  await h.dispatch({ type: INTENT.SETUP_BASIS, value: 'cm' });
  assert.equal(h.vm().run.canRun, true);

  h.catalog.fire();                                                                   // re-evaluation starts and stays pending
  await h.settle();
  let vm = h.vm();
  assert.equal(vm.setup.basis.required, false);
  assert.equal(vm.setup.softChecking, true);
  assert.equal(vm.run.canRun, false);
  assert.ok(vm.setup.validation.messages.some((m) => m.code === 'soft-checking' || /Checking/.test(m.text)));
  await h.dispatch({ type: INTENT.RUN_START });
  assert.equal(h.engine.startCalls.length, 0);

  await settleKeys('mA,mB', { state: 'unverified', reason: 'still differ' });
  vm = h.vm();
  assert.equal(vm.setup.softChecking, false);
  assert.equal(vm.setup.basis.value, 'cm');                                           // attestation survived the re-check
  assert.equal(vm.setup.basis.state, 'user-supplied');
  assert.equal(vm.run.canRun, true);
  await h.runToDone(softSet());
  assert.equal(h.engine.startCalls.length, 1);
});
