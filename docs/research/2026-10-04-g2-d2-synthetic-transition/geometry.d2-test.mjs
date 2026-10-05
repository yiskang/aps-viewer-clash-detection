import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeometryStudy, separation, observe } from './geometry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
const r1 = JSON.parse(readFileSync(join(here, '..', 'evidence', 'g2-live-20261004-75a3ccb9', 'R1-clashpanel-viewerbridge-g2-result.json'), 'utf8'));
const run = () => runGeometryStudy({ fixtures, r1 });
const alpha = 676 / 380;

test('L_N2stale O1 = kappa-1 regardless of d (nominal camera)', () => {
  for (const d of fixtures.geometry.d) for (const dy of [0, 38]) {
    const A = { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5 };
    const B = { x0: d - 0.5, x1: d + 0.5, y0: dy - 0.5, y1: dy + 0.5 };
    const U = { x0: A.x0, x1: B.x1, y0: Math.min(A.y0, B.y0), y1: Math.max(A.y1, B.y1) };
    assert.ok(Math.abs(observe(U, U, alpha, 0.9, 1, 0, 0).O1 - -0.1) < 1e-12);
  }
});
test('as d->0 P_N2 O1 -> kappa-1', () => {
  const A = { x0: -0.5, x1: 0.5, y0: -0.5, y1: 0.5 };
  const d = 1e-6;
  const B = { x0: d - 0.5, x1: d + 0.5, y0: -0.5, y1: 0.5 };
  const U = { x0: -0.5, x1: d + 0.5, y0: -0.5, y1: 0.5 };
  assert.ok(Math.abs(observe(U, B, alpha, 0.9, 1, 0, 0).O1 - -0.1) < 1e-5);
  assert.ok(A);
});
test('determinism', () => { assert.equal(JSON.stringify(run()), JSON.stringify(run())); });
test('evaluationCount 7200 and RET-U ok', () => {
  const r = run();
  assert.equal(r.geometry.evaluationCount, 7200);
  assert.ok(r.geometry.retUConsistency.ok);
  assert.ok(Math.abs(r.geometry.retUConsistency.worstExcess + 0.1) <= 1e-6);
});
test('size cap', () => { assert.ok(JSON.stringify(run().geometry).length <= 256 * 1024); });
test('fail closed on non-bit-identical retained distance', () => {
  const bad = structuredClone(r1);
  bad.targets.fitPair.distance = r1.targets.fitPair.distance + 1e-9;
  assert.throws(() => runGeometryStudy({ fixtures, r1: bad }), /bit-identical/);
  const badF = structuredClone(fixtures);
  badF.geometry.retainedPairDistance = 263.857149497467;
  assert.throws(() => runGeometryStudy({ fixtures: badF, r1 }), /bit-identical/);
});
test('every emitted object carries synthetic:true', () => {
  const walk = (o, path) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      assert.equal(o.synthetic, true, `missing synthetic at ${path}`);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    } else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`));
  };
  const r = run();
  walk(r.geometry, 'geometry');
  walk(r.outcomeControl, 'outcomeControl');
});
test('separation/stable rule hand-computed', () => {
  const iv = (min, max) => ({ min, max, width: max - min });
  // lo/hi: a=[0,1], b=[4,5]: sep=3, 3*max(w)=3 -> stable (>=), midpoint 2.5
  let s = separation(iv(0, 1), iv(4, 5));
  assert.equal(s.sep, 3); assert.equal(s.stable, true); assert.equal(s.candidateSeparator, 2.5);
  // orientation independent
  assert.equal(separation(iv(4, 5), iv(0, 1)).sep, 3);
  // b=[3.5,4.5]: sep=2.5 < 3 -> not stable
  s = separation(iv(0, 1), iv(3.5, 4.5));
  assert.equal(s.sep, 2.5); assert.equal(s.stable, false); assert.equal(s.candidateSeparator, null);
  // overlap / touching -> not separated
  assert.equal(separation(iv(0, 1), iv(1, 2)).stable, false);
  assert.equal(separation(iv(0, 2), iv(1, 3)).stable, false);
  // max(w)=0 branch: reduces to sep>0
  s = separation(iv(1, 1), iv(1.5, 1.5));
  assert.equal(s.sep, 0.5); assert.equal(s.stable, true);
  assert.equal(separation(iv(1, 1), iv(1, 1)).stable, false);
});
