// test/acceptance/clashpanel-viewerbridge.acceptance.hygiene.test.mjs
//
// Offline tests for evidence hygiene (procedure §4.6): redaction (parity with G1's regime), per-field
// and ledger size caps, and the verdict-critical exemption (over-cap => visible failure, not truncation).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactEvidenceText,
  redactEvidenceUrl,
  sanitizeEvidenceTree,
  isVerdictCriticalPath,
  capSpyLedger,
  isVerdictCriticalSpyRecord,
  EvidenceCapError,
  truncateUtf8,
  TABLE_T,
  summarizeValue,
  createCallRecorder,
} from './clashpanel-viewerbridge.acceptance.mjs';
import { redactLedgerString } from './g1-svf2-f1-f8-verification.mjs';

test('redaction: bearer, Authorization/Cookie lines, sensitive query params are masked', () => {
  const cases = [
    ['GET with Bearer abc.DEF-123_456==', 'Bearer'],
    ['Authorization: Basic Zm9vOmJhcg==\nnext', 'Basic'],
    ['Cookie: sid=secret; other=1', 'secret'],
    ['https://cdn.example/x.js?access_token=SECRETVALUE&v=1', 'SECRETVALUE'],
    ['https://cdn.example/x.js?X-Amz-Signature=SIGVALUE&keep=1', 'SIGVALUE'],
    ['?token=TOKVALUE&a=1', 'TOKVALUE'],
  ];
  for (const [input, secret] of cases) {
    const r = redactEvidenceText(input);
    assert.equal(r.redacted, true, input);
    assert.equal(r.value.includes(secret === 'Bearer' ? 'abc.DEF' : secret), false, input);
    assert.match(r.value, /\[REDACTED\]|%5BREDACTED%5D/);
  }
  assert.deepEqual(redactEvidenceText('nothing secret here'), { value: 'nothing secret here', redacted: false });
  assert.deepEqual(redactEvidenceText(42), { value: 42, redacted: false });
});

test('redaction parity: matches the G1 ledger redaction on a corpus of short strings', () => {
  const corpus = [
    'plain', 'Bearer abc123', 'Authorization: Bearer xyz', 'Cookie: a=b', 'https://a.b/c?token=t&x=1',
    '?sig=s&ok=2', 'see https://a.b/c?client_secret=cs and more', 'API_KEY=1 apikey=2', 'https://u:p@a.b/c?x=1',
  ];
  for (const s of corpus) assert.equal(redactEvidenceText(s).value, redactLedgerString(s), s);
});

test('failed-resource URLs: query string, fragment and credentials are dropped entirely', () => {
  assert.deepEqual(redactEvidenceUrl('https://cdn.example/lib/viewer3D.js?token=abc&v=1#frag'), { value: 'https://cdn.example/lib/viewer3D.js', queryDropped: true });
  assert.deepEqual(redactEvidenceUrl('https://u:p@cdn.example/a.js'), { value: 'https://cdn.example/a.js', queryDropped: true });
  assert.deepEqual(redactEvidenceUrl('https://cdn.example/a.js'), { value: 'https://cdn.example/a.js', queryDropped: false });
  assert.deepEqual(redactEvidenceUrl('/relative/a.js?x=1'), { value: '/relative/a.js', queryDropped: true });
  assert.deepEqual(redactEvidenceUrl(null), { value: null, queryDropped: false });
});

test('byte-safe truncation never splits a multi-byte code point', () => {
  const s = 'a€'.repeat(10); // 1 + 3 bytes each
  for (let cap = 0; cap < 40; cap += 1) {
    const t = truncateUtf8(s, cap);
    assert.ok(Buffer.byteLength(t.value, 'utf8') <= cap);
    assert.equal(t.value.includes('�'), false);
    assert.equal(t.originalBytes, 40);
  }
  assert.equal(truncateUtf8('abc', 3).truncated, false);
});

test('sanitizeEvidenceTree: redacts every string, caps non-exempt fields at 4 KiB and records truncation', () => {
  const big = 'x'.repeat(TABLE_T.T22.perFieldBytes + 100);
  const input = { console: { text: `Bearer SECRET1 ${'y'.repeat(10)}` }, blob: big, nested: [{ note: big }], n: 3, flag: true, nul: null };
  const r = sanitizeEvidenceTree(input);
  assert.equal(JSON.stringify(r.value).includes('SECRET1'), false);
  assert.equal(r.redactionCount, 1);
  assert.deepEqual(r.value.blob, { value: 'x'.repeat(4096), truncated: true, originalBytes: 4196 });
  assert.equal(r.value.nested[0].note.truncated, true);
  assert.deepEqual(r.truncations.map((t) => t.path), ['blob', 'nested.0.note']);
  assert.equal(r.value.n, 3);
  assert.equal(r.value.flag, true);
  assert.equal(input.blob, big, 'input not mutated');
});

test('sanitizeEvidenceTree: a verdict-critical field over the cap fails visibly instead of being truncated', () => {
  const big = 'r'.repeat(TABLE_T.T22.perFieldBytes + 1);
  for (const doc of [
    { checks: { C1: { verdict: big } } },
    { checks: { C1: { reason: big } } },
    { sceneOwnership: [{ scene: big }] },
    { journal: { transitions: [{ detail: big }] } },
    { closeout: { primaryOverall: big } },
    { c17: { oracleOutputs: { x: big } } },
  ]) {
    assert.throws(() => sanitizeEvidenceTree(doc), (e) => e instanceof EvidenceCapError && e.reason === 'verdict-critical-field-over-cap');
  }
  // the same size in a non-critical field is merely truncated
  assert.doesNotThrow(() => sanitizeEvidenceTree({ checks: { C1: { evidence: big } } }));
  // a critical field at exactly the cap is kept whole
  const exact = 'e'.repeat(TABLE_T.T22.perFieldBytes);
  assert.equal(sanitizeEvidenceTree({ verdict: exact }).value.verdict, exact);
  assert.equal(isVerdictCriticalPath(['checks', 'C4', 'evidence', 0]), false);
  assert.equal(isVerdictCriticalPath(['a', 'sceneOwnership', 0]), true);
});

function mkRecord(i, method, padding = 0, extra = {}) {
  return { callIndex: i, method, origin: 'harness', argSummaries: [{ kind: 'string', value: 'p'.repeat(padding) }], argRefIds: [null], argsDigest: 'd'.repeat(64), at: 'T', atMs: i, outcome: null, injected: false, ...extra };
}

test('capSpyLedger: under the cap nothing changes; over the cap drops non-critical records, keeps critical ones, records truncation', () => {
  const small = [mkRecord(0, 'viewer.fitToView'), mkRecord(1, 'overlays.addMesh')];
  const untouched = capSpyLedger(small);
  assert.equal(untouched.truncated, false);
  assert.equal(untouched.records.length, 2);
  const recs = [];
  for (let i = 0; i < 40; i += 1) recs.push(mkRecord(i, i % 10 === 0 ? 'overlays.removeScene' : 'viewer.fitToView', 400));
  const r = capSpyLedger(recs, { maxBytes: 12_000 });
  assert.equal(r.truncated, true);
  assert.ok(r.originalBytes > 12_000);
  assert.equal(r.keptRecords + r.droppedRecords, 40);
  assert.ok(r.droppedRecords > 0);
  const keptIdx = new Set(r.records.map((x) => x.callIndex));
  for (const x of recs) if (isVerdictCriticalSpyRecord(x)) assert.ok(keptIdx.has(x.callIndex), 'critical record dropped');
  assert.ok(Buffer.byteLength(JSON.stringify(r.records), 'utf8') <= 12_000 + 200);
  assert.deepEqual(r.records.map((x) => x.callIndex), [...keptIdx].sort((a, b) => a - b), 'original order preserved');
});

test('capSpyLedger: verdict-critical records alone over the cap => the evidence write fails visibly', () => {
  const recs = Array.from({ length: 10 }, (_, i) => mkRecord(i, 'overlays.addMesh', 500));
  assert.throws(() => capSpyLedger(recs, { maxBytes: 1000 }), (e) => e instanceof EvidenceCapError && e.reason === 'verdict-critical-ledger-over-cap');
  assert.equal(TABLE_T.T22.spyLedgerBytes, 2 * 1024 * 1024);
});

test('verdict-critical spy records: overlays, theming, selection and injected calls; not isolation/fit', () => {
  assert.equal(isVerdictCriticalSpyRecord(mkRecord(0, 'overlays.removeScene')), true);
  assert.equal(isVerdictCriticalSpyRecord(mkRecord(0, 'viewer.select')), true);
  assert.equal(isVerdictCriticalSpyRecord(mkRecord(0, 'viewer.fitToView', 0, { injected: true })), true);
  assert.equal(isVerdictCriticalSpyRecord(mkRecord(0, 'viewer.fitToView')), false);
  assert.equal(isVerdictCriticalSpyRecord(mkRecord(0, 'viewer.addEventListener')), false);
  assert.equal(isVerdictCriticalSpyRecord(null), false);
});

test('argument summaries are redacted and capped before they can be persisted', () => {
  const rec = createCallRecorder();
  const s = summarizeValue('Bearer TOPSECRET ' + 'z'.repeat(1000), rec.refIdOf);
  assert.equal(s.value.includes('TOPSECRET'), false);
  assert.equal(s.truncated, true);
  assert.ok(Buffer.byteLength(s.value) <= 256);
  assert.equal(s.length > 1000, true);
  const arr = summarizeValue(new Float32Array([1, 2, 3]), rec.refIdOf);
  assert.equal(arr.kind, 'typedarray');
  assert.equal(arr.sha256.length, 64);
});
