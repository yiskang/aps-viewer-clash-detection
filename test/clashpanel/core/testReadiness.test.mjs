// test/clashpanel/core/testReadiness.test.mjs — spec §26.6 readiness / "models changed", AC-M10, AC-M17, AC-M19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftReduce } from '../../../clashpanel/core/draft.js';
import { readinessOf, modelsChangedOf, READINESS } from '../../../clashpanel/core/testReadiness.js';

const reduce = (d, ...a) => a.reduce(draftReduce, d);
const MA = { id: 'A' };
const MB = { id: 'B' };
const NAMES = { mA: 'Architecture', mB: 'Structure' };
const modelName = (k) => NAMES[k] ?? `Model ${k}`;
const binding = (model, over = {}) => ({ model, bindingGeneration: 1, modelVersion: 'v1', ...over });
function world({ entries = [{ modelKey: 'mA', model: MA, loaded: true }, { modelKey: 'mB', model: MB, loaded: true }], bindings = { mA: binding(MA), mB: binding(MB) } } = {}) {
  return { entries, bindingFor: (k) => bindings[k] ?? null, catalog: { list: () => entries } };
}
const ab = () => reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' }, { type: 'toggleModel', side: 'B', modelKey: 'mB' });
const read = (draft, w = world()) => readinessOf({ draft, entries: w.entries, bindingFor: w.bindingFor, modelName });

test('setup-complete: both sides set, every referenced model listed, loaded and bound; the copy never says "ready"', () => {
  const r = read(ab());
  assert.equal(r.state, READINESS.COMPLETE);
  assert.equal(r.text, 'Setup complete — readiness to run is checked when opened');
  assert.doesNotMatch(r.text, /\bready\b/i);
  assert.deepEqual(r.models, [{ modelKey: 'mA', name: 'Architecture', state: 'loaded' }, { modelKey: 'mB', name: 'Structure', state: 'loaded' }]);
});

test('incomplete: an empty side, or Soft without a clearance', () => {
  assert.equal(read(createDraft({ testId: 'T' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' })).state, READINESS.INCOMPLETE);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' })).state, READINESS.COMPLETE);
});

test('AC-M19: a multi-model Soft test without a basis attestation reads setup-complete (rows never evaluate the basis)', () => {
  const soft = reduce(ab(), { type: 'mode', value: 'soft' }, { type: 'clearance', value: '0.1' });
  assert.equal(soft.basisUnit, '');
  assert.equal(read(soft).state, READINESS.COMPLETE);
});

test('models-missing: absent from the catalog or unbound — one "<model> is not loaded" per model', () => {
  const r = read(ab(), world({ entries: [{ modelKey: 'mA', model: MA, loaded: true }] }));
  assert.equal(r.state, READINESS.MISSING);
  assert.equal(r.text, 'Structure is not loaded');
  assert.equal(read(ab(), world({ bindings: { mA: binding(MA) } })).state, READINESS.MISSING);
  assert.equal(read(ab(), world({ entries: [], bindings: {} })).text, 'Architecture is not loaded; Structure is not loaded');
});

test('models-loading: listed and bound but not load-complete; precedence missing > loading > incomplete', () => {
  const loading = world({ entries: [{ modelKey: 'mA', model: MA, loaded: false }, { modelKey: 'mB', model: MB, loaded: true }] });
  assert.equal(read(ab(), loading).state, READINESS.LOADING);
  assert.equal(read(ab(), world({ entries: [{ modelKey: 'mA', model: MA, loaded: false }] })).state, READINESS.MISSING);
  assert.equal(read(reduce(ab(), { type: 'mode', value: 'soft' }), loading).state, READINESS.LOADING);
});

test('self-clash references Set A only', () => {
  const d = reduce(createDraft({ testId: 'T' }), { type: 'toggleModel', side: 'A', modelKey: 'mA' },
    { type: 'toggleModel', side: 'B', modelKey: 'mGone' }, { type: 'selfClash', value: true });
  assert.equal(read(d).state, READINESS.COMPLETE);
});

test('modelsChangedOf: the §9.1 identity check per summary model; a null summary or models [] never marks a row', () => {
  const w = world();
  const summary = { models: [{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }] };
  const changed = (x, s = summary) => modelsChangedOf({ summary: s, bindingFor: x.bindingFor, catalog: x.catalog });
  assert.equal(changed(w, null), false);
  assert.equal(changed(w, { models: [] }), false);
  assert.equal(changed(w), false);
  assert.equal(changed(world({ bindings: { mA: binding(MA, { bindingGeneration: 2 }), mB: binding(MB) } })), true, 'rebound');
  assert.equal(changed(world({ bindings: { mA: binding(MA), mB: binding(MB, { modelVersion: 'v2' }) } })), true, 'new version');
  assert.equal(changed(world({ entries: [{ modelKey: 'mA', model: MA, loaded: true }] })), true, 'not in the scene');
  assert.equal(changed(world({ bindings: { mA: binding(MA) } })), true, 'binding gone');
});
