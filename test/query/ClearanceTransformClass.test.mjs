// test/query/ClearanceTransformClass.test.mjs
//
// SVF2 non-uniform fragment clearance design §5.1 / §8 T1: per-operand clearance transform
// classification (`'uniform'` legacy path / `'derived'` prescaled path / `'unsupported'`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { classifyClearanceTransform } from '../../collision/query/ClearanceTransformClass.js';
import { validateUniformScale } from '../../collision/query/ClearanceTransform.js';

const UNIT_BOX = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));

function compose({ at = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
}

// Asserts rigid * diag(scale) reproduces the input's linear part (relative 1e-15 of the column
// magnitude, i.e. float64 rounding) and carries the input's translation exactly.
function assertReconstructs(matrix, result) {
  const e = matrix.elements;
  const r = result.rigid.elements;
  for (let col = 0; col < 3; col++) {
    const s = result.scale[col];
    const mag = Math.hypot(e[col * 4], e[col * 4 + 1], e[col * 4 + 2]);
    for (let row = 0; row < 3; row++) {
      const err = Math.abs(r[col * 4 + row] * s - e[col * 4 + row]);
      assert.ok(err <= 1e-15 * mag, `Q*S != A at col ${col} row ${row}: err ${err}`);
    }
  }
  assert.deepEqual([r[12], r[13], r[14]], [e[12], e[13], e[14]], 'translation carried verbatim');
  assert.deepEqual([r[3], r[7], r[11], r[15]], [0, 0, 0, 1], 'affine bottom row');
  assert.equal(validateUniformScale(result.rigid).valid, true, 'rigid part is inside the M3 supported class');
}

test('uniform scale (incl. rotation/translation) -> legacy path with the exact validateUniformScale scaleFactor', () => {
  for (const spec of [{}, { at: [5, -2, 1e5], rotation: [0.3, 1.1, -0.4], scale: [2.5, 2.5, 2.5] }, { scale: [1e-6, 1e-6, 1e-6] }]) {
    const m = compose(spec);
    const result = classifyClearanceTransform(m, UNIT_BOX);
    assert.equal(result.path, 'uniform');
    assert.ok(Object.is(result.scaleFactor, validateUniformScale(m).scaleFactor));
    assert.deepEqual(Object.keys(result).sort(), ['path', 'scaleFactor']);
  }
});

test('axis-aligned anisotropic scale -> derived, Q*S = A', () => {
  const m = compose({ at: [134.3, 21.1, 3.88], scale: [0.5833333134651184, 0.5833333134651184, 7.333335876464844] });
  const result = classifyClearanceTransform(m, UNIT_BOX);
  assert.equal(result.path, 'derived');
  assert.deepEqual(result.scale, [0.5833333134651184, 0.5833333134651184, 7.333335876464844]);
  assertReconstructs(m, result);
});

test('rotated anisotropic scale -> derived, Q*S = A', () => {
  const m = compose({ at: [-3, 7, 11], rotation: [0.7, -0.2, 2.1], scale: [124.9, 27.2, 7.56] });
  const result = classifyClearanceTransform(m, UNIT_BOX);
  assert.equal(result.path, 'derived');
  assertReconstructs(m, result);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(result.scale[i] - [124.9, 27.2, 7.56][i]) <= 1e-12 * 124.9);
});

test('flat axis (scale 6e-6) -> derived', () => {
  const m = compose({ rotation: [0.1, 0.2, 0.3], scale: [12, 6e-6, 3] });
  const result = classifyClearanceTransform(m, UNIT_BOX);
  assert.equal(result.path, 'derived');
  assertReconstructs(m, result);
});

test('reflected transforms (uniform and anisotropic) -> unsupported/reflected (owner decision O-1)', () => {
  for (const scale of [[-1, 1, 1], [-1, 2, 1], [3, 0.5, -7]]) {
    const result = classifyClearanceTransform(compose({ at: [1, 2, 3], rotation: [0.4, 0, 0.2], scale }), UNIT_BOX);
    assert.deepEqual(result, { path: 'unsupported', cause: 'reflected' });
  }
});

test('shear beyond 1e-4 -> unsupported/non-orthogonal', () => {
  const sheared = new THREE.Matrix4().set(
    1, 0.25, 0, 2.5,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  assert.deepEqual(classifyClearanceTransform(sheared, UNIT_BOX), { path: 'unsupported', cause: 'non-orthogonal' });
  // Anisotropic AND sheared.
  const both = new THREE.Matrix4().set(
    3, 0.01, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0,
    0, 0, 0, 1,
  );
  assert.deepEqual(classifyClearanceTransform(both, UNIT_BOX), { path: 'unsupported', cause: 'non-orthogonal' });
});

test('residual non-orthogonality within 1e-4 is admitted (inherits M3 residual bound)', () => {
  const nearly = new THREE.Matrix4().set(
    3, 3e-5, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0,
    0, 0, 0, 1,
  );
  assert.equal(classifyClearanceTransform(nearly, UNIT_BOX).path, 'derived');
});

test('huge anisotropic scale beyond the float32 domain -> unsupported/numeric-domain', () => {
  const huge = compose({ scale: [1e39, 1, 1] });
  assert.deepEqual(classifyClearanceTransform(huge, UNIT_BOX), { path: 'unsupported', cause: 'numeric-domain' });
  // The domain is measured on the operand's own local box, not the unit cube.
  const okBox = new THREE.Box3(new THREE.Vector3(-1e-3, -1, -1), new THREE.Vector3(1e-3, 1, 1));
  assert.equal(classifyClearanceTransform(huge, okBox).path, 'derived');
  // A missing/non-finite local box can never be shown to be inside the domain.
  assert.deepEqual(classifyClearanceTransform(compose({ scale: [2, 1, 1] }), null), { path: 'unsupported', cause: 'numeric-domain' });
});

test('projective / non-finite -> unsupported/other', () => {
  const projective = compose({ scale: [2, 1, 1] });
  projective.elements[3] = 0.1;
  assert.deepEqual(classifyClearanceTransform(projective, UNIT_BOX), { path: 'unsupported', cause: 'other' });
  const nonFinite = compose({ scale: [2, 1, 1] });
  nonFinite.elements[5] = NaN;
  assert.deepEqual(classifyClearanceTransform(nonFinite, UNIT_BOX), { path: 'unsupported', cause: 'other' });
  const singular = compose({ scale: [2, 1, 1] });
  singular.elements[0] = 0; singular.elements[1] = 0; singular.elements[2] = 0;
  assert.deepEqual(classifyClearanceTransform(singular, UNIT_BOX), { path: 'unsupported', cause: 'other' });
});

test('two back-to-back classifications return non-aliased rigid/scale and never mutate the input', () => {
  const a = compose({ at: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 3, 4] });
  const b = compose({ at: [-5, 0, 9], rotation: [1.0, -0.5, 0.25], scale: [7, 0.5, 1] });
  const aBefore = a.elements.slice();
  const bBefore = b.elements.slice();
  const ra = classifyClearanceTransform(a, UNIT_BOX);
  const raRigid = ra.rigid.elements.slice();
  const raScale = ra.scale.slice();
  const rb = classifyClearanceTransform(b, UNIT_BOX);
  assert.notEqual(ra.rigid, rb.rigid);
  assert.notEqual(ra.scale, rb.scale);
  assert.notEqual(ra.rigid, a);
  assert.deepEqual(ra.rigid.elements, raRigid, 'first result unchanged by the second call');
  assert.deepEqual(ra.scale, raScale);
  assert.deepEqual(a.elements, aBefore);
  assert.deepEqual(b.elements, bBefore);
  // Mutating a result does not leak into a later call.
  ra.rigid.elements[12] = 999;
  ra.scale[0] = 999;
  const again = classifyClearanceTransform(a, UNIT_BOX);
  assert.deepEqual(again.rigid.elements, raRigid);
  assert.deepEqual(again.scale, raScale);
});

test('every SVF2 Audubon fixture matrix is derived except the 2 reflected Arch frags and the 5 uniform ones', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/svf2-audubon-fragment-matrices.json', import.meta.url), 'utf8'));
  const counts = {};
  const reflected = [];
  for (const key of ['struct', 'arch']) {
    const { fragCount, matricesFloat32Base64 } = fixture[key];
    const bytes = Buffer.from(matricesFloat32Base64, 'base64');
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    assert.equal(floats.length, fragCount * 16);
    const c = { uniform: 0, derived: 0, reflected: 0, other: 0 };
    for (let f = 0; f < fragCount; f++) {
      const m = new THREE.Matrix4().fromArray(Array.from(floats.subarray(f * 16, f * 16 + 16)));
      // SVF2 normalizes every mesh to the [-0.5, 0.5]^3 unit cube (design §1).
      const result = classifyClearanceTransform(m, UNIT_BOX);
      if (result.path === 'unsupported' && result.cause === 'reflected') { c.reflected++; reflected.push(`${key}:${f}`); }
      else if (result.path === 'uniform' || result.path === 'derived') c[result.path]++;
      else c.other++;
      if (result.path === 'derived') {
        const e = m.elements;
        const r = result.rigid.elements;
        for (let col = 0; col < 3; col++) {
          const mag = Math.hypot(e[col * 4], e[col * 4 + 1], e[col * 4 + 2]);
          for (let row = 0; row < 3; row++) {
            assert.ok(Math.abs(r[col * 4 + row] * result.scale[col] - e[col * 4 + row]) <= 1e-15 * mag);
          }
        }
      }
    }
    counts[key] = c;
  }
  assert.deepEqual(counts.struct, { uniform: 2, derived: 541, reflected: 0, other: 0 });
  assert.deepEqual(counts.arch, { uniform: 3, derived: 5430, reflected: 2, other: 0 });
  assert.deepEqual(reflected, ['arch:2820', 'arch:2821']);
});

// ---- Amendment (owner-authorized, 2026-10-07): no-clearance-surface classification -------------------
// A canonical record with 0 triangles has no clearance surface. Classified AFTER the uniform rule (the
// legacy path stays byte-identical) and BEFORE every anisotropic-eligibility rule, so neither an empty
// position set (empty bbox) nor a two-vertex line (non-empty bbox) is ever reported as an unsupported
// transform. Absent/positive triangleCount keeps the pre-amendment classification exactly.

const EMPTY_BOX = new THREE.Box3(); // min +Infinity, max -Infinity: what an empty canonical record carries
const LINE_BOX = new THREE.Box3(new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 0, 0));
const SHEAR = new THREE.Matrix4().set(1, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

test('no-surface: triangleCount 0 under any non-uniform transform -> no-surface (empty bbox and line bbox alike)', () => {
  const transforms = [
    ['anisotropic', compose({ at: [1, 2, 3], scale: [1, 2.5, 1] })],
    ['rotated anisotropic', compose({ rotation: [0.3, 0.2, 1.1], scale: [124.9, 27.2, 7.56] })],
    ['flat axis', compose({ scale: [1, 6e-6, 1] })],
    ['reflected', compose({ scale: [1, -2, 1] })],
    ['reflected uniform', compose({ scale: [-1, 1, 1] })],
    ['shear', SHEAR],
    ['huge', compose({ scale: [1e39, 1, 1] })],
  ];
  for (const [name, m] of transforms) {
    for (const box of [EMPTY_BOX, LINE_BOX, UNIT_BOX]) {
      const result = classifyClearanceTransform(m, box, { triangleCount: 0 });
      assert.deepEqual(result, { path: 'no-surface' }, name);
    }
  }
});

test('no-surface: a UNIFORM operand with 0 triangles keeps the unchanged legacy uniform path', () => {
  for (const spec of [{}, { at: [5, -2, 1e5], rotation: [0.3, 1.1, -0.4], scale: [2.5, 2.5, 2.5] }]) {
    const m = compose(spec);
    for (const box of [EMPTY_BOX, LINE_BOX]) {
      const result = classifyClearanceTransform(m, box, { triangleCount: 0 });
      assert.equal(result.path, 'uniform');
      assert.ok(Object.is(result.scaleFactor, validateUniformScale(m).scaleFactor));
      assert.deepEqual(Object.keys(result).sort(), ['path', 'scaleFactor']);
    }
  }
});

test('no-surface: absent or positive triangleCount keeps the pre-amendment classification exactly', () => {
  const aniso = compose({ scale: [1, 2.5, 1] });
  // Without triangleCount the empty bbox still lands in numeric-domain, as before the amendment.
  assert.deepEqual(classifyClearanceTransform(aniso, EMPTY_BOX), { path: 'unsupported', cause: 'numeric-domain' });
  assert.deepEqual(classifyClearanceTransform(aniso, EMPTY_BOX, {}), { path: 'unsupported', cause: 'numeric-domain' });
  for (const triangleCount of [undefined, 1, 12]) {
    assert.equal(classifyClearanceTransform(aniso, LINE_BOX, { triangleCount }).path, 'derived');
    assert.deepEqual(classifyClearanceTransform(SHEAR, UNIT_BOX, { triangleCount }), { path: 'unsupported', cause: 'non-orthogonal' });
    assert.deepEqual(classifyClearanceTransform(compose({ scale: [1, -2, 1] }), UNIT_BOX, { triangleCount }), { path: 'unsupported', cause: 'reflected' });
  }
});
