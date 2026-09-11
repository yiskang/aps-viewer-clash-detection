import { stretch } from './geometryScale.js';

export function worldDiagonal(instance) {
  return instance.localDiagonal * stretch(instance.matrix);
}

function compareWorldMatrixLexicographic(a, b) {
  const ea = a.matrix.elements;
  const eb = b.matrix.elements;
  let aHasNaN = false;
  let bHasNaN = false;
  for (let i = 0; i < 16; i++) {
    const va = ea[i];
    const vb = eb[i];
    const aNaN = Number.isNaN(va);
    const bNaN = Number.isNaN(vb);
    if (aNaN || bNaN) {
      aHasNaN = aHasNaN || aNaN;
      bHasNaN = bHasNaN || bNaN;
      if (aNaN && !bNaN) return 1; // NaN sorts after finite
      if (!aNaN && bNaN) return -1;
      continue; // both NaN at this index, keep scanning
    }
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

function compareDigest(a, b) {
  if (a.geometryDigest === b.geometryDigest) return 0;
  return a.geometryDigest < b.geometryDigest ? -1 : 1;
}

/**
 * Total geometric order over two Instance operands. No identity field participates at any rank.
 * Returns which operand becomes the kernel's `A` (`first`) and which rank decided.
 */
export function orientForCrossing(x, y) {
  const dx = worldDiagonal(x);
  const dy = worldDiagonal(y);
  if (dx !== dy) {
    return dx > dy
      ? { first: x, second: y, rank: 1 }
      : { first: y, second: x, rank: 1 };
  }

  const tx = x.geometry.index.count;
  const ty = y.geometry.index.count;
  if (tx !== ty) {
    return tx > ty
      ? { first: x, second: y, rank: 2 }
      : { first: y, second: x, rank: 2 };
  }

  const vx = x.geometry.attributes.position.count;
  const vy = y.geometry.attributes.position.count;
  if (vx !== vy) {
    return vx > vy
      ? { first: x, second: y, rank: 3 }
      : { first: y, second: x, rank: 3 };
  }

  const matrixCmp = compareWorldMatrixLexicographic(x, y);
  if (matrixCmp !== 0) {
    return matrixCmp < 0
      ? { first: x, second: y, rank: 4 }
      : { first: y, second: x, rank: 4 };
  }

  const digestCmp = compareDigest(x, y);
  if (digestCmp !== 0) {
    return digestCmp < 0
      ? { first: x, second: y, rank: 5 }
      : { first: y, second: x, rank: 5 };
  }

  // Rank 6 — declared residue (L-3): fall back to the caller's public source role. `x` is always the
  // caller's "source" by this function's own calling convention (Task A2.1 always calls
  // orientForCrossing(source, target)).
  return { first: x, second: y, rank: 6 };
}
