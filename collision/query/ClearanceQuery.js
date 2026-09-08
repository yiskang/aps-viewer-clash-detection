import * as THREE from 'three';
import { validateUniformScale } from './ClearanceTransform.js';
import { toFiniteWorldArray } from './VolumeOverlapQuery.js'; // confirmed export, see Step 0
import { clearanceDistanceCrossCheckRelativeTolerance } from '../constants.js';

const scratchRelative = new THREE.Matrix4();
const scratchInverseSource = new THREE.Matrix4();
const scratchPoint1 = new THREE.Vector3();
const scratchPoint2 = new THREE.Vector3();

/**
 * Exact minimum surface-to-surface distance between two Instances, for rigid + uniform-scale
 * transforms only. Same Instance shape as volumeOverlapQuery: {geometry, bvh, matrix, localDiagonal}.
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

  scratchInverseSource.copy(source.matrix).invert();
  if (!Number.isFinite(scratchInverseSource.elements[0])) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-anisotropic-scale-unsupported' }] };
  }
  const targetToSourceMatrix = scratchRelative.multiplyMatrices(scratchInverseSource, target.matrix);

  // Conservative threshold valid in BOTH operands' local frames (Critical #2 fix #3): the pinned
  // API's own nested target-side traversal operates in target-local units, so a threshold derived
  // only from sourceScale can wrongly prune a real hit when targetScale < sourceScale.
  const maxThresholdLocal = clearance / Math.min(sourceScale.scaleFactor, targetScale.scaleFactor);
  const target1 = {};
  const target2 = {};
  const raw = source.bvh.closestPointToGeometry(
    target.geometry, targetToSourceMatrix, target1, target2, 0, maxThresholdLocal,
  );

  if (raw === null || raw === undefined) {
    return { withinClearance: false, distance: null };
  }

  const localDistance1 = target1.distance;
  const localDistance2 = target2.distance;
  if (!Number.isFinite(localDistance1) || !Number.isFinite(localDistance2)) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  // Cross-check in WORLD units (Critical #2 fix #1) -- target1.distance is source-local,
  // target2.distance is target-local; comparing them raw compares two different unit systems.
  const worldDistanceFromSource = localDistance1 * sourceScale.scaleFactor;
  const worldDistanceFromTarget = localDistance2 * targetScale.scaleFactor;
  const tol = clearanceDistanceCrossCheckRelativeTolerance;
  const larger = Math.max(Math.abs(worldDistanceFromSource), Math.abs(worldDistanceFromTarget), Number.EPSILON);
  if (Math.abs(worldDistanceFromSource - worldDistanceFromTarget) > tol * larger) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }
  const worldDistance = worldDistanceFromSource;

  if (Number.isInteger(target1.faceIndex)) target1.faceIndex = source.bvh.resolveTriangleIndex(target1.faceIndex);
  if (Number.isInteger(target2.faceIndex)) target2.faceIndex = target.bvh.resolveTriangleIndex(target2.faceIndex);

  // Critical #2 fix #2: target1.point converts via source.matrix directly (it is already
  // source-local); target2.point converts via target.matrix directly (it is already target-local) --
  // NO relative-transform math on either point.
  scratchPoint1.set(target1.point.x, target1.point.y, target1.point.z);
  scratchPoint2.set(target2.point.x, target2.point.y, target2.point.z);
  const sourcePointWorld = toFiniteWorldArray(scratchPoint1, source.matrix);
  const targetPointWorld = toFiniteWorldArray(scratchPoint2, target.matrix);

  if (!sourcePointWorld || !targetPointWorld) {
    return { aborted: true, diagnostics: [{ reason: 'clearance-distance-unavailable' }] };
  }

  if (worldDistance <= toleranceFloor) {
    return { withinClearance: false, distance: worldDistance };
  }
  // Critical #2 fix #3: explicit final post-filter on the real world distance -- never trust
  // threshold-pruning alone to enforce the public (toleranceFloor, clearance] contract, since
  // maxThresholdLocal above is deliberately conservative (may admit a hit slightly beyond clearance
  // in world units when scales differ).
  if (worldDistance > clearance) {
    return { withinClearance: false, distance: worldDistance };
  }
  return {
    withinClearance: true,
    distance: worldDistance,
    witness: { sourcePoint: sourcePointWorld, targetPoint: targetPointWorld },
  };
}
