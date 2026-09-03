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
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(repoRoot, 'node_modules');
const vendorRoot = path.join(repoRoot, 'wwwroot', 'vendor');

const COPIES = [
  { from: path.join(nodeModules, 'three', 'build'), to: path.join(vendorRoot, 'three', 'build') },
  {
    from: path.join(nodeModules, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
    to: path.join(vendorRoot, 'three', 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'),
  },
  { from: path.join(nodeModules, 'three-mesh-bvh', 'src'), to: path.join(vendorRoot, 'three-mesh-bvh', 'src') },
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

async function main() {
  console.log('sync-vendor: copying isolated three/three-mesh-bvh builds into wwwroot/vendor/ ...');
  for (const entry of COPIES) {
    await syncOne(entry);
  }
  console.log('sync-vendor: done.');
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
