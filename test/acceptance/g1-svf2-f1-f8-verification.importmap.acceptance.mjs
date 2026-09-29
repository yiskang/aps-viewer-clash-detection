// test/acceptance/g1-svf2-f1-f8-verification.importmap.acceptance.mjs
//
// REAL-BROWSER proof for the bounded G1 harness completion pass's Part A (see
// docs/prompts/for-claude-g1-harness-bounded-completion-pass.md and
// .superpowers/sdd/g1-f1-f8-harness/briefs/task-9-brief.md): BARE_PAGE_HTML's new import map
// actually resolves the bare 'three'/'three-mesh-bvh' specifiers a real browser rejects without
// one, and its ABSENCE produces the expected, controlled Phase 0 failure.
//
// ======================================================================================================
//  STATUS: AUTHORED, RUN MANUALLY BY THE IMPLEMENTING AGENT AS PART OF ITS OWN VERIFICATION.
//  NOT PART OF `npm test` / `npm run test:offline` -- this repo's own `*.acceptance.mjs` naming
//  convention (see clashtest-viewer-adapter.acceptance.mjs, room-locator.acceptance.mjs) is
//  already excluded from scripts/run-tests.mjs's `*.test.mjs` auto-discovery, so this file needs
//  no separate exclusion.
//
//  This is the ONE narrow allowance this authorization grants beyond every prior stage: launching
//  a REAL Playwright Chromium against a LOCAL, synthetic/bare page. It still NEVER calls
//  `Autodesk.Viewing.Initializer`, loads no real model, uses no APS credentials, and makes no
//  request to the real Autodesk CDN -- the Viewer script/style URLs BARE_PAGE_HTML references are
//  intercepted with page.route and fulfilled with harmless local stubs, since this test proves
//  module-resolution behavior only, nothing Viewer-session-related.
//
//  Precondition: a local `node server.js` must already be running on PORT (default 8080) for the
//  duration of this run -- same precondition clashtest-viewer-adapter.acceptance.mjs already
//  assumes (see its own header comment, "npm start &"). This script does NOT start or stop that
//  server itself; start it, confirm it is serving, run this script, then stop it, exactly as the
//  brief instructs.
//
//  Run manually: `node test/acceptance/g1-svf2-f1-f8-verification.importmap.acceptance.mjs`
// ======================================================================================================

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { BARE_PAGE_HTML, VIEWER_SCRIPT_URL, VIEWER_STYLE_URL } from './g1-svf2-f1-f8-verification.mjs';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}`;

// The real repo module SERVED_MODULE_ENTRY_POINTS's transitive graph resolves through -- checked
// by direct source read (this task's brief) to actually `import * as THREE from 'three'` AND
// `import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'` (collision/
// geometry/activeRangeCompaction.js:14-15) -- exercises two of the importmap's three entries in
// one dynamic import(), the third ('three-mesh-bvh') is exercised by a second target below
// (collision/blas/ThreeMeshBvhBackend.js:14-15, imports BOTH 'three' and 'three-mesh-bvh').
const TARGET_SPECIFIER = '/collision/geometry/activeRangeCompaction.js';
const TARGET_SPECIFIER_2 = '/collision/blas/ThreeMeshBvhBackend.js';

const IMPORTMAP_RE = /<script\s+type="importmap">[\s\S]*?<\/script>\s*/;

async function assertServerIsServing() {
  let res;
  try {
    res = await fetch(`${BASE_URL}/vendor/three/build/three.module.js`);
  } catch (e) {
    throw new Error(`g1-svf2-f1-f8-verification.importmap.acceptance.mjs: cannot reach a local server.js on ${BASE_URL} -- start it first ('node server.js' or 'npm start'). Underlying error: ${e && e.message}`);
  }
  if (!res.ok) {
    throw new Error(`g1-svf2-f1-f8-verification.importmap.acceptance.mjs: local server.js at ${BASE_URL} did not serve /vendor/three/build/three.module.js (status ${res.status}) -- confirm wwwroot/vendor exists and server.js is the one actually running.`);
  }
}

/** Registers page.route stubs for the Viewer script/style URLs BARE_PAGE_HTML references, so
 * navigating to it never requires real internet access or APS credentials -- this test proves
 * module resolution only. The stub script deliberately leaves `Autodesk` undefined; the page's
 * own inline bootstrap script already wraps its `Autodesk.Viewing.Initializer(...)` call in a
 * try/catch (see BARE_PAGE_HTML's own source), so the resulting ReferenceError is caught and
 * stored on `window.__g1Bootstrap.error` -- it never throws out of the page, never blocks
 * navigation's own 'load' event, and is irrelevant to the dynamic import() this test performs. */
async function stubViewerRemoteAssets(page) {
  await page.route(VIEWER_SCRIPT_URL, (route) => route.fulfill({ contentType: 'application/javascript', body: '// stubbed for module-resolution-only acceptance test -- intentionally does not define Autodesk' }));
  await page.route(VIEWER_STYLE_URL, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
}

async function runPositiveCase(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await stubViewerRemoteAssets(page);
  const url = `${BASE_URL}/__g1-importmap-acceptance-positive__`;
  // The REAL exported BARE_PAGE_HTML string, verbatim -- never a hand-copied duplicate, so this
  // test fails if the harness source drifts (this task's own explicit requirement).
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: BARE_PAGE_HTML }));
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

  const result1 = await page.evaluate(async (spec) => {
    try {
      const m = await import(spec);
      return { ok: true, keys: Object.keys(m) };
    } catch (e) {
      return { ok: false, name: e && e.name, message: String((e && e.message) || e) };
    }
  }, TARGET_SPECIFIER);

  const result2 = await page.evaluate(async (spec) => {
    try {
      const m = await import(spec);
      return { ok: true, keys: Object.keys(m) };
    } catch (e) {
      return { ok: false, name: e && e.name, message: String((e && e.message) || e) };
    }
  }, TARGET_SPECIFIER_2);

  await context.close();
  return { result1, result2 };
}

async function runNegativeCase(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await stubViewerRemoteAssets(page);
  const url = `${BASE_URL}/__g1-importmap-acceptance-negative__`;
  // A CONTROLLED, test-only transformation of the real exported string (importmap block
  // stripped) -- never a mutation of the real export itself (BARE_PAGE_HTML is untouched, this
  // is a local string derived from it for this one route only), per the authorization's own
  // explicit requirement ("removing the import map causes the expected Phase 0 failure in a
  // controlled test").
  const withoutImportMap = BARE_PAGE_HTML.replace(IMPORTMAP_RE, '');
  assert.notEqual(withoutImportMap, BARE_PAGE_HTML, 'sanity: the importmap-stripping transformation must actually remove something');
  assert.ok(!withoutImportMap.includes('type="importmap"'), 'sanity: no importmap block must remain after stripping');
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: withoutImportMap }));
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

  const result = await page.evaluate(async (spec) => {
    try {
      const m = await import(spec);
      return { ok: true, keys: Object.keys(m) };
    } catch (e) {
      return { ok: false, name: e && e.name, message: String((e && e.message) || e) };
    }
  }, TARGET_SPECIFIER);

  await context.close();
  return result;
}

async function main() {
  console.log(`g1-svf2-f1-f8-verification.importmap.acceptance.mjs: checking local server.js at ${BASE_URL}...`);
  await assertServerIsServing();
  console.log('server.js is serving. Launching real Chromium...');

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let positive;
  let negative;
  try {
    positive = await runPositiveCase(browser);
    negative = await runNegativeCase(browser);
  } finally {
    await browser.close();
  }

  console.log('Positive case (' + TARGET_SPECIFIER + '):', JSON.stringify(positive.result1));
  console.log('Positive case (' + TARGET_SPECIFIER_2 + '):', JSON.stringify(positive.result2));
  console.log('Negative case (importmap stripped):', JSON.stringify(negative));

  assert.equal(positive.result1.ok, true, `WITH the importmap, dynamic import('${TARGET_SPECIFIER}') must resolve cleanly -- got: ${JSON.stringify(positive.result1)}`);
  assert.ok(positive.result1.keys.includes('compactAndWeld'), 'the resolved module must expose its real compactAndWeld export');
  assert.equal(positive.result2.ok, true, `WITH the importmap, dynamic import('${TARGET_SPECIFIER_2}') must resolve cleanly (exercises the 'three-mesh-bvh' entry) -- got: ${JSON.stringify(positive.result2)}`);

  assert.equal(negative.ok, false, 'WITHOUT the importmap, the SAME dynamic import must fail -- it must not silently succeed');
  assert.match(
    negative.message,
    /(Failed to resolve module specifier|not a valid URL|relative reference)/i,
    `WITHOUT the importmap, the failure must be the browser's real module-resolution rejection, not a hang or an unrelated error -- got: ${JSON.stringify(negative)}`,
  );

  console.log('\nPASS: import map resolves the real module graph; its absence produces the expected, controlled Phase 0 failure (not a hang, not an unrelated error).');
}

main().catch((err) => {
  console.error('g1-svf2-f1-f8-verification.importmap.acceptance.mjs: FAILED', err);
  process.exitCode = 1;
});
