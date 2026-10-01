// test/acceptance/clashpanel-viewerbridge.acceptance.c20.test.mjs
//
// Offline tests for the C20 overlay-rendering oracle and N8 (procedure §C20, §7 N8, Table T17–T20,
// rule (a)) on SYNTHETIC RGBA pixel arrays: analytic footprints, dilation, lossless run-length
// evidence, the positive-evidence-only PASS path, every NOT_EVIDENCED reason (unstable frames,
// camera moved, overlap, sub-pixel sphere, no change, locality, attribution, post-clear mismatch,
// dsf, evidence-too-large), BLOCKED preconditions/deadlines, N8 null-change / displaced /
// not-discriminating / not-applicable, and a fuzz assertion that C20 never returns FAIL.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_T, cameraSample, projectToPixel, cameraFromSample, computeC20Footprints, buildC20Masks, changedPixelIndices, runLengthEncode, runLengthDecode,
  overlayRenderingOracle, evaluateN8, evaluateC20, selectC20Target, C20_REASONS, validateCheckRecord, validateControlRecord,
  checkVerdictLabel as vr,
} from './clashpanel-viewerbridge.acceptance.mjs';

// Perspective camera at the origin looking down -z, fov 90°, aspect 1 (THREE column-major).
function perspective(near = 0.1, far = 100) {
  const f = 1; // cot(45°)
  return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const K0 = cameraSample({ matrixWorldInverse: IDENT, projectionMatrix: perspective() });
const W = 200;
const H = 200;

function boxEdgePath(b) {
  const [x0, y0, z0, x1, y1, z1] = b;
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1],
    [x0, y1, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0],
  ];
}

const sphere = { center: [0, 0, -10], Rw: 1 };
const outline = { vertices: boxEdgePath([3, 3, -10.5, 6, 6, -9.5]), transformIdentity: true };

const blank = () => new Uint8Array(W * H * 4);
function paint(frame, x, y, v = 255) { const o = (y * W + x) * 4; frame[o] = v; frame[o + 3] = 255; return frame; }
function linePixel() {
  const cam = cameraFromSample(K0);
  const p = projectToPixel(cam, outline.vertices[0], W, H);
  return [Math.floor(p.px), Math.floor(p.py)];
}

function baseInput(overrides = {}) {
  const fp = computeC20Footprints({ K0, W, H, sphere, outline });
  const off1 = blank();
  const on = paint(paint(blank(), 100, 100), ...linePixel());
  return {
    W, H, dsf: 1, cameras: { K0, K1: [...K0], K2: [...K0], K3: [...K0] }, offAttempts: [{ identical: true }], onAttempts: [{ identical: true }],
    footprints: fp, frames: { off1, on, clear: blank() }, ...overrides,
  };
}

test('analytic footprints: sphere disc radius from the six projected extreme points; outline 15 segments; no overlap', () => {
  const fp = computeC20Footprints({ K0, W, H, sphere, outline });
  assert.deepEqual(fp.sphere.cPx, [100, 100]);
  assert.ok(Math.abs(fp.sphere.rPx - 10) < 0.2, String(fp.sphere.rPx));
  assert.equal(fp.sphere.evaluable, true);
  assert.equal(fp.outline.segments.length, 15);
  assert.equal(fp.outline.evaluable, true);
  assert.equal(fp.overlap, false);
  assert.ok(fp.overlapDistance > fp.sphere.rPx + 2 * TABLE_T.T17.footprintDilationPx);
  const m = buildC20Masks(fp);
  assert.equal(m.DS[100 * W + 100], 1);
  assert.equal(m.DS[100 * W + 100 + 13], 0); // r=10 + δ=2 < 13
  const [lx, ly] = linePixel();
  assert.equal(m.DL[ly * W + lx], 1);
});

test('run-length evidence is lossless and row-major', () => {
  const idx = [3, 4, 5, 9, 200, 201];
  assert.deepEqual(runLengthEncode(idx), [[3, 3], [9, 1], [200, 2]]);
  assert.deepEqual(runLengthDecode(runLengthEncode(idx)), idx);
  const a = blank(); const b = paint(blank(), 1, 0, 7);
  assert.deepEqual(changedPixelIndices(a, b, W, H), [1]);
  assert.throws(() => changedPixelIndices(a, new Uint8Array(4), W, H));
});

test('PASS: R1–R6 hold and N8 detects => C20 PASS (positive evidence only) with recomputable evidence', () => {
  const input = baseInput();
  const o = overlayRenderingOracle(input);
  assert.equal(o.verdict, 'PASS');
  assert.deepEqual(o.R, { R1: true, R2: true, R3: true, R4: true, R5: true, R6: true });
  assert.equal(o.counts.X, 2);
  const r = evaluateC20({ target: { row: { dbId: 1 } }, preconditions: { bridgeAlive: true, dsf: true }, oracleInput: input });
  assert.equal(r.record.verdict, 'PASS');
  assert.equal(r.n8.state, 'DETECTED');
  assert.equal(r.c20.R.R7, true);
  assert.deepEqual(r.c20.changedRle, runLengthEncode(changedPixelIndices(input.frames.on, input.frames.off1, W, H)));
  assert.equal(r.c20.n8.shiftPx, 100);
  assert.equal(typeof r.c20.frameSha256.on, 'string');
  assert.equal(validateCheckRecord(r.record).ok, true);
  assert.equal(validateControlRecord('N8', r.n8).ok, true);
});

test('NOT_EVIDENCED reasons (never FAIL): dsf, unstable-frame, camera-moved, not-evaluable, overlap, no-change, locality, attribution, post-clear', () => {
  const v = (input) => overlayRenderingOracle(input).verdict;
  assert.equal(v(baseInput({ dsf: 2 })), 'NOT_EVIDENCED(dsf)');
  assert.equal(v(baseInput({ offAttempts: [{ identical: false }, { identical: false }] })), 'NOT_EVIDENCED(unstable-frame)');
  assert.equal(v(baseInput({ offAttempts: [{ identical: false }, { identical: true }] })), 'PASS'); // attempt 2 identical is fine
  assert.equal(v(baseInput({ onAttempts: [{ identical: false }, { identical: false }] })), 'NOT_EVIDENCED(unstable-frame)');
  assert.throws(() => overlayRenderingOracle(baseInput({ offAttempts: [{ identical: false }, { identical: false }, { identical: true }] })));
  const moved = [...K0]; moved[12] += 1e-12;
  assert.equal(v(baseInput({ cameras: { K0, K1: [...K0], K2: moved, K3: [...K0] } })), 'NOT_EVIDENCED(camera-moved)');
  // sub-pixel sphere (r_px < 2, T18)
  const tiny = computeC20Footprints({ K0, W, H, sphere: { center: [0, 0, -10], Rw: 0.01 }, outline });
  assert.equal(tiny.sphere.evaluable, false);
  assert.ok(tiny.sphere.reasons.includes('sub-pixel-sphere'));
  assert.equal(v(baseInput({ footprints: tiny })), 'NOT_EVIDENCED(not-evaluable)');
  // outline with a non-identity transform is not evaluable
  assert.equal(v(baseInput({ footprints: computeC20Footprints({ K0, W, H, sphere, outline: { ...outline, transformIdentity: false } }) })), 'NOT_EVIDENCED(not-evaluable)');
  // overlap: sphere next to the outline
  const near = computeC20Footprints({ K0, W, H, sphere: { center: [3.2, 3.2, -10], Rw: 0.2 }, outline });
  assert.equal(near.overlap, true);
  assert.equal(v(baseInput({ footprints: near })), 'NOT_EVIDENCED(footprint-overlap)');
  const input = baseInput();
  assert.equal(v({ ...input, frames: { ...input.frames, on: blank() } }), 'NOT_EVIDENCED(no-change-observed)');
  assert.equal(v({ ...input, frames: { ...input.frames, on: paint(input.frames.on.slice(), 5, 190) } }), 'NOT_EVIDENCED(locality-violation)');
  assert.equal(v({ ...input, frames: { ...input.frames, on: paint(blank(), 100, 100) } }), 'NOT_EVIDENCED(attribution-missing)');
  assert.equal(v({ ...input, frames: { ...input.frames, clear: paint(blank(), 0, 0, 1) } }), 'NOT_EVIDENCED(post-clear-mismatch)');
});

test('evidence-too-large: a changed-pixel run list above 1 MiB => NOT_EVIDENCED(evidence-too-large), never PASS', () => {
  const W2 = 1024; const H2 = 1024;
  const fp = computeC20Footprints({ K0, W: W2, H: H2, sphere, outline });
  const on = new Uint8Array(W2 * H2 * 4);
  for (let p = 0; p < W2 * H2; p += 2) on[p * 4] = 1; // alternating pixels => ~524k runs
  const o = overlayRenderingOracle({ W: W2, H: H2, dsf: 1, cameras: { K0, K1: K0, K2: K0, K3: K0 }, offAttempts: [{ identical: true }], onAttempts: [{ identical: true }], footprints: fp, frames: { off1: new Uint8Array(W2 * H2 * 4), on, clear: new Uint8Array(W2 * H2 * 4) } });
  assert.equal(vr(o), 'NOT_EVIDENCED(evidence-too-large)');
  assert.ok(o.listBytes.changed > 1024 * 1024);
});

// H2 (internal review 2026-10-01): a post-clear difference list above 1 MiB makes the REAL
// evaluation NOT_EVIDENCED(evidence-too-large); N8(i) keeps the same F_clear, so it must still see
// NOT_EVIDENCED(no-change-observed) (R2 is judged before the evidence-size cap) -- N8 must not turn
// NOT_DETECTED (§8 row 4 => FAIL) because C20 evidence was merely too large (rule (a)).
test('H2: C20 evidence-too-large (post-clear list > 1 MiB) does not make N8 NOT_DETECTED; null-change is still no-change-observed', () => {
  const W2 = 1024; const H2 = 1024;
  const fp = computeC20Footprints({ K0, W: W2, H: H2, sphere, outline });
  const cam = cameraFromSample(K0);
  const c = projectToPixel(cam, sphere.center, W2, H2);
  const l = projectToPixel(cam, outline.vertices[0], W2, H2);
  const on = new Uint8Array(W2 * H2 * 4);
  for (const [x, y] of [[Math.floor(c.px), Math.floor(c.py)], [Math.floor(l.px), Math.floor(l.py)]]) { const o = (y * W2 + x) * 4; on[o] = 255; on[o + 3] = 255; }
  const clear = new Uint8Array(W2 * H2 * 4);
  for (let p = 0; p < W2 * H2; p += 2) clear[p * 4] = 1; // scattered post-clear difference => ~524k runs
  const input = { W: W2, H: H2, dsf: 1, cameras: { K0, K1: K0, K2: K0, K3: K0 }, offAttempts: [{ identical: true }], onAttempts: [{ identical: true }], footprints: fp, frames: { off1: new Uint8Array(W2 * H2 * 4), on, clear } };
  const real = overlayRenderingOracle(input);
  assert.equal(vr(real), 'NOT_EVIDENCED(evidence-too-large)');
  assert.equal(real.reachedPixelComparison, true);
  assert.ok(real.listBytes.clear > 1024 * 1024);
  const n8 = evaluateN8({ oracleInput: input, oracleResult: real });
  assert.equal(vr(n8.fields.nullChange), 'NOT_EVIDENCED(no-change-observed)');
  assert.notEqual(n8.state, 'NOT_DETECTED');
  const c20 = evaluateC20({ target: { row: {} }, oracleInput: input });
  assert.equal(vr(c20.record), 'NOT_EVIDENCED(evidence-too-large)');
  assert.notEqual(c20.n8.state, 'NOT_DETECTED');
});

test('evaluateC20: no-target, BLOCKED preconditions / structural steps / T5-T7 deadlines, dsf NOT_EVIDENCED; N8 NOT_APPLICABLE on every early exit', () => {
  assert.equal(vr(evaluateC20({ target: null }).record), 'NOT_EVIDENCED(no-target)');
  const t = { row: {} };
  let r = evaluateC20({ target: t, preconditions: { aRContained: false } });
  assert.equal(vr(r.record), 'BLOCKED(precondition:aRContained)');
  assert.equal(r.n8.state, 'NOT_APPLICABLE');
  r = evaluateC20({ target: t, timeouts: { screenshot: true } });
  assert.equal(vr(r.record), 'BLOCKED(timeout:screenshot)');
  r = evaluateC20({ target: t, preconditions: { dsf: false } });
  assert.equal(vr(r.record), 'NOT_EVIDENCED(dsf)');
  r = evaluateC20({ target: t, structural: { a3Markers: false }, oracleInput: baseInput() });
  assert.equal(vr(r.record), 'BLOCKED(precondition:a3Markers)');
  const unstable = baseInput({ offAttempts: [{ identical: false }, { identical: false }], footprints: null, frames: {} });
  r = evaluateC20({ target: t, oracleInput: unstable });
  assert.equal(vr(r.record), 'NOT_EVIDENCED(unstable-frame)');
  assert.equal(r.n8.state, 'NOT_APPLICABLE');
});

test('N8: (i) null-change must be exactly no-change-observed; (ii) displaced footprints must not PASS; overlap of X with displaced footprints => NOT_DISCRIMINATING', () => {
  const input = baseInput();
  const res = overlayRenderingOracle(input);
  const n8 = evaluateN8({ oracleInput: input, oracleResult: res });
  assert.equal(n8.state, 'DETECTED');
  assert.equal(vr(n8.fields.nullChange), 'NOT_EVIDENCED(no-change-observed)');
  assert.equal(vr(n8.fields.displaced), 'NOT_EVIDENCED(locality-violation)');
  // X pixel that also lies in the displaced sphere footprint (x = 100 + 100 wraps to 0)
  const on = input.frames.on.slice();
  paint(on, 0, 100);
  const withWrap = { ...input, frames: { ...input.frames, on } };
  const n8b = evaluateN8({ oracleInput: withWrap, oracleResult: overlayRenderingOracle(withWrap) });
  assert.equal(n8b.state, 'NOT_DISCRIMINATING');
  const c20 = evaluateC20({ target: { row: {} }, oracleInput: withWrap });
  assert.notEqual(c20.record.verdict, 'PASS');
  // not applicable when pixel comparison was not reached
  assert.equal(evaluateN8({ oracleInput: input, oracleResult: overlayRenderingOracle(baseInput({ dsf: 2 })) }).state, 'NOT_APPLICABLE');
});

test('N8 negative control: a defective oracle that PASSes a null-change or displaced input => NOT_DETECTED', () => {
  const input = baseInput();
  const res = overlayRenderingOracle(input);
  const alwaysPass = () => ({ verdict: 'PASS', reason: null, reachedPixelComparison: true });
  assert.equal(evaluateN8({ oracleInput: input, oracleResult: res, oracle: alwaysPass }).state, 'NOT_DETECTED');
  // correct on the null-change input but blind to locality (PASS on displaced footprints)
  const localityBlind = (x) => (x.masks ? { verdict: 'PASS', reason: null, reachedPixelComparison: true } : overlayRenderingOracle(x));
  assert.equal(evaluateN8({ oracleInput: input, oracleResult: res, oracle: localityBlind }).state, 'NOT_DETECTED');
  // and C20 can then never PASS: its R7 requires N8 DETECTED
  assert.equal(evaluateN8({ oracleInput: input, oracleResult: res }).state, 'DETECTED');
});

test('fuzz: the C20 oracle / evaluator never returns FAIL (rule (a)); every verdict reason is in the declared list', () => {
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let n = 0; n < 150; n += 1) {
    const input = baseInput({
      dsf: rand() < 0.1 ? 2 : 1,
      offAttempts: rand() < 0.2 ? [{ identical: false }, { identical: rand() < 0.5 }] : [{ identical: true }],
      onAttempts: rand() < 0.2 ? [{ identical: false }, { identical: rand() < 0.5 }] : [{ identical: true }],
    });
    const on = blank();
    const k = Math.floor(rand() * 6);
    for (let i = 0; i < k; i += 1) paint(on, Math.floor(rand() * W), Math.floor(rand() * H));
    if (rand() < 0.5) paint(on, 100, 100);
    if (rand() < 0.5) paint(on, ...linePixel());
    input.frames.on = on;
    if (rand() < 0.2) input.frames.clear = paint(blank(), 3, 3);
    if (rand() < 0.2) { const m = [...K0]; m[0] += 1e-9; input.cameras.K3 = m; }
    const r = evaluateC20({ target: { row: {} }, oracleInput: input });
    assert.ok(!r.record.verdict.startsWith('FAIL'), r.record.verdict);
    assert.ok(r.record.verdict === 'PASS' || C20_REASONS.includes(r.record.reason), r.record.verdict);
  }
});

test('a_r target: model A, all extents > 0, minimal half-diagonal, ties by lowest dbId', () => {
  const table = [
    { model: 'A', dbId: 9, candidateBox: [0, 0, 0, 1, 1, 1], outcome: 'contained' },
    { model: 'A', dbId: 4, candidateBox: [0, 0, 0, 1, 1, 1], outcome: 'contained' },
    { model: 'A', dbId: 2, candidateBox: [0, 0, 0, 0, 1, 1], outcome: 'contained' }, // zero extent
    { model: 'B', dbId: 1, candidateBox: [0, 0, 0, 0.1, 0.1, 0.1], outcome: 'contained' },
    { model: 'A', dbId: 7, candidateBox: [0, 0, 0, 2, 2, 2], outcome: 'contained' },
  ];
  assert.equal(selectC20Target(table).row.dbId, 4);
  assert.equal(selectC20Target([{ model: 'B', dbId: 1, candidateBox: [0, 0, 0, 1, 1, 1] }]), null);
});
