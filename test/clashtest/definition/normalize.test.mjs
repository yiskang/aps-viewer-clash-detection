// test/clashtest/definition/normalize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, canonicalSemanticForm, computeSemanticDigest } from '../../../clashtest/definition/normalize.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { makeDefinition } from '../support/definitions.mjs';

const prep = (o) => normalizeDefinition(captureAndValidate(makeDefinition(o)).captured);

test('dbIds are de-duplicated and sorted; entries are merged and ordered by modelKey', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'elements', modelKey: 'mB', dbIds: [5, 1, 5] },
      { kind: 'elements', modelKey: 'mA', dbIds: [3] },
      { kind: 'elements', modelKey: 'mA', dbIds: [2, 3] },
    ] },
  });
  assert.deepEqual(n.selectionA.entries, [
    { kind: 'elements', modelKey: 'mA', dbIds: [2, 3] },
    { kind: 'elements', modelKey: 'mB', dbIds: [1, 5] },
  ]);
});

test('a model entry wins over elements entries for the same modelKey', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'elements', modelKey: 'mA', dbIds: [1] },
      { kind: 'model', modelKey: 'mA' },
    ] },
  });
  assert.deepEqual(n.selectionA.entries, [{ kind: 'model', modelKey: 'mA' }]);
});

test('a model entry wins regardless of entry order (model first, then elements for the same modelKey)', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'model', modelKey: 'mA' },
      { kind: 'elements', modelKey: 'mA', dbIds: [1] },
      { kind: 'elements', modelKey: 'mB', dbIds: [2] },
      { kind: 'model', modelKey: 'mB' },
    ] },
  });
  assert.deepEqual(n.selectionA.entries, [{ kind: 'model', modelKey: 'mA' }, { kind: 'model', modelKey: 'mB' }]);
});

test('modelKey ordering is code-unit order, not locale order', () => {
  const n = prep({
    selectionA: { entries: [
      { kind: 'model', modelKey: 'a' }, { kind: 'model', modelKey: 'B' }, { kind: 'model', modelKey: 'Z' },
    ] },
  });
  assert.deepEqual(n.selectionA.entries.map((e) => e.modelKey), ['B', 'Z', 'a']);
});

test('semanticDigest is invariant under key order, whitespace, name, description and revision', () => {
  const base = computeSemanticDigest(prep({}));
  assert.equal(computeSemanticDigest(prep({ name: 'other name' })), base);
  assert.equal(computeSemanticDigest(prep({ description: 'notes' })), base);
  assert.equal(computeSemanticDigest(prep({ revision: 97 })), base);
  assert.equal(computeSemanticDigest(prep({ testId: 'T-other' })), base);
  const reordered = normalizeDefinition(captureAndValidate({
    mode: 'volume-overlap', selectionB: { entries: [{ modelKey: 'mB', kind: 'model' }] }, revision: 1,
    selectionA: { entries: [{ dbIds: [1, 2], modelKey: 'mA', kind: 'elements' }] }, name: 'structure vs mep',
    testId: 'T1', schemaVersion: 1,
  }).captured);
  assert.equal(computeSemanticDigest(reordered), base);
});

test('semanticDigest changes with every semantic field, including a selection swap (5.4)', () => {
  const base = computeSemanticDigest(prep({}));
  const swapped = computeSemanticDigest(prep({
    selectionA: { entries: [{ kind: 'model', modelKey: 'mB' }] },
    selectionB: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2] }] },
  }));
  assert.notEqual(swapped, base);
  assert.notEqual(computeSemanticDigest(prep({ mode: 'surface-intersection' })), base);
  assert.notEqual(computeSemanticDigest(prep({ mode: 'clearance', clearance: 0.05 })), base);
  assert.notEqual(computeSemanticDigest(prep({
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2, 3] }] },
  })), base);
});

test('clearance is in the canonical form iff mode is clearance', () => {
  assert.equal('clearance' in canonicalSemanticForm(prep({})), false);
  assert.equal(canonicalSemanticForm(prep({ mode: 'clearance', clearance: 0.05 })).clearance, 0.05);
});

test('golden byte-level vectors for the canonical JSON and digest (AC-1)', () => {
  const A = { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [1, 2] }] };
  const B = { entries: [{ kind: 'model', modelKey: 'mB' }] };
  const vectors = [
    [{ selectionA: A, selectionB: B, mode: 'volume-overlap' },
     'sha256:beb9b5250e0c535c8a124cbcdb90f3cc12668358735b0da552f897d68e647e00'],
    [{ selectionA: B, selectionB: A, mode: 'volume-overlap' },             // swap => different question
     'sha256:67acf043f927e22aeee02aa63285e0caf4f5af02394fd12ffd98fe30ab0af054'],
    [{ selectionA: A, selectionB: B, mode: 'clearance', clearance: 0.05 },
     'sha256:ce8393d0919a4d875c486391f97ae77359067620c4ae710ee7126145229d31eb'],
    [{ mode: 'containment',
      selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mA' }] } },      // A = B self test
     'sha256:8f9f4ec2633090cbde92cf1603593bb92da331470741e2fa344eff9eddfd2289'],
    [{ mode: 'volume-overlap', selectionB: B,                              // e-acute + lone surrogate + BEL
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mé\uD800\u0007', dbIds: [0] }] } },
     'sha256:7ac1530a8690d731aeda6cbb57142652221405a5d69f7123c58d935095b9d7fd'],
    [{ mode: 'volume-overlap', selectionB: B,                              // -0 normalized to 0
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: [-0] }] } },
     'sha256:6d8e208b271b02d44707951e940af3ff58d3e04be791f2b3bd710caf04fb15b1'],
    [{ selectionA: A, selectionB: B, mode: 'clearance', clearance: 1e-7 }, // exponent-form number
     'sha256:478211d9cf0d329e89b5e168e2bc8e1407b3dd14cc1e34d8c7f1ead43a77db12'],
  ];
  for (const [override, expected] of vectors) {
    assert.equal(computeSemanticDigest(prep(override)), expected, JSON.stringify(override));
  }
});

test('the first golden vector pins the canonical JSON bytes (P0 canonicalJson: sorted keys), not just the digest', () => {
  assert.equal(
    canonicalJson(canonicalSemanticForm(prep({}))),
    '{"mode":"volume-overlap","selectionA":{"entries":[{"dbIds":[1,2],"kind":"elements","modelKey":"mA"}]},'
    + '"selectionB":{"entries":[{"kind":"model","modelKey":"mB"}]}}',
  );
});
