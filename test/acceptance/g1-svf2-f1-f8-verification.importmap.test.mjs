// test/acceptance/g1-svf2-f1-f8-verification.importmap.test.mjs
//
// Offline, browser-free unit tests for the bounded G1 harness completion pass's Part A (see
// docs/prompts/for-claude-g1-harness-bounded-completion-pass.md and
// .superpowers/sdd/g1-f1-f8-harness/briefs/task-9-brief.md): `BARE_PAGE_HTML` must carry a
// well-formed `<script type="importmap">` block, with exactly the three entries copied verbatim
// from wwwroot/index.html:47-53, positioned before the Viewer <script src="..."> tag.
//
// This file never launches a browser and never imports playwright -- it only parses the
// exported BARE_PAGE_HTML string. The companion REAL-browser proof (module resolution actually
// works, and fails in the expected way without the import map) lives in the new
// g1-svf2-f1-f8-verification.importmap.acceptance.mjs file, per this repo's own
// `*.acceptance.mjs` convention (excluded from `npm run test:offline`'s auto-discovery).

import test from 'node:test';
import assert from 'node:assert/strict';
import { BARE_PAGE_HTML, VIEWER_SCRIPT_URL } from './g1-svf2-f1-f8-verification.mjs';

const EXPECTED_IMPORTS = Object.freeze({
  three: '/vendor/three/build/three.module.js',
  'three-mesh-bvh': '/vendor/three-mesh-bvh/src/index.js',
  'three/addons/utils/BufferGeometryUtils.js': '/vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
});

/** Extracts the FIRST `<script type="importmap">...</script>` block's inner text from an HTML
 * string, or null if none is present. Deliberately simple/tolerant (this is a controlled,
 * self-authored HTML string, not arbitrary untrusted markup). */
function extractImportMapJson(html) {
  const match = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
  return match ? match[1] : null;
}

test('BARE_PAGE_HTML contains a <script type="importmap"> block', () => {
  assert.match(BARE_PAGE_HTML, /<script\s+type="importmap">/, 'BARE_PAGE_HTML must contain an importmap script tag');
});

test('BARE_PAGE_HTML importmap block parses as well-formed JSON with an "imports" object', () => {
  const raw = extractImportMapJson(BARE_PAGE_HTML);
  assert.ok(raw, 'importmap block must be present and extractable');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, 'importmap contents must be valid JSON, not just a substring match');
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'parsed importmap must be an object');
  assert.ok(parsed.imports && typeof parsed.imports === 'object' && !Array.isArray(parsed.imports), 'parsed importmap must have an "imports" object');
});

test('BARE_PAGE_HTML importmap has EXACTLY the three keys copied from wwwroot/index.html, no more, no fewer', () => {
  const parsed = JSON.parse(extractImportMapJson(BARE_PAGE_HTML));
  const keys = Object.keys(parsed.imports).sort();
  assert.deepEqual(keys, Object.keys(EXPECTED_IMPORTS).sort(), 'importmap must have exactly the three reviewed keys -- never broadened, never narrowed');
});

test('BARE_PAGE_HTML importmap values match wwwroot/index.html:47-53 verbatim, for every key', () => {
  const parsed = JSON.parse(extractImportMapJson(BARE_PAGE_HTML));
  for (const [key, expectedValue] of Object.entries(EXPECTED_IMPORTS)) {
    assert.equal(parsed.imports[key], expectedValue, `importmap["${key}"] must equal the reviewed production value verbatim`);
  }
});

test('BARE_PAGE_HTML: the importmap script tag appears textually BEFORE the Viewer <script src> tag', () => {
  const idxImportMap = BARE_PAGE_HTML.indexOf('<script type="importmap">');
  const idxViewerScript = BARE_PAGE_HTML.indexOf(`<script src="${VIEWER_SCRIPT_URL}">`);
  assert.ok(idxImportMap > -1, 'importmap tag must be present');
  assert.ok(idxViewerScript > -1, 'Viewer script tag must be present');
  assert.ok(idxImportMap < idxViewerScript, 'importmap must be positioned before the Viewer script tag -- it must be present before any module resolution the page later performs');
});

test('BARE_PAGE_HTML: the importmap script tag appears inside <head>, before </head>', () => {
  const idxImportMap = BARE_PAGE_HTML.indexOf('<script type="importmap">');
  const idxHeadClose = BARE_PAGE_HTML.indexOf('</head>');
  assert.ok(idxHeadClose > -1, '</head> must be present');
  assert.ok(idxImportMap > -1 && idxImportMap < idxHeadClose, 'importmap must be positioned inside <head>, the safe/conventional early position');
});
