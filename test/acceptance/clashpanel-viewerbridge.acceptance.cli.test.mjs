// test/acceptance/clashpanel-viewerbridge.acceptance.cli.test.mjs
//
// Offline CLI tests for the G2 harness entry point (procedure §4.1 "Interlock", §8 exit codes).
// Spawns the REAL harness file as a CLI (a child `node` process) from an EMPTY os.tmpdir() cwd with
// a clean environment, preloading (via `--import`) a small observer that (a) makes any attempt to
// RESOLVE the browser package fail loudly and (b) records every public node:fs call made after the
// harness module starts loading. With LIVE_PATH_WIRED=false every invocation -- including the fully
// authorized flag + env + record combination -- must exit 1 without resolving the browser package,
// without creating anything in the cwd or under test/acceptance/results/, and without any fs access
// beyond the entry-point guard's own realpath of the harness file. Nothing here imports the browser
// package; the spawned harness is never run with a reachable live path.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIVE_PATH_WIRED } from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));
const PKG = ['play', 'wright'].join('');
const MARK_RESOLVE = 'G2-CLI-TEST: browser package resolution attempted';
const MARK_FS = 'G2-CLI-TEST-FS:';

const HOOK_DIR = mkdtempSync(path.join(os.tmpdir(), 'g2-cli-hooks-'));
after(() => { rmSync(HOOK_DIR, { recursive: true, force: true }); });

// Resolve hook: any specifier naming the browser package (or its core / chromium) is refused.
writeFileSync(path.join(HOOK_DIR, 'deny-hooks.mjs'), `
export async function resolve(specifier, context, next) {
  if (/(^|\\/)${PKG}(-core)?($|\\/)|chromium/i.test(specifier)) {
    process.stderr.write(${JSON.stringify(MARK_RESOLVE)} + ' ' + specifier + '\\n');
    throw new Error('denied by the G2 CLI test');
  }
  return next(specifier, context);
}
`);
// Preload: registers the hook and wraps the public node:fs API (synced into ESM named exports) so
// every call made while the harness loads and runs is reported on exit.
writeFileSync(path.join(HOOK_DIR, 'observe.mjs'), `
import { register, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
register(${JSON.stringify(pathToFileURL(path.join(HOOK_DIR, 'deny-hooks.mjs')).href)});
const calls = [];
const names = ['openSync', 'readFileSync', 'writeFileSync', 'mkdirSync', 'lstatSync', 'statSync', 'readdirSync', 'renameSync',
  'linkSync', 'unlinkSync', 'fsyncSync', 'writeSync', 'closeSync', 'realpathSync', 'existsSync', 'appendFileSync', 'rmSync',
  'open', 'readFile', 'writeFile', 'mkdir', 'rename', 'link', 'unlink'];
for (const n of names) {
  const orig = fs[n];
  if (typeof orig !== 'function') continue;
  const wrapped = function (...args) { calls.push([n, typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : typeof args[0]]); return orig.apply(this, args); };
  if (orig.native) wrapped.native = orig.native;
  fs[n] = wrapped;
}
syncBuiltinESMExports();
process.on('exit', () => { process.stderr.write(${JSON.stringify(MARK_FS)} + JSON.stringify(calls) + '\\n'); });
`);

function runCli(args, extraEnv = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'g2-cli-cwd-'));
  const resultsBefore = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : null;
  // A clean environment: in particular NO NODE_TEST_CONTEXT (the entry guard would skip main()).
  const env = { PATH: process.env.PATH, HOME: cwd, ...extraEnv };
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(HOOK_DIR, 'observe.mjs')).href, HARNESS_FILE, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const cwdAfter = readdirSync(cwd);
  const resultsAfter = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).sort() : null;
  rmSync(cwd, { recursive: true, force: true });
  const fsLine = (r.stderr || '').split('\n').find((l) => l.startsWith(MARK_FS));
  const fsCalls = fsLine ? JSON.parse(fsLine.slice(MARK_FS.length)) : null;
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, cwdAfter, resultsBefore, resultsAfter, fsCalls };
}

function assertNoEffect(r, label) {
  assert.equal(r.signal, null, `${label}: no signal/timeout`);
  assert.equal(r.status, 1, `${label}: exit 1 (stderr: ${r.stderr})`);
  assert.equal(r.stderr.includes(MARK_RESOLVE), false, `${label}: never resolved the browser package`);
  assert.deepEqual(r.cwdAfter, [], `${label}: nothing created in the cwd`);
  assert.deepEqual(r.resultsAfter, r.resultsBefore, `${label}: test/acceptance/results/ unchanged`);
  assert.ok(Array.isArray(r.fsCalls), `${label}: fs observer report present`);
  const harness = HARNESS_FILE;
  const other = r.fsCalls.filter(([n, p]) => !(n === 'realpathSync' && (p === harness || p === pathToFileURL(harness).href)));
  assert.deepEqual(other, [], `${label}: no fs access beyond the entry guard's realpath of the harness itself`);
}

test('CLI: LIVE_PATH_WIRED is false in the harness under test', () => {
  assert.equal(LIVE_PATH_WIRED, false);
});

test('CLI: fully authorized interlock (flag + G2_LIVE_AUTHORIZED=YES + record) still refuses (live-path-not-wired) with no effect', () => {
  const r = runCli(['--execute-live-g2', '--authorization-record', 'docs/prompts/g2-live-authorization.md'], { G2_LIVE_AUTHORIZED: 'YES' });
  assertNoEffect(r, 'authorized');
  assert.match(r.stderr, /live-path-not-wired/);
});

test('CLI: a record path that does not exist is not even looked at (the wiring gate precedes W1)', () => {
  const r = runCli(['--execute-live-g2', '--authorization-record', 'docs/prompts/does-not-exist-anywhere.md'], { G2_LIVE_AUTHORIZED: 'YES' });
  assertNoEffect(r, 'missing record');
  assert.match(r.stderr, /live-path-not-wired/);
});

test('CLI: every partial / malformed interlock refuses before anything else', () => {
  const cases = [
    [[], {}, 'missing:flag,env,record'],
    [['--execute-live-g2'], {}, 'missing:env,record'],
    [['--execute-live-g2'], { G2_LIVE_AUTHORIZED: 'YES' }, 'missing:record'],
    [['--execute-live-g2', '--authorization-record', 'docs/prompts/a.md'], { G2_LIVE_AUTHORIZED: 'yes' }, 'missing:env'],
    [['--authorization-record', 'docs/prompts/a.md'], { G2_LIVE_AUTHORIZED: 'YES' }, 'missing:flag'],
    [['--execute-live-g2', '--authorization-record'], { G2_LIVE_AUTHORIZED: 'YES' }, 'record-value-missing'],
    [['--execute-live-g2', '--authorization-record', 'docs/prompts/a.md', '--authorization-record', 'docs/prompts/b.md'], { G2_LIVE_AUTHORIZED: 'YES' }, 'record-flag-duplicate'],
  ];
  for (const [args, env, reason] of cases) {
    const r = runCli(args, env);
    assertNoEffect(r, reason);
    assert.ok(r.stderr.includes(`(${reason})`), `${reason}: ${r.stderr}`);
  }
});

test('CLI observer negative controls: the fs observer and the resolve denial really fire', () => {
  // The harness's own entry guard realpath is observed (the observer is live, not vacuous).
  const r = runCli([], {});
  assert.ok(r.fsCalls.some(([n]) => n === 'realpathSync'), JSON.stringify(r.fsCalls));
  // A script that reads a file and tries to import the browser package is caught by both.
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'g2-cli-neg-'));
  const code = `import fs from 'node:fs'; fs.readdirSync('.'); try { await import('${PKG}'); } catch {}`;
  const c = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(HOOK_DIR, 'observe.mjs')).href, '--input-type=module', '-e', code], { cwd, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 60_000 });
  rmSync(cwd, { recursive: true, force: true });
  assert.ok(c.stderr.includes(MARK_RESOLVE), c.stderr);
  const line = c.stderr.split('\n').find((l) => l.startsWith(MARK_FS));
  assert.ok(JSON.parse(line.slice(MARK_FS.length)).some(([n]) => n === 'readdirSync'));
});
