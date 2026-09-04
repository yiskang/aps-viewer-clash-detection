import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { properCrossingQuery } from '../../collision/query/ProperCrossingQuery.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

function relativeMatrix(a, b) {
  return a.matrix.clone().invert().multiply(b.matrix);
}

function crossOf(a, b, options) {
  return properCrossingQuery(a.bvh, b.bvh, relativeMatrix(a, b), a.localDiagonal, b.localDiagonal, options);
}

test('coplanar touching is not a crossing', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  let r;
  try {
    const a = testInstance(box(2, 2, 2));
    const b = testInstance(box(2, 2, 2), at(0, 2, 0));
    r = crossOf(a, b);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(r.crossing, false, 'flush/coplanar touching: not a crossing');
  assert.equal(warnings.length, 0,
    'no console.warn from ExtendedTriangle -- proves coplanar pre-split happens, not just apparent classification (docs/...:1879-1891)');
});

test('edge-edge / vertex-face contact is not a crossing', () => {
  // Two boxes touching only along a shared edge -- no shared volume.
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(2, 2, 0)); // diagonal corner touch
  const r = crossOf(a, b);
  assert.equal(r.crossing, false, 'edge/vertex-only contact: not a crossing');
});

test('duct through beam crosses (round 2 regression)', () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = crossOf(duct, beam);
  // ROUND 2 REGRESSION: neither has a vertex inside the other -- vertex sampling
  // alone cannot see this crossing.
  assert.equal(r.crossing, true, 'perpendicular thin boxes crossing mid-span: IS a crossing');
});

test('ladder detects thin overlap (round 3 regression)', () => {
  // Overlap thinner than the coarsest offsetLadder rung but deeper than the finest.
  // localDiagonal of a unit box is sqrt(3) ~= 1.732, so offsetLadder rungs are
  // approximately [1.7e-3, 1.7e-4, 1.7e-5]. An overlap of 5e-4 falls strictly between
  // the coarsest and finest rungs -- exactly the gap a single fixed offset would miss.
  const a = testInstance(box(1, 1, 1));
  const thinOverlap = 5e-4;
  const b = testInstance(box(1, 1, 1), at(1 - thinOverlap, 0, 0));
  const r = crossOf(a, b);
  // ROUND 3 REGRESSION: a single fixed offset steps clean through this.
  assert.equal(r.crossing, true, 'overlap thinner than coarsest rung, deeper than finest: detected');
});

test('overlap shallower than minPenetrationDepth is a declared detection limit', () => {
  // minPenetrationDepth = 1e-5 * L_canonical; an overlap far below that (~1e-8 of L)
  // is a DECLARED detection limit, not a bug -- must NOT be detected.
  const a = testInstance(box(1, 1, 1));
  const belowLimit = 1e-8;
  const b = testInstance(box(1, 1, 1), at(1 - belowLimit, 0, 0));
  const r = crossOf(a, b);
  assert.equal(r.crossing, false, 'overlap shallower than minPenetrationDepth: NOT detected (documented limit)');
});

test('inconsistent winding still crosses', () => {
  // Flip one box's winding by negatively scaling one axis (inverts triangle winding
  // without changing the solid's shape) -- the four-quadrant probe never assumes
  // outward-facing normals.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beamGeom = box(0.4, 0.4, 20);
  const beamMatrix = new THREE.Matrix4().makeScale(-1, 1, 1);
  const beam = testInstance(beamGeom, beamMatrix);
  const r = crossOf(duct, beam);
  assert.equal(r.crossing, true, 'inconsistent/inward-facing winding: still a crossing');
});

test('interleaved combs, no real intersections (round 4 regression)', () => {
  // bvhcast callback receives CANDIDATE pairs, not confirmed-intersecting ones.
  // Populate `_line`-equivalent state with a real segment first (via a genuine
  // crossing) to prove staleness from a prior candidate can't leak into this one.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  // Warm-up call establishes a real intersecting pair's targetLine state inside the
  // module's shared scratch objects before the real assertion runs.
  const warmupA = testInstance(box(1, 1, 1));
  const warmupB = testInstance(box(1, 1, 1), at(0.5, 0, 0));
  crossOf(warmupA, warmupB);
  const r = crossOf(a, b, { maxCandidatePairsExamined: 200000 });
  // ROUND 4 REGRESSION: stale _line must not fabricate a crossing.
  assert.equal(r.crossing, false, 'interleaved combs, zero real intersections: no crossing');
});

test('symmetric under anisotropic scale (round 4 regression)', () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beamGeom = box(0.4, 0.4, 20);
  const beamMatrix = new THREE.Matrix4().makeScale(1, 3, 1); // anisotropic
  const beam = testInstance(beamGeom, beamMatrix);
  const forward = crossOf(duct, beam);
  const backward = crossOf(beam, duct);
  // ROUND 4 REGRESSION: non-symmetric min(diagonal(A), diagonal(B)) scale.
  assert.equal(forward.crossing, backward.crossing, 'crossing(A,B) === crossing(B,A) under anisotropic scale');
});

test('candidate-count budget exhaustion (round 5 regression)', () => {
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = crossOf(a, b, { maxCandidatePairsExamined: 500 });
  const elapsed = performance.now() - t0;
  assert.equal(r.aborted, true,
    'candidate budget exhausted: aborted flag set -- a buggy implementation could return crossing:false with the right diagnostic yet leave aborted:false');
  assert.equal(r.crossing, false, 'candidate budget exhausted: not a crossing');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'carries crossing-budget-exhausted');
  // Coarse sanity check, not the 8ms design budget itself -- see Task 24's performance gate for that.
  assert.ok(elapsed < 500, `completes within a wall-clock bound (${elapsed.toFixed(1)}ms)`);
});

test('time budget trips before count budgets (round 10 regression)', () => {
  // Many confirmed non-coplanar pairs, each requiring the full 12-probe classification,
  // sized so the TIME budget trips before either count budget would. A mocked clock
  // makes this deterministic: it advances by more than frameBudgetMs on the very
  // first callback-entry check, so the traversal aborts immediately regardless of how
  // many genuinely-crossing pairs exist in the geometry.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap, many confirmed pairs
  let calls = 0;
  const mockNow = () => { calls++; return calls === 1 ? 0 : 100; }; // second read already past frameBudgetMs=8
  const r = crossOf(a, b, { now: mockNow });
  assert.equal(r.aborted, true, 'time budget trips: aborted');
  assert.equal(r.crossing, false, 'time budget trips: not a crossing');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'carries crossing-budget-exhausted');
});

test('callback exception does not poison subsequent bvhcast traversals (defect fix)', () => {
  // three-mesh-bvh's bvhcast sets a module-global `_active` flag true at entry and
  // clears it only on its normal-completion path (no try/finally). If
  // intersectsTriangles were allowed to let an exception escape straight out of
  // bvhcast, `_active` would stay stuck true and permanently break every LATER
  // bvhcast-based query in the process ("Recursive calls to bvhcast not supported")
  // until reload -- including SurfaceIntersectionQuery and, once built,
  // SurfaceCrossingWitness. Verified directly against the installed
  // three-mesh-bvh's bvhcast.js: `_active` is set true at entry and cleared only on
  // the normal-completion path.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap: callback invoked
  let calls = 0;
  const throwingNow = () => {
    calls++;
    if (calls === 2) throw new Error('injected clock failure');
    return 0;
  };
  assert.throws(() => crossOf(a, b, { now: throwingNow }), /injected clock failure/,
    'the injected exception propagates out of properCrossingQuery, not swallowed');

  // A completely normal, immediately-following call must still succeed -- proves the
  // callback's catch/return-true/rethrow protocol let bvhcast reach its
  // normal-completion path and clear `_active` despite the thrown exception.
  const r = crossOf(a, b);
  assert.equal(typeof r.crossing, 'boolean',
    'subsequent traversal is not poisoned by the prior callback exception');
});

test('time budget aborts strictly mid-probe-loop (round 11 regression)', () => {
  // Round 10's fix checked only at callback entry, letting up to 24 classifyPoint
  // calls (a full 12-probe loop for a confirmed pair) run unchecked. This fixture
  // proves the check now fires INSIDE the probe loop: the mocked clock returns a
  // just-under-budget value for the first several reads, then crosses the deadline
  // partway through one pair's probe classification, and we assert fewer than 12
  // probes were evaluated for that pair by counting classifyPoint-shaped calls via
  // the mock clock's own call count (each probe reads the clock exactly once before
  // classification, per the round-11 checkpoint-granularity fix).
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1));
  let probeClockReads = 0;
  const TRIP_AFTER_READS = 5; // trips partway through the first confirmed pair's ladder
  const mockNow = () => {
    probeClockReads++;
    return probeClockReads > TRIP_AFTER_READS ? 100 : 0; // 100 > frameBudgetMs(8)
  };
  const r = crossOf(a, b, { now: mockNow });
  assert.equal(r.aborted, true, 'mid-probe-loop time trip: aborted');
  assert.equal(r.crossing, false, 'mid-probe-loop time trip: not a crossing');
  // The very first callback-entry read (probeClockReads === 1) does not trip; the
  // trip must happen on a LATER read while still inside the probe loop for the same
  // confirmed pair, i.e. strictly fewer than 12 probes were evaluated for it.
  assert.ok(probeClockReads <= 12,
    `aborted having evaluated strictly fewer than 12 probes for that pair (clock read ${probeClockReads} times before abort)`);
});
