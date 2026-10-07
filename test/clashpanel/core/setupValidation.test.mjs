// test/clashpanel/core/setupValidation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlForIssuePath, participatingModelKeys, validateSetup } from '../../../clashpanel/core/setupValidation.js';
import { buildDefinition, createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { narrowEnginePort } from '../../../clashpanel/core/ports.js';
import { SOFT_UNAVAILABLE_TEXT } from '../../../clashpanel/core/constants.js';
import { validateTest } from '../../../clashtest/index.js';
import { createFakeCatalog, createFakeEngine } from '../support/index.mjs';

const reduce = (draft, ...actions) => actions.reduce(draftReduce, draft);
const toggle = (side, modelKey) => ({ type: 'toggleModel', side, modelKey });
const hardDraft = () => reduce(createDraft({ testId: 'T-1' }), toggle('A', 'mA'), toggle('B', 'mB'));
const softDraft = (clearance = '0.05') => reduce(hardDraft(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: clearance });
const AVAILABLE = { available: true, explanation: null };

function world({ registered = ['mA', 'mB'], loaded = { mA: true, mB: true }, listed = ['mA', 'mB'], validate = validateTest } = {}) {
  const catalog = createFakeCatalog({ models: listed.map((modelKey) => ({ modelKey, displayName: `Name ${modelKey}`, loaded: loaded[modelKey] ?? true })) });
  const fake = createFakeEngine();
  // a registered model is bound to the SAME Model object the catalog holds (identity is what "not stale" means)
  for (const modelKey of registered) fake.setBinding({ modelKey, ...(catalog.modelOf(modelKey) ? { model: catalog.modelOf(modelKey) } : {}) });
  fake.setValidate(validate);
  return { fake, engine: narrowEnginePort(fake), catalog };
}
const run = (draft, w = world(), softAvailability = AVAILABLE) => validateSetup({ draft, engine: w.engine, catalog: w.catalog, softAvailability });
const flat = (v) => v.findings.map((f) => [f.control, f.code]);

// ---- controlForIssuePath -------------------------------------------------------------------------------------------
test('controlForIssuePath: maps the documented paths and treats every other path as general (segment-exact, not prefix-loose)', () => {
  const table = {
    '/clearance': 'clearance', '/name': 'name', '/mode': 'mode', '/selectionA': 'setA', '/selectionA/entries': 'setA',
    '/selectionA/entries/0/dbIds/2': 'setA', '/selectionB/entries/1/modelKey': 'setB', '/selectionB': 'setB',
    '/testId': 'general', '/revision': 'general', '/schemaVersion': 'general', '/description': 'general', '/foo': 'general',
    '/selectionAB': 'general', '/selectionC/entries': 'general', '/': 'general', '': 'general', '/clearanceX': 'general',
  };
  for (const [path, control] of Object.entries(table)) assert.deepEqual(controlForIssuePath(path), { control }, path);
  for (const bad of [undefined, null, 5, {}]) assert.deepEqual(controlForIssuePath(bad), { control: 'general' });
});

test('controlForIssuePath: every issue the REAL validateTest can report for a mutated definition lands on the expected control', () => {
  const good = buildDefinition(softDraft(), { verifiedBasis: true }).definition;
  const model = (modelKey) => ({ kind: 'model', modelKey });
  const cases = [
    ['name empty', { ...good, name: '' }, 'name'],
    ['name too long', { ...good, name: 'x'.repeat(300) }, 'name'],
    ['mode bogus', { ...good, mode: 'bogus' }, 'mode'],
    ['clearance forbidden', { ...good, mode: 'volume-overlap' }, 'clearance'],
    ['clearance required', (() => { const { clearance, ...rest } = good; void clearance; return rest; })(), 'clearance'],
    ['clearance not a number', { ...good, clearance: 'x' }, 'clearance'],
    ['clearance not positive', { ...good, clearance: -1 }, 'clearance'],
    ['A entries empty', { ...good, selectionA: { entries: [] } }, 'setA'],
    ['A entry kind', { ...good, selectionA: { entries: [{ kind: 'nope', modelKey: 'a' }] } }, 'setA'],
    ['A dbId fraction', { ...good, selectionA: { entries: [{ kind: 'elements', modelKey: 'a', dbIds: [1.5] }] } }, 'setA'],
    ['A dbId negative', { ...good, selectionA: { entries: [{ kind: 'elements', modelKey: 'a', dbIds: [-1] }] } }, 'setA'],
    ['B modelKey empty', { ...good, selectionB: { entries: [model('')] } }, 'setB'],
    ['B unknown key', { ...good, selectionB: { entries: [{ kind: 'model', modelKey: 'b', extra: 1 }] } }, 'setB'],
    ['B missing', (() => { const { selectionB, ...rest } = good; void selectionB; return rest; })(), 'setB'],
    ['unknown property', { ...good, foo: 1 }, 'general'],
    ['testId empty', { ...good, testId: '' }, 'general'],
    ['revision zero', { ...good, revision: 0 }, 'general'],
    ['schemaVersion 1.5', { ...good, schemaVersion: 1.5 }, 'general'],
  ];
  for (const [label, def, control] of cases) {
    const { issues } = validateTest(def);
    assert.ok(issues.length > 0, `${label}: expected Core to reject`);
    for (const issue of issues) assert.equal(controlForIssuePath(issue.path).control, control, `${label}: ${issue.path} ${issue.code}`);
  }
});

// ---- participatingModelKeys ------------------------------------------------------------------------------------------
test('participatingModelKeys: sorted union of both sides (element entries count); Set A only for a self-clash', () => {
  const d = reduce(createDraft({ testId: 'T' }), toggle('A', 'mB'), toggle('B', 'mB'), toggle('B', 'mA'),
    { type: 'setElements', side: 'A', elements: { mZ: [1] } }, { type: 'setElements', side: 'B', elements: { mC: [] } });
  assert.deepEqual(participatingModelKeys(d), ['mA', 'mB', 'mZ']);
  assert.deepEqual(participatingModelKeys(draftReduce(d, { type: 'selfClash', value: true })), ['mB', 'mZ']);
  assert.deepEqual(participatingModelKeys(createDraft({ testId: 'T' })), []);
});

// ---- validateSetup: the happy path and the Panel's own problems ---------------------------------------------------------
test('validateSetup: a valid, registered, loaded Hard setup is ready and carries the built (frozen) definition', () => {
  const v = run(hardDraft());
  assert.deepEqual(v, { state: 'ready', findings: [], issuesTruncated: false, definition: buildDefinition(hardDraft()).definition });
  assert.ok(Object.isFrozen(v.definition));
});

test('validateSetup: Panel problems come first, block, and skip the Core call when no definition can be built', () => {
  const w = world();
  const v = run(reduce(createDraft({ testId: 'T' }), { type: 'name', value: ' ' }, { type: 'mode', value: 'soft' }), w);
  assert.deepEqual(flat(v), [['name', 'name-required'], ['clearance', 'clearance-required'], ['setA', 'selection-empty'], ['setB', 'selection-empty']]);
  assert.equal(v.state, 'blocked');
  assert.equal(v.definition, null);
  assert.equal(w.fake.calls.validateTest.length, 0);
});

// ---- Core issues -------------------------------------------------------------------------------------------------------
test('validateSetup: Core issues are mapped to controls, carry the Core message as text after a control prefix, and keep issuesTruncated', () => {
  const w = world({ validate: () => ({
    issues: [
      { path: '/selectionA/entries/0/dbIds', code: 'too-many-elements', message: 'over maxExplicitElementsPerSelection' },
      { path: '/selectionB/entries/2/modelKey', code: 'string-too-short', message: 'below the minimum length' },
      { path: '/clearance', code: 'not-positive', message: 'clearance must be greater than zero' },
      { path: '/name', code: 'string-too-long', message: 'above the maximum length' },
      { path: '/mode', code: 'invalid-enum', message: 'mode must be one of the four library modes' },
      { path: '/testId', code: 'string-too-short', message: 'below the minimum length' },
    ],
    issuesTruncated: true,
  }) });
  const v = run(hardDraft(), w);
  assert.equal(v.state, 'blocked');
  assert.equal(v.issuesTruncated, true);
  assert.equal(v.definition, null);
  assert.deepEqual(v.findings, [
    { control: 'setA', code: 'too-many-elements', text: 'Set A: over maxExplicitElementsPerSelection' },
    { control: 'setB', code: 'string-too-short', text: 'Set B: below the minimum length' },
    { control: 'clearance', code: 'not-positive', text: 'Clearance: clearance must be greater than zero' },
    { control: 'name', code: 'string-too-long', text: 'Test name: above the maximum length' },
    { control: 'mode', code: 'invalid-enum', text: 'Mode: mode must be one of the four library modes' },
    { control: 'general', code: 'string-too-short', text: 'Test definition: below the minimum length' },
  ]);
});

test('validateSetup: a hostile Core message stays inert TEXT (no escaping, no interpretation, no markup semantics)', () => {
  const hostile = '<img src=x onerror=alert(1)> {{x}} ${y} ‮';
  const v = run(hardDraft(), world({ validate: () => ({ issues: [{ path: '/name', code: 'not-a-string', message: hostile }], issuesTruncated: false }) }));
  assert.equal(v.findings[0].text, `Test name: ${hostile}`);
  assert.equal(typeof v.findings[0].text, 'string');
});

test('validateSetup: malformed issue entries are tolerated (non-string path -> general, missing message -> fixed phrase); junk results fail closed', () => {
  const odd = run(hardDraft(), world({ validate: () => ({ issues: [{ path: 5, code: 'x', message: 7 }, { code: 'y' }, null], issuesTruncated: 0 }) }));
  assert.deepEqual(odd.findings.map((f) => [f.control, f.code]), [['general', 'x'], ['general', 'y'], ['general', 'unknown']]);
  assert.ok(odd.findings.every((f) => f.text === 'Test definition is not valid.'));
  assert.equal(odd.issuesTruncated, false);
  for (const validate of [() => { throw new Error('engine disposed'); }, () => null, () => ({}), () => ({ issues: 'nope' })]) {
    const v = run(hardDraft(), world({ validate }));
    assert.deepEqual(flat(v), [['general', 'validation-unavailable']]);
    assert.equal(v.state, 'blocked');
  }
});

test('validateSetup: a self-clash folds Set B issues into Set A and de-duplicates the identical message', () => {
  const draft = reduce(hardDraft(), { type: 'selfClash', value: true });
  const w = world({ validate: () => ({
    issues: [
      { path: '/selectionA/entries/0/dbIds', code: 'too-many-elements', message: 'over the maximum' },
      { path: '/selectionB/entries/0/dbIds', code: 'too-many-elements', message: 'over the maximum' },
    ],
    issuesTruncated: false,
  }) });
  assert.deepEqual(flat(run(draft, w)), [['setA', 'too-many-elements']]);
  assert.deepEqual(flat(run(hardDraft(), w)), [['setA', 'too-many-elements'], ['setB', 'too-many-elements']]);
});

// ---- advisory pre-checks ----------------------------------------------------------------------------------------------------
test('pre-checks: a model absent from the catalog, or with no binding, is "not registered"; a not-loaded model is "still loading"', () => {
  const absent = run(hardDraft(), world({ listed: ['mA'] }));
  assert.deepEqual(absent.findings, [{ control: 'setB', code: 'model-not-registered', text: 'Model mB is not registered.' }]);
  const unbound = run(hardDraft(), world({ registered: ['mA'] }));
  assert.deepEqual(unbound.findings, [{ control: 'setB', code: 'model-not-registered', text: 'Model Name mB is not registered.' }]);
  const loading = run(hardDraft(), world({ loaded: { mA: false, mB: true } }));
  assert.deepEqual(loading.findings, [{ control: 'setA', code: 'model-loading', text: 'Model Name mA is still loading.' }]);
  assert.equal(loading.state, 'blocked');
  assert.equal(loading.definition, null);
});

test('pre-checks: a STALE binding blocks Run in both directions (catalog has the new Model / registry the old one, and vice versa); the Panel never repairs it', () => {
  const w = world();
  const fresh = w.catalog.addModel({ modelKey: 'mB', displayName: 'Name mB' });     // reload: same key, new Model object
  assert.notEqual(fresh, w.engine.registry.bindingFor('mB').model);
  const catalogNew = run(hardDraft(), w);
  assert.deepEqual(catalogNew.findings, [{ control: 'setB', code: 'binding-stale', text: 'Model Name mB was reloaded and is not registered yet.' }]);
  assert.equal(catalogNew.state, 'blocked');
  assert.equal(catalogNew.definition, null);
  const w2 = world();
  w2.fake.setBinding({ modelKey: 'mA', model: { fakeModel: 'reregistered-first' }, bindingGeneration: 2 });   // registry newer than catalog
  assert.deepEqual(flat(run(hardDraft(), w2)), [['setA', 'binding-stale']]);
  assert.deepEqual(w2.fake.forbiddenAccess, []);
});

test('pre-checks: once the catalog fires a change and the registry catches up (same Model object) the setup is ready again; identical objects were never stale', () => {
  const w = world();
  assert.equal(run(hardDraft(), w).state, 'ready');
  const fresh = w.catalog.addModel({ modelKey: 'mB', displayName: 'Name mB' });
  w.catalog.fire();
  assert.equal(run(hardDraft(), w).state, 'blocked');
  w.fake.setBinding({ modelKey: 'mB', model: fresh, bindingGeneration: 2 });
  w.catalog.fire();
  const v = run(hardDraft(), w);
  assert.equal(v.state, 'ready');
  assert.deepEqual(v.findings, []);
});

test('pre-checks: a stale binding is reported instead of (never together with) "still loading"; a self-clash checks only Set A models for staleness', () => {
  const w = world({ loaded: { mA: true, mB: false } });
  w.catalog.addModel({ modelKey: 'mB', displayName: 'Name mB', loaded: false });
  assert.deepEqual(flat(run(hardDraft(), w)), [['setB', 'binding-stale']]);
  const selfClash = reduce(hardDraft(), { type: 'selfClash', value: true });
  assert.equal(run(selfClash, w).state, 'ready');
});

test('pre-checks: one finding per model (registration wins over loading), in sorted key order, on the side that references it', () => {
  const draft = reduce(createDraft({ testId: 'T' }), toggle('A', 'mB'), toggle('A', 'mA'), toggle('B', 'mC'), toggle('B', 'mB'));
  const w = world({ registered: ['mA'], listed: ['mA', 'mB', 'mC'], loaded: { mA: false, mB: false, mC: true } });
  assert.deepEqual(run(draft, w).findings.map((f) => [f.control, f.code, f.text]), [
    ['setA', 'model-loading', 'Model Name mA is still loading.'],
    ['setA', 'model-not-registered', 'Model Name mB is not registered.'],
    ['setB', 'model-not-registered', 'Model Name mC is not registered.'],
  ]);
});

test('pre-checks: a self-clash checks only Set A models; Set B leftovers are never reported', () => {
  const draft = reduce(hardDraft(), { type: 'selfClash', value: true });
  const w = world({ registered: ['mA'], listed: ['mA'] });
  assert.equal(run(draft, w).state, 'ready');
});

test('pre-checks: an element-only selection still requires its model to be registered and loaded', () => {
  const draft = reduce(createDraft({ testId: 'T' }), { type: 'setElements', side: 'A', elements: { mA: [1, 2] } }, toggle('B', 'mB'));
  assert.equal(run(draft).state, 'ready');
  assert.deepEqual(flat(run(draft, world({ registered: ['mB'] }))), [['setA', 'model-not-registered']]);
});

test('pre-checks: host failures fail CLOSED (catalog.list() throws -> every model unregistered; displayNameFor throws -> the key is shown; bindingFor throws -> unregistered)', () => {
  const w = world();
  w.catalog.list = () => { throw new Error('catalog down'); };
  assert.deepEqual(flat(run(hardDraft(), w)), [['setA', 'model-not-registered'], ['setB', 'model-not-registered']]);
  const w2 = world();
  w2.catalog.displayNameFor = () => { throw new Error('names down'); };
  w2.catalog.setLoaded('mA', false);
  assert.equal(run(hardDraft(), w2).findings[0].text, 'Model mA is still loading.');
  const w3 = world();
  w3.engine = { ...w3.engine, registry: { bindingFor: () => { throw new Error('registry down'); } } };
  assert.equal(run(hardDraft(), w3).state, 'blocked');
  w3.catalog.list = () => 'not an array';
  assert.equal(run(hardDraft(), w3).findings.length, 2);
});

test('AC-P20: registration is READ-ONLY: only validateTest and registry.bindingFor are touched, and measurementBasis is never called', () => {
  const touched = [];
  const spy = (target, prefix) => new Proxy(target, {
    get(t, prop, receiver) { touched.push(`${prefix}${String(prop)}`); return Reflect.get(t, prop, receiver); },
  });
  const w = world();
  const engine = spy({ validateTest: w.engine.validateTest, registry: spy({ bindingFor: w.engine.registry.bindingFor }, 'registry.') }, '');
  const v = validateSetup({ draft: softDraft(), engine, catalog: w.catalog, softAvailability: AVAILABLE });
  assert.equal(v.state, 'ready');
  assert.deepEqual(new Set(touched), new Set(['validateTest', 'registry', 'registry.bindingFor']));
  assert.deepEqual(w.catalog.calls.measurementBasis, []);
  assert.deepEqual(w.fake.forbiddenAccess, []);
  assert.deepEqual(w.fake.calls.bindingFor, ['mA', 'mB']);
});

// ---- Soft availability (AC-P18, validateSetup level) ---------------------------------------------------------------------------
test('AC-P18 (owner decision 2026-10-07): Soft with an unverified basis is blocked ONLY by basis-required (no soft-unavailable); an attested basis makes it ready; Hard stays ready', () => {
  const unavailable = { available: false, explanation: `${SOFT_UNAVAILABLE_TEXT} They use different units.` };
  const soft = run(softDraft(), world(), unavailable);
  assert.deepEqual(soft.findings, [{ control: 'basis', code: 'basis-required', text: 'Choose the units/basis for this Soft test.' }]);
  assert.equal(soft.state, 'blocked');
  assert.equal(soft.definition, null);
  for (const choice of ['mm', 'cm', 'm', 'in', 'ft', 'raw']) {
    const attested = run(reduce(softDraft(), { type: 'basisUnit', value: choice }), world(), unavailable);
    assert.equal(attested.state, 'ready', choice);
    assert.equal(attested.definition.mode, 'clearance');
    assert.equal(attested.definition.clearance, 0.05);                       // never converted
  }
  const hard = run(hardDraft(), world(), unavailable);
  assert.equal(hard.state, 'ready');
  assert.equal(hard.definition.mode, 'volume-overlap');
});

test('AC-P18: a verified basis needs no attestation; a pending evaluation still blocks as "checking" (an attestation does not bypass it); a missing result needs a basis (fail closed)', () => {
  assert.equal(run(softDraft(), world(), { available: false, explanation: null }).findings[0].text, 'Choose the units/basis for this Soft test.');
  const pendingBlocked = run(softDraft(), world(), { available: false, explanation: null, pending: true });
  assert.equal(pendingBlocked.state, 'blocked');
  assert.ok(flat(pendingBlocked).some(([c, k]) => c === 'mode' && k === 'soft-checking'));
  const pendingAttested = run(reduce(softDraft(), { type: 'basisUnit', value: 'mm' }), world(), { available: true, pending: true });
  assert.equal(pendingAttested.state, 'blocked');                           // available:true with pending:true is not verified
  assert.deepEqual(flat(pendingAttested), [['mode', 'soft-checking']]);
  assert.equal(pendingAttested.definition, null);
  assert.deepEqual(flat(run(softDraft(), world(), null)), [['basis', 'basis-required']]);
  assert.equal(run(reduce(softDraft(), { type: 'basisUnit', value: 'raw' }), world(), null).state, 'ready');
  const ok = run(softDraft(), world(), AVAILABLE);
  assert.equal(ok.state, 'ready');
  assert.equal(ok.definition.mode, 'clearance');
  assert.equal(ok.definition.clearance, 0.05);
});

test('AC-P18: with no participating model the Soft/basis findings are suppressed (the empty selections already block); Hard never consults softAvailability', () => {
  const empty = reduce(createDraft({ testId: 'T' }), { type: 'mode', value: 'soft' }, { type: 'clearance', value: '1' });
  assert.deepEqual(flat(run(empty, world(), { available: false, explanation: null })), [['basis', 'basis-required'], ['setA', 'selection-empty'], ['setB', 'selection-empty']]);
  assert.deepEqual(flat(run(empty, world(), { available: false, explanation: null, pending: true })).filter(([, k]) => k === 'soft-checking'), []);
  let read = 0;
  const trap = { get available() { read += 1; return false; }, explanation: null };
  assert.equal(run(hardDraft(), world(), trap).state, 'ready');
  assert.equal(read, 1);                                                    // validateSetup derives verifiedBasis once; Hard is unaffected by it
});

test('findings order: Panel problems (incl. basis-required), then Core issues, then pre-checks, then the Soft finding', () => {
  const w = world({ registered: ['mA'], validate: () => ({ issues: [{ path: '/clearance', code: 'not-positive', message: 'bad' }], issuesTruncated: false }) });
  const v = run(softDraft(), w, { available: false, explanation: null });
  assert.deepEqual(flat(v), [['basis', 'basis-required'], ['setB', 'model-not-registered']]);   // basis-required means no Core definition, so no Core issues
  const attested = run(reduce(softDraft(), { type: 'basisUnit', value: 'mm' }), w, { available: false, explanation: null, pending: true });
  assert.deepEqual(flat(attested), [['clearance', 'not-positive'], ['setB', 'model-not-registered'], ['mode', 'soft-checking']]);
  const attestedIssue = run(reduce(softDraft(), { type: 'basisUnit', value: 'mm' }), w, { available: false, explanation: null });
  assert.deepEqual(flat(attestedIssue), [['clearance', 'not-positive'], ['setB', 'model-not-registered']]);
});
