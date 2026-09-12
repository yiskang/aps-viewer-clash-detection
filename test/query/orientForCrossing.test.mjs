import test from 'node:test';
import assert from 'node:assert/strict';
import { orientForCrossing, worldDiagonal } from '../../collision/query/orientForCrossing.js';
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

// === Final-review fix round: rank 1 NaN-safety (Important #1) ==================================

test('rank 1: exactly one operand has a non-finite world diagonal -- the finite operand always sorts first, regardless of call order (NaN first)', () => {
  const nanOne = makeInstance({ localDiagonal: NaN });
  const finite = makeInstance({ localDiagonal: 5 });
  const r1 = orientForCrossing(nanOne, finite);
  const r2 = orientForCrossing(finite, nanOne);
  assert.equal(r1.first, finite, 'NaN operand passed first as the call argument must still sort second');
  assert.equal(r2.first, finite, 'NaN operand passed second as the call argument must still sort second');
  // This is still a rank-1 decision (the world-diagonal predicate, extended to treat a non-finite
  // diagonal as "sorts last"), so reporting rank: 1 is honest -- it must NOT be misreported as if a
  // lower rank had decided it.
  assert.equal(r1.rank, 1);
  assert.equal(r2.rank, 1);
});

test('rank 1: exactly one operand has a non-finite world diagonal -- the finite operand always sorts first, regardless of call order (NaN second)', () => {
  // Same fixture, opposite physical role of "which local variable holds the NaN instance" -- proves
  // the fix does not merely happen to work for one argument position.
  const finite = makeInstance({ localDiagonal: 290.969 });
  const nanOne = makeInstance({ localDiagonal: NaN });
  const r1 = orientForCrossing(finite, nanOne);
  const r2 = orientForCrossing(nanOne, finite);
  assert.equal(r1.first, finite);
  assert.equal(r2.first, finite);
  assert.equal(r1.rank, 1);
  assert.equal(r2.rank, 1);
});

test('rank 1: both operands have a non-finite world diagonal -- falls through past rank 1 (honest tie, not a decision)', () => {
  // Distinguish at rank 2 (triangle count) so the fall-through is observable and unambiguous.
  const a = makeInstance({ localDiagonal: NaN, triangleCount: 10 });
  const b = makeInstance({ localDiagonal: NaN, triangleCount: 20 });
  assert.doesNotThrow(() => orientForCrossing(a, b));
  const r1 = orientForCrossing(a, b);
  const r2 = orientForCrossing(b, a);
  assert.notEqual(r1.rank, 1, 'both-NaN must not be reported as a rank-1 decision');
  assert.equal(r1.rank, 2);
  assert.equal(r1.first, b); // larger triangle count sorts first at rank 2
  assert.equal(r2.rank, 2);
  assert.equal(r2.first, b); // swap-invariant
});

test('rank 1 fix makes rank 4\'s NaN guard genuinely reachable for a NaN in the world matrix\'s LINEAR part (not only translation)', () => {
  // Before the rank-1 fix, ANY NaN in the linear part (elements 0-2/4-6/8-10) poisoned
  // worldDiagonal via stretch(), so the pair was always (mis)decided at rank 1 and rank 4's own NaN
  // guard could never run for this case -- only a translation-part NaN (elements 12-14, outside
  // every stretch() column) could reach it, per the existing test above. Here both operands carry a
  // linear-part NaN at DIFFERENT indices, so both world diagonals are non-finite (an honest rank-1
  // tie under the fix), both tie at ranks 2-3 (identical default counts), and the pair genuinely
  // reaches rank 4's per-element comparator.
  const matA = new Matrix4(); matA.elements[0] = NaN; // column 0 (stretch's col0) -> NaN
  const matB = new Matrix4(); matB.elements[4] = NaN; // column 1 (stretch's col1) -> NaN, index 0 still finite (=1) on B
  const a = makeInstance({ localDiagonal: 5, matrix: matA, geometryDigest: 'a'.repeat(32) });
  const b = makeInstance({ localDiagonal: 5, matrix: matB, geometryDigest: 'a'.repeat(32) });

  // Fixture preconditions: both world diagonals are genuinely non-finite (reaches the both-NaN
  // rank-1 tie), and ranks 2-3 genuinely tie.
  assert.equal(Number.isFinite(worldDiagonal(a)), false);
  assert.equal(Number.isFinite(worldDiagonal(b)), false);

  assert.doesNotThrow(() => orientForCrossing(a, b));
  const r1 = orientForCrossing(a, b);
  const r2 = orientForCrossing(b, a);
  assert.equal(r1.rank, 4, 'must reach rank 4 -- not misdecided at rank 1');
  assert.equal(r2.rank, 4);
  // Index 0 is the first differing index (a: NaN, b: 1) -- NaN sorts after finite, so b sorts first.
  assert.equal(r1.first, b);
  assert.equal(r2.first, b, 'swap-invariant: same physical operand wins regardless of call order');
});

// === Final-review fix round: +Infinity must NOT be treated like NaN (codex-review, request
// 20260912-112925-19507-8893 -- a real bug caught in the first draft of the rank-1 NaN fix, which
// used `Number.isFinite()` and so lumped a genuinely-larger OVERFLOWED world diagonal in with NaN,
// sorting it to canonical-second and reversing rank 1's "larger world diagonal wins" contract) =====

test('rank 1: a genuinely overflowed (+Infinity) world diagonal still sorts first as the larger operand, regardless of call order', () => {
  // Realistic overflow, not a literally-typed Infinity: an enormous localDiagonal times a large
  // uniform scale genuinely overflows to +Infinity in IEEE754 double arithmetic.
  const hugeScale = new Matrix4().makeScale(1e200, 1e200, 1e200);
  const overflowed = makeInstance({ localDiagonal: 1e200, matrix: hugeScale }); // worldDiagonal -> Infinity
  const finite = makeInstance({ localDiagonal: 5 });
  assert.equal(worldDiagonal(overflowed), Infinity, 'fixture precondition: this must genuinely overflow to +Infinity, not merely be a large finite number');

  const r1 = orientForCrossing(overflowed, finite);
  const r2 = orientForCrossing(finite, overflowed);
  assert.equal(r1.first, overflowed, 'the overflowed (genuinely larger) operand must sort FIRST, not be treated like NaN');
  assert.equal(r2.first, overflowed, 'swap-invariant: same physical operand wins regardless of call order');
  assert.equal(r1.rank, 1);
  assert.equal(r2.rank, 1);
});

test('rank 1: two operands both overflowing to +Infinity is an ordinary tie, falls through past rank 1 (not treated like the NaN case)', () => {
  const hugeScale = new Matrix4().makeScale(1e200, 1e200, 1e200);
  const a = makeInstance({ localDiagonal: 1e200, matrix: hugeScale, triangleCount: 10 });
  const b = makeInstance({ localDiagonal: 1e200, matrix: hugeScale, triangleCount: 20 });
  assert.equal(worldDiagonal(a), Infinity);
  assert.equal(worldDiagonal(b), Infinity);

  const r1 = orientForCrossing(a, b);
  const r2 = orientForCrossing(b, a);
  assert.notEqual(r1.rank, 1, 'two equal +Infinity diagonals must tie at rank 1 (Infinity === Infinity), like any other equal-magnitude pair');
  assert.equal(r1.rank, 2);
  assert.equal(r1.first, b); // larger triangle count sorts first at rank 2
  assert.equal(r2.rank, 2);
  assert.equal(r2.first, b);
});

// === Final-review fix round: rank 5 missing/non-string geometryDigest (Important #2) ============

test('rank 5: a missing geometryDigest is a TIE, not a decisive comparison -- falls through to rank 6', () => {
  // Bypass makeInstance's default digest entirely (its default parameter would otherwise apply even
  // to an explicit `geometryDigest: undefined`), matching the real seams that can produce this: an
  // injected accelerationImpl override, or a CollisionWorld constructed directly rather than via
  // fromViewer().
  const withoutDigest = (overrides = {}) => {
    const instance = makeInstance({ localDiagonal: 5, ...overrides });
    delete instance.geometryDigest;
    return instance;
  };
  const a = withoutDigest();
  const b = makeInstance({ localDiagonal: 5, geometryDigest: 'b'.repeat(32) });

  const r1 = orientForCrossing(a, b);
  const r2 = orientForCrossing(b, a);
  assert.equal(r1.rank, 6, 'a missing digest must not be misreported as a rank-5 decision');
  assert.equal(r2.rank, 6);
  // Rank 6 is the documented order-dependent fallback to the caller's public "first" role.
  assert.equal(r1.first, a);
  assert.equal(r2.first, b);

  // Both digests missing/non-string is the same tie.
  const c = withoutDigest();
  const d = withoutDigest();
  const r3 = orientForCrossing(c, d);
  assert.equal(r3.rank, 6);
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
