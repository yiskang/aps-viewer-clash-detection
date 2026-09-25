// test/clashtest/identity/ids.elementRef.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidModelKey, isValidDbId, makeElementRef, elementRefFrom, compareModelKeys, compareElementRefs, elementRefKey,
} from '../../../clashtest/identity/ids.js';

test('makeElementRef returns a frozen, closed {modelKey, dbId}', () => {
  const ref = makeElementRef('m1', 7);
  assert.deepEqual(Object.keys(ref), ['modelKey', 'dbId']);
  assert.equal(JSON.stringify(ref), '{"modelKey":"m1","dbId":7}');
  assert.equal(Object.isFrozen(ref), true);
  assert.deepEqual(structuredClone(ref), ref);
});

test('makeElementRef normalizes -0 and rejects anything that is not an identity', () => {
  assert.ok(Object.is(makeElementRef('m', -0).dbId, 0));
  for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53, '3', null, undefined, 1n]) {
    assert.throws(() => makeElementRef('m', bad), TypeError, `dbId ${String(bad)}`);
  }
  for (const bad of ['', 5, null, undefined, {}]) {
    assert.throws(() => makeElementRef(bad, 1), TypeError, `modelKey ${String(bad)}`);
  }
  assert.equal(isValidDbId(0), true);
  assert.equal(isValidDbId(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isValidModelKey('x'), true);
  assert.equal(isValidModelKey(''), false);
});

test('elementRefFrom copies exactly two fields and never carries runtime identity', () => {
  const live = {
    modelKey: 'm', dbId: 3, model: { id: 1 }, loadEpoch: 4, modelId: 9, fragmentId: 12, geometryIndex: 2,
  };
  const ref = elementRefFrom(live);
  assert.deepEqual(Object.keys(ref), ['modelKey', 'dbId']);
  assert.notEqual(ref, live);
  assert.equal(JSON.stringify(ref), '{"modelKey":"m","dbId":3}');
  assert.throws(() => elementRefFrom(null), TypeError);
  assert.throws(() => elementRefFrom('m'), TypeError);
  assert.throws(() => elementRefFrom({ modelKey: 'm' }), TypeError);
});

test('compareModelKeys is UTF-16 code-unit order, not locale order and not code-point order', () => {
  assert.equal(compareModelKeys('a', 'a'), 0);
  assert.equal(compareModelKeys('B', 'a'), -1);      // 0x42 < 0x61 (localeCompare would say the opposite)
  assert.equal(compareModelKeys('a', 'ab'), -1);     // shorter prefix first
  // U+1F600 is the surrogate pair D83D DE00; U+FF5E is one unit. By code unit D83D < FF5E;
  // by code point 0x1F600 > 0xFF5E. The spec fixes code-unit order.
  assert.equal(compareModelKeys('😀', '～'), -1);
  assert.equal(compareModelKeys('～', '😀'), 1);
});

test('element order is modelKey by code unit, then dbId numerically', () => {
  const refs = [['b', 1], ['a', 10], ['a', 2], ['B', 5], ['～', 0], ['😀', 0]]
    .map(([k, d]) => makeElementRef(k, d));
  const sorted = [...refs].sort(compareElementRefs).map((r) => `${r.modelKey}:${r.dbId}`);
  assert.deepEqual(sorted, ['B:5', 'a:2', 'a:10', 'b:1', '😀:0', '～:0']);
  assert.equal(compareElementRefs(makeElementRef('a', 99), makeElementRef('b', 1)), -1); // key dominates dbId
  assert.equal(compareElementRefs(makeElementRef('a', 2), makeElementRef('a', 2)), 0);
});

test('elementRefKey is injective: no delimiter-shaped modelKey can alias another ref (N12)', () => {
  const vectors = [
    ['a:1', 2], ['a', 1], ['a', 12], ['a1', 2], ['a\u0000', 1], ['a', 0], ['a\u0000\u0000', 1], ['a\u0000\u0001', 1],
    ['"a"', 1], ['a,1', 2], ['[a', 1], ['a]', 1], ['a\\', 1], ['a/1', 2], ['😀', 1], ['～', 1], ['\ud800', 1],
    ['a', Number.MAX_SAFE_INTEGER], ['a', Number.MAX_SAFE_INTEGER - 1],
  ];
  const keys = vectors.map(([k, d]) => elementRefKey(makeElementRef(k, d)));
  assert.equal(new Set(keys).size, vectors.length);
  assert.equal(typeof keys[0], 'string');
  assert.equal(elementRefKey(makeElementRef('m', 5)), elementRefKey({ modelKey: 'm', dbId: 5, model: {} })); // extra fields ignored
  assert.equal(elementRefKey(makeElementRef('m', -0)), elementRefKey(makeElementRef('m', 0)));
  for (const bad of [null, undefined, 'm', {}, { modelKey: '', dbId: 1 }, { modelKey: 'm', dbId: -1 }, { modelKey: 'm', dbId: 1.5 }]) {
    assert.throws(() => elementRefKey(bad), TypeError);
  }
});

test('elementRefKey is order-preserving: string order of keys == compareElementRefs, over a randomized population', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const alphabet = ['a', 'b', 'B', '\u0000', '\u0001', ':', '"', '😀', '～', '\ud800'];
  const refs = [];
  for (let i = 0; i < 400; i += 1) {
    const len = 1 + Math.floor(rnd() * 4);
    let modelKey = '';
    for (let j = 0; j < len; j += 1) modelKey += alphabet[Math.floor(rnd() * alphabet.length)];
    refs.push(makeElementRef(modelKey, [0, 1, 2, 9, 10, 99, 100, 2 ** 40, Number.MAX_SAFE_INTEGER][Math.floor(rnd() * 9)]));
  }
  for (const a of refs) {
    for (const b of refs.slice(0, 40)) {
      const byKey = elementRefKey(a) < elementRefKey(b) ? -1 : elementRefKey(a) > elementRefKey(b) ? 1 : 0;
      assert.equal(byKey, compareElementRefs(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
});
