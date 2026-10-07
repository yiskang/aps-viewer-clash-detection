// test/query/ClearanceNonUniform.equivalence.test.mjs
//
// SVF2 non-uniform fragment clearance design (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md) §3 / §6 / §8 T5: offline equivalence of
// the derived ("prescaled") clearance path, ported from the design's seeded `proto2.mjs` sweep and
// extended with large-origin and threshold-boundary cases.
//
// Every operand is built through the REAL pipeline: canonical record (compactAndWeld + BVH) ->
// classifyClearanceTransform -> 'uniform' (legacy canonical instance) or 'derived'
// (buildDerivedGeometry: compact + prescale + world-unit weld + BVH, placed by the rigid [Q | t]),
// then the UNCHANGED clearanceQuery. Two separate claims are checked (design §3):
//   (i)  query exactness -- clearanceQuery's distance equals the float64 brute-force minimum over the
//        SAME welded distance-instance triangles placed by their own matrices, within M3's existing
//        cross-check allowance;
//   (ii) raw-world truth -- against the float64 brute force over the RAW (unwelded) triangles placed
//        by the FULL anisotropic matrices: |d - truth| stays inside the §3 band
//        sqrt(3) * (2^-24 * (m_A + m_B) + merged * eps_w), and there are 0 false negatives / 0 false
//        positives outside that band.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ExtendedTriangle } from 'three-mesh-bvh';
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { buildDerivedGeometry } from '../../collision/geometry/ClearanceDerivedGeometryCache.js';
import { classifyClearanceTransform } from '../../collision/query/ClearanceTransformClass.js';
import { clearanceQuery, clearanceCrossCheckAllowedDisagreement } from '../../collision/query/ClearanceQuery.js';
import { validateUniformScale, computeToleranceFloor } from '../../collision/query/ClearanceTransform.js';
import { surfaceEpsilonFactor } from '../../collision/constants.js';

const WELD = 1e-4;
const SQRT3 = Math.sqrt(3);
const F32 = 2 ** -24;

// Deterministic LCG (the prototype's own seed and recurrence).
function makeRng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

// Non-indexed unit icosphere (radius 0.5, i.e. inside the SVF2 [-0.5, 0.5]^3 cube), 80 triangles.
const BASE = new THREE.IcosahedronGeometry(0.5, 1);
const RAW_POS = Float32Array.from(BASE.attributes.position.array);
const RAW_IDX = Uint32Array.from({ length: RAW_POS.length / 3 }, (_, i) => i);

function rawView() {
  return {
    unsupported: false, positions: RAW_POS.slice(), positionStride: 3, positionOffset: 0, index: RAW_IDX.slice(),
    ranges: [{ start: 0, count: RAW_IDX.length }], activeTriangleCount: RAW_IDX.length / 3,
  };
}

function trianglesOf(positions, index, matrix) {
  const m = matrix.elements;
  const pts = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    pts.push(new THREE.Vector3(
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ));
  }
  const tris = [];
  for (let i = 0; i < index.length; i += 3) {
    const t = new ExtendedTriangle(pts[index[i]], pts[index[i + 1]], pts[index[i + 2]]);
    t.needsUpdate = true;
    tris.push(t);
  }
  return tris;
}

function bruteMin(a, b) {
  let best = Infinity;
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (const x of a) for (const y of b) best = Math.min(best, x.distanceToTriangle(y, p, q));
  return best;
}

function distinctPositionCount(positions) {
  const set = new Set();
  for (let i = 0; i < positions.length; i += 3) set.add(`${positions[i]},${positions[i + 1]},${positions[i + 2]}`);
  return set.size;
}

// One operand through the real pipeline. Returns the distance instance, its scaleFactor, its welded
// distance triangles (for claim i), and its §3 band contribution (for claim ii).
function makeOperand(matrix) {
  const canonical = build(compactAndWeld(rawView(), { weldEpsilon: WELD }));
  const cls = classifyClearanceTransform(matrix, canonical.geometry.boundingBox);
  if (cls.path === 'uniform') {
    return {
      path: 'uniform', scaleFactor: cls.scaleFactor,
      instance: { geometry: canonical.geometry, bvh: canonical.bvh, localDiagonal: canonical.localDiagonal, matrix },
      weldedTris: trianglesOf(canonical.geometry.attributes.position.array, canonical.geometry.index.array, matrix),
      band: 0, // legacy path: the canonical weld here merges only exact duplicates
    };
  }
  if (cls.path !== 'derived') return { path: 'unsupported', cause: cls.cause };
  const derived = buildDerivedGeometry(rawView(), { weldEpsilon: WELD, scale: cls.scale });
  assert.equal(derived.state, 'ready');
  let m = 0;
  const scaledRaw = new Float32Array(RAW_POS.length);
  for (let i = 0; i < RAW_POS.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      m = Math.max(m, Math.abs(RAW_POS[i + k] * cls.scale[k]));
      scaledRaw[i + k] = RAW_POS[i + k] * cls.scale[k];
    }
  }
  const merged = derived.triangleCount > 0
    && distinctPositionCount(derived.geometry.attributes.position.array) < distinctPositionCount(scaledRaw);
  return {
    path: 'derived', scaleFactor: validateUniformScale(cls.rigid).scaleFactor,
    instance: { geometry: derived.geometry, bvh: derived.bvh, localDiagonal: derived.localDiagonal, matrix: cls.rigid },
    weldedTris: trianglesOf(derived.geometry.attributes.position.array, derived.geometry.index.array, cls.rigid),
    band: SQRT3 * (F32 * m + (merged ? WELD : 0)),
  };
}

function runCase(MA, MB, chooseClearance) {
  const A = makeOperand(MA);
  const B = makeOperand(MB);
  if (A.path === 'unsupported' || B.path === 'unsupported') return { unsupported: [A.cause, B.cause] };
  const rawTruth = bruteMin(trianglesOf(RAW_POS, RAW_IDX, MA), trianglesOf(RAW_POS, RAW_IDX, MB));
  const toleranceFloor = computeToleranceFloor(
    { localDiagonal: A.instance.localDiagonal, scaleFactor: A.scaleFactor },
    { localDiagonal: B.instance.localDiagonal, scaleFactor: B.scaleFactor },
    surfaceEpsilonFactor,
  );
  const band = A.band + B.band + 1e-12 * (1 + rawTruth); // + float64 arithmetic slack
  const clearance = chooseClearance(rawTruth, band);
  const result = clearanceQuery(A.instance, B.instance, { clearance, toleranceFloor });
  return { A, B, rawTruth, toleranceFloor, band, clearance, result };
}

function maxWorldDiagonal(c) {
  return Math.max(c.A.instance.localDiagonal * c.A.scaleFactor, c.B.instance.localDiagonal * c.B.scaleFactor);
}

// Asserts claims (i) and (ii) for one case; returns the classification tallies.
function checkCase(c, label, stats) {
  assert.ok(!c.result.aborted, `${label}: aborted (${JSON.stringify(c.result.diagnostics)})`);
  if (c.result.distance !== null && c.result.distance !== undefined) {
    const welded = bruteMin(c.A.weldedTris, c.B.weldedTris);
    const allowed = clearanceCrossCheckAllowedDisagreement(Math.max(c.result.distance, welded), maxWorldDiagonal(c));
    assert.ok(Math.abs(c.result.distance - welded) <= allowed,
      `${label}: (i) query exactness |${c.result.distance} - ${welded}| > ${allowed}`);
    assert.ok(Math.abs(c.result.distance - c.rawTruth) <= c.band,
      `${label}: (ii) |d - rawTruth| = ${Math.abs(c.result.distance - c.rawTruth)} > band ${c.band}`);
    stats.maxAbsErr = Math.max(stats.maxAbsErr, Math.abs(c.result.distance - c.rawTruth));
  }
  const ambiguous = Math.abs(c.rawTruth - c.clearance) <= c.band || Math.abs(c.rawTruth - c.toleranceFloor) <= c.band;
  if (ambiguous) { stats.ambiguous++; return; }
  const expectHit = c.rawTruth <= c.clearance && c.rawTruth > c.toleranceFloor;
  if (c.result.withinClearance) {
    stats.hits++;
    assert.ok(expectHit, `${label}: false positive (truth ${c.rawTruth}, clearance ${c.clearance})`);
  } else {
    stats.misses++;
    assert.ok(!expectHit, `${label}: false negative (truth ${c.rawTruth}, clearance ${c.clearance})`);
  }
}

function randomRotation(rnd) {
  return new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
}

function makeMatrix(rnd, scale, translation, reflect) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(...translation), randomRotation(rnd), new THREE.Vector3(...scale));
  if (reflect) {
    const e = M.elements;
    const k = Math.floor(rnd() * 3);
    for (let j = 0; j < 3; j++) e[k * 4 + j] *= -1;
  }
  return M;
}

test('seeded synthetic sweep (proto2 port): 300 pairs, flat axes, reflections, mixed uniform/derived', () => {
  const rnd = makeRng(12345);
  const stats = { cases: 0, hits: 0, misses: 0, ambiguous: 0, maxAbsErr: 0, reflected: 0, flat: 0, mixed: 0 };
  for (let n = 0; n < 300; n++) {
    const flat = n % 5 === 0;
    const reflect = n % 3 === 0;
    const mixed = n % 4 === 1;
    const sA = flat ? [1 + 30 * rnd(), 6e-6, 1 + 30 * rnd()] : [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const sB = mixed ? (() => { const u = 0.5 + 3 * rnd(); return [u, u, u]; })() : [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const MA = makeMatrix(rnd, sA, [0, 0, 0], reflect);
    const MB = makeMatrix(rnd, sB, [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40], reflect && !mixed);
    const pick = rnd();
    const c = runCase(MA, MB, (truth) => truth * (0.5 + pick) + 1e-3);
    if (c.unsupported) {
      // Owner decision O-1: reflected operands stay unsupported (never measured).
      assert.ok(reflect, `case ${n}: only reflected operands may be unsupported, got ${c.unsupported}`);
      assert.ok(c.unsupported.includes('reflected'));
      stats.reflected++;
      continue;
    }
    stats.cases++;
    if (flat) stats.flat++;
    if (mixed) stats.mixed++;
    checkCase(c, `case ${n}`, stats);
  }
  assert.equal(stats.reflected, 100, 'every reflected case stays unsupported (O-1)');
  assert.equal(stats.cases, 200);
  assert.ok(stats.flat >= 30 && stats.mixed >= 45, JSON.stringify(stats));
  assert.ok(stats.hits > 50 && stats.misses > 50, `both outcomes exercised: ${JSON.stringify(stats)}`);
});

test('large-origin cases (translation ~1e5): exact and inside the band', () => {
  const rnd = makeRng(777);
  const stats = { hits: 0, misses: 0, ambiguous: 0, maxAbsErr: 0 };
  const origin = [1e5, -1.3e5, 0.7e5];
  for (let n = 0; n < 40; n++) {
    const sA = [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const sB = [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const MA = makeMatrix(rnd, sA, origin, false);
    const MB = makeMatrix(rnd, sB, origin.map((o) => o + (rnd() - 0.5) * 40), false);
    const pick = rnd();
    const c = runCase(MA, MB, (truth) => truth * (0.5 + pick) + 1e-3);
    assert.ok(!c.unsupported);
    checkCase(c, `large-origin case ${n}`, stats);
  }
  assert.ok(stats.hits > 0 && stats.misses > 0, JSON.stringify(stats));
});

test('threshold-boundary cases: clearance = truth +/- 2 x band decides exactly', () => {
  const rnd = makeRng(4242);
  let checked = 0;
  for (let n = 0; n < 40; n++) {
    const sA = [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const sB = [0.2 + 20 * rnd(), 0.2 + 20 * rnd(), 0.2 + 20 * rnd()];
    const MA = makeMatrix(rnd, sA, [0, 0, 0], false);
    const MB = makeMatrix(rnd, sB, [(rnd() - 0.5) * 40, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40], false);
    for (const sign of [+1, -1]) {
      const c = runCase(MA, MB, (truth, band) => truth + sign * 2 * band);
      assert.ok(!c.unsupported);
      if (c.clearance <= 0 || c.rawTruth - c.toleranceFloor <= 2 * c.band) continue; // touching/overlapping pairs
      const stats = { hits: 0, misses: 0, ambiguous: 0, maxAbsErr: 0 };
      checkCase(c, `boundary case ${n} sign ${sign}`, stats);
      assert.equal(stats.ambiguous, 0);
      assert.equal(c.result.withinClearance === true, sign > 0, `boundary case ${n} sign ${sign}`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `checked ${checked}`);
});

test('the SVF2-style flat-axis weld merge is reflected in the band (merged * eps_w term)', () => {
  // s_y = 6e-6: the derived mesh's y extent (6e-6) is below the 1e-4 world weld -> distinct vertices
  // merge, and the band includes sqrt(3) * eps_w for that operand.
  const rnd = makeRng(99);
  const A = makeOperand(makeMatrix(rnd, [10, 6e-6, 10], [0, 0, 0], false));
  assert.equal(A.path, 'derived');
  assert.ok(A.band >= SQRT3 * WELD);
  const B = makeOperand(makeMatrix(rnd, [3, 4, 5], [0, 0, 0], false));
  assert.equal(B.path, 'derived');
  assert.ok(B.band < SQRT3 * WELD, 'no distinct-vertex merge for a well-proportioned operand');
});
