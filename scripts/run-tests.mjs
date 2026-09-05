// scripts/run-tests.mjs
//
// Portable, Node-version-independent replacement for a shell-glob-based `node --test` invocation.
// Batch-5 final review finding I-1 fixed the root problem (a bare `node --test` sweeping in every
// .js/.mjs file under any directory literally named `test`, including live-browser/live-server
// scripts like run-gate.mjs and room-locator.acceptance.mjs) by scoping `npm test` to this repo's
// own `*.test.mjs` naming convention. The first attempt at that fix (`node --test
// '**/*.test.mjs'`) relied on Node's OWN test-runner glob expansion of a quoted positional
// argument -- a second-opinion review (codex-advisor) caught two real problems with that: (1) this
// repo's own `package.json` declares `"engines": { "node": ">=20" }`, but glob-pattern positional
// arguments are not part of Node 20's own documented `--test` CLI surface (compare the Node
// 20.19.0 `test.html` docs, which describe only explicit file/directory positional arguments,
// against the current docs, which document glob support -- the related programmatic
// `run({ globPatterns })` option itself wasn't added until v22.6.0), so the quoted pattern risked
// being treated as a literal, nonexistent path on an actually-Node-20 install; (2) a single-quoted
// glob is not portable to Windows' `cmd.exe`, which does not treat `'` as shell quoting the way
// POSIX shells do (Node's own docs recommend double quotes for exactly this reason, which still
// wouldn't fix problem (1)).
//
// This script sidesteps BOTH problems: it does its own recursive directory walk (plain
// `fs.readdirSync`, unchanged Node API since long before this repo's `>=20` floor) to find every
// `*.test.mjs` file, then spawns `node --test` with the explicit, already-resolved file list --
// a mechanism Node's test runner has supported since its introduction, on every platform, with no
// glob-parsing step for a shell or a Node version to disagree about.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const ROOT = process.cwd();

// node_modules/.git: never contain this repo's own test files, and node_modules alone can be
// enormous -- skip both outright rather than walking into them.
const SKIP_DIRS = new Set(['node_modules', '.git']);

function findTestFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      findTestFiles(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = findTestFiles(ROOT).map((f) => relative(ROOT, f)).sort();

if (files.length === 0) {
  console.error('run-tests.mjs: no *.test.mjs files found under', ROOT);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
// spawnSync's own `status` is null if the child was killed by a signal rather than exiting
// normally -- fail closed (non-zero) rather than letting a killed test run report success.
process.exit(result.status === null ? 1 : result.status);
