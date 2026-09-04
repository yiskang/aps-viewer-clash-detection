import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceIntersectionQuery } from '../../collision/query/SurfaceIntersectionQuery.js';
import { box, at, comb, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

test('baseline separation/interpenetration', () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const r1 = surfaceIntersectionQuery(a.bvh, sep.bvh, relativeMatrix(a, sep));
  assert.equal(r1.intersects, false, 'two clearly separated boxes: no intersection');

  const pen = testInstance(box(2, 2, 2), at(1, 0, 0));
  const r2 = surfaceIntersectionQuery(a.bvh, pen.bvh, relativeMatrix(a, pen));
  assert.equal(r2.intersects, true, 'genuine interpenetration: intersects');
});

test('flush/coplanar touching', () => {
  // Box resting exactly on top of another. surface-intersection reports this as
  // touching (correct name for the mode) -- contrast with VolumeOverlapQuery, which
  // must report false on this SAME input (that assertion lives in Task 11's own test
  // file, not here; this file only proves this mode's own half of the contrast).
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b));
  assert.equal(r.intersects, true,
    'flush face-to-face touching: intersects -- contrast with volume-overlap, which is false on the same input (docs/...:1816-1818)');
});

test('budget exhaustion on zero-intersection combs', () => {
  // Round 7 regression: MeshBVH.intersectsGeometry has no budget/abort hook, so this
  // exact interleaved-comb input (heavy leaf overlap, zero triangle intersections)
  // would freeze synchronously through the old definition of this mode
  // (docs/...:1820-1832). Shares the ProperCrossingQuery budget fixture's input
  // deliberately (docs/...:1834-1846: "the same bvhcast traversal...the same abort
  // protocol").
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const t0 = performance.now();
  // frameBudgetMs: Infinity isolates this from the default 8ms clock so this test
  // proves the 500-pair count ceiling specifically fired, not an incidental clock
  // trip on a slow run -- the separate mocked-clock test below covers the time
  // trigger in isolation the same way.
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b), { maxCandidatePairsExamined: 500, frameBudgetMs: Infinity });
  const elapsed = performance.now() - t0;
  assert.equal(r.aborted, true, 'budget exhausted: aborted');
  assert.equal(r.intersects, false,
    'aborted must NOT read as a hit -- bvhcast returns true on abort too; reading it as a hit fabricates a result (docs/...:1926-1930)');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'abort carries crossing-budget-exhausted');
  assert.ok(elapsed < 500, `abort completes within a wall-clock bound (${elapsed.toFixed(1)}ms)`);
});

test('private-clock time-based abort (mocked clock)', () => {
  // Distinct from the count-budget fixture above: a huge candidate budget so ONLY the
  // private traversal-local clock can trip, proving the time trigger is independently
  // wired (docs/...:1932-1957, shared with ProperCrossingQuery's own private clock).
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  let calls = 0;
  const mockNow = () => { calls++; return calls === 1 ? 0 : 100; }; // second read already past frameBudgetMs=8
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b), { maxCandidatePairsExamined: 10_000_000, now: mockNow });
  assert.equal(r.aborted, true, 'time-based abort: aborted');
  assert.equal(r.intersects, false, 'time-based abort: not intersects');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'time-based abort carries crossing-budget-exhausted');
});

test('callback exception does not poison subsequent bvhcast traversals (defect fix, final whole-branch review Finding 1)', () => {
  // Mirrors ProperCrossingQuery.test.mjs's own exception-containment test: three-mesh-
  // bvh's bvhcast sets a module-global `_active` flag true at entry and clears it only
  // on its normal-completion path (no try/finally). If intersectsTriangles were
  // allowed to let an exception escape straight out of bvhcast, `_active` would stay
  // stuck true and permanently break every LATER bvhcast-based query in the process
  // ("Recursive calls to bvhcast not supported") until reload.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap: callback invoked
  let calls = 0;
  const throwingNow = () => {
    calls++;
    if (calls === 2) throw new Error('injected clock failure');
    return 0;
  };
  assert.throws(
    () => surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b), { now: throwingNow }),
    /injected clock failure/,
    'the injected exception propagates out of surfaceIntersectionQuery, not swallowed');

  // A completely normal, immediately-following call must still succeed -- proves the
  // callback's catch/return-true/rethrow protocol let bvhcast reach its
  // normal-completion path and clear `_active` despite the thrown exception (not just
  // that the exception propagated).
  const r = surfaceIntersectionQuery(a.bvh, b.bvh, relativeMatrix(a, b));
  assert.equal(typeof r.intersects, 'boolean',
    'subsequent traversal is not poisoned by the prior callback exception');
});

test('open operands, no parity, no diagnostic', () => {
  // This mode performs no parity at all (docs/...:1702, 1838-1840) -- open source AND
  // open target must still report intersection with NO diagnostic whatsoever.
  const openSrc = testInstance(openBottomedBox(2));
  const openTgt = testInstance(openBottomedBox(2), at(0.5, 0, 0));
  const r = surfaceIntersectionQuery(openSrc.bvh, openTgt.bvh, relativeMatrix(openSrc, openTgt));
  assert.equal(r.intersects, true, 'open source AND open target: intersects');
  assert.equal(r.diagnostics.length, 0,
    'surface-intersection performs no parity, no closure precondition at all');
});
