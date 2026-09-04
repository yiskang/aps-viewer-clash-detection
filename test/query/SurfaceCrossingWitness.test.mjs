import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { surfaceCrossingWitness } from '../../collision/query/SurfaceCrossingWitness.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';

function witnessOf(source, target, options) {
  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
  return surfaceCrossingWitness(source.bvh, target.bvh, targetToSource, source.localDiagonal, target.localDiagonal, options);
}

test('budget exhaustion (shares interleaved-comb input)', () => {
  const source = testInstance(comb(0));
  const target = testInstance(comb(0.05));
  const t0 = performance.now();
  const r = witnessOf(source, target, { maxCandidatePairsExamined: 500 });
  const elapsed = performance.now() - t0;
  assert.equal(r.aborted, true, 'budget exhausted: aborted');
  assert.equal(r.witnessFound, false, 'aborted must not report a witness');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'carries crossing-budget-exhausted');
  // Coarse sanity check, not the 8ms design budget itself -- see Task 24's performance gate for that.
  assert.ok(elapsed < 500, `completes within a wall-clock bound (${elapsed.toFixed(1)}ms)`);
});

test('small-triangle per-triangle scaling (round 9 regression)', () => {
  // Target large enough that offsetLadder's rungs (had this module wrongly borrowed
  // them, as the spike's min(src.L, target.L) bug did) would be on the order of
  // 1e-3..1e-5 x L_target ~ 346, i.e. ~0.35..0.0035 -- far bigger than this source
  // triangle's own ~1.3e-3 extent, so every offsetLadder-scaled rung would fall
  // entirely outside the triangle. crossingProbeFractions x dAvail, recomputed from
  // THIS triangle's own size, must still find a witness.
  //
  // NOTE ON FIXTURE MAGNITUDE (adaptation, not a change of semantics): the task
  // brief's own embedded triangle coordinates ([-0.0005..+0.0005]-scale) were
  // verified, via a codex-advisor consult during this task's implementation, to be
  // numerically incapable of ever producing a witness under a correct implementation
  // of the spec'd algorithm (docs/...:2647-2663) -- the deepest reachable interior
  // probe at the largest crossingProbeFractions rung (0.5) falls short of
  // classifyPoint's surfaceEpsilon (1e-6 x targetLocalDiagonal = 3.464e-4 on this
  // target) by roughly 2x, regardless of implementation. This is a fixture-magnitude
  // authoring error in the brief, not an implementation defect: crossingProbeFractions
  // and surfaceEpsilonFactor are shared, already-locked project-wide constants
  // (collision/constants.js) this task must not alter. The triangle below is the
  // brief's same fixture uniformly scaled up 2.5x (extent ~1.25e-3 instead of
  // ~5e-4), independently verified (by the codex-advisor consult, against this
  // repo's real weld/BVH/query pipeline) to clear surfaceEpsilon with real margin at
  // the 0.5 rung while remaining far too small for offsetLadder's smallest
  // canonical-frame rung (~3.46e-3) to ever reach -- preserving the exact regression
  // this test exists to pin.
  const target = testInstance(box(200, 200, 200)); // face at x=100
  const tinyTriangle = new THREE.BufferGeometry();
  tinyTriangle.setAttribute('position', new THREE.Float32BufferAttribute([
    100 - 0.00125, 0, 0,
    100 + 0.00125, 0.00125, 0,
    100 + 0.00125, -0.00125, 0.002,
  ], 3));
  tinyTriangle.setIndex([0, 1, 2]);
  const source = testInstance(tinyTriangle);
  const r = witnessOf(source, target);
  assert.equal(r.witnessFound, true,
    'round-9 regression: the spike used min(src.L, target.L) instead of per-candidate dAvail');
});

test('shrunk further, no valid probe exists', () => {
  // Shrunk until dAvail is on the same order as surfaceEpsilon (1e-6 x L_target):
  // every probe that DOES stay inside the triangle still reads `boundary` against
  // target (never clears surfaceEpsilon), so no rung is ever a valid witness.
  const target = testInstance(box(200, 200, 200));
  const shrunkTriangle = new THREE.BufferGeometry();
  shrunkTriangle.setAttribute('position', new THREE.Float32BufferAttribute([
    100 - 0.0001, 0, 0,
    100 + 0.0001, 0.0001, 0,
    100 + 0.0001, -0.0001, 0.00015,
  ], 3));
  shrunkTriangle.setIndex([0, 1, 2]);
  const source = testInstance(shrunkTriangle);
  const r = witnessOf(source, target);
  assert.equal(r.witnessFound, false, 'shrunk further: no witness found');
  assert.equal(r.diagnostics.some((d) => d.reason === 'inconclusive-crossing'), true,
    'reports inconclusive-crossing, not silent no-witness');
});

test('large source triangle piercing a thin target: found (Batch-2 reconciliation regression)', () => {
  // BATCH-2 RECONCILIATION REGRESSION: crossingProbeFractions x dAvail is scaled ONLY
  // by the SOURCE triangle's own size -- it has no relationship to the TARGET's local
  // thickness in the probe direction. A large source triangle crossing a thin target
  // (here, this repo's own "realistic BIM aspect ratio" fixture, box(0.01, 10, 0.5),
  // ratio ~1000:1 -- well under maxLocalAspectRatio's 10,000 gate, so NOT excluded by
  // that guard) can, before this fix, have EVERY crossingProbeFractions rung overshoot
  // clean across the target's thin x-extent, landing confidently 'outside' past its
  // far face and never 'boundary' -- a silent false negative (witnessFound:false,
  // inconclusive:false). minSurfaceCrossingProbeFactor's extra source-frame-scaled
  // floor rung closes this for a target whose local thickness meaningfully exceeds
  // that floor.
  const target = testInstance(box(0.01, 10, 0.5));
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([
    -5, 0, -0.1,
     5, 0, -0.1,
     0, 0,  5,
  ], 3));
  tri.setIndex([0, 1, 2]);
  const source = testInstance(tri);
  const r = witnessOf(source, target);
  assert.equal(r.witnessFound, true,
    'batch-2 regression: large source triangle vs. thin target must not overshoot clean across it');
});

test('target thinner than even the new floor: inconclusive, not silently negative (Batch-2 reconciliation regression)', () => {
  // Companion to the above: when the target's local thickness in the probe direction
  // is below even minSurfaceCrossingProbeFactor x sourceLocalDiagonal, the new floor
  // rung ALSO overshoots -- this is a genuinely below-declared-floor case. The other
  // half of this fix (marking every confirmed non-coplanar crossing candidate that
  // exhausts all probes without a witness as inconclusive, not just ones with no valid
  // in-triangle probe or a boundary hit) ensures this still reports `inconclusive`
  // rather than reproducing the same silent-negative bug for below-floor thicknesses.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([
    -5000, 0, -0.1,
     5000, 0, -0.1,
        0, 0,  0.2,
  ], 3));
  tri.setIndex([0, 1, 2]);
  const source = testInstance(tri);
  // floorDelta (sourceLocalDiagonal ~= 10000, x 1e-5 ~= 0.1) exceeds this target's own
  // half-width (0.005) by 20x -- genuinely below the declared floor for this pair.
  const target = testInstance(box(0.01, 10, 0.5));
  const r = witnessOf(source, target);
  assert.equal(r.witnessFound, false, 'below declared floor: no witness found');
  assert.equal(r.inconclusive, true, 'below declared floor: inconclusive, not a confident negative');
  assert.equal(r.diagnostics.some((d) => d.reason === 'inconclusive-crossing'), true,
    'carries inconclusive-crossing');
});

test('coplanar candidates rejected', () => {
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0)); // flush touching
  const r = witnessOf(a, b);
  assert.equal(r.witnessFound, false, 'flush/coplanar touching: no witness');
});

test('reads the SHARED accumulator, not a private clock', () => {
  // Contrast with ProperCrossingQuery/SurfaceIntersectionQuery's private clocks: an
  // externally-supplied scheduler whose elapsedMs() ALREADY reports past-budget (as
  // if an earlier term in the same composite call had already spent the frame) must
  // abort this traversal immediately, on its very first candidate, with no local
  // grace period of its own.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const alreadyOverBudget = { elapsedMs: () => 100 }; // 100 > frameBudgetMs (8)
  const r = witnessOf(duct, beam, { scheduler: alreadyOverBudget });
  assert.equal(r.aborted, true,
    'externally-already-over-budget scheduler: aborts immediately -- proves this module reads an externally-owned shared clock, not a self-contained private one');
});

test('callback exception does not poison subsequent bvhcast traversals (defect fix)', () => {
  // three-mesh-bvh's bvhcast sets a module-global `_active` flag true at entry and
  // clears it only on its normal-completion path (no try/finally). If
  // intersectsTriangles were allowed to let an exception escape straight out of
  // bvhcast, `_active` would stay stuck true and permanently break every LATER
  // bvhcast-based query in the process ("Recursive calls to bvhcast not supported")
  // until reload. Verified directly against the installed three-mesh-bvh's
  // bvhcast.js: `_active` is set true at entry and cleared only on the
  // normal-completion path. This module reads options.scheduler.elapsedMs()
  // synchronously inside the callback -- a natural injection point for a throwing
  // dependency, mirroring ProperCrossingQuery's own `now` injection.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20)); // crossing: callback invoked
  let calls = 0;
  const throwingScheduler = {
    elapsedMs: () => {
      calls++;
      if (calls === 2) throw new Error('injected scheduler failure');
      return 0;
    },
  };
  assert.throws(() => witnessOf(duct, beam, { scheduler: throwingScheduler }), /injected scheduler failure/,
    'the injected exception propagates out of surfaceCrossingWitness, not swallowed');

  // A completely normal, immediately-following call (real fixtures, no injected
  // throw) must still succeed -- proves the callback's catch/return-true/rethrow
  // protocol let bvhcast reach its normal-completion path and clear `_active`
  // despite the thrown exception. This second call is the actual proof: it would
  // itself fail with "Recursive calls to bvhcast not supported" if `_active` were
  // still stuck.
  const r = witnessOf(duct, beam);
  assert.equal(typeof r.witnessFound, 'boolean',
    'subsequent traversal is not poisoned by the prior callback exception');
});
