// test/acceptance/clashpanel-viewerbridge.acceptance.preflight.test.mjs
//
// Offline tests for the preflight classifiers copied from G1 (drift-tested against G1's own exports)
// and the served-module helpers (procedure §3 "Page", §10 servedModuleManifest): path confinement,
// JS-only serving and per-module sha256. Real-filesystem cases use os.tmpdir() sandboxes only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifyGitTreeState,
  classifyViewerScriptIntegrity,
  EXPECTED_VIEWER_SHA256,
  INTEGRITY_RESULT,
  GIT_TREE_ALLOWED_UNTRACKED_PREFIXES,
  resolveServedModulePath,
  createServedModuleManifest,
  validateServedModuleManifest,
  serveClashPanelModule,
  REPO_ROOT,
} from './clashpanel-viewerbridge.acceptance.mjs';
import * as g1 from './g1-svf2-f1-f8-verification.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------------------
// classifiers: copies must behave exactly like G1's exports
// ------------------------------------------------------------------------------------------

test('classifyGitTreeState: identical to G1 on a corpus; only docs/prompts/ untracked is allowed', () => {
  const corpus = [
    '', '\n', ' M server.js\n', '?? docs/prompts/g2-record.md\n', '?? docs/prompts/a.md\n?? docs/research/x.md\n',
    'A  clashpanel/x.js\n', '?? "docs/prompts/with space.md"\n', '?? docs/prompts-evil/x.md\n', ' M docs/prompts/a.md\n', '?? test/acceptance/results/\n',
    null, undefined,
  ];
  for (const p of corpus) assert.deepEqual(classifyGitTreeState(p), g1.classifyGitTreeState(p), JSON.stringify(p));
  assert.deepEqual([...GIT_TREE_ALLOWED_UNTRACKED_PREFIXES], ['docs/prompts/']);
  const ok = classifyGitTreeState('?? docs/prompts/g2-record.md\n');
  assert.equal(ok.clean, false);
  assert.deepEqual(ok.blockingPaths, []);
  assert.deepEqual(ok.allowedPaths, ['docs/prompts/g2-record.md']);
  assert.deepEqual(classifyGitTreeState(' M docs/prompts/a.md\n').blockingPaths, ['docs/prompts/a.md'], 'a MODIFIED prompt is not allowed');
  assert.deepEqual(classifyGitTreeState('?? docs/prompts-evil/x.md\n').blockingPaths, ['docs/prompts-evil/x.md']);
  assert.equal(classifyGitTreeState('').clean, true);
});

function resp(over = {}) {
  return { status: 200, redirectChainComplete: true, fromServiceWorker: false, bodyOutcome: 'captured', decodedByteLength: 1234, sha256: EXPECTED_VIEWER_SHA256, ...over };
}

test('classifyViewerScriptIntegrity: identical to G1 over the full five-row matrix; only VERIFIED allows PASS', () => {
  assert.equal(EXPECTED_VIEWER_SHA256, g1.EXPECTED_VIEWER_SHA256);
  assert.deepEqual(INTEGRITY_RESULT, g1.INTEGRITY_RESULT);
  const cases = [
    { attributableResponses: [resp()], autodeskViewingDefined: true },
    { attributableResponses: [resp({ sha256: 'f'.repeat(64) })], autodeskViewingDefined: true },
    { attributableResponses: [resp({ status: 404 })], autodeskViewingDefined: false },
    { attributableResponses: [resp({ status: 304 })], autodeskViewingDefined: true },
    { attributableResponses: [resp({ bodyOutcome: 'capture-failed', sha256: null, decodedByteLength: null })], autodeskViewingDefined: true },
    { attributableResponses: [resp({ bodyOutcome: 'empty', decodedByteLength: 0, sha256: null })], autodeskViewingDefined: true },
    { attributableResponses: [resp({ redirectChainComplete: false })], autodeskViewingDefined: true },
    { attributableResponses: [resp(), resp({ sha256: 'a'.repeat(64) })], autodeskViewingDefined: true },
    { attributableResponses: [resp(), resp()], autodeskViewingDefined: true },
    { attributableResponses: [], autodeskViewingDefined: true },
    { attributableResponses: [], autodeskViewingDefined: false },
    { requestFailed: true, attributableResponses: [resp()], autodeskViewingDefined: true },
    { attributableResponses: [resp({ bodyOutcome: 'pending-at-close', sha256: null })], autodeskViewingDefined: true },
    {}, null, undefined,
  ];
  for (const c of cases) assert.deepEqual(classifyViewerScriptIntegrity(c), g1.classifyViewerScriptIntegrity(c), JSON.stringify(c));
  assert.equal(classifyViewerScriptIntegrity(cases[0]).integrityResult, 'VERIFIED');
  assert.equal(classifyViewerScriptIntegrity(cases[1]).integrityResult, 'MISMATCH');
  assert.equal(classifyViewerScriptIntegrity(cases[2]).integrityResult, 'FETCH_FAILED');
  // VERIFIED only for a single matched response or several responses that all match and are complete
  assert.deepEqual(cases.filter((c) => classifyViewerScriptIntegrity(c).integrityResult === 'VERIFIED'), [cases[0], cases[8]]);
});

// ------------------------------------------------------------------------------------------
// served modules
// ------------------------------------------------------------------------------------------

function sandbox() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'g2-served-')));
  mkdirSync(path.join(root, 'clashpanel', 'viewer', 'deep'), { recursive: true });
  writeFileSync(path.join(root, 'clashpanel', 'index.js'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'clashpanel', 'viewer', 'deep', 'm.js'), 'export const m = 2;\n');
  writeFileSync(path.join(root, 'clashpanel', 'data.json'), '{"x":1}');
  writeFileSync(path.join(root, 'clashpanel', 'mod.mjs'), 'export {};\n');
  writeFileSync(path.join(root, 'clashpanel', 'index.js.map'), '{}');
  writeFileSync(path.join(root, 'clashpanel', '.hidden.js'), 'export {};\n');
  writeFileSync(path.join(root, 'secret.js'), 'export const SECRET = 1;\n');
  mkdirSync(path.join(root, 'outside'));
  writeFileSync(path.join(root, 'outside', 'leak.js'), 'export const leak = 1;\n');
  symlinkSync(path.join(root, 'outside', 'leak.js'), path.join(root, 'clashpanel', 'linked.js'));
  symlinkSync(path.join(root, 'outside'), path.join(root, 'clashpanel', 'linkdir'));
  mkdirSync(path.join(root, 'clashpanel', 'dir.js'));
  return root;
}

test('served modules: only /clashpanel/**.js inside the module root is served; everything else is 404', () => {
  const root = sandbox();
  try {
    const ok = resolveServedModulePath('/clashpanel/index.js', { rootDir: root });
    assert.deepEqual([ok.ok, ok.repoRelative], [true, '/clashpanel/index.js']);
    assert.equal(resolveServedModulePath('/clashpanel/viewer/deep/m.js', { rootDir: root }).ok, true);
    assert.equal(resolveServedModulePath('/clashpanel/index.js?v=1#x', { rootDir: root }).ok, true, 'query and fragment are ignored');
    assert.equal(resolveServedModulePath('http://localhost:8080/clashpanel/index.js', { rootDir: root }).ok, true, 'absolute URL: path only');
    const refusals = {
      '/clashpanel/data.json': 'not-a-js-module-path',
      '/clashpanel/mod.mjs': 'not-a-js-module-path',
      '/clashpanel/index.js.map': 'not-a-js-module-path',
      '/clashpanel/.hidden.js': 'not-a-js-module-path',
      '/clashpanel/': 'not-a-js-module-path',
      '/clashpanel': 'outside-prefix',
      '/secret.js': 'outside-prefix',
      '/server.js': 'outside-prefix',
      '/clashpanel/../secret.js': 'outside-prefix',
      '/clashpanel/viewer/../../secret.js': 'outside-prefix',
      '/clashpanel/%2e%2e/secret.js': 'forbidden-character',
      '/clashpanel/%2E%2E/secret.js': 'forbidden-character',
      '/clashpanel/viewer%2f..%2f..%2fsecret.js': 'forbidden-character',
      '/clashpanel/index.js%00.png': 'forbidden-character',
      '/clashpanel\\..\\secret.js': 'forbidden-character',
      '/clashpanel/missing.js': 'not-found',
      '/clashpanel/dir.js': 'not-a-file',
      '/clashpanel/INDEX.JS': 'not-a-js-module-path',
      '/clashpanel/linked.js': 'symlink-escape',
      '/clashpanel/linkdir/leak.js': 'symlink-escape',
      '/clashpanel/a b.js': 'percent-escape',
      '/CLASHPANEL/index.js': 'outside-prefix',
    };
    for (const [url, reason] of Object.entries(refusals)) {
      const r = resolveServedModulePath(url, { rootDir: root });
      assert.deepEqual([url, r.ok, r.status, r.reason], [url, false, 404, reason]);
    }
    for (const bad of [undefined, null, '', 42, {}]) assert.equal(resolveServedModulePath(bad, { rootDir: root }).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serveClashPanelModule: 200 with JS content type and the exact sha256, recorded in the manifest; 404 serves an empty body', () => {
  const root = sandbox();
  try {
    const manifest = createServedModuleManifest();
    const r = serveClashPanelModule({ requestUrl: '/clashpanel/index.js', rootDir: root, manifest });
    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'text/javascript; charset=utf-8');
    assert.equal(r.sha256, sha(Buffer.from('export const a = 1;\n')));
    assert.equal(Buffer.compare(r.body, Buffer.from('export const a = 1;\n')), 0);
    serveClashPanelModule({ requestUrl: '/clashpanel/viewer/deep/m.js', rootDir: root, manifest });
    serveClashPanelModule({ requestUrl: '/clashpanel/index.js', rootDir: root, manifest });
    const nf = serveClashPanelModule({ requestUrl: '/secret.js', rootDir: root, manifest });
    assert.deepEqual([nf.status, nf.body, nf.reason], [404, '', 'outside-prefix']);
    assert.deepEqual(Object.keys(manifest.snapshot()), ['/clashpanel/index.js', '/clashpanel/viewer/deep/m.js']);
    assert.equal(manifest.conflicts.length, 0);
    assert.deepEqual(validateServedModuleManifest(manifest.snapshot()), { ok: true, reason: null });
    const failing = serveClashPanelModule({ requestUrl: '/clashpanel/index.js', rootDir: root, readFile: () => { throw new Error('EIO'); } });
    assert.deepEqual([failing.status, failing.reason], [404, 'read-failed']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('served module manifest: a re-serve with different bytes is kept as a conflict and never overwrites the first digest', () => {
  const m = createServedModuleManifest();
  const d1 = m.record('/clashpanel/a.js', Buffer.from('one'));
  m.record('/clashpanel/a.js', Buffer.from('one'));
  assert.equal(m.conflicts.length, 0);
  m.record('/clashpanel/a.js', Buffer.from('two'));
  assert.equal(m.snapshot()['/clashpanel/a.js'], d1);
  assert.deepEqual(m.conflicts, [{ path: '/clashpanel/a.js', first: d1, second: sha(Buffer.from('two')) }]);
});

test('validateServedModuleManifest rejects non-objects, non-module paths and malformed digests', () => {
  assert.equal(validateServedModuleManifest(null).ok, false);
  assert.equal(validateServedModuleManifest([]).ok, false);
  assert.match(validateServedModuleManifest({ '/server.js': 'a'.repeat(64) }).reason, /bad-path/);
  assert.match(validateServedModuleManifest({ '/clashpanel/a.js': 'xyz' }).reason, /bad-digest/);
  assert.equal(validateServedModuleManifest({}).ok, true);
});

test('real repo: every clashpanel/**.js module resolves inside the confined root and serves with its true sha256', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) found.push(p);
    }
  };
  walk(path.join(REPO_ROOT, 'clashpanel'));
  assert.ok(found.length > 10, 'sanity: the repo has clashpanel modules');
  const manifest = createServedModuleManifest();
  for (const abs of found) {
    const url = `/${path.relative(REPO_ROOT, abs).split(path.sep).join('/')}`;
    const r = serveClashPanelModule({ requestUrl: url, manifest });
    assert.equal(r.status, 200, url);
    assert.equal(r.sha256, sha(readFileSync(abs)), url);
  }
  assert.equal(Object.keys(manifest.snapshot()).length, found.length);
  assert.equal(serveClashPanelModule({ requestUrl: '/server.js' }).status, 404);
  assert.equal(serveClashPanelModule({ requestUrl: '/clashpanel/../server.js' }).status, 404);
});
