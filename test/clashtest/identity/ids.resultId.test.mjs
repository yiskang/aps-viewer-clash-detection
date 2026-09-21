// test/clashtest/identity/ids.resultId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeElementRef, makePairId, makeResultId, parseResultId, isSemanticDigest,
} from '../../../clashtest/identity/ids.js';
import { digestCanonical } from '../../../clashtest/util/canonical.js'; // P0: synchronous, value-taking (reconciliation N3)

const D = `sha256:${'a'.repeat(64)}`;
const pairOf = (mode, k1, d1, k2, d2) => makePairId(mode, makeElementRef(k1, d1), makeElementRef(k2, d2));

test('canonical string form is JSON.stringify of the six-element array (spec §4.4)', () => {
  const pair = pairOf('volume-overlap', 'm2', 9, 'm1', 2);
  assert.equal(makeResultId('t-1', D, pair), `["t-1","${D}","m1",2,"m2",9]`);
});

test('makeResultId takes exactly (testId, semanticDigest, pairId): no revision/run/epoch/model can enter', () => {
  assert.equal(makeResultId.length, 3);
});

test('ResultId is stable across calls and across evaluation orientation for unordered modes', () => {
  const a = makeResultId('t', D, pairOf('clearance', 'mA', 1, 'mB', 2));
  const b = makeResultId('t', D, pairOf('clearance', 'mB', 2, 'mA', 1));
  assert.equal(a, b);
  assert.equal(a, makeResultId('t', D, pairOf('clearance', 'mA', 1, 'mB', 2)));
});

test('containment ResultIds distinguish the two orientations (a reversal is the converse question)', () => {
  const x = makeResultId('t', D, pairOf('containment', 'mA', 1, 'mB', 2));
  const y = makeResultId('t', D, pairOf('containment', 'mB', 2, 'mA', 1));
  assert.notEqual(x, y);
});

test('distinct modelKeys over identical dbIds give distinct ResultIds (AC-16)', () => {
  const ids = new Set(['m1', 'm2', 'm3'].map((k) => makeResultId('t', D, pairOf('volume-overlap', k, 5, k, 6))));
  assert.equal(ids.size, 3);
});

test('the encoding is delimiter-safe and round-trips for hostile modelKeys and testIds', () => {
  const keys = ['a","b', 'a,b', 'a|b', 'a\u0000b', 'a\\b', '\uD800', '😀', ' ', ' a', 'a '];
  const seen = new Map();
  for (const k1 of keys) {
    for (const k2 of keys) {
      const pair = pairOf('containment', k1, 1, k2, 2);
      const id = makeResultId('t"e,s|t', D, pair);
      assert.equal(seen.has(id), false, `collision on ${id}`);
      seen.set(id, pair);
      assert.deepEqual(parseResultId(id), { testId: 't"e,s|t', semanticDigest: D, pairId: pair });
    }
  }
});

test('parseResultId accepts only byte-identical canonical output', () => {
  const pair = pairOf('volume-overlap', 'm1', 1, 'm2', 2);
  const canonical = makeResultId('t', D, pair);
  assert.deepEqual(parseResultId(canonical), { testId: 't', semanticDigest: D, pairId: pair });
  const spaced = JSON.stringify(JSON.parse(canonical), null, 1);
  for (const bad of [spaced, canonical.slice(0, -1), `${canonical} `, '[]', '{}', 'null', '', 5, null, undefined,
    JSON.stringify(['t', 'sha256:xyz', 'm1', 1, 'm2', 2]),
    JSON.stringify(['t', D, 'm1', -1, 'm2', 2]),
    JSON.stringify(['t', D, 'm1', 1, 'm1', 1]),
    JSON.stringify(['', D, 'm1', 1, 'm2', 2])]) {
    assert.equal(parseResultId(bad), null, String(bad));
  }
});

test('makeResultId validates every input loudly', () => {
  const pair = pairOf('volume-overlap', 'm1', 1, 'm2', 2);
  assert.throws(() => makeResultId('', D, pair), TypeError);
  assert.throws(() => makeResultId('t', 'sha256:ABC', pair), TypeError);
  assert.throws(() => makeResultId('t', 'md5:abc', pair), TypeError);
  assert.throws(() => makeResultId('t', D, null), TypeError);
  assert.throws(() => makeResultId('t', D, { first: pair.first }), TypeError);
  assert.throws(() => makeResultId('t', D, { first: pair.first, second: pair.first }), RangeError);
  assert.equal(isSemanticDigest(D), true);
  assert.equal(isSemanticDigest(`sha256:${'A'.repeat(64)}`), false);
});

// ---- digest sensitivity (uses P0's canonical util; the production semanticDigest is P2's, AC-1) ------

// Test-local stand-in with the spec §5.4 shape: {mode, clearance?, selectionA, selectionB}, name/description/revision excluded.
function standInSemanticDigest({ mode, clearance, selectionA, selectionB }) {
  const body = { mode, selectionA, selectionB };
  if (clearance !== undefined) body.clearance = clearance;
  return digestCanonical(body);
}

const baseDef = {
  mode: 'clearance',
  clearance: 0.5,
  selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] },
  selectionB: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: [1, 2] }] },
};

test('the digest is sensitive to mode, clearance, each selection, and the A/B swap; insensitive to key order', () => {
  const d0 = standInSemanticDigest(baseDef);
  assert.match(d0, /^sha256:[0-9a-f]{64}$/);
  const reordered = { selectionB: baseDef.selectionB, clearance: 0.5, selectionA: baseDef.selectionA, mode: 'clearance' };
  assert.equal(standInSemanticDigest(reordered), d0);

  const variants = [
    { ...baseDef, mode: 'volume-overlap', clearance: undefined },
    { ...baseDef, mode: 'containment', clearance: undefined },
    { ...baseDef, clearance: 1 },
    { ...baseDef, selectionB: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: [1, 3] }] } },
    { ...baseDef, selectionA: { entries: [{ kind: 'model', modelKey: 'mC' }] } },
    { ...baseDef, selectionA: baseDef.selectionB, selectionB: baseDef.selectionA }, // swap = different question (§5.4, R21 Q3)
  ];
  const digests = [d0, ...variants.map(standInSemanticDigest)];
  assert.equal(new Set(digests).size, digests.length);
});

test('the same element pair gets a different ResultId under each different question, the same one under the same question', () => {
  const pair = pairOf('volume-overlap', 'mA', 1, 'mB', 2);
  const dA = standInSemanticDigest(baseDef);
  const dB = standInSemanticDigest({ ...baseDef, clearance: 1 });
  assert.notEqual(makeResultId('t', dA, pair), makeResultId('t', dB, pair));
  // a name-only revision is modelled by recomputing the digest from the same semantic fields
  assert.equal(makeResultId('t', dA, pair), makeResultId('t', standInSemanticDigest({ ...baseDef }), pair));
  // and testId is part of the identity
  assert.notEqual(makeResultId('t1', dA, pair), makeResultId('t2', dA, pair));
});
