// SC-C03 closeout tests (Part 2 §13.7, Appendix (viii)); synthetic analysis outputs only. [SYN] offline research prototype.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadContract } from './contract-loader.mjs';
import { canonicalBytes } from './envelope.mjs';
import { serializeManifest, buildManifest } from './manifest-builder.mjs';
import {
  analysisTable, bundleDigest, compareAnalyses, buildCloseout, validateCloseout, simulateFinalization, syntheticScC03Demo,
  syntheticRawFiles, syntheticAnalyze, syntheticInputs, SYNTHETIC_IDENTITY, ScratchSealedError, FreezeViolation, CLOSEOUT_PATH,
} from './closeout.mjs';

const contract = loadContract();
const shaN = (b) => createHash('sha256').update(b).digest('hex');
const enc = (s) => Buffer.from(s, 'utf8');
const has = (r, re) => r.findings.some((x) => re.test(x));
const EXPECTED_MISMATCH_EVENTS = ['writeA', 'writeB', 'hash', 'compare', 'closeout', 'manifest', 'finalizeTerminalMetadata', 'finalHashes', 'freeze', 'commit'];
const EXPECTED_ORDINARY_EVENTS = ['writeA', 'writeB', 'hash', 'compare', 'publish', 'manifest', 'finalizeTerminalMetadata', 'finalHashes', 'freeze', 'commit'];
const runSim = (extra = {}, an = syntheticAnalyze({ nondeterministic: true })) => simulateFinalization({ ...syntheticInputs(), analyze: an, ...extra }, contract);
// independent bundle digest: SHA-256 of the JSON text of the path-sorted table (keys already in bytes, path, sha256 order)
const indepBundle = (files) => shaN(enc(JSON.stringify(Object.keys(files).sort().map((p) => ({ bytes: files[p].length, path: p, sha256: shaN(files[p]) })))));
const closeoutInput = (fa, fb) => { const b = syntheticInputs(); return { identity: b.identity, filesA: fa, filesB: fb, inputDigests: b.inputDigests, bindingSha256: shaN(enc('b')), targetPlanSha256: b.inputDigests[0] }; };
const mutDoc = (bytes, fn) => { const d = JSON.parse(bytes.toString('utf8')); fn(d); return canonicalBytes(d); };

// ======================================================================== A. identical analyses
test('A: identical A/B compare equal, the ordinary promotion path publishes derived/* + TERMINAL-VERDICT.json, and no closeout exists', () => {
  const r = runSim({}, syntheticAnalyze({ nondeterministic: false }));
  assert.deepEqual(r.findings, []); assert.deepEqual(r.violations, []);
  assert.equal(r.path, 'ORDINARY');
  assert.deepEqual(r.events, EXPECTED_ORDINARY_EVENTS);
  assert.ok('TERMINAL-VERDICT.json' in r.runRootFiles && 'derived/verdict.json' in r.runRootFiles);
  assert.ok(!(CLOSEOUT_PATH in r.runRootFiles) && r.closeout === undefined && r.closeoutBytes === undefined);
  assert.equal(r.commitRecord.terminalCarrierPath, 'TERMINAL-VERDICT.json');
  assert.equal(r.commitRecord.terminalVerdict, 'INCONCLUSIVE');
  assert.equal(r.manifest.terminalCarrierPath, 'TERMINAL-VERDICT.json');
  assert.equal(r.manifest.terminalVerdictSha256, shaN(r.runRootFiles['TERMINAL-VERDICT.json']));
  assert.equal(r.ledger.at(-1).path, 'TERMINAL-VERDICT.json', 'TERMINAL-VERDICT.json is the last ledger line');
  assert.deepEqual(r.terminalState, { terminalVerdict: 'INCONCLUSIVE', journal: 'CLOSEOUT_STARTED', failClosed: false });
  assert.equal(r.promotion.eligible, true);
});

test('A: buildCloseout refuses identical analyses (no closeout for identical analyses) and validateCloseout rejects identical bundles', () => {
  const f = { 'derived/a.json': enc('1'), 'TERMINAL-VERDICT.json': enc('2') };
  const r = buildCloseout(closeoutInput(f, { ...f }), contract);
  assert.equal(r.ok, false); assert.equal(r.closeout, null); assert.equal(r.bytes, null);
  assert.ok(has(r, /CLOSEOUT_REFUSED_IDENTICAL_ANALYSES/));
  const good = buildCloseout(closeoutInput(f, { ...f, 'derived/a.json': enc('3') }), contract);
  const forged = mutDoc(good.bytes, (d) => { d.analysisB = JSON.parse(JSON.stringify(d.analysisA)); });
  assert.ok(has(validateCloseout(forged, {}, contract), /CLOSEOUT_IDENTICAL_BUNDLES/));
  assert.equal(compareAnalyses(analysisTable(f), analysisTable({ ...f })).identical, true);
});

// ======================================================================== B. A/B differ
test('B: mismatch keeps A and B byte-unchanged, emits the closeout, blocks promotion, and the manifest/commit record carry WITHHELD', () => {
  const rawA = []; const rawB = [];
  const an = (raw, { pass }) => { const o = syntheticAnalyze({ nondeterministic: true })(raw, { pass }); (pass === 'A' ? rawA : rawB).push(o); return o; };
  const r = runSim({}, an);
  assert.deepEqual(r.findings, []); assert.deepEqual(r.violations, []);
  assert.deepEqual(r.events, EXPECTED_MISMATCH_EVENTS, 'ordering of §13.7');
  assert.equal(r.path, 'SC-C03');
  // A and B bytes are exactly what the analysis produced (never rewritten or annotated), and the closeout hashes match an independent recompute
  assert.deepEqual(Object.keys(r.scratch.A).sort(), Object.keys(rawA[0]).sort());
  for (const p of Object.keys(rawA[0])) assert.ok(Buffer.from(rawA[0][p]).equals(r.scratch.A[p]), `A ${p}`);
  for (const p of Object.keys(rawB[0])) assert.ok(Buffer.from(rawB[0][p]).equals(r.scratch.B[p]), `B ${p}`);
  assert.equal(r.abUnchanged, true);
  assert.equal(r.closeout.analysisA.bundleSha256, indepBundle(rawA[0]));
  assert.equal(r.closeout.analysisB.bundleSha256, indepBundle(rawB[0]));
  assert.notEqual(r.closeout.analysisA.bundleSha256, r.closeout.analysisB.bundleSha256);
  for (const [side, files] of [['analysisA', rawA[0]], ['analysisB', rawB[0]]]) {
    assert.equal(r.closeout[side].fileCount, Object.keys(files).length);
    assert.equal(r.closeout[side].totalBytes, Object.values(files).reduce((s, b) => s + b.length, 0));
    for (const e of r.closeout[side].files) { assert.equal(e.sha256, shaN(files[e.path])); assert.equal(e.bytes, files[e.path].length); }
  }
  assert.deepEqual(r.closeout.comparison.differing.map((d) => [d.path, d.kind]), [['TERMINAL-VERDICT.json', 'CONTENT'], ['derived/extra.json', 'ONLY_IN_B'], ['derived/verdict.json', 'CONTENT']]);
  const extra = r.closeout.comparison.differing.find((d) => d.kind === 'ONLY_IN_B');
  assert.equal(extra.sha256A, null); assert.equal(extra.bytesA, null);
  // promotion blocked: no derived/*, no TERMINAL-VERDICT.json in the run root
  assert.ok(!Object.keys(r.runRootFiles).some((p) => p.startsWith('derived/') || p === 'TERMINAL-VERDICT.json'));
  assert.equal(r.promotion.eligible, false); assert.equal(r.closeout.promotion.promotedAnalysis, null); assert.equal(r.closeout.promotion.authoritativeAnalysis, null);
  assert.deepEqual(r.closeout.attempt, { attemptConsumed: true, ownerDecisionRequired: true, retryAuthorized: false });
  // manifest complete and bound to the closeout; ledger's last line is the closeout
  assert.equal(r.manifest.terminalCarrierPath, CLOSEOUT_PATH);
  assert.equal(r.manifest.terminalVerdict, 'WITHHELD');
  assert.equal(r.manifest.terminalVerdictSha256, shaN(r.runRootFiles[CLOSEOUT_PATH]));
  const ce = r.manifest.files.find((x) => x.path === CLOSEOUT_PATH);
  assert.equal(ce.fileClass, 'terminal'); assert.equal(ce.phase, 'P5');
  assert.equal(ce.ledgerSeq, r.ledger.at(-1).seq); assert.equal(r.ledger.at(-1).path, CLOSEOUT_PATH);
  assert.ok(Buffer.from(serializeManifest(r.manifest)).equals(canonicalBytes(r.manifest)), 'builder serialization equals the D2 canonicalizer');
  assert.equal(r.manifest.hashLedgerSha256, shaN(r.runRootFiles['raw/hash-ledger.jsonl']));
  // commit record and terminal state
  assert.equal(r.commitRecord.terminalVerdict, 'WITHHELD');
  assert.equal(r.commitRecord.terminalCarrierPath, CLOSEOUT_PATH);
  assert.equal(r.commitRecord.terminalVerdictSha256, shaN(r.closeoutBytes));
  assert.equal(r.commitRecord.manifestSha256, shaN(r.runRootFiles['MANIFEST.json']));
  assert.deepEqual(r.terminalState, { terminalVerdict: 'WITHHELD', journal: 'CLOSEOUT_STARTED', failClosed: true });
  assert.equal(r.closeout.terminalVerdict, 'WITHHELD');
  assert.equal(validateCloseout(r.closeoutBytes, { filesA: r.scratch.A, filesB: r.scratch.B }, contract).ok, true);
});

test('B: the closeout is generated before any freeze, and nothing is written after the freeze', () => {
  const r = runSim({ hooks: { afterFreeze: (s) => {
    assert.throws(() => s.writeRunRoot('late.json', enc('x')), FreezeViolation);
    assert.throws(() => s.appendLedger('late.json', enc('x'), 'P5'), FreezeViolation);
    assert.throws(() => s.A.write('late.json', enc('x')), ScratchSealedError);
    assert.throws(() => s.B.write('late.json', enc('x')), ScratchSealedError);
  } } });
  assert.ok(r.events.indexOf('closeout') < r.events.indexOf('freeze'));
  assert.ok(r.events.indexOf('closeout') < r.events.indexOf('manifest'));
  assert.equal(r.events.at(-1), 'commit'); assert.equal(r.events.indexOf('freeze'), r.events.length - 2);
  assert.equal(r.violations.length, 2, 'both attempted run-root writes were recorded as violations');
  assert.ok(!('late.json' in r.runRootFiles));
  assert.equal(r.abUnchanged, true);
  // scratch is read-only from the moment it is hashed: P5.07 is the last time A and B are written
  assert.equal(r.commitRecord.terminalVerdict, 'WITHHELD');
});

test('B: mutating the buffers handed to or returned by the simulator cannot change retained A/B or the closeout', () => {
  const held = [];
  const an = (raw, { pass }) => { const o = syntheticAnalyze({ nondeterministic: true })(raw, { pass }); held.push(o); raw['governance/target-plan.json'][0] ^= 0xff; return o; };
  const r = runSim({}, an);
  assert.deepEqual(r.findings, [], 'analysis mutating its raw copy does not touch the frozen raw files');
  const before = JSON.stringify([r.closeoutBytes.toString('hex'), r.manifestSha256, r.commitRecord]);
  for (const o of held) for (const b of Object.values(o)) b[0] ^= 0xff; // the analysis keeps writing into the arrays it returned
  for (const side of [r.scratch.A, r.scratch.B]) for (const b of Object.values(side)) b[0] ^= 0xff; // and so does the caller of the result
  const r2 = runSim();
  assert.equal(JSON.stringify([r2.closeoutBytes.toString('hex'), r2.manifestSha256, r2.commitRecord]), before);
  assert.equal(r.abUnchanged, true);
});

// ======================================================================== C. mutation detection
const mutations = {
  'flip a byte in A': (s) => { s.A._unsafeInternals().get('derived/verdict.json')[0] ^= 1; },
  'flip a byte in B': (s) => { s.B._unsafeInternals().get('derived/verdict.json')[0] ^= 1; },
  'add a file to A': (s) => { s.A._unsafeInternals().set('derived/new.json', Buffer.from('{}')); },
  'add a file to B': (s) => { s.B._unsafeInternals().set('derived/new.json', Buffer.from('{}')); },
  'remove a file from A': (s) => { s.A._unsafeInternals().delete('derived/integrity.T.json'); },
  'remove a file from B': (s) => { s.B._unsafeInternals().delete('derived/extra.json'); },
  'change the path of a file in A': (s) => { const m = s.A._unsafeInternals(); m.set('derived/renamed.json', m.get('derived/integrity.T.json')); m.delete('derived/integrity.T.json'); },
  'change the path of a file in B': (s) => { const m = s.B._unsafeInternals(); m.set('derived/renamed.json', m.get('derived/extra.json')); m.delete('derived/extra.json'); },
};
for (const [name, mut] of Object.entries(mutations)) {
  test(`C: post-comparison mutation (${name}) fails the P5.10 recompute closed: INVALID commit record, journal FAILED`, () => {
    const r = runSim({ hooks: { afterCompare: mut } });
    assert.ok(has(r, /CLOSEOUT_RECOMPUTE_MISMATCH/), r.findings.join(' | '));
    assert.equal(r.commitRecord.terminalVerdict, 'INVALID');
    assert.equal(r.terminalState.journal, 'FAILED'); assert.equal(r.terminalState.failClosed, true);
    assert.deepEqual(r.events, EXPECTED_MISMATCH_EVENTS, 'the run still freezes and commits (INVALID is authoritative over the carrier)');
    assert.equal(r.abUnchanged, false);
  });
}

test('C: mutation made after the closeout was written (before P5.10) is also detected; so is a mutation that makes A equal B', () => {
  let r = runSim({ hooks: { afterCloseout: (s) => { s.A._unsafeInternals().get('derived/verdict.json')[1] ^= 1; } } });
  assert.ok(has(r, /CLOSEOUT_RECOMPUTE_MISMATCH/)); assert.equal(r.commitRecord.terminalVerdict, 'INVALID');
  r = runSim({ hooks: { afterCompare: (s) => { // make B equal to A byte for byte
    const a = s.A._unsafeInternals(); const b = s.B._unsafeInternals(); b.clear(); for (const [p, v] of a) b.set(p, Buffer.from(v));
  } } });
  assert.ok(has(r, /CLOSEOUT_RECOMPUTE_MISMATCH.*refused/)); assert.equal(r.commitRecord.terminalVerdict, 'INVALID');
});

test('C: validateCloseout directly: any change of retained A or B bytes yields CLOSEOUT_RECOMPUTE_MISMATCH', () => {
  const fa = { 'a.json': enc('one'), 'b.json': enc('two') }; const fb = { 'a.json': enc('one'), 'b.json': enc('TWO') };
  const b = closeoutInput(fa, fb); const c = buildCloseout(b, contract);
  assert.equal(c.ok, true, c.findings.join(';'));
  assert.deepEqual(validateCloseout(c.bytes, b, contract).findings, []);
  const flip = { ...fa, 'a.json': enc('onf') };
  assert.ok(has(validateCloseout(c.bytes, { ...b, filesA: flip }, contract), /CLOSEOUT_RECOMPUTE_MISMATCH/));
  assert.ok(has(validateCloseout(c.bytes, { ...b, filesB: { ...fb, 'c.json': enc('x') } }, contract), /CLOSEOUT_RECOMPUTE_MISMATCH/));
  const { 'a.json': _drop, ...rest } = fa;
  assert.ok(has(validateCloseout(c.bytes, { ...b, filesA: rest }, contract), /CLOSEOUT_RECOMPUTE_MISMATCH/));
  assert.ok(has(validateCloseout(c.bytes, { ...b, filesA: { 'z.json': fa['a.json'], 'b.json': fa['b.json'] } }, contract), /CLOSEOUT_RECOMPUTE_MISMATCH/));
  assert.ok(has(validateCloseout(c.bytes, { ...b, inputDigests: [shaN(enc('other'))] }, contract), /CLOSEOUT_RECOMPUTE_MISMATCH/), 'binding the recompute to different raw inputs');
  assert.equal(validateCloseout(c.bytes, {}, contract).recomputed, false);
});

test('C: structural tampering of the closeout bytes is detected by validateCloseout', () => {
  const r = runSim(); const cb = r.closeoutBytes;
  assert.ok(has(validateCloseout(Buffer.concat([cb, enc('\n')]), {}, contract), /CLOSEOUT_NOT_CANONICAL/), 'trailing newline');
  assert.ok(has(validateCloseout(enc(JSON.stringify(JSON.parse(cb.toString('utf8')), null, 2)), {}, contract), /CLOSEOUT_NOT_CANONICAL/), 'pretty-printed');
  assert.ok(has(validateCloseout(enc('not json'), {}, contract), /CLOSEOUT_NOT_JSON/));
  assert.ok(has(validateCloseout('str', {}, contract), /CLOSEOUT_NOT_BYTES/));
  const cases = [
    [(d) => { d.terminalVerdict = 'REJECTED'; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: terminalVerdict/],
    [(d) => { d.verdictWithheld = false; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: verdictWithheld/],
    [(d) => { d.withheldBy = 'SC-C04'; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: withheldBy/],
    [(d) => { d.promotion.eligible = true; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: promotion/],
    [(d) => { d.promotion.promotedAnalysis = 'A'; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: promotion/],
    [(d) => { d.attempt.retryAuthorized = true; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: attempt/],
    [(d) => { d.historicalStatus.c8 = 'RESOLVED'; }, /CLOSEOUT_FIXED_FIELD_MISMATCH: historicalStatus/],
    [(d) => { delete d.comparison; }, /CLOSEOUT_REQUIRED_MISSING: comparison/],
    [(d) => { d.extra = 1; }, /CLOSEOUT_UNKNOWN_KEY: extra/],
    [(d) => { d.timestamp = 'x'; }, /CLOSEOUT_UNKNOWN_KEY: timestamp/],
    [(d) => { d.comparison.differingCount += 1; }, /CLOSEOUT_DIFFERINGCOUNT_MISMATCH/],
    [(d) => { d.comparison.differing.pop(); d.comparison.differingCount -= 1; }, /CLOSEOUT_COMPARISON_NOT_TABLE_DERIVED/],
    [(d) => { d.analysisA.bundleSha256 = 'f'.repeat(64); }, /CLOSEOUT_BUNDLE_DIGEST_MISMATCH: analysisA/],
    [(d) => { d.analysisB.fileCount += 1; }, /CLOSEOUT_FILECOUNT_MISMATCH: analysisB/],
    [(d) => { d.analysisA.totalBytes += 1; }, /CLOSEOUT_TOTALBYTES_MISMATCH: analysisA/],
    [(d) => { d.analysisA.files.reverse(); }, /CLOSEOUT_ANALYSIS_FILES_NOT_SORTED: analysisA/],
    [(d) => { d.runId = 'BAD ID'; }, /CLOSEOUT_IDENTITY_FORMAT: runId/],
    [(d) => { d.inputDigests = []; }, /CLOSEOUT_INPUT_DIGESTS_INVALID/],
    [(d) => { d.targetPlanSha256 = 'e'.repeat(64); }, /CLOSEOUT_TARGET_PLAN_NOT_IN_INPUTS/],
  ];
  for (const [fn, re] of cases) assert.ok(has(validateCloseout(mutDoc(cb, fn), {}, contract), re), String(re));
});

test('C: tampering with the closeout file, manifest, ledger or file set in the run root is caught by P5.10 (INVALID commit record)', () => {
  const tamper = {
    'closeout bytes': { hook: 'afterCloseout', fn: (s) => { s.runRoot.get(CLOSEOUT_PATH)[3] ^= 1; }, re: /MANIFEST_FILE_DIGEST_MISMATCH|CLOSEOUT_NOT|LEDGER_LINE_FILE_MISMATCH|TERMINAL_VERDICT_DIGEST/ },
    'closeout replaced by another valid-looking document': { hook: 'afterManifestWrite', fn: (s) => { s.runRoot.set(CLOSEOUT_PATH, mutDoc(s.runRoot.get(CLOSEOUT_PATH), (d) => { d.runId = 'other'; })); }, re: /MANIFEST_FILE_DIGEST_MISMATCH: SC-C03-CLOSEOUT\.json/ },
    'manifest bytes': { hook: 'afterManifestWrite', fn: (s) => { const m = JSON.parse(s.runRoot.get('MANIFEST.json').toString('utf8')); m.terminalVerdict = 'SUPPORTED'; s.runRoot.set('MANIFEST.json', canonicalBytes(m)); }, re: /CLOSEOUT_REQUIRES_WITHHELD/ },
    'manifest digest of a file': { hook: 'afterManifestWrite', fn: (s) => { const m = JSON.parse(s.runRoot.get('MANIFEST.json').toString('utf8')); m.files[0].sha256 = 'a'.repeat(64); s.runRoot.set('MANIFEST.json', canonicalBytes(m)); }, re: /MANIFEST_FILE_DIGEST_MISMATCH/ },
    'manifest not canonical': { hook: 'afterManifestWrite', fn: (s) => { s.runRoot.set('MANIFEST.json', Buffer.concat([s.runRoot.get('MANIFEST.json'), enc('\n')])); }, re: /MANIFEST_NOT_CANONICAL|MANIFEST_NOT_JSON/ },
    'ledger line altered': { hook: 'afterManifestWrite', fn: (s) => { s.runRoot.get('raw/hash-ledger.jsonl')[10] ^= 1; }, re: /LEDGER_DIGEST_MISMATCH|LEDGER_/ },
    'ledger truncated (closeout line removed)': { hook: 'afterManifestWrite', fn: (s) => { const t = s.runRoot.get('raw/hash-ledger.jsonl').toString('utf8').trimEnd().split('\n'); t.pop(); s.runRoot.set('raw/hash-ledger.jsonl', enc(t.join('\n') + '\n')); }, re: /LEDGER_DIGEST_MISMATCH/ },
    'a derived file smuggled into the run root': { hook: 'afterCloseout', fn: (s) => { s.runRoot.set('derived/verdict.json', enc('{}')); }, re: /CLOSEOUT_WITH_DERIVED_OR_TERMINAL_VERDICT|MANIFEST_BUILD/ },
    'TERMINAL-VERDICT.json smuggled next to the closeout': { hook: 'afterCloseout', fn: (s) => { s.runRoot.set('TERMINAL-VERDICT.json', enc('{}')); }, re: /TERMINAL_CARRIER_AMBIGUOUS|MANIFEST_BUILD/ },
    'a raw file changed': { hook: 'afterManifestWrite', fn: (s) => { s.runRoot.get('raw/teardown.json')[2] ^= 1; }, re: /MANIFEST_FILE_DIGEST_MISMATCH: raw\/teardown\.json/ },
    'an unlisted file added': { hook: 'afterManifestWrite', fn: (s) => { s.runRoot.set('raw/unlisted.json', enc('{}')); }, re: /MANIFEST_FILE_SET_MISMATCH/ },
  };
  for (const [name, t] of Object.entries(tamper)) {
    const r = runSim({ hooks: { [t.hook]: t.fn } });
    assert.ok(has(r, t.re), `${name}: ${r.findings.join(' | ')}`);
    assert.equal(r.commitRecord.terminalVerdict, 'INVALID', name);
    assert.equal(r.terminalState.journal, 'FAILED', name);
  }
});

test('C: on every P5.10 failure path the INVALID commit record binds the manifest bytes actually frozen (review H: no stale manifestSha256)', () => {
  const hooks = {
    'manifest not canonical': { afterManifestWrite: (s) => { s.runRoot.set('MANIFEST.json', Buffer.concat([s.runRoot.get('MANIFEST.json'), enc('\n')])); } },
    'manifest field changed': { afterManifestWrite: (s) => { const m = JSON.parse(s.runRoot.get('MANIFEST.json').toString('utf8')); m.terminalVerdict = 'SUPPORTED'; s.runRoot.set('MANIFEST.json', canonicalBytes(m)); } },
    'A mutated after compare': { afterCompare: (s) => { s.A._unsafeInternals().values().next().value[0] ^= 1; } },
  };
  for (const [name, h] of Object.entries(hooks)) {
    const r = runSim({ hooks: h });
    assert.equal(r.commitRecord.terminalVerdict, 'INVALID', name);
    assert.equal(r.commitRecord.manifestSha256, shaN(r.runRootFiles['MANIFEST.json']), name);
  }
});

test('C: ordinary path - a mutation of A after the comparison is detected (published bytes differ from the compared bytes)', () => {
  const r = runSim({ hooks: { afterCompare: (s) => { s.A._unsafeInternals().get('derived/verdict.json')[0] ^= 1; } } }, syntheticAnalyze({ nondeterministic: false }));
  assert.ok(has(r, /PUBLISHED_DIFFERS_FROM_COMPARED: derived\/verdict\.json/));
  assert.equal(r.commitRecord.terminalVerdict, 'INVALID');
});

// ======================================================================== D. determinism
test('D: repeating the same mismatch three times with fresh simulators gives byte-identical closeout, manifest, ledger and commit record', () => {
  const runs = [0, 1, 2].map(() => runSim());
  for (const r of runs.slice(1)) {
    assert.ok(r.closeoutBytes.equals(runs[0].closeoutBytes));
    assert.ok(Buffer.from(serializeManifest(r.manifest)).equals(Buffer.from(serializeManifest(runs[0].manifest))));
    assert.ok(r.runRootFiles['raw/hash-ledger.jsonl'].equals(runs[0].runRootFiles['raw/hash-ledger.jsonl']));
    assert.deepEqual(r.commitRecord, runs[0].commitRecord);
    assert.ok(r.commitRecordBytes.equals(runs[0].commitRecordBytes));
    assert.deepEqual(r.events, runs[0].events);
    assert.deepEqual(r.eventDetail, runs[0].eventDetail);
  }
  const d1 = syntheticScC03Demo(contract); const d2 = syntheticScC03Demo(contract);
  assert.equal(JSON.stringify(d1.summary), JSON.stringify(d2.summary));
  assert.ok(d1.closeoutBytes.equals(d2.closeoutBytes));
});

test('D: the closeout contains no timestamp, no absolute path, no evaluator output, and nothing from file content other than hashes and lengths', () => {
  const r = runSim({}, syntheticAnalyze({ nondeterministic: true, withheldFlagInside: true }));
  const text = r.closeoutBytes.toString('utf8');
  assert.ok(!/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text), 'no ISO timestamp');
  assert.ok(!/(^|[":,\[])\/(Users|private|tmp|var|home|etc)\//.test(text) && !/[A-Za-z]:\\/.test(text), 'no absolute path');
  assert.ok(!/timestamp|committedAt|at":|Date/i.test(text));
  assert.ok(!/runVerdict|REJECTED|INCONCLUSIVE|SUPPORTED/.test(text), 'no evaluator output (neither analysis verdict leaks)');
  assert.ok(!text.includes('\n') && text.at(-1) === '}');
  // swapping CONTENT while keeping hashes/lengths impossible; but identical tables give identical closeout regardless of how files were produced
  const again = buildCloseout({ identity: r.closeout, filesA: r.scratch.A, filesB: r.scratch.B, inputDigests: r.closeout.inputDigests, bindingSha256: r.closeout.bindingSha256, targetPlanSha256: r.closeout.targetPlanSha256 }, contract);
  assert.ok(again.bytes.equals(r.closeoutBytes));
  assert.equal(r.commitRecord.committedAt, null, 'the simulation records no timestamp');
});

// ======================================================================== E. bounds
const hexPath = (prefix, i) => `${prefix}${i.toString(16).padStart(4, '0')}`.padEnd(128, 'a');
test('E: worst case (128 files per analysis, 128-byte paths, all differing) fits in maxBytes with no truncation', () => {
  const fa = {}; const fb = {};
  for (let i = 0; i < 128; i += 1) { fa[hexPath('a/', i)] = enc(`A${i}`); fb[hexPath('b/', i)] = enc(`B${i}`); }
  const r = buildCloseout(closeoutInput(fa, fb), contract);
  assert.equal(r.ok, true, r.findings.join(';'));
  assert.equal(r.closeout.comparison.differingCount, 256); assert.equal(r.closeout.comparison.differing.length, 256);
  assert.equal(r.closeout.analysisA.fileCount, 128); assert.equal(r.closeout.analysisA.files.length, 128);
  assert.ok(r.bytes.length <= 262144, `${r.bytes.length}`);
  assert.ok(Object.keys(fa).every((p) => Buffer.byteLength(p) === 128));
  assert.deepEqual(validateCloseout(r.bytes, { filesA: fa, filesB: fb, ...closeoutInput(fa, fb) }, contract).findings, []);
  // same paths, 128 differing CONTENT entries
  const fc = Object.fromEntries(Object.keys(fa).map((p) => [p, enc('different')]));
  const r2 = buildCloseout(closeoutInput(fa, fc), contract);
  assert.equal(r2.ok, true); assert.equal(r2.closeout.comparison.differingCount, 128); assert.ok(r2.bytes.length <= 262144);
});

test('E: 129 files, an over-long path, unsafe paths, and a closeout larger than maxBytes are refused with findings (never truncated)', () => {
  const many = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`f/${i}`, enc(String(i))]));
  let r = buildCloseout(closeoutInput(many, { 'x': enc('1') }), contract);
  assert.ok(!r.ok && has(r, /A:ANALYSIS_FILE_COUNT_EXCEEDED: 129 > 128/)); assert.equal(r.closeout, null);
  r = buildCloseout(closeoutInput({ x: enc('1') }, many), contract);
  assert.ok(!r.ok && has(r, /B:ANALYSIS_FILE_COUNT_EXCEEDED/));
  r = buildCloseout(closeoutInput({ ['p'.repeat(129)]: enc('1') }, { x: enc('1') }), contract);
  assert.ok(!r.ok && has(r, /ANALYSIS_PATH_TOO_LONG: 129 bytes/));
  assert.equal(analysisTable({ ['p'.repeat(128)]: enc('1') }).length, 1, '128 bytes is allowed');
  assert.ok(has(buildCloseout(closeoutInput({ ['é'.repeat(65)]: enc('1') }, { x: enc('1') }), contract), /ANALYSIS_PATH_TOO_LONG: 130 bytes/), 'UTF-8 bytes, not characters');
  for (const bad of ['../x', '/abs', 'a//b', 'a\\b', '']) assert.ok(has(buildCloseout(closeoutInput({ [bad]: enc('1') }, { x: enc('1') }), contract), /ANALYSIS_PATH_UNSAFE/), bad);
  assert.ok(has(buildCloseout(closeoutInput({ x: 'text' }, { x: enc('1') }), contract), /ANALYSIS_BYTES_NOT_UINT8ARRAY/));
  // an artificially tightened bound (contract copy) refuses rather than truncating
  const tight = structuredClone(contract); tight.closeoutSchema.bounds.maxBytes = 500;
  r = buildCloseout(closeoutInput({ x: enc('1') }, { x: enc('2') }), tight);
  assert.ok(!r.ok && has(r, /CLOSEOUT_TOO_LARGE/));
  const tight2 = structuredClone(contract); tight2.closeoutSchema.bounds.maxDifferingEntries = 1;
  r = buildCloseout(closeoutInput({ x: enc('1'), y: enc('1') }, { x: enc('2'), y: enc('2') }), tight2);
  assert.ok(!r.ok && has(r, /CLOSEOUT_DIFFERING_EXCEEDED: 2 > 1/));
  // the simulator aborts (class b harness defect) instead of publishing a truncated closeout
  const sim = simulateFinalization({ ...syntheticInputs(), analyze: (raw, { pass }) => Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`f/${i}`, enc(pass + i)])) }, contract);
  assert.ok(has(sim, /ANALYSIS_FILE_COUNT_EXCEEDED/)); assert.equal(sim.commitRecord, null); assert.equal(sim.terminalState.abort, 'SC-B07');
  assert.ok(!(CLOSEOUT_PATH in sim.runRootFiles) && !('MANIFEST.json' in sim.runRootFiles));
});

test('E: malformed identity and inputs are refused; fixed fields come from the schema', () => {
  const ok = closeoutInput({ x: enc('1') }, { x: enc('2') });
  for (const [mut, re] of [
    [(i) => { i.identity.authorizationId = 'X'; }, /CLOSEOUT_IDENTITY_FORMAT: authorizationId/],
    [(i) => { i.identity.attemptId = 'not-a-uuid'; }, /CLOSEOUT_IDENTITY_FORMAT: attemptId/],
    [(i) => { i.identity.runId = ''; }, /CLOSEOUT_IDENTITY_FORMAT: runId/],
    [(i) => { i.inputDigests = []; }, /CLOSEOUT_INPUT_DIGESTS_INVALID/],
    [(i) => { i.bindingSha256 = 'zz'; }, /CLOSEOUT_NOT_HEX64: bindingSha256/],
  ]) { const i = structuredClone({ ...ok, filesA: undefined, filesB: undefined }); i.filesA = ok.filesA; i.filesB = ok.filesB; mut(i); assert.ok(has(buildCloseout(i, contract), re), String(re)); }
  assert.equal(buildCloseout(ok, contract).ok, true);
  assert.ok(has(buildCloseout(null, contract), /ANALYSIS_FILES_NOT_OBJECT/));
});

// ======================================================================== F. spec / contract
test('F: the closeout schema is loaded by the contract loader and the closeout fixed fields equal it', () => {
  const s = contract.closeoutSchema;
  assert.equal(s.closeoutSchemaVersion, 1); assert.equal(s.path, 'SC-C03-CLOSEOUT.json'); assert.equal(s.fileClass, 'terminal');
  assert.deepEqual(s.bounds, { maxBytes: 262144, maxFilesPerAnalysis: 128, maxDifferingEntries: 256, maxPathBytes: 128 });
  const r = runSim(); const d = r.closeout;
  for (const [k, v] of Object.entries(s.fixed)) assert.deepEqual(d[k], v, k);
  assert.deepEqual(d.promotion, s.properties.promotion.fixed); assert.deepEqual(d.attempt, s.properties.attempt.fixed);
  assert.deepEqual(Object.keys(d).sort(), [...s.required].sort(), 'exactly the required keys');
  assert.equal(d.comparison.method, 'PER_FILE_BYTE_EQUALITY'); assert.equal(d.comparison.result, 'MISMATCH');
  assert.equal(d.scope, 'NEW_RUN_ONLY'); assert.equal(d.step, 'P5.07'); assert.equal(d.stopCondition, 'SC-C03');
});

test('F: the SC-C03 stop condition and the manifest schema describe the closeout carrier', () => {
  const sc = contract.stopConditions.stopConditions.find((c) => c.id === 'SC-C03');
  assert.match(sc.effect, /SC-C03-CLOSEOUT\.json/); assert.match(sc.effect, /WITHHELD/); assert.equal(sc.class, 'c'); assert.equal(sc.step, 'P5.07');
  assert.ok(contract.manifestSchema.required.includes('terminalCarrierPath'));
  assert.deepEqual(contract.manifestSchema.properties.terminalCarrierPath.enum, ['TERMINAL-VERDICT.json', 'SC-C03-CLOSEOUT.json']);
});

test('F: SC-C03 takes precedence over SC-C04 - a withheld flag inside A or B does not leak into the closeout, manifest or commit record', () => {
  const r = runSim({}, syntheticAnalyze({ nondeterministic: true, withheldFlagInside: true }));
  assert.equal(r.closeout.withheldBy, 'SC-C03'); assert.equal(r.closeout.stopCondition, 'SC-C03');
  assert.ok(!r.closeoutBytes.toString('utf8').includes('SC-C04'));
  assert.ok(r.scratch.A['TERMINAL-VERDICT.json'].toString('utf8').includes('SC-C04'), 'A keeps its own bytes untouched');
  assert.equal(r.manifest.terminalVerdict, 'WITHHELD'); assert.equal(r.commitRecord.terminalVerdict, 'WITHHELD');
  assert.ok(!('TERMINAL-VERDICT.json' in r.runRootFiles));
  // ordinary path with the SC-C04 flag in the (identical) A and B: WITHHELD via TERMINAL-VERDICT.json, not via the closeout
  const o = runSim({}, syntheticAnalyze({ nondeterministic: false, withheldFlagInside: true }));
  assert.equal(o.commitRecord.terminalVerdict, 'WITHHELD'); assert.equal(o.commitRecord.terminalCarrierPath, 'TERMINAL-VERDICT.json'); assert.equal(o.closeout, undefined);
});

test('F: the synthetic demo agrees with the simulator (used by run-preparation)', () => {
  const d = syntheticScC03Demo(contract);
  assert.deepEqual(d.summary.events, EXPECTED_MISMATCH_EVENTS);
  assert.equal(d.summary.abUnchanged, true); assert.equal(d.summary.promotionBlocked, true); assert.equal(d.summary.closeoutValid, true); assert.equal(d.summary.manifestOkComplete, true);
  assert.deepEqual(d.summary.runRootTerminalFiles, [CLOSEOUT_PATH]);
  assert.deepEqual(d.summary.ordinaryControl.events, EXPECTED_ORDINARY_EVENTS); assert.equal(d.summary.ordinaryControl.closeoutEmitted, false);
  assert.equal(SYNTHETIC_IDENTITY.runId, 'syn-c03');
  assert.deepEqual(Object.keys(syntheticRawFiles()).includes('governance/target-plan.json'), true);
  assert.equal(bundleDigest(analysisTable(d.result.scratch.A)), d.summary.analysisABundleSha256);
});
