// test/clashpanel/core/softAvailability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSoftAvailability } from '../../../clashpanel/core/softAvailability.js';
import { BASIS_FAILURE_REASONS, narrowEnginePort } from '../../../clashpanel/core/ports.js';
import { BASIS_VERDICT_TIMEOUT_MS, SOFT_UNAVAILABLE_TEXT } from '../../../clashpanel/core/constants.js';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { validateSetup } from '../../../clashpanel/core/setupValidation.js';
import { validateTest } from '../../../clashtest/index.js';
import { createFakeCatalog, createFakeEngine, createFakeScheduler } from '../support/index.mjs';

const evaluate = (participants, catalog, extra = {}) => evaluateSoftAvailability({ participants, catalog, scheduler: createFakeScheduler(), ...extra });
// defineProperties (not assign) so a getter in `extra` is installed, not invoked while copying
const catalogOf = (basis, extra = {}) => Object.defineProperties(createFakeCatalog({ models: [], basis }), Object.getOwnPropertyDescriptors(extra));
const reduce = (draft, ...actions) => actions.reduce(draftReduce, draft);

test('|P| = 0: not available, no explanation, no verdict, and the catalog is never consulted', async () => {
  const catalog = catalogOf({ state: 'verified', basisKey: 'k' });
  const r = await evaluate([], catalog);
  assert.deepEqual(r, { available: false, verdict: null, explanation: null });
  assert.equal(catalog.calls.measurementBasis.length, 0);
  assert.ok(Object.isFrozen(r));
  assert.deepEqual(Object.keys(r), ['available', 'verdict', 'explanation']);
});

test('|P| = 1 (also after de-duplication): available with NO catalog call, even for a catalog that would refuse or throw', async () => {
  for (const catalog of [catalogOf({ state: 'incompatible', reason: 'x' }), { measurementBasis() { throw new Error('must not be called'); } }, null, undefined]) {
    assert.deepEqual(await evaluate(['mA'], catalog), { available: true, verdict: null, explanation: null });
    assert.deepEqual(await evaluate(['mA', 'mA', 'mA'], catalog), { available: true, verdict: null, explanation: null });
  }
});

test('|P| >= 2 with a verified verdict: available; the host receives the sorted, de-duplicated keys; no explanation', async () => {
  const catalog = catalogOf({ state: 'verified', basisKey: 'basis-7' });
  const r = await evaluate(['mB', 'mA', 'mB', 'mC'], catalog);
  assert.deepEqual(r, { available: true, verdict: { state: 'verified', basisKey: 'basis-7' }, explanation: null });
  assert.deepEqual(catalog.calls.measurementBasis, [['mA', 'mB', 'mC']]);
});

test('unverified and incompatible are unavailable; the explanation is the fixed sentence + the host reason as PLAIN text, never rewritten or escaped', async () => {
  const hostile = '<img src=x onerror=alert(1)> units differ';
  for (const state of ['unverified', 'incompatible']) {
    const r = await evaluate(['mA', 'mB'], catalogOf({ state, reason: hostile }));
    assert.equal(r.available, false);
    assert.deepEqual(r.verdict, { state, reason: hostile });
    assert.equal(r.explanation, `${SOFT_UNAVAILABLE_TEXT} ${hostile}`);
    assert.equal(typeof r.explanation, 'string');
  }
});

test('the fixed explanation never implies an approximate or caveated result', async () => {
  const r = await evaluate(['mA', 'mB'], catalogOf({ state: 'unverified', reason: 'Not evidenced.' }));
  assert.match(r.explanation, /^Soft \(clearance\) isn't available for these models: they don't share a verified common measurement basis\./);
  assert.doesNotMatch(SOFT_UNAVAILABLE_TEXT, /approx|estimate|caveat|roughly|about/i);
});

test('every fail-closed host behavior makes Soft unavailable with its own distinct fixed reason', async () => {
  const cases = {
    missing: createFakeCatalog({ omitMeasurementBasis: true }),
    threw: catalogOf(() => { throw new Error('boom'); }),
    rejected: catalogOf(() => Promise.reject(new Error('boom'))),
    malformed: catalogOf({ state: 'verified' }),
  };
  const seen = new Set();
  for (const [kind, catalog] of Object.entries(cases)) {
    const r = await evaluate(['mA', 'mB'], catalog);
    assert.equal(r.available, false, kind);
    assert.deepEqual(r.verdict, { state: 'unverified', reason: BASIS_FAILURE_REASONS[kind] }, kind);
    assert.equal(r.explanation, `${SOFT_UNAVAILABLE_TEXT} ${BASIS_FAILURE_REASONS[kind]}`, kind);
    seen.add(r.explanation);
  }
  assert.equal(seen.size, 4);
});

test('a verdict that never arrives times out through the injected scheduler (default delay, then a custom one) and Soft stays unavailable', async () => {
  const sched = createFakeScheduler();
  const catalog = catalogOf(() => new Promise(() => {}));
  const p = evaluateSoftAvailability({ participants: ['mA', 'mB'], catalog, scheduler: sched });
  await sched.advance(BASIS_VERDICT_TIMEOUT_MS - 1);
  assert.equal(sched.pendingTimers(), 1);
  await sched.advance(1);
  const r = await p;
  assert.deepEqual(sched.delays, [BASIS_VERDICT_TIMEOUT_MS]);
  assert.equal(r.available, false);
  assert.equal(r.explanation, `${SOFT_UNAVAILABLE_TEXT} ${BASIS_FAILURE_REASONS.timeout}`);
  assert.equal(sched.pendingTimers(), 0);
  const custom = createFakeScheduler();
  const q = evaluateSoftAvailability({ participants: ['mA', 'mB'], catalog, scheduler: custom, timeoutMs: 40 });
  await custom.advance(40);
  assert.equal((await q).available, false);
  assert.deepEqual(custom.delays, [40]);
});

test('a verdict that arrives in time wins and leaves no pending timer', async () => {
  const sched = createFakeScheduler();
  const r = await evaluateSoftAvailability({ participants: ['mA', 'mB'], catalog: catalogOf(async () => ({ state: 'verified', basisKey: 'k' })), scheduler: sched });
  assert.equal(r.available, true);
  assert.equal(sched.pendingTimers(), 0);
});

test('NEGATIVE CONTROL: display-unit information the catalog offers is ignored in both directions', async () => {
  const calls = { unitLabel: 0, getUnitScale: 0 };
  const unitful = (basis) => catalogOf(basis, {
    get unitLabel() { calls.unitLabel += 1; return 'mm'; },
    getUnitScale(key) { calls.getUnitScale += 1; return key === 'mA' ? 1 : 0.001; },
  });
  const verified = await evaluate(['mA', 'mB'], unitful({ state: 'verified', basisKey: 'k' }));
  assert.equal(verified.available, true);
  const sameUnitsButUnverified = await evaluate(['mA', 'mB'], Object.assign(unitful({ state: 'unverified', reason: 'No shared frame evidence.' }), { getUnitScale: () => 1 }));
  assert.equal(sameUnitsButUnverified.available, false);
  assert.deepEqual(calls, { unitLabel: 0, getUnitScale: 0 });
});

test('programmer errors reject with TypeError (participants must be an array of strings); the scheduler is needed only when the catalog is consulted', async () => {
  await assert.rejects(evaluateSoftAvailability({ participants: 'mA', catalog: null, scheduler: createFakeScheduler() }), TypeError);
  await assert.rejects(evaluateSoftAvailability({ participants: ['mA', 7], catalog: null, scheduler: createFakeScheduler() }), TypeError);
  await assert.rejects(evaluateSoftAvailability({ participants: ['mA', 'mB'], catalog: catalogOf({ state: 'verified', basisKey: 'k' }) }), TypeError);
  assert.equal((await evaluateSoftAvailability({ participants: ['mA'], catalog: null })).available, true);
});

test('AC-P18 end to end: unavailable Soft blocks a Soft draft with the explanation, keeps Hard ready, and one participating model makes Soft available again', async () => {
  const catalog = createFakeCatalog({
    models: [{ modelKey: 'mA', displayName: 'Arch' }, { modelKey: 'mB', displayName: 'Struct' }],
    basis: { state: 'incompatible', reason: 'Model units differ.' },
  });
  const fake = createFakeEngine({ bindings: [{ modelKey: 'mA', model: catalog.modelOf('mA') }, { modelKey: 'mB', model: catalog.modelOf('mB') }] });
  fake.setValidate(validateTest);
  const engine = narrowEnginePort(fake);
  const base = createDraft({ testId: 'T-1' });
  const twoModels = reduce(base, { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
  const participants = ['mA', 'mB'];
  const softAvailability = await evaluate(participants, catalog);
  assert.equal(softAvailability.available, false);
  const soft = reduce(twoModels, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.05' });
  const blocked = validateSetup({ draft: soft, engine, catalog, softAvailability });
  assert.equal(blocked.state, 'blocked');
  assert.deepEqual(blocked.findings, [{ control: 'mode', code: 'soft-unavailable', text: `${SOFT_UNAVAILABLE_TEXT} Model units differ.` }]);
  assert.equal(blocked.definition, null);
  const hard = validateSetup({ draft: twoModels, engine, catalog, softAvailability });
  assert.equal(hard.state, 'ready');
  const single = reduce(base, { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'selfClash', value: true }, { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.05' });
  const calls = catalog.calls.measurementBasis.length;
  const oneModel = await evaluate(['mA'], catalog);
  assert.equal(catalog.calls.measurementBasis.length, calls);
  const ok = validateSetup({ draft: single, engine, catalog, softAvailability: oneModel });
  assert.equal(ok.state, 'ready');
  assert.equal(ok.definition.mode, 'clearance');
});
