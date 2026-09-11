import test from 'node:test';
import assert from 'node:assert/strict';
import { orientForCrossing } from '../../collision/query/orientForCrossing.js';
import { Matrix4 } from 'three';

function makeInstance({ localDiagonal, matrix = new Matrix4(), triangleCount = 12, vertexCount = 8, geometryDigest = 'a'.repeat(32) }) {
  return {
    localDiagonal,
    matrix,
    geometryDigest,
    geometry: { index: { count: triangleCount * 3 }, attributes: { position: { count: vertexCount } } },
  };
}

test('rank 1: larger world-space diagonal orients first, regardless of argument order', () => {
  const small = makeInstance({ localDiagonal: 3.918 });
  const large = makeInstance({ localDiagonal: 290.969 });
  const r1 = orientForCrossing(small, large);
  const r2 = orientForCrossing(large, small);
  assert.equal(r1.first, large);
  assert.equal(r2.first, large);
  assert.equal(r1.rank, 1);
});

test('rank 1 uses WORLD diagonal (localDiagonal * stretch), not local diagonal alone', () => {
  // local diagonal disagrees with world diagonal once scale is applied — this is regression A.2's
  // pinning case, exercised at the unit level here.
  const stretched = new Matrix4().makeScale(100, 100, 100);
  const a = makeInstance({ localDiagonal: 1, matrix: stretched }); // world diagonal 100
  const b = makeInstance({ localDiagonal: 10, matrix: new Matrix4() }); // world diagonal 10
  const r = orientForCrossing(a, b);
  assert.equal(r.first, a);
  assert.equal(r.rank, 1);
});

test('rank 2: equal world diagonal falls to triangle count, descending', () => {
  const a = makeInstance({ localDiagonal: 5, triangleCount: 10 });
  const b = makeInstance({ localDiagonal: 5, triangleCount: 20 });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
  assert.equal(r.rank, 2);
});

test('rank 3: equal diagonal and triangle count falls to vertex count, descending', () => {
  const a = makeInstance({ localDiagonal: 5, triangleCount: 10, vertexCount: 6 });
  const b = makeInstance({ localDiagonal: 5, triangleCount: 10, vertexCount: 9 });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
  assert.equal(r.rank, 3);
});

test('rank 4: equal counts falls to world-matrix lexicographic order, ascending', () => {
  // Element 12 is the matrix's translation-x slot -- outside every stretch() column
  // (columns are elements 0-2, 4-6, 8-10), so differing there cannot perturb the rank-1
  // world-diagonal key and this genuinely reaches rank 4 (unlike differing at element 0,
  // which is itself part of stretch's column 0 and would decide at rank 1 instead).
  const matA = new Matrix4(); matA.elements[12] = 1;
  const matB = new Matrix4(); matB.elements[12] = 2;
  const a = makeInstance({ localDiagonal: 5, matrix: matA });
  const b = makeInstance({ localDiagonal: 5, matrix: matB });
  const r1 = orientForCrossing(a, b);
  const r2 = orientForCrossing(b, a);
  assert.equal(r1.first, a); // 1 < 2, ascending means a sorts first
  assert.equal(r1.rank, 4);
  assert.equal(r2.first, a); // swap-invariant: same operand wins regardless of call order
  assert.equal(r2.rank, 4);
});

test('rank 4 treats -0 and 0 as equal (falls through to rank 5)', () => {
  const matA = new Matrix4(); matA.elements[0] = -0;
  const matB = new Matrix4(); matB.elements[0] = 0;
  const a = makeInstance({ localDiagonal: 5, matrix: matA, geometryDigest: 'a'.repeat(32) });
  const b = makeInstance({ localDiagonal: 5, matrix: matB, geometryDigest: 'b'.repeat(32) });
  const r = orientForCrossing(a, b);
  assert.equal(r.rank, 5); // did not decide at rank 4
});

test('rank 4 NaN guard: a NaN-bearing matrix sorts after a finite one, never throws', () => {
  // Same element-12 reasoning as the rank-4 test above: element 0 is part of stretch()'s
  // column 0, so a NaN there would poison the rank-1 world-diagonal key (Math.max propagates
  // NaN) and this would get decided at rank 1, never actually exercising rank 4's own NaN
  // guard. Element 12 (translation-x) is outside every stretch column.
  const matA = new Matrix4(); matA.elements[12] = NaN;
  const matB = new Matrix4();
  const a = makeInstance({ localDiagonal: 5, matrix: matA });
  const b = makeInstance({ localDiagonal: 5, matrix: matB });
  assert.doesNotThrow(() => orientForCrossing(a, b));
  const r = orientForCrossing(a, b);
  assert.equal(r.first, b);
  assert.equal(r.rank, 4);
  const rSwapped = orientForCrossing(b, a);
  assert.equal(rSwapped.first, b);
  assert.equal(rSwapped.rank, 4);
});

test('rank 5: equal ranks 1-4 falls to geometryDigest, lexicographic ascending', () => {
  const a = makeInstance({ localDiagonal: 5, geometryDigest: '11'.repeat(16) });
  const b = makeInstance({ localDiagonal: 5, geometryDigest: '22'.repeat(16) });
  const r = orientForCrossing(a, b);
  assert.equal(r.first, a);
  assert.equal(r.rank, 5);
});

test('rank 6: identical digest falls back to the caller\'s public source role', () => {
  const a = makeInstance({ localDiagonal: 5, geometryDigest: 'a'.repeat(32) });
  const b = makeInstance({ localDiagonal: 5, geometryDigest: 'a'.repeat(32) });
  const r1 = orientForCrossing(a, b); // a is the public "source" (first positional arg)
  const r2 = orientForCrossing(b, a); // b is the public "source" here
  assert.equal(r1.first, a);
  assert.equal(r2.first, b);
  assert.equal(r1.rank, 6);
});

test('ranks 1-5 are swap-invariant, and rank-5 digest ordering is transitive', () => {
  // Regression A.1's requirement, exercised directly on the helper. All three fixtures tie at
  // ranks 1-4 (identical localDiagonal/matrix/default counts), so every pairwise comparison here
  // is decided at rank 5 by geometryDigest -- which, like every rank below 6, must be
  // swap-invariant: orientForCrossing(x,y) and orientForCrossing(y,x) must pick the SAME winning
  // operand regardless of call order (this is the entire point of the "operand-symmetry fix";
  // only rank 6, an exact digest collision, is allowed to depend on the caller's argument order).
  const instances = [
    makeInstance({ localDiagonal: 5, geometryDigest: '01'.repeat(16) }),
    makeInstance({ localDiagonal: 5, geometryDigest: '02'.repeat(16) }),
    makeInstance({ localDiagonal: 5, geometryDigest: '03'.repeat(16) }),
  ];
  for (const x of instances) for (const y of instances) {
    const fwd = orientForCrossing(x, y);
    const bwd = orientForCrossing(y, x);
    if (x !== y) {
      assert.equal(fwd.first, bwd.first, 'swap-invariant: same operand wins regardless of call order');
      assert.equal(fwd.rank, 5);
      assert.equal(bwd.rank, 5);
    }
  }
  // transitivity: a < b < c implies a < c
  const [a, b, c] = instances; // digests already ascending: 01 < 02 < 03
  assert.equal(orientForCrossing(a, b).first, a);
  assert.equal(orientForCrossing(b, c).first, b);
  assert.equal(orientForCrossing(a, c).first, a);
});
