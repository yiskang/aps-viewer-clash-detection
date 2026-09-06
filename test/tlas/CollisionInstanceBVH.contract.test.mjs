// test/tlas/CollisionInstanceBVH.contract.test.mjs
//
// Pins the exact vendored three-mesh-bvh@0.9.14 contract CollisionInstanceBVH (Task 3) depends on
// but that is NOT individually typed in the package's own .d.ts (design spec §5.2). If a future
// `npm run build:vendor` bump changes any of these, this file fails loudly instead of silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BVH } from 'three-mesh-bvh';

test('vendored three-mesh-bvh is pinned at exactly 0.9.14', () => {
  // Fixed after codex-review (Important #3): `three-mesh-bvh`'s package.json is not listed in its
  // own "exports" map, so `import ... from 'three-mesh-bvh/package.json'` throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED under Node's ESM resolver -- confirmed against this repo's
  // installed 0.9.14. Reading the file directly via `fs` bypasses the exports-map restriction
  // (that restriction applies only to module resolution, not raw filesystem access) and needs no
  // JSON-import assertion syntax.
  const pkgPath = fileURLToPath(new URL('../../node_modules/three-mesh-bvh/package.json', import.meta.url));
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.equal(packageJson.version, '0.9.14');
});

test('BVH.prototype.getRootRanges throws before being overridden', () => {
  const bvh = new BVH();
  assert.throws(() => bvh.getRootRanges(), /getRootRanges\(\) not implemented/);
});

test('BVH.prototype.writePrimitiveBounds throws before being overridden', () => {
  const bvh = new BVH();
  assert.throws(() => bvh.writePrimitiveBounds(0, new Float32Array(6), 0), /writePrimitiveBounds\(\) not implemented/);
});

test('BVH constructor exposes primitiveBuffer/primitiveBufferStride as real, initially-null fields', () => {
  const bvh = new BVH();
  assert.equal('primitiveBuffer' in bvh, true);
  assert.equal('primitiveBufferStride' in bvh, true);
  assert.equal(bvh.primitiveBuffer, null);
});

test('BVH.prototype.shapecast exists directly on the base class (not only on MeshBVH)', () => {
  assert.equal(typeof BVH.prototype.shapecast, 'function');
});

test('BVH.prototype.init exists and calls getRootRanges internally, not lazily deferred', () => {
  class Empty extends BVH {
    getRootRanges() { throw new Error('marker-thrown-from-getRootRanges'); }
    writePrimitiveBounds() {}
  }
  assert.throws(() => new Empty().init({}), /marker-thrown-from-getRootRanges/);
});
