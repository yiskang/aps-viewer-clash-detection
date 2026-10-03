// test/acceptance/clashpanel-viewerbridge.acceptance.runtime-gates.test.mjs
//
// Offline tests for the G2 hard runtime preflight gates and the Chromium headless-shell resolution
// contract (live plan docs/research/2026-10-02-g2-live-execution-plan.md §3.1 / §3.2 "Required
// activation-preparation tests"):
//   * every Node / playwright / playwright-core / headless-shell mismatch or unavailable value refuses
//     with ZERO filesystem writes (temp-dir fake trees + injected seams; no D2 / reservation);
//   * matching values pass;
//   * main() (activated COPY in an isolated temp root, fake fs/git, trapped browser package) runs the
//     gate after W1 and before W2a, and a refusal never reaches directory creation or reservation;
//   * static source-order guards (gate before establishAttemptsDirectory; no browser-package import or
//     spawn before B3; post-launch browser.version() strict equality kept in Phase 0);
//   * T-same-target: for every ACCEPTED env/install case the resolver's executable equals Playwright's
//     internal registry `findExecutable('chromium-headless-shell').executablePath()` (computed in a
//     short child `node -e` per case with that case's env -- the browser is NEVER launched); for every
//     REJECTED case only the pre-reservation refusal is asserted (no path equality).
// The real harness is only read and imported; LIVE_PATH_WIRED stays false. No browser, Viewer, fixture,
// network, authorization record or attempt directory is ever touched.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, chmodSync,
  readdirSync, lstatSync, existsSync, accessSync, constants as fsConstants,
} from 'node:fs';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';
import { importHarnessCopy, importDormantHarness, readRealHarnessSource, REAL_REPO_ROOT } from './support/g2-harness-copy.mjs';
import { passingRuntimeGateSeams } from './support/g2-runtime-gate-fakes.mjs';

const HARNESS_SOURCE = readRealHarnessSource();
const REPO_ROOT = REAL_REPO_ROOT;
const PLAN_FILE = path.join(REPO_ROOT, 'docs', 'research', '2026-10-02-g2-live-execution-plan.md');
const REAL_ATTEMPTS_D2 = path.join(REPO_ROOT, 'test', 'acceptance', 'results', H.ATTEMPTS_D2_NAME);
const REQ = H.G2_REQUIRED_RUNTIME;
const S = REQ.headlessShell;
const REASON = H.G2_RUNTIME_REFUSAL;
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** Host seams Playwright's calculatePlatform reads (injected so gate logic never depends on this machine). */
const MAC_ARM_HOST = Object.freeze({ osRelease: () => '27.0.0', cpus: () => [{ model: 'Apple M4' }] });
/** Resolution seam for temp repos: the bare import resolves inside the gated <repoRoot>/node_modules/playwright. */
const ROOT_PW = (repoRoot) => () => pathToFileURL(path.join(repoRoot, 'node_modules', 'playwright', 'package.json')).href;

const SANDBOX = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'g2-runtime-gates-')));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });
let seq = 0;
const freshDir = (label) => { seq += 1; const d = path.join(SANDBOX, `${label}-${seq}`); mkdirSync(d, { recursive: true }); return d; };

const REAL_ATTEMPTS_D2_EXISTED = existsSync(REAL_ATTEMPTS_D2);

// ---- read-only, recording real-fs seam (any non-read member access throws) ---------------------

function recordingReadFs() {
  const calls = [];
  const impl = {
    readFileSync: (p) => { calls.push(['readFileSync', p]); return readFileSync(p); },
    lstatSync: (p) => { calls.push(['lstatSync', p]); return lstatSync(p); },
    realpathSync: (p) => { calls.push(['realpathSync', p]); return realpathSync(p); },
    accessSync: (p, m) => { calls.push(['accessSync', p, m]); return accessSync(p, m); },
  };
  const fs = new Proxy(impl, {
    get: (t, k) => { if (Object.hasOwn(t, k)) return t[k]; calls.push(['FORBIDDEN', String(k)]); throw new Error(`runtime gate touched fs.${String(k)}`); },
    set: () => { throw new Error('runtime gate fs seam is read-only'); },
  });
  return { fs, calls };
}

/** lstat-based snapshot of a whole tree (type/size/mode per entry): equal before/after => no write. */
function snapshotTree(root) {
  const out = [];
  const walk = (p) => {
    let st;
    try { st = lstatSync(p); } catch { out.push([path.relative(root, p), 'absent']); return; }
    out.push([path.relative(root, p), st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file', st.size, st.mode, st.mtimeMs]);
    if (st.isDirectory() && !st.isSymbolicLink()) for (const n of readdirSync(p).sort()) walk(path.join(p, n));
  };
  walk(root);
  return out;
}

// ---- temp fixtures ------------------------------------------------------------------------------

function browsersJson({ revision = S.revision, browserVersion = S.browserVersion, overrides = false, duplicate = false, omit = false } = {}) {
  const shell = { name: S.name, revision, installByDefault: true, browserVersion, title: 'Chrome Headless Shell' };
  if (overrides) shell.revisionOverrides = { 'mac15-arm64': '9999' };
  const browsers = [{ name: 'chromium', revision: S.revision, installByDefault: true, browserVersion: S.browserVersion, title: 'Chrome for Testing' }];
  if (!omit) browsers.push(shell);
  if (duplicate) browsers.push({ ...shell });
  return JSON.stringify({ comment: 'test fixture', browsers }, null, 2);
}

function makeRepo({ playwright = REQ.playwright, core = REQ.playwrightCore, browsers = browsersJson(), nested = false, localBrowsers = false, omitPlaywright = false, omitCore = false, malformed = false } = {}) {
  const root = freshDir('repo');
  const nm = path.join(root, 'node_modules');
  if (!omitPlaywright) {
    mkdirSync(path.join(nm, 'playwright'), { recursive: true });
    writeFileSync(path.join(nm, 'playwright', 'package.json'), malformed ? '{not json' : JSON.stringify({ name: 'playwright', version: playwright }));
  }
  if (!omitCore) {
    mkdirSync(path.join(nm, 'playwright-core'), { recursive: true });
    writeFileSync(path.join(nm, 'playwright-core', 'package.json'), JSON.stringify({ name: 'playwright-core', version: core }));
    if (browsers !== null) writeFileSync(path.join(nm, 'playwright-core', 'browsers.json'), browsers);
  }
  if (nested) mkdirSync(path.join(nm, 'playwright', 'node_modules', 'playwright-core'), { recursive: true });
  if (localBrowsers) mkdirSync(path.join(nm, 'playwright-core', '.local-browsers'), { recursive: true });
  return root;
}

/** Builds `<root>/chromium_headless_shell-1234/...` (and optionally the headed bundle dir). */
function makeInstall(root, { headless = true, marker = 'file', exe = 'file', exeMode = 0o755, exeSize = 64, headed = false } = {}) {
  mkdirSync(root, { recursive: true });
  if (headed) {
    const hd = path.join(root, 'chromium-1234');
    mkdirSync(path.join(hd, 'chrome-mac-arm64'), { recursive: true });
    writeFileSync(path.join(hd, 'INSTALLATION_COMPLETE'), '');
  }
  if (!headless) return root;
  const D = path.join(root, S.directoryName);
  const exeDir = path.join(D, S.executableTokens[0]);
  mkdirSync(exeDir, { recursive: true });
  if (marker === 'file') writeFileSync(path.join(D, S.markerName), '');
  else if (marker === 'dir') mkdirSync(path.join(D, S.markerName));
  const E = path.join(exeDir, S.executableTokens[1]);
  if (exe === 'file') { writeFileSync(E, Buffer.alloc(exeSize, 0x41)); chmodSync(E, exeMode); }
  else if (exe === 'symlink') { const real = path.join(D, 'real-shell'); writeFileSync(real, Buffer.alloc(64, 0x41)); chmodSync(real, 0o755); symlinkSync(real, E); }
  else if (exe === 'dir') mkdirSync(E);
  return root;
}

const expectedE = (root) => path.join(root, S.directoryName, ...S.executableTokens);

/** Resolver call with the required Node/platform injected (the shell's real Node version is irrelevant). */
function resolve({ repoRoot, env = {}, home, fs, processVersion = REQ.node, platform = S.platform, arch = S.arch }) {
  return H.resolveG2RuntimeEnvelope({ repoRoot, env, fs, processVersion, platform, arch, homedir: () => home, ...MAC_ARM_HOST, resolvePlaywrightEntry: ROOT_PW(repoRoot) });
}

/** Runs the enforcing wrapper and proves: refusal reason, stderr report, zero writes, no attempts dir. */
function assertRefusesWithoutWrites(args) {
  const { repoRoot, env = {}, home, reason, step = null } = args;
  const processVersion = Object.hasOwn(args, 'processVersion') ? args.processVersion : REQ.node;
  const platform = Object.hasOwn(args, 'platform') ? args.platform : S.platform;
  const arch = Object.hasOwn(args, 'arch') ? args.arch : S.arch;
  const host = { ...MAC_ARM_HOST, ...(args.host || {}) };
  const watched = [repoRoot, home].filter(Boolean);
  const before = watched.map(snapshotTree);
  const { fs, calls } = recordingReadFs();
  const lines = [];
  let thrown = null;
  try {
    H.checkG2HardRuntimeGates({ repoRoot, env, fs, processVersion, platform, arch, resolvePlaywrightEntry: ROOT_PW(repoRoot), ...host, homedir: () => home, stderr: (l) => { lines.push(l); } });
  } catch (e) { thrown = e; }
  assert.ok(thrown instanceof H.G2RefusalError, `expected G2RefusalError, got ${thrown && thrown.message}`);
  assert.equal(thrown.reason, reason, JSON.stringify(thrown.detail && thrown.detail.failures));
  assert.equal(thrown.exitCode, 1);
  if (step) assert.ok(thrown.detail.failures.some((f) => f.step === step), `step ${step} in ${JSON.stringify(thrown.detail.failures)}`);
  // stderr (O1) carries every required value and the failing reason
  const text = lines.join('\n');
  for (const v of [REQ.node, REQ.playwright, S.revision, S.browserVersion, reason]) assert.ok(text.includes(v), `stderr report includes ${v}`);
  assert.ok(text.includes('node: detected=') && text.includes('playwright-core: detected=') && text.includes('chromium-headless-shell: D='));
  // read-only: only the four read methods were used, and nothing on disk changed
  assert.equal(calls.some((c) => c[0] === 'FORBIDDEN'), false);
  assert.deepEqual(watched.map(snapshotTree), before, 'no filesystem change under the fake roots');
  assert.equal(existsSync(REAL_ATTEMPTS_D2), REAL_ATTEMPTS_D2_EXISTED, 'no real attempts directory created');
  return thrown;
}

// ------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------

test('required runtime constants are the exact plan §3.1 values (never ranges); headed chromium is not gated', () => {
  assert.equal(REQ.node, 'v22.23.1');
  assert.equal(REQ.playwright, '1.62.1');
  assert.equal(REQ.playwrightCore, '1.62.1');
  assert.deepEqual({ ...S, executableTokens: [...S.executableTokens] }, {
    name: 'chromium-headless-shell', revision: '1234', browserVersion: '151.0.7922.34', platform: 'darwin', arch: 'arm64',
    directoryName: 'chromium_headless_shell-1234', executableTokens: ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'], markerName: 'INSTALLATION_COMPLETE',
  });
  assert.deepEqual([...H.G2_BROWSERS_PATH_SOURCES], ['PLAYWRIGHT_BROWSERS_PATH', 'npm_config_playwright_browsers_path', 'npm_package_config_playwright_browsers_path']);
  assert.deepEqual([...H.G2_PWDEBUG_SOURCES], ['PWDEBUG', 'npm_config_pwdebug', 'npm_package_config_pwdebug']);
  assert.equal(H.G2_HOST_PLATFORM_OVERRIDE_ENV, 'PLAYWRIGHT_HOST_PLATFORM_OVERRIDE');
  assert.equal(H.G2_SELENIUM_REMOTE_ENV, 'SELENIUM_REMOTE_URL');
  assert.deepEqual({ ...REASON }, { VERSION: 'runtime-version-mismatch', BROWSER_PATH: 'runtime-browser-path-unsupported', CHROMIUM: 'runtime-chromium-mismatch' });
  assert.ok(Object.isFrozen(REQ) && Object.isFrozen(S));
  assert.equal(JSON.stringify(REQ).includes('chromium-1234'), false, 'the headed bundle is never a gate');
});

// ------------------------------------------------------------------------------------------
// Matching values pass (no writes)
// ------------------------------------------------------------------------------------------

test('matching values pass: default root (unset env) and absolute override; result carries the exact E; zero writes', () => {
  const repoRoot = makeRepo();
  const home = freshDir('home');
  const defRoot = makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  const before = [snapshotTree(repoRoot), snapshotTree(home)];
  const { fs, calls } = recordingReadFs();
  const lines = [];
  const r = H.checkG2HardRuntimeGates({ repoRoot, env: {}, fs, processVersion: REQ.node, platform: 'darwin', arch: 'arm64', ...MAC_ARM_HOST, resolvePlaywrightEntry: ROOT_PW(repoRoot), homedir: () => home, stderr: (l) => lines.push(l) });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.deepEqual(r.failures, []);
  assert.equal(r.detected.chromium.rootSource, 'default');
  assert.equal(r.detected.chromium.root, defRoot);
  assert.equal(r.detected.chromium.executable, expectedE(defRoot));
  assert.equal(r.detected.chromium.marker, true);
  assert.equal(r.detected.chromium.executableSize, 64);
  assert.ok(lines[0].includes('PASSED'));
  assert.equal(calls.some((c) => c[0] === 'FORBIDDEN'), false);
  assert.deepEqual([snapshotTree(repoRoot), snapshotTree(home)], before);

  const over = makeInstall(freshDir('override'));
  const r2 = resolve({ repoRoot, env: { PLAYWRIGHT_BROWSERS_PATH: over }, home: freshDir('emptyhome'), fs: recordingReadFs().fs });
  assert.equal(r2.ok, true, JSON.stringify(r2.failures));
  assert.equal(r2.detected.chromium.rootSource, 'PLAYWRIGHT_BROWSERS_PATH');
  assert.equal(r2.detected.chromium.executable, expectedE(over));
});

test('resolver never throws, even on garbage seams (fails closed instead)', () => {
  const r = H.resolveG2RuntimeEnvelope({ repoRoot: '/nonexistent-g2-root', env: null, fs: { readFileSync() { throw new Error('x'); }, lstatSync() { throw new Error('x'); }, realpathSync() { throw new Error('x'); }, accessSync() { throw new Error('x'); } }, processVersion: undefined, platform: 'darwin', arch: 'arm64', homedir: () => { throw new Error('no home'); } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, REASON.VERSION);
  assert.ok(r.failures.length >= 3);
});

// ------------------------------------------------------------------------------------------
// Node / Playwright version gates (§3.1) -- every mismatch/unavailable value refuses, zero writes
// ------------------------------------------------------------------------------------------

test('Node gate: process.version strict equality (other versions / missing => runtime-version-mismatch)', () => {
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  const repoRoot = makeRepo();
  for (const v of ['v26.10.0', 'v22.23.0', 'v22.23.10', '22.23.1', 'v22.23.1 ', '', null]) { // (an omitted/undefined seam defaults to the real process.version)
    assertRefusesWithoutWrites({ repoRoot, home, processVersion: v, reason: REASON.VERSION, step: 'node-version' });
  }
});

test('Playwright gates: playwright and playwright-core package.json versions strict (range/other/missing/malformed/nested => refuse)', () => {
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  const cases = [
    [{ playwright: '1.62.0' }, 'playwright-version'],
    [{ playwright: '^1.62.1' }, 'playwright-version'],
    [{ playwright: '1.62.1-beta' }, 'playwright-version'],
    [{ core: '1.62.2' }, 'playwright-core-version'],
    [{ core: '^1.62.1' }, 'playwright-core-version'],
    [{ omitPlaywright: true }, 'playwright-version'],
    [{ omitCore: true }, 'playwright-core-version'],
    [{ malformed: true }, 'playwright-version'],
    [{ nested: true }, 'playwright-core-nested'],
  ];
  for (const [opts, step] of cases) {
    assertRefusesWithoutWrites({ repoRoot: makeRepo(opts), home, reason: REASON.VERSION, step });
  }
});

test('Playwright resolution: a shadow playwright under a nearer (git-ignored) test/acceptance/node_modules or test/node_modules => refuse (real Node resolution from an isolated harness copy; no import)', async () => {
  const pkg = (name, version) => JSON.stringify({ name, version, main: 'index.js' });
  const base = {
    'node_modules/playwright/package.json': pkg('playwright', REQ.playwright),
    'node_modules/playwright/index.js': '',
    'node_modules/playwright-core/package.json': pkg('playwright-core', REQ.playwrightCore),
    'node_modules/playwright-core/browsers.json': browsersJson(),
  };
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  for (const [label, shadowDir, expectRefused] of [
    ['no shadow (accepted)', null, false],
    ['test/acceptance/node_modules shadow', 'test/acceptance/node_modules/playwright', true],
    ['test/node_modules shadow', 'test/node_modules/playwright', true],
  ]) {
    const files = { ...base };
    if (shadowDir) { files[`${shadowDir}/package.json`] = pkg('playwright', REQ.playwright); files[`${shadowDir}/index.js`] = ''; }
    const copy = await importHarnessCopy({ livePathWired: false, prefix: 'g2-runtime-gates-shadow-', files });
    const before = snapshotTree(copy.root);
    // default fs seam (real, read-only) and DEFAULT resolver: import.meta.resolve from the copy's own location
    const r = copy.module.resolveG2RuntimeEnvelope({ repoRoot: copy.root, env: {}, processVersion: REQ.node, platform: S.platform, arch: S.arch, homedir: () => home, ...MAC_ARM_HOST });
    const resolutionFailure = r.failures.find((f) => f.step === 'playwright-resolution');
    if (expectRefused) {
      assert.ok(resolutionFailure, `${label}: ${JSON.stringify(r.failures)}`);
      assert.equal(r.ok, false);
      assert.equal(r.reason, REASON.VERSION);
      assert.equal(r.detected.playwrightEntry, realpathSync(path.join(copy.root, shadowDir, 'index.js')));
    } else {
      assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.failures)}`);
      assert.equal(r.detected.playwrightEntry, realpathSync(path.join(copy.root, 'node_modules', 'playwright', 'index.js')));
    }
    assert.deepEqual(snapshotTree(copy.root), before, `${label}: no write`);
    rmSync(copy.root, { recursive: true, force: true });
  }
});

test('Playwright resolution: unresolvable / non-file / throwing resolver => refuse (fail closed)', () => {
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  const repoRoot = makeRepo();
  for (const resolvePlaywrightEntry of [() => { throw new Error('ERR_MODULE_NOT_FOUND'); }, () => 'node:playwright', () => null, () => pathToFileURL(path.join(repoRoot, 'node_modules', 'playwright-core', 'package.json')).href]) {
    const r = H.resolveG2RuntimeEnvelope({ repoRoot, env: {}, fs: recordingReadFs().fs, processVersion: REQ.node, platform: S.platform, arch: S.arch, homedir: () => home, ...MAC_ARM_HOST, resolvePlaywrightEntry });
    assert.equal(r.reason, REASON.VERSION);
    assert.ok(r.failures.some((f) => f.step === 'playwright-resolution'), JSON.stringify(r.failures));
  }
});

test('all gates are evaluated and reported together; version mismatch outranks the chromium classes', () => {
  const repoRoot = makeRepo({ playwright: '1.0.0' });
  const home = freshDir('home'); // no install at all
  const err = assertRefusesWithoutWrites({ repoRoot, home, processVersion: 'v26.10.0', env: { PWDEBUG: '1' }, reason: REASON.VERSION });
  const steps = err.detail.failures.map((f) => f.step);
  assert.ok(steps.includes('node-version') && steps.includes('playwright-version') && steps.includes('pwdebug'));
  const err2 = assertRefusesWithoutWrites({ repoRoot: makeRepo(), home, env: { PLAYWRIGHT_BROWSERS_PATH: '0' }, reason: REASON.BROWSER_PATH, step: 'browsers-path-special' });
  assert.equal(err2.detail.failures.length, 1);
});

// ------------------------------------------------------------------------------------------
// §3.2 steps 1-4: platform / headless mode / browsers root
// ------------------------------------------------------------------------------------------

test('platform gate: only darwin/arm64 (linux, win32, darwin/x64 => runtime-browser-path-unsupported)', () => {
  const repoRoot = makeRepo();
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  for (const [platform, arch] of [['linux', 'arm64'], ['win32', 'x64'], ['darwin', 'x64'], ['darwin', null], [null, 'arm64']]) {
    assertRefusesWithoutWrites({ repoRoot, home, platform, arch, reason: REASON.BROWSER_PATH, step: 'platform' });
  }
});

test('host platform mirrors Playwright calculatePlatform: Darwin < 20 or no Apple CPU model (or unreadable) => refuse (it would pick mac-x64)', () => {
  const repoRoot = makeRepo();
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  for (const host of [
    { osRelease: () => '19.6.0' },
    { osRelease: () => 'garbage' },
    { osRelease: () => { throw new Error('no release'); } },
    { cpus: () => [{ model: 'Intel(R) Core(TM) i9' }] },
    { cpus: () => [] },
    { cpus: () => { throw new Error('no cpus'); } },
  ]) {
    assertRefusesWithoutWrites({ repoRoot, home, host, reason: REASON.BROWSER_PATH, step: 'host-platform' });
  }
});

test('SELENIUM_REMOTE_URL (any non-empty value) => refuse: chromium.launch() would use a remote hub, never E; empty is accepted', () => {
  const repoRoot = makeRepo();
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  for (const v of ['http://127.0.0.1:4444/wd/hub', '0', ' ']) assertRefusesWithoutWrites({ repoRoot, home, env: { SELENIUM_REMOTE_URL: v }, reason: REASON.BROWSER_PATH, step: 'selenium-remote' });
  assert.equal(resolve({ repoRoot, env: { SELENIUM_REMOTE_URL: '' }, home, fs: recordingReadFs().fs }).ok, true);
});

// Credential-bearing sentinels: the raw SELENIUM_REMOTE_URL value must never reach any diagnostic.
const SELENIUM_SECRETS = [
  'https://g2user:S3cr3tP4ssw0rd-QZX@hub.example.invalid:4444/wd/hub',
  'http://hub.example.invalid/wd/hub?token=tok_9f8e7d6c5b4a-SENTINEL&api_key=KEY-ZZ-4242#frag-SENTINEL',
  'ws://u:p@h/DISTINCTIVE-SENTINEL-8d3f1c',
];
const SELENIUM_SAFE_MESSAGE = 'SELENIUM_REMOTE_URL is set; remote-browser environments are not permitted';
const SECRET_FRAGMENTS = ['g2user', 'S3cr3tP4ssw0rd', 'QZX', 'tok_9f8e7d6c5b4a', 'KEY-ZZ-4242', 'frag-SENTINEL', 'DISTINCTIVE-SENTINEL', 'hub.example.invalid', '/wd/hub', 'SENTINEL'];
const assertNoSecret = (text, what) => { for (const f of [...SELENIUM_SECRETS, ...SECRET_FRAGMENTS]) assert.equal(text.includes(f), false, `${what} leaks ${JSON.stringify(f)}`); };

test('SELENIUM_REMOTE_URL credentials are never emitted: refusal still pre-reservation; stderr/error/detail carry only the constant presence message', () => {
  const repoRoot = makeRepo();
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  for (const secret of SELENIUM_SECRETS) {
    const thrown = assertRefusesWithoutWrites({ repoRoot, home, env: { SELENIUM_REMOTE_URL: secret }, reason: REASON.BROWSER_PATH, step: 'selenium-remote' });
    const { fs } = recordingReadFs();
    const lines = [];
    let t2 = null;
    try { H.checkG2HardRuntimeGates({ repoRoot, env: { SELENIUM_REMOTE_URL: secret }, fs, processVersion: REQ.node, platform: S.platform, arch: S.arch, ...MAC_ARM_HOST, resolvePlaywrightEntry: ROOT_PW(repoRoot), homedir: () => home, stderr: (l) => lines.push(l) }); } catch (e) { t2 = e; }
    for (const e of [thrown, t2]) {
      assertNoSecret(String(e.message), 'error message');
      assertNoSecret(String(e.stack), 'error stack');
      assertNoSecret(JSON.stringify(e.detail), 'error detail');
      assertNoSecret(JSON.stringify(e, Object.getOwnPropertyNames(e)), 'serialized error');
    }
    const text = lines.join('\n');
    assertNoSecret(text, 'stderr/O1 report');
    assert.ok(text.includes(SELENIUM_SAFE_MESSAGE), 'safe constant presence/refusal message is emitted');
    assert.ok(text.includes('env SELENIUM_REMOTE_URL="(set; value withheld)"'));
    assert.ok(t2.detail.failures.some((f) => f.step === 'selenium-remote' && f.message === SELENIUM_SAFE_MESSAGE));
    // the resolver's own return value (what any caller could serialize) is clean too
    assertNoSecret(JSON.stringify(resolve({ repoRoot, env: { SELENIUM_REMOTE_URL: secret }, home, fs: recordingReadFs().fs })), 'resolver result');
  }
});

test('default root: .local-browsers present under playwright-core => refuse (a second candidate root)', () => {
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  assertRefusesWithoutWrites({ repoRoot: makeRepo({ localBrowsers: true }), home, reason: REASON.BROWSER_PATH, step: 'local-browsers-present' });
});

// ------------------------------------------------------------------------------------------
// §3.2 steps 5-6: descriptor + installation (temp trees)
// ------------------------------------------------------------------------------------------

test('descriptor: missing/malformed browsers.json, zero or two headless-shell entries => runtime-chromium-mismatch', () => {
  const home = freshDir('home');
  makeInstall(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  assertRefusesWithoutWrites({ repoRoot: makeRepo({ browsers: null }), home, reason: REASON.CHROMIUM, step: 'descriptor-unreadable' });
  assertRefusesWithoutWrites({ repoRoot: makeRepo({ browsers: '{oops' }), home, reason: REASON.CHROMIUM, step: 'descriptor-unreadable' });
  assertRefusesWithoutWrites({ repoRoot: makeRepo({ browsers: browsersJson({ omit: true }) }), home, reason: REASON.CHROMIUM, step: 'descriptor-count' });
  assertRefusesWithoutWrites({ repoRoot: makeRepo({ browsers: browsersJson({ duplicate: true }) }), home, reason: REASON.CHROMIUM, step: 'descriptor-count' });
});

test('installation: marker as a directory and executable as a directory => refuse', () => {
  const repoRoot = makeRepo();
  const home1 = freshDir('home');
  makeInstall(path.join(home1, 'Library', 'Caches', 'ms-playwright'), { marker: 'dir' });
  assertRefusesWithoutWrites({ repoRoot, home: home1, reason: REASON.CHROMIUM, step: 'marker-not-regular' });
  const home2 = freshDir('home');
  makeInstall(path.join(home2, 'Library', 'Caches', 'ms-playwright'), { exe: 'dir' });
  assertRefusesWithoutWrites({ repoRoot, home: home2, reason: REASON.CHROMIUM, step: 'executable-not-regular' });
});

// ------------------------------------------------------------------------------------------
// main(): the gate sits between W1 and W2a (activated COPY in an isolated root; fake fs/git)
// ------------------------------------------------------------------------------------------

const ACT = await importHarnessCopy({ livePathWired: true, prefix: 'g2-runtime-gates-act-' });
const A = ACT.module;
after(() => { rmSync(ACT.root, { recursive: true, force: true }); });
const FAKE_ROOT = '/repo';
const FAKE_HEAD = '82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0';
const RECORD = 'docs/prompts/g2-live-authorization.md';
const AUTH_ID = 'g2-runtime-gate-0001';
const PROC_BYTES = readFileSync(path.join(REPO_ROOT, A.PROCEDURE_REL_PATH), 'utf8');

function mainWorld({ seamsOverride = {}, faultMkdir = false } = {}) {
  const log = [];
  const record = [
    '# G2 runtime-gate offline fixture (fake fs only)', '',
    A.MARKER_LIVE_LINE,
    `Authorization-ID: ${AUTH_ID}`,
    `Baseline-HEAD: ${FAKE_HEAD}`,
    `Procedure-SHA256: ${sha(Buffer.from(PROC_BYTES))}`,
    `Harness-SHA256: ${sha(Buffer.from(ACT.text))}`,
    `Model-A-URN-SHA256: ${sha(Buffer.from(A.MODEL_A_URN))}`,
    `Model-B-URN-SHA256: ${sha(Buffer.from(A.MODEL_B_URN))}`,
    A.RUNTIME_LINE, '',
  ].join('\n');
  const fs = A.createRecordingFakeFs({
    seedDirs: [`${FAKE_ROOT}/docs/prompts`, `${FAKE_ROOT}/docs/research`, `${FAKE_ROOT}/test/acceptance`],
    seedFiles: { [`${FAKE_ROOT}/${A.PROCEDURE_REL_PATH}`]: PROC_BYTES, [`${FAKE_ROOT}/${A.HARNESS_REL_PATH}`]: ACT.text, [`${FAKE_ROOT}/${RECORD}`]: record },
    fault: (rec) => { log.push({ kind: 'fs', op: rec.op, path: rec.path }); return faultMkdir && rec.op === 'mkdir' ? 'error' : null; },
  });
  const pass = passingRuntimeGateSeams({ repoRoot: FAKE_ROOT, required: A.G2_REQUIRED_RUNTIME });
  const gateFs = new Proxy(pass.seams.fs, { get: (t, k) => (...a) => { log.push({ kind: 'gate-fs', op: String(k), path: a[0] }); return t[k](...a); } });
  const trapPkg = new Proxy({}, { get: (_t, k) => { log.push({ kind: 'browserPackage', k: String(k) }); throw new Error('browser package must not be touched'); } });
  const deps = {
    fs, repoRoot: FAKE_ROOT,
    gitHead: () => { log.push({ kind: 'git' }); return FAKE_HEAD; },
    git: () => { log.push({ kind: 'git' }); return ''; },
    browserPackage: trapPkg,
    serveModule: () => { log.push({ kind: 'serve' }); },
    onEvent: (e) => { log.push({ kind: 'event', e }); },
    runtimeGateSeams: { ...pass.seams, fs: gateFs, ...seamsOverride },
  };
  return { log, deps, fs, lines: pass.lines };
}
const MAIN_ARGV = ['node', 'h.mjs', '--execute-live-g2', '--authorization-record', RECORD];
const MAIN_ENV = { G2_LIVE_AUTHORIZED: 'YES' };
const WRITE_OPS = new Set(['mkdir', 'open', 'write', 'fsync', 'rename', 'link', 'unlink', 'close']);

test('activated copy: LIVE_PATH_WIRED=true only in the isolated copy, rooted outside the real repository', () => {
  assert.equal(A.LIVE_PATH_WIRED, true);
  assert.notEqual(realpathSync(A.REPO_ROOT), REPO_ROOT);
});

for (const [label, override, reason] of [
  ['Node v26.10.0', { processVersion: 'v26.10.0' }, REASON.VERSION],
  ['PWDEBUG=inspector', { env: { PWDEBUG: 'inspector' } }, REASON.BROWSER_PATH],
  ['headless-shell not installed (empty fake home)', { homedir: () => '/fake-home-without-install' }, REASON.CHROMIUM],
]) {
  test(`main() on the activated copy: ${label} => ${reason} after W1, before W2a; no mkdir/open/write/rename, no browser package, record unspent`, async () => {
    const w = mainWorld({ seamsOverride: override });
    await assert.rejects(A.main({ argv: MAIN_ARGV, env: MAIN_ENV, deps: w.deps }), (err) => err instanceof A.G2RefusalError && err.reason === reason);
    const fsOps = w.log.filter((e) => e.kind === 'fs');
    assert.ok(fsOps.some((e) => e.op === 'readFile' && e.path === `${FAKE_ROOT}/${RECORD}`), 'W1 read the record first');
    assert.equal(fsOps.some((e) => WRITE_OPS.has(e.op)), false, `no durable act: ${JSON.stringify(fsOps.filter((e) => WRITE_OPS.has(e.op)))}`);
    assert.equal(w.log.some((e) => e.kind === 'browserPackage' || e.kind === 'serve' || e.kind === 'event'), false);
    const chain = A.resolveAttemptsChain(FAKE_ROOT);
    for (const d of [chain.D1, chain.D2]) assert.throws(() => w.fs.lstat(d), /ENOENT/, `${d} must not exist`);
    assert.ok(w.lines.some((l) => l.includes(reason)), 'refusal printed to the stderr seam');
  });
}

test('main() on the activated copy: credential-bearing SELENIUM_REMOTE_URL => refusal after W1/before W2a; nothing durable; no secret in stderr seam, error, or event log', async () => {
  for (const secret of SELENIUM_SECRETS) {
    const w = mainWorld({ seamsOverride: { env: { SELENIUM_REMOTE_URL: secret } } });
    let thrown = null;
    try { await A.main({ argv: MAIN_ARGV, env: MAIN_ENV, deps: w.deps }); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof A.G2RefusalError && thrown.reason === REASON.BROWSER_PATH);
    assert.equal(w.log.some((e) => e.kind === 'fs' && WRITE_OPS.has(e.op)), false);
    assert.equal(w.log.some((e) => e.kind === 'browserPackage' || e.kind === 'serve' || e.kind === 'event'), false);
    const chain = A.resolveAttemptsChain(FAKE_ROOT);
    for (const d of [chain.D1, chain.D2]) assert.throws(() => w.fs.lstat(d), /ENOENT/);
    assertNoSecret(w.lines.join('\n'), 'stderr seam');
    assert.ok(w.lines.join('\n').includes(SELENIUM_SAFE_MESSAGE));
    assertNoSecret(`${thrown.message}\n${thrown.stack}\n${JSON.stringify(thrown.detail)}\n${JSON.stringify(w.log)}`, 'error/detail/event log');
  }
});

test('main() on the activated copy: matching runtime passes the gate, which completes entirely before the first W2a mkdir', async () => {
  const w = mainWorld({ faultMkdir: true });
  await assert.rejects(A.main({ argv: MAIN_ARGV, env: MAIN_ENV, deps: w.deps }), (err) => err instanceof A.G2DurabilityError);
  const lastGate = w.log.map((e, i) => (e.kind === 'gate-fs' ? i : -1)).filter((i) => i >= 0).pop();
  const firstMkdir = w.log.findIndex((e) => e.kind === 'fs' && e.op === 'mkdir');
  const recordRead = w.log.findIndex((e) => e.kind === 'fs' && e.op === 'readFile' && e.path === `${FAKE_ROOT}/${RECORD}`);
  assert.ok(recordRead >= 0 && lastGate > recordRead, 'gate after W1');
  assert.ok(firstMkdir > lastGate, 'gate before W2a');
  assert.ok(w.lines[0].includes('PASSED'));
  assert.equal(w.log.some((e) => e.kind === 'browserPackage'), false);
});

test('main() on a DORMANT copy (LIVE_PATH_WIRED=false) never reaches the gate: refuses live-path-not-wired with no gate fs access', async () => {
  const D = (await importDormantHarness()).module;
  const w = mainWorld();
  await assert.rejects(D.main({ argv: MAIN_ARGV, env: MAIN_ENV, deps: w.deps }), (err) => err instanceof D.G2RefusalError && err.reason === 'live-path-not-wired');
  assert.deepEqual(w.log, []);
});

// ------------------------------------------------------------------------------------------
// Static source-order guards
// ------------------------------------------------------------------------------------------

function stripComments(src) {
  let out = ''; let i = 0; let quote = null;
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (quote) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === quote) quote = null; i += 1; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c; i += 1;
  }
  return out;
}
const CODE = stripComments(HARNESS_SOURCE);
const fnBody = (sig) => { const s = CODE.indexOf(sig); assert.ok(s >= 0, sig); return CODE.slice(s, CODE.indexOf('\n}\n', s) + 2); };
const PKG = ['play', 'wright'].join('');

test('static: main() runs checkG2HardRuntimeGates exactly once, after W1 (record + startup scan) and before W2a/W2b/browser import', () => {
  const body = fnBody('async function main(');
  const order = ['validateAuthorizationRecord(', 'if (!validation.ok)', 'scanAttemptsDirectoryForStartup(', 'if (!startup.ok)', 'checkG2HardRuntimeGates(', 'establishAttemptsDirectory(', 'reserveAttempt(', `import('${PKG}')`];
  let last = -1;
  for (const tok of order) {
    const i = body.indexOf(tok);
    assert.ok(i > last, `${tok} must follow the previous step`);
    assert.equal(body.split(tok).length - 1, 1, `${tok} exactly once in main()`);
    last = i;
  }
  const pre = body.slice(0, body.indexOf('reserveAttempt('));
  for (const tok of ['spawn', 'execFile', 'exec(', 'fork(', `import(`, 'require(', '.launch(', 'await ']) assert.equal(pre.includes(tok), false, `${tok} before B3`);
});

test('static: the runtime-gate functions perform no import/require/spawn/exec, no write and never run the executable', () => {
  const src = ['function resolveG2RuntimeEnvelope(', 'function formatG2RuntimeGateReport(', 'function checkG2HardRuntimeGates('].map(fnBody).join('\n');
  for (const tok of ['import(', 'require(', 'spawn', 'execFile', 'execSync', 'fork(', '--version', 'writeFile', 'mkdir', 'openSync', 'rename', 'unlink', 'chmod', 'symlinkSync', 'await ', 'fetch(']) {
    assert.equal(src.includes(tok), false, tok);
  }
  // the default fs seam exposes only the four read methods
  const seam = CODE.slice(CODE.indexOf('const G2_RUNTIME_GATE_READ_FS'), CODE.indexOf('const G2_X_OK'));
  assert.deepEqual([...seam.matchAll(/^\s+(\w+): \(/gm)].map((m) => m[1]), ['readFileSync', 'lstatSync', 'realpathSync', 'accessSync']);
});

test('static: Phase-0 browser-launch keeps the post-launch browser.version() strict equality (PREFLIGHT_FAILED path), before context-create', () => {
  const body = fnBody('async function runPostReservation(');
  const launch = body.indexOf("p0('browser-launch'");
  const version = body.indexOf('live.browser.version()', launch);
  const check = body.indexOf('!== G2_REQUIRED_RUNTIME.headlessShell.browserVersion', launch);
  const ctx = body.indexOf("p0('context-create'");
  assert.ok(launch >= 0 && launch < version && version < check && check < ctx);
  assert.ok(body.slice(check, ctx).includes('throw new Error('), 'a mismatch throws inside the p0 step => Phase0Failure => PREFLIGHT_FAILED');
});

// ------------------------------------------------------------------------------------------
// T-same-target (§3.2): accepted cases == Playwright's internal registry path; rejected => refusal
// ------------------------------------------------------------------------------------------

/**
 * Explicit classification of EVERY plan §3.2 case (env cases + install cases) plus a few extra
 * accepted variants. `plan` is the verbatim phrase from the plan's "Required activation-preparation
 * tests" paragraph (checked below). `setup(ctx)` returns `{env, home, repoRoot}`; ctx.makeHome builds
 * a fake HOME with an install under the default root.
 */
const TSAME_CASES = [
  // ---- env cases ----
  { id: 'env-unset', plan: 'unset', cls: 'accepted', setup: (c) => ({ env: {}, home: c.homeWithInstall() }) },
  { id: 'env-empty', plan: 'empty string', cls: 'accepted', setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: '' }, home: c.homeWithInstall() }) },
  { id: 'env-absolute-override', plan: 'absolute override to a temp tree', cls: 'accepted', setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: c.rootWithInstall() }, home: c.emptyHome() }) },
  { id: 'env-zero', plan: '`"0"`', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: '0' }, home: c.homeWithInstall() }) },
  { id: 'env-relative', plan: 'relative', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: 'ms-playwright' }, home: c.homeWithInstall() }) },
  { id: 'env-non-normalized-dotdot', plan: 'non-normalized absolute', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => { const r = c.rootWithInstall(); return { env: { PLAYWRIGHT_BROWSERS_PATH: `${path.dirname(r)}/x/../${path.basename(r)}` }, home: c.emptyHome() }; } },
  { id: 'env-non-normalized-trailing-sep', plan: 'non-normalized absolute', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: `${c.rootWithInstall()}/` }, home: c.emptyHome() }) },
  { id: 'env-non-normalized-double-sep', plan: 'non-normalized absolute', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => { const r = c.rootWithInstall(); return { env: { PLAYWRIGHT_BROWSERS_PATH: `${path.dirname(r)}//${path.basename(r)}` }, home: c.emptyHome() }; } },
  { id: 'env-conflicting-npm-config', plan: 'conflicting `npm_config_*`', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: c.rootWithInstall(), npm_config_playwright_browsers_path: c.rootWithInstall() }, home: c.emptyHome() }) },
  { id: 'env-empty-with-npm-source', plan: 'empty `PLAYWRIGHT_BROWSERS_PATH` with a non-empty npm source (default root wins)', cls: 'accepted', setup: (c) => ({ env: { PLAYWRIGHT_BROWSERS_PATH: '', npm_config_playwright_browsers_path: c.rootWithInstall() }, home: c.homeWithInstall() }) },
  { id: 'env-pwdebug', plan: '`PWDEBUG=inspector` via each of the three sources', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PWDEBUG: 'inspector' }, home: c.homeWithInstall() }) },
  { id: 'env-npm-config-pwdebug', plan: '`PWDEBUG=inspector` via each of the three sources', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { npm_config_pwdebug: 'inspector' }, home: c.homeWithInstall() }) },
  { id: 'env-npm-package-config-pwdebug', plan: '`PWDEBUG=inspector` via each of the three sources', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { npm_package_config_pwdebug: 'inspector' }, home: c.homeWithInstall() }) },
  { id: 'env-host-platform-override', plan: '`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`', cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'mac15-arm64' }, home: c.homeWithInstall() }) },
  // ---- install cases ----
  { id: 'install-headless-dir-missing', plan: 'headless-shell dir missing', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ headless: false }) }) },
  { id: 'install-marker-missing', plan: 'marker missing', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ marker: 'none' }) }) },
  { id: 'install-executable-missing', plan: 'executable missing', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ exe: 'none' }) }) },
  { id: 'install-executable-symlink', plan: 'symlink', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ exe: 'symlink' }) }) },
  { id: 'install-executable-non-executable', plan: 'non-executable', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ exeMode: 0o644 }) }) },
  { id: 'install-executable-zero-size', plan: 'zero-size', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ exeSize: 0 }) }) },
  { id: 'install-wrong-revision', plan: 'wrong `revision`', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall(), repoRoot: makeRepo({ browsers: browsersJson({ revision: '1233' }) }) }) },
  { id: 'install-wrong-browser-version', plan: '`browserVersion`', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall(), repoRoot: makeRepo({ browsers: browsersJson({ browserVersion: '151.0.7922.33' }) }) }) },
  { id: 'install-revision-overrides', plan: '`revisionOverrides` present', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall(), repoRoot: makeRepo({ browsers: browsersJson({ overrides: true }) }) }) },
  { id: 'install-headed-only', plan: 'headed `chromium-1234` present with headless-shell absent (must refuse)', cls: 'rejected', reason: REASON.CHROMIUM, setup: (c) => ({ env: {}, home: c.homeWithInstall({ headless: false, headed: true }) }) },
  { id: 'install-headless-only', plan: 'headless-shell present with headed absent (must pass)', cls: 'accepted', setup: (c) => ({ env: {}, home: c.homeWithInstall({ headed: false }) }) },
  // ---- extra accepted variants (not in the plan list; strengthen the oracle comparison) ----
  { id: 'extra-npm-config-absolute-only', plan: null, cls: 'accepted', setup: (c) => ({ env: { npm_config_playwright_browsers_path: c.rootWithInstall() }, home: c.emptyHome() }) },
  { id: 'extra-npm-package-config-absolute-only', plan: null, cls: 'accepted', setup: (c) => ({ env: { npm_package_config_playwright_browsers_path: c.rootWithInstall() }, home: c.emptyHome() }) },
  { id: 'extra-same-value-two-sources', plan: null, cls: 'accepted', setup: (c) => { const r = c.rootWithInstall(); return { env: { PLAYWRIGHT_BROWSERS_PATH: r, npm_config_playwright_browsers_path: r }, home: c.emptyHome() }; } },
  { id: 'extra-headed-and-headless-present', plan: null, cls: 'accepted', setup: (c) => ({ env: {}, home: c.homeWithInstall({ headed: true }) }) },
  { id: 'extra-selenium-remote-url', plan: null, cls: 'rejected', reason: REASON.BROWSER_PATH, setup: (c) => ({ env: { SELENIUM_REMOTE_URL: 'http://127.0.0.1:4444/wd/hub' }, home: c.homeWithInstall() }) },
  { id: 'extra-empty-pwdebug-and-override', plan: null, cls: 'accepted', setup: (c) => ({ env: { PWDEBUG: '', PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: '' }, home: c.homeWithInstall() }) },
];

/** The plan §3.2 case list, verbatim fragments in plan order (env cases, then install cases). */
const PLAN_CASE_PHRASES = [
  'unset', 'empty string', 'absolute override to a temp tree', '`"0"`', 'relative', 'non-normalized absolute', 'conflicting `npm_config_*`',
  'empty `PLAYWRIGHT_BROWSERS_PATH` with a non-empty npm source (default root wins)', '`PWDEBUG=inspector` via each of the three sources', '`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`',
  'headless-shell dir missing', 'marker missing', 'executable missing', 'symlink', 'non-executable', 'zero-size', 'wrong `revision`', '`browserVersion`',
  '`revisionOverrides` present', 'headed `chromium-1234` present with headless-shell absent (must refuse)', 'headless-shell present with headed absent (must pass)',
];

const tsameCtx = () => ({
  emptyHome: () => freshDir('tsame-home-empty'),
  rootWithInstall: (o) => makeInstall(freshDir('tsame-root'), o),
  homeWithInstall: (o = {}) => {
    const home = freshDir('tsame-home');
    const root = path.join(home, 'Library', 'Caches', 'ms-playwright');
    makeInstall(root, o); // marker:'none' / exe:'none' => that item is simply not created
    return home;
  },
});

/** Playwright's own resolution (internal registry, no launch) in a child with exactly the case env. */
function oracleExecutablePath({ env, home }) {
  const script = "const cb=require('playwright-core/lib/coreBundle');process.stdout.write(JSON.stringify({p:cb.registry.registry.findExecutable('chromium-headless-shell').executablePath()}));";
  const childEnv = { PATH: process.env.PATH, HOME: home, ...env };
  const out = execFileSync(process.execPath, ['-e', script], { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(out).p;
}

const REAL_CORE_VERSION = (() => { try { return JSON.parse(readFileSync(path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')).version; } catch { return null; } })();
const ORACLE_SKIP = process.platform !== 'darwin' || process.arch !== 'arm64'
  ? `T-same-target oracle comparison needs a darwin/arm64 host (this host: ${process.platform}/${process.arch})`
  : REAL_CORE_VERSION !== REQ.playwrightCore ? `installed playwright-core ${REAL_CORE_VERSION} is not ${REQ.playwrightCore}` : false;

test('T-same-target: the classification table labels every case accepted|rejected and covers every case of the plan §3.2 list', () => {
  const planText = readFileSync(PLAN_FILE, 'utf8');
  const para = planText.split('\n').find((l) => l.startsWith('**Required activation-preparation tests'));
  assert.ok(para, 'plan §3.2 "Required activation-preparation tests" paragraph present');
  for (const phrase of PLAN_CASE_PHRASES) {
    assert.ok(para.includes(phrase), `plan paragraph lists: ${phrase}`);
    assert.ok(TSAME_CASES.some((c) => c.plan === phrase), `classification table covers plan case: ${phrase}`);
  }
  const ids = new Set();
  for (const c of TSAME_CASES) {
    assert.ok(!ids.has(c.id), `unique id ${c.id}`); ids.add(c.id);
    assert.ok(c.cls === 'accepted' || c.cls === 'rejected', `${c.id} labeled`);
    if (c.cls === 'rejected') assert.ok(Object.values(REASON).includes(c.reason), `${c.id} names its refusal reason`);
    if (c.plan !== null) assert.ok(PLAN_CASE_PHRASES.includes(c.plan), `${c.id} cites a plan phrase`);
  }
  // the plan's own explicit classifications
  assert.equal(TSAME_CASES.find((c) => c.id === 'install-headed-only').cls, 'rejected');
  assert.equal(TSAME_CASES.find((c) => c.id === 'install-headless-only').cls, 'accepted');
  assert.equal(TSAME_CASES.find((c) => c.id === 'env-empty-with-npm-source').cls, 'accepted');
  // every PWDEBUG source is a separate rejected case
  for (const k of H.G2_PWDEBUG_SOURCES) assert.ok(TSAME_CASES.some((c) => c.cls === 'rejected' && c.setup(tsameCtx()).env[k] === 'inspector'), k);
});

for (const c of TSAME_CASES) {
  if (c.cls === 'accepted') {
    test(`T-same-target [accepted] ${c.id}: resolver E === Playwright registry findExecutable('chromium-headless-shell').executablePath() (no launch)`, { skip: ORACLE_SKIP }, () => {
      const { env, home, repoRoot = REPO_ROOT } = c.setup(tsameCtx());
      const before = snapshotTree(home);
      const { fs, calls } = recordingReadFs();
      const r = H.resolveG2RuntimeEnvelope({ repoRoot, env, fs, processVersion: REQ.node, platform: process.platform, arch: process.arch, homedir: () => home });
      assert.equal(r.ok, true, JSON.stringify(r.failures));
      const oracle = oracleExecutablePath({ env, home });
      assert.equal(r.detected.chromium.executable, oracle);
      assert.equal(calls.some((x) => x[0] === 'FORBIDDEN'), false);
      assert.deepEqual(snapshotTree(home), before);
    });
  } else {
    test(`T-same-target [rejected] ${c.id}: pre-reservation refusal ${c.reason} (no path-equality assertion)`, () => {
      const { env, home, repoRoot = makeRepo() } = c.setup(tsameCtx());
      assertRefusesWithoutWrites({ repoRoot, env, home, reason: c.reason });
    });
  }
}

test('T-same-target [accepted] real default install (read-only, only if present on this machine)', { skip: ORACLE_SKIP || (!existsSync(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', S.directoryName)) && 'no real default headless-shell install') }, () => {
  const env = {};
  const home = os.homedir();
  const r = H.resolveG2RuntimeEnvelope({ repoRoot: REPO_ROOT, env, fs: recordingReadFs().fs, processVersion: REQ.node, platform: process.platform, arch: process.arch, homedir: () => home });
  if (!r.ok) {
    // a present-but-incomplete real install must still fail closed in the chromium class only
    assert.equal(r.reason, REASON.CHROMIUM, JSON.stringify(r.failures));
    return;
  }
  assert.equal(r.detected.chromium.executable, oracleExecutablePath({ env, home }));
});

test('the oracle child really applies the case env (sanity: absolute override moves the oracle path)', { skip: ORACLE_SKIP }, () => {
  const a = makeInstall(freshDir('oracle-a'));
  const b = makeInstall(freshDir('oracle-b'));
  assert.equal(oracleExecutablePath({ env: { PLAYWRIGHT_BROWSERS_PATH: a }, home: freshDir('h') }), expectedE(a));
  assert.equal(oracleExecutablePath({ env: { PLAYWRIGHT_BROWSERS_PATH: b }, home: freshDir('h') }), expectedE(b));
});

test('no repo artifacts: no real attempts directory was created by this suite', () => {
  assert.equal(existsSync(REAL_ATTEMPTS_D2), REAL_ATTEMPTS_D2_EXISTED);
  assert.ok(fsConstants.X_OK > 0);
});
