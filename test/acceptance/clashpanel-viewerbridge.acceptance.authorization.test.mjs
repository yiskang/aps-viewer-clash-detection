// test/acceptance/clashpanel-viewerbridge.acceptance.authorization.test.mjs
//
// Offline tests for W1 authorization-record validation (procedure §4.1 "Authorization record";
// §4.2 "authorization-record accept/reject matrix (missing/duplicate/mismatched digests,
// superseded, ambiguous candidates, symlink, path escape)"). Uses the harness's recording fake
// filesystem plus a few real-filesystem cases in an os.tmpdir() sandbox. Never imports
// playwright, never calls main().

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import {
  validateAuthorizationRecord,
  parseAuthorizationMarkers,
  normalizeRecordPath,
  createRecordingFakeFs,
  createNodeFsLayer,
  sha256Hex,
  MODEL_A_URN,
  MODEL_B_URN,
  RUNTIME_LINE,
  MARKER_LIVE_LINE,
  PROCEDURE_REL_PATH,
  HARNESS_REL_PATH,
} from './clashpanel-viewerbridge.acceptance.mjs';

const ROOT = '/repo';
const PROC = 'procedure bytes (stand-in for the v5 procedure file)\n';
const HARNESS = 'harness bytes (stand-in for the harness file)\n';
const HEAD = '82dab8244d8d83f3cb824b05199d7a2ce5b0f2e0';

const DEFAULTS = Object.freeze({
  id: 'g2-live-0001',
  head: HEAD,
  proc: sha256Hex(Buffer.from(PROC)),
  harness: sha256Hex(Buffer.from(HARNESS)),
  a: sha256Hex(Buffer.from(MODEL_A_URN)),
  b: sha256Hex(Buffer.from(MODEL_B_URN)),
});

/** Build an authorization record's text. `omit` drops keys; `extra` appends raw lines. */
function recordText(opts = {}) {
  const o = { ...DEFAULTS, supersedes: [], extra: [], omit: [], ...opts };
  const lines = [
    '# G2 live execution authorization (test fixture)',
    '',
    ['G2-LIVE-EXECUTION', MARKER_LIVE_LINE],
    ['Authorization-ID', `Authorization-ID: ${o.id}`],
    ['Baseline-HEAD', `Baseline-HEAD: ${o.head}`],
    ['Procedure-SHA256', `Procedure-SHA256: ${o.proc}`],
    ['Harness-SHA256', `Harness-SHA256: ${o.harness}`],
    ['Model-A-URN-SHA256', `Model-A-URN-SHA256: ${o.a}`],
    ['Model-B-URN-SHA256', `Model-B-URN-SHA256: ${o.b}`],
    ['Runtime', RUNTIME_LINE],
    ...o.supersedes.map((s) => ['Supersedes', `Supersedes: ${s}`]),
  ].filter((l) => !(Array.isArray(l) && o.omit.includes(l[0]))).map((l) => (Array.isArray(l) ? l[1] : l));
  return `${[...lines, ...o.extra].join('\n')}\n`;
}

function setup(files = {}, { procedure = PROC, harness = HARNESS } = {}) {
  const fs = createRecordingFakeFs({
    seedDirs: [`${ROOT}/docs/prompts`, `${ROOT}/docs/research`, `${ROOT}/test/acceptance`],
    seedFiles: {
      [`${ROOT}/${PROCEDURE_REL_PATH}`]: procedure,
      [`${ROOT}/${HARNESS_REL_PATH}`]: harness,
      [`${ROOT}/docs/prompts/for-claude-unrelated.md`]: 'Mentions G2-LIVE-EXECUTION: only mid-line, so not a candidate.\n',
      ...Object.fromEntries(Object.entries(files).map(([rel, c]) => [`${ROOT}/${rel}`, c])),
    },
  });
  return fs;
}

function validate(fs, recordPath, extra = {}) {
  return validateAuthorizationRecord({ recordPath, repoRoot: ROOT, fs, gitHead: () => HEAD, ...extra });
}

const P = 'docs/prompts/g2-live-authorization.md';

// ------------------------------------------------------------------------------------------
// Accept
// ------------------------------------------------------------------------------------------

test('accept: exactly one valid, non-superseded candidate that is the passed record', () => {
  const text = recordText();
  const r = validate(setup({ [P]: text }), P);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.record.id, 'g2-live-0001');
  assert.equal(r.record.sha256, sha256Hex(Buffer.from(text)));
  assert.equal(r.record.path, P);
  assert.deepEqual(r.candidateSet.map((c) => [c.path, c.id, c.superseded]), [[P, 'g2-live-0001', false]]);
  assert.deepEqual(r.digests, { headSha: HEAD, procedureSha256: DEFAULTS.proc, harnessSha256: DEFAULTS.harness, urnASha256: DEFAULTS.a, urnBSha256: DEFAULTS.b });
});

test('accept: CRLF line endings and a nested docs/prompts subdirectory', () => {
  const nested = 'docs/prompts/g2/live/auth.md';
  const fs = setup({});
  fs.__seedDir(`${ROOT}/docs/prompts/g2`);
  fs.__seedDir(`${ROOT}/docs/prompts/g2/live`);
  fs.putFileForTest(`${ROOT}/${nested}`, recordText().replace(/\n/g, '\r\n'));
  assert.equal(validate(fs, nested).ok, true);
});

test('accept: an older record superseded by the passed newer record', () => {
  const fs = setup({
    'docs/prompts/g2-old.md': recordText({ id: 'g2-live-old1' }),
    [P]: recordText({ id: 'g2-live-new1', supersedes: ['g2-live-old1'] }),
  });
  const r = validate(fs, P);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.candidateSet.map((c) => [c.id, c.superseded]).sort(), [['g2-live-new1', false], ['g2-live-old1', true]]);
});

test('accept: a symlinked *.md under docs/prompts is never a candidate (not followed) and is reported', () => {
  const fs = setup({ [P]: recordText() });
  fs.symlinkForTest('/elsewhere/x.md', `${ROOT}/docs/prompts/link.md`);
  const r = validate(fs, P);
  assert.equal(r.ok, true);
  assert.deepEqual(r.nonRegularPromptEntries, ['docs/prompts/link.md']);
});

// ------------------------------------------------------------------------------------------
// Reject: path syntax, symlinks, file type
// ------------------------------------------------------------------------------------------

test('reject: path escape / invalid syntax matrix', () => {
  const fs = setup({ [P]: recordText() });
  const cases = [
    ['', 'record-path-invalid'],
    [null, 'record-path-invalid'],
    [`/repo/${P}`, 'record-path-escape'],
    ['C:\\docs\\prompts\\a.md', 'record-path-invalid'],
    ['docs\\prompts\\a.md', 'record-path-invalid'],
    ['../docs/prompts/g2-live-authorization.md', 'record-path-escape'],
    ['docs/prompts/../prompts/g2-live-authorization.md', 'record-path-escape'],
    ['docs/prompts/../../etc/passwd.md', 'record-path-escape'],
    ['docs/prompts/./g2-live-authorization.md', 'record-path-invalid'],
    ['docs//prompts/g2-live-authorization.md', 'record-path-invalid'],
    ['docs/prompts/', 'record-path-invalid'],
    ['docs/prompts', 'record-path-outside-prompts'],
    ['docs/research/x.md', 'record-path-outside-prompts'],
    ['prompts/x.md', 'record-path-outside-prompts'],
    ['docs/prompts/g2-live-authorization.txt', 'record-path-not-markdown'],
    ['docs/prompts/missing.md', 'record-not-found'],
  ];
  for (const [p, reason] of cases) {
    const r = validate(fs, p);
    assert.equal(r.ok, false, String(p));
    assert.equal(r.reason, reason, `${p}: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(normalizeRecordPath(P).segments, ['docs', 'prompts', 'g2-live-authorization.md']);
});

test('reject: the record itself is a symlink (even to a valid record)', () => {
  const fs = setup({ 'docs/prompts/real.md': recordText() });
  fs.symlinkForTest(`${ROOT}/docs/prompts/real.md`, `${ROOT}/${P}`);
  const r = validate(fs, P);
  assert.equal(r.reason, 'record-path-symlink-component');
});

test('reject: a symlinked directory component on the record path', () => {
  const fs = setup({});
  fs.symlinkForTest(`${ROOT}/docs/research`, `${ROOT}/docs/prompts/sub`);
  assert.equal(validate(fs, 'docs/prompts/sub/x.md').reason, 'record-path-symlink-component');
});

test('reject: record path names a directory, or traverses a regular file', () => {
  const fs = setup({ 'docs/prompts/plain.md': 'not a dir\n' });
  fs.__seedDir(`${ROOT}/docs/prompts/dir.md`);
  assert.equal(validate(fs, 'docs/prompts/dir.md').reason, 'record-not-regular-file');
  assert.equal(validate(fs, 'docs/prompts/plain.md/x.md').reason, 'record-path-invalid');
});

test('reject: invalid UTF-8 record bytes', () => {
  const bytes = Buffer.concat([Buffer.from(recordText()), Buffer.from([0xff, 0xfe, 0x0a])]);
  assert.equal(validate(setup({ [P]: bytes }), P).reason, 'record-not-utf8');
});

// ------------------------------------------------------------------------------------------
// Reject: marker lines (missing / duplicate / malformed)
// ------------------------------------------------------------------------------------------

const REQUIRED = ['G2-LIVE-EXECUTION', 'Authorization-ID', 'Baseline-HEAD', 'Procedure-SHA256', 'Harness-SHA256', 'Model-A-URN-SHA256', 'Model-B-URN-SHA256', 'Runtime'];

test('reject: each required marker missing', () => {
  for (const key of REQUIRED) {
    const r = validate(setup({ [P]: recordText({ omit: [key] }) }), P);
    assert.equal(r.ok, false, key);
    // Missing the live marker means the file is not even a well-formed record.
    assert.equal(r.reason, `record-marker-missing:${key}`, `${key}: ${JSON.stringify(r)}`);
  }
});

test('reject: each required marker duplicated (identical or differing value)', () => {
  const base = recordText();
  for (const key of REQUIRED) {
    const line = base.split('\n').find((l) => l.startsWith(`${key}:`));
    const r = validate(setup({ [P]: `${base}${line}\n` }), P);
    assert.equal(r.reason, `record-marker-duplicate:${key}`, key);
  }
  const r2 = validate(setup({ [P]: recordText({ extra: ['Authorization-ID: g2-live-0002'] }) }), P);
  assert.equal(r2.reason, 'record-marker-duplicate:Authorization-ID');
});

test('reject: malformed marker lines', () => {
  const malformed = [
    ['G2-LIVE-EXECUTION: AUTHORIZED', 'G2-LIVE-EXECUTION'],
    ['G2-LIVE-EXECUTION: AUTHORIZED EXACTLY ONE ATTEMPT ', 'G2-LIVE-EXECUTION'],
    ['Authorization-ID: SHORT', 'Authorization-ID'],
    ['Authorization-ID: abc', 'Authorization-ID'],
    [`Authorization-ID: ${'a'.repeat(65)}`, 'Authorization-ID'],
    ['Authorization-ID: g2_live_0001', 'Authorization-ID'],
    [`Baseline-HEAD: ${HEAD.toUpperCase()}`, 'Baseline-HEAD'],
    [`Baseline-HEAD: ${HEAD.slice(1)}`, 'Baseline-HEAD'],
    [`Procedure-SHA256: ${'g'.repeat(64)}`, 'Procedure-SHA256'],
    [`Harness-SHA256: ${'a'.repeat(63)}`, 'Harness-SHA256'],
    [`Model-A-URN-SHA256: ${DEFAULTS.a} `, 'Model-A-URN-SHA256'],
    ['Model-B-URN-SHA256:', 'Model-B-URN-SHA256'],
    ['Runtime: viewer=7.124.3 env=AutodeskProduction2 api=streamingV2', 'Runtime'],
    ['Runtime: viewer=7.124.2 env=AutodeskProduction api=streamingV2', 'Runtime'],
    ['Supersedes: X', 'Supersedes'],
  ];
  for (const [line, key] of malformed) {
    const text = key === 'Supersedes'
      ? recordText({ extra: [line] })
      : recordText({ omit: [key], extra: [line] });
    const r = validate(setup({ [P]: text }), P);
    assert.equal(r.ok, false, line);
    assert.equal(r.reason, `record-marker-malformed:${key}`, `${line}: ${JSON.stringify(r)}`);
  }
});

test('parseAuthorizationMarkers: indented / list-item markers are not whole lines (=> missing)', () => {
  const text = recordText({ omit: ['Authorization-ID'], extra: ['- Authorization-ID: g2-live-0001', '  Authorization-ID: g2-live-0001'] });
  const p = parseAuthorizationMarkers(text);
  assert.equal(p.ok, false);
  assert.deepEqual(p.errors, ['marker-missing:Authorization-ID']);
});

// ------------------------------------------------------------------------------------------
// Reject: digest mismatches
// ------------------------------------------------------------------------------------------

test('reject: each bound digest mismatching', () => {
  const other = 'f'.repeat(64);
  const cases = [
    [{ head: 'b'.repeat(40) }, 'baseline-head-mismatch'],
    [{ proc: other }, 'procedure-sha256-mismatch'],
    [{ harness: other }, 'harness-sha256-mismatch'],
    [{ a: other }, 'model-a-urn-sha256-mismatch'],
    [{ b: other }, 'model-b-urn-sha256-mismatch'],
    [{ a: DEFAULTS.b, b: DEFAULTS.a }, 'model-a-urn-sha256-mismatch'],
  ];
  for (const [opts, reason] of cases) {
    assert.equal(validate(setup({ [P]: recordText(opts) }), P).reason, reason, reason);
  }
  // procedure/harness bytes changed after the record was issued
  assert.equal(validate(setup({ [P]: recordText() }, { procedure: `${PROC}edit` }), P).reason, 'procedure-sha256-mismatch');
  assert.equal(validate(setup({ [P]: recordText() }, { harness: `${HARNESS}edit` }), P).reason, 'harness-sha256-mismatch');
  // URN constants differing from the record's digests
  assert.equal(validate(setup({ [P]: recordText() }), P, { urns: { A: `${MODEL_A_URN}x`, B: MODEL_B_URN } }).reason, 'model-a-urn-sha256-mismatch');
});

test('reject: git HEAD unavailable', () => {
  const r = validate(setup({ [P]: recordText() }), P, { gitHead: () => { throw new Error('not a git repo'); } });
  assert.equal(r.reason, 'git-head-unavailable');
});

// ------------------------------------------------------------------------------------------
// Reject: candidate set (ambiguity / supersession / duplicates / malformed peers)
// ------------------------------------------------------------------------------------------

test('reject: two valid non-superseded candidates (ambiguous)', () => {
  const fs = setup({ [P]: recordText(), 'docs/prompts/g2-second.md': recordText({ id: 'g2-live-0002' }) });
  const r = validate(fs, P);
  assert.equal(r.reason, 'candidate-set-ambiguous');
  assert.equal(r.detail.candidateSet.length, 2);
});

test('reject: the passed record is superseded by another candidate', () => {
  const fs = setup({ [P]: recordText(), 'docs/prompts/g2-newer.md': recordText({ id: 'g2-live-0002', supersedes: ['g2-live-0001'] }) });
  assert.equal(validate(fs, P).reason, 'record-superseded');
  // ... while the superseding record itself is accepted
  assert.equal(validate(fs, 'docs/prompts/g2-newer.md').ok, true);
});

test('reject: two candidates carry the same Authorization-ID', () => {
  const fs = setup({ [P]: recordText(), 'docs/prompts/g2-copy.md': recordText({ extra: ['(copy)'] }) });
  assert.equal(validate(fs, P).reason, 'candidate-duplicate-authorization-id');
});

test('reject: any other candidate has malformed marker lines', () => {
  const peers = [
    'G2-LIVE-EXECUTION: maybe\n',
    recordText({ id: 'g2-live-0002', omit: ['Baseline-HEAD'] }),
    `${recordText({ id: 'g2-live-0002' })}Harness-SHA256: ${'0'.repeat(64)}\n`,
    Buffer.concat([Buffer.from(recordText({ id: 'g2-live-0002' })), Buffer.from([0xc3, 0x28])]),
  ];
  for (const peer of peers) {
    const r = validate(setup({ [P]: recordText(), 'docs/prompts/zz-peer.md': peer }), P);
    assert.equal(r.reason, 'candidate-malformed', JSON.stringify(r));
    assert.equal(r.detail.path, 'docs/prompts/zz-peer.md');
  }
});

test('reject: the passed record is not in the enumerated candidate set (defence in depth)', () => {
  const fs = setup({ [P]: recordText() });
  const hiding = { ...fs, readdir: (p) => fs.readdir(p).filter((n) => n !== 'g2-live-authorization.md') };
  assert.equal(validateAuthorizationRecord({ recordPath: P, repoRoot: ROOT, fs: hiding, gitHead: () => HEAD }).reason, 'record-not-in-candidate-set');
});

test('self-supersession does not supersede (the rule names "another candidate")', () => {
  const r = validate(setup({ [P]: recordText({ supersedes: ['g2-live-0001'] }) }), P);
  assert.equal(r.ok, true);
});

test('reject: an unexpected io error is reported as io-error, never thrown', () => {
  const fs = setup({ [P]: recordText() });
  const broken = { ...fs, readFile: (p) => { if (p.endsWith(PROCEDURE_REL_PATH)) { const e = new Error('EIO'); e.code = 'EIO'; throw e; } return fs.readFile(p); } };
  assert.equal(validateAuthorizationRecord({ recordPath: P, repoRoot: ROOT, fs: broken, gitHead: () => HEAD }).reason, 'io-error');
});

test('W1 is read-only: no mkdir/open/write/rename/link on any path', () => {
  const fs = setup({ [P]: recordText() });
  assert.equal(validate(fs, P).ok, true);
  const mutating = fs.ops.filter((o) => !['lstat', 'readFile', 'readdir'].includes(o.op));
  assert.deepEqual(mutating, []);
});

// ------------------------------------------------------------------------------------------
// Real filesystem (os.tmpdir sandbox)
// ------------------------------------------------------------------------------------------

function realRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'g2-auth-'));
  mkdirSync(path.join(root, 'docs/prompts'), { recursive: true });
  mkdirSync(path.join(root, 'docs/research'), { recursive: true });
  mkdirSync(path.join(root, 'test/acceptance'), { recursive: true });
  writeFileSync(path.join(root, PROCEDURE_REL_PATH), PROC);
  writeFileSync(path.join(root, HARNESS_REL_PATH), HARNESS);
  return root;
}

test('real fs: accept a valid record; reject a real symlinked record and a symlinked prompts subdir', () => {
  const root = realRepo();
  try {
    writeFileSync(path.join(root, P), recordText());
    const fs = createNodeFsLayer();
    const ok = validateAuthorizationRecord({ recordPath: P, repoRoot: root, fs, gitHead: () => HEAD });
    assert.equal(ok.ok, true, JSON.stringify(ok));

    symlinkSync(path.join(root, P), path.join(root, 'docs/prompts/link.md'));
    assert.equal(validateAuthorizationRecord({ recordPath: 'docs/prompts/link.md', repoRoot: root, fs, gitHead: () => HEAD }).reason, 'record-path-symlink-component');

    mkdirSync(path.join(root, 'outside'));
    writeFileSync(path.join(root, 'outside/x.md'), recordText({ id: 'g2-live-0009' }));
    symlinkSync(path.join(root, 'outside'), path.join(root, 'docs/prompts/sub'));
    assert.equal(validateAuthorizationRecord({ recordPath: 'docs/prompts/sub/x.md', repoRoot: root, fs, gitHead: () => HEAD }).reason, 'record-path-symlink-component');
    // the symlinked directory is not followed during enumeration, so the original stays unambiguous
    assert.equal(validateAuthorizationRecord({ recordPath: P, repoRoot: root, fs, gitHead: () => HEAD }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
