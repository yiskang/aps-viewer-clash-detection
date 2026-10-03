// test/acceptance/clashpanel-viewerbridge.acceptance.cli.test.mjs
//
// Offline CLI tests for the G2 harness entry point (procedure §4.1 "Interlock", §8 exit codes).
//
// ISOLATION (live execution plan §9 step 2, gap G-15): this file NEVER spawns the real harness file.
// Every spawned harness is a COPY written by support/g2-harness-copy.mjs to
// `<isolated os.tmpdir() root>/test/acceptance/<harness>`, with LIVE_PATH_WIRED FORCED to an explicit
// value. The copy's own REPO_ROOT (derived from its location) is therefore the isolated root, so its W1
// record lookup, docs/prompts candidate enumeration and attempts chain can only ever see that root;
// authorization-shaped fixtures exist ONLY inside it. `runCli` refuses (loudly) any harness path that is
// the real harness or lies inside the real repository.
//
// Each child runs from an EMPTY os.tmpdir() cwd with a clean environment, preloading (via `--import`) a
// small observer that (a) makes any attempt to RESOLVE the browser package fail loudly and (b) records
// every public node:fs call made after the harness module starts loading.
//   * DORMANT copy (forced false): every invocation -- including the fully authorized flag + env + record
//     combination -- exits 1 (live-path-not-wired) with no fs access beyond the entry guard's realpath.
//   * ACTIVATED copy (forced true): W0 still refuses every partial interlock with no fs access; a fully
//     authorized interlock reaches W1 against the ISOLATED root only and is rejected there (missing /
//     malformed / duplicate-ID / unverifiable-HEAD records), creating nothing (no attempts dir, no
//     evidence) and touching no path outside the isolated root.
// Nothing here imports the browser package.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync, rmSync, realpathSync, lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  writeHarnessCopy, importDormantHarness, livePathWiredDeclaration, writeRootFile, isInsideRealRepo, REAL_HARNESS_FILE, HARNESS_REL,
} from './support/g2-harness-copy.mjs';

const PKG = ['play', 'wright'].join('');
const MARK_RESOLVE = 'G2-CLI-TEST: browser package resolution attempted';
const MARK_FS = 'G2-CLI-TEST-FS:';
const RECORD_REL = 'docs/prompts/g2-live-authorization.md';
const AUTHORIZED_ARGS = ['--execute-live-g2', '--authorization-record', RECORD_REL];
const AUTHORIZED_ENV = { G2_LIVE_AUTHORIZED: 'YES' };

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

// ---- isolated harness copies -----------------------------------------------------------------------

/** One isolated root per activated copy; the dormant copy is shared (it never reaches W1). Importing a copy in-process
 *  is side-effect free (its entry guard only runs main() when it is the process entry script). */
const DORMANT = await importDormantHarness();
function activatedCopy(files = {}) {
  return writeHarnessCopy({ livePathWired: true, prefix: 'g2-cli-activated-', files });
}

/** Every file/dir under `root` (relative), sorted -- the "nothing created / changed" snapshot. */
function tree(root) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path.join(root, r));
      if (st.isDirectory()) { out.push(`${r}/`); walk(r); } else out.push(`${r}:${createHash('sha256').update(readFileSync(path.join(root, r))).digest('hex')}`);
    }
  };
  walk('');
  return out;
}

function runCli(copy, args, extraEnv = {}) {
  // Loud refusal: the spawned file must be an isolated copy, never the real harness, never inside the real repository.
  const target = realpathSync(copy.file);
  assert.notEqual(target, realpathSync(REAL_HARNESS_FILE), 'runCli must never spawn the real harness');
  assert.equal(isInsideRealRepo(target), false, `runCli target ${target} must lie outside the real repository`);
  assert.equal(target, path.join(realpathSync(copy.root), HARNESS_REL), 'the copy sits at <root>/test/acceptance/<harness> so REPO_ROOT = <root>');
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'g2-cli-cwd-'));
  const treeBefore = tree(copy.root);
  // A clean environment: in particular NO NODE_TEST_CONTEXT (the entry guard would skip main()). git is kept from
  // discovering any repository above the isolated root (only reachable on an activated copy, after a well-formed record).
  const env = { PATH: process.env.PATH, HOME: cwd, GIT_CEILING_DIRECTORIES: path.dirname(realpathSync(copy.root)), ...extraEnv };
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(HOOK_DIR, 'observe.mjs')).href, target, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  const cwdAfter = readdirSync(cwd);
  rmSync(cwd, { recursive: true, force: true });
  const fsLine = (r.stderr || '').split('\n').find((l) => l.startsWith(MARK_FS));
  const fsCalls = fsLine ? JSON.parse(fsLine.slice(MARK_FS.length)) : null;
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, cwdAfter, treeBefore, treeAfter: tree(copy.root), fsCalls, target };
}

function isEntryRealpath(r, [n, p]) {
  return n === 'realpathSync' && (p === r.target || p === pathToFileURL(r.target).href);
}

/** Exit 1, no browser package, nothing created anywhere, the isolated root unchanged. */
function assertRefusedCleanly(r, label) {
  assert.equal(r.signal, null, `${label}: no signal/timeout`);
  assert.equal(r.status, 1, `${label}: exit 1 (stderr: ${r.stderr})`);
  assert.equal(r.stderr.includes(MARK_RESOLVE), false, `${label}: never resolved the browser package`);
  assert.deepEqual(r.cwdAfter, [], `${label}: nothing created in the cwd`);
  assert.deepEqual(r.treeAfter, r.treeBefore, `${label}: isolated root unchanged (no attempts dir, no evidence, no record change)`);
  assert.ok(Array.isArray(r.fsCalls), `${label}: fs observer report present`);
}

/** As assertRefusedCleanly, plus: no fs access at all beyond the entry guard's realpath of the copy. */
function assertNoEffect(r, label) {
  assertRefusedCleanly(r, label);
  assert.deepEqual(r.fsCalls.filter((c) => !isEntryRealpath(r, c)), [], `${label}: no fs access beyond the entry guard's realpath of the copy`);
}

/** Every observed fs path lies inside the isolated root; none in the real repository. */
function assertFsConfinedToRoot(r, root, label) {
  const rp = realpathSync(root);
  for (const [n, p] of r.fsCalls) {
    if (isEntryRealpath(r, [n, p])) continue;
    // fd-based calls (closeSync/fsyncSync/writeSync on a number) act on descriptors opened by an already-checked path call.
    if (p === 'number') continue;
    assert.equal(typeof p, 'string', `${label}: ${n} with a non-path first argument`);
    const abs = p.startsWith('file:') ? new URL(p).pathname : path.resolve(p);
    const rel = path.relative(rp, abs);
    assert.ok(rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)), `${label}: ${n}(${p}) escapes the isolated root ${rp}`);
    assert.equal(isInsideRealRepo(abs), false, `${label}: ${n}(${p}) touches the real repository`);
  }
}

/** A well-formed (format-valid) record fixture built from the copy's own constants; never valid for the real repository. */
function recordFixture({ id = 'g2-cli-fixture-0001' } = {}) {
  const M = DORMANT.module;
  return [
    '# G2 live execution authorization (OFFLINE TEST FIXTURE -- isolated temp root only)', '',
    M.MARKER_LIVE_LINE,
    `Authorization-ID: ${id}`,
    `Baseline-HEAD: ${'0'.repeat(40)}`,
    `Procedure-SHA256: ${'1'.repeat(64)}`,
    `Harness-SHA256: ${'2'.repeat(64)}`,
    `Model-A-URN-SHA256: ${'3'.repeat(64)}`,
    `Model-B-URN-SHA256: ${'4'.repeat(64)}`,
    M.RUNTIME_LINE, '',
  ].join('\n');
}

// ---- DORMANT copy: every invocation refuses with no effect -------------------------------------------

test('CLI (dormant copy, LIVE_PATH_WIRED forced false): the spawned copy really is dormant and isolated', () => {
  assert.equal(livePathWiredDeclaration(DORMANT.text).value, false);
  assert.equal(isInsideRealRepo(DORMANT.root), false);
});

test('CLI (dormant copy): fully authorized interlock (flag + G2_LIVE_AUTHORIZED=YES + record) still refuses (live-path-not-wired) with no effect', () => {
  const r = runCli(DORMANT, AUTHORIZED_ARGS, AUTHORIZED_ENV);
  assertNoEffect(r, 'authorized');
  assert.match(r.stderr, /live-path-not-wired/);
});

test('CLI (dormant copy): a record path that does not exist is not even looked at (the wiring gate precedes W1)', () => {
  const r = runCli(DORMANT, ['--execute-live-g2', '--authorization-record', 'docs/prompts/does-not-exist-anywhere.md'], AUTHORIZED_ENV);
  assertNoEffect(r, 'missing record');
  assert.match(r.stderr, /live-path-not-wired/);
});

const PARTIAL_CASES = [
  [[], {}, 'missing:flag,env,record'],
  [['--execute-live-g2'], {}, 'missing:env,record'],
  [['--execute-live-g2'], { G2_LIVE_AUTHORIZED: 'YES' }, 'missing:record'],
  [['--execute-live-g2', '--authorization-record', 'docs/prompts/a.md'], { G2_LIVE_AUTHORIZED: 'yes' }, 'missing:env'],
  [['--authorization-record', 'docs/prompts/a.md'], { G2_LIVE_AUTHORIZED: 'YES' }, 'missing:flag'],
  [['--execute-live-g2', '--authorization-record'], { G2_LIVE_AUTHORIZED: 'YES' }, 'record-value-missing'],
  [['--execute-live-g2', '--authorization-record', 'docs/prompts/a.md', '--authorization-record', 'docs/prompts/b.md'], { G2_LIVE_AUTHORIZED: 'YES' }, 'record-flag-duplicate'],
];

test('CLI (dormant copy): every partial / malformed interlock refuses before anything else', () => {
  for (const [args, env, reason] of PARTIAL_CASES) {
    const r = runCli(DORMANT, args, env);
    assertNoEffect(r, reason);
    assert.ok(r.stderr.includes(`(${reason})`), `${reason}: ${r.stderr}`);
  }
});

// ---- ACTIVATED copy (LIVE_PATH_WIRED forced true) in an isolated root ---------------------------------

test('CLI (activated copy, LIVE_PATH_WIRED forced true): W0 still refuses every partial / malformed interlock with no fs access', () => {
  const copy = activatedCopy();
  assert.equal(livePathWiredDeclaration(copy.text).value, true);
  for (const [args, env, reason] of PARTIAL_CASES) {
    const r = runCli(copy, args, env);
    assertNoEffect(r, `activated ${reason}`);
    assert.ok(r.stderr.includes(`(${reason})`), `${reason}: ${r.stderr}`);
  }
});

test('CLI (activated copy): fully authorized interlock with NO record in the isolated root => W1 record-not-found; nothing created; fs confined to the isolated root', () => {
  const copy = activatedCopy();
  const r = runCli(copy, AUTHORIZED_ARGS, AUTHORIZED_ENV);
  assertRefusedCleanly(r, 'no record');
  assert.match(r.stderr, /\(record-not-found\)/);
  assertFsConfinedToRoot(r, copy.root, 'no record');
  assert.ok(r.fsCalls.some(([n, p]) => n === 'lstatSync' && p === path.join(copy.root, 'docs')), 'W1 really looked (inside the isolated root)');
});

test('CLI (activated copy): a malformed record fixture in the isolated root => W1 rejects (record-marker-*); nothing created', () => {
  const copy = activatedCopy({ [RECORD_REL]: '# not an authorization\nG2-LIVE-EXECUTION: maybe\n' });
  const r = runCli(copy, AUTHORIZED_ARGS, AUTHORIZED_ENV);
  assertRefusedCleanly(r, 'malformed');
  assert.match(r.stderr, /\(record-marker-(malformed|missing):[^)]+\)/);
  assertFsConfinedToRoot(r, copy.root, 'malformed');
});

test('CLI (activated copy): two well-formed fixtures with one Authorization-ID => W1 candidate-duplicate-authorization-id; nothing created', () => {
  const copy = activatedCopy({ [RECORD_REL]: recordFixture(), 'docs/prompts/g2-other-fixture.md': recordFixture() });
  const r = runCli(copy, AUTHORIZED_ARGS, AUTHORIZED_ENV);
  assertRefusedCleanly(r, 'duplicate id');
  assert.match(r.stderr, /\(candidate-duplicate-authorization-id\)/);
  assertFsConfinedToRoot(r, copy.root, 'duplicate id');
});

test('CLI (activated copy): a single well-formed fixture is still rejected at W1 (git-head-unavailable: the isolated root is no repository); no attempts dir, no reservation', () => {
  const copy = activatedCopy({ [RECORD_REL]: recordFixture() });
  const r = runCli(copy, AUTHORIZED_ARGS, AUTHORIZED_ENV);
  assertRefusedCleanly(r, 'well-formed');
  assert.match(r.stderr, /\(git-head-unavailable\)/);
  assertFsConfinedToRoot(r, copy.root, 'well-formed');
  assert.equal(r.treeAfter.some((e) => e.startsWith('test/acceptance/results')), false, 'no attempts chain was created');
});

// ---- observer non-vacuity -------------------------------------------------------------------------------

test('CLI observer negative controls: the fs observer and the resolve denial really fire', () => {
  // The copy's own entry guard realpath is observed (the observer is live, not vacuous).
  const r = runCli(DORMANT, [], {});
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

test('CLI isolation guard is non-vacuous: runCli refuses the real harness and any path inside the real repository', () => {
  assert.throws(() => runCli({ file: REAL_HARNESS_FILE, root: path.resolve(path.dirname(REAL_HARNESS_FILE), '..', '..') }, AUTHORIZED_ARGS, AUTHORIZED_ENV), /never spawn the real harness/);
  // writeRootFile refuses to place fixtures anywhere inside the real repository.
  assert.throws(() => writeRootFile(path.resolve(path.dirname(REAL_HARNESS_FILE), '..', '..'), RECORD_REL, 'x'), /inside the real repository/);
});
