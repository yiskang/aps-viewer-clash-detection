// test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs
//
// LIVE_PATH_WIRED pinning + live-path isolation for the offline G2 suites (live execution plan
// docs/research/2026-10-02-g2-live-execution-plan.md §9 step 2, gap G-15).
//
//  1. THE SINGLE PIN of the real harness's current LIVE_PATH_WIRED value. Every other suite forces the
//     value it needs in an isolated copy (support/g2-harness-copy.mjs) and never pins the real one.
//  2. The shared helper: tolerant of `= false;` / `= true;`, loud on an absent / duplicated / shadowed /
//     reassigned / non-canonical declaration; copies resolve REPO_ROOT to their own isolated temp root.
//  3. Static guards over the acceptance test sources: no literal-line flag replacement, no pin of the
//     real value outside (1), no main() on the real module, no spawn of the real harness, every W1/attempts
//     entry point given an explicit root, no join of a real-repo root with docs/prompts.
//  4. Activation behaviour (W0 interlock, W1 rejections) exercised IN-PROCESS on a copy FORCED true in an
//     isolated temp root -- with a confining fs layer -- creating nothing anywhere and touching nothing in
//     the real repository; a coincidental authorization-named file elsewhere is never consumed.
//
// Offline only: never launches a browser, never imports the browser package, never reads or writes the
// real docs/prompts authorization location or the real attempts / evidence directories.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as REAL from './clashpanel-viewerbridge.acceptance.mjs';
import {
  livePathWiredDeclaration, forceLivePathWired, LivePathWiredDeclarationError, readRealHarnessSource, importHarnessCopy,
  importDormantHarness, writeHarnessCopy, createIsolatedRoot, writeRootFile, isInsideRealRepo, REAL_HARNESS_FILE, REAL_REPO_ROOT,
} from './support/g2-harness-copy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const REAL_SOURCE = readRealHarnessSource();
const RECORD_REL = 'docs/prompts/g2-live-authorization.md';
const FLAG = '--execute-live-g2';
const AUTHORIZED_ARGV = ['node', 'h.mjs', FLAG, '--authorization-record', RECORD_REL];
const AUTHORIZED_ENV = { G2_LIVE_AUTHORIZED: 'YES' };
// Built by concatenation so this file never contains the literal-line pattern its own static guard forbids.
const DECL = (v) => `${'const LIVE'}_PATH_WIRED = ${v};`;

// =========================================================================================================
// 1. THE SINGLE PIN
// =========================================================================================================

// PIN (single, deliberate). This is the ONLY test in the offline suites that asserts the REAL harness's
// current LIVE_PATH_WIRED value. The future activation flip (plan §9 step 1-2) is a deliberate, bounded change:
// flip `const LIVE_PATH_WIRED = false;` in the harness and change THIS pin to `true` in the same, separately
// authorized and independently reviewed change. No other suite should need editing for the flip.
test('PIN (single, deliberate): the real harness currently declares LIVE_PATH_WIRED = true (activated)', () => {
  assert.equal(livePathWiredDeclaration(REAL_SOURCE).value, true);
  assert.equal(REAL.LIVE_PATH_WIRED, true);
});

// =========================================================================================================
// 2. The helper
// =========================================================================================================

test('helper: forceLivePathWired tolerates either current value and changes exactly that one line', () => {
  for (const from of [false, true]) {
    const src = forceLivePathWired(REAL_SOURCE, from);
    assert.equal(livePathWiredDeclaration(src).value, from);
    for (const to of [false, true]) {
      const out = forceLivePathWired(src, to);
      assert.equal(livePathWiredDeclaration(out).value, to);
      const a = src.split('\n');
      const b = out.split('\n');
      assert.equal(a.length, b.length);
      const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
      assert.deepEqual(diff.map((i) => b[i]), from === to ? [] : [DECL(to)]);
    }
  }
});

test('helper: fails LOUDLY (never silently) on an absent, duplicated, shadowed, reassigned or non-canonical declaration', () => {
  const canonical = livePathWiredDeclaration(REAL_SOURCE).line; // whatever the real file currently declares
  const cases = {
    absent: REAL_SOURCE.replace(canonical, '// (declaration removed)'),
    duplicated: REAL_SOURCE.replace(canonical, `${canonical}\n${DECL(true)}`),
    'non-canonical spacing': REAL_SOURCE.replace(canonical, `${'const LIVE'}_PATH_WIRED=false;`),
    'non-canonical value': REAL_SOURCE.replace(canonical, `${'const LIVE'}_PATH_WIRED = 0;`),
    'let instead of const': REAL_SOURCE.replace(canonical, `${'let LIVE'}_PATH_WIRED = false;`),
    'shadowing declaration': `${REAL_SOURCE}\nfunction shadow() { ${'const LIVE'}_PATH_WIRED = true; return LIVE_PATH_WIRED; }\n`,
    reassignment: `${REAL_SOURCE}\n${'LIVE'}_PATH_WIRED = true;\n`,
  };
  assert.notEqual(cases.absent, REAL_SOURCE);
  for (const [label, src] of Object.entries(cases)) {
    assert.throws(() => livePathWiredDeclaration(src), LivePathWiredDeclarationError, label);
    for (const v of [false, true]) assert.throws(() => forceLivePathWired(src, v), LivePathWiredDeclarationError, `${label} -> ${v}`);
  }
  for (const bad of [undefined, null, 1, 'true', 'false']) assert.throws(() => forceLivePathWired(REAL_SOURCE, bad), TypeError, String(bad));
  assert.throws(() => livePathWiredDeclaration(''), LivePathWiredDeclarationError);
  assert.throws(() => writeHarnessCopy({}), /livePathWired must be given explicitly/);
  assert.throws(() => writeHarnessCopy({ livePathWired: false, transform: (t) => forceLivePathWired(t, true) }), /transform changed the forced value/);
  // comparisons and comments mentioning the name are not declarations
  assert.equal(livePathWiredDeclaration(`${forceLivePathWired(REAL_SOURCE, false)}\n// LIVE_PATH_WIRED = true in a comment\nif (LIVE_PATH_WIRED === true) {}\n`).value, false);
});

test('helper: copies live at <isolated root>/test/acceptance/<harness>, resolve REPO_ROOT to that root, outside the real repository', async () => {
  for (const v of [false, true]) {
    const c = await importHarnessCopy({ livePathWired: v });
    assert.equal(c.module.LIVE_PATH_WIRED, v);
    assert.equal(c.module.REPO_ROOT, realpathSync(c.root));
    assert.notEqual(c.module.REPO_ROOT, REAL.REPO_ROOT);
    assert.equal(isInsideRealRepo(c.file), false);
    assert.equal(c.text, forceLivePathWired(REAL_SOURCE, v));
    assert.notEqual(realpathSync(c.file), realpathSync(REAL_HARNESS_FILE));
  }
  assert.equal(isInsideRealRepo(REAL_HARNESS_FILE), true, 'the containment check is non-vacuous');
  assert.throws(() => writeRootFile(REAL_REPO_ROOT, RECORD_REL, 'x'), /inside the real repository/);
  const root = createIsolatedRoot();
  assert.throws(() => writeRootFile(root, '../escape.md', 'x'), /escapes/);
});

// =========================================================================================================
// 3. Static guards over the acceptance test sources
// =========================================================================================================

const TEST_FILES = readdirSync(HERE).filter((n) => /^clashpanel-viewerbridge\.acceptance\..+\.test\.mjs$/.test(n)).sort();
const SUPPORT_FILES = readdirSync(path.join(HERE, 'support')).filter((n) => n.endsWith('.mjs')).map((n) => `support/${n}`);
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const REAL_IMPORT = "from './clashpanel-viewerbridge.acceptance.mjs'";

/** Namespace aliases and named imports bound to the REAL harness module in `src`. */
function realBindings(src) {
  const ns = [...src.matchAll(/import \* as (\w+) from '\.\/clashpanel-viewerbridge\.acceptance\.mjs'/g)].map((m) => m[1]);
  const named = new Set();
  for (const m of src.matchAll(/import \{([^}]*)\} from '\.\/clashpanel-viewerbridge\.acceptance\.mjs'/g)) {
    for (const part of m[1].split(',')) { const [orig, alias] = part.trim().split(/\s+as\s+/); if (orig) named.add({ orig, local: alias || orig }); }
  }
  return { ns, named: [...named] };
}

/** Text of every call `name(` ... `)` (paren-balanced; good enough for these sources). */
function callTexts(src, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w.'"\\x60])${name.replace('.', '\\.')}\\(`, 'g'); // not inside a string token like 'name('
  for (const m of src.matchAll(re)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

function staticViolations(files) {
  const v = [];
  for (const [rel, src] of files) {
    const { ns, named } = realBindings(src);
    // (a) no literal-line replacement of the declaration (breaks at load once the flag flips)
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // comments may mention the literal
    if (/['"`]const LIVE_PATH_WIRED = (true|false);/.test(code) || /\/\^?(\\n)?const LIVE_PATH_WIRED = (true|false);/.test(code)) v.push(`${rel}: literal LIVE_PATH_WIRED line (use support/g2-harness-copy.mjs)`);
    // (b) no pin of the real module's value (the single pin lives in this file)
    for (const n of ns) if (new RegExp(`assert\\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\\(\\s*${n}\\.LIVE_PATH_WIRED\\s*,\\s*(?:true|false)\\s*\\)`).test(src)) v.push(`${rel}: pins ${n}.LIVE_PATH_WIRED of the real module`);
    for (const { local } of named.filter((x) => x.orig === 'LIVE_PATH_WIRED')) if (new RegExp(`assert\\.(?:equal|strictEqual|deepEqual|deepStrictEqual)\\(\\s*${local}\\s*,\\s*(?:true|false)\\s*\\)`).test(src)) v.push(`${rel}: pins the real LIVE_PATH_WIRED`);
    // (c) main() is never run on the real module (only on isolated copies)
    for (const n of ns) if (new RegExp(`\\b${n}\\.main\\(`).test(src)) v.push(`${rel}: calls ${n}.main() on the real module`);
    if (named.some((x) => x.orig === 'main' || x.orig === 'runCli')) v.push(`${rel}: imports main/runCli from the real module`);
    // (d) no spawn of the real harness (in any file that also mentions the live env var)
    if (/G2_LIVE_AUTHORIZED/.test(src)) {
      for (const fn of ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']) {
        for (const call of callTexts(src, fn)) {
          if (/REAL_HARNESS_FILE|\bHARNESS_FILE\b|clashpanel-viewerbridge\.acceptance\.mjs|process\.argv/.test(call)) v.push(`${rel}: ${fn}(...) may target the real harness: ${call.slice(0, 120)}`);
        }
      }
      if (/new URL\('\.\/clashpanel-viewerbridge\.acceptance\.mjs', import\.meta\.url\)/.test(src) && /\b(spawnSync|spawn|execFile|execFileSync|fork)\(/.test(src)) v.push(`${rel}: derives the real harness path in a file that spawns with G2_LIVE_AUTHORIZED`);
    }
    // (e) W1 / attempts entry points always get an explicit root (never the real REPO_ROOT default)
    for (const call of callTexts(src, 'validateAuthorizationRecord')) if (!/repoRoot/.test(call) && /\{/.test(call)) v.push(`${rel}: validateAuthorizationRecord without repoRoot`);
    for (const call of callTexts(src, 'resolveAttemptsChain')) if (/\(\s*\)$/.test(call)) v.push(`${rel}: resolveAttemptsChain() on the default (real) root`);
    for (const call of callTexts(src, 'enumeratePromptMarkdownFiles')) if (!/repoRoot/.test(call)) v.push(`${rel}: enumeratePromptMarkdownFiles without repoRoot`);
    // (f) never join a real-repo root with docs/prompts (the real authorization location)
    for (const line of src.split('\n')) if (/(REPO_ROOT|\bREPO\b|'\.\.', '\.\.')/.test(line) && /prompts/.test(line) && !/^\s*\/\//.test(line)) v.push(`${rel}: real-root docs/prompts reference: ${line.trim().slice(0, 120)}`);
  }
  return v;
}

test('static guard: no acceptance test pins the real flag, replaces the literal line, runs real main(), spawns the real harness or reaches the real docs/prompts / attempts root', () => {
  assert.ok(TEST_FILES.length >= 40, `discovery is non-vacuous (${TEST_FILES.length} files)`);
  assert.ok(TEST_FILES.includes('clashpanel-viewerbridge.acceptance.cli.test.mjs'));
  const files = [...TEST_FILES.filter((n) => n !== SELF), ...SUPPORT_FILES].map((rel) => [rel, read(rel)]);
  assert.deepEqual(staticViolations(files), []);
  // every suite that spawns a child process with the live env var goes through the isolated-copy helper
  for (const [rel, src] of files) {
    if (/G2_LIVE_AUTHORIZED/.test(src) && /\b(spawnSync|spawn|execFile|execFileSync|fork)\(/.test(src)) assert.match(src, /support\/g2-harness-copy\.mjs/, `${rel} spawns with G2_LIVE_AUTHORIZED without the isolated-copy helper`);
  }
});

test('static guard is non-vacuous: each rule fires on a planted violation', () => {
  const imp = `import * as H ${REAL_IMPORT};\n`;
  const planted = {
    a: `${imp}const s = src.replace('${DECL(false)}', 'x');`,
    b: `${imp}assert.equal(H.LIVE_PATH${'_'}WIRED, false);`,
    bn: `import { LIVE_PATH_WIRED } ${REAL_IMPORT};\nassert.equal(LIVE_PATH${'_'}WIRED, false);`,
    c: `${imp}await H.main({ argv });`,
    cn: `import { main } ${REAL_IMPORT};\n`,
    d: `const HARNESS_FILE = 'x';\nspawnSync(process.execPath, [HARNESS_FILE], { env: { G2_LIVE_AUTHORIZED: 'YES' } });`,
    e: 'validateAuthorizationRecord({ recordPath: P, fs });',
    e2: 'const chain = resolveAttemptsChain();',
    f: "const p = path.join(REPO_ROOT, 'docs', 'prompts', 'x.md');",
  };
  for (const [k, src] of Object.entries(planted)) assert.ok(staticViolations([[k, src]]).length > 0, `rule ${k} did not fire`);
  assert.deepEqual(staticViolations([['clean', `${imp}assert.equal(window.__t.LIVE_PATH_WIRED, H.LIVE_PATH_WIRED);`]]), []);
});

// =========================================================================================================
// 4. Activation behaviour on a copy FORCED true, in an isolated temp root (in-process)
// =========================================================================================================

/** Every file/dir under `root` (relative) with content digests -- the "nothing created / changed" snapshot. */
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

/** The copy's real node fs layer, wrapped so ANY path outside `root` (or inside the real repo) throws before the call. */
function confinedFs(M, root) {
  const inner = M.createNodeFsLayer();
  const rp = realpathSync(root);
  const calls = [];
  const fs = new Proxy(inner, {
    get(t, k) {
      const f = t[k];
      if (typeof f !== 'function') return f;
      return (...args) => {
        for (const a of args) {
          if (typeof a !== 'string' || !path.isAbsolute(a)) continue;
          const rel = path.relative(rp, path.resolve(a));
          if (rel.startsWith('..') || path.isAbsolute(rel) || isInsideRealRepo(a)) throw new Error(`confinedFs: ${String(k)}(${a}) escapes the isolated root`);
        }
        calls.push([String(k), ...args.filter((a) => typeof a === 'string')]);
        return f.apply(t, args);
      };
    },
  });
  return { fs, calls };
}

function trapFs() {
  const calls = [];
  return { calls, fs: new Proxy({}, { get: (_t, k) => (...a) => { calls.push([String(k), ...a]); throw new Error(`fs.${String(k)} must not be called`); } }) };
}

/** A format-valid record fixture (never valid for any real repository). */
function recordFixture(M, id = 'g2-isolation-fixture-01') {
  return ['# OFFLINE TEST FIXTURE (isolated temp root only)', '', M.MARKER_LIVE_LINE, `Authorization-ID: ${id}`,
    `Baseline-HEAD: ${'0'.repeat(40)}`, `Procedure-SHA256: ${'1'.repeat(64)}`, `Harness-SHA256: ${'2'.repeat(64)}`,
    `Model-A-URN-SHA256: ${'3'.repeat(64)}`, `Model-B-URN-SHA256: ${'4'.repeat(64)}`, M.RUNTIME_LINE, ''].join('\n');
}

const refused = (M, reason) => (e) => e instanceof M.G2RefusalError && e.reason === reason;

test('activated copy (forced true): W0 refuses every partial interlock before any fs/git/browser access', async () => {
  const { module: M } = await importHarnessCopy({ livePathWired: true });
  const cases = [
    [['node', 'h'], {}, 'missing:flag,env,record'],
    [['node', 'h', FLAG], AUTHORIZED_ENV, 'missing:record'],
    [['node', 'h', FLAG, '--authorization-record', RECORD_REL], { G2_LIVE_AUTHORIZED: 'yes' }, 'missing:env'],
    [['node', 'h', '--authorization-record', RECORD_REL], AUTHORIZED_ENV, 'missing:flag'],
    [['node', 'h', FLAG, '--authorization-record'], AUTHORIZED_ENV, 'record-value-missing'],
    [['node', 'h', FLAG, '--authorization-record', RECORD_REL, '--authorization-record', RECORD_REL], AUTHORIZED_ENV, 'record-flag-duplicate'],
  ];
  for (const [argv, env, reason] of cases) {
    const { calls, fs } = trapFs();
    let git = 0;
    await assert.rejects(M.main({ argv, env, deps: { fs, gitHead: () => { git += 1; return ''; }, browserPackage: new Proxy({}, { get: () => { throw new Error('browser'); } }) } }), refused(M, reason), reason);
    assert.deepEqual(calls, [], reason);
    assert.equal(git, 0, reason);
  }
});

test('activated copy (forced true): an authorized interlock reaches W1 against the ISOLATED root only and is rejected; nothing is created', async () => {
  const scenarios = [
    { label: 'no record', files: {}, reason: 'record-not-found' },
    { label: 'malformed record', files: { [RECORD_REL]: '# x\nG2-LIVE-EXECUTION: maybe\n' }, reason: /^record-marker-(malformed|missing):/ },
    { label: 'record outside docs/prompts', files: {}, reason: 'record-path-outside-prompts', argv: ['node', 'h', FLAG, '--authorization-record', 'docs/other/x.md'] },
    { label: 'duplicate Authorization-ID', files: (M) => ({ [RECORD_REL]: recordFixture(M), 'docs/prompts/g2-other.md': recordFixture(M) }), reason: 'candidate-duplicate-authorization-id' },
    { label: 'baseline HEAD mismatch', files: (M) => ({ [RECORD_REL]: recordFixture(M) }), reason: 'baseline-head-mismatch', gitHead: () => 'f'.repeat(40) },
    { label: 'HEAD unavailable', files: (M) => ({ [RECORD_REL]: recordFixture(M) }), reason: 'git-head-unavailable', gitHead: () => { throw new Error('no git here'); } },
  ];
  const { module: probe } = await importDormantHarness();
  for (const s of scenarios) {
    const files = typeof s.files === 'function' ? s.files(probe) : s.files;
    const { root, module: M } = await importHarnessCopy({ livePathWired: true, files });
    assert.equal(M.REPO_ROOT, realpathSync(root));
    const before = tree(root);
    const { fs, calls } = confinedFs(M, root);
    let git = 0;
    const gitHead = s.gitHead ? () => { git += 1; return s.gitHead(); } : () => { git += 1; throw new Error('git must not be reached'); };
    await assert.rejects(
      M.main({ argv: s.argv ?? AUTHORIZED_ARGV, env: AUTHORIZED_ENV, deps: { fs, gitHead, browserPackage: new Proxy({}, { get: () => { throw new Error('browser'); } }) } }),
      (e) => e instanceof M.G2RefusalError && (s.reason instanceof RegExp ? s.reason.test(e.reason) : e.reason === s.reason),
      s.label,
    );
    assert.deepEqual(tree(root), before, `${s.label}: isolated root unchanged (no attempts dir, no journal, no evidence)`);
    assert.equal(calls.some(([k]) => /^(mkdir|open|write|rename|link|unlink|fsync)/.test(k)), false, `${s.label}: read-only W1 (${JSON.stringify(calls)})`);
    if (s.reason !== 'record-path-outside-prompts') assert.ok(calls.length > 0, `${s.label}: W1 really ran on the isolated root`);
    if (!s.gitHead) assert.equal(git, 0, s.label);
  }
});

test('activated copy with NO deps at all (default fs layer + its own REPO_ROOT): W1 rejects inside the isolated root; nothing created', async () => {
  const { root, module: M } = await importHarnessCopy({ livePathWired: true });
  const before = tree(root);
  await assert.rejects(M.main({ argv: AUTHORIZED_ARGV, env: AUTHORIZED_ENV }), refused(M, 'record-not-found'));
  assert.deepEqual(tree(root), before);
});

test('a coincidental authorization-named file in ANOTHER tree (stand-in for the real docs/prompts) is never consumed: resolution is bound to the copy\'s own root', async () => {
  const { module: probe } = await importDormantHarness();
  // Decoy tree playing the role of "a repo that happens to contain docs/prompts/g2-live-authorization.md".
  const decoy = createIsolatedRoot('g2-decoy-repo-');
  writeRootFile(decoy, RECORD_REL, recordFixture(probe));
  const decoyBefore = tree(decoy);
  // The activated copy lives in its own root WITHOUT that file: W1 never sees the decoy.
  const { root, module: M } = await importHarnessCopy({ livePathWired: true });
  const { fs, calls } = confinedFs(M, root);
  await assert.rejects(M.main({ argv: AUTHORIZED_ARGV, env: AUTHORIZED_ENV, deps: { fs, gitHead: () => { throw new Error('git must not be reached'); } } }), refused(M, 'record-not-found'));
  assert.equal(calls.some((c) => c.some((a) => typeof a === 'string' && a.startsWith(decoy))), false, 'the decoy tree was never touched');
  assert.deepEqual(tree(decoy), decoyBefore);
  // Positive control: the SAME fixture placed in the copy's own root IS consumed (W1 proceeds to the HEAD step).
  writeRootFile(root, RECORD_REL, recordFixture(probe));
  await assert.rejects(M.main({ argv: AUTHORIZED_ARGV, env: AUTHORIZED_ENV, deps: { fs, gitHead: () => { throw new Error('no git in a temp root'); } } }), refused(M, 'git-head-unavailable'));
  // And a dormant copy never looks at all, even with the fixture present in its own root.
  const d = await importHarnessCopy({ livePathWired: false, files: { [RECORD_REL]: recordFixture(probe) } });
  const t = trapFs();
  await assert.rejects(d.module.main({ argv: AUTHORIZED_ARGV, env: AUTHORIZED_ENV, deps: { fs: t.fs } }), refused(d.module, 'live-path-not-wired'));
  assert.deepEqual(t.calls, []);
});

test('the confining fs layer is non-vacuous: a path outside the isolated root throws before the call', async () => {
  const { root, module: M } = await importHarnessCopy({ livePathWired: true });
  const { fs } = confinedFs(M, root);
  assert.throws(() => fs.lstat(path.join(REAL_REPO_ROOT, 'docs')), /escapes the isolated root/);
  assert.throws(() => fs.lstat(path.dirname(root)), /escapes the isolated root/);
  assert.ok(fs.lstat(path.join(root, 'test')).isDirectory());
});
