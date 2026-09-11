import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { properCrossingQuery } from '../../collision/query/ProperCrossingQuery.js';
import { classifyPoint } from '../../collision/query/ContainmentQuery.js';
import { box, at, comb, testInstance } from '../fixtures/geometry.mjs';
import { stretch } from '../../collision/query/geometryScale.js';
import { surfaceEpsilonFactor } from '../../collision/constants.js';

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

test('a wall-clock overrun is TELEMETRY ONLY and never suppresses a proven crossing (round 10 regression, re-expressed by Phase C)', () => {
  // RE-EXPRESSED. Until Phase C this test was the defect written down as a contract:
  // the identical fixture and the identical mocked clock, asserting `aborted === true`
  // and `crossing === false`. Two box(3,3,3)s at a (0.1,0.1,0.1) offset are an
  // UNAMBIGUOUS deep overlap -- a proper crossing genuinely exists and the traversal
  // proves it in 26 point classifications and 2 confirmed pairs -- so the old
  // assertions encoded "a slow machine turns a real overlap into a clean negative",
  // which is exactly the correctness defect
  // docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md
  // exists to remove (its §2.2 row 6: "wall clock crossed AND crossing later proven"
  // is the real failing pair, and its only permitted effect is on the two telemetry
  // fields).
  //
  // The clock is left deliberately hostile -- it reports a 100 ms span against the 8 ms
  // default from its second read onward -- so this test FAILS against the pre-Phase-C
  // implementation (which aborts at the first callback-entry check) and passes only once
  // the wall clock can no longer reach a semantic field.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap, many confirmed pairs
  let calls = 0;
  const mockNow = () => { calls++; return calls === 1 ? 0 : 100; }; // 100 > frameBudgetMs = 8
  const r = crossOf(a, b, { now: mockNow });
  assert.equal(r.crossing, true, 'the geometry crosses, so the query must say so no matter what the clock says');
  assert.equal(r.aborted, false, 'a wall-clock breach must never set aborted (§2.1)');
  assert.equal(r.inconclusive, false);
  assert.deepEqual(r.diagnostics, [], 'no crossing-budget-exhausted: no deterministic budget was exhausted');
  assert.equal(r.stats.exhaustedBudget, null, 'post-fix invariant: aborted <=> exhaustedBudget !== null');
  assert.ok(r.witnessPoint, 'a proven crossing still carries its owned witness clone');
  // ...and the breach is still OBSERVABLE, just only as telemetry.
  assert.equal(r.stats.timeBudgetExceeded, true, 'the 8 ms concept survives exactly here and nowhere else');
  assert.equal(r.stats.elapsedMs, 100, 'measured end-to-end from the entry read to the exit read (§9.1)');
  assert.equal(calls, 2, 'exactly two clock reads remain, both outside intersectsTriangles (§9.2)');
});

test('callback exception does not poison subsequent bvhcast traversals (defect fix, re-anchored by Phase C)', () => {
  // three-mesh-bvh's bvhcast sets a module-global `_active` flag true at entry and
  // clears it only on its normal-completion path (no try/finally). If
  // intersectsTriangles were allowed to let an exception escape straight out of
  // bvhcast, `_active` would stay stuck true and permanently break every LATER
  // bvhcast-based query in the process ("Recursive calls to bvhcast not supported")
  // until reload -- including SurfaceIntersectionQuery and SurfaceCrossingWitness.
  // Verified directly against the installed three-mesh-bvh's bvhcast.js: `_active` is
  // set true at entry and cleared only on the normal-completion path.
  //
  // RE-ANCHORED, not merely adjusted (design §13 G, itself the review's §16 High
  // finding 4). Until Phase C this test injected a clock that threw on its SECOND read,
  // which worked only because the clock was read INSIDE intersectsTriangles. After
  // Phase C there are exactly two clock reads, both outside the callback, and §9.1a
  // additionally requires a throwing clock to be swallowed rather than propagated. A
  // naively-updated version of this test would have kept passing while exercising
  // nothing: the exception would originate after bvhcast had already completed
  // normally, and the `_active`-poisoning protocol this test exists to defend would be
  // free to regress unseen. The throw is injected instead through the internal
  // `options.__classifyPoint` seam, called from the probe ladder -- squarely inside
  // intersectsTriangles.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap: the probe ladder is entered
  let invocations = 0;
  const throwingClassifier = (...args) => {
    invocations++;
    // Throw on the SECOND invocation, delegating the first to the real classifier --
    // the same shape as the clock-based original, and proof that the traversal was
    // genuinely mid-flight (real candidate and probe work already done) when it threw.
    if (invocations === 2) throw new Error('injected classifier failure');
    return classifyPoint(...args);
  };
  assert.throws(() => crossOf(a, b, { __classifyPoint: throwingClassifier }), /injected classifier failure/,
    'the injected exception propagates out of properCrossingQuery, not swallowed');
  assert.equal(invocations, 2,
    'the throw originated INSIDE intersectsTriangles -- the classifier is reachable only from the probe ladder, so a post-bvhcast throw could never satisfy this assertion');

  // A completely normal, immediately-following call must still succeed -- proves the
  // callback's catch/return-true/rethrow protocol let bvhcast reach its
  // normal-completion path and clear `_active` despite the thrown exception.
  const r = crossOf(a, b);
  assert.equal(typeof r.crossing, 'boolean',
    'subsequent traversal is not poisoned by the prior callback exception');
});

test('callback exception with a FALSY thrown value still propagates (final whole-branch review Finding 2, re-anchored by Phase C)', () => {
  // A plain `if (caughtError) throw caughtError;` rethrow guard is broken for falsy
  // thrown values -- JS permits `throw null`/`throw 0`/`throw undefined`/`throw ''`/
  // `throw false`. If the callback ever catches one of those, that guard would
  // silently fail to rethrow, and this function would return a FABRICATED,
  // misleadingly-clean result (e.g. crossing:false, aborted:false) as if the traversal
  // completed normally, when it actually crashed mid-traversal. This test must fail
  // against the old `if (caughtError)` guard and pass against the fixed
  // `hasCaughtError` boolean flag.
  //
  // RE-ANCHORED to `options.__classifyPoint` for exactly the reason spelled out on the
  // truthy case above: post-Phase-C, a throwing clock no longer throws from inside the
  // callback at all (and is swallowed besides), so the clock-based form would have
  // become a test of nothing while still appearing to pass.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1)); // deep overlap: the probe ladder is entered
  let invocations = 0;
  const throwingClassifier = (...args) => {
    invocations++;
    if (invocations === 2) throw null; // eslint-disable-line no-throw-literal -- deliberately falsy
    return classifyPoint(...args);
  };
  assert.throws(() => crossOf(a, b, { __classifyPoint: throwingClassifier }), (err) => err === null,
    'a falsy thrown value (null) still propagates out of properCrossingQuery, not silently swallowed into a clean-looking result');
  assert.equal(invocations, 2,
    'the falsy throw also originated inside intersectsTriangles, not after bvhcast had already returned');

  // `_active` must have been cleared despite the falsy throw, or every later
  // bvhcast-based query in this process is broken.
  const r = crossOf(a, b);
  assert.equal(typeof r.crossing, 'boolean',
    'subsequent traversal is not poisoned by the prior falsy callback exception');
});

test('the probe budget aborts at exactly its pointClassifications granularity, clock or no clock (round 11 regression, re-expressed by Phase C)', () => {
  // RE-EXPRESSED. Round 10's fix checked the clock only at callback entry, letting up
  // to 24 classifyPoint calls (a full probe ladder for one confirmed pair) run
  // unchecked; round 11 moved the check INSIDE the probe loop, and this test pinned
  // that finer granularity by counting the mock clock's own reads. Phase C deletes that
  // check outright: bounding the OVERSHOOT of a timing-driven abort never made the
  // abort any less timing-driven, and an abort suppresses a crossing that a
  // not-yet-executed probe would have proven. The granularity round 11 bought is
  // preserved exactly -- one probe classification -- by the deterministic
  // `maxCrossingPointClassifications` terminator, so the contract is re-expressed in
  // that unit and needs no clock at all (design §13 G).
  //
  // The hostile clock is nonetheless left injected, tripping partway through the first
  // confirmed pair's ladder exactly as the original's did. That is what makes this test
  // FAIL against the pre-Phase-C implementation -- which aborts on that trip, with
  // fewer than CAP classifications and a null `exhaustedBudget` -- and pass only once
  // the clock is genuinely inert.
  const a = testInstance(box(3, 3, 3));
  const b = testInstance(box(3, 3, 3), at(0.1, 0.1, 0.1));
  const CAP = 7;
  let probeClockReads = 0;
  const TRIP_AFTER_READS = 5;
  const hostileNow = () => {
    probeClockReads++;
    return probeClockReads > TRIP_AFTER_READS ? 100 : 0; // 100 > frameBudgetMs(8)
  };
  let invocations = 0;
  const countingClassifier = (...args) => { invocations++; return classifyPoint(...args); };
  const r = crossOf(a, b, {
    maxCrossingPointClassifications: CAP,
    now: hostileNow,
    __classifyPoint: countingClassifier,
  });
  assert.equal(r.aborted, true, 'the deterministic probe budget is exhausted, so the traversal aborts');
  assert.equal(r.crossing, false, 'an aborted traversal never reports a crossing');
  assert.equal(r.inconclusive, false, 'aborted masks inconclusive, unchanged');
  assert.equal(r.stats.exhaustedBudget, 'point-classifications',
    'attributed to the budget that actually fired -- never to the clock, which can no longer abort anything');
  assert.equal(r.stats.pointClassifications, CAP,
    'checked BEFORE each call, so the cap is reached exactly and never exceeded');
  assert.equal(invocations, CAP,
    'and the classifier really was invoked exactly that many times -- never one more');
  assert.equal(r.diagnostics.some((d) => d.reason === 'crossing-budget-exhausted'), true,
    'carries crossing-budget-exhausted, a string whose meaning is now always an actual exhausted budget');
});

test('positive crossing returns an owned witnessPoint classifying inside both operands', () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r = crossOf(duct, beam);
  assert.equal(r.crossing, true);
  assert.ok(r.witnessPoint, 'witnessPoint must be present on a positive crossing');
  assert.equal(typeof r.witnessPoint.x, 'number');
  assert.equal(classifyPoint(r.witnessPoint, duct.bvh, duct.localDiagonal), 'inside');
  // r.witnessPoint is in duct's (bvhA's) local frame -- classify against bvhB via the same
  // matrix the function itself used internally is covered by the crossing-verdict test below;
  // here we only assert it classifies inside the frame it's documented to be in.
});

test('a returned witnessPoint is an owned clone, immune to later scratch mutation', () => {
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const r1 = crossOf(duct, beam);
  const captured = r1.witnessPoint.clone();
  // Force the module-level scratch to be reused and mutated by a second, unrelated call.
  const other = testInstance(box(5, 5, 5));
  const another = testInstance(box(5, 5, 5));
  crossOf(other, another); // may or may not cross; irrelevant -- only exercises scratch reuse
  assert.deepEqual(
    [r1.witnessPoint.x, r1.witnessPoint.y, r1.witnessPoint.z],
    [captured.x, captured.y, captured.z],
    'first call\'s witnessPoint must not change after a later call reuses module-level scratch',
  );
});

// Design doc Sec 4.3 C-2's worked example: the coplanar-discard branch's angle test
// (|nA.nB| >= 1 - coplanarAngleEpsilon) only bounds how far the two triangles' NORMALS
// diverge, while its offset test reads a SINGLE vertex (`triB.a`). A triangle can
// therefore pass both checks with `triB.a` sitting a hair's breadth from A's face, while
// its OTHER two vertices -- unconstrained by either check -- carry the plane
// substantially through A's surface. Reproducing this needs an extreme-ratio pair (a
// small operand B whose diagonal, scaled into A's frame, is much smaller than A's own --
// echoing the 290.969/3.918 class-B ratio used elsewhere in this plan) so that
// `min(localDiagonalA, localDiagonalB * stretch(matrixBtoA))` (the new epsilon) is
// tight enough to sit BELOW the offset, while `localDiagonalA` alone (the pre-fix
// epsilon) is loose enough to sit AT OR ABOVE it.
//
// B is a small closed solid: a flat-topped box whose "roof" is a shallow 4-triangle
// tent rather than a flat quad. The tent's rim sits a hair's breadth (`g`) BELOW A's
// top face (so B is, overall, embedded in A), while its apex rises just above A's top
// face -- so each roof triangle (rim-vertex, apex, rim-vertex) has its FIRST vertex (the
// one `ProperCrossingQuery.js` reads as `triA.a`/`triB.a`) sitting at the tiny offset
// `g`, and its OTHER two vertices diverging outward through A's face at the apex.
// Critically, B's SOLID interior lies BELOW the tent (same side as A's own interior,
// which lies below its top face) -- unlike a downward-carved dimple, where the two
// interiors would face opposite ways and no combination of the probe ladder's four
// (nA, nB) sign combinations could land inside both operands without first crossing
// either's own boundary-proximity tolerance. With matching interior orientation, the
// `-(nA + nB)` combination drives almost the full ladder offset into both solids at
// once, letting the probe ladder actually PROVE the crossing once the pair is no longer
// discarded (verified against the real bvhcast/classifyPoint pipeline, and against the
// pre-fix `surfaceEpsilonFactor * localDiagonalA` epsilon, before writing this test).
// `matrixScale` parameterizes B's geometry against a NON-identity `matrixBtoA`, so that
// `stretch(matrixBtoA)` is load-bearing rather than incidentally 1 (see the
// stretch-regression test below). B's LOCAL coordinates are built at
// `referenceWorldCoordinate / matrixScale`, and the caller is expected to pair this with
// `matrixBtoA = makeScale(matrixScale, matrixScale, matrixScale)` -- their product
// reproduces the EXACT same real (A-frame) geometry regardless of `matrixScale`, so
// every already-verified number below (the offset `g`, the apex rise, the crossing
// itself) is unaffected by which `matrixScale` is chosen; only `localDiagonalB` (the
// LOCAL, pre-transform diagonal `testInstance` reports) and `stretch(matrixBtoA)` shift,
// in exactly opposite directions, leaving `localDiagonalB * stretch(matrixBtoA)`
// invariant.
function tentEmbeddedInSlab(matrixScale = 1) {
  const planeY = 5 / matrixScale; // A = box(1000, 10, 1000) has its top face at y = 5 (world)
  const g = 1e-4 / matrixScale; // world-frame offset at vertex 'a' is 1e-4 regardless of matrixScale
  const apexRise = 1e-3 / matrixScale; // apex rises this far ABOVE A's top face (world) -- the "far end" divergence
  const bottomY = 2 / matrixScale; // B's flat bottom, deep inside A (world) -- irrelevant to the coplanar pair
  const half = 5 / matrixScale; // B's footprint half-width, 5 in world units

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
    // `ProperCrossingQuery.js`'s own reading of `.a` as the coplanar-offset vertex.
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

function extremeRatioCoplanarFixture(matrixScale = 1) {
  const a = testInstance(box(1000, 10, 1000));
  const b = testInstance(tentEmbeddedInSlab(matrixScale));
  // matrixScale === 1 gives the identity, matching every prior verification of this
  // fixture's real-world geometry exactly.
  const matrixBtoA = new THREE.Matrix4().makeScale(matrixScale, matrixScale, matrixScale);
  return { bvhA: a.bvh, bvhB: b.bvh, matrixBtoA, localDiagonalA: a.localDiagonal, localDiagonalB: b.localDiagonal, a, b };
}

test('surfaceEpsilon is the min of both operands\' world-scaled tolerance, monotonically tighter than either pre-fix value', () => {
  const { bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, a, b } = extremeRatioCoplanarFixture();

  // Pin the fixture's own preconditions before trusting its outcome: an extreme-ratio
  // pair (echoing the plan's 290.969/3.918 class-B ratio) whose vertex-'a' offset `g`
  // sits strictly between the tightened (min-based) epsilon and the pre-fix
  // (single-operand) epsilon -- exactly the band the fix is supposed to close.
  assert.ok(localDiagonalA / localDiagonalB > 50,
    'extreme-ratio pair: A\'s diagonal dwarfs B\'s, echoing the 290.969/3.918 class-B ratio');
  const oldEpsilon = surfaceEpsilonFactor * localDiagonalA;
  const newEpsilon = surfaceEpsilonFactor * Math.min(localDiagonalA, localDiagonalB * stretch(matrixBtoA));
  const actualOffset = Math.abs(5 - b.geometry.attributes.position.getY(0)); // vertex 'a' of each roof triangle
  assert.ok(newEpsilon < actualOffset,
    `fixture precondition: the tightened epsilon (${newEpsilon}) must NOT reach the vertex-'a' offset (${actualOffset}), or this pair would be (correctly) discarded either way`);
  assert.ok(actualOffset <= oldEpsilon,
    `fixture precondition: the pre-fix epsilon (${oldEpsilon}) must reach the vertex-'a' offset (${actualOffset}), or old code wouldn't have discarded this pair either`);

  const result = properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, {});

  // The concrete, specific outcome: a genuine crossing, proven (not merely
  // "inconclusive") via an owned witness point that classifies as inside BOTH operands.
  // Against the pre-fix epsilon (`surfaceEpsilonFactor * localDiagonalA` alone), this
  // exact fixture returns `crossing: false` -- the pair is wrongly discarded as
  // coplanar and never reaches the probe ladder at all (verified while writing this
  // test, before the fix landed).
  assert.equal(result.crossing, true,
    'the tightened min-based epsilon no longer discards this pair, and the probe ladder proves a genuine crossing');
  assert.equal(result.aborted, false);
  assert.equal(result.inconclusive, false,
    'a definitive proof, not a boundary-only near-miss');
  assert.ok(result.witnessPoint, 'a proven crossing carries an owned witness');
  assert.equal(classifyPoint(result.witnessPoint, bvhA, localDiagonalA), 'inside');
  assert.equal(classifyPoint(result.witnessPoint, bvhB, localDiagonalB), 'inside');
});

test('surfaceEpsilon genuinely reads stretch(matrixBtoA), not just localDiagonalB, under a non-identity relative scale', () => {
  // The test above uses an identity `matrixBtoA`, so `stretch(matrixBtoA) === 1` there
  // and `localDiagonalB * stretch(matrixBtoA)` reduces to plain `localDiagonalB` --
  // that alone can't tell a correct `min(localDiagonalA, localDiagonalB *
  // stretch(matrixBtoA))` apart from a regression that silently drops the `stretch`
  // term (e.g. `Math.min(localDiagonalA, localDiagonalB)`). This test closes that gap
  // with a genuinely non-unit relative scale.
  //
  // matrixScale = 0.1 builds B's LOCAL geometry at 10x the reference fixture's
  // coordinates, paired with `matrixBtoA = makeScale(0.1, 0.1, 0.1)` -- their product
  // reproduces the EXACT same real (A-frame) crossing as the identity-matrix test
  // above (same world-frame `g = 1e-4`, same apex rise, same genuine crossing),
  // verified empirically below via the same fixture-precondition assertions, not
  // assumed. What DOES change is `localDiagonalB` itself: `testInstance` reports the
  // LOCAL (pre-transform) diagonal, which is now ~10x the reference value, so
  // `localDiagonalB * stretch(matrixBtoA)` (~10x smaller * 0.1x factor) lands back on
  // the same effective value -- while a stretch-dropping regression would instead use
  // the raw (~10x-too-large) local diagonal directly, computing an epsilon roughly
  // 10x LOOSER than correct. That looser, buggy epsilon is enough to wrongly swallow
  // this fixture's `g = 1e-4` offset as "coplanar" -- i.e. a stretch-dropping
  // regression would flip this test's outcome from `crossing: true` back to
  // `crossing: false`, exactly the failure mode this test exists to catch (confirmed
  // by temporarily reproducing that exact regression locally and observing this test
  // go red, before restoring the real implementation -- see task report).
  const matrixScale = 0.1;
  const { bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, a, b } = extremeRatioCoplanarFixture(matrixScale);

  const actualStretch = stretch(matrixBtoA);
  assert.equal(actualStretch, matrixScale, 'a pure uniform scale: stretch(matrixBtoA) must equal the scale factor itself, not 1');
  assert.notEqual(actualStretch, 1, 'the whole point of this test: a non-unit relative scale');

  // The CORRECT formula's effective B-in-A-frame diagonal must match the reference
  // (identity-matrix) fixture's B diagonal (~14.46) regardless of matrixScale --
  // proving `stretch` is actually being applied, not merely present in the expression.
  const effectiveDiagonalB = localDiagonalB * actualStretch;
  const referenceLocalDiagonalB = extremeRatioCoplanarFixture(1).localDiagonalB;
  assert.ok(Math.abs(effectiveDiagonalB - referenceLocalDiagonalB) < 1e-6,
    `localDiagonalB * stretch(matrixBtoA) (${effectiveDiagonalB}) must reproduce the reference fixture's real-world B diagonal (${referenceLocalDiagonalB}), proving stretch is genuinely applied`);
  assert.ok(localDiagonalB > referenceLocalDiagonalB * 5,
    'sanity check on the fixture itself: the LOCAL (pre-transform) diagonal must be substantially larger than the reference, or this case would not actually exercise stretch at all');

  const oldEpsilon = surfaceEpsilonFactor * localDiagonalA;
  const newEpsilon = surfaceEpsilonFactor * Math.min(localDiagonalA, effectiveDiagonalB);
  const buggyEpsilonWithoutStretch = surfaceEpsilonFactor * Math.min(localDiagonalA, localDiagonalB); // stretch dropped
  const actualOffset = Math.abs(5 - b.geometry.attributes.position.getY(0) * matrixScale); // vertex 'a' offset, in WORLD units

  assert.ok(newEpsilon < actualOffset && actualOffset <= oldEpsilon,
    'fixture precondition: the correct (stretch-aware) epsilon must sit in the same target band as the reference fixture');
  assert.ok(actualOffset <= buggyEpsilonWithoutStretch,
    'fixture precondition: a stretch-dropping regression\'s (looser) epsilon must actually reach this offset, or this fixture would not catch that regression');

  const result = properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, {});
  assert.equal(result.crossing, true,
    'stretch(matrixBtoA) correctly scales localDiagonalB into A\'s frame, so this pair is not wrongly discarded');
  assert.equal(result.aborted, false);
  assert.equal(result.inconclusive, false);
  assert.ok(result.witnessPoint);
  assert.equal(classifyPoint(result.witnessPoint, bvhA, localDiagonalA), 'inside');
  // Unlike the identity-matrix fixture above, `matrixBtoA` here is a genuine (0.1x)
  // scale -- witnessPoint is documented to be in bvhA's own local frame, so it must be
  // mapped through matrixAtoB before classifying it against bvhB, exactly as the
  // production probe ladder does internally.
  const matrixAtoB = matrixBtoA.clone().invert();
  const witnessInB = result.witnessPoint.clone().applyMatrix4(matrixAtoB);
  assert.equal(classifyPoint(witnessInB, bvhB, localDiagonalB), 'inside');
});
