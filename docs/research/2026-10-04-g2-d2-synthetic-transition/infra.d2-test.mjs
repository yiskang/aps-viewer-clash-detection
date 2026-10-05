import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, canonicalBytes, sha256Hex } from './canonical.mjs';
import { validateInputs, assertInputs, EXPECTED_INPUT_HASHES } from './inputs.mjs';
import { checkCaps, writeOutputsAtomically, digestSummary, withDigests } from './outputs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const REAL = {
  spec: resolve(HERE, '..', '2026-10-04-g2-d2-synthetic-transition-spec.md'),
  harness: resolve(REPO, 'test/acceptance/clashpanel-viewerbridge.acceptance.mjs'),
  r1: resolve(REPO, 'docs/research/evidence/g2-live-20261004-75a3ccb9/R1-clashpanel-viewerbridge-g2-result.json'),
  fixtures: resolve(HERE, 'fixtures.json'),
};
const CAPS = JSON.parse(readFileSync(REAL.fixtures, 'utf8')).caps;
const fh = () => sha256Hex(readFileSync(REAL.fixtures));
const expectedReal = () => ({ ...EXPECTED_INPUT_HASHES, fixtures: fh() });
const tmp = () => mkdtempSync(join(tmpdir(), 'd2-infra-'));

test('canonical: sorted keys, nested, no whitespace, arrays ordered', () => {
  assert.equal(canonicalStringify({ b: 1, a: { d: [3, 1, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[3,1,{"y":2,"z":1}]},"b":1}');
});
test('canonical: -0 -> 0, rejects NaN/Infinity/undefined/function/bigint/non-plain', () => {
  assert.equal(canonicalStringify([-0, 0, 1.5]), '[0,0,1.5]');
  for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, 1n, new Date(0), new Map(), { a: undefined }, Symbol('s'), [, 1]]) {
    assert.throws(() => canonicalStringify(bad), TypeError);
  }
  const cyc = {}; cyc.c = cyc;
  assert.throws(() => canonicalStringify(cyc), TypeError);
});
test('canonical: UTF-8 bytes, no trailing newline, byte-identical across calls', () => {
  const v = { k: 'é漢😀', a: [1, 2] };
  const a = canonicalBytes(v), b = canonicalBytes({ a: [1, 2], k: 'é漢😀' });
  assert.ok(a.equals(b));
  assert.notEqual(a[a.length - 1], 0x0a);
  assert.equal(a.toString('utf8'), '{"a":[1,2],"k":"é漢😀"}');
  assert.equal(sha256Hex('abc'), sha256Hex(Buffer.from('abc')));
});

test('inputs: real files validate', () => {
  const r = validateInputs({ paths: REAL, expected: expectedReal() });
  assert.deepEqual(r.mismatches, []);
  assert.ok(r.ok);
  assert.doesNotThrow(() => assertInputs({ paths: REAL, expected: expectedReal() }));
  assert.equal(r.records.harness.observed, EXPECTED_INPUT_HASHES.harness);
});
test('inputs: null expected records observed only', () => {
  const r = validateInputs({ paths: REAL, expected: { spec: null, harness: null, r1: null, fixtures: null } });
  assert.ok(r.ok);
  assert.equal(r.records.spec.expected, null);
  assert.match(r.records.spec.observed, /^[0-9a-f]{64}$/);
});
test('inputs: tampered copy of each input => mismatch, exit 2, real files untouched', () => {
  const before = Object.fromEntries(Object.entries(REAL).map(([k, p]) => [k, sha256Hex(readFileSync(p))]));
  const dir = tmp();
  try {
    for (const name of Object.keys(REAL)) {
      const paths = {};
      for (const [k, p] of Object.entries(REAL)) {
        const c = join(dir, `${name}-${k}`);
        copyFileSync(p, c);
        paths[k] = c;
      }
      const buf = readFileSync(paths[name]);
      buf[0] ^= 0x01;
      writeFileSync(paths[name], buf);
      const r = validateInputs({ paths, expected: expectedReal() });
      assert.equal(r.ok, false);
      assert.deepEqual(r.mismatches, [name]);
      assert.notEqual(r.records[name].observed, r.records[name].expected);
      assert.throws(() => assertInputs({ paths, expected: expectedReal() }), (e) => e.exitCode === 2 && e.code === 'C1-INVALID');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const after = Object.fromEntries(Object.entries(REAL).map(([k, p]) => [k, sha256Hex(readFileSync(p))]));
  assert.deepEqual(after, before);
  assert.equal(before.harness, EXPECTED_INPUT_HASHES.harness);
});
test('inputs: missing file => mismatch with observed null, never throws', () => {
  const paths = { ...REAL, r1: join(tmpdir(), 'd2-does-not-exist.json') };
  const r = validateInputs({ paths, expected: expectedReal() });
  assert.deepEqual(r.mismatches, ['r1']);
  assert.equal(r.records.r1.observed, null);
  assert.throws(() => assertInputs({ paths, expected: expectedReal() }), (e) => e.exitCode === 2);
  // missing even with null expected is still a mismatch
  assert.deepEqual(validateInputs({ paths, expected: { spec: null, harness: null, r1: null, fixtures: null } }).mismatches, ['r1']);
});

const mk = (n) => Buffer.alloc(n, 0x61);
test('caps: per-file boundary', () => {
  assert.ok(checkCaps({ files: { 'd2-witnesses.json': mk(CAPS.perOutputBytes) }, fixturesCaps: CAPS, traceCount: 0 }).ok);
  assert.ok(checkCaps({ files: { 'd2-witnesses.json': mk(CAPS.perOutputBytes - 1) }, fixturesCaps: CAPS, traceCount: 0 }).ok);
  const r = checkCaps({ files: { 'd2-witnesses.json': mk(CAPS.perOutputBytes + 1) }, fixturesCaps: CAPS, traceCount: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.observed.perFile['d2-witnesses.json'], CAPS.perOutputBytes + 1);
});
test('caps: summary boundary', () => {
  assert.ok(checkCaps({ files: { 'd2-summary.json': mk(CAPS.summaryBytes) }, fixturesCaps: CAPS, traceCount: 0 }).ok);
  assert.equal(checkCaps({ files: { 'd2-summary.json': mk(CAPS.summaryBytes + 1) }, fixturesCaps: CAPS, traceCount: 0 }).ok, false);
});
test('caps: total boundary', () => {
  const half = CAPS.totalOutputBytes - CAPS.perOutputBytes;
  assert.ok(checkCaps({ files: { a: mk(CAPS.perOutputBytes), b: mk(half) }, fixturesCaps: CAPS, traceCount: 0 }).ok);
  const r = checkCaps({ files: { a: mk(CAPS.perOutputBytes), b: mk(half + 1) }, fixturesCaps: CAPS, traceCount: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.startsWith('total')));
});
test('caps: trace count boundary', () => {
  assert.ok(checkCaps({ files: {}, fixturesCaps: CAPS, traceCount: CAPS.maxTraces }).ok);
  assert.equal(checkCaps({ files: {}, fixturesCaps: CAPS, traceCount: CAPS.maxTraces + 1 }).ok, false);
});
test('write: nothing written when cap exceeded; exit 2 CAP-EXCEEDED', () => {
  const base = tmp();
  try {
    const out = join(base, 'out');
    assert.throws(
      () => writeOutputsAtomically(out, { 'd2-summary.json': mk(CAPS.summaryBytes + 1) }, CAPS),
      (e) => e.exitCode === 2 && e.code === 'CAP-EXCEEDED',
    );
    assert.equal(existsSync(out), false);
    assert.throws(() => writeOutputsAtomically(out, { x: mk(1) }, CAPS, { traceCount: 155 }), (e) => e.code === 'CAP-EXCEEDED');
    assert.equal(existsSync(out), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
test('write: success, fixed names, bytes; refuses non-empty dir', () => {
  const base = tmp();
  try {
    const out = join(base, 'nested', 'out');
    const r = writeOutputsAtomically(out, { 'd2-summary.json': Buffer.from('{}'), 'd2-witnesses.json': Buffer.from('[]') }, CAPS);
    assert.equal(r.bytesWritten, 4);
    assert.deepEqual(readdirSync(out).sort(), ['d2-summary.json', 'd2-witnesses.json']);
    assert.equal(readFileSync(join(out, 'd2-summary.json'), 'utf8'), '{}');
    assert.throws(() => writeOutputsAtomically(out, { 'd2-summary.json': Buffer.from('{}') }, CAPS), (e) => e.code === 'OUTPUT-DIR-NOT-EMPTY');
    assert.throws(() => writeOutputsAtomically(join(base, 'o2'), { '../evil': Buffer.from('x') }, CAPS), (e) => e.code === 'BAD-OUTPUT-NAME');
    assert.equal(existsSync(join(base, 'o2')), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
test('write: refuses results/evidence dirs (nothing created)', () => {
  for (const d of [join(REPO, 'test/acceptance/results/d2-x'), join(REPO, 'docs/research/evidence/d2-x'), join(REPO, 'docs/research/evidence')]) {
    const had = existsSync(d);
    assert.throws(() => writeOutputsAtomically(d, { a: Buffer.from('x') }, CAPS), (e) => e.code === 'FORBIDDEN-OUTPUT-DIR');
    assert.equal(existsSync(d), had);
  }
});

test('digests: ordering, stability, omission of outputDigestSha256', () => {
  const summary = { schemaVersion: 1, b: 2, a: [1], outputDigestSha256: 'stale' };
  const witnesses = { traces: [{ f: 1 }] };
  const r1 = withDigests({ summary, witnesses });
  const r2 = withDigests({ summary, witnesses });
  assert.ok(r1.summaryBytes.equals(r2.summaryBytes) && r1.witnessesBytes.equals(r2.witnessesBytes));
  assert.equal(summary.outputDigestSha256, 'stale'); // input not mutated
  const parsed = JSON.parse(r1.summaryBytes.toString('utf8'));
  assert.equal(parsed.companionDigestSha256, sha256Hex(r1.witnessesBytes));
  assert.equal(parsed.outputDigestSha256, digestSummary(parsed));
  assert.equal(digestSummary({ ...parsed, outputDigestSha256: 'zzz' }), parsed.outputDigestSha256);
  assert.ok(r1.summaryBytes.equals(canonicalBytes(parsed)));
  // changing witnesses changes both digests
  const r3 = withDigests({ summary, witnesses: { traces: [{ f: 2 }] } });
  assert.notEqual(r3.outputDigestSha256, r1.outputDigestSha256);
  assert.notEqual(r3.companionDigestSha256, r1.companionDigestSha256);
});

// ---- owned input snapshots (hardening): validated bytes == consumed bytes, one read, no path reopen
import { readValidatedSnapshot } from './inputs.mjs';
import { runSimulation } from './simulate.mjs';
import { assertTraceRowWithinCap } from './machine.mjs';

const countingReader = (log, onRead) => (p) => {
  log.push(p);
  const b = readFileSync(p);
  if (onRead) onRead(p);
  return b;
};
const copyInputs = (dir) => {
  const paths = {};
  for (const [k, p] of Object.entries(REAL)) { paths[k] = join(dir, k); copyFileSync(p, paths[k]); }
  return paths;
};

test('snapshot: valid => exactly one read, digest from those bytes, bytes returned', () => {
  const log = [];
  const exp = sha256Hex(readFileSync(REAL.fixtures));
  const s = readValidatedSnapshot(REAL.fixtures, exp, countingReader(log));
  assert.equal(log.length, 1);
  assert.ok(s.ok);
  assert.equal(s.digest, exp);
  assert.equal(sha256Hex(s.bytes), exp);
  const log2 = [];
  const v = validateInputs({ paths: REAL, expected: expectedReal(), reader: countingReader(log2) });
  assert.ok(v.ok);
  assert.deepEqual([...log2].sort(), Object.values(REAL).sort()); // each path read once, none twice
  for (const n of Object.keys(REAL)) assert.equal(sha256Hex(v.snapshots[n]), v.records[n].observed);
});

test('snapshot: digest mismatch => no bytes handed back, snapshot withheld', () => {
  const s = readValidatedSnapshot(REAL.fixtures, '0'.repeat(64));
  assert.equal(s.ok, false);
  assert.equal(s.bytes, null);
  assert.match(s.digest, /^[0-9a-f]{64}$/);
  const v = validateInputs({ paths: REAL, expected: { ...expectedReal(), r1: '0'.repeat(64) } });
  assert.deepEqual(v.mismatches, ['r1']);
  assert.equal(v.snapshots.r1, undefined);
  assert.ok(Buffer.isBuffer(v.snapshots.fixtures));
});

test('snapshot: mismatching fixtures fail C1-INVALID before parse/enumeration; invalid bytes never consumed', () => {
  const dir = tmp();
  try {
    const paths = copyInputs(dir);
    writeFileSync(paths.fixtures, 'this is not json'); // would throw SyntaxError if ever parsed
    const log = [];
    assert.throws(
      () => runSimulation({ paths, expected: expectedReal(), reader: countingReader(log) }),
      (e) => e.exitCode === 2 && e.code === 'C1-INVALID' && !(e instanceof SyntaxError),
    );
    assert.equal(log.filter((p) => p === paths.fixtures).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('snapshot: replacement after read => consumes bytes A, digest of A, no second read of either path', () => {
  const dir = tmp();
  try {
    const paths = copyInputs(dir);
    const A = { fixtures: readFileSync(REAL.fixtures), r1: readFileSync(REAL.r1) };
    const log = [];
    const baseline = runSimulation({ paths: REAL, expected: expectedReal() });
    const fxB = JSON.parse(A.fixtures.toString('utf8'));
    fxB.expectedCounts.total += 1; // replacement bytes B would fail the count gate if ever consumed
    const reader = countingReader(log, (p) => {
      if (p === paths.fixtures) writeFileSync(paths.fixtures, JSON.stringify(fxB));
      if (p === paths.r1) writeFileSync(paths.r1, '{"replaced":true}');
    });
    const res = runSimulation({ paths, expected: expectedReal(), reader });
    assert.equal(log.filter((p) => p === paths.fixtures).length, 1);
    assert.equal(log.filter((p) => p === paths.r1).length, 1);
    assert.equal(res.summary.inputHashes.fixtures.observed, sha256Hex(A.fixtures));
    assert.equal(res.summary.inputHashes.r1.observed, sha256Hex(A.r1));
    assert.notEqual(sha256Hex(readFileSync(paths.fixtures)), sha256Hex(A.fixtures)); // backing file really changed
    assert.equal(res.summary.outputDigestSha256, baseline.summary.outputDigestSha256); // results derive from A only
    assert.ok(res.summaryBytes.equals(baseline.summaryBytes));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('snapshot: fixtures and R1 own independent bytes and digests', () => {
  const v = validateInputs({ paths: REAL, expected: expectedReal() });
  assert.notEqual(v.snapshots.fixtures, v.snapshots.r1);
  assert.ok(!v.snapshots.fixtures.equals(v.snapshots.r1));
  assert.notEqual(v.records.fixtures.observed, v.records.r1.observed);
  const before = Buffer.from(v.snapshots.r1);
  v.snapshots.fixtures.fill(0); // mutating one owned snapshot does not touch the other
  assert.ok(v.snapshots.r1.equals(before));
  const src = Buffer.from('abc');
  const own = readValidatedSnapshot('x', null, () => src);
  src[0] = 0x7a; // reader's buffer mutated after the read: snapshot unchanged, digest still of original
  assert.equal(own.bytes.toString(), 'abc');
  assert.equal(own.digest, sha256Hex('abc'));
});

test('trace row cap: 127 B and exactly 128 B accepted (inclusive); 129 B rejected', () => {
  const rowOf = (n) => { // JSON length exactly n via padding of the last cell
    const base = JSON.stringify([0, 'H', 'e', 0, 0, 0, 'INIT', 0, '-', '']).length;
    return [0, 'H', 'e', 0, 0, 0, 'INIT', 0, '-', 'x'.repeat(n - base)];
  };
  for (const n of [127, 128]) { assert.equal(JSON.stringify(rowOf(n)).length, n); assert.doesNotThrow(() => assertTraceRowWithinCap(rowOf(n), CAPS.traceRowBytes)); }
  assert.equal(JSON.stringify(rowOf(129)).length, 129);
  assert.throws(() => assertTraceRowWithinCap(rowOf(129), CAPS.traceRowBytes), /trace row exceeds 128 B/);
  assert.equal(CAPS.traceRowBytes, 128);
});
