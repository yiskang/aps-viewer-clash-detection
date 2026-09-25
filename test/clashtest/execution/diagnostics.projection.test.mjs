// test/clashtest/execution/diagnostics.projection.test.mjs
//
// P4.2: the unit binding table, the structural `attributionOf` classifier, and single-diagnostic
// projection — the point at which `modelId` (which may be a live `Model` object) is replaced by a
// durable `modelKey` and never copied forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUnitBindingTable, projectDiagnostic, attributionOf,
} from '../../../clashtest/execution/diagnostics.js';

const table = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 1 }, { modelKey: 'mk-b', modelId: 2 }]);
const frag = (reason, fragment, role) => ({ scope: 'fragment', reason, role, fragment });

test('fragment diagnostic with a numeric dbId projects to element attribution', () => {
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 1, dbId: 42, fragId: 7 }, 'source'), table);
  assert.equal(r.ok, true);
  assert.deepEqual(r.diagnostic, {
    scope: 'fragment', reason: 'geometry-not-yet-available', completenessAffecting: true,
    attribution: 'element', fragment: { modelKey: 'mk-a', dbId: 42, fragId: 7, role: 'source' },
  });
  assert.equal('modelId' in r.diagnostic.fragment, false, 'modelId must never survive projection');
});

test('a whole-model-target dbId:null diagnostic keeps null and becomes target-model', () => {
  const r = projectDiagnostic(frag('fragment-not-loaded', { modelId: 2, dbId: null, fragId: 9 }, 'target'), table);
  assert.equal(r.diagnostic.fragment.dbId, null, 'never a 0/-1 sentinel');
  assert.equal(r.diagnostic.attribution, 'target-model');
  assert.equal(attributionOf(r.diagnostic), 'target-model');
});

test('a dbId:null SOURCE-role fragment degrades to unit attribution', () => {
  const r = projectDiagnostic(frag('fragment-owner-unresolvable', { modelId: 1, dbId: null, fragId: 3 }, 'source'), table);
  assert.equal(r.diagnostic.attribution, 'unit');
});

test('a non-numeric, non-null dbId normalizes to null and degrades to unit (legal, unpinnable)', () => {
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 1, dbId: '42', fragId: 1 }, 'target'), table);
  assert.equal(r.ok, true);
  assert.equal(r.diagnostic.fragment.dbId, null, 'never coerced');
  assert.equal(r.diagnostic.attribution, 'unit');
});

test('an ambiguous modelId yields modelKey null + ambiguousModelId + unit attribution', () => {
  const ambiguous = createUnitBindingTable([{ modelKey: 'mk-a', modelId: 7 }, { modelKey: 'mk-b', modelId: 7 }]);
  const r = projectDiagnostic(frag('geometry-not-yet-available', { modelId: 7, dbId: 11, fragId: 1 }, 'target'), ambiguous);
  assert.equal(r.diagnostic.fragment.modelKey, null);
  assert.equal(r.diagnostic.ambiguousModelId, true);
  assert.equal(r.diagnostic.attribution, 'unit', 'never a guess');
});

test('a live Model object as modelId is resolved by identity and never copied', () => {
  const liveModel = { getFragmentList() { return {}; } };
  liveModel.self = liveModel; // circular, exactly like the F4 window reference
  const t = createUnitBindingTable([{ modelKey: 'mk-a', modelId: liveModel }]);
  const r = projectDiagnostic(frag('rejected-primitive-range', { modelId: liveModel, dbId: 5, fragId: 2 }, 'source'), t);
  assert.equal(r.diagnostic.fragment.modelKey, 'mk-a');
  assert.doesNotThrow(() => structuredClone(r.diagnostic));
});

test('pair scope maps sourceFragment/targetFragment to canonical first/second', () => {
  const r = projectDiagnostic({ scope: 'pair', reason: 'witness-unavailable',
    sourceFragment: { modelId: 2, dbId: 30, fragId: 4 }, targetFragment: { modelId: 1, dbId: 20, fragId: 8 } }, table);
  assert.equal(r.diagnostic.completenessAffecting, false);
  assert.deepEqual(r.diagnostic.fragments.first, { modelKey: 'mk-a', dbId: 20, fragId: 8 });
  assert.deepEqual(r.diagnostic.fragments.second, { modelKey: 'mk-b', dbId: 30, fragId: 4 });
  assert.equal(r.diagnostic.attribution, 'element');
});

test('illegal diagnostics are REJECTED, not degraded', () => {
  const ok = { modelId: 1, dbId: 1, fragId: 1 };
  for (const [label, raw] of [
    ['over-length reason', frag('x'.repeat(129), ok)],
    ['10 KB reason', frag('y'.repeat(10_240), ok)],
    ['non-string reason', frag(12, ok)],
    ['non-plain diagnostic', new Map([['scope', 'fragment']])],
    ['unknown scope', { scope: 'model', reason: 'x', fragment: ok }],
    ['non-finite fragId', frag('x', { modelId: 1, dbId: 1, fragId: NaN })],
  ]) {
    const r = projectDiagnostic(raw, table);
    assert.equal(r.ok, false, label);
    assert.ok(r.issue.code.length > 0 && r.issue.detail.length <= 512, label);
  }
});
