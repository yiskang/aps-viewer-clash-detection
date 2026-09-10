// test/performance/m4/rewrite-specifiers.test.mjs
//
// M4 Task 3.9: pure unit tests for `rewriteBareSpecifiers`, the bounded Node-only build variant's
// core logic (§17's S1' row -- "at most one bounded build/rewrite variant"). Written first per TDD;
// see rewrite-specifiers.mjs for the implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteBareSpecifiers } from './rewrite-specifiers.mjs';

test('rewriteBareSpecifiers: rewrites a bare "three" import to the relative vendor path', () => {
  const src = `import * as THREE from 'three';\nconsole.log(THREE);`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' });
  assert.match(out, /from '\.\.\/\.\.\/\.\.\/wwwroot\/vendor\/three\/build\/three\.module\.js'/);
});

test('rewriteBareSpecifiers: rewrites "three-mesh-bvh" identically', () => {
  const src = `import { MeshBVH } from "three-mesh-bvh";`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' });
  assert.match(out, /from "\.\.\/\.\.\/\.\.\/wwwroot\/vendor\/three-mesh-bvh\/src\/index\.js"/);
});

test('rewriteBareSpecifiers: leaves an already-relative import untouched', () => {
  const src = `import { foo } from './local-helper.mjs';`;
  assert.equal(rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' }), src);
});

test('rewriteBareSpecifiers: preserves quote style per-match', () => {
  const src = `import a from 'three'; import b from "three-mesh-bvh";`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: 'v/' });
  assert.match(out, /from 'v\/three\/build\/three\.module\.js'/);
  assert.match(out, /from "v\/three-mesh-bvh\/src\/index\.js"/);
});
