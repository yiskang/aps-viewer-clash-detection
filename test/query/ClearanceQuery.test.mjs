import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearanceQuery, clearanceCrossCheckAllowedDisagreement } from '../../collision/query/ClearanceQuery.js';
import {
  clearanceUniformScaleRelativeTolerance,
  surfaceEpsilonFactor,
} from '../../collision/constants.js';
import { validateUniformScale } from '../../collision/query/ClearanceTransform.js';
import { box, at, testInstance, mergeGeometries } from '../fixtures/geometry.mjs';

// Local helper: an axis-aligned box translated to a given centre, for the multi-box clusters the
// scale-asymmetry fixtures below need (a single convex box can never exercise BVH-level pruning).
const boxAt = (w, h, d, x, y, z) => box(w, h, d).translate(x, y, z);

// Fixture 1: farther than clearance. Two 2x2x2 boxes, centers 10 apart on X -> exact face gap 8.
test('fixture 1: farther than clearance -> withinClearance:false, distance:null', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 2, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, false);
  assert.equal(result.distance, null);
});

// Fixture 3: slightly within threshold. Boxes at (0,0,0) and (2.5,0,0), clearance=1 -> gap 0.5.
test('fixture 3: slightly within threshold -> withinClearance:true, distance ~ 0.5', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2.5, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 0.5) < 1e-4);
  assert.ok(Array.isArray(result.witness.sourcePoint) && result.witness.sourcePoint.length === 3);
  assert.ok(Array.isArray(result.witness.targetPoint) && result.witness.targetPoint.length === 3);
  // Endpoints must actually be near the two facing faces (x~1 and x~1.5), not swapped/garbled.
  assert.ok(Math.abs(result.witness.sourcePoint[0] - 1) < 1e-3);
  assert.ok(Math.abs(result.witness.targetPoint[0] - 1.5) < 1e-3);
});

// Fixture 2: exactly at threshold (inclusive per spec's (floor, clearance] interval).
test('fixture 2: exactly at threshold -> withinClearance:true', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(3, 0, 0)); // face gap exactly 1
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-4);
});

// Fixture 4 / 13: surface touching / dead-band -> withinClearance:false.
test('fixture 4: touching surfaces (gap 0) -> withinClearance:false', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
  assert.ok(Math.abs(result.distance) < 1e-4);
});

test('fixture 13: dead-band gap below toleranceFloor -> withinClearance:false', () => {
  const gap = 1e-7;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2 + gap, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
});

// Fixture 7: rotated geometry, analytically known edge-to-face distance. Rotating the
// half-size-1 source cube's x/z cross-section by 45 deg puts its corner at (x=1,z=1) at local
// (sqrt2, 0) -- since rotation is only around Y, this is a full vertical edge (y in [-1,1]) at
// x=sqrt2, z=0, i.e. the source's maximum +X reach. Target left face sits at (X - 1); true gap is
// (X - 1) - sqrt2. Target center X = 2 + sqrt2 gives gap = 1 (independently confirmed via
// codex-advisor, which also ran this exact fixture and got the same distance). clearance is set
// above 1 (not exactly 1) so the test does not sit on the pinned API's own strict internal
// `score < maxThreshold` pruning boundary.
test('fixture 7: rotated source, analytically known minimum distance', () => {
  const rotated = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const source = testInstance(box(2, 2, 2), rotated);
  const target = testInstance(box(2, 2, 2), at(2 + Math.SQRT2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1.5, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-3);
});

// Fixture 16: uniform scale correctness, EQUAL scale — reported distance must be world-space.
test('fixture 16a: equal uniform scale, distance converted to world units', () => {
  const scaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), scaled); // local half-size 0.5, world half-size 1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // target half-size 1, face at x=3
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 16b (Critical #2 regression, Codex's own repro): UNEQUAL source/target scale. Source
// scale 2, target scale 1, true world gap 2, clearance 3 -- a naive single-source-derived
// maxThreshold (1.5) would wrongly return null here; the fix must find the real within-clearance hit.
test('fixture 16b: unequal source/target scale, distance still correct and within clearance', () => {
  const sourceScaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), sourceScaled); // world half-size 1, face at x=1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // scale 1, face at x=3 -- world gap 2
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 16c (Critical regression, post-review): SCALE-ASYMMETRIC MULTI-BOX pair. The pinned
// `closestPointToGeometry` is not symmetric in its two operands and its own NESTED target-side
// shapecast prunes with `score < closestDistance && score < maxThreshold` where `score` is in
// otherGeometry-local units while both right-hand sides are in bvh-local units (verified directly in
// node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry_indirect.generated.js:104-112 vs
// :121-123/:133). When the bvh operand has the LARGER scale that prune over-states distances and
// wrongly discards the genuinely-closest nodes -- a false negative. ClearanceQuery therefore always
// hands the SMALLER-scale operand to the API as the bvh side ("anchor") and maps the roles back.
//
// World layout (all numbers exact and hand-derivable):
//   source instance, scale 10, geometry in source-local units:
//     box A: local 1.5x2x2   at (1, 1.5, 0)     -> world 15x20x20 at (10,15,0): x 2.5..17.5, y 5..25,  z -10..10
//     box B: local 1.5x1x1.5 at (-1.5, 0.5, 0.5)-> world 15x10x15 at (-15,5,5): far away on -X
//   target instance, scale 1, translated +8 on X (target-local == world size):
//     box C: 1x1.5x2   at local (-1,0,0)   -> world at (7,0,0):   x 6.5..7.5,  y -0.75..0.75, z -1..1
//     box D: 1.5x0.5x2 at local (0.5,0,0.5)-> world at (8.5,0,0.5)
//   Closest pair is A's bottom face (y=5) against C's top face (y=0.75), with C fully inside A's x
//   and z spans, so the exact world minimum distance is 5 - 0.75 = 4.25.
// Before the fix this returned {withinClearance:false, distance:5.836...} at clearance 5 (and
// distance 29 -- a far-corner pair on box B -- with clearance unbounded). It also returned the
// CORRECT 4.25 when the same two instances were passed in the opposite argument order, which is the
// asymmetry this fixture pins down.
function scaleAsymmetricPair() {
  const sourceLocal = mergeGeometries([
    boxAt(1.5, 2, 2, 1, 1.5, 0),
    boxAt(1.5, 1, 1.5, -1.5, 0.5, 0.5),
  ]);
  const targetLocal = mergeGeometries([
    boxAt(1, 1.5, 2, -1, 0, 0),
    boxAt(1.5, 0.5, 2, 0.5, 0, 0.5),
  ]);
  return {
    big: testInstance(sourceLocal, new THREE.Matrix4().makeScale(10, 10, 10)),   // scaleFactor 10
    small: testInstance(targetLocal, new THREE.Matrix4().setPosition(8, 0, 0)),  // scaleFactor 1
  };
}

test('fixture 16c: larger-scale source + smaller-scale target -> true minimum found, not falsely pruned', () => {
  const { big, small } = scaleAsymmetricPair();
  const result = clearanceQuery(big, small, { clearance: 5, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 4.25) < 1e-6, `expected exact world gap 4.25, got ${result.distance}`);
  // Witness identity: sourcePoint must lie on the CALLER's source (box A's bottom face, world y=5),
  // targetPoint on the CALLER's target (box C's top face, world y=0.75) -- NOT swapped by the
  // internal anchor/far reordering (here the anchor is the caller's TARGET, so the remap is live).
  assert.ok(Math.abs(result.witness.sourcePoint[1] - 5) < 1e-6, `sourcePoint=${result.witness.sourcePoint}`);
  assert.ok(Math.abs(result.witness.targetPoint[1] - 0.75) < 1e-6, `targetPoint=${result.witness.targetPoint}`);
});

test('fixture 16c-mirror: the same pair in the opposite argument order gives the same distance and mirrored witness', () => {
  const { big, small } = scaleAsymmetricPair();
  const forward = clearanceQuery(big, small, { clearance: 5, toleranceFloor: 1e-9 });
  const reversed = clearanceQuery(small, big, { clearance: 5, toleranceFloor: 1e-9 });
  assert.equal(reversed.withinClearance, true);
  assert.equal(reversed.distance, forward.distance); // argument order must not change the geometry
  // Roles mirror exactly: the reversed call's sourcePoint is the forward call's targetPoint.
  assert.deepEqual(reversed.witness.sourcePoint, forward.witness.targetPoint);
  assert.deepEqual(reversed.witness.targetPoint, forward.witness.sourcePoint);
});

// Post-filter coverage: the ONLY fixture that reaches the final `worldDistance > clearance` guard.
// The pinned API never re-checks its own `maxThreshold` against the exact triangle-triangle distance
// it ultimately returns, and its nested traversal admits far-operand nodes using a score expressed in
// FAR-local units against a threshold expressed in ANCHOR-local units -- so when the far operand has
// the larger scale, bounds-level admission is looser than the final exact check by the scale ratio.
//   source: 2x2x2 box at the origin, scale 1  -> the anchor.
//   target: two 0.2-cubes at target-local y = +/-2, instance scale 10 -> world 2-cubes at y = +/-20.
// clearance 2 => maxThresholdLocal ~= 2 in anchor-local (== world) units. The target's overall bbox
// straddles the source so the OUTER traversal admits at score 0; in the NESTED traversal the source
// leaf maps to a +/-0.1 box in target-local units and the target leaf sits at target-local y 1.9..2.1,
// giving score ~1.8 < 2 -- admitted. The exact triangle distance is nevertheless 20 - 1 - 1 = 18
// world units. Only the explicit post-filter turns that into withinClearance:false; deleting it makes
// this fixture report withinClearance:true at distance 18 with clearance 2.
test('post-filter: a candidate admitted by bounds-level pruning but beyond clearance is rejected on its exact world distance', () => {
  const source = testInstance(box(2, 2, 2), new THREE.Matrix4());
  const targetLocal = mergeGeometries([
    boxAt(0.2, 0.2, 0.2, 0, 2, 0),
    boxAt(0.2, 0.2, 0.2, 0, -2, 0),
  ]);
  const target = testInstance(targetLocal, new THREE.Matrix4().makeScale(10, 10, 10));
  const clearance = 2;
  const result = clearanceQuery(source, target, { clearance, toleranceFloor: 1e-9 });
  assert.equal(result.aborted, undefined);
  assert.equal(result.withinClearance, false);
  // A finite distance (not null) strictly greater than `clearance` proves the traversal DID return a
  // candidate and that the exact-distance post-filter -- not `raw === null`, not the toleranceFloor
  // dead-band -- is what rejected it.
  assert.equal(typeof result.distance, 'number');
  assert.ok(result.distance > clearance, `expected distance > ${clearance}, got ${result.distance}`);
  assert.ok(Math.abs(result.distance - 18) < 1e-4, `expected exact world distance ~18, got ${result.distance}`);
});

// Traversal-threshold safety margin. Fixture 2 above ("exactly at threshold") used to pass only by
// luck: for a true world gap of exactly 1 the pinned library's bounds-level score comes out at
// 0.9999998807907106 -- 1.192e-7 under the strict `score < maxThreshold` boundary, i.e. EXACTLY one
// float32 epsilon (2^-23) of conservative node padding, not a numeric margin. maxThresholdLocal now
// carries an explicit `clearanceTraversalThresholdSafetyMargin` (4e-4, i.e. 4x
// `clearanceUniformScaleRelativeTolerance`), which per collision/constants.js's own note covers that
// float32 padding artefact by ~3300x (and the residual-anisotropy term with ~2x headroom) while
// widening the traversal threshold by only 0.04%.
// This probe sits at clearance = 1 - 5e-7: inside the new margin but BELOW the old float32
// padding artefact, so before the change the candidate was pruned away entirely (distance:null) and
// now the traversal still reaches it and the exact post-filter -- not float32 padding -- decides.
// Either way `withinClearance` is correctly false; what the margin buys is that the true distance is
// still reported rather than lost, and that fixture 2 no longer balances on a float32 knife edge.
test('traversal threshold margin: a candidate just inside the safety margin survives pruning and reports its true distance', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(3, 0, 0)); // exact world gap 1
  const result = clearanceQuery(source, target, { clearance: 1 - 5e-7, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, false);
  assert.equal(typeof result.distance, 'number', 'candidate was pruned away by the raw threshold');
  assert.ok(Math.abs(result.distance - 1) < 1e-6, `expected ~1, got ${result.distance}`);
});

// Cross-check tolerance, part 1 (end-to-end): two operands that `validateUniformScale` ACCEPTS, each
// erring by just under its per-operand `clearanceUniformScaleRelativeTolerance` bound but in
// OPPOSITE directions along the axis the closest-approach segment runs on. Their two independently
// derived world distances then differ by ~2a ~= 1.98e-4, which is wider than the old single-operand
// 1e-4 cross-check tolerance -- so the old code aborted with `clearance-distance-unavailable` on
// input its own validator had blessed. Both scale factors report exactly 1 (mean of 1+a, 1, 1-a).
test('cross-check tolerance: two validator-blessed operands erring in opposite directions do not abort', () => {
  const a = 0.99 * clearanceUniformScaleRelativeTolerance; // just inside the per-operand bound
  const source = testInstance(box(2, 2, 2), new THREE.Matrix4().makeScale(1 + a, 1, 1 - a));
  const target = testInstance(box(2, 2, 2), new THREE.Matrix4().makeScale(1 - a, 1, 1 + a).setPosition(3, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 2, toleranceFloor: 1e-9 });
  assert.equal(result.aborted, undefined, `unexpected abort: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(result.withinClearance, true);
  // True world gap is exactly 1; the reported distance carries the documented ~1e-4 relative
  // uniform-scale approximation error, so assert against that documented bound, not to 1e-9.
  assert.ok(Math.abs(result.distance - 1) < 3e-4, `expected ~1, got ${result.distance}`);
});

// Cross-check tolerance, part 2 (the tolerance formula itself). The absolute floor is defensive:
// no realistic geometry reaches it (the pinned library's two recomputed distances agree to ~1e-16
// relative even under rotation, unequal scale and 1e5-magnitude coordinates), so it is asserted
// directly on the exported helper rather than through geometry that cannot discriminate.
test('cross-check tolerance: relative term accommodates two validator-blessed operands, and there is a real spatial floor', () => {
  const diagonal = Math.sqrt(12); // a 2x2x2 box's local diagonal, scale 1
  // (a) At an ordinary distance the RELATIVE term governs, and must exceed the worst legitimate
  // two-operand disagreement, (1+t)/(1-t) - 1, which the old single-operand 1e-4 did NOT.
  const worstTwoOperand = (1 + clearanceUniformScaleRelativeTolerance)
    / (1 - clearanceUniformScaleRelativeTolerance) - 1; // ~1.9998e-4
  assert.ok(worstTwoOperand > clearanceUniformScaleRelativeTolerance); // the old bound was too narrow
  assert.ok(clearanceCrossCheckAllowedDisagreement(1, diagonal) > worstTwoOperand);
  // ...but still tight enough to catch a real frame/unit mixup, which is O(1) relative.
  assert.ok(clearanceCrossCheckAllowedDisagreement(1, diagonal) < 1e-3);
  // (b) For a near-zero gap the relative term collapses to ~0; the SPATIAL floor must take over,
  // and it must scale with the geometry rather than being a bare Number.EPSILON.
  const tiny = clearanceCrossCheckAllowedDisagreement(1e-12, diagonal);
  assert.ok(Math.abs(tiny - surfaceEpsilonFactor * diagonal) < 1e-18, `floor=${tiny}`);
  assert.ok(tiny > Number.EPSILON * 1e5);
  // (c) The floor is proportional to the geometry's world size, not a fixed constant.
  assert.ok(Math.abs(clearanceCrossCheckAllowedDisagreement(0, 1000 * diagonal)
    - 1000 * clearanceCrossCheckAllowedDisagreement(0, diagonal)) < 1e-12);
});

// Fixture 15: anisotropic scale rejection.
test('fixture 15: anisotropic source scale -> aborted with clearance-anisotropic-scale-unsupported', () => {
  const aniso = new THREE.Matrix4().makeScale(2, 1, 1);
  const source = testInstance(box(1, 1, 1), aniso);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

// Fixture 15b: companion to fixture 15 -- the TARGET-side half of the anisotropic check. Fixture 15
// only makes the source anisotropic, so `!targetScale.valid` in the abort condition was unexercised
// (deleting that clause left the whole suite green).
test('fixture 15b: anisotropic TARGET scale -> aborted with clearance-anisotropic-scale-unsupported', () => {
  const aniso = new THREE.Matrix4().makeScale(2, 1, 1).setPosition(4, 0, 0);
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(1, 1, 1), aniso);
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

// Degenerate-inverse guard (independent-review finding). `THREE.Matrix4.invert()` returns an
// ALL-ZERO matrix when the determinant underflows to EXACTLY 0, and every element of that sentinel is
// FINITE, so the old `Number.isFinite(elements[0])` guard let it through and the relative matrix
// silently collapsed the far operand onto a point. It was reachable through the validator: a uniform
// scale of 1e-110 has a representable column length but an affine determinant that underflows to 0,
// and three.js's `decompose()` returned scale (1,1,1) for a zero determinant, so
// `validateUniformScale` accepted it (misreporting scaleFactor as 1).
//
// [final fix wave] WHICH BOUNDARY THIS TEST NOW PROVES. `validateUniformScale` was since fixed at its
// own root (Batch 1's I-2 fix) to reject an exactly-zero determinant up front, so this 1e-110 case is
// now caught by `clearanceQuery`'s own TOP-OF-FUNCTION `!sourceScale.valid || !targetScale.valid`
// check and never reaches the anchor-inverse guard at all -- verified by disabling that guard, under
// which this test and its 1e-110 sibling below both still pass. Both are kept, deliberately: they are
// now regression coverage for the top-of-function rejection path, for BOTH operand orderings. The
// anchor-inverse guard's own still-reachable case (a SUBNORMAL-but-nonzero determinant, whose inverse
// overflows to Infinity rather than collapsing to the finite all-zero sentinel) is covered by the
// separate subnormal-determinant test added after these two.
test('degenerate anchor inverse (determinant underflow) -> aborted, not a silently wrong answer', () => {
  const tiny = new THREE.Matrix4().makeScale(1e-110, 1e-110, 1e-110);
  assert.equal(tiny.determinant(), 0, 'precondition: the determinant must underflow');
  assert.ok(new THREE.Matrix4().copy(tiny).invert().elements.every(Number.isFinite),
    'precondition: the all-zero inverse sentinel is entirely finite');
  const source = testInstance(box(2, 2, 2), tiny);
  const target = testInstance(box(2, 2, 2), at(3, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.aborted, true);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

// Companion to the above (whole-batch review finding, fixed at the root in
// `validateUniformScale` rather than here). The degenerate-inverse guard above only runs on the
// ANCHOR operand (the smaller-or-equal reported scale factor). Before the root fix, the tiny
// matrix's determinant-underflow misreported scaleFactor 1 -- an ordinary-looking value -- so
// when tiny is the TARGET and the other operand has a normal scale, the normal operand won.
// The tiny anchor guard, and the tiny operand ended up as "far", where NO guard caught it: the
// query returned a plausible-looking `{withinClearance: false, distance: null}` instead of
// aborting. `validateUniformScale` now rejects the determinant-underflow matrix directly, so
// `clearanceQuery`'s top-of-function `!sourceScale.valid || !targetScale.valid` check catches
// this for BOTH operand orderings without any change to this file.
test('degenerate TARGET (far, non-anchor) matrix (determinant underflow) -> aborted, not a silent wrong answer', () => {
  const tiny = new THREE.Matrix4().makeScale(1e-110, 1e-110, 1e-110);
  assert.equal(tiny.determinant(), 0, 'precondition: the determinant must underflow');
  const source = testInstance(box(2, 2, 2), at(3, 0, 0));
  const target = testInstance(box(2, 2, 2), tiny);
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.aborted, true, `expected abort, got ${JSON.stringify(result)}`);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

// [final fix wave, whole-branch review] The two 1e-110 tests above prove the TOP-OF-FUNCTION
// rejection path only: since `validateUniformScale` gained its own exactly-zero-determinant check,
// a 1e-110 uniform scale (determinant EXACTLY 0) is rejected by `clearanceQuery`'s very first
// `!sourceScale.valid || !targetScale.valid` guard and never reaches the anchor-inverse guard at all.
// Verified by disabling that anchor-inverse guard entirely: both tests above still pass, i.e. neither
// discriminates it. THIS test covers the anchor-inverse guard's own, still-reachable case, and fails
// if the guard is removed.
//
// The reachable window, by its actual mechanism: the affine determinant is strictly between 0 and
// `1 / Number.MAX_VALUE` (~= 5.5627e-309) -- SUBNORMAL but genuinely nonzero, so
// `validateUniformScale` accepts the matrix (its uniformity check is purely RELATIVE, with no
// absolute-magnitude floor, and it reports the true tiny scaleFactor, not 1), yet small enough that
// `Matrix4.invert()`'s own `1 / determinant` OVERFLOWS and the inverse carries `Infinity` components
// rather than the all-zero finite sentinel the 1e-110 case produces. For a UNIFORM scale s the
// determinant is s^3, so the window is s strictly between ~1.36e-108 (below which s^3 rounds to
// literal 0, and validateUniformScale rejects it outright -- the case the two tests above cover) and
// ~1.772e-103, i.e. `Math.cbrt(1 / Number.MAX_VALUE)`. Both edges measured against this repo's pinned
// three and independently reproduced in review. 1e-104 sits comfortably inside, away from both edges.
test('subnormal-determinant anchor (accepted by validateUniformScale, inverse overflows to Infinity) -> aborted', () => {
  const tiny = new THREE.Matrix4().makeScale(1e-104, 1e-104, 1e-104);
  assert.notEqual(tiny.determinant(), 0,
    'precondition: the determinant is SUBNORMAL but nonzero -- not the underflow-to-zero case above');
  assert.equal(validateUniformScale(tiny).valid, true,
    'precondition: validateUniformScale ACCEPTS this matrix, so the top-of-function guard passes it through');
  assert.ok(new THREE.Matrix4().copy(tiny).invert().elements.some((e) => !Number.isFinite(e)),
    'precondition: 1/determinant overflows, so the inverse carries Infinity -- not the all-zero finite sentinel');
  // tiny is the SMALLER-scale operand, so it is the ANCHOR -- the operand whose inverse is taken.
  const source = testInstance(box(2, 2, 2), tiny);
  const target = testInstance(box(2, 2, 2), at(3, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.aborted, true, `expected abort, got ${JSON.stringify(result)}`);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

// Residual-anisotropy regression (independent-review finding). Both matrices are ACCEPTED by
// `validateUniformScale` and both report scaleFactor 1, yet they distort X in OPPOSITE senses at the
// validator's full 1e-4 bound -- so the pinned library's nested far-local `score` can over-state the
// anchor-local `closestDistance`/`maxThreshold` by ~2e-4 even with equal reported scales. Ground
// truth is the SAME world geometry with that distortion baked into the vertices (matrices then pure
// translation), which removes the mismatch entirely. The traversal must still find the true minimum:
// the only permissible difference is the documented ~1e-4 uniform-scale approximation error in the
// reported distance, never a false prune.
test('residual anisotropy: opposite-distortion operands with equal reported scale still find the true minimum', () => {
  const t = clearanceUniformScaleRelativeTolerance; // the full accepted per-operand bound
  const srcSpecs = [[1.5, 2, 2, 1, 1.5, 0], [1.5, 1, 1.5, -1.5, 0.5, 0.5]];
  const tgtSpecs = [[1, 1.5, 2, -1, 0, 0], [1.5, 0.5, 2, 0.5, 0, 0.5]];
  const build = (specs, sx, sy, sz, ox) => mergeGeometries(
    specs.map(([w, h, d, x, y, z]) => boxAt(w * sx, h * sy, d * sz, x * sx + ox, y * sy, z * sz)));

  const viaMatrix = clearanceQuery(
    testInstance(build(srcSpecs, 1, 1, 1, 0), new THREE.Matrix4().makeScale(1 + t, 1, 1 - t)),
    testInstance(build(tgtSpecs, 1, 1, 1, 0), new THREE.Matrix4().makeScale(1 - t, 1, 1 + t).setPosition(8, 0, 0)),
    { clearance: 1e6, toleranceFloor: 1e-9 });
  const truth = clearanceQuery(
    testInstance(build(srcSpecs, 1 + t, 1, 1 - t, 0), new THREE.Matrix4()),
    testInstance(build(tgtSpecs, 1 - t, 1, 1 + t, 8), new THREE.Matrix4()),
    { clearance: 1e6, toleranceFloor: 1e-9 });

  assert.equal(viaMatrix.withinClearance, true);
  assert.equal(truth.withinClearance, true);
  const relative = Math.abs(viaMatrix.distance - truth.distance) / truth.distance;
  assert.ok(relative <= 2 * t,
    `deviation ${relative} exceeds the documented uniform-scale bound; a real false prune would be O(1)`);

  // Clearance-boundary version: a clearance set just above the true minimum must still classify as
  // within, despite the residual distortion in the traversal threshold.
  const boundary = clearanceQuery(
    testInstance(build(srcSpecs, 1, 1, 1, 0), new THREE.Matrix4().makeScale(1 + t, 1, 1 - t)),
    testInstance(build(tgtSpecs, 1, 1, 1, 0), new THREE.Matrix4().makeScale(1 - t, 1, 1 + t).setPosition(8, 0, 0)),
    { clearance: truth.distance * (1 + 2 * t), toleranceFloor: 1e-9 });
  assert.equal(boundary.withinClearance, true, `boundary case returned ${JSON.stringify(boundary)}`);
});

test('non-finite source matrix -> aborted', () => {
  const bad = new THREE.Matrix4();
  bad.elements[0] = NaN;
  const source = testInstance(box(1, 1, 1), bad);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
});
