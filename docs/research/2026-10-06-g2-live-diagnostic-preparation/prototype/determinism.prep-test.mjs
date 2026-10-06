// Deterministic outputs: two full preparation runs into fresh scratch directories are byte-identical, contain no
// absolute path, host name or timestamp, and the package fixtures equal a fresh generation. Output-directory
// refusals. [SYN] research-local tests. Scratch root: $PREP_SCRATCH, else the OS temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir, hostname, userInfo } from 'node:os';
import { runPreparation, writeOutputs, checkOutDir } from './run-preparation.mjs';
import { generateFixtures, readFixturesDir, compareFixtures, FIXTURES_DIR } from './fixtures-gen.mjs';
import { loadContract } from './contract-loader.mjs';
import { REPO } from './envelope.mjs';

const ROOT = process.env.PREP_SCRATCH || tmpdir();
const walk = (d) => readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const snapshot = (d) => Object.fromEntries(walk(d).map((p) => [relative(d, p).split(sep).join('/'), readFileSync(p)]));

test('determinism: two preparation runs into clean scratch directories are byte-identical', async () => {
  const base = mkdtempSync(join(ROOT, 'prep-det-'));
  try {
    const a = await runPreparation(); const b = await runPreparation();
    assert.equal(a.ok, true, JSON.stringify(Object.entries(a.gates).filter(([, g]) => !g.ok)));
    writeOutputs(join(base, 'run1'), a.outFiles); writeOutputs(join(base, 'run2'), b.outFiles);
    const s1 = snapshot(join(base, 'run1')); const s2 = snapshot(join(base, 'run2'));
    assert.deepEqual(Object.keys(s1), Object.keys(s2));
    for (const k of Object.keys(s1)) assert.ok(s1[k].equals(s2[k]), `${k} differs`);
    const text = Object.values(s1).map((x) => x.toString('utf8')).join('\n');
    for (const needle of [REPO, base, hostname(), userInfo().username, '/Users/', '/private/', '\r']) assert.ok(!text.includes(needle), `output contains ${JSON.stringify(needle)}`);
    assert.ok(!/20\d\d-\d\d-\d\dT\d\d:\d\d/.test(text), 'no ISO timestamps');
    const sums = s1.SHA256SUMS.toString('utf8').trim().split('\n');
    assert.equal(sums.length, Object.keys(s1).length - 1);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('determinism: the package fixtures equal a fresh in-memory generation, and generation is stable', () => {
  const g1 = generateFixtures(loadContract()).files; const g2 = generateFixtures(loadContract()).files;
  assert.deepEqual(g1, g2);
  assert.ok(existsSync(FIXTURES_DIR), 'fixtures/ generated');
  assert.deepEqual(compareFixtures(readFixturesDir(), g1), []);
});

test('output directory: non-empty, evidence, acceptance-results and committed research directories are refused', () => {
  const base = mkdtempSync(join(ROOT, 'prep-out-'));
  try {
    mkdirSync(join(base, 'full')); writeFileSync(join(base, 'full', 'x'), 'x');
    assert.throws(() => checkOutDir(join(base, 'full')), (e) => e.code === 'OUTPUT-DIR-NOT-EMPTY');
    for (const rel of ['docs/research/evidence/x', 'test/acceptance/results/x', 'docs/research/2026-10-04-g2-d2-synthetic-transition/x', 'docs/research/2026-10-05-g2-diagnostic-instrumentation/results-x', 'docs/research/2026-10-06-g2-live-diagnostic-preparation/fixtures/x']) {
      assert.throws(() => checkOutDir(join(REPO, rel)), (e) => e.code === 'FORBIDDEN-OUTPUT-DIR', rel);
      assert.ok(!existsSync(join(REPO, rel)), `${rel} created`);
    }
    assert.equal(checkOutDir(join(base, 'fresh')), join(base, 'fresh'));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
