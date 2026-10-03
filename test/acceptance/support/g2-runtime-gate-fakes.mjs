// test/acceptance/support/g2-runtime-gate-fakes.mjs
//
// Shared TEST-ONLY helper (not a test file: scripts/run-tests.mjs only collects `*.test.mjs`) for the
// G2 hard runtime preflight gates (`checkG2HardRuntimeGates` / `resolveG2RuntimeEnvelope`, live plan
// docs/research/2026-10-02-g2-live-execution-plan.md §3.1/§3.2). It builds an IN-MEMORY, READ-ONLY fs
// seam and a complete seam set so offline suites that drive a wired main() are independent of the
// real Node version, the installed Playwright packages and the real browser cache of the machine
// running the tests. Nothing here touches the real filesystem.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FAKE_RUNTIME_HOME = '/fake-home';

function fsError(code, p) {
  const e = new Error(`${code}: fake runtime-gate fs: ${p}`);
  e.code = code;
  return e;
}

/**
 * `createFakeRuntimeGateFs(entries)` -- entries: `{ [absPath]: {type:'file', content?, size?, mode?}
 * | {type:'dir'} | {type:'symlink', target} }`. Exposes ONLY the four read methods the gate uses
 * (readFileSync, lstatSync, realpathSync, accessSync); `calls` records every call.
 */
export function createFakeRuntimeGateFs(entries = {}) {
  const calls = [];
  const map = new Map(Object.entries(entries));
  const get = (p) => map.get(p);
  const stat = (e) => ({
    isFile: () => e.type === 'file',
    isDirectory: () => e.type === 'dir',
    isSymbolicLink: () => e.type === 'symlink',
    size: e.type === 'file' ? (e.size ?? Buffer.byteLength(String(e.content ?? ''))) : 0,
    mode: e.mode ?? (e.type === 'file' ? 0o644 : 0o755),
  });
  const resolveLinks = (p, depth = 0) => {
    if (depth > 16) throw fsError('ELOOP', p);
    const e = get(p);
    if (!e) throw fsError('ENOENT', p);
    if (e.type === 'symlink') return resolveLinks(path.resolve(path.dirname(p), e.target), depth + 1);
    return p;
  };
  const fs = {
    readFileSync(p) {
      calls.push(['readFileSync', p]);
      const real = resolveLinks(p);
      const e = get(real);
      if (e.type !== 'file') throw fsError('EISDIR', p);
      return Buffer.from(String(e.content ?? ''));
    },
    lstatSync(p) {
      calls.push(['lstatSync', p]);
      const e = get(p);
      if (!e) throw fsError('ENOENT', p);
      return stat(e);
    },
    realpathSync(p) {
      calls.push(['realpathSync', p]);
      return resolveLinks(p);
    },
    accessSync(p, mode) {
      calls.push(['accessSync', p, mode]);
      const e = get(resolveLinks(p));
      if ((mode & 1) && !((e.mode ?? 0o644) & 0o111)) throw fsError('EACCES', p);
    },
  };
  return { fs, calls, entries: map };
}

/** The exact passing layout for `repoRoot` + browsers `root` (default root under FAKE_RUNTIME_HOME). */
export function passingRuntimeGateEntries({ repoRoot, root = path.join(FAKE_RUNTIME_HOME, 'Library', 'Caches', 'ms-playwright'), required }) {
  const S = required.headlessShell;
  const D = path.join(root, S.directoryName);
  return {
    [path.join(repoRoot, 'node_modules', 'playwright')]: { type: 'dir' },
    [path.join(repoRoot, 'node_modules', 'playwright', 'index.mjs')]: { type: 'file', content: '' },
    [path.join(repoRoot, 'node_modules', 'playwright', 'package.json')]: { type: 'file', content: JSON.stringify({ name: 'playwright', version: required.playwright }) },
    [path.join(repoRoot, 'node_modules', 'playwright-core', 'package.json')]: { type: 'file', content: JSON.stringify({ name: 'playwright-core', version: required.playwrightCore }) },
    [path.join(repoRoot, 'node_modules', 'playwright-core', 'browsers.json')]: {
      type: 'file',
      content: JSON.stringify({ browsers: [
        { name: 'chromium', revision: S.revision, installByDefault: true, browserVersion: S.browserVersion },
        { name: S.name, revision: S.revision, installByDefault: true, browserVersion: S.browserVersion },
      ] }),
    },
    [D]: { type: 'dir' },
    [path.join(D, S.markerName)]: { type: 'file', content: '' },
    [path.join(D, ...S.executableTokens)]: { type: 'file', size: 4096, mode: 0o755 },
  };
}

/**
 * A complete passing seam set for `main({deps:{runtimeGateSeams}})` / `checkG2HardRuntimeGates` on a
 * fake `repoRoot`: required Node version, darwin/arm64, empty env, Darwin 27 / Apple CPU, fake home, in-memory fs; stderr
 * lines captured into `lines` (never printed).
 */
export function passingRuntimeGateSeams({ repoRoot, required, env = {}, extraEntries = {}, lines = [] }) {
  const { fs, calls } = createFakeRuntimeGateFs({ ...passingRuntimeGateEntries({ repoRoot, required }), ...extraEntries });
  return {
    seams: {
      env, fs, processVersion: required.node, platform: required.headlessShell.platform, arch: required.headlessShell.arch,
      osRelease: () => '27.0.0', cpus: () => [{ model: 'Apple M4' }],
      homedir: () => FAKE_RUNTIME_HOME, stderr: (l) => { lines.push(l); },
      // the bare import resolves inside the gated <repoRoot>/node_modules/playwright (no real resolution in the fake world)
      resolvePlaywrightEntry: () => pathToFileURL(path.join(repoRoot, 'node_modules', 'playwright', 'index.mjs')).href,
    },
    calls,
    lines,
  };
}
