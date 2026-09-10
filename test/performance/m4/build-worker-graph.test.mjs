// test/performance/m4/build-worker-graph.test.mjs
//
// M4 Task 3.9 (codex-review fix, Important #1): tests `buildBundledWorkerGraph` against the REAL
// repository `wwwroot/vendor/` tree it must walk for real -- deterministic, no browser needed. This
// closes codex-review's own testing-gap #1/#2: "assert the generated graph contains no remaining
// bare `three`/`three-mesh-bvh` imports" and "prove three-mesh-bvh's transitive imports resolve"
// (the file-existence/content half of that; live worker execution is covered by this task's own
// manual verification against the real browser, per the project's established Playwright/CDP
// integration convention -- see this task's report).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBundledWorkerGraph } from './build-worker-graph.mjs';

async function withTempOutDir(fn) {
  const outDir = await mkdtemp(join(tmpdir(), 'm4-s1-build-worker-graph-'));
  try {
    return await fn(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test('buildBundledWorkerGraph: no bare three/three-mesh-bvh specifier survives in any generated file', async () => {
  await withTempOutDir(async (outDir) => {
    const result = await buildBundledWorkerGraph({
      entryPath: 'spike/m4/s1-module-resolution/worker.bare.mjs',
      outDir,
      vendorRoot: 'wwwroot/vendor',
    });
    assert.deepEqual(result.remainingBareSpecifiers, []);
    assert.deepEqual(result.unresolvedSpecifiers, []);
  });
});

test('buildBundledWorkerGraph: reaches three-mesh-bvh\'s own internal bare-importing modules (the real bug this fix closes)', async () => {
  await withTempOutDir(async (outDir) => {
    const result = await buildBundledWorkerGraph({
      entryPath: 'spike/m4/s1-module-resolution/worker.bare.mjs',
      outDir,
      vendorRoot: 'wwwroot/vendor',
    });
    // MeshBVH.js is the file codex-review cited by name as still importing bare `three` internally
    // -- confirm it was actually walked and rewritten, not skipped.
    const meshBvhOutputPath = result.visitedOutputPaths.find((p) => p.endsWith('three-mesh-bvh/src/core/MeshBVH.js'));
    assert.ok(meshBvhOutputPath, 'expected core/MeshBVH.js to be part of the walked graph');
    const written = await readFile(meshBvhOutputPath, 'utf8');
    assert.doesNotMatch(written, /from\s+(['"])three\1/);
    // core/MeshBVH.js's mirrored output lives at <outDir>/vendor/three-mesh-bvh/src/core/MeshBVH.js
    // -- three levels below <outDir>/vendor/ -- so its rewritten bare `three` import must climb
    // back up exactly that far before reaching `three/build/three.module.js`.
    assert.match(written, /from\s+(['"])\.\.\/\.\.\/\.\.\/three\/build\/three\.module\.js\1/);
  });
});

test('buildBundledWorkerGraph: a relative import between two vendor files is left byte-identical (mirrored structure, no rewrite needed)', async () => {
  await withTempOutDir(async (outDir) => {
    const result = await buildBundledWorkerGraph({
      entryPath: 'spike/m4/s1-module-resolution/worker.bare.mjs',
      outDir,
      vendorRoot: 'wwwroot/vendor',
    });
    const indexOutputPath = result.visitedOutputPaths.find((p) => p.endsWith('three-mesh-bvh/src/index.js'));
    assert.ok(indexOutputPath);
    const written = await readFile(indexOutputPath, 'utf8');
    // index.js's own relative re-exports (e.g. `export * from './core/BVH.js';`) are untouched --
    // only the bare `three`/`three-mesh-bvh` pattern is ever rewritten.
    assert.match(written, /export \* from '\.\/core\/BVH\.js';/);
  });
});

test('buildBundledWorkerGraph: the generated entry lives at <outDir>/worker.mjs and imports the mirrored vendor tree', async () => {
  await withTempOutDir(async (outDir) => {
    const result = await buildBundledWorkerGraph({
      entryPath: 'spike/m4/s1-module-resolution/worker.bare.mjs',
      outDir,
      vendorRoot: 'wwwroot/vendor',
    });
    assert.equal(result.entryOutputPath, join(outDir, 'worker.mjs'));
    const entrySource = await readFile(result.entryOutputPath, 'utf8');
    // Real bug found running this module against a live browser (see build-worker-graph.mjs's own
    // header comment where this prefix is computed): a bare `'vendor/...'` specifier -- no leading
    // `./` -- is STILL a bare module specifier per the ECMAScript module resolution algorithm and
    // fails to resolve in a worker realm exactly like `'three'` itself does. The leading `./` is
    // load-bearing, not cosmetic.
    assert.match(entrySource, /from '\.\/vendor\/three\/build\/three\.module\.js'/);
    assert.match(entrySource, /from '\.\/vendor\/three-mesh-bvh\/src\/index\.js'/);
  });
});
