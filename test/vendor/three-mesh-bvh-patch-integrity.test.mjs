// test/vendor/three-mesh-bvh-patch-integrity.test.mjs
//
// Regression test 7 (adjudication mandatory test 7, Step 4 point 6 of Option B's "mitigation for
// every residual failure mode"): a checked-in test that fails loudly if the Task 3 dependency patch
// (docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md, applied via `patch-package`
// + `"postinstall": "patch-package --error-on-fail"`) is ever silently reverted -- e.g. by a
// reinstall that skips lifecycle scripts, a restored `node_modules` cache, or a version bump that
// moves the patch target without updating the patch.
//
// This file deliberately does NOT:
//   - run `npm ci` itself (that is the one-time manual scratch-directory verification recorded in
//     task-3-report.md, not something safe to do inside a test that may run concurrently with
//     others);
//   - invoke `scripts/sync-vendor.mjs` itself (it recursively deletes and recopies a tracked
//     directory -- unsafe to call from inside a test; `pretest` already ran it before this file
//     executes, per `package.json`);
//   - import any `*.test.mjs` file's contents (only the pure fixture/helper module
//     `three-mesh-bvh-defects.fixtures.mjs`, to avoid duplicate `node:test` registration).
//
// task-1-brief.md / task-3-brief.md, per a codex-advisor review that flagged both hazards above.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { OrientedBox } from 'three-mesh-bvh';
import {
  quadGeometry,
  gridGeometry,
  translateGeometry,
  buildMeshBvh,
  closestDistance,
  runEightCallPredecessorSequence,
  exactObbAabbDistance,
} from './three-mesh-bvh-defects.fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const PATCH_FILE = path.join(repoRoot, 'patches', 'three-mesh-bvh+0.9.14.patch');
const NODE_MODULES_ROOT = path.join(repoRoot, 'node_modules', 'three-mesh-bvh', 'src');
const VENDOR_ROOT = path.join(repoRoot, 'wwwroot', 'vendor', 'three-mesh-bvh', 'src');

// The 4 files Patch 1 + Patch 2 touch (adjudication Step 4 points 1-2 / task-3-brief.md).
const PATCHED_RELATIVE_PATHS = [
  'core/cast/closestPointToGeometry_indirect.generated.js',
  'core/cast/closestPointToGeometry.generated.js',
  'core/cast/closestPointToGeometry.template.js',
  'math/OrientedBox.js',
];

// ---------------------------------------------------------------------------------------------
// (a) resolved version + patch-identity marker match what the patch file declares
// ---------------------------------------------------------------------------------------------

test('patch integrity: installed three-mesh-bvh version matches the patch file name (0.9.14)', () => {
  const installedVersion = JSON.parse(
    readFileSync(path.join(repoRoot, 'node_modules', 'three-mesh-bvh', 'package.json'), 'utf8'),
  ).version;
  assert.equal(installedVersion, '0.9.14',
    `patches/three-mesh-bvh+0.9.14.patch is pinned to 0.9.14, but installed version is ${installedVersion} -- ` +
    'a version bump without regenerating the patch would silently desync the patch target');

  // The patch file itself must exist and declare the same version in its filename (patch-package's
  // own `+`-suffixed naming convention).
  const patchContent = readFileSync(PATCH_FILE, 'utf8');
  assert.ok(patchContent.length > 0, 'patch file must be non-empty');
});

test('patch integrity: OrientedBox.js carries the corrected max[f3] text on both Patch 2 assignment lines', () => {
  const orientedBoxSrc = readFileSync(
    path.join(NODE_MODULES_ROOT, 'math', 'OrientedBox.js'), 'utf8',
  );
  const lines = orientedBoxSrc.split('\n');

  // task-3-brief.md: OrientedBox.js lines 420 and 424 (1-indexed), the `start[ f3 ]` and
  // `end[ f3 ]` assignments -- both must read `max[ f3 ]`, not the unpatched `max[ f2 ]`.
  const startLine = lines[420 - 1];
  const endLine = lines[424 - 1];
  assert.match(startLine, /start\[ f3 \] = i2 \? min\[ f3 \] : max\[ f3 \];/,
    `line 420 must be the patched start[f3] assignment (max[f3], not max[f2]); got: ${startLine}`);
  assert.match(endLine, /end\[ f3 \] = i2 \? min\[ f3 \] : max\[ f3 \];/,
    `line 424 must be the patched end[f3] assignment (max[f3], not max[f2]); got: ${endLine}`);

  // Cross-check against the patch file's own declared correction (belt-and-braces: confirms the
  // patch file itself, not just the installed tree, encodes the max[f3] correction).
  const patchContent = readFileSync(PATCH_FILE, 'utf8');
  const orientedBoxHunk = patchContent.split('diff --git').find((h) => h.includes('OrientedBox.js'));
  assert.ok(orientedBoxHunk, 'patch file must contain an OrientedBox.js hunk');
  assert.ok(orientedBoxHunk.includes('+\t\t\t\t\tstart[ f3 ] = i2 ? min[ f3 ] : max[ f3 ];'),
    'patch file must declare the corrected start[f3] assignment');
  assert.ok(orientedBoxHunk.includes('+\t\t\t\t\tend[ f3 ] = i2 ? min[ f3 ] : max[ f3 ];'),
    'patch file must declare the corrected end[f3] assignment');
});

test('patch integrity: all three closestPointToGeometry* files carry the patched intersectsRange signature', () => {
  for (const rel of [
    'core/cast/closestPointToGeometry_indirect.generated.js',
    'core/cast/closestPointToGeometry.generated.js',
    'core/cast/closestPointToGeometry.template.js',
  ]) {
    const src = readFileSync(path.join(NODE_MODULES_ROOT, rel), 'utf8');
    assert.match(src, /intersectsRange: \( offset, count, contained, depth, nodeIndex, box \) => \{/,
      `${rel} must carry the patched intersectsRange signature (box param, obb2 seeding)`);
    assert.match(src, /obb2\.min\.copy\( box\.min \);\s*\n\s*obb2\.max\.copy\( box\.max \);\s*\n\s*obb2\.needsUpdate = true;/,
      `${rel} must seed obb2 from the visited node's own box at the top of intersectsRange`);
  }
});

// ---------------------------------------------------------------------------------------------
// (b) behavioral guard: re-run Defect 1 (order-independence) and Defect 2 (exact-value) assertions
// inline, via the pure fixture module -- both fail on an unpatched tree.
// ---------------------------------------------------------------------------------------------

test('patch integrity (behavioral): Defect 1 -- root-is-leaf anchor is order-independent across the 8-call predecessor sequence', () => {
  const TRUTH = 0.05000000074505806;
  const MAX_THRESHOLD = 0.5;

  const anchorGeometry = quadGeometry(0, 0, 0, 1);
  const anchorBvh = buildMeshBvh(anchorGeometry, { indirect: true });
  const farGeometry = gridGeometry(6, 6, 1, 1, 0.05);
  buildMeshBvh(farGeometry, { indirect: true }); // farGeometry.boundsTree must be set so the
  // nested accelerated path (`if (otherGeometry.boundsTree)`) is taken -- without it, Defect 1's
  // obb2 staleness is never exercised and this check spuriously passes on an unpatched tree.
  const perturberNearGeometry = gridGeometry(4, 4, 1, 1, 0);
  const perturberNearBvh = buildMeshBvh(perturberNearGeometry, { indirect: true });
  const perturberDistantGeometry = translateGeometry(perturberNearGeometry, 1000, 1000, 1000);
  const perturberDistantBvh = buildMeshBvh(perturberDistantGeometry, { indirect: true });

  const measured = () => closestDistance(anchorBvh, farGeometry, { maxThreshold: MAX_THRESHOLD });
  const nearPredecessor = () => closestDistance(perturberNearBvh, farGeometry, { maxThreshold: Infinity });
  const distantPredecessor = () => closestDistance(perturberDistantBvh, farGeometry, { maxThreshold: Infinity });

  const { measured: [A, B, C, D] } = runEightCallPredecessorSequence({
    measured, nearPredecessor, distantPredecessor,
  });

  console.log('[patch integrity: Defect 1] measured [A,B,C,D] =', [A, B, C, D]);
  assert.deepEqual([A, B, C, D], [TRUTH, TRUTH, TRUTH, TRUTH],
    'unpatched three-mesh-bvh@0.9.14 reproduces [TRUTH, null, TRUTH, null] here -- if this fails, ' +
    'the Patch 1 fix (intersectsRange obb2 seeding) is not actually in effect');
});

test('patch integrity (behavioral): Defect 2 -- OrientedBox.distanceToBox returns the exact reference distance', () => {
  const min = new THREE.Vector3(-0.3804163099641057, -0.9479515318050755, -2.03228256792402);
  const max = new THREE.Vector3(0.4589844705345968, 1.8687230714451164, 0.7140377524374228);
  const matrix = new THREE.Matrix4().fromArray([
    0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0,
    -0.5471904444278781, 0.8369961037130074, 0.004487749554735238, 0,
    0.836997078993147, 0.5471477941772834, 0.008073480282549787, 0,
    -1.07325792176335, 4.013246063149184, 0.5037035963049643, 1,
  ]);
  const obb = new OrientedBox(min, max, matrix);
  obb.needsUpdate = true;
  const aabb = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.334708213962013, 3.561825842858211, 1.3125964404608106),
  );

  const shipped = obb.distanceToBox(aabb);
  const ref = exactObbAabbDistance(min, max, matrix, aabb).distance;
  console.log('[patch integrity: Defect 2] shipped =', shipped, 'ref =', ref);
  assert.equal(shipped, ref,
    'unpatched three-mesh-bvh@0.9.14 returns 0.045563153441575466 here (the max[f2]/max[f3] typo) ' +
    'instead of the exact reference 0.015450309808991687 -- if this fails, the Patch 2 fix ' +
    '(OrientedBox.js max[f3] correction) is not actually in effect');
});

// ---------------------------------------------------------------------------------------------
// (c) node_modules and wwwroot/vendor copies are byte-identical -- read-only comparison, never
// invokes sync-vendor.mjs itself. Assumes `pretest` already ran `npm run build:vendor`.
// ---------------------------------------------------------------------------------------------

test('patch integrity: node_modules and wwwroot/vendor patched-file copies are byte-identical', () => {
  for (const rel of PATCHED_RELATIVE_PATHS) {
    const nodeModulesContent = readFileSync(path.join(NODE_MODULES_ROOT, rel), 'utf8');
    const vendorContent = readFileSync(path.join(VENDOR_ROOT, rel), 'utf8');
    assert.equal(vendorContent, nodeModulesContent,
      `wwwroot/vendor/three-mesh-bvh/src/${rel} must be byte-identical to node_modules/three-mesh-bvh/src/${rel} -- ` +
      'if this fails, the browser runtime is consuming a different (possibly unpatched) copy than node_modules');
  }
});
