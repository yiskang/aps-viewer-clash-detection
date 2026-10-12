// Tests for CTM8-P0-v4 evidence helpers (§12, §13). Uses os.tmpdir() only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJson, sha256Hex, createJsonlSink, readJsonl, collectEnvironment,
  createEvidenceLayout, writeManifestAndChecksums,
} from '../lib/evidence.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ctm8-ev-'));

test('canonical JSON hash is key-order independent and stable across builds', () => {
  const a = { b: 1, a: { y: [1, { q: 2, p: 3 }], x: null } };
  const b = { a: { x: null, y: [1, { p: 3, q: 2 }] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(sha256Hex(canonicalJson(a)), sha256Hex(canonicalJson(b)));
  const build = () => ({ n: 5, list: [3, 2, 1] });
  assert.equal(sha256Hex(canonicalJson(build())), sha256Hex(canonicalJson(build())));
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
});

test('JSONL sink appends one line per record and reads back', () => {
  const dir = tmp();
  const f = path.join(dir, 'raw', 'headless-0.jsonl');
  const sink = createJsonlSink(f);
  sink.append({ i: 1 }); sink.append({ i: 2 });
  assert.deepEqual(readJsonl(f), [{ i: 1 }, { i: 2 }]);
  sink.append({ i: 3 });
  assert.equal(readJsonl(f).length, 3);
  assert.equal(readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 3);
  rmSync(dir, { recursive: true });
});

test('collectEnvironment fills Node-obtainable fields and nulls browser fields', () => {
  const e = collectEnvironment({ repoRoot: process.cwd() });
  assert.equal(e.nodeVersion, process.version);
  assert.ok(e.cpuCores > 0 && e.ramBytes > 0);
  assert.equal(e.browserName, null);
  assert.equal(e.viewerVersion, null);
  assert.equal(e.timerSource, 'performance.now()');
});

test('layout skeleton, manifest and checksums', () => {
  const base = tmp();
  const root = createEvidenceLayout(base, '2026-10-12');
  assert.ok(root.endsWith('docs/research/evidence/2026-10-12-ctm-8-rebuild-cost-calibration'));
  for (const d of ['raw', 'summary', 'fixtures', 'headed']) assert.ok(existsSync(path.join(root, d)));
  assert.equal(readFileSync(path.join(root, 'protocol-version.txt'), 'utf8').trim(), 'CTM8-P0-v4');
  createJsonlSink(path.join(root, 'raw', 'headless-0.jsonl')).append({ a: 1 });
  writeManifestAndChecksums(root);
  const sums = readFileSync(path.join(root, 'checksums.sha256'), 'utf8').trim().split('\n');
  assert.ok(sums.some((l) => l.endsWith('  MANIFEST.md')));
  const line = sums.find((l) => l.endsWith('raw/headless-0.jsonl'));
  assert.equal(line.split('  ')[0], sha256Hex(readFileSync(path.join(root, 'raw', 'headless-0.jsonl'))));
  rmSync(base, { recursive: true });
});
