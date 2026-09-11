// test/query/VolumeOverlapQuery.reloadStability.test.mjs
//
// Design basis: design doc §11 regression A (lines 838-857). Five reload-stability
// regressions, each an in-process stand-in for "the same physical pair, re-derived after
// a model reload, must get the SAME verdict regardless of which operand plays kernel-A" --
// a property Phase A's canonical-ordering fix (orientForCrossing, a total geometric order
// with no identity field at any rank) is supposed to guarantee.
//
// Task A4.1. Test-only: no production code changes in this task.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../../collision/scheduler.js';
import { stretch } from '../../collision/query/geometryScale.js';
import { orientForCrossing } from '../../collision/query/orientForCrossing.js';
import { surfaceEpsilonFactor } from '../../collision/constants.js';
import { testInstance, box, at } from '../fixtures/geometry.mjs';

// === A.1 — base reload-stability proxy ===========================================================

test('A.1 — operand order exchange (in-process stand-in for reload-induced geometryIndex permutation) does not change overlap/conclusive/inconclusiveCauses/diagnostics reason multiset', async () => {
  const pairs = [
    [testInstance(box(290.969, 1, 1)), testInstance(box(3.918, 1, 1))], // class-B ratio, F6
    [testInstance(box(3000, 1, 1)), testInstance(box(4.243, 1, 1))],    // ductThroughBeam ratio, F12
  ];
  for (const [a, b] of pairs) {
    const forward = await volumeOverlapQuery(a, b);
    const backward = await volumeOverlapQuery(b, a);
    assert.equal(forward.overlap, backward.overlap);
    assert.equal(forward.conclusive, backward.conclusive);
    assert.deepEqual(
      [...(forward.inconclusiveCauses ?? [])].sort(),
      [...(backward.inconclusiveCauses ?? [])].sort(),
    );
    assert.deepEqual(
      forward.diagnostics?.map((d) => d.reason).sort(),
      backward.diagnostics?.map((d) => d.reason).sort(),
    );
  }
});

// === A.2 — world-space diagonal ranking, not local ================================================

test('A.2 — rank 1 uses WORLD diagonal: a scaled small-local-diagonal operand still orients first when its world diagonal is larger', async () => {
  const scaleMatrix = new THREE.Matrix4().makeScale(200, 200, 200);
  const smallLocalLargeWorld = testInstance(box(1, 1, 1), scaleMatrix); // local diag ~1.732, world diag ~346.4
  const largeLocalSmallWorld = testInstance(box(100, 1, 1));            // local diag ~100.01, no scale, world diag ~100.01

  // Verify the fixture's own real arithmetic before trusting the outcome: the SCALED
  // small box's world diagonal must exceed the unscaled larger box's world diagonal, or
  // this fixture proves nothing about world-vs-local ranking.
  assert.ok(
    smallLocalLargeWorld.localDiagonal < largeLocalSmallWorld.localDiagonal,
    'fixture precondition: smallLocalLargeWorld must have the SMALLER local diagonal',
  );
  const smallWorldDiagonal = smallLocalLargeWorld.localDiagonal * stretch(scaleMatrix);
  const largeWorldDiagonal = largeLocalSmallWorld.localDiagonal * stretch(largeLocalSmallWorld.matrix);
  assert.ok(
    smallWorldDiagonal > largeWorldDiagonal,
    `fixture precondition: smallLocalLargeWorld's WORLD diagonal (${smallWorldDiagonal}) must exceed ` +
    `largeLocalSmallWorld's WORLD diagonal (${largeWorldDiagonal}), or this fixture cannot distinguish ` +
    `world-diagonal ranking from local-diagonal ranking`,
  );

  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    await volumeOverlapQuery(smallLocalLargeWorld, largeLocalSmallWorld, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
  } finally {
    clearDiagnosticEventRecorder();
  }

  // Swap-equality alone is a TAUTOLOGY here: after Phase A, forward/backward always make
  // the same kernel call regardless of which rank decided orientation, so it cannot
  // distinguish "rank 1 used world diagonal" from "rank 1 used local diagonal" (or any
  // other rank). Pin the ABSOLUTE outcome the world-diagonal rule requires instead, via
  // C-4's telemetry (Task A2.4).
  const crossingEvent = events.find((e) => e.payload?.stage === 'crossing')?.payload;
  assert.ok(crossingEvent, 'expected a hard-clash-precheck stage:crossing event');
  assert.equal(crossingEvent.orientationRank, 1);
  assert.equal(
    crossingEvent.orientedFirstRole, 'source',
    'smallLocalLargeWorld (the public source here) must win rank 1 on WORLD diagonal (346.4 > 100.01) ' +
    'despite losing on LOCAL diagonal (1.732 < 100.01) -- the assertion that would have caught a ' +
    'local-diagonal-only ranking bug',
  );
});

// === A.3 — thin-solid, extreme ratio (1e3-1e5) =====================================================

test('A.3 — a thin plate crossing a very large member at an extreme diagonal ratio is still detected under the large-first ladder', async () => {
  const largeMember = testInstance(box(100000, 10, 10)); // ratio ~1e4 against the plate below
  // Positioned so the plate genuinely crosses the member's surface (not just AABB-overlaps
  // it), following the same "poke through a face, sticking out on one side, embedded on
  // the other" idiom as ductThroughBeamFixture in test/CollisionWorld.findClashes.dispatch.test.mjs.
  // largeMember spans x:[-50000,50000], y:[-5,5], z:[-5,5]. thinPlate (box(10,10,0.5), so
  // x:[-5,5], y:[-5,5], z:[-0.25,0.25] before translation) is translated to (0, 2, 5.1):
  //   - x stays within [-5,5], strictly interior to largeMember's x range.
  //   - y becomes [-3,7]: partially inside largeMember's y:[-5,5] (from -3 to 5), partially
  //     sticking out above it (5 to 7) -- avoids the plate's y-extent being exactly flush
  //     with largeMember's own y bound (a degenerate coplanar-touch case).
  //   - z becomes [4.85,5.35]: straddles largeMember's top face (z=5) -- embedded below,
  //     protruding above.
  // The plate's own +x/-x side faces (at x=+-5, well interior to largeMember's x range) are
  // PERPENDICULAR to largeMember's top face plane (z=5) and span across it (z:[4.85,5.35]),
  // producing a genuine, non-coplanar (transversal) triangle-triangle crossing.
  const thinPlate = testInstance(box(10, 10, 0.5), at(0, 2, 5.1));

  // Fixture precondition (codex-advisor finding): largeMember's aspect ratio is exactly
  // 1e4 -- equal to, not merely under, the aspectRatioExceeded threshold (`> 10000` per
  // collision/constants.js's maxLocalAspectRatio) -- so this fixture sits exactly on that
  // boundary. Assert it explicitly rather than relying on the gate silently doing the
  // right thing, since a `>=` vs `>` regression there would degrade this fixture into the
  // synthetic aspect-ratio-skip branch instead of exercising the real crossing kernel.
  assert.equal(largeMember.aspectRatioExceeded, false,
    'fixture precondition: largeMember sits exactly at the 1e4 aspect-ratio threshold and must not be gated');

  const forward = await volumeOverlapQuery(largeMember, thinPlate);
  const backward = await volumeOverlapQuery(thinPlate, largeMember);
  assert.equal(forward.overlap, true, 'a genuine crossing at extreme ratio must not be lost under large-first orientation');
  assert.equal(backward.overlap, true);
  // codex-advisor finding: asserting only `overlap` leaves this fixture unable to tell a
  // genuine crossing-term detection apart from a containment-term rescue -- pin `via` and
  // the witness kind too, so a crossing-detection regression that happened to still trip
  // one of the containment terms cannot pass this test for the wrong reason.
  assert.equal(forward.via, 'crossing', 'this fixture is constructed to be a genuine surface crossing, not a containment rescue');
  assert.equal(backward.via, 'crossing');
  assert.equal(forward.witness?.kind, 'surface-crossing');
  assert.equal(backward.witness?.kind, 'surface-crossing');
});

// === A.4 — near-parallel thin-overlap, tightened-epsilon monotonicity =============================

// Duplicated from test/query/ProperCrossingQuery.test.mjs's own `tentEmbeddedInSlab` (Task
// A2.3's already-landed kernel-level regression for the identical epsilon defect) -- not
// exported from that file, so reproduced here verbatim rather than reaching into another
// test file's internals. Adapted to the WRAPPER level (volumeOverlapQuery) per this task's
// brief: A2.3 proved the tightened `min`-based coplanarity epsilon at the properCrossingQuery
// kernel level; this test proves the same fix is actually reachable end-to-end through
// volumeOverlapQuery's canonical-order-driven kernel call.
function tentEmbeddedInSlab() {
  const planeY = 5; // A = box(1000, 10, 1000) has its top face at y = 5 (world)
  const g = 1e-4; // world-frame offset at vertex 'a', between the tightened and pre-fix epsilon bands
  const apexRise = 1e-3; // apex rises this far ABOVE A's top face -- the "far end" divergence
  const bottomY = 2; // B's flat bottom, deep inside A -- irrelevant to the coplanar pair
  const half = 5; // B's footprint half-width

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -half, planeY - g, -half, // 0: rim
     half, planeY - g, -half, // 1: rim
     half, planeY - g,  half, // 2: rim
    -half, planeY - g,  half, // 3: rim
     0, planeY + apexRise, 0, // 4: apex, pokes above A's top face
    -half, bottomY, -half, // 5: bottom ring
     half, bottomY, -half, // 6: bottom ring
     half, bottomY,  half, // 7: bottom ring
    -half, bottomY,  half, // 8: bottom ring
  ], 3));
  geometry.setIndex([
    // Tent roof -- each triangle's FIRST index is a rim vertex, matching
    // ProperCrossingQuery.js's own reading of `.a` as the coplanar-offset vertex.
    0, 4, 1,  1, 4, 2,  2, 4, 3,  3, 4, 0,
    // Vertical sides, entirely below A's top face (never crosses it).
    0, 1, 6,  0, 6, 5,
    1, 2, 7,  1, 7, 6,
    2, 3, 8,  2, 8, 7,
    3, 0, 5,  3, 5, 8,
    // Flat bottom.
    5, 6, 7,  5, 7, 8,
  ]);
  return geometry;
}

test('A.4 — no crossing detectable under either pre-fix orientation is lost under the tightened coplanarity epsilon', async () => {
  // Extreme-ratio pair (localDiagonalA/localDiagonalB ~98:1, echoing the plan's
  // 290.969/3.918 class-B ratio, per Task A2.3's own already-verified fixture): the
  // near-parallel tent roof sits `g = 1e-4` above the slab's top face -- a value strictly
  // between the tightened min-epsilon and the looser pre-fix single-operand epsilon
  // (based on the slab's own, much larger, diagonal).
  const largeSlab = testInstance(box(1000, 10, 1000)); // top face at y = 5 (world)
  const tent = testInstance(tentEmbeddedInSlab());

  assert.ok(largeSlab.localDiagonal / tent.localDiagonal > 50,
    'extreme-ratio pair: the slab dwarfs the tent, echoing the 290.969/3.918 class-B ratio');
  const oldEpsilonSlabAsA = surfaceEpsilonFactor * largeSlab.localDiagonal;
  const oldEpsilonTentAsA = surfaceEpsilonFactor * tent.localDiagonal;
  const newEpsilon = surfaceEpsilonFactor * Math.min(largeSlab.localDiagonal, tent.localDiagonal * stretch(tent.matrix));
  const actualOffset = Math.abs(5 - tent.geometry.attributes.position.getY(0)); // vertex 'a' of each roof triangle
  assert.ok(newEpsilon < actualOffset,
    `fixture precondition: the tightened epsilon (${newEpsilon}) must NOT reach the offset (${actualOffset})`);
  assert.ok(actualOffset <= oldEpsilonSlabAsA,
    `fixture precondition: the pre-fix epsilon with the slab as kernel-A (${oldEpsilonSlabAsA}) must reach ` +
    `the offset (${actualOffset}) -- i.e. pre-fix code COULD have discarded this pair under ONE orientation`);
  assert.ok(actualOffset > oldEpsilonTentAsA,
    `fixture precondition: the pre-fix epsilon with the tent as kernel-A (${oldEpsilonTentAsA}) must NOT reach ` +
    `the offset (${actualOffset}) -- i.e. pre-fix code would have PROBED (and found) this pair under the OTHER ` +
    `orientation, making the pre-fix behavior orientation-dependent`,
  );

  // Swap equality alone is NOT the requirement here (the design doc's monotonicity claim
  // is about completeness, not symmetry) -- pin the ABSOLUTE outcome: the crossing must
  // be found, regardless of which physical argument order volumeOverlapQuery is called
  // with (canonical order internally is fixed either way by the world-diagonal rank).
  //
  // codex-advisor finding: pin `orientationRank`/`orientedFirstRole` (via the same
  // diagnostic-event provenance A.2 uses) so this test also proves the slab -- not the
  // tent -- consistently wins canonical-first regardless of call order, and pin
  // `via === 'crossing'` plus a nonzero `crossingPairsExamined` so a crossing-detection
  // regression that happened to get rescued by a containment term cannot pass this test
  // for the wrong reason.
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  let forward, backward;
  try {
    forward = await volumeOverlapQuery(largeSlab, tent, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    backward = await volumeOverlapQuery(tent, largeSlab, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
  } finally {
    clearDiagnosticEventRecorder();
  }
  const crossingEvents = events.filter((e) => e.payload?.stage === 'crossing').map((e) => e.payload);
  assert.equal(crossingEvents.length, 2);
  assert.equal(crossingEvents[0].orientationRank, 1);
  assert.equal(crossingEvents[1].orientationRank, 1);
  assert.equal(crossingEvents[0].orientedFirstRole, 'source', 'forward call: largeSlab is source and must win rank 1');
  assert.equal(crossingEvents[1].orientedFirstRole, 'target', 'backward call: largeSlab is now target and must STILL win rank 1');

  assert.equal(forward.overlap, true, 'the crossing beyond the tightened epsilon band must be found, not discarded as coplanar');
  assert.equal(backward.overlap, true);
  assert.equal(forward.via, 'crossing', 'this fixture is constructed to be a genuine crossing, not a containment rescue');
  assert.equal(backward.via, 'crossing');
  assert.ok(forward.stats.crossing.crossingPairsExamined > 0);
  assert.ok(backward.stats.crossing.crossingPairsExamined > 0);
});

// === A.5 — rank-5 digest collision fixture =========================================================

// A hand-built, closed 8-vertex/12-triangle cube (topology mirrors test/fixtures/geometry.mjs's
// own `openBottomedBox`, plus the bottom face it deliberately omits) -- built directly (not via
// box()+weld()) so a single corner's position can be perturbed WITHOUT risking an accidental
// vertex-count change through mergeVertices' welding tolerance. `dentZ` moves corner 6's z
// coordinate inward from `h` to `h - dentZ`; corners 2, 3, and 7 all independently still sit at
// z = h (and the analogous other-axis corners still sit at their own extremes), so the AABB --
// and therefore localDiagonal -- is provably unaffected by the perturbation.
function cube(h, dentZ = 0) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -h, -h, -h,          // 0
     h, -h, -h,          // 1
     h, -h,  h,          // 2
    -h, -h,  h,          // 3
    -h,  h, -h,          // 4
     h,  h, -h,          // 5
     h,  h,  h - dentZ,  // 6 (dented corner)
    -h,  h,  h,          // 7
  ], 3));
  geometry.setIndex([
    4, 5, 6,  4, 6, 7,   // top (+y)
    3, 2, 6,  3, 6, 7,   // +z
    1, 0, 4,  1, 4, 5,   // -z
    2, 1, 5,  2, 5, 6,   // +x
    0, 3, 7,  0, 7, 4,   // -x
    0, 2, 1,  0, 3, 2,   // bottom (-y), reversed winding from top
  ]);
  return geometry;
}

test('A.5 — two geometrically distinct meshes sharing diagonal/triangle-count/vertex-count/world-matrix are disambiguated by geometryDigest, and swapping them is bit-identical', async () => {
  const meshA = testInstance(cube(5, 0));   // plain cube
  const meshB = testInstance(cube(5, 1));   // same cube, corner 6 dented 1 unit inward on z -- AABB unaffected

  // The fixture's own preconditions, verified empirically before trusting the outcome:
  // ranks 1-4 (world diagonal, triangle count, vertex count, world matrix) must all
  // genuinely tie, or this fixture doesn't test what it claims to.
  assert.equal(meshA.localDiagonal, meshB.localDiagonal, 'fixture precondition: identical bounding diagonal (AABB provably unaffected by the dent)');
  assert.equal(meshA.geometry.index.count, meshB.geometry.index.count, 'fixture precondition: identical triangle count');
  assert.equal(meshA.geometry.attributes.position.count, meshB.geometry.attributes.position.count, 'fixture precondition: identical vertex count');
  assert.deepEqual(meshA.matrix.elements, meshB.matrix.elements, 'fixture precondition: identical (identity) world matrix');

  // Sanity-check the fixture itself BEFORE testing the wrapper: if geometryDigest is
  // undefined (see Task A1.2 Step 5's testInstance-forwarding fix -- required, not
  // optional, for this test to mean anything) this test would silently fall through to
  // rank 6 and pass for the wrong reason.
  assert.match(meshA.geometryDigest, /^[0-9a-f]{32}$/);
  assert.match(meshB.geometryDigest, /^[0-9a-f]{32}$/);
  assert.notEqual(meshA.geometryDigest, meshB.geometryDigest);

  // codex-advisor finding (required fix, not optional): the wrapper-level swap-equality
  // assertions below are satisfied even by a rank-6 (identity-based) tie-break -- verified
  // by codex forcing a rank-6 tie (equal digests) and observing this test's original
  // forward/backward assertions still pass identically. That means "Without rank 5 this
  // test is RED" was NOT actually true of the assertions as first written. Close the gap
  // by asserting orientForCrossing's rank directly, on both argument orders, and that both
  // orders resolve to the SAME physical operand as canonical-first -- this is the assertion
  // that only holds if rank 5 (not rank 6) is what decided the tie.
  const fwdOrientation = orientForCrossing(meshA, meshB);
  const bwdOrientation = orientForCrossing(meshB, meshA);
  assert.equal(fwdOrientation.rank, 5, 'ranks 1-4 must genuinely tie by construction, leaving rank 5 (geometryDigest) to decide');
  assert.equal(bwdOrientation.rank, 5);
  assert.equal(fwdOrientation.first, bwdOrientation.first,
    'the same physical operand must canonicalize first regardless of which argument order calls orientForCrossing -- ' +
    'a rank-6 (identity/argument-order-based) tie-break would fail this specific assertion, even though it could ' +
    'still satisfy the wrapper-level overlap/conclusive equality below',
  );

  const forward = await volumeOverlapQuery(meshA, meshB);
  const backward = await volumeOverlapQuery(meshB, meshA);
  assert.equal(forward.overlap, backward.overlap);
  assert.equal(forward.conclusive, backward.conclusive);
  // Without rank 5 (geometryDigest) this test is RED -- ranks 1-4 cannot discriminate
  // this pair (proven by the fwdOrientation/bwdOrientation assertions above, not merely
  // asserted in a comment), and it would fall to rank 6 (public source role), which the
  // digest assertions above rule out.
});
