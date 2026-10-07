// collision/query/ClearanceTransformClass.js
//
// SVF2 non-uniform fragment clearance (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md §3 / §5.1).
//
// Classifies ONE clearance operand's world matrix into the path the clearance narrow phase takes:
//
//   'uniform'     -- rigid x positive uniform scale (validateUniformScale accepts M). Evaluated FIRST
//                    and returns exactly the legacy validator result, so every operand that M3
//                    already supported keeps the byte-identical legacy path.
//   'derived'     -- M = [A | t] with mutually orthogonal columns a_i, s_i = |a_i| > 0, det A > 0.
//                    Then A = Q * S with S = diag(s0, s1, s2) and Q = A * S^-1 orthonormal, so the
//                    operand's world geometry equals the mesh prescaled by S (v' = S*v) placed by the
//                    RIGID matrix [Q | t] -- inside M3's supported class, so the unchanged
//                    clearanceQuery applies. The rigid part is gated through the EXISTING
//                    validateUniformScale (1e-4), which bounds residual non-orthogonality exactly
//                    as M3 already documents; no new tolerance constant.
//   'no-surface'  -- amendment (owner-authorized, 2026-10-07; design §5.7): the canonical record has 0
//                    triangles (empty position set, or e.g. a two-vertex line whose only primitive is
//                    degenerate), so the operand has no clearance surface at all. Decided right AFTER
//                    the uniform rule (a uniform zero-triangle operand keeps the byte-identical legacy
//                    path) and BEFORE every anisotropic-eligibility rule below, so surface-less geometry
//                    is never reported as an unsupported transform. Only when the caller passes
//                    `{ triangleCount: 0 }`; absent / positive triangleCount -> unchanged classification.
//   'unsupported' -- 'reflected' (det A < 0; owner decision O-1 keeps reflection unsupported),
//                    'non-orthogonal' (shear beyond the 1e-4 gate), 'numeric-domain' (the prescaled
//                    float32 coordinates could overflow), or 'other' (non-finite, projective,
//                    zero-length column / zero determinant -- normally already rejected at admission
//                    by isValidClearanceTransform).
//
// Pure: never mutates `matrix`; every returned `rigid` / `scale` is freshly allocated per call
// (two back-to-back classifications of source and target never share state).

import * as THREE from 'three';
import { validateUniformScale } from './ClearanceTransform.js';

const FLOAT32_MAX = 3.4028234e38;
const FLOAT32_ROUNDING = 2 ** -24;

/**
 * Upper bound of max |S*v|_inf over the operand's vertices, from its local bounding box:
 * m = max_i s_i * max(|localBox.min[i]|, |localBox.max[i]|). NaN when the box is missing/non-finite.
 */
function prescaledMagnitudeBound(scale, localBox) {
  if (!localBox || !localBox.min || !localBox.max) return NaN;
  const min = [localBox.min.x, localBox.min.y, localBox.min.z];
  const max = [localBox.max.x, localBox.max.y, localBox.max.z];
  let m = 0;
  for (let i = 0; i < 3; i++) {
    const extent = Math.max(Math.abs(min[i]), Math.abs(max[i]));
    if (!Number.isFinite(extent)) return NaN;
    m = Math.max(m, scale[i] * extent);
  }
  return m;
}

/**
 * @param {THREE.Matrix4} matrix  the operand's world matrix (the Instance.matrix toInstance() builds)
 * @param {THREE.Box3|null} localBox  the canonical record's geometry.boundingBox (local frame)
 * @param {{triangleCount?: number}} [options]  the canonical record's triangle count (amendment §5.7)
 * @returns {{path: 'uniform', scaleFactor: number}
 *   | {path: 'no-surface'}
 *   | {path: 'derived', scale: number[], rigid: THREE.Matrix4}
 *   | {path: 'unsupported', cause: 'reflected'|'non-orthogonal'|'numeric-domain'|'other'}}
 */
export function classifyClearanceTransform(matrix, localBox, { triangleCount } = {}) {
  // Rule 1: the legacy path, byte-identical (same validator, same result object fields).
  const uniform = validateUniformScale(matrix);
  if (uniform.valid) return { path: 'uniform', scaleFactor: uniform.scaleFactor };

  // Rule 1a (amendment §5.7): no clearance surface -> classified before any anisotropic eligibility.
  if (triangleCount === 0) return { path: 'no-surface' };

  const e = matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i])) return { path: 'unsupported', cause: 'other' };
  }
  if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) return { path: 'unsupported', cause: 'other' };

  // Rule 2: s_i = |a_i|, det A > 0, and the rigid remainder [Q | t] inside the M3 class.
  const scale = [
    Math.hypot(e[0], e[1], e[2]),
    Math.hypot(e[4], e[5], e[6]),
    Math.hypot(e[8], e[9], e[10]),
  ];
  for (const s of scale) {
    if (!Number.isFinite(s) || s <= 0) return { path: 'unsupported', cause: 'other' };
  }
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) return { path: 'unsupported', cause: 'other' };
  if (determinant < 0) return { path: 'unsupported', cause: 'reflected' };

  const rigid = new THREE.Matrix4();
  const r = rigid.elements;
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) r[col * 4 + row] = e[col * 4 + row] / scale[col];
    r[col * 4 + 3] = 0;
  }
  r[12] = e[12]; r[13] = e[13]; r[14] = e[14]; r[15] = 1;
  if (!validateUniformScale(rigid).valid) return { path: 'unsupported', cause: 'non-orthogonal' };

  // Rule 3: numerical domain of the prescaled float32 coordinates (design §3).
  const m = prescaledMagnitudeBound(scale, localBox);
  if (!Number.isFinite(m) || m * (1 + FLOAT32_ROUNDING) > FLOAT32_MAX) {
    return { path: 'unsupported', cause: 'numeric-domain' };
  }

  return { path: 'derived', scale, rigid };
}
