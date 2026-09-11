// collision/query/geometryScale.js
//
// Tiny, dependency-free shared helper: the maximum column norm of a Matrix4's 3x3
// linear part -- i.e. an upper-bound proxy for that transform's uniform scale factor.
// For the supported transform class (rigid + uniform scale) this is EXACT: the linear
// part is s*R with R orthonormal, so all three column norms equal s precisely.
//
// Used by orientForCrossing.js (rank 1's world-diagonal ranking, design doc's C-1) and
// by ProperCrossingQuery.js (the tightened coplanarity epsilon, design doc's C-2) --
// factored out here rather than duplicated because both call sites need the exact same
// computation and drifting would silently reintroduce the asymmetry either fix removes.
export function stretch(matrix) {
  const e = matrix.elements;
  const col0 = Math.hypot(e[0], e[1], e[2]);
  const col1 = Math.hypot(e[4], e[5], e[6]);
  const col2 = Math.hypot(e[8], e[9], e[10]);
  return Math.max(col0, col1, col2);
}
