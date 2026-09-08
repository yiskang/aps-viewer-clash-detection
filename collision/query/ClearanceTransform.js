import * as THREE from 'three';
import { clearanceUniformScaleRelativeTolerance } from '../constants.js';

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColA = new THREE.Vector3();
const scratchColB = new THREE.Vector3();
const scratchColC = new THREE.Vector3();

/**
 * Validates that a world matrix decomposes to rigid + POSITIVE uniform scale only (M3's supported
 * transform class). Structural checks, not just scale-magnitude comparison: rejects shear/projective
 * matrices (non-orthogonal basis columns) and reflected/negative scale. Anisotropic scale is diagnosed
 * unsupported by the caller, never approximated here.
 *
 * Error bound: when accepted, the reported scaleFactor may differ from any single axis's true scale
 * by up to `clearanceUniformScaleRelativeTolerance` (1e-4) relative — i.e. a world distance computed
 * from it carries a bounded relative error of the same order. This is a real, documented
 * approximation, not silently exact.
 *
 * @param {THREE.Matrix4} matrix
 * @returns {{valid: true, scaleFactor: number} | {valid: false}}
 */
export function validateUniformScale(matrix) {
  const elements = matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(elements[i])) return { valid: false };
  }
  // Affine bottom row required (no projective component).
  if (elements[3] !== 0 || elements[7] !== 0 || elements[11] !== 0 || elements[15] !== 1) {
    return { valid: false };
  }

  // Reject a determinant that is non-finite or exactly zero BEFORE trusting `decompose()`'s reported
  // scale. `Matrix4.decompose()` derives scale from basis-column LENGTH, not from the determinant, so
  // an extreme-but-uniform scale (e.g. 1e-110 per axis) can underflow the determinant to literal `0`
  // in float64 while each column length is still representable -- three.js then falls back to
  // `scale.set(1,1,1)` internally, silently misreporting scaleFactor 1 for a near-zero/degenerate
  // transform. This is a determinant-underflow check, not a magnitude-based cutoff: a legitimate tiny
  // uniform scale like 1e-6 has determinant (1e-6)^3 = 1e-18, comfortably nonzero in float64, and is
  // NOT rejected here (see the "tiny but legitimate uniform scale" test).
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) return { valid: false };

  matrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
  const { x: sx, y: sy, z: sz } = scratchScale;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return { valid: false };
  if (sx <= 0 || sy <= 0 || sz <= 0) return { valid: false }; // reflections/negative scale unsupported

  const scaleFactor = (sx + sy + sz) / 3;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return { valid: false };
  const tol = clearanceUniformScaleRelativeTolerance;
  const withinTolerance = (v) => Math.abs(v - scaleFactor) <= tol * scaleFactor;
  if (!withinTolerance(sx) || !withinTolerance(sy) || !withinTolerance(sz)) return { valid: false };

  // Orthogonality check: reject shear/projective-like matrices that pass a magnitude-only check.
  // matrix.decompose() already extracted scale via column length, so re-derive the (still possibly
  // non-orthogonal) raw basis columns from `matrix.elements` directly and check pairwise dot products
  // are ~0 relative to the columns' own magnitudes.
  scratchColA.set(elements[0], elements[1], elements[2]);
  scratchColB.set(elements[4], elements[5], elements[6]);
  scratchColC.set(elements[8], elements[9], elements[10]);
  const mag = scaleFactor; // all three columns are within `tol` of this by the check above
  const orthTol = tol * mag * mag;
  if (Math.abs(scratchColA.dot(scratchColB)) > orthTol) return { valid: false };
  if (Math.abs(scratchColA.dot(scratchColC)) > orthTol) return { valid: false };
  if (Math.abs(scratchColB.dot(scratchColC)) > orthTol) return { valid: false };

  return { valid: true, scaleFactor };
}

/**
 * World-unit clearance tolerance floor:
 *   toleranceFloor = surfaceEpsilonFactor * max(source.localDiagonal * source.scaleFactor,
 *                                                target.localDiagonal * target.scaleFactor)
 * Both operands' local-frame diagonals are converted to world units via their own validated uniform
 * scale factor BEFORE the max() — comparing local- and world-frame quantities directly is invalid.
 */
export function computeToleranceFloor(sourceInfo, targetInfo, surfaceEpsilonFactor) {
  const sourceWorldDiagonal = sourceInfo.localDiagonal * sourceInfo.scaleFactor;
  const targetWorldDiagonal = targetInfo.localDiagonal * targetInfo.scaleFactor;
  return surfaceEpsilonFactor * Math.max(sourceWorldDiagonal, targetWorldDiagonal);
}
