import { stretch } from './geometryScale.js';

export function worldDiagonal(instance) {
  return instance.localDiagonal * stretch(instance.matrix);
}

// Final-review fix round: this is now genuinely reachable for a NaN in the matrix's LINEAR part
// (elements 0-2/4-6/8-10), not only the translation part (12-14). Before the rank-1 fix below, any
// NaN in the linear part poisoned `worldDiagonal` via `stretch()`, so rank 1 always decided (albeit
// incorrectly) before a pair carrying such a NaN could ever reach this function. Rank 1 now treats a
// non-finite world diagonal as a symmetric case of its own (see `orientForCrossing`), so a pair whose
// linear-part NaNs make both world diagonals non-finite genuinely falls through to here. Per-index
// comparison below sorts a NaN entry after a finite one at the first differing index, and continues
// scanning when both operands are NaN at the same index -- this is a correct, swap-invariant total
// order over the 16 elements; it does not implement (and never claimed to implement) an "any element
// NaN loses the whole comparison outright" rule.
function compareWorldMatrixLexicographic(a, b) {
  const ea = a.matrix.elements;
  const eb = b.matrix.elements;
  for (let i = 0; i < 16; i++) {
    const va = ea[i];
    const vb = eb[i];
    const aNaN = Number.isNaN(va);
    const bNaN = Number.isNaN(vb);
    if (aNaN || bNaN) {
      if (aNaN && !bNaN) return 1; // NaN sorts after finite
      if (!aNaN && bNaN) return -1;
      continue; // both NaN at this index, keep scanning
    }
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

// A missing/non-string digest (an injected `accelerationImpl` override, or a `CollisionWorld`
// constructed directly rather than via `fromViewer()`) is treated as a rank-5 TIE, never a decisive
// comparison: relational comparisons against `undefined` are always `false`, so without this guard
// `compareDigest` would silently always return `1` (same physical operand always sorts second)
// regardless of argument order, while the caller still reports `rank: 5` as if a real digest
// comparison had decided it. Falling through to rank 6 keeps the reported rank honest (rank 6 is
// already documented as the order-dependent fallback) instead of misreporting a degenerate case as a
// swap-invariant rank-5 decision it did not actually make.
function compareDigest(a, b) {
  if (typeof a.geometryDigest !== 'string' || typeof b.geometryDigest !== 'string') return 0;
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
  const dxFinite = Number.isFinite(dx);
  const dyFinite = Number.isFinite(dy);
  if (dxFinite !== dyFinite) {
    // Exactly one operand's world diagonal is non-finite (malformed `localDiagonal` or a NaN in the
    // world matrix's linear part, which `stretch()` reads). Final-review fix: the pre-fix
    // `dx !== dy` / `dx > dy` comparison broke swap-invariance here, because `NaN !== finite` is
    // always true while `NaN > finite` is always false, so the SAME physical operand did not sort
    // first under both argument orders. Sort the non-finite operand to canonical-second,
    // symmetrically regardless of call order -- this is still a decision made by the world-diagonal
    // predicate (extended to treat "no comparable magnitude" as "sorts last"), so reporting rank: 1
    // stays honest.
    return dxFinite
      ? { first: x, second: y, rank: 1 }
      : { first: y, second: x, rank: 1 };
  }
  if (dxFinite && dx !== dy) {
    return dx > dy
      ? { first: x, second: y, rank: 1 }
      : { first: y, second: x, rank: 1 };
  }
  // Either both finite and equal, or both non-finite. A non-finite world diagonal carries no
  // magnitude to compare against another non-finite one, so both-non-finite is an honest rank-1 TIE
  // (not a rank-1 decision) -- fall through and let ranks 2-6 have their normal chance to decide,
  // rather than the pre-fix code's order-dependent `NaN !== NaN` branch.

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
