// test/acceptance/clashpanel-viewerbridge.acceptance.selection.test.mjs
//
// Offline tests for deterministic target selection (procedure §4.4): pure functions over supplied
// tree/candidate data; no randomization; order-independent; inputs never mutated.

import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCandidates, selectFitUnionPair, selectTargets } from './clashpanel-viewerbridge.acceptance.mjs';

const box = (cx, cy, cz, h = 1) => new Float32Array([cx - h, cy - h, cz - h, cx + h, cy + h, cz + h]);

function model(entries) {
  // entries: [dbId, fragments, box|null]
  return {
    leafDbIds: entries.map((e) => e[0]),
    fragmentCounts: Object.fromEntries(entries.map((e) => [e[0], e[1]])),
    boxes: Object.fromEntries(entries.filter((e) => e[2]).map((e) => [e[0], e[2]])),
  };
}

test('candidate = leaf with >=1 fragment and a finite, ordered box; sorted ascending; counts recorded', () => {
  const bad = new Float32Array([1, 1, 1, 0, 2, 2]); // min > max on x
  const nan = new Float32Array([0, 0, 0, NaN, 1, 1]);
  const inf = new Float32Array([0, 0, 0, Infinity, 1, 1]);
  const m = model([[9, 1, box(0, 0, 0)], [3, 0, box(1, 1, 1)], [7, 2, bad], [5, 1, nan], [4, 1, inf], [2, 3, null], [8, 1, box(2, 2, 2)], [1, 1, box(3, 3, 3)]]);
  const r = enumerateCandidates(m);
  assert.deepEqual(r.candidates.map((c) => c.dbId), [1, 8, 9]);
  assert.equal(r.leafCount, 8);
  assert.equal(r.candidateCount, 3);
  assert.deepEqual(r.candidates[0].box, [2, 2, 2, 4, 4, 4]);
  assert.deepEqual(r.candidates[0].centre, [3, 3, 3]);
});

test('zero-extent (min == max) boxes are valid; duplicates and non-integers are ignored; Map/function inputs work', () => {
  const point = new Float32Array([5, 5, 5, 5, 5, 5]);
  const r = enumerateCandidates({ leafDbIds: [4, 4, 4.5, 2], fragmentCounts: new Map([[4, 1], [2, 1]]), boxes: (id) => (id === 4 || id === 2 ? point : undefined) });
  assert.deepEqual(r.candidates.map((c) => c.dbId), [2, 4]);
  assert.equal(r.leafCount, 2);
  assert.equal(enumerateCandidates({ leafDbIds: [], fragmentCounts: {}, boxes: {} }).candidateCount, 0);
  assert.equal(enumerateCandidates({}).candidateCount, 0);
});

test('a1/b1 are the first candidates; order of the supplied leaves never matters', () => {
  const A = model([[30, 1, box(0, 0, 0)], [10, 1, box(1, 0, 0)], [20, 1, box(2, 0, 0)]]);
  const B = model([[99, 1, box(50, 0, 0)], [55, 1, box(60, 0, 0)]]);
  const r = selectTargets({ A, B });
  assert.equal(r.a1, 10);
  assert.equal(r.b1, 55);
  const shuffled = selectTargets({ A: { ...A, leafDbIds: [...A.leafDbIds].reverse() }, B: { ...B, leafDbIds: [...B.leafDbIds].reverse() } });
  assert.deepEqual(shuffled, r);
  assert.deepEqual(r.candidateCounts, { A: { leaves: 3, candidates: 3 }, B: { leaves: 2, candidates: 2 } });
  assert.match(r.rule, /first 50/);
});

test('fit pair maximises world-centre distance; ties broken by lowest dbId (a then b)', () => {
  const A = model([[1, 1, box(0, 0, 0)], [2, 1, box(10, 0, 0)]]);
  const B = model([[7, 1, box(100, 0, 0)], [8, 1, box(-100, 0, 0)]]);
  // distances: (1,7)=100 (1,8)=100 (2,7)=90 (2,8)=110 -> best (2,8)
  assert.deepEqual(selectTargets({ A, B }).fitPair, { a: 2, b: 8, distance: 110 });
  const tieA = model([[6, 1, box(0, 0, 0)], [3, 1, box(0, 0, 0)]]);
  const tieB = model([[9, 1, box(5, 0, 0)], [4, 1, box(5, 0, 0)]]);
  const t = selectTargets({ A: tieA, B: tieB });
  assert.deepEqual([t.fitPair.a, t.fitPair.b], [3, 4]);
  assert.equal(t.fitPair.distance, 5);
});

test('the pool is the first 50 candidates of each model: a farther element at rank 51 is never chosen', () => {
  const aEntries = Array.from({ length: 51 }, (_, i) => [i + 1, 1, box(i === 50 ? 10_000 : 0, 0, 0)]);
  const bEntries = Array.from({ length: 51 }, (_, i) => [i + 1, 1, box(i === 50 ? -10_000 : 5, 0, 0)]);
  const r = selectTargets({ A: model(aEntries), B: model(bEntries) });
  assert.equal(r.poolSizes.A, 50);
  assert.equal(r.poolSizes.B, 50);
  assert.ok(r.fitPair.a <= 50 && r.fitPair.b <= 50);
  assert.deepEqual(r.candidateCounts.A, { leaves: 51, candidates: 51 });
});

test('N2: no discriminating pair (identical centres, empty pool) => C6 NOT_EVIDENCED, never guessed', () => {
  const same = model([[1, 1, box(0, 0, 0)]]);
  const r = selectTargets({ A: same, B: model([[2, 1, box(0, 0, 0)]]) });
  assert.equal(r.fitPair, null);
  assert.equal(r.fitPairReason, 'no-discriminating-pair');
  assert.equal(r.c6NotEvidenced, true);
  assert.equal(r.a1, 1);
  assert.equal(r.b1, 2);
  const empty = selectTargets({ A: same, B: model([[2, 0, box(0, 0, 0)], [3, 1, null]]) });
  assert.equal(empty.b1, null);
  assert.equal(empty.fitPairReason, 'empty-pool');
  assert.equal(empty.c6NotEvidenced, true);
  assert.match(empty.rationale, /C6 NOT_EVIDENCED/);
  assert.equal(selectFitUnionPair([], []).pair, null);
});

test('selection is deterministic across repeated calls and never mutates its inputs', () => {
  const A = model([[2, 1, box(1, 2, 3)], [1, 1, box(4, 5, 6)]]);
  const B = model([[5, 1, box(-7, 8, 9)]]);
  const before = JSON.stringify([A, B].map((m) => ({ ...m, boxes: Object.fromEntries(Object.entries(m.boxes).map(([k, v]) => [k, Array.from(v)])) })));
  const results = Array.from({ length: 5 }, () => JSON.stringify(selectTargets({ A, B })));
  assert.equal(new Set(results).size, 1);
  const after = JSON.stringify([A, B].map((m) => ({ ...m, boxes: Object.fromEntries(Object.entries(m.boxes).map(([k, v]) => [k, Array.from(v)])) })));
  assert.equal(after, before);
});
