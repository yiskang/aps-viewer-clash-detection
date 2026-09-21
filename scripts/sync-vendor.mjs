#!/usr/bin/env node
// scripts/sync-vendor.mjs
//
// Copies the collision runtime's own isolated `three`/`three-mesh-bvh` builds from
// node_modules into wwwroot/vendor/, so the sandbox app (plain <script type="module">,
// no bundler) can resolve them through an import map without ever touching Viewer's
// bundled r71 THREE. Per spec:1038-1076 this MUST copy directory trees, not single
// files -- three-mesh-bvh's `exports.import` is `./src/index.js` (a multi-file source
// tree with relative + bare imports), and three's own `build/three.module.js` imports
// `./three.core.js` from the same directory.
//
// Also copies `three/examples/jsm/utils/BufferGeometryUtils.js` explicitly (spec:1056-1076,
// Round 10 finding) -- `mergeVertices` lives outside `three/build/`, so a vendor tree
// that only copies `three/build/**` 404s the first time welding runs.

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(repoRoot, 'node_modules');
const vendorRoot = path.join(repoRoot, 'wwwroot', 'vendor');
const threeMeshBvhVendorSrc = path.join(vendorRoot, 'three-mesh-bvh', 'src');

const COPIES = [
  { from: path.join(nodeModules, 'three', 'build'), to: path.join(vendorRoot, 'three', 'build') },
  {
    from: path.join(nodeModules, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
    to: path.join(vendorRoot, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
  },
  { from: path.join(nodeModules, 'three-mesh-bvh', 'src'), to: threeMeshBvhVendorSrc },
];

async function syncOne({ from, to }) {
  if (!existsSync(from)) {
    throw new Error(`sync-vendor: source path does not exist: ${from} (did npm install run?)`);
  }
  await mkdir(path.dirname(to), { recursive: true });
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`  copied ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
}

// Fail-closed guard (docs/research/m4-three-mesh-bvh-patch-provenance.md, "I-2" fix wave): this
// script is the ONLY thing every consumer of the copied three-mesh-bvh source routes through --
// `npm start` (prestart), `npm test` (pretest), and `npm run build:vendor` directly -- so it is the
// last point that can catch a `node_modules/three-mesh-bvh` that was never patched (e.g. a
// `postinstall` that got skipped via `--ignore-scripts`, `--omit=dev`, or a restored cache) before
// it gets served to the browser or exercised by tests. This does NOT replace
// `test/vendor/three-mesh-bvh-patch-integrity.test.mjs` (regression test 7) -- that test asserts
// richer, behavioral guarantees and only runs under `npm test`. This is a second, independent,
// always-on layer for exactly the modes that don't run `npm test` at all.
function assertPatchMarkersPresent(vendorSrcRoot) {
  const orientedBoxPath = path.join(vendorSrcRoot, 'math', 'OrientedBox.js');
  const orientedBoxSrc = readFileSync(orientedBoxPath, 'utf8');
  const correctedAssignmentCount = (
    orientedBoxSrc.match(/(?:start|end)\[ f3 \] = i2 \? min\[ f3 \] : max\[ f3 \];/g) || []
  ).length;
  if (correctedAssignmentCount < 2) {
    console.error(
      `sync-vendor: FAIL-CLOSED -- ${path.relative(repoRoot, orientedBoxPath)} is missing the ` +
      'three-mesh-bvh@0.9.14 correctness patch (Patch 2: OrientedBox.distanceToBox\'s max[f3] ' +
      'correction). node_modules/three-mesh-bvh appears unpatched -- did `postinstall` ' +
      '(`patch-package --error-on-fail`) actually run? See ' +
      'docs/research/m4-three-mesh-bvh-patch-provenance.md.',
    );
    process.exit(1);
  }

  // NOTE: the bare `obb2.min.copy( box.min ); obb2.max.copy( box.max ); obb2.needsUpdate = true;`
  // text ALSO appears, unpatched, inside the outer shapecast's pre-existing `intersectsBounds` leaf
  // branch a few lines above -- that's the original (buggy, root-is-leaf-only) seeding Patch 1
  // exists to supplement. Checking that snippet alone would false-negative (never fire) on an
  // unpatched file. The patched `intersectsRange` signature (extra `box` param) exists ONLY after
  // the patch, so both must be checked together -- confirmed empirically against a hand-reverted
  // unpatched copy during this check's own negative-path verification.
  const patchedSignaturePattern = /intersectsRange: \( offset, count, contained, depth, nodeIndex, box \) => \{/;
  const obb2SeedingPattern = /obb2\.min\.copy\( box\.min \);\s*\n\s*obb2\.max\.copy\( box\.max \);\s*\n\s*obb2\.needsUpdate = true;/;
  for (const rel of [
    'core/cast/closestPointToGeometry_indirect.generated.js',
    'core/cast/closestPointToGeometry.generated.js',
  ]) {
    const filePath = path.join(vendorSrcRoot, rel);
    const src = readFileSync(filePath, 'utf8');
    if (!patchedSignaturePattern.test(src) || !obb2SeedingPattern.test(src)) {
      console.error(
        `sync-vendor: FAIL-CLOSED -- ${path.relative(repoRoot, filePath)} is missing the ` +
        'three-mesh-bvh@0.9.14 correctness patch (Patch 1: obb2 seeding in intersectsRange). ' +
        'node_modules/three-mesh-bvh appears unpatched -- did `postinstall` ' +
        '(`patch-package --error-on-fail`) actually run? See ' +
        'docs/research/m4-three-mesh-bvh-patch-provenance.md.',
      );
      process.exit(1);
    }
  }
}

async function main() {
  console.log('sync-vendor: copying isolated three/three-mesh-bvh builds into wwwroot/vendor/ ...');
  for (const entry of COPIES) {
    await syncOne(entry);
  }
  assertPatchMarkersPresent(threeMeshBvhVendorSrc);
  console.log('sync-vendor: done.');
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
