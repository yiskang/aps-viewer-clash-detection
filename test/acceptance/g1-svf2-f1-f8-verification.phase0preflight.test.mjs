// test/acceptance/g1-svf2-f1-f8-verification.phase0preflight.test.mjs
//
// Offline, browser-free tests for the bounded Phase-0 harness/test remediation
// (docs/prompts: "Bounded Phase-0 Harness/Test Remediation Only"):
//   H1 -- served-module manifest scanner ignores comments;
//   M1 -- real /collision/index.js graph resolves deterministically, offline;
//   M2 -- clean-tree preflight classification/reporting;
//   Low -- a pre-Viewer-fetch Phase 0 failure never fabricates FETCH_FAILED.
// Never launches a browser, never imports playwright, never calls main().

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildServedModuleManifest,
  stripJsComments,
  classifyGitTreeState,
  handlePhase0Failure,
  validateResultSchema,
  SERVED_MODULE_ENTRY_POINTS,
  PHASE0_FAILURE_CATEGORIES,
  PHASE0_VIEWER_FETCH_POSSIBLE_STEPS,
  VIEWER_IDENTITY_NOT_ATTEMPTED_REASON,
  OVERALL_VERDICT,
  INTEGRITY_RESULT,
} from './g1-svf2-f1-f8-verification.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// In-memory fixture filesystem: { '/a.js': 'source' } -> readFileFn keyed by repo-relative path.
function fakeFs(files) {
  const rootDir = '/fake-root';
  const readFileFn = async (abs) => {
    const rel = `/${path.relative(rootDir, abs).split(path.sep).join('/')}`;
    if (!(rel in files)) throw new Error(`ENOENT: ${rel}`);
    return files[rel];
  };
  return { rootDir, readFileFn };
}
const keys = (m) => Object.keys(m).sort();

// ---------------------------------------------------------------- H1 / M1 tests 1-4
test('scanner: a fake import inside a // comment is ignored', async () => {
  const { rootDir, readFileFn } = fakeFs({ '/a.js': "// import x from './ghost.js';\nexport const a = 1;\n" });
  assert.deepEqual(keys(await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn })), ['/a.js']);
});

test('scanner: a fake export-from inside a // comment (trailing and in-block-of-line-comments) is ignored', async () => {
  const src = [
    'const v = 1; // export { A } from \'./ghost1.js\';',
    "// see: export { CENTER, AVERAGE } from './core/Constants.js';",
    'export default v;',
  ].join('\n');
  const { rootDir, readFileFn } = fakeFs({ '/a.js': src });
  assert.deepEqual(keys(await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn })), ['/a.js']);
});

test('scanner: fake import/export inside /* ... */ block comments (single and multi-line) is ignored', async () => {
  const src = [
    "/* import a from './g1.js'; */",
    '/*',
    " * export * from './g2.js';",
    " * import './g3.js';",
    ' */',
    'export const z = 1;',
  ].join('\n');
  const { rootDir, readFileFn } = fakeFs({ '/a.js': src });
  assert.deepEqual(keys(await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn })), ['/a.js']);
});

test('scanner: real imports/exports adjacent to comments are still discovered', async () => {
  const src = [
    "import a from './a1.js'; // trailing comment",
    "/* lead */ import { b } from './a2.js';",
    "export { c } from './a3.js'; /* trail */",
    "// comment line",
    "export * from './a4.js';",
    "import './a5.js';",
    "import d /* inline */ from './a6.js';",
  ].join('\n');
  const files = { '/a.js': src };
  for (const n of [1, 2, 3, 4, 5, 6]) files[`/a${n}.js`] = 'export const x = 1;';
  const { rootDir, readFileFn } = fakeFs(files);
  assert.deepEqual(
    keys(await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn })),
    ['/a.js', '/a1.js', '/a2.js', '/a3.js', '/a4.js', '/a5.js', '/a6.js'],
  );
});

test('stripJsComments: comment markers inside strings, templates, and regex literals are preserved', () => {
  const src = "const u = 'http://x//y'; const t = `a // b /* c */`; const r = /\\/\\/[/*]+/g; const q = \"/*\"; // gone";
  const out = stripJsComments(src);
  assert.ok(out.includes("'http://x//y'"));
  assert.ok(out.includes('`a // b /* c */`'));
  assert.ok(out.includes('/\\/\\/[/*]+/g'));
  assert.ok(out.includes('"/*"'));
  assert.ok(!out.includes('gone'));
});

test('scanner: import inside a string is not treated as a comment-stripping victim (real import after a string with //)', async () => {
  const src = "const u = 'http://example.com'; import v from './b.js';\n";
  const { rootDir, readFileFn } = fakeFs({ '/a.js': src, '/b.js': 'export default 1;' });
  assert.deepEqual(keys(await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn })), ['/a.js', '/b.js']);
});

test('scanner: manifest digest is over the RAW file bytes (comments included), not the stripped text', async () => {
  const { createHash } = await import('node:crypto');
  const src = '// c\nexport const a = 1;\n';
  const { rootDir, readFileFn } = fakeFs({ '/a.js': src });
  const m = await buildServedModuleManifest(['/a.js'], { rootDir, readFileFn });
  assert.equal(m['/a.js'], createHash('sha256').update(src, 'utf8').digest('hex'));
});

// ---------------------------------------------------------------- M1 tests 5-6 (real repo graph)
test('real graph: SERVED_MODULE_ENTRY_POINTS resolves offline without inventing /collision/tlas/core/Constants.js', async () => {
  const manifest = await buildServedModuleManifest(SERVED_MODULE_ENTRY_POINTS, {});
  const paths = Object.keys(manifest);
  assert.ok(paths.includes('/collision/index.js'));
  assert.ok(paths.includes('/collision/tlas/CollisionInstanceBVH.js'), 'the module carrying the offending comment is part of the graph');
  assert.ok(!paths.includes('/collision/tlas/core/Constants.js'));
  assert.ok(paths.every((p) => !p.includes('/core/Constants.js')), 'no invented core/Constants.js path anywhere');
  for (const d of Object.values(manifest)) assert.match(d, /^[0-9a-f]{64}$/);
});

test('real graph: CollisionInstanceBVH.js still imports three-mesh-bvh as a bare package (skipped, not followed) and no node_modules path enters the manifest', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(path.join(REPO_ROOT, 'collision', 'tlas', 'CollisionInstanceBVH.js'), 'utf8');
  const stripped = stripJsComments(src);
  assert.match(stripped, /from\s*['"]three-mesh-bvh['"]/, 'the real executable bare-package import survives stripping');
  assert.ok(!/core\/Constants\.js/.test(stripped), 'the commented-out relative re-export text is gone');
  const manifest = await buildServedModuleManifest(SERVED_MODULE_ENTRY_POINTS, {});
  assert.ok(Object.keys(manifest).every((p) => !p.includes('node_modules') && !p.includes('three-mesh-bvh')));
});

// ---------------------------------------------------------------- M2 clean-tree preflight
test('classifyGitTreeState: empty porcelain is the only "clean"', () => {
  const s = classifyGitTreeState('');
  assert.equal(s.clean, true);
  assert.deepEqual(s.blockingPaths, []);
  assert.deepEqual(s.dirtyPaths, []);
});

test('classifyGitTreeState: an untracked docs/prompts file is reported as dirty-but-allowed, never "clean"', () => {
  const s = classifyGitTreeState('?? docs/prompts/for-claude-one-live-g1-f1-f8-execution.md\n');
  assert.equal(s.clean, false);
  assert.deepEqual(s.dirtyPaths, ['docs/prompts/for-claude-one-live-g1-f1-f8-execution.md']);
  assert.deepEqual(s.allowedPaths, ['docs/prompts/for-claude-one-live-g1-f1-f8-execution.md']);
  assert.deepEqual(s.blockingPaths, []);
});

test('classifyGitTreeState: modified tracked files, staged files, and untracked non-governance paths block', () => {
  const s = classifyGitTreeState(' M server.js\nM  docs/prompts/x.md\n?? docs/research/new.md\n?? docs/prompts/ok.md\n');
  assert.equal(s.clean, false);
  assert.deepEqual(s.blockingPaths, ['server.js', 'docs/prompts/x.md', 'docs/research/new.md']);
  assert.deepEqual(s.allowedPaths, ['docs/prompts/ok.md']);
  assert.equal(s.entries.find((e) => e.path === 'docs/prompts/x.md').allowed, false, 'a MODIFIED file under docs/prompts is not an allowed untracked file');
});

// ---------------------------------------------------------------- Low: Viewer identity not-attempted
function phase0Args(overrides = {}) {
  return {
    error: new Error('simulated'),
    failureCategory: PHASE0_FAILURE_CATEGORIES['harness-integrity'],
    startedAt: new Date().toISOString(),
    harnessIntegrityInput: {
      path: 'test/acceptance/g1-svf2-f1-f8-verification.mjs', sha256: 'a'.repeat(64), branch: 'main',
      headSha: 'b'.repeat(40), gitStatusPorcelain: '', servedModuleManifest: {},
    },
    runtimeEnvelope: { viewerVersion: '7.124.2', chromium: null, node: process.version, modelUrn: 'urn:x', initializer: { env: 'AutodeskProduction2', api: 'streamingV2' } },
    // What main()'s real capture returns before any request: nothing observed at all.
    captureViewerScriptIntegrity: async () => ({ requestFailed: false, autodeskViewingDefined: false, attributableResponses: [] }),
    closeAllFn: async () => ({ closeFailures: [] }),
    writeResultAtomically: async () => {},
    consoleErrorFn: () => {},
    ...overrides,
  };
}

test('pre-Viewer Phase 0 failure: identity is an explicit not-attempted state, not FETCH_FAILED, capture not fabricated, overall FAIL, schema-valid', async () => {
  const { evidence } = await handlePhase0Failure(phase0Args({ viewerFetchAttempted: false }));
  const vs = evidence.harnessIntegrity.remoteAssets.viewerScript;
  assert.notEqual(vs.integrityResult, INTEGRITY_RESULT.FETCH_FAILED);
  assert.equal(vs.integrityResult, INTEGRITY_RESULT.CAPTURE_UNAVAILABLE);
  assert.equal(vs.reason, VIEWER_IDENTITY_NOT_ATTEMPTED_REASON);
  assert.equal(vs.capture, null);
  assert.equal(evidence.viewerScriptIntegrityReason, VIEWER_IDENTITY_NOT_ATTEMPTED_REASON);
  assert.equal(evidence.overall, OVERALL_VERDICT.FAIL);
  const v = validateResultSchema(evidence);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('post-fetch Phase 0 failure (viewerFetchAttempted default) still classifies real capture, incl. genuine FETCH_FAILED', async () => {
  const { evidence } = await handlePhase0Failure(phase0Args({
    captureViewerScriptIntegrity: async () => ({ requestFailed: true, autodeskViewingDefined: false, attributableResponses: [] }),
  }));
  assert.equal(evidence.harnessIntegrity.remoteAssets.viewerScript.integrityResult, INTEGRITY_RESULT.FETCH_FAILED);
});

test('PHASE0_VIEWER_FETCH_POSSIBLE_STEPS: only navigation-and-later steps count as Viewer-fetch-possible', () => {
  assert.deepEqual([...PHASE0_VIEWER_FETCH_POSSIBLE_STEPS].sort(), ['bootstrap-ready', 'goto', 'module-install']);
  for (const early of ['harness-integrity', 'git-tree-check', 'playwright-import', 'browser-launch', 'context-create', 'page-create', 'route-setup']) {
    assert.ok(!PHASE0_VIEWER_FETCH_POSSIBLE_STEPS.has(early), early);
    assert.ok(early in PHASE0_FAILURE_CATEGORIES, `${early} has a failure category`);
  }
});

// ---------------------------------------------------------------- internal-review follow-ups
test('stripJsComments: `return /re\\//` is a regex literal (not division) so the rest of the line survives', () => {
  const out = stripJsComments("function f(x){ return /a\\//.test(x); }\nimport q from './q.js';");
  assert.ok(out.includes('.test(x); }'), 'text after the regex on the same line is not swallowed as a comment');
  assert.ok(out.includes("import q from './q.js';"));
});

test('classifyGitTreeState: first-line leading-space status (" M path") keeps exact status and path', () => {
  const s = classifyGitTreeState(' M docs/handoffs/latest.md\n?? docs/prompts/x.md\n');
  assert.deepEqual(s.entries[0], { status: ' M', path: 'docs/handoffs/latest.md', allowed: false });
});

test('main() source: porcelain is read untrimmed and a git failure fails closed (structural, matches this suite\'s main()-source convention)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(fileURLToPath(new URL('./g1-svf2-f1-f8-verification.mjs', import.meta.url)), 'utf8');
  assert.match(src, /gitField\(\['status', '--porcelain'\], \{ trim: false \}\)/);
  assert.match(src, /if \(rawPorcelain === null\) \{\s*throw new Error/);
});
