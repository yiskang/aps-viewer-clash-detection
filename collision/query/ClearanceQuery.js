import * as THREE from 'three';
import { validateUniformScale } from './ClearanceTransform.js';
import { toFiniteWorldArray } from './VolumeOverlapQuery.js'; // confirmed export, see Step 0
import {
  clearanceDistanceCrossCheckCombinedRelativeTolerance,
  clearanceTraversalThresholdSafetyMargin,
  surfaceEpsilonFactor,
} from '../constants.js';

const scratchRelative = new THREE.Matrix4();
const scratchInverseAnchor = new THREE.Matrix4();
const scratchPoint1 = new THREE.Vector3();
const scratchPoint2 = new THREE.Vector3();

/**
 * How far apart the SAME world distance, derived independently from each operand, may legitimately
 * come out before `clearanceQuery` gives up with `clearance-distance-unavailable`.
 *
 * Two terms, whichever is larger:
 *  - RELATIVE: `clearanceDistanceCrossCheckCombinedRelativeTolerance`. Each operand's `scaleFactor`
 *    is itself a validated approximation carrying up to `clearanceUniformScaleRelativeTolerance`
 *    relative error, and the two operands can err in OPPOSITE directions, so validator-blessed input
 *    can legitimately disagree by ~2x the per-operand figure -- already wider than the single-operand
 *    `clearanceDistanceCrossCheckRelativeTolerance` this check originally used, which therefore
 *    aborted on input the validator itself had accepted.
 *  - ABSOLUTE: a real spatial floor, `surfaceEpsilonFactor x` the larger operand's world-space
 *    diagonal -- the same "surfaces this close are indistinguishable" scale `computeToleranceFloor`
 *    uses. A purely relative bound degenerates for a near-zero gap: the library derives
 *    `target2.distance` by subtracting two COORDINATES in the far operand's frame, so that number's
 *    error floor scales with the geometry's world extent, not with the gap being measured. (The old
 *    code's only floor was `Number.EPSILON`, which after multiplying by a 1e-4 relative tolerance is
 *    not a spatial quantity at all.)
 *
 * Exported (test-only; NOT re-exported from collision/index.js, so the public library surface is
 * unaffected -- same convention as VolumeOverlapQuery.js's `toFiniteWorldArray`) so both terms can
 * be asserted directly, including the absolute floor, which realistic geometry does not reach.
 *
 * @param {number} largerWorldDistance - max(|worldDistanceFromAnchor|, |worldDistanceFromFar|)
 * @param {number} largestWorldDiagonal - max of the two operands' localDiagonal x their scaleFactor
 * @returns {number}
 */
export function clearanceCrossCheckAllowedDisagreement(largerWorldDistance, largestWorldDiagonal) {
  return Math.max(
    clearanceDistanceCrossCheckCombinedRelativeTolerance * largerWorldDistance,
    surfaceEpsilonFactor * largestWorldDiagonal,
  );
}

/**
 * Anchor selection and the derived local-frame clearance threshold -- the smaller-or-equal-scale
 * operand (the "anchor", see the block comment above `clearanceQuery` for why) plus the
 * `clearance / anchorScaleFactor` threshold, widened by `clearanceTraversalThresholdSafetyMargin` to
 * keep an exact-`clearance` candidate off the pinned API's strict `<` boundary.
 *
 * Exported so CollisionWorld.js's own Task 1.5 diagnostic-event covariate derivation (a
 * `hard-clash-precheck`-adjacent measurement, not a hard-clash decision) can share this EXACT
 * derivation rather than re-deriving it -- if this anchoring or safety-margin rule is ever retuned,
 * both call sites move together instead of silently drifting apart.
 *
 * @param {number} sourceScaleFactor
 * @param {number} targetScaleFactor
 * @param {number} clearance
 * @returns {{anchorIsSource: boolean, anchorScaleFactor: number, anchorLocalMaxThreshold: number}}
 */
export function computeClearanceAnchor(sourceScaleFactor, targetScaleFactor, clearance) {
  const anchorIsSource = sourceScaleFactor <= targetScaleFactor;
  const anchorScaleFactor = anchorIsSource ? sourceScaleFactor : targetScaleFactor;
  const anchorLocalMaxThreshold =
    (clearance / anchorScaleFactor) * (1 + clearanceTraversalThresholdSafetyMargin);
  return { anchorIsSource, anchorScaleFactor, anchorLocalMaxThreshold };
}

/**
 * Exact minimum surface-to-surface distance between two Instances, for rigid + uniform-scale
 * transforms only. Same Instance shape as volumeOverlapQuery: {geometry, bvh, matrix, localDiagonal}.
 *
 * ## Why the two operands are re-ordered internally ("anchor" / "far")
 *
 * The pinned `MeshBVH.prototype.closestPointToGeometry(otherGeometry, geometryToBvh, ...)` is NOT
 * symmetric in its two operands, and its own internal traversal mixes the two operands' local unit
 * systems. Verified directly in
 * `node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry_indirect.generated.js`:
 *
 *  - `tempMatrix = geometryToBvh.invert()` and `obb2.matrix.copy(tempMatrix)` (lines 61-62), so
 *    `obb2` maps BVH-local ("this" operand) coordinates into otherGeometry-local coordinates.
 *  - In the outer `bvh.shapecast`'s `intersectsBounds` (lines 72-92), on a leaf `obb2.min/max` are
 *    copied from the current BVH-local leaf box: `obb2` is now "that leaf, re-expressed in
 *    otherGeometry's local frame".
 *  - The NESTED `otherBvh.shapecast`'s own `intersectsBounds` (lines 112-116) computes
 *    `score = obb2.distanceToBox(box)` against nodes of `otherGeometry`'s OWN bvh, i.e. `score` is in
 *    OTHERGEOMETRY-LOCAL units -- and then tests `score < closestDistance && score < maxThreshold`.
 *  - But `closestDistance` comes from `triangle.distanceToTriangle(triangle2, ...)` (line 137) where
 *    `triangle2` was already pulled into BVH-local space by `applyMatrix4(geometryToBvh)` (lines
 *    125-127), so `closestDistance` is in BVH-LOCAL units. `maxThreshold` is ours, also BVH-local.
 *
 * So that nested prune compares an otherGeometry-local `score` against BVH-local quantities. Since
 * local = world / scaleFactor, a given world distance is a numerically SMALLER local number on the
 * operand with the LARGER scale. Therefore:
 *
 *  - if `otherGeometryScale >= bvhScale`, `score` under-states the world distance relative to
 *    `closestDistance`/`maxThreshold` -- the prune is merely OVER-PERMISSIVE (costs some extra
 *    traversal, can never wrongly discard a real hit);
 *  - if `otherGeometryScale <  bvhScale`, `score` over-states it -- the traversal WRONGLY PRUNES
 *    nodes that are genuinely closest, and the call returns a distance larger than the true minimum,
 *    or `null`. That is a false negative, the exact opposite of this function's public contract.
 *
 * The fix is to normalise which operand plays the `bvh` role: always call the API on the operand
 * with the SMALLER-OR-EQUAL validated `scaleFactor` (the "anchor"), passing the other one (the
 * "far" operand) as `otherGeometry`. That pins the mismatch permanently into its safe direction.
 * The caller's own source/target identities are unaffected -- the witness points and the returned
 * distance are mapped back to them before returning, so `witness.sourcePoint` is always on the
 * CALLER's source and `witness.targetPoint` always on the CALLER's target.
 *
 * KNOWN RESIDUAL (bounded, documented, not fixed here). The safe-direction argument above is exact
 * only for exactly-uniform scales. `validateUniformScale` deliberately accepts up to
 * `clearanceUniformScaleRelativeTolerance` (1e-4) of residual anisotropy per operand, and two
 * accepted operands can distort the same direction in OPPOSITE senses, so the nested far-local
 * `score` can still over-state the anchor-local `closestDistance` by ~2e-4 relative even when both
 * operands report an identical `scaleFactor`. The `score < maxThreshold` half of that is neutralised
 * by `clearanceTraversalThresholdSafetyMargin` (sized to cover exactly this); the
 * `score < closestDistance` half cannot be, and is left as a bounded second-order effect -- the same
 * order as the reported distance's own documented uniform-scale approximation error, and ~3 orders
 * of magnitude smaller than the cross-frame defect this ordering fixes. Measured over 300 randomised
 * multi-box pairs at the validator's FULL 1e-4 bound with opposite distortion: worst deviation from
 * ground truth 1.0e-4 relative, ZERO false prunes. Eliminating it entirely means either tightening
 * `validateUniformScale` to numerical-noise-scale uniformity or owning a corrected copy of the
 * traversal -- both outside this module.
 *
 * PERFORMANCE NOTE. Because the nested prune is over-permissive by the far/anchor scale ratio, a pair
 * with a very large ratio traverses more of the far operand's BVH than strictly necessary. That cost
 * was always present in the original ordering whenever the target happened to be the larger operand;
 * this change makes it the consistent direction rather than sometimes trading it for a wrong answer.
 * Worth measuring at the M3 performance gate (`test/performance/run-gate-m3.mjs`).
 *
 * Exactly ONE `closestPointToGeometry` call is made per pair (protected performance invariant).
 *
 * @param {{geometry, bvh, matrix: THREE.Matrix4, localDiagonal: number}} source
 * @param {{geometry, bvh, matrix: THREE.Matrix4, localDiagonal: number}} target
 * @param {{clearance: number, toleranceFloor: number}} options
 * @returns {
 *   {withinClearance: true, distance: number, witness: {sourcePoint:number[], targetPoint:number[]}} |
 *   {withinClearance: false, distance: number|null} |
 *   {aborted: true, diagnostics: object[]}
 * }
 */
export function clearanceQuery(source, target, options) {
  const { clearance, toleranceFloor } = options;

  const sourceScale = validateUniformScale(source.matrix);
  const targetScale = validateUniformScale(target.matrix);
  if (!sourceScale.valid || !targetScale.valid) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-anisotropic-scale-unsupported' }] };
  }

  // Anchor = the smaller-or-equal-scale operand; it is the one the pinned API's outer BVH traversal
  // runs on. See the block comment above for why this specific ordering is the safe one.
  const { anchorIsSource, anchorScaleFactor, anchorLocalMaxThreshold } = computeClearanceAnchor(
    sourceScale.scaleFactor, targetScale.scaleFactor, clearance,
  );
  const anchor = anchorIsSource ? source : target;
  const far = anchorIsSource ? target : source;
  const farScaleFactor = anchorIsSource ? targetScale.scaleFactor : sourceScale.scaleFactor;

  // Validate the WHOLE inverse -- every element finite AND the affine bottom-right entry intact
  // (exactly 1 for any successful affine inversion) -- rather than spot-checking `elements[0]`.
  // `THREE.Matrix4.invert()` fails in two distinct, both-sneaky ways, and the anchor is the
  // systematically exposed operand for both, since anchoring picks the SMALLER-scale side:
  //
  //   1. Determinant EXACTLY 0 -> invert() returns an ALL-ZERO matrix whose every element is FINITE,
  //      so an `elements[0]` check lets it through and the relative matrix silently collapses the far
  //      operand onto a point. The `elements[15] !== 0` half of this guard is what catches that shape.
  //      [final fix wave] This half is now belt-and-braces rather than the sole defense: since the
  //      Batch-1 I-2 fix, `validateUniformScale` REJECTS an exactly-zero determinant at its own
  //      top-of-function check, so `clearanceQuery`'s first `!sourceScale.valid || !targetScale.valid`
  //      guard above already aborts on it -- this path is no longer reachable from here. (The older
  //      version of this comment described the pre-fix world, where `decompose()` fell back to scale
  //      (1,1,1) for a zero determinant and `validateUniformScale` accepted it reporting scaleFactor 1.
  //      That is no longer true.)
  //
  //   2. Determinant SUBNORMAL but genuinely NONZERO -> `1 / determinant` OVERFLOWS and the inverse
  //      carries `Infinity` components. This is the case that is still genuinely reachable here, and
  //      the reason this guard must stay. `validateUniformScale` has no absolute-magnitude floor --
  //      its uniformity check is purely RELATIVE -- so it accepts such a matrix as valid and reports
  //      its true (tiny) scaleFactor. The window, stated by its actual mechanism: the affine
  //      determinant is strictly between 0 and `1 / Number.MAX_VALUE` (~= 5.5627e-309) -- nonzero, so
  //      validateUniformScale's own determinant check (case 1) passes it, yet small enough that
  //      `1 / determinant` exceeds Number.MAX_VALUE. For a UNIFORM scale s the determinant is s^3, so
  //      that window is s strictly between ~1.36e-108 (below which s^3 rounds to literal 0 and case 1
  //      catches it) and ~1.772e-103, i.e. `Math.cbrt(1 / Number.MAX_VALUE)` (above which the
  //      determinant clears the threshold and the inverse stays finite). Both edges measured against
  //      this repo's pinned three, and independently reproduced in review.
  //      The `Number.isFinite` half of this guard is what catches it -- see
  //      test/query/ClearanceQuery.test.mjs's own subnormal-determinant test, which fails if this
  //      guard is removed (the two 1e-110 tests beside it do not: they exercise case 1's
  //      top-of-function rejection instead).
  scratchInverseAnchor.copy(anchor.matrix).invert();
  const inverseElements = scratchInverseAnchor.elements;
  let anchorInvertible = inverseElements[15] !== 0;
  for (let i = 0; anchorInvertible && i < 16; i++) {
    anchorInvertible = Number.isFinite(inverseElements[i]);
  }
  if (!anchorInvertible) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-anisotropic-scale-unsupported' }] };
  }
  // `geometryToBvh`: maps FAR-local coordinates into ANCHOR-local coordinates.
  const farToAnchorMatrix = scratchRelative.multiplyMatrices(scratchInverseAnchor, far.matrix);

  // Threshold in ANCHOR-local units. `clearance / anchorScaleFactor` is exactly
  // `clearance / min(sourceScaleFactor, targetScaleFactor)` (the anchor is the min-scale operand by
  // construction), so this value is unchanged by the anchor/far swap -- it is symmetric. It is exact
  // for the outer (anchor-local) traversal and conservative for the nested one.
  // The `1 + clearanceTraversalThresholdSafetyMargin` factor keeps a candidate whose exact distance
  // equals `clearance` off the library's strict `score < maxThreshold` boundary, where float32 node
  // padding rather than geometry would otherwise decide it. Safe because the exact
  // `worldDistance > clearance` post-filter below always runs regardless. (Computed above by
  // `computeClearanceAnchor` as `anchorLocalMaxThreshold`.)
  const target1 = {};
  const target2 = {};
  const raw = anchor.bvh.closestPointToGeometry(
    far.geometry, farToAnchorMatrix, target1, target2, 0, anchorLocalMaxThreshold,
  );

  if (raw === null || raw === undefined) {
    return { withinClearance: false, distance: null };
  }

  const localDistance1 = target1.distance;
  const localDistance2 = target2.distance;
  if (!Number.isFinite(localDistance1) || !Number.isFinite(localDistance2)) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  // Cross-check in WORLD units (Critical #2 fix #1, now keyed to anchor/far rather than
  // source/target): `target1.distance` is ANCHOR-local (it is `closestDistance`, computed in the
  // bvh operand's own frame); `target2.distance` is recomputed by the library AFTER both points are
  // pushed through `tempMatrix` into the FAR operand's frame, so it is FAR-local. Comparing them raw
  // compares two different unit systems.
  const worldDistanceFromAnchor = localDistance1 * anchorScaleFactor;
  const worldDistanceFromFar = localDistance2 * farScaleFactor;
  const larger = Math.max(Math.abs(worldDistanceFromAnchor), Math.abs(worldDistanceFromFar));
  const anchorWorldDiagonal = Number.isFinite(anchor.localDiagonal)
    ? anchor.localDiagonal * anchorScaleFactor : 0;
  const farWorldDiagonal = Number.isFinite(far.localDiagonal)
    ? far.localDiagonal * farScaleFactor : 0;
  const allowedDisagreement = clearanceCrossCheckAllowedDisagreement(
    larger, Math.max(anchorWorldDiagonal, farWorldDiagonal),
  );
  if (Math.abs(worldDistanceFromAnchor - worldDistanceFromFar) > allowedDisagreement) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }
  const worldDistance = worldDistanceFromAnchor;

  if (Number.isInteger(target1.faceIndex)) target1.faceIndex = anchor.bvh.resolveTriangleIndex(target1.faceIndex);
  if (Number.isInteger(target2.faceIndex)) target2.faceIndex = far.bvh.resolveTriangleIndex(target2.faceIndex);

  // Critical #2 fix #2 (keyed to anchor/far): `target1.point` is already ANCHOR-local, so it converts
  // via `anchor.matrix` directly; `target2.point` is already FAR-local, so it converts via
  // `far.matrix` directly -- NO relative-transform math on either point.
  scratchPoint1.set(target1.point.x, target1.point.y, target1.point.z);
  scratchPoint2.set(target2.point.x, target2.point.y, target2.point.z);
  const anchorPointWorld = toFiniteWorldArray(scratchPoint1, anchor.matrix);
  const farPointWorld = toFiniteWorldArray(scratchPoint2, far.matrix);

  if (!anchorPointWorld || !farPointWorld) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  if (worldDistance <= toleranceFloor) {
    return { withinClearance: false, distance: worldDistance };
  }
  // Critical #2 fix #3: explicit final post-filter on the real world distance -- never trust
  // threshold-pruning alone to enforce the public (toleranceFloor, clearance] contract.
  // `maxThresholdLocal` above is deliberately conservative in two separate ways (the nested
  // traversal's prune is over-permissive by the far/anchor scale ratio, and the threshold itself
  // carries a safety margin), and the pinned API never re-checks its own `maxThreshold` against the
  // exact triangle-triangle distance it finally returns, so a result beyond `clearance` in world
  // units genuinely reaches this point.
  if (worldDistance > clearance) {
    return { withinClearance: false, distance: worldDistance };
  }
  // Map the anchor/far roles back onto the CALLER's source/target identities: the public contract is
  // that `witness.sourcePoint` lies on `source` and `witness.targetPoint` lies on `target`.
  return {
    withinClearance: true,
    distance: worldDistance,
    witness: {
      sourcePoint: anchorIsSource ? anchorPointWorld : farPointWorld,
      targetPoint: anchorIsSource ? farPointWorld : anchorPointWorld,
    },
  };
}
