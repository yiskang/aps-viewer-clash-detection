// test/runtime/runtimeIsolation.test.mjs
//
// Automated half of the runtime-isolation acceptance check (spec:985-987, 1038-1076):
// confirms the import map exists, is positioned before the app's own module script,
// and every entry it declares resolves to a real file that `npm run build:vendor` is
// supposed to have produced. This is what `npm test`/CI can check without a browser.
//
// The other half of the acceptance check -- `window.THREE.REVISION === '71'`
// unchanged before and after the collision runtime loads -- requires a live browser
// with the real Viewer script tag loaded. That half is a documented MANUAL step (see
// the comment block at the bottom of this file and test/README.md's "Runtime
// isolation" section) rather than an automated one: automating it now would mean
// faking the exact thing the check exists to catch (a real `window.THREE` global from
// a real Viewer bundle), and `collision/index.js` -- the real thing later tasks will
// import to exercise it for real -- does not exist yet at Task 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const indexHtmlPath = path.join(repoRoot, 'wwwroot', 'index.html');

test('index.html declares the collision-runtime import map before /main.js', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');
  const importMapIndex = html.indexOf('<script type="importmap">');
  const mainScriptIndex = html.indexOf('<script src="/main.js" type="module">');
  assert.ok(importMapIndex !== -1, 'expected an import map <script> tag in wwwroot/index.html');
  assert.ok(mainScriptIndex !== -1, 'expected the existing /main.js module script tag');
  assert.ok(
    importMapIndex < mainScriptIndex,
    'import map must be declared before /main.js so bare specifiers resolve for every module it imports'
  );
});

test('import map entries resolve to real files on disk (after npm run build:vendor)', async () => {
  const html = await readFile(indexHtmlPath, 'utf8');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a parseable <script type="importmap"> block');
  const map = JSON.parse(match[1]);
  const entries = Object.entries(map.imports);
  assert.ok(entries.length >= 3, 'expected at least the three, three-mesh-bvh, and BufferGeometryUtils entries');

  for (const [specifier, url] of entries) {
    assert.ok(url.startsWith('/vendor/'), `${specifier} -> ${url} must resolve under /vendor/`);
    const diskPath = path.join(repoRoot, 'wwwroot', url.replace(/^\//, ''));
    assert.ok(
      existsSync(diskPath),
      `${specifier} -> ${url} does not exist on disk at ${diskPath}. Run "npm run build:vendor" first.`
    );
  }
});

test('vendored three build does not assign window.THREE / globalThis.THREE (static check)', async () => {
  // Vendor files are copied verbatim (spec:1063-1071) -- this only guards against a
  // future hand-edit of the vendor tree accidentally adding a global assignment. The
  // live before/after `window.THREE.REVISION` comparison is the manual check below.
  const vendorThreeEntry = path.join(repoRoot, 'wwwroot', 'vendor', 'three', 'build', 'three.module.js');
  if (!existsSync(vendorThreeEntry)) {
    assert.fail('vendor three build missing -- run "npm run build:vendor" before this test');
  }
  const src = await readFile(vendorThreeEntry, 'utf8');
  assert.ok(
    !/\bwindow\s*\.\s*THREE\s*=/.test(src) && !/\bglobalThis\s*\.\s*THREE\s*=/.test(src),
    'vendored three.module.js must never assign window.THREE / globalThis.THREE (spec:979-980)'
  );
});

// ---------------------------------------------------------------------------
// MANUAL STEP (documented, not automated -- see rationale in the file header above
// and in test/README.md):
//
//   1. Start the app (`npm start`), open it in a real browser with the Viewer script
//      tag already loaded (as wwwroot/index.html does).
//   2. In devtools console, BEFORE triggering anything that imports collision/
//      modules, run `window.THREE.REVISION` -- record the value (expect '71').
//   3. Trigger a code path that imports the collision runtime (once later tasks add
//      `collision/index.js` -- until then, `import('/vendor/three/build/three.module.js')`
//      from the console is an acceptable stand-in, since that is the exact module the
//      collision runtime will import).
//   4. Run `window.THREE.REVISION` again -- must still read '71', unchanged.
//   5. Confirm no console errors about a failed /vendor/ module resolution (spec:1073-1076
//      acceptance check for the BufferGeometryUtils.js vendor gap).
// ---------------------------------------------------------------------------
