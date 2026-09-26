// test/clashpanel/domIsolation.test.mjs — DOM-suite isolation + default-gate wiring (Task 27; review H2).
// Runs INSIDE the offline suite: proves (1) the offline runner never collects a `*.dom.mjs` and no `*.test.mjs`
// imports the browser-automation package (the offline suite stays Chromium-free), and (2) the ONE default gate
// `npm test` runs BOTH suites through their own scripts, with no script recursion and no runner that re-enters npm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', '.git']);
const PKG = ['play', 'wright'].join(''); // split so this file never matches its own scan

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name), predicate, out); }
    else if (entry.isFile() && predicate(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

test('scripts/run-tests.mjs collects ONLY *.test.mjs (its single file predicate)', () => {
  const src = readFileSync(path.join(ROOT, 'scripts', 'run-tests.mjs'), 'utf8');
  const predicates = src.match(/entry\.name\.endsWith\([^)]*\)/g) ?? [];
  assert.deepEqual(predicates, ["entry.name.endsWith('.test.mjs')"]);
});

test('every DOM test is *.dom.mjs, lives under test/clashpanel/dom/, and is not a *.test.mjs', () => {
  const domFiles = walk(path.join(ROOT, 'test', 'clashpanel', 'dom'), (n) => n.endsWith('.mjs'));
  assert.ok(domFiles.some((f) => f.endsWith('.dom.mjs')), 'at least the harness smoke test exists');
  for (const f of domFiles) assert.ok(!f.endsWith('.test.mjs'), `${path.relative(ROOT, f)} would be collected by the offline suite`);
  const strays = walk(ROOT, (n) => n.endsWith('.dom.mjs')).filter((f) => !f.startsWith(path.join(ROOT, 'test', 'clashpanel', 'dom') + path.sep));
  assert.deepEqual(strays, []);
});

test(`no *.test.mjs imports the ${PKG} package (Chromium is never part of the OFFLINE suite)`, () => {
  const pattern = new RegExp(`(from\\s*['"]${PKG}['"])|(import\\(\\s*['"]${PKG}['"]\\s*\\))|(require\\(\\s*['"]${PKG}['"]\\s*\\))`);
  const offenders = walk(ROOT, (n) => n.endsWith('.test.mjs'))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

const pkg = () => JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('H2: the default gate `npm test` runs the offline suite AND the DOM suite (each through its own script)', () => {
  const { scripts } = pkg();
  assert.equal(scripts['test:offline'], 'node scripts/run-tests.mjs');
  assert.equal(scripts['test:clashpanel:dom'], 'node scripts/run-dom-tests.mjs');
  assert.equal(scripts.test, 'npm run test:offline && npm run test:clashpanel:dom');
  assert.equal(scripts.pretest, 'npm run build:vendor', 'pretest (vendor sync) stays exactly as it is and runs once, for `npm test` only');
});

const flatDoc = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\s+/g, ' ');

test('docs: test/README.md states that npm test is the aggregate gate and requires Playwright Chromium', () => {
  const t = flatDoc('test', 'README.md');
  assert.match(t, /`npm test` is the canonical \*\*default aggregate gate\*\*/);
  assert.match(t, /\(`npm run test:offline`\) and then the Viewer Clash Panel DOM suite \(`npm run test:clashpanel:dom`\)/);
  assert.match(t, /\*\*`npm test` requires the installed Playwright Chromium\*\*/);
  assert.match(t, /`npm run test:offline` is the \*\*browser-free\*\* command/);
  assert.match(t, /needs \*\*no server, no credentials and no network\*\*, and never loads a live APS Viewer/);
});

test('docs: test/acceptance/README.md separates the default-gate Panel DOM suite from the excluded live scripts', () => {
  const a = flatDoc('test', 'acceptance', 'README.md');
  assert.match(a, /## Which browser tests are in `npm test`/);
  assert.match(a, /Viewer Clash Panel DOM suite\*\* \(`test\/clashpanel\/dom\/\*\.dom\.mjs`, `npm run test:clashpanel:dom`\) is \*\*included in `npm test`\.\*\*/);
  assert.match(a, /no server, no APS credentials, no network, and never loads a live Viewer/);
  assert.match(a, /\*\*The live acceptance scripts\*\* .*are \*\*not part of `npm test`\.\*\*/);
  assert.match(a, /Live Viewer \/ SVF2 acceptance is never part of the default gate/);
  assert.match(a, /- \*\*Not part of `npm test`\.\*\* `scripts\/run-tests\.mjs` collects only `\*\.test\.mjs`/);   // preserved: the named T3 script's own statement
  // Negative guards: nothing may describe a live script as part of / included in the default gate.
  assert.equal((a.match(/included in `npm test`/g) ?? []).length, 1, 'only the Panel DOM suite is "included in `npm test`"');
  for (const m of a.matchAll(/part of `npm test`/g)) assert.match(a.slice(Math.max(0, m.index - 4), m.index), /not $/i, `"part of \`npm test\`" must be negated: …${a.slice(Math.max(0, m.index - 30), m.index + 20)}`);
});

// Script names a shell command line invokes through npm (`npm test`, `npm run x`); operators split the line.
function invoked(command) {
  const names = [];
  for (const part of String(command).split(/&&|\|\||;|\|/)) {
    const m = /^\s*npm\s+(?:run(?:-script)?\s+)?([^\s]+)/.exec(part);
    if (m) names.push(m[1] === 't' || m[1] === 'tst' ? 'test' : m[1]);
  }
  return names;
}

test('H2: no script recursion — the graph from `test` is acyclic, reaches both suites, and both runners spawn node (never npm)', () => {
  const { scripts } = pkg();
  const reached = new Set();
  const visit = (name, stack) => {
    assert.ok(!stack.includes(name), `script cycle: ${[...stack, name].join(' -> ')}`);
    assert.ok(Object.hasOwn(scripts, name), `npm script "${name}" is invoked but not defined`);
    reached.add(name);
    for (const next of invoked(scripts[name])) visit(next, [...stack, name]);
  };
  visit('test', []);
  assert.ok(reached.has('test:offline') && reached.has('test:clashpanel:dom'), `default gate reaches ${[...reached]}`);
  for (const runner of ['run-tests.mjs', 'run-dom-tests.mjs']) {
    const src = readFileSync(path.join(ROOT, 'scripts', runner), 'utf8');
    const spawned = [...src.matchAll(/\bspawn(?:Sync)?\(\s*([^,\s)]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(spawned)], ['process.execPath'], `${runner} may spawn only process.execPath (node --test)`);
    assert.ok(!/\bexec(?:Sync|File|FileSync)?\(/.test(src), `${runner} must not use exec*`);
  }
});
