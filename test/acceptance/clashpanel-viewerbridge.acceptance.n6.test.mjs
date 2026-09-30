// test/acceptance/clashpanel-viewerbridge.acceptance.n6.test.mjs
//
// Offline tests for N6 (procedure §7 N6, Table T21/T24, §4.2): the bounded mutation builder over
// the full boundary set (the N6 domain |v| <= 2^897, C4's distinct |v| <= 2^900 range, nextDown/
// nextUp neighbours, float64 max, float32 extremes, zero-width / thin / degenerate boxes, NaN,
// ±Infinity, inverted boxes), with the expected MUTATED / REJECTED_OUT_OF_N6_DOMAIN /
// REJECTED_OUT_OF_RANGE / REJECTED_NON_FINITE outcome per case; the assertion that no rejected input
// can ever yield a mutated box or N6 DETECTED; and a seeded property test over random valid finite
// boxes (any sign, thin, zero-width, very large).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  C4_OUTCOME, N6_BUILD_OUTCOME, boundsContainmentOracle, buildN6Mutation, n6Recompute, evaluateN6, selectN6Input, evaluateC4,
} from './clashpanel-viewerbridge.acceptance.mjs';

const buf = new DataView(new ArrayBuffer(8));
function nextUp(x) {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  buf.setFloat64(0, x);
  let bits = buf.getBigUint64(0);
  bits += x > 0 ? 1n : -1n;
  buf.setBigUint64(0, bits);
  return buf.getFloat64(0);
}
const nextDown = (x) => -nextUp(-x);

const P897 = 2 ** 897;
const P900 = 2 ** 900;
const F32_MAX = 3.4028234663852886e38;
const F32_MIN_SUB = 1.401298464324817e-45;

/** Asserts the full (ii) guarantee on a MUTATED result, including the exact oracle label. */
function assertMutatedDetects(b, r, label) {
  const m = buildN6Mutation({ candidate: b, reference: r });
  assert.equal(m.outcome, N6_BUILD_OUTCOME.MUTATED, `${label}: builder`);
  assert.equal(m.checks.finite && m.checks.ordered && m.checks.insideC4Range, true, `${label}: post-checks ${JSON.stringify(m.checks)}`);
  assert.ok(m.mutated[0] <= m.mutated[3], `${label}: bMin' <= bMax'`);
  assert.deepEqual(m.mutated.slice(1, 3), [b[1], b[2]]);
  assert.deepEqual(m.mutated.slice(4), [b[4], b[5]]);
  if (b[0] === b[3]) assert.equal(m.mutated[0], m.mutated[3], `${label}: zero width preserved`);
  const re = n6Recompute(m.mutated, r);
  assert.equal(re.deficitExceedsT, true, `${label}: dMax' > T'`);
  assert.equal(boundsContainmentOracle({ candidate: m.mutated, reference: r }).outcome, C4_OUTCOME.NOT_CONTAINED, `${label}: oracle exactly FAIL(not-contained)`);
}

function assertRejected(b, r, expected, label) {
  const m = buildN6Mutation({ candidate: b, reference: r });
  assert.equal(m.outcome, expected, `${label}: builder`);
  assert.equal(m.mutated, null, `${label}: no mutated box`);
}

test('neighbour helpers are exact', () => {
  assert.ok(nextUp(P897) > P897 && nextDown(P897) < P897);
  assert.equal(nextDown(nextUp(P897)), P897);
  assert.equal(nextUp(-P897), -nextDown(P897));
});

test('(1) in N6 domain: ±2^897, ±nextDown(2^897), float32 extremes, opposite-sign extremes, zero width at extremes => MUTATED + exactly FAIL(not-contained)', () => {
  const inDomain = [P897, -P897, nextDown(P897), -nextDown(P897)];
  for (const v of inDomain) {
    // v in each of the twelve coordinates (box kept valid: the other face widened to contain it)
    for (let i = 0; i < 12; i += 1) {
      const b = [0, 0, 0, 1, 1, 1];
      const r = [0, 0, 0, 1, 1, 1];
      const box = i < 6 ? b : r;
      const k = i % 6;
      box[k] = v;
      // keep min <= max on the touched axis
      const axis = k % 3;
      if (box[axis] > box[axis + 3]) { const t = box[axis]; box[axis] = box[axis + 3]; box[axis + 3] = t; }
      assertMutatedDetects(b, r, `v=${v} coord ${i}`);
    }
  }
  assertMutatedDetects([-P897, 0, 0, P897, 1, 1], [-P897, 0, 0, -P897, 1, 1], 'opposite-sign extremes');
  assertMutatedDetects([P897, 0, 0, P897, 1, 1], [0, 0, 0, P897, 1, 1], 'zero width at +2^897');
  assertMutatedDetects([-P897, 0, 0, -P897, 1, 1], [-P897, 0, 0, 0, 1, 1], 'zero width at -2^897');
  assertMutatedDetects([nextDown(P897), 0, 0, nextDown(P897), 1, 1], [0, 0, 0, nextDown(P897), 1, 1], 'zero width at nextDown(2^897)');
  assertMutatedDetects([-nextDown(P897), 0, 0, -nextDown(P897), 1, 1], [-nextDown(P897), 0, 0, 1, 1, 1], 'zero width at -nextDown(2^897)');
  assertMutatedDetects([-F32_MAX, 0, 0, F32_MAX, 1, 1], [-F32_MAX, 0, 0, F32_MAX, 1, 1], 'float32 max');
  assertMutatedDetects([0, 0, 0, F32_MIN_SUB, 1, 1], [0, 0, 0, F32_MIN_SUB, 1, 1], 'float32 min subnormal');
  // adjacent representable values around rMax_x
  for (const rMax of [1, 1000.5, -3]) {
    for (const bMax of [nextDown(rMax), rMax, nextUp(rMax)]) assertMutatedDetects([bMax - 1, 0, 0, bMax, 1, 1], [rMax - 2, 0, 0, rMax, 1, 1], `around rMax ${rMax}`);
  }
});

test('(2) finite, outside the N6 domain, inside C4 range: nextUp(2^897), ±2^900, ±nextDown(2^900) => REJECTED_OUT_OF_N6_DOMAIN; C4 unaffected', () => {
  for (const v of [nextUp(P897), -nextUp(P897), P900, -P900, nextDown(P900), -nextDown(P900)]) {
    const b = [Math.min(0, v), 0, 0, Math.max(0, v), 1, 1];
    assertRejected(b, b, N6_BUILD_OUTCOME.REJECTED_OUT_OF_N6_DOMAIN, `v=${v}`);
    assert.equal(boundsContainmentOracle({ candidate: b, reference: b }).outcome, C4_OUTCOME.CONTAINED, `C4 on unmodified pair v=${v}`);
  }
});

test('(3) just out of C4 range: ±nextUp(2^900), float64 max, degenerate boxes at ±nextUp(2^900) => REJECTED_OUT_OF_RANGE and C4 FAIL(out-of-range)', () => {
  const cases = [
    [0, 0, 0, nextUp(P900), 1, 1], [-nextUp(P900), 0, 0, 0, 1, 1], [0, 0, 0, Number.MAX_VALUE, 1, 1],
    [nextUp(P900), 0, 0, nextUp(P900), 1, 1], [-nextUp(P900), 0, 0, -nextUp(P900), 1, 1],
  ];
  for (const b of cases) {
    const r = [0, 0, 0, 1, 1, 1];
    assertRejected(b, r, N6_BUILD_OUTCOME.REJECTED_OUT_OF_RANGE, `cand ${b}`);
    assertRejected(r, b, N6_BUILD_OUTCOME.REJECTED_OUT_OF_RANGE, `ref ${b}`);
    assert.equal(boundsContainmentOracle({ candidate: b, reference: r }).outcome, C4_OUTCOME.OUT_OF_RANGE);
  }
});

test('(4) non-finite in any of the twelve coordinates, or an inverted box => REJECTED_NON_FINITE and C4 FAIL(non-finite)', () => {
  for (const v of [Infinity, -Infinity, NaN]) {
    for (let i = 0; i < 12; i += 1) {
      const b = [0, 0, 0, 1, 1, 1];
      const r = [0, 0, 0, 1, 1, 1];
      (i < 6 ? b : r)[i % 6] = v;
      assertRejected(b, r, N6_BUILD_OUTCOME.REJECTED_NON_FINITE, `v=${v} coord ${i}`);
      assert.equal(boundsContainmentOracle({ candidate: b, reference: r }).outcome, C4_OUTCOME.NON_FINITE);
    }
  }
  assertRejected([2, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1], N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'inverted');
  assert.equal(boundsContainmentOracle({ candidate: [2, 0, 0, 1, 1, 1], reference: [0, 0, 0, 1, 1, 1] }).outcome, C4_OUTCOME.NON_FINITE);
  assertRejected(null, [0, 0, 0, 1, 1, 1], N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'missing');
  // non-finite dominates out-of-range (checked first over all twelve coordinates)
  assertRejected([0, 0, 0, NaN, 1, 1], [0, 0, 0, 2 ** 1000, 1, 1], N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'NaN + huge');
});

test('(5) rejection classes are pairwise distinct; no rejected input yields a mutated box or N6 DETECTED (never-silent-success)', () => {
  const classes = [N6_BUILD_OUTCOME.REJECTED_OUT_OF_N6_DOMAIN, N6_BUILD_OUTCOME.REJECTED_OUT_OF_RANGE, N6_BUILD_OUTCOME.REJECTED_NON_FINITE];
  assert.equal(new Set(classes).size, 3);
  assert.notEqual(C4_OUTCOME.OUT_OF_RANGE, C4_OUTCOME.NON_FINITE);
  const rejectedInputs = [
    [[0, 0, 0, nextUp(P897), 1, 1], [0, 0, 0, 1, 1, 1]],
    [[0, 0, 0, P900, 1, 1], [0, 0, 0, P900, 1, 1]],
    [[0, 0, 0, nextUp(P900), 1, 1], [0, 0, 0, 1, 1, 1]],
    [[0, 0, 0, NaN, 1, 1], [0, 0, 0, 1, 1, 1]],
  ];
  for (const [b, r] of rejectedInputs) {
    const n6 = evaluateN6({ candidate: b, reference: r });
    assert.notEqual(n6.state, 'DETECTED', JSON.stringify(b));
    assert.equal(n6.fields.subcases.ii.ok, false);
    assert.equal(n6.fields.subcases.ii.harnessDefect, true);
  }
  // A contained dbId beyond the N6 domain (impossible for float32 bounds) => NOT_DETECTED, never NOT_APPLICABLE
  const big = [0, 0, 0, P900, 1, 1];
  assert.equal(boundsContainmentOracle({ candidate: big, reference: big }).outcome, C4_OUTCOME.CONTAINED);
  assert.equal(evaluateN6({ candidate: big, reference: big }).state, 'NOT_DETECTED');
});

test('evaluateN6 sub-cases (i)–(iv) on a normal contained pair => DETECTED; oracle negative control => NOT_DETECTED; no input => NOT_APPLICABLE', () => {
  const b = [10, -5, 0, 20, 5, 3];
  const r = [10, -5, 0, 20, 5, 3];
  const n6 = evaluateN6({ candidate: b, reference: r });
  assert.equal(n6.state, 'DETECTED');
  const sc = n6.fields.subcases;
  assert.equal(sc.i.oracle, 'contained');
  assert.equal(sc.ii.oracle, 'FAIL(not-contained)');
  assert.ok(sc.ii.dMaxPrime > sc.ii.TPrime);
  assert.equal(sc.iii.applicable, true);
  assert.equal(sc.iii.oracle, 'NOT_EVIDENCED(near-tolerance)');
  assert.equal(sc.iv.oracle, 'contained');
  for (const k of ['b', 'r', 'Ms', 'D', 'delta', 'bPrime', 'SPrime', 'APrime', 'TPrime', 'dMaxPrime']) assert.ok(k in sc.ii, k);
  // a broken oracle that never returns FAIL(not-contained) is caught
  const lax = (x) => ({ ...boundsContainmentOracle(x), outcome: boundsContainmentOracle(x).outcome === 'FAIL(not-contained)' ? 'FAIL(non-finite)' : boundsContainmentOracle(x).outcome });
  assert.equal(evaluateN6({ candidate: b, reference: r, oracle: lax }).state, 'NOT_DETECTED');
  assert.equal(evaluateN6({}).state, 'NOT_APPLICABLE');
  // N6 input = first `contained` row of the C4 table
  const c4 = evaluateC4({ rows: [{ model: 'A', dbId: 1, candidate: [0, 0, 0, 0.5, 1, 1], fragmentBoxes: [[0, 0, 0, 1, 1, 1]] }, { model: 'A', dbId: 2, candidate: b, fragmentBoxes: [r] }] });
  assert.equal(selectN6Input(c4.c4Table).dbId, 2);
  assert.equal(selectN6Input([]).candidate, null);
});

test('property: random valid finite boxes (any sign, thin, zero-width, very large) always MUTATED and exactly FAIL(not-contained)', () => {
  let seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 0x100000000; };
  const scales = [1e-30, 1e-6, 1, 1e3, 1e30, 1e200, 2 ** 896];
  const coord = () => (rand() < 0.5 ? -1 : 1) * rand() * scales[Math.floor(rand() * scales.length)];
  for (let n = 0; n < 4000; n += 1) {
    const b = [];
    const r = [];
    for (let a = 0; a < 3; a += 1) {
      const kind = rand();
      const lo = coord();
      const hi = kind < 0.2 ? lo : (kind < 0.35 ? nextUp(lo) : lo + Math.abs(coord()));
      b[a] = lo; b[a + 3] = Math.min(hi, 2 ** 897);
      const rlo = coord();
      r[a] = rlo; r[a + 3] = Math.min(rlo + Math.abs(coord()), 2 ** 897);
      if (b[a] > b[a + 3]) b[a] = b[a + 3];
      if (r[a] > r[a + 3]) r[a] = r[a + 3];
    }
    assertMutatedDetects(b, r, `random #${n}`);
  }
});
