// test/clashtest/identity/ids.pairId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASH_MODES, pairSemanticsOf, sameSemanticsClass, makeElementRef, compareElementRefs, makePairId, comparePairIds,
} from '../../../clashtest/identity/ids.js';

const UNORDERED = ['volume-overlap', 'surface-intersection', 'clearance'];
const ref = (k, d) => makeElementRef(k, d);

// seeded RNG (mulberry32) + Fisher-Yates so the shuffle tests are reproducible
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(items, rnd) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 4 models (incl. a surrogate-pair key and a BMP key that sort differently by code point) x 4 dbIds = 16 elements
const ELEMENTS = ['mA', 'mB', '😀', '～'].flatMap((k) => [0, 1, 2, 10].map((d) => ref(k, d)));

function canonicalPairSet(mode, seed) {
  const rnd = mulberry32(seed);
  const tuples = [];
  for (const x of ELEMENTS) for (const y of ELEMENTS) if (compareElementRefs(x, y) !== 0) tuples.push([x, y]);
  const byJson = new Map();
  for (const [x, y] of shuffle(tuples, rnd)) {
    const p = makePairId(mode, x, y);
    byJson.set(JSON.stringify(p), p);
  }
  return [...byJson.values()].sort(comparePairIds);
}

test('CLASH_MODES is the frozen spec §5.1 list and semantics are derived from mode alone (§4.5)', () => {
  assert.deepEqual([...CLASH_MODES], ['volume-overlap', 'surface-intersection', 'containment', 'clearance']);
  assert.equal(Object.isFrozen(CLASH_MODES), true);
  for (const m of UNORDERED) assert.equal(pairSemanticsOf(m), 'unordered');
  assert.equal(pairSemanticsOf('containment'), 'ordered');
  for (const bad of ['hard', '', undefined, null, 5, Symbol('m')]) {
    assert.throws(() => pairSemanticsOf(bad), TypeError);
  }
  assert.equal(sameSemanticsClass('volume-overlap', 'clearance'), true);
  assert.equal(sameSemanticsClass('clearance', 'containment'), false);
});

test('unordered modes: (x,y) and (y,x) are ONE PairId, first is the lesser element', () => {
  for (const mode of UNORDERED) {
    const x = ref('m2', 1);
    const y = ref('m1', 5);
    assert.deepEqual(makePairId(mode, x, y), makePairId(mode, y, x));
    assert.deepEqual(makePairId(mode, x, y), { first: ref('m1', 5), second: ref('m2', 1) });
    // same model: dbId compared numerically, not lexically
    assert.deepEqual(makePairId(mode, ref('m', 10), ref('m', 2)), { first: ref('m', 2), second: ref('m', 10) });
  }
});

test('containment is ordered: first = contained (source), second = container (target); no reordering', () => {
  const inner = ref('m2', 1);
  const outer = ref('m1', 5); // lesser in element order, yet must stay `second`
  assert.deepEqual(makePairId('containment', inner, outer), { first: inner, second: outer });
  assert.deepEqual(makePairId('containment', outer, inner), { first: outer, second: inner });
  assert.notDeepEqual(makePairId('containment', inner, outer), makePairId('containment', outer, inner));
});

test('a PairId always names two distinct elements', () => {
  for (const mode of CLASH_MODES) {
    assert.throws(() => makePairId(mode, ref('m', 1), ref('m', 1)), RangeError);
  }
  assert.throws(() => makePairId('containment', ref('m', 1), null), TypeError);
});

test('a PairId is closed, frozen, and carries no runtime identity even if the inputs do', () => {
  const live = (k, d) => ({ modelKey: k, dbId: d, model: { id: 1 }, loadEpoch: 3, modelId: 8, fragmentId: 2 });
  const pair = makePairId('volume-overlap', live('m1', 1), live('m2', 2));
  assert.deepEqual(Object.keys(pair), ['first', 'second']);
  assert.deepEqual(Object.keys(pair.first), ['modelKey', 'dbId']);
  assert.deepEqual(Object.keys(pair.second), ['modelKey', 'dbId']);
  assert.equal(Object.isFrozen(pair) && Object.isFrozen(pair.first) && Object.isFrozen(pair.second), true);
  assert.doesNotMatch(JSON.stringify(pair), /"model"|loadEpoch|modelId|fragmentId/);
  assert.deepEqual(structuredClone(pair), pair);
});

test('property: unordered canonicalization is independent of enumeration order and orientation', () => {
  for (const mode of UNORDERED) {
    const baseline = canonicalPairSet(mode, 1);
    assert.equal(baseline.length, (ELEMENTS.length * (ELEMENTS.length - 1)) / 2); // 120 unordered pairs
    assert.ok(baseline.every((p) => compareElementRefs(p.first, p.second) < 0));
    for (let seed = 2; seed <= 21; seed += 1) {
      assert.deepEqual(canonicalPairSet(mode, seed), baseline, `${mode} seed ${seed}`);
    }
  }
});

test('property: containment keeps BOTH orientations as distinct pairs, independent of enumeration order', () => {
  const baseline = canonicalPairSet('containment', 1);
  assert.equal(baseline.length, ELEMENTS.length * (ELEMENTS.length - 1)); // 240 ordered pairs
  for (let seed = 2; seed <= 21; seed += 1) {
    assert.deepEqual(canonicalPairSet('containment', seed), baseline, `containment seed ${seed}`);
  }
});

test('property: every unordered mode yields the SAME PairId for the same two elements (join key across modes, AC-14 iv)', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 200; i += 1) {
    const [x, y] = shuffle(ELEMENTS, rnd).slice(0, 2);
    const ids = UNORDERED.map((m) => JSON.stringify(makePairId(m, x, y)));
    assert.equal(new Set(ids).size, 1);
  }
});

test('comparePairIds is the spec §11.3 order (first.modelKey, first.dbId, second.modelKey, second.dbId)', () => {
  const reference = (p, q) => {
    const a = [p.first.modelKey, p.first.dbId, p.second.modelKey, p.second.dbId];
    const b = [q.first.modelKey, q.first.dbId, q.second.modelKey, q.second.dbId];
    for (let i = 0; i < 4; i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  const all = canonicalPairSet('containment', 3);
  const shuffled = shuffle(all, mulberry32(99));
  assert.deepEqual([...shuffled].sort(comparePairIds), [...shuffled].sort(reference));
  assert.equal(comparePairIds(all[0], all[0]), 0);
});
