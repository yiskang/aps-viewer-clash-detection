import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildManifest, serializeManifest, pathProblem, sha256Hex, MANIFEST_PATH } from './manifest-builder.mjs';
import { loadContract } from './contract-loader.mjs';

const enc = (s) => new TextEncoder().encode(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const has = (r, re) => r.findings.some((x) => re.test(x));

const rawJsonl = enc('{"k":"META"}\n{"k":"END"}\n');
const entries = () => [
  { path: 'raw/target/target.records.jsonl', bytes: rawJsonl, role: 'raw' },
  { path: 'governance/authorization-record.md', bytes: enc('SYNTHETIC RECORD\n'), role: 'raw' },
  { path: 'raw/hash-ledger.jsonl', bytes: enc('{"seq":1}\n'), role: 'raw' },
  { path: 'raw/target/target.trace.json', bytes: enc('[{"k":"META"},{"k":"END"}]'), role: 'raw', inputs: [sha(rawJsonl)] },
  { path: 'derived/verdict.json', bytes: enc('{"v":"INCONCLUSIVE"}'), role: 'derived', inputs: [sha(rawJsonl)] },
];

test('manifest: sorted paths, SHA-256 inventory, byte lengths, schema classes', () => {
  const r = buildManifest(entries());
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
  const m = r.manifest;
  assert.equal(m.manifestSchemaVersion, 1);
  const paths = m.files.map((x) => x.path);
  assert.deepEqual(paths, [...paths].sort());
  const t = m.files.find((x) => x.path === 'raw/target/target.records.jsonl');
  assert.equal(t.sha256, sha(rawJsonl));
  assert.equal(t.bytes, rawJsonl.length);
  assert.equal(t.fileClass, 'raw');
  assert.equal(m.files.find((x) => x.path === 'raw/target/target.trace.json').fileClass, 'rawDerivedByRule');
  assert.equal(m.files.find((x) => x.path === 'derived/verdict.json').fileClass, 'derived');
  assert.equal(m.hashLedgerSha256, sha('{"seq":1}\n'));
  assert.equal(sha256Hex(rawJsonl), sha(rawJsonl));
  // every key is permitted by the committed schema
  const schema = loadContract().manifestSchema;
  for (const k of Object.keys(m)) assert.ok(k in schema.properties || k === 'manifestSchemaVersion', k);
  for (const fe of m.files) for (const k of schema.properties.files.items.required) assert.ok(k in fe, `${fe.path}.${k}`);
  // ledger closure (Part 2 §13.4): every listed file except the ledger carries ledgerSeq; the ledger's digest is hashLedgerSha256
  for (const fe of m.files) assert.equal('ledgerSeq' in fe, fe.path !== 'raw/hash-ledger.jsonl', fe.path);
  assert.deepEqual(schema.properties.files.items.ledgerSeqExceptPaths, ['raw/hash-ledger.jsonl']);
  assert.ok(has(buildManifest(entries().map((e) => ({ ...e, ledgerSeq: e.path === 'raw/hash-ledger.jsonl' ? 9 : undefined }))), /LEDGER_HAS_LEDGERSEQ/));
});

test('manifest: input order does not matter; ledgerSeq follows input order; serialization is canonical', () => {
  const a = buildManifest(entries());
  const rev = entries().reverse().map((e, i) => (e.path === 'raw/hash-ledger.jsonl' ? e : { ...e, ledgerSeq: 5 - i }));
  const b = buildManifest(rev);
  assert.equal(b.ok, true, b.findings.join(';'));
  assert.deepEqual(a.manifest.files.map((x) => x.path), b.manifest.files.map((x) => x.path));
  const s = serializeManifest(a.manifest);
  assert.equal(s.at(-1), 0x7d, 'no trailing newline (contract: canonical JSON, trailingNewline false)');
  assert.ok(!s.includes(0x0a) && !s.includes(0x0d), 'no CR/LF inside canonical form');
  const txt = s.toString('utf8');
  assert.ok(txt.indexOf('"files"') < txt.indexOf('"manifestSchemaVersion"'), 'keys in UTF-16 order');
});

test('manifest: deterministic (call twice, deep-equal and byte-equal; no timestamps)', () => {
  const a = buildManifest(entries()); const b = buildManifest(entries());
  assert.deepEqual(a, b);
  assert.ok(serializeManifest(a.manifest).equals(serializeManifest(b.manifest)));
  assert.equal(sha(serializeManifest(a.manifest)), sha(serializeManifest(b.manifest)));
  assert.ok(!/20\d\d-\d\d-\d\dT|timestamp|committedAt/.test(serializeManifest(a.manifest).toString('utf8')));
});

test('manifest does not mutate its inputs', () => {
  const e = entries(); const before = JSON.stringify(e.map((x) => [x.path, Buffer.from(x.bytes).toString('hex'), x.inputs]));
  buildManifest(e);
  assert.equal(JSON.stringify(e.map((x) => [x.path, Buffer.from(x.bytes).toString('hex'), x.inputs])), before);
});

test('manifest adversarial: path traversal and unsafe paths are rejected', () => {
  for (const p of ['../evil.txt', 'raw/../../x', '/etc/passwd', 'C:/x', 'C:\\x', 'raw\\x', './a', 'a//b', 'a/./b', 'a/', '', '~/x', 'a\0b', '//server/share', 'raw/a\nb']) {
    const r = buildManifest([{ path: p, bytes: enc('x'), role: 'raw' }]);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.equal(r.manifest, null);
    assert.ok(has(r, /PATH_UNSAFE/), JSON.stringify(p));
  }
  assert.equal(pathProblem('raw/ok.txt'), null);
  assert.ok(pathProblem('e\u0301/x') !== null, 'non-NFC refused');
});

test('manifest adversarial: duplicate and case-colliding paths are rejected', () => {
  let r = buildManifest([{ path: 'raw/a', bytes: enc('1'), role: 'raw' }, { path: 'raw/a', bytes: enc('2'), role: 'raw' }]);
  assert.ok(!r.ok && has(r, /PATH_DUPLICATE: raw\/a/));
  r = buildManifest([{ path: 'raw/a', bytes: enc('1'), role: 'raw' }, { path: 'raw/A', bytes: enc('2'), role: 'raw' }]);
  assert.ok(!r.ok && has(r, /PATH_CASE_COLLISION/));
});

test('manifest adversarial: a manifest that lists itself is rejected', () => {
  for (const p of [MANIFEST_PATH, 'sub/MANIFEST.json']) {
    const r = buildManifest([...entries(), { path: p, bytes: enc('{}'), role: 'derived', inputs: [sha(rawJsonl)] }]);
    assert.ok(!r.ok && has(r, /MANIFEST_LISTS_ITSELF/), p);
  }
});

test('manifest: raw-vs-derived separation is enforced', () => {
  let r = buildManifest([{ path: 'derived/x.json', bytes: enc('1'), role: 'raw' }]);
  assert.ok(!r.ok && has(r, /RAW_DERIVED_SEPARATION: derived\/x\.json/));
  r = buildManifest([{ path: 'raw/x.json', bytes: enc('1'), role: 'derived', inputs: ['a'.repeat(64)] }]);
  assert.ok(!r.ok && has(r, /RAW_DERIVED_SEPARATION: raw\/x\.json/));
  r = buildManifest([{ path: 'raw/a', bytes: enc('1'), role: 'raw', inputs: ['a'.repeat(64)] }]);
  assert.ok(!r.ok && has(r, /RAW_FILE_HAS_INPUTS/));
  r = buildManifest([{ path: 'derived/x.json', bytes: enc('1'), role: 'derived' }]);
  assert.ok(!r.ok && has(r, /INPUTS_REQUIRED/));
  r = buildManifest([{ path: 'raw/a', bytes: enc('1'), role: 'raw' }, { path: 'derived/x.json', bytes: enc('1'), role: 'derived', inputs: ['b'.repeat(64)] }]);
  assert.ok(!r.ok && has(r, /INPUT_NOT_IN_INVENTORY/));
  r = buildManifest([{ path: 'raw/a', bytes: enc('1'), role: 'raw', fileClass: 'derived' }]);
  assert.ok(!r.ok);
});

test('manifest: type and role validation', () => {
  assert.ok(has(buildManifest([{ path: 'raw/a', bytes: 'text', role: 'raw' }]), /BYTES_NOT_UINT8ARRAY/));
  assert.ok(has(buildManifest([{ path: 'raw/a', bytes: enc('x'), role: 'other' }]), /ROLE_INVALID/));
  assert.ok(has(buildManifest(null), /ENTRIES_NOT_ARRAY/));
  assert.ok(has(buildManifest([null]), /ENTRY_INVALID/));
  assert.ok(buildManifest([{ path: 'raw/a', bytes: Buffer.from('x'), role: 'raw' }]).ok, 'Buffer accepted');
  assert.ok(buildManifest([]).ok, 'empty inventory is structurally fine');
});

test('manifest: top-level meta is validated against the schema', () => {
  const good = {
    authorizationId: 'g2-diag-synthetic-00000001', attemptId: '12345678-1234-4234-8234-123456789abc', runId: 'run-1',
    bindingSha256: sha('b'), authorizationRecordSha256: sha('r'), terminalVerdict: 'INCONCLUSIVE', terminalCarrierPath: 'TERMINAL-VERDICT.json',
    digests: Object.fromEntries(['repoCommit', 'procedureSha256', 'acceptanceHarnessSha256', 'diagnosticHarnessSha256', 'diagnosticPackageSha256', 'diagnosticSpecSha256', 'targetPlanSha256', 'viewerVersionObserved', 'viewerBundleSha256Observed', 'traceStreamSha256ByRole'].map((k) => [k, 'x'])),
  };
  const tv = enc('{"runVerdict":"INCONCLUSIVE"}');
  const es = [...entries(), { path: 'TERMINAL-VERDICT.json', bytes: tv, role: 'derived', inputs: [sha(rawJsonl)] }];
  const ok = buildManifest(es, { ...good, terminalVerdictSha256: sha(tv) });
  assert.deepEqual(ok.findings, []);
  assert.equal(ok.complete, true);
  assert.equal(ok.manifest.terminalVerdictSha256, sha(tv));
  assert.ok(!('complete' in ok.manifest), 'completeness is not a manifest key');
  const bad = buildManifest(es, { ...good, terminalVerdictSha256: sha('wrong') });
  assert.ok(has(bad, /TERMINAL_VERDICT_DIGEST_MISMATCH/));
  assert.ok(has(buildManifest(es, { ...good }), /META_REQUIRED_MISSING: terminalVerdictSha256/));
  const noCarrier = { ...good, terminalVerdictSha256: sha(tv) }; delete noCarrier.terminalCarrierPath;
  assert.ok(has(buildManifest(es, noCarrier), /META_REQUIRED_MISSING: terminalCarrierPath/), 'terminalCarrierPath is required (Appendix (v))');
  assert.equal(buildManifest(es, noCarrier).complete, false);
  assert.ok(has(buildManifest(es, { ...good, terminalVerdictSha256: sha(tv), runId: 'BAD ID' }), /META_RUN_ID_FORMAT/));
  assert.ok(has(buildManifest(es, { ...good, terminalVerdictSha256: sha(tv), terminalVerdict: 'MAYBE' }), /META_TERMINAL_VERDICT_INVALID/));
  assert.deepEqual(buildManifest(es, { ...good, terminalVerdictSha256: sha(tv), terminalVerdict: 'WITHHELD' }).findings, [], 'a withheld verdict is representable (L-6)');
  assert.ok(has(buildManifest(es, { ...good, terminalVerdictSha256: sha(tv), files: [] }), /META_OVERRIDES_RESERVED_KEY: files/));
  assert.ok(has(buildManifest(es, { ...good, terminalVerdictSha256: sha(tv), hashLedgerSha256: sha('nope') }), /HASH_LEDGER_DIGEST_MISMATCH/));
});

test('manifest: failure never returns a partial manifest; findings sorted', () => {
  const r = buildManifest([{ path: '../a', bytes: enc('x'), role: 'raw' }, { path: 'z', bytes: 'q', role: 'raw' }, { path: 'raw/a', bytes: enc('1'), role: 'raw' }, { path: 'raw/a', bytes: enc('1'), role: 'raw' }]);
  assert.equal(r.ok, false); assert.equal(r.manifest, null);
  assert.deepEqual(r.findings, [...r.findings].sort());
});

// ---------------------------------------------------------------- terminal carrier (Appendix (v) terminalCarrierPath; Part 2 §13.7)
const metaFor = (extra) => ({
  authorizationId: 'g2-diag-synthetic-00000001', attemptId: '12345678-1234-4234-8234-123456789abc', runId: 'run-1',
  bindingSha256: sha('b'), authorizationRecordSha256: sha('r'),
  digests: Object.fromEntries(['repoCommit', 'procedureSha256', 'acceptanceHarnessSha256', 'diagnosticHarnessSha256', 'diagnosticPackageSha256', 'diagnosticSpecSha256', 'targetPlanSha256', 'viewerVersionObserved', 'viewerBundleSha256Observed', 'traceStreamSha256ByRole'].map((k) => [k, 'x'])),
  ...extra,
});
const rawOnly = () => entries().filter((e) => !e.path.startsWith('derived/'));
const closeoutBytes = enc('{"kind":"SC-C03-CLOSEOUT"}');
const closeoutEntry = () => ({ path: 'SC-C03-CLOSEOUT.json', bytes: closeoutBytes, role: 'derived', inputs: [sha(rawJsonl)] });
const tvBytes = enc('{"runVerdict":"INCONCLUSIVE"}');
const tvEntry = () => ({ path: 'TERMINAL-VERDICT.json', bytes: tvBytes, role: 'derived', inputs: [sha(rawJsonl)] });

test('manifest terminal carrier: SC-C03-CLOSEOUT.json is a terminal-class P5 file that needs inputs', () => {
  const r = buildManifest([...rawOnly(), closeoutEntry()], metaFor({ terminalVerdict: 'WITHHELD', terminalCarrierPath: 'SC-C03-CLOSEOUT.json', terminalVerdictSha256: sha(closeoutBytes) }));
  assert.deepEqual(r.findings, []);
  assert.equal(r.complete, true);
  const e = r.manifest.files.find((x) => x.path === 'SC-C03-CLOSEOUT.json');
  assert.equal(e.fileClass, 'terminal'); assert.equal(e.phase, 'P5'); assert.deepEqual(e.inputs, [sha(rawJsonl)]);
  assert.equal(r.manifest.terminalCarrierPath, 'SC-C03-CLOSEOUT.json');
  assert.ok(has(buildManifest([...rawOnly(), { ...closeoutEntry(), inputs: undefined }]), /INPUTS_REQUIRED: SC-C03-CLOSEOUT\.json/));
  assert.ok(!r.manifest.files.some((x) => x.path.startsWith('derived/')));
});

test('manifest terminal carrier: invalid / missing / ambiguous carrier combinations fail closed', () => {
  const good = (extra) => metaFor({ terminalVerdict: 'WITHHELD', terminalCarrierPath: 'SC-C03-CLOSEOUT.json', terminalVerdictSha256: sha(closeoutBytes), ...extra });
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry()], good({ terminalCarrierPath: 'derived/x.json' })), /TERMINAL_CARRIER_PATH_INVALID/));
  assert.ok(has(buildManifest(rawOnly(), good()), /TERMINAL_CARRIER_MISSING/));
  // both carriers listed
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry(), tvEntry()], good()), /TERMINAL_CARRIER_AMBIGUOUS/));
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry(), tvEntry()], good({ terminalCarrierPath: 'TERMINAL-VERDICT.json', terminalVerdict: 'INCONCLUSIVE', terminalVerdictSha256: sha(tvBytes) })), /TERMINAL_VERDICT_WITH_CLOSEOUT/));
  // closeout carrier but terminalVerdict not WITHHELD
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry()], good({ terminalVerdict: 'INCONCLUSIVE' })), /CLOSEOUT_REQUIRES_WITHHELD/));
  // closeout carrier with a derived/ entry
  assert.ok(has(buildManifest([...entries(), closeoutEntry()], good()), /CLOSEOUT_WITH_DERIVED/));
  // closeout carrier but TERMINAL-VERDICT.json listed
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry(), tvEntry()], good()), /TERMINAL_CARRIER_AMBIGUOUS/));
  // terminalVerdictSha256 must be the digest of the file AT terminalCarrierPath, not of the other carrier
  assert.ok(has(buildManifest([...rawOnly(), closeoutEntry()], good({ terminalVerdictSha256: sha(tvBytes) })), /TERMINAL_VERDICT_DIGEST_MISMATCH/));
  // declared carrier not the listed one
  assert.ok(has(buildManifest([...rawOnly(), tvEntry()], good({ terminalCarrierPath: 'SC-C03-CLOSEOUT.json' })), /TERMINAL_CARRIER_MISSING: terminalCarrierPath SC-C03-CLOSEOUT\.json/));
  // ordinary carrier: TERMINAL-VERDICT.json + derived/ is fine and needs no closeout
  assert.deepEqual(buildManifest([...entries(), tvEntry()], good({ terminalCarrierPath: 'TERMINAL-VERDICT.json', terminalVerdict: 'INCONCLUSIVE', terminalVerdictSha256: sha(tvBytes) })).findings, []);
});
