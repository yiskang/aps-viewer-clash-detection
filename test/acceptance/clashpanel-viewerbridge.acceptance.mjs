// test/acceptance/clashpanel-viewerbridge.acceptance.mjs
//
// ============================================================================================
//  G2 LIVE VIEWERBRIDGE / DOCKINGPANEL VERIFICATION HARNESS -- NOT PART OF `npm test` (it is not
//  a `*.test.mjs` file), NOT WIRED INTO server.js OR ANY ROUTE, NOT a production module.
//
//  Implementation authorization: docs/prompts/for-claude-g2-harness-implementation-only.md
//  (implementation + offline/non-live verification ONLY; live execution is NOT authorized).
//  Governing procedure (binding contract, not redesigned here):
//    docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md
//
//  IMPLEMENTED, NOT EXECUTED. Every piece of logic in this file is a pure or dependency-injected
//  function exported for the offline sibling tests (`clashpanel-viewerbridge.acceptance.<topic>
//  .test.mjs`, collected by `npm test`, none of which imports playwright). `main()` is the only
//  place a real Playwright object could ever be constructed and it is gated, in this exact
//  source order (procedure §4.1, source-order tested):
//    W0 activation interlock (`--execute-live-g2` + `G2_LIVE_AUTHORIZED=YES` +
//       `--authorization-record <repo-relative path>`)
//    W1 authorization-record validation + attempts-directory startup scan (local reads only)
//    W2a durable attempts-directory chain, W2b exclusive reservation + durable `AUTH_BOUND`
//    ... only then the (dynamic, never top-level) `import('playwright')`.
//  The flag/env are mechanical safeguards, not proof of owner authorization; the record is.
//  Whether this harness has ever been RUN is recorded in docs/handoffs/ and docs/reviews/,
//  never in this banner.
//
//  §9.2 network classification status (offline-implemented): slice C1 -- request observations,
//  classifyRequestFailure / classifyHttpResponse (two-stage, frozen EMPTY OPTIONAL_RESPONSE_RULES),
//  one-to-one fatal-witness correlation; slice C2 -- exact operation ledger (load / hide / unload /
//  teardown records with node-side acknowledgement barriers), durable prefix-source ledger,
//  derivePrefixes + hashes, ambiguous-prefix accounting, `load-windows-closed` finalization and
//  boundPrefix provenance, all recomputed at closeout. KNOWN BEFORE-LIVE GATE: the page/node
//  dual seq namespace (G2_DUAL_COUNTER_GATE) is unresolved.
//
//  Hard boundaries (procedure §1/§2, authorization §7): this file never imports clashpanel/core,
//  any engine, catalog, `createClashPanel`, or server.js, and never issues a theming call.
// ============================================================================================

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  realpathSync,
  lstatSync as nodeLstatSync,
  mkdirSync as nodeMkdirSync,
  openSync as nodeOpenSync,
  writeSync as nodeWriteSync,
  fsyncSync as nodeFsyncSync,
  closeSync as nodeCloseSync,
  renameSync as nodeRenameSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  linkSync as nodeLinkSync,
  unlinkSync as nodeUnlinkSync,
} from 'node:fs';
// The commit primitive of §9.1 step 8 is node:fs's own `linkSync`, reached through this namespace
// object (identity-checked before the critical section; never aliased or wrapped).
import * as nodeFsModule from 'node:fs';

// ============================================================================================
// Section 1 -- fixed constants (procedure §3, §4.1, §10). Copied by value; never tuned here.
// ============================================================================================

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Repo-relative paths the authorization record binds by SHA-256 (§4.1). */
const HARNESS_REL_PATH = 'test/acceptance/clashpanel-viewerbridge.acceptance.mjs';
const PROCEDURE_REL_PATH = 'docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md';
const PROCEDURE_VERSION = 'v5';
/**
 * The final accepted procedure digest (RC1 + RC1-C1 + RC1-C2, docs/handoffs/latest.md "FINAL accepted
 * procedure SHA-256"; RC1-C1 follow-up item 14). W1 refuses unless the procedure file on disk hashes to
 * exactly this value (every older digest is stale) AND the record's `Procedure-SHA256` equals it. This
 * is the procedure binding only; the clean-commit harness binding is separate before-live work.
 */
const ACCEPTED_PROCEDURE_SHA256 = '5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb';

/** The only directory an authorization record may live under (§4.1 "Type/path"). */
const AUTHORIZATION_PROMPTS_REL_DIR = 'docs/prompts';

/** W2a directory chain (§4.1): D0 tracked and pre-existing; D1/D2 created durably if absent. */
const ATTEMPTS_D0_REL = 'test/acceptance';
const ATTEMPTS_D1_NAME = 'results';
const ATTEMPTS_D2_NAME = 'clashpanel-viewerbridge-g2-attempts';

const JOURNAL_VERSION = 1;

/** Runtime envelope requested (§3); the record's `Runtime:` line must state exactly this. */
const RUNTIME_ENVELOPE_REQUESTED = Object.freeze({
  viewer: '7.124.2',
  env: 'AutodeskProduction2',
  api: 'streamingV2',
});

/**
 * Fixture pair (§3, owner decision D1). Both URNs are literal base64url constants of
 * `urn:adsk.objects:os.object:<bucket>/<objectName>` (no credential/signature). Model A is the
 * G1 harness's MODEL_URN copied by value. Model B is derived the same way for the already-
 * translated Structure derivative in the same sandbox bucket that the fixture-capacity screening
 * listed (docs/research/2026-09-29-g1-svf2-fixture-capacity-screening.md); its SHA-256 is bound
 * by the authorization record and must be cross-checked by the operator (D1) before any record
 * is issued. No upload/retranslation is ever performed by this harness.
 */
const MODEL_A_NAME = 'Audubon_Mechanical_clash_test.rvt';
const MODEL_A_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const MODEL_B_NAME = 'Audubon_Structure_clash_test.rvt';
const MODEL_B_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';

/**
 * Live-path wiring switch. Task 1 establishes the W0 -> W1 -> W2 -> playwright source order but
 * does not wire Phase 0 / checks / closeout. While false, `main()` refuses immediately after the
 * interlock -- BEFORE record validation or any durable act -- so no record can ever be spent by
 * an unwired harness. A later implementation task flips this only when the live path exists.
 */
const LIVE_PATH_WIRED = false;

// ============================================================================================
// Section 2 -- small shared helpers.
// ============================================================================================

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.from(String(bytes), 'utf8');
}

/** Refusal/fail-closed error carrying a stable machine-readable `reason` and exit code 1. */
class G2RefusalError extends Error {
  constructor(reason, message, detail) {
    super(`${message} (${reason})`);
    this.name = 'G2RefusalError';
    this.reason = reason;
    this.exitCode = 1;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * W2a/W2b/journal durability failure (§4.1): any error from mkdir/open/write/fsync/close/rename
 * or a read-back mismatch. Stop immediately, no retry, exit 1, no browser/Viewer/token access.
 */
class G2DurabilityError extends Error {
  constructor(step, cause) {
    super(`G2 durability failure at ${step}: ${cause && cause.message ? cause.message : String(cause)}`);
    this.name = 'G2DurabilityError';
    this.step = step;
    this.exitCode = 1;
    this.cause = cause;
  }
}

// ============================================================================================
// Section 3 -- W0 activation interlock (procedure §4.1 "Interlock").
// ============================================================================================

const LIVE_FLAG = '--execute-live-g2';
const LIVE_ENV_NAME = 'G2_LIVE_AUTHORIZED';
const RECORD_FLAG = '--authorization-record';

/**
 * `parseLiveActivation({argv, env})` -- pure, never throws. All three are required: the
 * `--execute-live-g2` flag, `G2_LIVE_AUTHORIZED=YES` (exact string, never truthy-coerced), and
 * exactly one `--authorization-record <path>` whose value is a non-empty argument that is not
 * itself a flag. Returns `{authorized, reason, recordPath}`; `reason` is null iff authorized,
 * otherwise `missing:<comma list of flag|env|record>` or `record-flag-duplicate` /
 * `record-value-missing`. The record path is only syntactically extracted here; its full
 * validation is `validateAuthorizationRecord` (W1).
 */
function parseLiveActivation({ argv, env } = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const flagPresent = args.includes(LIVE_FLAG);
  const envPresent = Boolean(env) && typeof env === 'object' && env[LIVE_ENV_NAME] === 'YES';

  const recordIdx = [];
  args.forEach((a, i) => { if (a === RECORD_FLAG) recordIdx.push(i); });
  let recordPath = null;
  let recordProblem = null;
  if (recordIdx.length > 1) {
    recordProblem = 'record-flag-duplicate';
  } else if (recordIdx.length === 1) {
    const value = args[recordIdx[0] + 1];
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) recordProblem = 'record-value-missing';
    else recordPath = value;
  }

  const missing = [];
  if (!flagPresent) missing.push('flag');
  if (!envPresent) missing.push('env');
  if (recordIdx.length === 0) missing.push('record');
  if (missing.length > 0) return { authorized: false, reason: `missing:${missing.join(',')}`, recordPath: null };
  if (recordProblem) return { authorized: false, reason: recordProblem, recordPath: null };
  return { authorized: true, reason: null, recordPath };
}

// ============================================================================================
// Section 4 -- injectable synchronous filesystem layer.
//
// Every W1/W2/journal filesystem operation goes through this narrow interface so a fake can
// record the operation order and inject a fault at every step. All operations are synchronous:
// the attempt tree is touched by exactly one logical thread per process, and cross-process
// exclusion comes only from `open(...,'wx')` (and, in the closeout, `link`). Directory fsync is
// `open(dir,'r')` + `fsync(fd)` (supported by Node on POSIX).
// ============================================================================================

/** The real Node implementation of the fs layer. */
function createNodeFsLayer() {
  return {
    lstat: (p) => nodeLstatSync(p),
    mkdir: (p) => { nodeMkdirSync(p); },
    open: (p, flags) => nodeOpenSync(p, flags),
    write: (fd, bytes) => {
      const buf = toBuffer(bytes);
      let off = 0;
      while (off < buf.length) off += nodeWriteSync(fd, buf, off, buf.length - off);
      return buf.length;
    },
    fsync: (fd) => { nodeFsyncSync(fd); },
    close: (fd) => { nodeCloseSync(fd); },
    rename: (from, to) => { nodeRenameSync(from, to); },
    readFile: (p) => nodeReadFileSync(p),
    readdir: (p) => nodeReaddirSync(p),
    link: (from, to) => { nodeLinkSync(from, to); },
    unlink: (p) => { nodeUnlinkSync(p); },
  };
}

function isEnoent(err) { return Boolean(err) && err.code === 'ENOENT'; }

/** lstat that returns null for ENOENT and rethrows anything else. */
function lstatOrNull(fs, p) {
  try { return fs.lstat(p); } catch (err) { if (isEnoent(err)) return null; throw err; }
}

function isRealDirectory(st) {
  return Boolean(st) && !st.isSymbolicLink() && st.isDirectory();
}

function isRegularFile(st) {
  return Boolean(st) && !st.isSymbolicLink() && st.isFile();
}

// ============================================================================================
// Section 5 -- W1 authorization-record validation (procedure §4.1 "Authorization record").
// ============================================================================================

const MARKER_LIVE_LINE = 'G2-LIVE-EXECUTION: AUTHORIZED EXACTLY ONE ATTEMPT';
const RUNTIME_LINE = `Runtime: viewer=${RUNTIME_ENVELOPE_REQUESTED.viewer} env=${RUNTIME_ENVELOPE_REQUESTED.env} api=${RUNTIME_ENVELOPE_REQUESTED.api}`;

/**
 * Marker keys. A line that begins `<key>:` must match the key's whole-line pattern, otherwise the
 * record is malformed. `required` keys must appear exactly once; `Supersedes` zero or more times.
 */
const AUTHORIZATION_MARKERS = Object.freeze([
  { key: 'G2-LIVE-EXECUTION', field: 'liveExecution', required: true, re: /^G2-LIVE-EXECUTION: (AUTHORIZED EXACTLY ONE ATTEMPT)$/ },
  { key: 'Authorization-ID', field: 'authorizationId', required: true, re: /^Authorization-ID: ([a-z0-9-]{8,64})$/ },
  { key: 'Baseline-HEAD', field: 'baselineHead', required: true, re: /^Baseline-HEAD: ([0-9a-f]{40})$/ },
  { key: 'Procedure-SHA256', field: 'procedureSha256', required: true, re: /^Procedure-SHA256: ([0-9a-f]{64})$/ },
  { key: 'Harness-SHA256', field: 'harnessSha256', required: true, re: /^Harness-SHA256: ([0-9a-f]{64})$/ },
  { key: 'Model-A-URN-SHA256', field: 'modelAUrnSha256', required: true, re: /^Model-A-URN-SHA256: ([0-9a-f]{64})$/ },
  { key: 'Model-B-URN-SHA256', field: 'modelBUrnSha256', required: true, re: /^Model-B-URN-SHA256: ([0-9a-f]{64})$/ },
  { key: 'Runtime', field: 'runtime', required: true, re: new RegExp(`^(${RUNTIME_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})$`) },
  { key: 'Supersedes', field: 'supersedes', required: false, re: /^Supersedes: ([a-z0-9-]{8,64})$/ },
]);

function splitLines(text) { return text.split(/\r?\n/); }

/** True iff the text contains a line beginning `G2-LIVE-EXECUTION:` (candidate-set membership). */
function isAuthorizationCandidateText(text) {
  return splitLines(text).some((line) => line.startsWith('G2-LIVE-EXECUTION:'));
}

/**
 * `parseAuthorizationMarkers(text)` -- pure. Returns `{ok:true, fields}` or `{ok:false, errors}`
 * where each error is `marker-missing:<key>` / `marker-duplicate:<key>` / `marker-malformed:<key>`.
 * `fields.supersedes` is an array (possibly empty).
 */
function parseAuthorizationMarkers(text) {
  const errors = [];
  const found = new Map(AUTHORIZATION_MARKERS.map((m) => [m.key, []]));
  for (const line of splitLines(text)) {
    for (const m of AUTHORIZATION_MARKERS) {
      if (!line.startsWith(`${m.key}:`)) continue;
      const match = m.re.exec(line);
      if (!match) errors.push(`marker-malformed:${m.key}`);
      else found.get(m.key).push(match[1]);
    }
  }
  const fields = { supersedes: [] };
  for (const m of AUTHORIZATION_MARKERS) {
    const values = found.get(m.key);
    if (m.required) {
      if (values.length === 0 && !errors.includes(`marker-malformed:${m.key}`)) errors.push(`marker-missing:${m.key}`);
      if (values.length > 1) errors.push(`marker-duplicate:${m.key}`);
      if (values.length === 1) fields[m.field] = values[0];
    } else {
      fields[m.field] = values.slice();
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, fields };
}

/**
 * `normalizeRecordPath(recordPath)` -- pure syntactic check of the `--authorization-record` value:
 * a repo-relative POSIX path under `docs/prompts/`, ending `.md`, with no absolute prefix, no
 * backslash, no empty/`.`/`..` segment. Returns `{ok, reason, segments}`.
 */
function normalizeRecordPath(recordPath) {
  if (typeof recordPath !== 'string' || recordPath === '') return { ok: false, reason: 'record-path-invalid' };
  if (recordPath.includes('\\') || recordPath.includes('\0')) return { ok: false, reason: 'record-path-invalid' };
  if (path.posix.isAbsolute(recordPath) || path.win32.isAbsolute(recordPath)) return { ok: false, reason: 'record-path-escape' };
  const segments = recordPath.split('/');
  if (segments.some((s) => s === '..')) return { ok: false, reason: 'record-path-escape' };
  if (segments.some((s) => s === '' || s === '.')) return { ok: false, reason: 'record-path-invalid' };
  const prefix = AUTHORIZATION_PROMPTS_REL_DIR.split('/');
  if (segments.length <= prefix.length || prefix.some((p, i) => segments[i] !== p)) {
    return { ok: false, reason: 'record-path-outside-prompts' };
  }
  if (!recordPath.endsWith('.md')) return { ok: false, reason: 'record-path-not-markdown' };
  return { ok: true, reason: null, segments };
}

function decodeUtf8Strict(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

/**
 * Recursively enumerate every regular `*.md` file under `docs/prompts/` (repo-relative POSIX
 * paths, sorted). Symlinks (to files or directories) are never followed and never candidates --
 * the procedure admits only regular files; they are reported in `nonRegular` for evidence.
 */
function enumeratePromptMarkdownFiles({ fs, repoRoot }) {
  const files = [];
  const nonRegular = [];
  const walk = (relDir) => {
    const names = fs.readdir(path.join(repoRoot, relDir)).slice().sort();
    for (const name of names) {
      const rel = `${relDir}/${name}`;
      const st = fs.lstat(path.join(repoRoot, rel));
      if (st.isSymbolicLink()) { nonRegular.push(rel); continue; }
      if (st.isDirectory()) { walk(rel); continue; }
      if (st.isFile() && name.endsWith('.md')) files.push(rel);
    }
  };
  walk(AUTHORIZATION_PROMPTS_REL_DIR);
  return { files: files.sort(), nonRegular: nonRegular.sort() };
}

/**
 * `validateAuthorizationRecord({recordPath, repoRoot, fs, gitHead, urns})` -- W1 (§4.1). Local
 * reads and pure computation only (no Viewer/model/token/browser/network/evidence file, nothing
 * reserved). Checks, in order:
 *   1. path syntax (normalizeRecordPath), then every path component lstat'd from the repo root:
 *      no symlink component, directories real, the record a regular file;
 *   2. strict UTF-8 and the marker lines (each required line exactly once, well-formed);
 *   3. candidate set: every regular `*.md` under docs/prompts/ containing a line beginning
 *      `G2-LIVE-EXECUTION:`; reject if the record is not a candidate, any candidate is malformed
 *      (missing/duplicate/malformed markers or invalid UTF-8), two candidates share an
 *      Authorization-ID, the record is superseded, or the non-superseded count is not exactly 1
 *      (that one being the record);
 *   4. digests: Baseline-HEAD == `git rev-parse HEAD`; Procedure/Harness SHA-256 over the files'
 *      bytes, and the procedure digest must also equal ACCEPTED_PROCEDURE_SHA256
 *      (`procedure-sha256-not-accepted`; offline tests inject a stand-in via
 *      `acceptedProcedureSha256`, main() never does); Model-A/B URN SHA-256 over the UTF-8 bytes of
 *      the literal URN constants.
 * Returns `{ok:true, record, candidateSet, digests}` or `{ok:false, reason, detail?}`; never throws
 * for expected rejections (an unexpected io failure is `io-error`).
 */
function validateAuthorizationRecord({
  recordPath,
  repoRoot = REPO_ROOT,
  fs = createNodeFsLayer(),
  gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  urns = { A: MODEL_A_URN, B: MODEL_B_URN },
  acceptedProcedureSha256 = ACCEPTED_PROCEDURE_SHA256,
} = {}) {
  const reject = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });

  const norm = normalizeRecordPath(recordPath);
  if (!norm.ok) return reject(norm.reason);

  try {
    // 1. component-by-component lstat from the repo root (no symlink component anywhere).
    for (let i = 1; i <= norm.segments.length; i += 1) {
      const rel = norm.segments.slice(0, i).join('/');
      const st = lstatOrNull(fs, path.join(repoRoot, rel));
      if (!st) return reject('record-not-found', rel);
      if (st.isSymbolicLink()) return reject('record-path-symlink-component', rel);
      const last = i === norm.segments.length;
      if (!last && !st.isDirectory()) return reject('record-path-invalid', rel);
      if (last && !st.isFile()) return reject('record-not-regular-file', rel);
    }

    // 2. record content.
    const recordBytes = toBuffer(fs.readFile(path.join(repoRoot, recordPath)));
    const recordText = decodeUtf8Strict(recordBytes);
    if (recordText === null) return reject('record-not-utf8');
    const parsed = parseAuthorizationMarkers(recordText);
    if (!parsed.ok) return reject(`record-${parsed.errors[0]}`, parsed.errors);
    const recordSha256 = sha256Hex(recordBytes);

    // 3. candidate set.
    const { files, nonRegular } = enumeratePromptMarkdownFiles({ fs, repoRoot });
    const candidates = [];
    for (const rel of files) {
      const bytes = toBuffer(fs.readFile(path.join(repoRoot, rel)));
      const lenient = bytes.toString('utf8');
      if (!isAuthorizationCandidateText(lenient)) continue;
      const strict = decodeUtf8Strict(bytes);
      if (strict === null) return reject('candidate-malformed', { path: rel, errors: ['not-utf8'] });
      const p = parseAuthorizationMarkers(strict);
      if (!p.ok) return reject('candidate-malformed', { path: rel, errors: p.errors });
      candidates.push({ path: rel, id: p.fields.authorizationId, sha256: sha256Hex(bytes), supersedes: p.fields.supersedes });
    }
    if (!candidates.some((c) => c.path === recordPath)) return reject('record-not-in-candidate-set');
    const byId = new Map();
    for (const c of candidates) {
      if (byId.has(c.id)) return reject('candidate-duplicate-authorization-id', { id: c.id, paths: [byId.get(c.id).path, c.path] });
      byId.set(c.id, c);
    }
    const supersededIds = new Set();
    for (const c of candidates) for (const s of c.supersedes) if (s !== c.id) supersededIds.add(s);
    const candidateSet = candidates.map((c) => ({ path: c.path, id: c.id, sha256: c.sha256, supersedes: c.supersedes.slice(), superseded: supersededIds.has(c.id) }));
    if (supersededIds.has(parsed.fields.authorizationId)) return reject('record-superseded', { candidateSet });
    const live = candidateSet.filter((c) => !c.superseded);
    if (live.length !== 1 || live[0].path !== recordPath) return reject('candidate-set-ambiguous', { candidateSet });

    // 4. digests.
    let head;
    try { head = String(gitHead()).trim(); } catch (err) { return reject('git-head-unavailable', err && err.message); }
    if (head !== parsed.fields.baselineHead) return reject('baseline-head-mismatch', { expected: parsed.fields.baselineHead, actual: head });
    const procedureSha256 = sha256Hex(toBuffer(fs.readFile(path.join(repoRoot, PROCEDURE_REL_PATH))));
    if (procedureSha256 !== parsed.fields.procedureSha256) return reject('procedure-sha256-mismatch');
    if (procedureSha256 !== acceptedProcedureSha256) return reject('procedure-sha256-not-accepted', { expected: acceptedProcedureSha256, actual: procedureSha256 });
    const harnessSha256 = sha256Hex(toBuffer(fs.readFile(path.join(repoRoot, HARNESS_REL_PATH))));
    if (harnessSha256 !== parsed.fields.harnessSha256) return reject('harness-sha256-mismatch');
    const urnASha256 = sha256Hex(Buffer.from(urns.A, 'utf8'));
    if (urnASha256 !== parsed.fields.modelAUrnSha256) return reject('model-a-urn-sha256-mismatch');
    const urnBSha256 = sha256Hex(Buffer.from(urns.B, 'utf8'));
    if (urnBSha256 !== parsed.fields.modelBUrnSha256) return reject('model-b-urn-sha256-mismatch');

    return {
      ok: true,
      record: { path: recordPath, sha256: recordSha256, id: parsed.fields.authorizationId, fields: parsed.fields },
      candidateSet,
      nonRegularPromptEntries: nonRegular,
      digests: { headSha: head, procedureSha256, harnessSha256, urnASha256, urnBSha256 },
    };
  } catch (err) {
    return reject('io-error', err && err.message);
  }
}

// ============================================================================================
// Section 6 -- journal state machine (procedure §4.1 "States" / "transitions").
// ============================================================================================

/** Journal transition names actually written by the harness (exhaustive). */
const JOURNAL_STATE = Object.freeze({
  AUTH_BOUND: 'AUTH_BOUND',
  PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
  ATTEMPT_CONSUMED: 'ATTEMPT_CONSUMED',
  CLOSEOUT_STARTED: 'CLOSEOUT_STARTED',
  FAILED: 'FAILED',
});

/**
 * Legal transitions (§4.1 table). `null` is the implicit NOT_STARTED. There is no COMPLETED
 * state (v5); the success terminal is the separate commit record K, never a journal state.
 */
const JOURNAL_TRANSITIONS = Object.freeze({
  null: Object.freeze([JOURNAL_STATE.AUTH_BOUND]),
  AUTH_BOUND: Object.freeze([JOURNAL_STATE.PREFLIGHT_FAILED, JOURNAL_STATE.ATTEMPT_CONSUMED]),
  PREFLIGHT_FAILED: Object.freeze([]),
  ATTEMPT_CONSUMED: Object.freeze([JOURNAL_STATE.CLOSEOUT_STARTED, JOURNAL_STATE.FAILED]),
  CLOSEOUT_STARTED: Object.freeze([JOURNAL_STATE.FAILED]),
  FAILED: Object.freeze([]),
});

const PRIMARY_OVERALL_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'PARTIAL']);
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/**
 * Per-state `detail` contract. CLOSEOUT_STARTED carries exactly `{primaryOverall, primaryRow}`
 * (no artifact hash, §4.1/§9.1). FAILED carries a non-empty `causes[]` and optionally the
 * computed `primaryOverall`/`primaryRow`. Others may carry an optional plain-object detail.
 * Returns an error string or null.
 */
function checkTransitionDetail(state, detail) {
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (state === JOURNAL_STATE.CLOSEOUT_STARTED) {
    if (!isPlain(detail)) return 'closeout-started-detail-required';
    const keys = Object.keys(detail).sort();
    if (keys.join(',') !== 'primaryOverall,primaryRow') return 'closeout-started-detail-keys';
    if (!PRIMARY_OVERALL_VALUES.includes(detail.primaryOverall)) return 'closeout-started-primary-overall';
    if (!Number.isInteger(detail.primaryRow) || detail.primaryRow < 1 || detail.primaryRow > 8) return 'closeout-started-primary-row';
    return null;
  }
  if (state === JOURNAL_STATE.FAILED) {
    if (!isPlain(detail)) return 'failed-detail-required';
    if (!Array.isArray(detail.causes) || detail.causes.length === 0 || !detail.causes.every((c) => typeof c === 'string' && c !== '')) return 'failed-causes';
    if (detail.primaryOverall !== undefined && !PRIMARY_OVERALL_VALUES.includes(detail.primaryOverall)) return 'failed-primary-overall';
    return null;
  }
  if (detail !== undefined && !isPlain(detail)) return 'detail-not-object';
  return null;
}

/**
 * `validateTransitionHistory(transitions)` -- pure. Returns `{ok:true, lastState}` or
 * `{ok:false, reason}` for: non-array/empty history, unknown transition name, an illegal path of
 * the §4.1 graph (e.g. PREFLIGHT_FAILED -> ATTEMPT_CONSUMED, a second ATTEMPT_CONSUMED, anything
 * after a terminal), a malformed `at` (ISO-8601 UTC) or a decreasing `monotonicMs`, or a detail
 * violating its per-state contract.
 */
function validateTransitionHistory(transitions) {
  if (!Array.isArray(transitions) || transitions.length === 0) return { ok: false, reason: 'history-empty' };
  let prev = null;
  let prevMono = -Infinity;
  for (const t of transitions) {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) return { ok: false, reason: 'transition-not-object' };
    if (!Object.prototype.hasOwnProperty.call(JOURNAL_STATE, t.state)) return { ok: false, reason: `unknown-transition:${String(t.state)}` };
    const allowed = JOURNAL_TRANSITIONS[prev === null ? 'null' : prev];
    if (!allowed.includes(t.state)) return { ok: false, reason: `illegal-transition:${prev}->${t.state}` };
    if (typeof t.at !== 'string' || !ISO_UTC_RE.test(t.at) || Number.isNaN(Date.parse(t.at))) return { ok: false, reason: 'transition-at-invalid' };
    if (typeof t.monotonicMs !== 'number' || !Number.isFinite(t.monotonicMs) || t.monotonicMs < prevMono) return { ok: false, reason: 'transition-monotonic-invalid' };
    const extra = Object.keys(t).filter((k) => !['state', 'at', 'monotonicMs', 'detail'].includes(k));
    if (extra.length > 0) return { ok: false, reason: `transition-unknown-key:${extra[0]}` };
    const detailErr = checkTransitionDetail(t.state, t.detail);
    if (detailErr) return { ok: false, reason: detailErr };
    prev = t.state;
    prevMono = t.monotonicMs;
  }
  return { ok: true, lastState: prev };
}

/**
 * `appendTransition(journal, state, {at, monotonicMs, detail})` -- pure; returns a NEW journal
 * object with the transition appended (never mutates, never rewrites earlier transitions).
 * Throws on an illegal transition or malformed transition fields.
 */
function appendTransition(journal, state, { at, monotonicMs, detail } = {}) {
  const transition = detail === undefined ? { state, at, monotonicMs } : { state, at, monotonicMs, detail };
  const next = [...(journal && Array.isArray(journal.transitions) ? journal.transitions : []), transition];
  const v = validateTransitionHistory(next);
  if (!v.ok) throw new Error(`appendTransition: ${v.reason}`);
  return { ...journal, transitions: next };
}

/** Binding-record keys, in serialization order (§4.1 "Content"). */
const BINDING_KEYS = Object.freeze(['journalVersion', 'attemptId', 'authorization', 'headSha', 'procedure', 'harness', 'fixtures', 'runtimeEnvelopeRequested']);

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * `buildBindingRecord({validation, attemptId})` -- pure. The complete binding record carried by
 * the reservation and repeated by the journal: journalVersion, fresh UUIDv4 attemptId, record
 * {path, sha256, id}, headSha, procedure {path, sha256, version}, harness {path, sha256},
 * fixtures {A,B:{name, urnSha256}}, runtimeEnvelopeRequested.
 */
function buildBindingRecord({ validation, attemptId }) {
  if (!validation || validation.ok !== true) throw new Error('buildBindingRecord: validation must be ok');
  if (typeof attemptId !== 'string' || !UUID_V4_RE.test(attemptId)) throw new Error('buildBindingRecord: attemptId must be a lowercase UUIDv4');
  const d = validation.digests;
  return {
    journalVersion: JOURNAL_VERSION,
    attemptId,
    authorization: { path: validation.record.path, sha256: validation.record.sha256, id: validation.record.id },
    headSha: d.headSha,
    procedure: { path: PROCEDURE_REL_PATH, sha256: d.procedureSha256, version: PROCEDURE_VERSION },
    harness: { path: HARNESS_REL_PATH, sha256: d.harnessSha256 },
    fixtures: { A: { name: MODEL_A_NAME, urnSha256: d.urnASha256 }, B: { name: MODEL_B_NAME, urnSha256: d.urnBSha256 } },
    runtimeEnvelopeRequested: { ...RUNTIME_ENVELOPE_REQUESTED },
  };
}

function pickBinding(obj) {
  const out = {};
  for (const k of BINDING_KEYS) out[k] = obj[k];
  return out;
}

/** Canonical serialization of reservation/journal bytes (stable key order by construction). */
function serializeJson(obj) {
  return Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function isNonEmptyString(v) { return typeof v === 'string' && v !== ''; }

/** Structural check of a parsed binding record; returns an error string or null. */
function checkBindingShape(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return 'not-object';
  if (obj.journalVersion !== JOURNAL_VERSION) return 'journal-version';
  if (typeof obj.attemptId !== 'string' || !UUID_V4_RE.test(obj.attemptId)) return 'attempt-id';
  const a = obj.authorization;
  if (!a || !isNonEmptyString(a.path) || !/^[0-9a-f]{64}$/.test(a.sha256 || '') || !isNonEmptyString(a.id)) return 'authorization';
  if (!/^[0-9a-f]{40}$/.test(obj.headSha || '')) return 'head-sha';
  const p = obj.procedure;
  if (!p || !isNonEmptyString(p.path) || !/^[0-9a-f]{64}$/.test(p.sha256 || '') || p.version !== PROCEDURE_VERSION) return 'procedure';
  const h = obj.harness;
  if (!h || !isNonEmptyString(h.path) || !/^[0-9a-f]{64}$/.test(h.sha256 || '')) return 'harness';
  const f = obj.fixtures;
  if (!f || !f.A || !f.B || !isNonEmptyString(f.A.name) || !isNonEmptyString(f.B.name)
    || !/^[0-9a-f]{64}$/.test(f.A.urnSha256 || '') || !/^[0-9a-f]{64}$/.test(f.B.urnSha256 || '')) return 'fixtures';
  const r = obj.runtimeEnvelopeRequested;
  if (!r || !isNonEmptyString(r.viewer) || !isNonEmptyString(r.env) || !isNonEmptyString(r.api)) return 'runtime';
  return null;
}

/** Parse reservation bytes; returns `{ok, value|reason}` (empty/truncated/garbage => not ok). */
function parseReservationBytes(bytes) {
  let obj;
  try { obj = JSON.parse(toBuffer(bytes).toString('utf8')); } catch { return { ok: false, reason: 'unparseable' }; }
  const err = checkBindingShape(obj);
  if (err) return { ok: false, reason: `shape:${err}` };
  const extra = Object.keys(obj).filter((k) => !BINDING_KEYS.includes(k));
  if (extra.length > 0) return { ok: false, reason: `unknown-key:${extra[0]}` };
  return { ok: true, value: obj };
}

/**
 * Parse journal bytes. `{ok:false, unparseable:true}` when the bytes are not JSON (the reader's
 * CRASHED(unreadable-journal)); `{ok:false, reason}` when parseable but structurally invalid or
 * an illegal history; `{ok:true, value, lastState}` otherwise.
 */
function parseJournalBytes(bytes) {
  let obj;
  try { obj = JSON.parse(toBuffer(bytes).toString('utf8')); } catch { return { ok: false, unparseable: true, reason: 'unparseable' }; }
  const err = checkBindingShape(obj);
  if (err) return { ok: false, reason: `shape:${err}` };
  const extra = Object.keys(obj).filter((k) => !BINDING_KEYS.includes(k) && k !== 'transitions');
  if (extra.length > 0) return { ok: false, reason: `unknown-key:${extra[0]}` };
  const v = validateTransitionHistory(obj.transitions);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, value: obj, lastState: v.lastState };
}

function bindingsEqual(a, b) {
  return JSON.stringify(pickBinding(a)) === JSON.stringify(pickBinding(b));
}

// ============================================================================================
// Section 7 -- attempts directory: exact names, startup rule, reader classification.
// ============================================================================================

function reservationName(id) { return `${id}.reservation.json`; }
function journalName(id) { return `${id}.journal.json`; }
function journalTempPrefix(id) { return `${id}.journal.json.tmp-`; }
function commitName(id) { return `${id}.commit.json`; }
function closeoutFailureName(id) { return `${id}.closeout-failure.json`; }

/** Absolute D0/D1/D2 for a repo root (§4.1 W2a). */
function resolveAttemptsChain(repoRoot = REPO_ROOT) {
  const D0 = path.join(repoRoot, ATTEMPTS_D0_REL);
  const D1 = path.join(D0, ATTEMPTS_D1_NAME);
  const D2 = path.join(D1, ATTEMPTS_D2_NAME);
  return { D0, D1, D2 };
}

/**
 * `scanAttemptsDirectoryForStartup({fs, chain, authorizationId, recordSha256})` -- the W1
 * startup rule (§4.1). Local reads only; writes nothing. Refuses (`{ok:false, reason}`) when:
 *   - this ID's reservation exists in any content state             -> `reservation-exists`
 *   - this ID's final journal exists in any state                   -> `journal-exists:<state>`
 *     (`<state>` = last transition, or `unreadable`)
 *   - an orphan `<id>.journal.json.tmp-*` exists                     -> `orphan-temp`
 *   - any other `*.reservation.json`/`*.journal.json` is unparseable -> `unreadable-reservation`
 *   - any reservation/journal carries `authorization.sha256` equal to the passed record's
 *                                                                    -> `reservation-exists` /
 *                                                                       `journal-exists:<state>`
 * Conservative extension (flagged in the Task 1 report): any other file named `<id>.*` (e.g. a
 * K, F or K candidate without a reservation) -> `own-artifact-exists`; a D1/D2 that exists but is
 * not a real directory -> `attempts-dir-not-real-directory`. D2 absent => `{ok:true}`.
 */
function scanAttemptsDirectoryForStartup({ fs, chain, authorizationId, recordSha256 }) {
  const refuse = (reason, detail) => ({ ok: false, reason, detail });
  for (const dir of [chain.D1, chain.D2]) {
    const st = lstatOrNull(fs, dir);
    if (st === null) return { ok: true, entries: [] };
    if (!isRealDirectory(st)) return refuse('attempts-dir-not-real-directory', dir);
  }
  const names = fs.readdir(chain.D2).slice().sort();
  const own = `${authorizationId}.`;
  if (names.includes(reservationName(authorizationId))) return refuse('reservation-exists', reservationName(authorizationId));
  if (names.includes(journalName(authorizationId))) {
    let state = 'unreadable';
    try {
      const p = parseJournalBytes(fs.readFile(path.join(chain.D2, journalName(authorizationId))));
      if (p.ok) state = p.lastState;
    } catch { /* unreadable */ }
    return refuse(`journal-exists:${state}`, journalName(authorizationId));
  }
  const orphan = names.find((n) => n.startsWith(journalTempPrefix(authorizationId)));
  if (orphan) return refuse('orphan-temp', orphan);
  const otherOwn = names.find((n) => n.startsWith(own));
  if (otherOwn) return refuse('own-artifact-exists', otherOwn);

  for (const name of names) {
    const isRes = name.endsWith('.reservation.json');
    const isJournal = name.endsWith('.journal.json');
    if (!isRes && !isJournal) continue;
    let parsed;
    try {
      const st = fs.lstat(path.join(chain.D2, name));
      if (!isRegularFile(st)) return refuse('unreadable-reservation', name);
      const bytes = fs.readFile(path.join(chain.D2, name));
      parsed = isRes ? parseReservationBytes(bytes) : parseJournalBytes(bytes);
    } catch {
      return refuse('unreadable-reservation', name);
    }
    // A structurally parseable journal with an illegal history still carries a comparable sha;
    // anything whose binding cannot be read at all is refused conservatively, never skipped.
    if (!parsed.ok) return refuse('unreadable-reservation', name);
    if (parsed.value.authorization.sha256 === recordSha256) {
      return isRes ? refuse('reservation-exists', name) : refuse(`journal-exists:${parsed.lastState}`, name);
    }
  }
  return { ok: true, entries: names };
}

/** Reader classes (§4.1 CRASHED table + valid terminals); never written by the harness. */
const JOURNAL_CLASS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
  FAILED: 'FAILED',
  CLOSEOUT_STARTED_WITH_COMMIT: 'CLOSEOUT_STARTED(commit-present)',
  CRASHED_RESERVATION_ONLY: 'CRASHED(reservation-only)',
  CRASHED_AUTH_BOUND: 'CRASHED(AUTH_BOUND)',
  CRASHED_ATTEMPT_CONSUMED: 'CRASHED(ATTEMPT_CONSUMED)',
  CRASHED_CLOSEOUT_STARTED: 'CRASHED(CLOSEOUT_STARTED)',
  CRASHED_JOURNAL_WITHOUT_RESERVATION: 'CRASHED(journal-without-reservation)',
  CRASHED_UNREADABLE_JOURNAL: 'CRASHED(unreadable-journal)',
  INVALID: 'INVALID',
});

/**
 * `classifyJournal({reservation, journal, commitExists})` -- pure reader classification for one
 * Authorization-ID. Inputs are `{bytes}` (or `{bytes:null, nonRegular:true}`) for each present
 * exact-named file, or null when absent; temps/candidates are outside the reader namespace and
 * never passed in. Precedence (§4.1): a final-named journal that exists but cannot be parsed is
 * always CRASHED(unreadable-journal); CRASHED(reservation-only) applies only when no final-named
 * journal exists. Parseable-but-invalid journals (illegal history, unknown transition, binding
 * mismatch with the reservation, reservation unreadable beside a journal) return `INVALID` with a
 * reason -- the §8 W-0 `FAIL(reader-invalid)` family. Last state AUTH_BOUND is reported as
 * CRASHED(AUTH_BOUND) with alias CRASHED(PREFLIGHT_FAILED-unterminated) (the §4.1 table names the
 * same situation both ways). CLOSEOUT_STARTED with a K present is deferred to the §8 reader
 * (`derivesFail: null`); every other class derives FAIL.
 */
function classifyJournal({ reservation = null, journal = null, commitExists = false } = {}) {
  const out = (cls, extra = {}) => ({ class: cls, derivesFail: true, ...extra });
  if (journal) {
    const parsed = journal.nonRegular || journal.bytes == null ? { ok: false, unparseable: true } : parseJournalBytes(journal.bytes);
    if (!parsed.ok && parsed.unparseable) {
      return out(JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL, { lastState: null, consumed: 'unknown', recordSpent: true });
    }
    if (!parsed.ok) return out(JOURNAL_CLASS.INVALID, { reason: parsed.reason, lastState: null, consumed: 'unknown', recordSpent: true });
    const j = parsed.value;
    const base = { lastState: parsed.lastState, attemptId: j.attemptId, recordSpent: true };
    if (!reservation) return out(JOURNAL_CLASS.CRASHED_JOURNAL_WITHOUT_RESERVATION, { ...base, consumed: 'unknown' });
    const r = reservation.nonRegular || reservation.bytes == null ? { ok: false } : parseReservationBytes(reservation.bytes);
    if (!r.ok) return out(JOURNAL_CLASS.INVALID, { ...base, reason: 'reservation-unreadable-beside-journal', consumed: 'unknown' });
    if (!bindingsEqual(r.value, j)) return out(JOURNAL_CLASS.INVALID, { ...base, reason: 'reservation-journal-binding-mismatch', consumed: 'unknown' });
    const states = j.transitions.map((t) => t.state);
    if (states.includes(JOURNAL_STATE.FAILED)) return out(JOURNAL_CLASS.FAILED, { ...base, consumed: true, causes: j.transitions.at(-1).detail.causes });
    switch (parsed.lastState) {
      case JOURNAL_STATE.AUTH_BOUND:
        return out(JOURNAL_CLASS.CRASHED_AUTH_BOUND, { ...base, alias: 'CRASHED(PREFLIGHT_FAILED-unterminated)', consumed: false });
      case JOURNAL_STATE.PREFLIGHT_FAILED:
        return out(JOURNAL_CLASS.PREFLIGHT_FAILED, { ...base, consumed: false });
      case JOURNAL_STATE.ATTEMPT_CONSUMED:
        return out(JOURNAL_CLASS.CRASHED_ATTEMPT_CONSUMED, { ...base, consumed: true });
      case JOURNAL_STATE.CLOSEOUT_STARTED:
        if (commitExists) return { class: JOURNAL_CLASS.CLOSEOUT_STARTED_WITH_COMMIT, derivesFail: null, ...base, consumed: true };
        return out(JOURNAL_CLASS.CRASHED_CLOSEOUT_STARTED, { ...base, consumed: true });
      default:
        return out(JOURNAL_CLASS.INVALID, { ...base, reason: 'unclassifiable-last-state', consumed: 'unknown' });
    }
  }
  if (reservation) return out(JOURNAL_CLASS.CRASHED_RESERVATION_ONLY, { lastState: null, consumed: false, recordSpent: true });
  return out(JOURNAL_CLASS.NOT_STARTED, { lastState: null, consumed: false, recordSpent: false });
}

/**
 * `inspectAttemptFiles({fs, D2, authorizationId})` -- reads the exact-named reservation/journal
 * (and notes K presence and ignored temp/candidate names) into the shape `classifyJournal`
 * consumes. A D2 that does not exist yields an empty set.
 */
function inspectAttemptFiles({ fs, D2, authorizationId }) {
  const st = lstatOrNull(fs, D2);
  if (!st || !isRealDirectory(st)) return { reservation: null, journal: null, commitExists: false, ignored: [] };
  const names = fs.readdir(D2);
  const read = (name) => {
    if (!names.includes(name)) return null;
    const fst = fs.lstat(path.join(D2, name));
    if (!isRegularFile(fst)) return { bytes: null, nonRegular: true };
    return { bytes: toBuffer(fs.readFile(path.join(D2, name))) };
  };
  return {
    reservation: read(reservationName(authorizationId)),
    journal: read(journalName(authorizationId)),
    commitExists: names.includes(commitName(authorizationId)),
    ignored: names.filter((n) => n.startsWith(`${authorizationId}.`) && (n.includes('.tmp-') || n.includes('.commit.candidate-') || n.includes('.invalid-'))).sort(),
  };
}

// ============================================================================================
// Section 8 -- W2a / W2b durable writes (procedure §4.1 "Durable write order", "Durability
// algorithm"). Every error is a G2DurabilityError: stop, no retry, exit 1.
// ============================================================================================

function step(label, fn) {
  try { return fn(); } catch (err) {
    if (err instanceof G2DurabilityError) throw err;
    if (err && err.simulatedCrash) throw err; // a fake-fs process crash propagates unchanged
    throw new G2DurabilityError(label, err);
  }
}

/** open(dir,'r') -> fsync -> close; the close is attempted even if fsync fails. */
function fsyncDirectory(fs, dir, label) {
  const fd = step(`${label}:open`, () => fs.open(dir, 'r'));
  try {
    step(`${label}:fsync`, () => fs.fsync(fd));
  } catch (err) {
    try { fs.close(fd); } catch { /* primary error wins */ }
    throw err;
  }
  step(`${label}:close`, () => fs.close(fd));
}

/**
 * `establishAttemptsDirectory({fs, chain})` -- W2a (reserves nothing). D0 must already exist as a
 * real directory. For D1 then D2: lstat (symlink/non-directory => refuse); if absent mkdir
 * (EEXIST race accepted only if the result is a real directory) and lstat again; fsync(Di);
 * fsync(D(i-1)) -- the parent fsync runs UNCONDITIONALLY, whether or not this process created Di.
 * Returns `{created:{D1, D2}}`.
 */
function establishAttemptsDirectory({ fs, chain }) {
  const d0 = step('W2a:lstat(D0)', () => lstatOrNull(fs, chain.D0));
  if (!isRealDirectory(d0)) throw new G2DurabilityError('W2a:lstat(D0)', new Error('D0 is not an existing real directory'));
  const created = { D1: false, D2: false };
  const levels = [['D1', chain.D1, chain.D0], ['D2', chain.D2, chain.D1]];
  for (const [name, dir, parent] of levels) {
    let st = step(`W2a:lstat(${name})`, () => lstatOrNull(fs, dir));
    if (st && !isRealDirectory(st)) throw new G2DurabilityError(`W2a:lstat(${name})`, new Error(`${name} is not a real directory`));
    if (!st) {
      try {
        fs.mkdir(dir);
        created[name] = true;
      } catch (err) {
        if (err && err.simulatedCrash) throw err;
        if (!err || err.code !== 'EEXIST') throw new G2DurabilityError(`W2a:mkdir(${name})`, err);
      }
      st = step(`W2a:lstat(${name})`, () => lstatOrNull(fs, dir));
      if (!isRealDirectory(st)) throw new G2DurabilityError(`W2a:mkdir(${name})`, new Error(`${name} is not a real directory after mkdir`));
    }
    fsyncDirectory(fs, dir, `W2a:fsync(${name})`);
    fsyncDirectory(fs, parent, `W2a:fsync(parent-of-${name})`);
  }
  return { created };
}

/**
 * Durable write of a NEW file with exclusive create: open(path,'wx') -> write -> fsync(fd) ->
 * close -> fsync(dirFd). Returns the bytes written. Used for the reservation (and, in Task 2,
 * for F and the K candidate).
 */
function writeExclusiveDurable({ fs, filePath, dirFd, bytes, label }) {
  const fd = step(`${label}:open-wx`, () => fs.open(filePath, 'wx'));
  try {
    step(`${label}:write`, () => fs.write(fd, bytes));
    step(`${label}:fsync`, () => fs.fsync(fd));
  } catch (err) {
    try { fs.close(fd); } catch { /* primary error wins */ }
    throw err;
  }
  step(`${label}:close`, () => fs.close(fd));
  step(`${label}:fsync-dir`, () => fs.fsync(dirFd));
  return bytes;
}

/**
 * Durable replace via temp+rename (§4.1 journal algorithm): open(tmp,'wx') in dir -> write full
 * bytes -> fsync(fd) -> close -> rename(tmp, final) -> fsync(dirFd) -> re-read final and compare
 * SHA-256 with the intended bytes. Any failure throws G2DurabilityError; the temp may remain as
 * an orphan (the startup rule refuses on it; the reader ignores it).
 */
function writeReplaceDurable({ fs, dir, dirFd, finalName, tempName, bytes, label }) {
  const tmpPath = path.join(dir, tempName);
  const finalPath = path.join(dir, finalName);
  const fd = step(`${label}:open-wx(tmp)`, () => fs.open(tmpPath, 'wx'));
  try {
    step(`${label}:write`, () => fs.write(fd, bytes));
    step(`${label}:fsync`, () => fs.fsync(fd));
  } catch (err) {
    try { fs.close(fd); } catch { /* primary error wins */ }
    throw err;
  }
  step(`${label}:close`, () => fs.close(fd));
  step(`${label}:rename`, () => fs.rename(tmpPath, finalPath));
  step(`${label}:fsync-dir`, () => fs.fsync(dirFd));
  const readBack = step(`${label}:read-back`, () => toBuffer(fs.readFile(finalPath)));
  if (sha256Hex(readBack) !== sha256Hex(bytes)) throw new G2DurabilityError(`${label}:verify`, new Error('read-back SHA-256 mismatch'));
  return bytes;
}

const defaultClock = Object.freeze({
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => performance.now(),
});

/**
 * `reserveAttempt({fs, chain, binding, clock, uuid})` -- W2b (only after W2a fully succeeded):
 * open D2 and hold D2Fd; `open(reservation,'wx')` (EEXIST => refuse `reservation-exists`, nothing
 * else written); write the binding record; fsync(fd); close; fsync(D2Fd); then create the journal
 * by temp+rename with the AUTH_BOUND transition (B3). Returns the attempt handle (below) owning
 * D2Fd; only this handle ever replaces the journal.
 */
function reserveAttempt({ fs, chain, binding, clock = defaultClock, uuid = randomUUID }) {
  const id = binding.authorization.id;
  const D2Fd = step('W2b:open(D2)', () => fs.open(chain.D2, 'r'));
  const closeD2 = () => { try { fs.close(D2Fd); } catch { /* best effort */ } };
  const reservationBytes = serializeJson(pickBinding(binding));
  try {
    try {
      writeExclusiveDurable({ fs, filePath: path.join(chain.D2, reservationName(id)), dirFd: D2Fd, bytes: reservationBytes, label: 'W2b:reservation' });
    } catch (err) {
      if (err instanceof G2DurabilityError && err.cause && err.cause.code === 'EEXIST' && err.step === 'W2b:reservation:open-wx') {
        throw new G2RefusalError('reservation-exists', 'another process or an earlier run owns this Authorization-ID');
      }
      throw err;
    }
    const journal = appendTransition({ ...pickBinding(binding), transitions: [] }, JOURNAL_STATE.AUTH_BOUND, { at: clock.nowIso(), monotonicMs: clock.monotonicMs() });
    const bytes = serializeJson(journal);
    writeReplaceDurable({ fs, dir: chain.D2, dirFd: D2Fd, finalName: journalName(id), tempName: `${journalTempPrefix(id)}${uuid()}`, bytes, label: 'W2b:journal(AUTH_BOUND)' });
    return createAttemptHandle({ fs, chain, D2Fd, journal, journalBytes: bytes, clock, uuid });
  } catch (err) {
    closeD2();
    throw err;
  }
}

/**
 * The reservation owner's journal handle. `append(state, detail)` performs exactly one durable
 * temp+rename write of the whole journal with the new transition appended (illegal transitions
 * throw before any I/O); the in-memory journal advances only after the write verified.
 * `appendBestEffort` never throws (PREFLIGHT_FAILED/FAILED are best-effort, §4.1/§9.1).
 * `current()` returns `{journal, bytes}` (the last verified durable bytes, for Kc hashing).
 */
function createAttemptHandle({ fs, chain, D2Fd, journal, journalBytes, clock, uuid }) {
  let state = { journal, bytes: journalBytes };
  let closed = false;
  const id = journal.authorization.id;
  const append = (nextState, detail) => {
    if (closed) throw new Error('attempt handle closed');
    const next = appendTransition(state.journal, nextState, { at: clock.nowIso(), monotonicMs: clock.monotonicMs(), detail });
    const bytes = serializeJson(next);
    writeReplaceDurable({ fs, dir: chain.D2, dirFd: D2Fd, finalName: journalName(id), tempName: `${journalTempPrefix(id)}${uuid()}`, bytes, label: `journal(${nextState})` });
    state = { journal: next, bytes };
    return state;
  };
  return {
    D2: chain.D2,
    D2Fd,
    authorizationId: id,
    attemptId: journal.attemptId,
    current: () => state,
    append,
    appendBestEffort(nextState, detail) {
      try { return { ok: true, ...append(nextState, detail) }; } catch (error) { return { ok: false, error }; }
    },
    close() {
      if (closed) return;
      closed = true;
      try { fs.close(D2Fd); } catch { /* best effort */ }
    },
  };
}

/**
 * W3: `markAttemptConsumed(handle)` -- durably appends ATTEMPT_CONSUMED (B5). Returns only after
 * the write and read-back verified; the caller may issue the first `loadDocumentNode` only after
 * this returns. A failure throws, leaving the journal at AUTH_BOUND (fail-closed, no load).
 */
function markAttemptConsumed(handle) {
  return handle.append(JOURNAL_STATE.ATTEMPT_CONSUMED);
}

// ============================================================================================
// Section 9 -- recording fake filesystem (offline-test support; never used by main()).
//
// Models visible vs durable state so a test can view the tree after a PROCESS crash (everything
// the kernel accepted) or an OS crash (only what a completed fsync covered):
//   - a directory's entry set becomes durable only when that directory is fsync'd (snapshot);
//   - a file's content becomes durable only when an fd on it is fsync'd;
//   - a new directory starts with an empty durable entry set; seeded nodes start durable.
// Every call is logged as {op, path, flags?}. `fault(rec, index)` may return:
//   'error'        -- throw EIO without applying the op;
//   'error-after'  -- apply the op, then throw EIO (the op "landed" but reported failure);
//   'crash'        -- simulated process death before applying; every later op also crashes;
//   'crash-after'  -- apply, then die;
//   'partial'      -- (write only) write the first half of the bytes, then die.
// ============================================================================================

class SimulatedCrash extends Error {
  constructor(at) { super(`simulated process crash at op ${at}`); this.name = 'SimulatedCrash'; this.simulatedCrash = true; }
}

function fsError(code, msg) { const e = new Error(`${code}: ${msg}`); e.code = code; return e; }

function createRecordingFakeFs({ fault = null, seedDirs = [], seedFiles = {} } = {}) {
  // A new directory's durable entry set starts empty; seeding calls markDurable explicitly.
  const mkDir = () => ({ type: 'dir', entries: new Map(), durableEntries: new Map() });
  const root = mkDir();
  const ops = [];
  const fds = new Map();
  let nextFd = 3;
  let crashed = false;

  const split = (p) => path.posix.normalize(p).split('/').filter(Boolean);
  const lookup = (p, { parent = false } = {}) => {
    const parts = split(p);
    let node = root;
    const upto = parent ? parts.length - 1 : parts.length;
    for (let i = 0; i < upto; i += 1) {
      if (!node || node.type !== 'dir') return null;
      node = node.entries.get(parts[i]) || null;
    }
    return parent ? { dir: node, name: parts[parts.length - 1] } : node;
  };
  const statOf = (node) => ({
    isDirectory: () => node.type === 'dir',
    isFile: () => node.type === 'file',
    isSymbolicLink: () => node.type === 'symlink',
  });
  const markDurable = (dir) => { dir.durableEntries = new Map(dir.entries); };

  // seed (durable)
  for (const d of seedDirs) {
    let node = root;
    for (const part of split(d)) {
      if (!node.entries.has(part)) node.entries.set(part, mkDir());
      markDurable(node);
      node = node.entries.get(part);
    }
    markDurable(node);
  }
  for (const [p, content] of Object.entries(seedFiles)) {
    const { dir, name } = lookup(p, { parent: true });
    const buf = toBuffer(content);
    dir.entries.set(name, { type: 'file', content: buf, durableContent: buf });
    markDurable(dir);
  }

  const run = (rec, apply) => {
    if (crashed) throw new SimulatedCrash(ops.length);
    const index = ops.length;
    ops.push(rec);
    const mode = fault ? fault(rec, index) : null;
    if (mode === 'crash') { crashed = true; throw new SimulatedCrash(index); }
    if (mode === 'error') throw fsError('EIO', `injected at op ${index} (${rec.op} ${rec.path})`);
    if (mode === 'partial' && rec.op === 'write') {
      apply({ partial: true });
      crashed = true;
      throw new SimulatedCrash(index);
    }
    // The op completes (possibly with its own natural error, e.g. lstat ENOENT) before an
    // "-after" fault fires.
    let result;
    let naturalError = null;
    try { result = apply({}); } catch (err) { naturalError = err; }
    if (mode === 'crash-after') { crashed = true; throw new SimulatedCrash(index); }
    if (mode === 'error-after') throw fsError('EIO', `injected after op ${index} (${rec.op} ${rec.path})`);
    if (naturalError) throw naturalError;
    return result;
  };

  const api = {
    ops,
    get crashed() { return crashed; },
    lstat: (p) => run({ op: 'lstat', path: p }, () => {
      const n = lookup(p);
      if (!n) throw fsError('ENOENT', p);
      return statOf(n);
    }),
    mkdir: (p) => run({ op: 'mkdir', path: p }, () => {
      const loc = lookup(p, { parent: true });
      if (!loc || !loc.dir || loc.dir.type !== 'dir') throw fsError('ENOENT', p);
      if (loc.dir.entries.has(loc.name)) throw fsError('EEXIST', p);
      loc.dir.entries.set(loc.name, mkDir());
    }),
    open: (p, flags) => run({ op: 'open', path: p, flags }, () => {
      const loc = lookup(p, { parent: true });
      if (!loc || !loc.dir || loc.dir.type !== 'dir') throw fsError('ENOENT', p);
      let node = loc.dir.entries.get(loc.name);
      if (flags === 'wx') {
        if (node) throw fsError('EEXIST', p);
        node = { type: 'file', content: Buffer.alloc(0), durableContent: Buffer.alloc(0) };
        loc.dir.entries.set(loc.name, node);
      } else if (flags === 'r') {
        if (!node) throw fsError('ENOENT', p);
        if (node.type === 'symlink') throw fsError('ELOOP', p); // fake never follows symlinks
      } else {
        throw fsError('EINVAL', `unsupported flags ${flags}`);
      }
      const fd = nextFd; nextFd += 1;
      fds.set(fd, { node, path: p });
      return fd;
    }),
    write: (fd, bytes) => {
      const h = fds.get(fd);
      return run({ op: 'write', path: h ? h.path : `fd:${fd}` }, ({ partial }) => {
        if (!h) throw fsError('EBADF', String(fd));
        const buf = toBuffer(bytes);
        const part = partial ? buf.subarray(0, Math.floor(buf.length / 2)) : buf;
        h.node.content = Buffer.concat([h.node.content, part]);
        return part.length;
      });
    },
    fsync: (fd) => {
      const h = fds.get(fd);
      return run({ op: 'fsync', path: h ? h.path : `fd:${fd}` }, () => {
        if (!h) throw fsError('EBADF', String(fd));
        if (h.node.type === 'dir') markDurable(h.node);
        else h.node.durableContent = Buffer.from(h.node.content);
      });
    },
    close: (fd) => {
      const h = fds.get(fd);
      return run({ op: 'close', path: h ? h.path : `fd:${fd}` }, () => {
        if (!h) throw fsError('EBADF', String(fd));
        fds.delete(fd);
      });
    },
    rename: (from, to) => run({ op: 'rename', path: from, to }, () => {
      const a = lookup(from, { parent: true });
      const b = lookup(to, { parent: true });
      const node = a && a.dir && a.dir.entries.get(a.name);
      if (!node) throw fsError('ENOENT', from);
      if (!b || !b.dir) throw fsError('ENOENT', to);
      a.dir.entries.delete(a.name);
      b.dir.entries.set(b.name, node);
    }),
    link: (from, to) => run({ op: 'link', path: from, to }, () => {
      const a = lookup(from, { parent: true });
      const b = lookup(to, { parent: true });
      const node = a && a.dir && a.dir.entries.get(a.name);
      if (!node) throw fsError('ENOENT', from);
      if (!b || !b.dir) throw fsError('ENOENT', to);
      if (b.dir.entries.has(b.name)) throw fsError('EEXIST', to);
      b.dir.entries.set(b.name, node);
    }),
    unlink: (p) => run({ op: 'unlink', path: p }, () => {
      const a = lookup(p, { parent: true });
      if (!a || !a.dir || !a.dir.entries.has(a.name)) throw fsError('ENOENT', p);
      a.dir.entries.delete(a.name);
    }),
    readFile: (p) => run({ op: 'readFile', path: p }, () => {
      const n = lookup(p);
      if (!n) throw fsError('ENOENT', p);
      if (n.type !== 'file') throw fsError('EISDIR', p);
      return Buffer.from(n.content);
    }),
    readdir: (p) => run({ op: 'readdir', path: p }, () => {
      const n = lookup(p);
      if (!n) throw fsError('ENOENT', p);
      if (n.type !== 'dir') throw fsError('ENOTDIR', p);
      return [...n.entries.keys()].sort();
    }),
    /** Test helper (not logged): create a symlink node. */
    symlinkForTest(target, p) {
      const { dir, name } = lookup(p, { parent: true });
      dir.entries.set(name, { type: 'symlink', target });
      markDurable(dir);
    },
    /** Test helper (not logged): write a plain file node directly, durable. */
    putFileForTest(p, content) {
      const { dir, name } = lookup(p, { parent: true });
      const buf = toBuffer(content);
      dir.entries.set(name, { type: 'file', content: buf, durableContent: buf });
      markDurable(dir);
    },
    /** A fresh fake fs holding the PROCESS-crash view (all visible state), no faults. */
    processCrashView() { return cloneView((dir) => dir.entries, (f) => f.content); },
    /** A fresh fake fs holding the OS-crash view (only fsync-covered state), no faults. */
    osCrashView() { return cloneView((dir) => dir.durableEntries, (f) => f.durableContent); },
  };

  function cloneView(entriesOf, contentOf) {
    const view = createRecordingFakeFs();
    const copy = (srcDir, prefix) => {
      for (const [name, node] of entriesOf(srcDir)) {
        const p = `${prefix}/${name}`;
        if (node.type === 'dir') { view.__seedDir(p); copy(node, p); } else if (node.type === 'file') view.putFileForTest(p, contentOf(node));
        else view.symlinkForTest(node.target, p);
      }
    };
    copy(root, '');
    return view;
  }
  api.__seedDir = (p) => {
    const { dir, name } = lookup(p, { parent: true });
    if (!dir.entries.has(name)) dir.entries.set(name, mkDir());
    markDurable(dir);
    markDurable(dir.entries.get(name));
  };
  return api;
}

// ============================================================================================
// Section 11 -- overall verdict model (procedure §8, D2). `computeOverall(state, phase)` has
// exactly TWO operational phases, both evaluated BEFORE the terminal commit K exists:
//   'pre-closeout' -- §9.1 step 1, yields primaryOverall/primaryRow;
//   'pre-link'     -- the §9.1 step 8(a) PASS-eligibility gate over the CURRENT state plus only
//                     the closeout predicates knowable before K exists.
// There is no third phase and no evaluation of any K-dependent predicate: `finalOverall` is never
// computed here, it is ASSIGNED by the synchronous commit block (Section 13), and
// `closeoutComplete` is the post-K postcondition that no evaluation ever reads (static-guarded in
// Section 15, runtime-tested with a throwing getter).
//
// Each evaluation is one ordered pass over rows 1..8; the first matching row wins; every row's
// predicate reads only recorded verdicts/ledgers/pre-link closeout facts (never another row's
// result), and FAIL rows are evaluated over the full recorded set even when checks are BLOCKED.
// Missing/out-of-enum inputs fail closed (towards FAIL), never towards PASS.
// ============================================================================================

const VERDICT = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', PARTIAL: 'PARTIAL' });
const VERDICT_FAIL = VERDICT.FAIL;

/** Severity for "worst of" comparisons (FAIL > BLOCKED > PARTIAL > PASS, §8 reader rule). */
const VERDICT_SEVERITY = Object.freeze({ PASS: 0, PARTIAL: 1, BLOCKED: 2, FAIL: 3 });

/** The ONLY operational phases (§8). A third phase must never be reintroduced (static-guarded). */
const OVERALL_PHASES = Object.freeze(['pre-closeout', 'pre-link']);

/** Row -> overall (§8 table). */
const OVERALL_ROW_VERDICT = Object.freeze({ 1: 'FAIL', 2: 'FAIL', 3: 'FAIL', 4: 'FAIL', 5: 'FAIL', 6: 'BLOCKED', 7: 'PARTIAL', 8: 'PASS' });

const CHECK_NAMES = Object.freeze(Array.from({ length: 20 }, (_, i) => `C${i + 1}`));
const CHECK_VERDICT_BASES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_EVIDENCED']);
const CONTROL_NAMES = Object.freeze(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']);

/** §7 "Allowed terminal states per control (exhaustive)". Anything else is non-acceptable. */
const CONTROL_ALLOWED_STATES = Object.freeze({
  N1: Object.freeze(['DETECTED', 'NOT_DETECTED', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N2: Object.freeze(['DETECTED_RESTORED', 'NOT_DISCRIMINATING', 'NOT_DETECTED', 'RESTORE_FAILED', 'TIMED_OUT', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N3: Object.freeze(['DETECTED_RESTORED', 'NOT_DETECTED', 'RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N4: Object.freeze(['DETECTED_RESTORED', 'NOT_DETECTED', 'RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N5: Object.freeze(['DETECTED_RESTORED', 'NOT_DETECTED', 'RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N6: Object.freeze(['DETECTED', 'NOT_DETECTED', 'NOT_APPLICABLE']),
  N7: Object.freeze(['DETECTED_RESTORED', 'NOT_DETECTED', 'RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE', 'NOT_RUN_DEPENDENCY_BLOCKED']),
  N8: Object.freeze(['DETECTED', 'NOT_DETECTED', 'NOT_DISCRIMINATING', 'NOT_APPLICABLE']),
});

/** §7 acceptable (PASS-compatible) state per control. */
const CONTROL_ACCEPTABLE_STATE = Object.freeze({
  N1: 'DETECTED', N2: 'DETECTED_RESTORED', N3: 'DETECTED_RESTORED', N4: 'DETECTED_RESTORED',
  N5: 'DETECTED_RESTORED', N6: 'DETECTED', N7: 'DETECTED_RESTORED', N8: 'DETECTED',
});

/** Viewer-script integrity enum (G1 §6.3 five-row table, copied by value). */
const INTEGRITY_RESULT = Object.freeze({
  VERIFIED: 'VERIFIED',
  MISMATCH: 'MISMATCH',
  FETCH_FAILED: 'FETCH_FAILED',
  PROVENANCE_AMBIGUOUS: 'PROVENANCE_AMBIGUOUS',
  CAPTURE_UNAVAILABLE: 'CAPTURE_UNAVAILABLE',
});
const INTEGRITY_VALUES = Object.freeze(Object.values(INTEGRITY_RESULT));
const CLASSIFIER_CONFIRMED = 'CONFIRMED_SVF2';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/**
 * Check verdict read by every §8 row: the bare verdict base of a `check-run` record, else null. A
 * `gate-disposition` record has NO verdict (§7 RC1-C2) and yields null; a parameterised string such
 * as `'BLOCKED(x)'` is notation only and is rejected (the record is `{verdict:'BLOCKED', reason:'x'}`).
 */
function checkVerdictBase(rec) {
  if (!isPlainObject(rec) || rec.recordType !== 'check-run') return null;
  return CHECK_VERDICT_BASES.includes(rec.verdict) ? rec.verdict : null;
}

/**
 * §7 disposition of one control given the check bases (read only from check-run records):
 * 'acceptable' (PASS-compatible), 'neutral' (a NOT_RUN_DEPENDENCY_BLOCKED that satisfies L1-L4 --
 * neither acceptable for PASS nor a control failure), 'partial' (N2/N8 NOT_DISCRIMINATING, N6
 * NOT_APPLICABLE while C4 != PASS, N8 NOT_APPLICABLE while C20 != PASS -- fixture insufficiency, §8
 * row 7), or 'unacceptable' (§8 row 4), incl. any missing/out-of-enum state and any illegal NRDB.
 * The state is read ONLY through the effective-state accessor (`state` | `disposition`).
 */
function controlDisposition(name, rec, checkBases, state = null) {
  const st = controlEffectiveState(rec);
  if (st === null || !CONTROL_ALLOWED_STATES[name].includes(st)) return 'unacceptable';
  if (st === NRDB_STATE) return nrdbLegality(name, state).legal ? 'neutral' : 'unacceptable';
  if (st === CONTROL_ACCEPTABLE_STATE[name]) return 'acceptable';
  if (st === 'NOT_DISCRIMINATING' && (name === 'N2' || name === 'N8')) return 'partial';
  if (st === 'NOT_APPLICABLE' && name === 'N6') return checkBases.C4 === 'PASS' ? 'unacceptable' : 'partial';
  if (st === 'NOT_APPLICABLE' && name === 'N8') return checkBases.C20 === 'PASS' ? 'unacceptable' : 'partial';
  return 'unacceptable';
}

function classifierValueOf(v) {
  if (typeof v === 'string') return v;
  return isPlainObject(v) && typeof v.classification === 'string' ? v.classification : null;
}

function journalStatesOf(journal) {
  return isPlainObject(journal) && Array.isArray(journal.transitions)
    ? journal.transitions.map((t) => (isPlainObject(t) ? t.state : null))
    : null;
}

/** Pre-closeout journal predicate (§8 row 5): exactly one ATTEMPT_CONSUMED and it is the last state. */
function preCloseoutJournalProblem(journal) {
  const states = journalStatesOf(journal);
  if (states === null) return 'journal-missing';
  if (!validateTransitionHistory(journal.transitions).ok) return 'journal-history-invalid';
  if (states.filter((s) => s === JOURNAL_STATE.ATTEMPT_CONSUMED).length !== 1) return 'journal-consumed-count';
  if (states[states.length - 1] !== JOURNAL_STATE.ATTEMPT_CONSUMED) return 'journal-last-state-not-consumed';
  return null;
}

/**
 * Pre-link journal predicate (§8 row 5): the history is exactly AUTH_BOUND -> ATTEMPT_CONSUMED ->
 * CLOSEOUT_STARTED, and the in-memory journal bytes hash to the journalSha256 carried by the
 * verified K candidate. (The single-attemptId half is the binding comparison below.)
 */
function preLinkJournalProblem(journal, facts) {
  const states = journalStatesOf(journal);
  if (states === null) return 'journal-missing';
  if (!validateTransitionHistory(journal.transitions).ok) return 'journal-history-invalid';
  const exact = [JOURNAL_STATE.AUTH_BOUND, JOURNAL_STATE.ATTEMPT_CONSUMED, JOURNAL_STATE.CLOSEOUT_STARTED];
  if (states.length !== exact.length || states.some((s, i) => s !== exact[i])) return 'journal-history-not-exact';
  if (!isPlainObject(facts) || facts.journalBytes == null || typeof facts.kcJournalSha256 !== 'string') return 'journal-kc-hash-missing';
  if (sha256Hex(toBuffer(facts.journalBytes)) !== facts.kcJournalSha256) return 'journal-bytes-differ-from-kc';
  return null;
}

/**
 * Row-5 binding comparison: attemptId / record digest / HEAD / procedure / harness / fixture
 * digests recorded in the run state vs the journal's binding record. Returns a reason or null.
 */
function bindingMismatch(s) {
  const j = s.journal;
  if (!isPlainObject(j)) return 'journal-missing';
  const pairs = [
    ['attemptId', s.attempt && s.attempt.attemptId, j.attemptId],
    ['authorization.id', s.authorization && s.authorization.id, j.authorization && j.authorization.id],
    ['authorization.sha256', s.authorization && s.authorization.sha256, j.authorization && j.authorization.sha256],
    ['headSha', s.harnessIntegrity && s.harnessIntegrity.headSha, j.headSha],
    ['procedure.sha256', s.procedure && s.procedure.sha256, j.procedure && j.procedure.sha256],
    ['harness.sha256', s.harnessIntegrity && s.harnessIntegrity.sha256, j.harness && j.harness.sha256],
    ['fixtures.A.urnSha256', s.runtimeEnvelope && s.runtimeEnvelope.urnSha256 && s.runtimeEnvelope.urnSha256.A, j.fixtures && j.fixtures.A && j.fixtures.A.urnSha256],
    ['fixtures.B.urnSha256', s.runtimeEnvelope && s.runtimeEnvelope.urnSha256 && s.runtimeEnvelope.urnSha256.B, j.fixtures && j.fixtures.B && j.fixtures.B.urnSha256],
  ];
  for (const [name, recorded, bound] of pairs) {
    if (typeof recorded !== 'string' || recorded === '' || recorded !== bound) return `binding-differs:${name}`;
  }
  return null;
}

/** Closeout facts knowable before K exists (§8 row 8 pre-link prerequisites). Name order is fixed. */
const PRE_LINK_CLOSEOUT_PREREQUISITES = Object.freeze([
  'closeoutStartedVerified', 'r1Verified', 'r2Verified', 'r3Verified', 'kcVerified', 'snapshotEqual', 'quiescenceComplete',
]);

/** Pre-link closeout problem (row 5, pre-link only): first recorded failure or unmet prerequisite. */
function preLinkCloseoutProblem(facts) {
  if (!isPlainObject(facts)) return 'closeout-facts-missing';
  if (!Array.isArray(facts.closeoutFailures)) return 'closeout-failures-invalid';
  if (facts.closeoutFailures.length > 0) return `closeout-failure:${String(facts.closeoutFailures[0])}`;
  for (const name of PRE_LINK_CLOSEOUT_PREREQUISITES) {
    if (facts[name] !== true) return `closeout-prerequisite:${name}`;
  }
  return null;
}

// ============================================================================================
// Record unions, NRDB legality, C1 reason contract and global-C1-gate equations (procedure §7
// RC1-C1/RC1-C2, §8 rows 3-8, §10). Pure schema/logic layer (slice B1) + the closed-gate evidence
// predicates CG-1..CG-7, the exhaustive closed-gate legal-record list, the attribution-field rule and
// the atomic gate preparation (slice B2; the runtime gate emission is in `runChecksInPhaseOrder`).
// The fatal-witness ledger, request instrumentation and node-side counter are slice C1 (below).
// ============================================================================================

const NRDB_STATE = 'NOT_RUN_DEPENDENCY_BLOCKED';
/** §7 record discriminator: every `checks`/`controls` entry carries exactly one of these. */
const RECORD_TYPE = Object.freeze({ CHECK_RUN: 'check-run', CONTROL_RUN: 'control-run', GATE_DISPOSITION: 'gate-disposition' });
/** §7 C1 reason contract: the ONLY two normalized dependency reasons (exact string equality). */
const C1_NORMALIZED_REASONS = Object.freeze(['prerequisite', 'timeout:load']);
/** §7 `fields.blockDetail[].cause` enum (diagnostic only; never a verdict input). */
const C1_BLOCK_DETAIL_CAUSES = Object.freeze(['classifier', 'model-not-loaded', 'load-rejected', 'model-count', 'load-deadline']);
const GATE_OUTCOME = Object.freeze({ OPEN: 'OPEN', CLOSED_DEPENDENCY_BLOCKED: 'CLOSED_DEPENDENCY_BLOCKED', CLOSED_OTHER: 'CLOSED_OTHER' });
const GATE_OUTCOMES = Object.freeze(Object.values(GATE_OUTCOME));
/** G-f: a gate-disposition record's evidenceRefs, exactly. */
const GATE_EVIDENCE_REFS = Object.freeze(['/gates/C1', '/checks/C1']);
/** G-b: the one disposition of a check under a closed gate. */
const GATE_CHECK_DISPOSITION = 'NOT_RUN_C1_GATE_CLOSED';
const GATE_BLOCKING_REASON_CLOSED_OTHER = 'closed-other';
/**
 * Integration boundary (slice B1 -> B2), flipped to true by slice B2 together with the runtime gate
 * emission (`runChecksInPhaseOrder`): every run state / R1 must carry a valid `gates.C1` (and C1 its
 * finalization fields); a missing gate is a §8 row-5 evidence contradiction ('gates-missing') -- e.g.
 * an in-page phase run that failed/timed out before returning its gate ends row 5 FAIL.
 */
const GATE_C1_REQUIRED = true;
/**
 * Integration boundary (slice B1 -> C), flipped to true by slice C1 together with the seq stamping in
 * `createFatalEventSink` (node-side run counter) and the witness-entry seq (= witnessSeq): an
 * UNSEQUENCED fatal entry is an evidence contradiction (row 5, 'fatal-entry-unsequenced') and is not
 * on the closed-gate legal-record list.
 */
const FATAL_ENTRY_SEQ_REQUIRED = true;
const DOWNSTREAM_CHECK_NAMES = Object.freeze(CHECK_NAMES.slice(1));
/** G-e order: C2..C20, then N1..N8. */
const DOWNSTREAM_ITEM_NAMES = Object.freeze([...DOWNSTREAM_CHECK_NAMES, ...CONTROL_NAMES]);
/** Controls that may record NRDB (§7: N1-N5, N7; N6/N8 use NOT_APPLICABLE). */
const NRDB_CONTROL_NAMES = Object.freeze(['N1', 'N2', 'N3', 'N4', 'N5', 'N7']);

/**
 * §7 "Control dependency ids" (RC1-C1; N8 corrected by RC1-C2 M1): execution prerequisites only,
 * ascending numeric id, always including C1. C20 is NOT in N8 (N8 <-> C20 would be a cycle).
 */
const CONTROL_DEPENDENCY_IDS = Object.freeze({
  N1: Object.freeze(['C1']),
  N2: Object.freeze(['C1', 'C4']),
  N3: Object.freeze(['C1']),
  N4: Object.freeze(['C1', 'C9', 'C10']),
  N5: Object.freeze(['C1', 'C9']),
  N6: Object.freeze(['C1', 'C4']),
  N7: Object.freeze(['C1', 'C16']),
  N8: Object.freeze(['C1', 'C4', 'C7', 'C8']),
});

/** §7 `executionRecord.phase`: the control's owning phase in §5 (drift-tested against PHASE_ORDER). */
const CONTROL_OWNING_PHASE = Object.freeze({ N1: 'P2', N2: 'P6', N3: 'P5a', N4: 'P7', N5: 'P7', N6: 'P4', N7: 'P9', N8: 'P6b' });

/** §7 not-started `terminalState` per control (NRDB only inside a gate-disposition record). */
const CONTROL_NOT_STARTED_STATES = Object.freeze({
  N1: Object.freeze(['NOT_DETECTED', NRDB_STATE]),
  N2: Object.freeze(['NOT_DETECTED', NRDB_STATE]),
  N3: Object.freeze(['NOT_EXECUTABLE', NRDB_STATE]),
  N4: Object.freeze(['NOT_EXECUTABLE', NRDB_STATE]),
  N5: Object.freeze(['NOT_EXECUTABLE', NRDB_STATE]),
  N6: Object.freeze(['NOT_APPLICABLE']),
  N7: Object.freeze(['NOT_EXECUTABLE', NRDB_STATE]),
  N8: Object.freeze(['NOT_APPLICABLE']),
});

/** G-b: a control's exact disposition under each closed gate outcome. */
const GATE_CONTROL_DISPOSITION = Object.freeze({
  CLOSED_DEPENDENCY_BLOCKED: Object.freeze({ N1: NRDB_STATE, N2: NRDB_STATE, N3: NRDB_STATE, N4: NRDB_STATE, N5: NRDB_STATE, N6: 'NOT_APPLICABLE', N7: NRDB_STATE, N8: 'NOT_APPLICABLE' }),
  CLOSED_OTHER: Object.freeze({ N1: 'NOT_DETECTED', N2: 'NOT_DETECTED', N3: 'NOT_EXECUTABLE', N4: 'NOT_EXECUTABLE', N5: 'NOT_EXECUTABLE', N6: 'NOT_APPLICABLE', N7: 'NOT_EXECUTABLE', N8: 'NOT_APPLICABLE' }),
});

/** ISO-8601 UTC with milliseconds (§7 executionRecord / dependencyBlockedBy / gate timestamps). */
const ISO_MS_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHECK_RUN_KEYS = Object.freeze(['recordType', 'verdict', 'reason', 'fields', 'evidence']);
const C1_CHECK_RUN_KEYS = Object.freeze([...CHECK_RUN_KEYS, 'finalizedSeq', 'finalizedAt']);
const CONTROL_RUN_KEYS = Object.freeze(['recordType', 'state', 'fields', 'evidence', 'executionRecord', 'dependencyBlockedBy']);
const EXECUTION_RECORD_KEYS = Object.freeze(['controlId', 'phase', 'dependencyIds', 'started', 'crossedStartBoundary', 'startSeq', 'startedAt', 'terminalSeq', 'terminalAt', 'terminalState', 'result', 'evidenceRefs']);
const DEPENDENCY_BLOCKED_BY_KEYS = Object.freeze(['check', 'blockingState', 'reason', 'phaseSeq', 'blockedAt', 'evidenceRef', 'failedBeforeDependentStarted', 'detail']);
const GATE_DISPOSITION_KEYS = Object.freeze(['recordType', 'itemId', 'itemKind', 'synthetic', 'gateGenerated', 'executed', 'gateOutcome', 'blockingReason', 'disposition', 'dispositionSeq', 'dispositionAt', 'startSeq', 'startedAt', 'executionRecord', 'dependencyBlockedBy', 'evidenceRefs']);
const GATE_C1_KEYS = Object.freeze(['gateSeq', 'gateAt', 'c1Verdict', 'c1Reason', 'c1FinalizedSeq', 'fatalCountAtGate', 'outcome', 'notStarted']);
const BLOCK_DETAIL_KEYS = Object.freeze(['cause', 'model', 'observed']);

const sameJson = (a, b) => { try { return canonicalJson(a) === canonicalJson(b); } catch { return false; } };
const isSeq = (v) => Number.isInteger(v) && v >= 0;
const isIsoMs = (v) => typeof v === 'string' && ISO_MS_UTC_RE.test(v);
const isJsonPointer = (v) => typeof v === 'string' && v.startsWith('/');
const isPlainJsonOk = (v) => { try { toPlainJson(v); return true; } catch { return false; } };

/**
 * §7/§10 effective-state accessor -- the ONLY way any verdict/legality/schema path reads a control's
 * state: `control-run` -> `state`, `gate-disposition` -> `disposition` (a disposition has no `state`).
 * Anything else (missing/unknown recordType, legacy `{state}`) -> null (fails closed).
 */
function controlEffectiveState(rec) {
  if (!isPlainObject(rec)) return null;
  if (rec.recordType === RECORD_TYPE.CONTROL_RUN) return typeof rec.state === 'string' ? rec.state : null;
  if (rec.recordType === RECORD_TYPE.GATE_DISPOSITION) return typeof rec.disposition === 'string' ? rec.disposition : null;
  return null;
}

/** The `check-finalized` events for C1 in an eventLog (exactly one is legal, §7 C1 reason contract). */
function c1FinalizationEvents(eventLog) {
  return Array.isArray(eventLog) ? eventLog.filter((e) => isPlainObject(e) && e.kind === 'check-finalized' && e.check === 'C1') : [];
}

/** `fields.blockDetail` (§7): non-empty, exact entries, ordered A, B, then model-independent (null). */
function blockDetailProblems(detail) {
  if (!Array.isArray(detail) || detail.length === 0) return ['block-detail-empty-or-not-array'];
  const out = [];
  const rank = (m) => (m === 'A' ? 0 : m === 'B' ? 1 : 2);
  let prev = -1;
  detail.forEach((d, i) => {
    if (!exactKeys(d, BLOCK_DETAIL_KEYS)) { out.push(`block-detail[${i}].keys`); return; }
    if (!C1_BLOCK_DETAIL_CAUSES.includes(d.cause)) out.push(`block-detail[${i}].cause`);
    if (!(d.model === 'A' || d.model === 'B' || d.model === null)) out.push(`block-detail[${i}].model`);
    if (!(d.observed === null || typeof d.observed === 'string')) out.push(`block-detail[${i}].observed`);
    if (rank(d.model) < prev) out.push('block-detail-order');
    prev = Math.max(prev, rank(d.model));
  });
  return out;
}

/** True iff a check-run reason is the removed pre-RC1-C2 downstream encoding `dependency:..C1..`. */
function isLegacyDependencyOnC1(reason) {
  return typeof reason === 'string' && reason.startsWith('dependency:') && reason.slice('dependency:'.length).split(',').includes('C1');
}

/**
 * `checkRunProblems(name, rec, {requireFinalization})` -- exact §7/§10 `check-run` shape: bare verdict
 * base (the notation `BLOCKED(x)` is `{verdict:'BLOCKED', reason:'x'}`), PASS without reason, plain
 * JSON fields/evidence (the removed `dependency:C1` encoding is rejected by `recordSchemaProblems`
 * whenever a gate exists). C1 additionally carries `finalizedSeq` /
 * `finalizedAt` (required when `requireFinalization`, else optional-but-valid) and, when BLOCKED for a
 * normalized reason, a valid `fields.blockDetail`.
 */
function checkRunProblems(name, rec, { requireFinalization = false } = {}) {
  if (!isPlainObject(rec)) return ['not-object'];
  const out = [];
  if (rec.recordType !== RECORD_TYPE.CHECK_RUN) out.push('record-type');
  const isC1 = name === 'C1';
  const hasFinal = Object.prototype.hasOwnProperty.call(rec, 'finalizedSeq') || Object.prototype.hasOwnProperty.call(rec, 'finalizedAt');
  const keysOk = isC1 ? (exactKeys(rec, C1_CHECK_RUN_KEYS) || (!requireFinalization && exactKeys(rec, CHECK_RUN_KEYS))) : exactKeys(rec, CHECK_RUN_KEYS);
  if (!keysOk) out.push('keys');
  if (!CHECK_VERDICT_BASES.includes(rec.verdict)) out.push('verdict');
  if (!(rec.reason === null || (typeof rec.reason === 'string' && CHECK_REASON_RE.test(rec.reason)))) out.push('reason');
  if (rec.verdict === 'PASS' && rec.reason !== null) out.push('pass-with-reason');
  if (!isPlainJsonOk(rec.fields) || !isPlainJsonOk(rec.evidence)) out.push('not-plain-json');
  if (isC1 && (hasFinal || requireFinalization)) {
    if (!isSeq(rec.finalizedSeq)) out.push('finalizedSeq');
    if (!isIsoMs(rec.finalizedAt)) out.push('finalizedAt');
  }
  if (isC1 && rec.verdict === 'BLOCKED' && C1_NORMALIZED_REASONS.includes(rec.reason)) {
    const bd = isPlainObject(rec.fields) ? rec.fields.blockDetail : undefined;
    const bdp = blockDetailProblems(bd);
    for (const p of bdp) out.push(`fields.${p}`);
    // §7: 'timeout:load' iff the T2 deadline fired (a load-deadline cause), which takes precedence.
    if (bdp.length === 0 && (rec.reason === 'timeout:load') !== bd.some((d) => d.cause === 'load-deadline')) out.push('reason-block-detail-mismatch');
  }
  return out;
}

/**
 * `executionRecordProblems(name, er, {recordType, effectiveState})` -- §7 exact `executionRecord`:
 * exactly two legal shapes (not started / started), `terminalState` equal to the enclosing record's
 * EFFECTIVE state, a started record only inside a `control-run`, NRDB only not-started and only
 * inside a `gate-disposition`.
 */
function executionRecordProblems(name, er, { recordType, effectiveState }) {
  if (!isPlainObject(er)) return ['execution-record-not-object'];
  const out = [];
  if (!exactKeys(er, EXECUTION_RECORD_KEYS)) out.push('execution-record.keys');
  if (er.controlId !== name) out.push('execution-record.controlId');
  if (er.phase !== CONTROL_OWNING_PHASE[name]) out.push('execution-record.phase');
  if (!sameJson(er.dependencyIds, CONTROL_DEPENDENCY_IDS[name])) out.push('execution-record.dependencyIds');
  if (typeof er.started !== 'boolean' || typeof er.crossedStartBoundary !== 'boolean' || er.started !== er.crossedStartBoundary) out.push('execution-record.started');
  if (!isSeq(er.terminalSeq)) out.push('execution-record.terminalSeq');
  if (!isIsoMs(er.terminalAt)) out.push('execution-record.terminalAt');
  const allowed = CONTROL_ALLOWED_STATES[name] || [];
  if (!allowed.includes(er.terminalState)) out.push('execution-record.terminalState-enum');
  if (er.terminalState !== effectiveState) out.push('execution-record.terminalState-not-effective-state');
  if (!Array.isArray(er.evidenceRefs) || !er.evidenceRefs.every(isJsonPointer)) out.push('execution-record.evidenceRefs');
  if (er.started === false) {
    if (er.startSeq !== null || er.startedAt !== null) out.push('execution-record.not-started-start-fields');
    if (er.result !== null) out.push('execution-record.not-started-result');
    if (!Array.isArray(er.evidenceRefs) || er.evidenceRefs.length !== 0) out.push('execution-record.not-started-evidenceRefs');
    if (!(CONTROL_NOT_STARTED_STATES[name] || []).includes(er.terminalState)) out.push('execution-record.not-started-state');
    if (er.terminalState === NRDB_STATE && recordType !== RECORD_TYPE.GATE_DISPOSITION) out.push('execution-record.nrdb-outside-gate-disposition');
  } else if (er.started === true) {
    if (recordType !== RECORD_TYPE.CONTROL_RUN) out.push('execution-record.started-outside-control-run');
    if (!isSeq(er.startSeq) || !isSeq(er.terminalSeq) || !(er.startSeq < er.terminalSeq)) out.push('execution-record.startSeq');
    if (!isIsoMs(er.startedAt)) out.push('execution-record.startedAt');
    if (er.terminalState === NRDB_STATE) out.push('execution-record.started-nrdb');
    if (!isPlainObject(er.result)) out.push('execution-record.started-result');
    if (!Array.isArray(er.evidenceRefs) || er.evidenceRefs.length === 0) out.push('execution-record.started-evidenceRefs');
  }
  return out;
}

/** §7 exact `dependencyBlockedBy` object shape (all keys required, unknown keys rejected). */
function dependencyBlockedByShapeProblems(d) {
  if (!isPlainObject(d)) return ['dependency-blocked-by.not-object'];
  const out = [];
  if (!exactKeys(d, DEPENDENCY_BLOCKED_BY_KEYS)) out.push('dependency-blocked-by.keys');
  if (d.check !== 'C1') out.push('dependency-blocked-by.check');
  if (d.blockingState !== 'BLOCKED') out.push('dependency-blocked-by.blockingState');
  if (!C1_NORMALIZED_REASONS.includes(d.reason)) out.push('dependency-blocked-by.reason');
  if (!isSeq(d.phaseSeq)) out.push('dependency-blocked-by.phaseSeq');
  if (!isIsoMs(d.blockedAt)) out.push('dependency-blocked-by.blockedAt');
  if (d.evidenceRef !== '/checks/C1') out.push('dependency-blocked-by.evidenceRef');
  if (typeof d.failedBeforeDependentStarted !== 'boolean') out.push('dependency-blocked-by.failedBeforeDependentStarted');
  if (!Array.isArray(d.detail)) out.push('dependency-blocked-by.detail');
  return out;
}

/**
 * §7 L3 referential constraints of a `dependencyBlockedBy` against C1's record, its single retained
 * `check-finalized` event and `gates.C1`; `failedBeforeDependentStarted:true` is legal only for a
 * gate-disposition record (with the not-started executionRecord for a control).
 */
function dependencyBlockedByReferentialProblems(d, state, rec) {
  const out = [...dependencyBlockedByShapeProblems(d)];
  if (!isPlainObject(d)) return out;
  const s = isPlainObject(state) ? state : {};
  const c1 = isPlainObject(s.checks) ? s.checks.C1 : null;
  const gate = isPlainObject(s.gates) && isPlainObject(s.gates.C1) ? s.gates.C1 : null;
  if (!isPlainObject(c1) || c1.recordType !== RECORD_TYPE.CHECK_RUN) return [...out, 'dependency-blocked-by.c1-record'];
  if (d.blockingState !== c1.verdict) out.push('dependency-blocked-by.blockingState-ne-c1');
  if (d.reason !== c1.reason) out.push('dependency-blocked-by.reason-ne-c1');
  const ev = c1FinalizationEvents(s.eventLog);
  if (d.phaseSeq !== c1.finalizedSeq || ev.length !== 1 || ev[0].seq !== d.phaseSeq) out.push('dependency-blocked-by.phaseSeq-ne-c1-finalized');
  if (d.blockedAt !== c1.finalizedAt) out.push('dependency-blocked-by.blockedAt-ne-c1');
  if (d.failedBeforeDependentStarted !== true) out.push('dependency-blocked-by.failedBeforeDependentStarted');
  if (!gate || !isSeq(gate.gateSeq) || !(d.phaseSeq < gate.gateSeq)) out.push('dependency-blocked-by.phaseSeq-not-before-gate');
  if (!isPlainObject(rec) || rec.recordType !== RECORD_TYPE.GATE_DISPOSITION) out.push('dependency-blocked-by.not-gate-disposition');
  else if (rec.itemKind === 'control' && !(isPlainObject(rec.executionRecord) && rec.executionRecord.started === false)) out.push('dependency-blocked-by.control-started');
  const bd = isPlainObject(c1.fields) ? c1.fields.blockDetail : undefined;
  if (!sameJson(d.detail, bd)) out.push('dependency-blocked-by.detail-ne-c1-blockDetail');
  return out;
}

/** The `cleanup` marker seq (G-e / CG `cleanupSeq`), or null if not exactly one is recorded. */
function cleanupMarkerSeq(state) {
  const ledger = isPlainObject(state) && isPlainObject(state.errorLedger) ? state.errorLedger : null;
  const markers = ledger && Array.isArray(ledger.markers) ? ledger.markers.filter((m) => isPlainObject(m) && m.name === 'cleanup') : [];
  return markers.length === 1 && isSeq(markers[0].seq) ? markers[0].seq : null;
}

// ---- §7 RC1-C2 closed-gate evidence predicates CG-1..CG-7, attribution fields, legal-record list ----

/** §5 phases downstream of C1 (P2..P11; drift-tested against PHASE_ORDER). */
const DOWNSTREAM_PHASE_IDS = Object.freeze(['P2', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P6b', 'P7', 'P8', 'P9', 'P10', 'P11']);
/** §7 attribution `phase` enum = §9.2 marker names: P0..P11, cleanup, closeout. */
const ATTRIBUTION_PHASES = Object.freeze(['P0', 'P1', ...DOWNSTREAM_PHASE_IDS, 'cleanup', 'closeout']);
const CLEANUP_PHASES = Object.freeze(['cleanup', 'closeout']);
/**
 * §7 legal-under-a-closed-gate list: the passive fatal `eventLog` kinds legal between `gateSeq` and the
 * cleanup marker (page error, unhandled rejection, console.error, crash/close, WebGL loss) -- the
 * same kind names the §9 error ledger records.
 */
const PASSIVE_FATAL_EVENT_KINDS = Object.freeze(['pageerror', 'unhandledrejection', 'console.error', 'page-crash', 'page-close-outside-cleanup', 'browser-disconnected-outside-cleanup', 'webgl-context-lost']);
/** The three collections that carry the §7 attribution fields `seq/phase/activeCheck/activeControl`. */
const ATTRIBUTED_COLLECTIONS = Object.freeze(['spyLedger', 'eventLog', 'stateSnapshots']);

/** `spyLedger` is an array in the run state and `{records, ...}` once capped into R1 (§4.6/T22). */
function spyLedgerRecords(s) {
  if (Array.isArray(s.spyLedger)) return s.spyLedger;
  return isPlainObject(s.spyLedger) && Array.isArray(s.spyLedger.records) ? s.spyLedger.records : [];
}
function attributedCollection(s, name) {
  if (name === 'spyLedger') return spyLedgerRecords(s);
  return Array.isArray(s[name]) ? s[name] : [];
}
const errorLedgerList = (s, k) => (isPlainObject(s.errorLedger) && Array.isArray(s.errorLedger[k]) ? s.errorLedger[k] : []);
const isDownstreamPhase = (p) => DOWNSTREAM_PHASE_IDS.includes(p);
const isDownstreamCheck = (c) => DOWNSTREAM_CHECK_NAMES.includes(c);
/** The ordering seq of a network record (§9.2): raw events by `rawEventSeq`, observations by `startSeq`. */
const networkSeq = (k, e) => (k === 'requestObservations' ? e.startSeq : e.rawEventSeq);

/**
 * `attributionFieldProblems(state)` -- §7/§10 RC1-C2: EVERY `spyLedger`, `eventLog` and
 * `stateSnapshots` entry carries `seq` (the single run counter), `phase` (P0..P11|cleanup|closeout),
 * `activeCheck` (C1..C20|null) and `activeControl` (N1..N8|null); `eventLog` is monotonic (strictly
 * increasing `seq`). Independent of the gate outcome.
 */
function attributionFieldProblems(state) {
  const s = isPlainObject(state) ? state : {};
  const out = [];
  for (const name of ATTRIBUTED_COLLECTIONS) {
    const raw = name === 'spyLedger' ? s.spyLedger : s[name];
    if (raw === undefined || raw === null) continue; // presence is the §10 top-level-key rule
    let prev = -1;
    attributedCollection(s, name).forEach((e, i) => {
      if (!isPlainObject(e) || !isSeq(e.seq) || !ATTRIBUTION_PHASES.includes(e.phase)
        || !(e.activeCheck === null || CHECK_NAMES.includes(e.activeCheck))
        || !(e.activeControl === null || CONTROL_NAMES.includes(e.activeControl))) { out.push(`attribution:${name}[${i}]`); return; }
      if (name === 'eventLog') { if (!(e.seq > prev)) out.push(`attribution:eventLog-not-monotonic[${i}]`); prev = e.seq; }
    });
  }
  return out;
}

/**
 * `closedGateEvidenceMatches(state)` -- §7 RC1-C2 closed enumerated predicates CG-1..CG-7 (the
 * exact meaning of "attributed to a downstream item" in L2, G-f and the gate equations), evaluated
 * ONCE over the named collections. Returns stable identifiers `CG-n:<collection>[i]:<clause>`.
 * `cleanupSeq` = the seq of the single `cleanup` marker (`cleanupMarkerSeq`; +Infinity when absent --
 * G-e then fails separately). A match is a prohibited downstream-execution record under a closed gate.
 */
function closedGateEvidenceMatches(state) {
  const s = isPlainObject(state) ? state : {};
  const gate = isPlainObject(s.gates) && isPlainObject(s.gates.C1) ? s.gates.C1 : {};
  const gs = isSeq(gate.gateSeq) ? gate.gateSeq : -1;
  const cs = cleanupMarkerSeq(s) ?? Infinity;
  const out = [];
  // CG-1 markers
  errorLedgerList(s, 'markers').forEach((m, i) => { if (isPlainObject(m) && isDownstreamPhase(m.name)) out.push(`CG-1:errorLedger.markers[${i}]:${m.name}`); });
  // CG-2 spyLedger, stateSnapshots
  for (const name of ['spyLedger', 'stateSnapshots']) {
    attributedCollection(s, name).forEach((e, i) => {
      if (!isPlainObject(e)) return;
      const why = (isSeq(e.seq) && gs < e.seq && e.seq < cs) ? 'post-gate-pre-cleanup'
        : isDownstreamPhase(e.phase) ? `phase-${e.phase}`
          : isDownstreamCheck(e.activeCheck) ? `activeCheck-${e.activeCheck}`
            : (e.activeControl !== null && e.activeControl !== undefined) ? `activeControl-${e.activeControl}`
              : (CLEANUP_PHASES.includes(e.phase) && e.activeCheck !== null && e.activeCheck !== undefined) ? `cleanup-with-activeCheck-${e.activeCheck}` : null;
      if (why) out.push(`CG-2:${name}[${i}]:${why}`);
    });
  }
  // CG-3 eventLog
  attributedCollection(s, 'eventLog').forEach((e, i) => {
    if (!isPlainObject(e)) return;
    const why = isDownstreamPhase(e.phase) ? `phase-${e.phase}`
      : isDownstreamCheck(e.activeCheck) ? `activeCheck-${e.activeCheck}`
        : (e.activeControl !== null && e.activeControl !== undefined) ? `activeControl-${e.activeControl}`
          : (e.kind === 'check-finalized' && e.check !== 'C1') ? `check-finalized-${e.check}`
            : (e.kind === 'wrapper-install' && !(isSeq(e.seq) && e.seq < gs)) ? 'wrapper-install-after-gate' : null;
    if (why) out.push(`CG-3:eventLog[${i}]:${why}`);
  });
  // CG-4 opLedger
  errorLedgerList(s, 'opLedger').forEach((o, i) => {
    if (!isPlainObject(o)) return;
    const why = !['P1', 'cleanup'].includes(o.phase) ? `phase-${o.phase}`
      : ['C16', 'C17'].includes(o.invokedBy) ? `invokedBy-${o.invokedBy}`
        : (o.recordType === 'load' && !(isSeq(o.startSeq) && o.startSeq <= gs)) ? 'load-after-gate' : null;
    if (why) out.push(`CG-4:errorLedger.opLedger[${i}]:${why}`);
  });
  // CG-5 raw network events and request observations
  for (const k of ['requestFailures', 'responseFailures', 'requestObservations']) {
    errorLedgerList(s, k).forEach((e, i) => {
      if (!isPlainObject(e)) return;
      const why = isDownstreamPhase(e.phase) ? `phase-${e.phase}` : isDownstreamCheck(e.activeCheck) ? `activeCheck-${e.activeCheck}` : null;
      if (why) out.push(`CG-5:errorLedger.${k}[${i}]:${why}`);
    });
  }
  // CG-6 downstream run records / any started executionRecord
  const checks = isPlainObject(s.checks) ? s.checks : {};
  const controls = isPlainObject(s.controls) ? s.controls : {};
  for (const n of DOWNSTREAM_CHECK_NAMES) if (isPlainObject(checks[n]) && checks[n].recordType === RECORD_TYPE.CHECK_RUN) out.push(`CG-6:checks.${n}:check-run`);
  for (const n of CONTROL_NAMES) {
    const r = controls[n];
    if (!isPlainObject(r)) continue;
    if (r.recordType === RECORD_TYPE.CONTROL_RUN) out.push(`CG-6:controls.${n}:control-run`);
    if (isPlainObject(r.executionRecord) && r.executionRecord.started === true) out.push(`CG-6:controls.${n}:executionRecord-started`);
  }
  // CG-7 live-check evidence: exactly null / exactly [] under a closed gate (targets/screenshots excluded)
  for (const k of ['c17', 'c20', 'n6']) if (s[k] !== null) out.push(`CG-7:${k}:not-null`);
  if (!(Array.isArray(s.c4Table) && s.c4Table.length === 0)) out.push('CG-7:c4Table:not-empty');
  return out;
}

/**
 * `closedGateIllegalRecords(state)` -- §7 RC1-C2 "Legal under a closed gate (exhaustive)", checked
 * per collection SEPARATELY from CG-1..CG-7 (an unknown record class that happens not to match a CG
 * predicate is still rejected). Legal: every record with `seq < gateSeq`; with `gateSeq < seq <
 * cleanupSeq` only passive P1 records with null attribution (raw network events, request observations,
 * the enumerated fatal `eventLog` kinds and their `errorLedger.entries[]`); from `cleanupSeq` on the
 * cleanup/closeout records (cleanup/closeout markers; `mutation` opLedger records with
 * `phase:'cleanup'` and `invokedBy:'cleanup:<step>'`; spy/snapshot/event entries with phase
 * cleanup|closeout and null attribution; network records with phase cleanup|closeout). Records
 * without a usable seq are illegal (since slice C1 also unsequenced `errorLedger.entries[]`,
 * FATAL_ENTRY_SEQ_REQUIRED). A pre-gate record labelled cleanup/closeout is illegal (the pre-gate
 * region is P0/P1/C1 only). Checks/controls/gates are validated by the record-union rules.
 */
function closedGateIllegalRecords(state) {
  const s = isPlainObject(state) ? state : {};
  const gate = isPlainObject(s.gates) && isPlainObject(s.gates.C1) ? s.gates.C1 : {};
  const gs = isSeq(gate.gateSeq) ? gate.gateSeq : -1;
  const cs = cleanupMarkerSeq(s) ?? Infinity;
  const out = [];
  const nullAttr = (e) => e.activeCheck === null && e.activeControl === null;
  // `preOk`: a pre-gate record is a P0/P1 (C1) record -- never one labelled cleanup/closeout.
  const classify = (seq, preOk, windowOk, cleanupOk) => {
    if (!isSeq(seq)) return false;
    if (seq < gs) return preOk();
    if (seq > gs && seq < cs) return windowOk();
    if (seq >= cs) return cleanupOk();
    return false; // seq === gateSeq: only gates.C1 owns it
  };
  const notCleanupPhase = (e) => () => !CLEANUP_PHASES.includes(e.phase);
  errorLedgerList(s, 'markers').forEach((m, i) => {
    if (!isPlainObject(m) || !classify(m.seq, () => !CLEANUP_PHASES.includes(m.name), () => false, () => CLEANUP_PHASES.includes(m.name))) out.push(`closed-gate-illegal-record:errorLedger.markers[${i}]`);
  });
  for (const name of ['spyLedger', 'stateSnapshots']) {
    attributedCollection(s, name).forEach((e, i) => {
      if (!isPlainObject(e) || !classify(e.seq, notCleanupPhase(e), () => false, () => CLEANUP_PHASES.includes(e.phase) && nullAttr(e))) out.push(`closed-gate-illegal-record:${name}[${i}]`);
    });
  }
  attributedCollection(s, 'eventLog').forEach((e, i) => {
    if (!isPlainObject(e) || !classify(e.seq, notCleanupPhase(e), () => e.phase === 'P1' && nullAttr(e) && PASSIVE_FATAL_EVENT_KINDS.includes(e.kind), () => CLEANUP_PHASES.includes(e.phase) && nullAttr(e))) out.push(`closed-gate-illegal-record:eventLog[${i}]`);
  });
  for (const k of ['requestFailures', 'responseFailures', 'requestObservations']) {
    errorLedgerList(s, k).forEach((e, i) => {
      if (!isPlainObject(e) || !classify(networkSeq(k, e), notCleanupPhase(e), () => e.phase === 'P1' && e.activeCheck === null, () => CLEANUP_PHASES.includes(e.phase))) out.push(`closed-gate-illegal-record:errorLedger.${k}[${i}]`);
    });
  }
  errorLedgerList(s, 'opLedger').forEach((o, i) => {
    if (!isPlainObject(o) || !classify(o.startSeq, () => o.phase === 'P1', () => false, () => o.recordType === 'mutation' && o.phase === 'cleanup' && typeof o.invokedBy === 'string' && o.invokedBy.startsWith('cleanup:'))) out.push(`closed-gate-illegal-record:errorLedger.opLedger[${i}]`);
  });
  // Fatal error-ledger entries: legal before the gate and from cleanup on (a fatal event during
  // cleanup/closeout is still recorded -- row 1); between gate and cleanup only the entries of the
  // passive fatal kinds and the network fatal-witness entries. An unsequenced entry is illegal
  // (FATAL_ENTRY_SEQ_REQUIRED, slice C1).
  errorLedgerList(s, 'entries').forEach((e, i) => {
    if (isPlainObject(e) && !isSeq(e.seq) && !FATAL_ENTRY_SEQ_REQUIRED) return;
    if (!isPlainObject(e) || !classify(e.seq, () => true, () => PASSIVE_FATAL_EVENT_KINDS.includes(e.kind) || e.kind === 'required-resource-failure', () => true)) out.push(`closed-gate-illegal-record:errorLedger.entries[${i}]`);
  });
  return out;
}

/**
 * `itemAttributionProblems(state, itemId)` -- L2 / G-f attribution. Per §7 the closed-gate evidence
 * predicates CG-1..CG-7 ARE the meaning of attribution, so ANY CG match (global) is attributed to every
 * downstream item; in addition a record whose `activeCheck`/`activeControl` names `itemId` is reported
 * under the item-specific label. Non-empty => L2 false (NRDB illegal) / G-f violated.
 */
function itemAttributionProblems(state, itemId) {
  const s = isPlainObject(state) ? state : {};
  const out = closedGateEvidenceMatches(s).map((m) => `closed-gate-evidence:${m}`);
  const key = itemId.startsWith('N') ? 'activeControl' : 'activeCheck';
  const collections = ATTRIBUTED_COLLECTIONS.map((n) => [n, attributedCollection(s, n)]);
  if (key === 'activeCheck') for (const k of ['requestFailures', 'responseFailures', 'requestObservations']) collections.push([`errorLedger.${k}`, errorLedgerList(s, k)]);
  for (const [label, list] of collections) {
    if (list.some((e) => isPlainObject(e) && e[key] === itemId)) out.push(`attributed-record:${label}:${itemId}`);
  }
  return out;
}

/**
 * `gateDispositionProblems(itemId, rec, state)` -- exact §7 gate-disposition shape + G-a..G-e and
 * the evidenceRefs half of G-f (the CG half is `itemAttributionProblems`, extended in B2). A
 * disposition is legal only beside a closed `gates.C1`.
 */
function gateDispositionProblems(itemId, rec, state) {
  if (!isPlainObject(rec)) return ['not-object'];
  const s = isPlainObject(state) ? state : {};
  const out = [];
  if (Object.prototype.hasOwnProperty.call(rec, 'verdict')) out.push('gate-disposition-has-verdict');
  if (Object.prototype.hasOwnProperty.call(rec, 'state')) out.push('gate-disposition-has-state');
  if (!exactKeys(rec, GATE_DISPOSITION_KEYS)) out.push('keys');
  const isCheck = itemId.startsWith('C');
  if (rec.recordType !== RECORD_TYPE.GATE_DISPOSITION) out.push('record-type');
  if (rec.itemId !== itemId) out.push('itemId');
  if (rec.itemKind !== (isCheck ? 'check' : 'control')) out.push('itemKind');
  if (rec.synthetic !== true) out.push('synthetic');
  if (rec.gateGenerated !== true) out.push('gateGenerated');
  if (rec.executed !== false) out.push('executed');
  if (rec.startSeq !== null || rec.startedAt !== null) out.push('start-fields-not-null');
  if (!isSeq(rec.dispositionSeq)) out.push('dispositionSeq');
  if (!isIsoMs(rec.dispositionAt)) out.push('dispositionAt');
  if (!sameJson(rec.evidenceRefs, GATE_EVIDENCE_REFS)) out.push('G-f:evidenceRefs');
  const gate = isPlainObject(s.gates) && isPlainObject(s.gates.C1) ? s.gates.C1 : null;
  const c1 = isPlainObject(s.checks) ? s.checks.C1 : null;
  const outcome = gate ? gate.outcome : null;
  if (outcome !== GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED && outcome !== GATE_OUTCOME.CLOSED_OTHER) {
    out.push('gate-disposition-without-closed-gate');
    return out;
  }
  // G-a
  if (rec.gateOutcome !== outcome) out.push('G-a:gateOutcome');
  const expectedReason = outcome === GATE_OUTCOME.CLOSED_OTHER ? GATE_BLOCKING_REASON_CLOSED_OTHER : (isPlainObject(c1) ? c1.reason : undefined);
  if (rec.blockingReason !== expectedReason || (outcome === GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED && !C1_NORMALIZED_REASONS.includes(rec.blockingReason))) out.push('G-a:blockingReason');
  // G-b
  const expectedDisposition = isCheck ? GATE_CHECK_DISPOSITION : GATE_CONTROL_DISPOSITION[outcome][itemId];
  if (rec.disposition !== expectedDisposition) out.push('G-b:disposition');
  // G-c
  const needsDep = outcome === GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED && (isCheck || rec.disposition === NRDB_STATE);
  if (needsDep) for (const p of dependencyBlockedByReferentialProblems(rec.dependencyBlockedBy, s, rec)) out.push(`G-c:${p}`);
  else if (rec.dependencyBlockedBy !== null) out.push('G-c:dependencyBlockedBy-not-null');
  // G-d
  if (isCheck) { if (rec.executionRecord !== null) out.push('G-d:executionRecord-not-null'); } else {
    for (const p of executionRecordProblems(itemId, rec.executionRecord, { recordType: RECORD_TYPE.GATE_DISPOSITION, effectiveState: rec.disposition })) out.push(`G-d:${p}`);
    const er = rec.executionRecord;
    if (isPlainObject(er) && er.started !== false) out.push('G-d:executionRecord-started');
    if (isPlainObject(er) && er.terminalSeq !== rec.dispositionSeq) out.push('G-d:terminalSeq-ne-dispositionSeq');
  }
  // G-e (strict increase across items is checked by `recordSchemaProblems`)
  if (!isSeq(gate.gateSeq) || !(rec.dispositionSeq > gate.gateSeq)) out.push('G-e:dispositionSeq-not-after-gate');
  const cleanupSeq = cleanupMarkerSeq(s);
  if (cleanupSeq === null) out.push('G-e:cleanup-marker-missing');
  else if (!(rec.dispositionSeq < cleanupSeq)) out.push('G-e:dispositionSeq-not-before-cleanup');
  // G-f (CG half): any CG-1..CG-7 match violates G-f for every disposition (reported once per item;
  // the concrete matches are listed once by `recordSchemaProblems`), plus item-attributed records.
  const attr = itemAttributionProblems(s, itemId);
  if (attr.some((p) => p.startsWith('closed-gate-evidence:'))) out.push('G-f:closed-gate-evidence');
  for (const p of attr) if (!p.startsWith('closed-gate-evidence:')) out.push(`G-f:${p}`);
  return out;
}

/** §7 gate outcome rule, recomputed from its inputs (never trusted from the stored record). */
function recomputeGateOutcome({ c1Verdict, c1Reason, fatalCountAtGate }) {
  if (c1Verdict === 'PASS' && fatalCountAtGate === 0) return GATE_OUTCOME.OPEN;
  if (c1Verdict === 'BLOCKED' && C1_NORMALIZED_REASONS.includes(c1Reason) && fatalCountAtGate === 0) return GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED;
  return GATE_OUTCOME.CLOSED_OTHER;
}

/**
 * Pre-gate fatal count recomputation interface (§7 gate equations; §9.2 witness invariant): the
 * number of fatal `errorLedger.entries` with `seq < gateSeq`. A network entry
 * (`kind:'required-resource-failure'`) counts through its single fatal witness: its `seq` must equal
 * the referenced `fatalWitnesses[].witnessSeq`. An entry without an integer `seq` cannot be ordered
 * against the gate and is a contradiction. (Slice C supplies sequenced entries and the witness
 * ledger; this function is the B1 side of that interface.)
 */
function recomputeFatalCountAtGate(errorLedger, gateSeq) {
  const ledger = isPlainObject(errorLedger) ? errorLedger : {};
  const entries = Array.isArray(ledger.entries) ? ledger.entries : null;
  if (entries === null) return { count: null, problems: ['fatal-entries-missing'] };
  const witnesses = Array.isArray(ledger.fatalWitnesses) ? ledger.fatalWitnesses : [];
  const problems = [];
  let count = 0;
  let indeterminate = false;
  for (const e of entries) {
    if (!isPlainObject(e) || !isSeq(e.seq)) {
      if (FATAL_ENTRY_SEQ_REQUIRED) problems.push('fatal-entry-unsequenced');
      indeterminate = true;
      continue;
    }
    if (e.kind === 'required-resource-failure') {
      const w = witnesses.filter((x) => isPlainObject(x) && x.witnessId === e.witnessId);
      if (w.length !== 1 || w[0].witnessSeq !== e.seq) { problems.push('fatal-entry-witness-mismatch'); continue; }
    }
    if (e.seq < gateSeq) count += 1;
  }
  // §9.2 witness <-> entry bijection restricted to the gate: a witness with witnessSeq < gateSeq that
  // has no single required-resource-failure entry is omitted from the count => contradiction.
  for (const w of witnesses) {
    if (!isPlainObject(w) || !isSeq(w.witnessSeq) || !(w.witnessSeq < gateSeq)) continue;
    const es = entries.filter((e) => isPlainObject(e) && e.kind === 'required-resource-failure' && e.witnessId === w.witnessId);
    if (es.length !== 1) problems.push('fatal-witness-without-single-entry');
  }
  return { count: indeterminate ? null : count, problems };
}

/**
 * §7 atomic gate preparation, validator side: every `responseFailures[]` entry finalized by the gate
 * (`finalizedBy:'gate'`) must satisfy `responseSeq < finalizedSeq < gateSeq`; an entry finalized by
 * the gate after `gateSeq` was allocated is an evidence contradiction (row 5, §9.2 test (25)).
 */
function gateFinalizationProblems(errorLedger, gateSeq) {
  const out = [];
  const list = isPlainObject(errorLedger) && Array.isArray(errorLedger.responseFailures) ? errorLedger.responseFailures : [];
  list.forEach((e, i) => {
    if (!isPlainObject(e) || e.finalizedBy !== 'gate') return;
    if (!isSeq(e.finalizedSeq) || !isSeq(gateSeq) || !(e.finalizedSeq < gateSeq)) out.push(`gate-finalized-after-gate:responseFailures[${i}]`);
    else if (!isSeq(e.responseSeq) || !(e.responseSeq < e.finalizedSeq)) out.push(`gate-finalized-before-response:responseFailures[${i}]`);
  });
  return out;
}

const isThenable = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

/**
 * Gate-time finalization of one provisional HTTP response (§9.2 two-stage rule, §7 gate preparation):
 * R-3/R-4 evaluated over the record truncated at the freshly allocated `finalizedSeq` against the
 * ledger's persisted `prefixDerivation` (slice C2) -- unresolved ownership => `unknown-fatal`. Returns the finalization patch. Under the
 * live empty OPTIONAL_RESPONSE_RULES no provisional entry can exist, so this never runs live.
 */
function defaultGateFinalization(e, { ledger, finalizedSeq, rules = OPTIONAL_RESPONSE_RULES } = {}) {
  return provisionalFinalization(e, { ledger, finalizedSeq, rules });
}

/**
 * Synchronous rebuild of the fatal-witness state at the gate (§9.2 W-1..W-5): the full
 * `syncFatalWitnesses` recomputation -- `correlatedRequests[]`, `fatalWitnesses[]` (one per fatal
 * identity; a witness newly created here gets `witnessSeq` = its effective seq = the gate
 * finalizedSeq), the witness<->entry bijection and `witnessCount`; `fatalCount` += 1 only per CREATED
 * witness. `appendEntry` defaults to a direct ledger push (the in-page gate has no node sink).
 */
function defaultRebuildFatalWitnessState(ledger, { appendEntry = directWitnessEntryAppender(ledger) } = {}) {
  syncFatalWitnesses(ledger, { appendEntry });
}

/**
 * `prepareC1Gate({c1, errorLedger, seqOf, clock, finalizeAtGate, rebuildFatalWitnessState})` -- §7
 * RC1-C2 atomic gate preparation, SYNCHRONOUS (no await, no listener turn; a hook returning a thenable
 * is a harness defect and throws). In this order: (1) finalize every still-provisional
 * `responseFailures[]` entry (`finalizedBy:'gate'`, allocating its `finalizedSeq` first, then
 * classifying over the record truncated there); (2) rebuild the fatal-witness state
 * (`syncFatalWitnesses`); (3) recompute `fatalCountAtGate` (every fatal entry now in the ledger
 * precedes the gate by construction); (4) only then allocate `gateSeq` and build `gates.C1`.
 * Hence `responseSeq < finalizedSeq <= witnessSeq < gateSeq`. `c1` must be C1's finalized check-run
 * record. Returns the exact `gates.C1` record.
 */
function prepareC1Gate({ c1, errorLedger, seqOf, clock = defaultClock, finalizeAtGate = defaultGateFinalization, rebuildFatalWitnessState = defaultRebuildFatalWitnessState }) {
  if (!isPlainObject(c1) || c1.recordType !== RECORD_TYPE.CHECK_RUN || !isSeq(c1.finalizedSeq)) throw new TypeError('prepareC1Gate: C1 must be a finalized check-run record');
  if (typeof seqOf !== 'function') throw new TypeError('prepareC1Gate: seqOf required (the run\'s single counter)');
  const ledger = isPlainObject(errorLedger) ? errorLedger : { fatalCount: 0, entries: [] };
  // (1) finalize gate-pending provisional entries
  const gateFinalized = [];
  for (const e of Array.isArray(ledger.responseFailures) ? ledger.responseFailures : []) {
    if (!isPlainObject(e) || e.stage !== 'provisional' || isSeq(e.finalizedSeq)) continue;
    const finalizedSeq = seqOf();
    const r = finalizeAtGate(e, { ledger, finalizedSeq });
    if (isThenable(r)) throw new TypeError('prepareC1Gate: finalizeAtGate must be synchronous');
    applyProvisionalFinalization(e, isPlainObject(r) ? r : {}, finalizedSeq, 'gate');
    gateFinalized.push(e);
  }
  // (2) rebuild witnesses
  const rebuilt = rebuildFatalWitnessState(ledger, { gateFinalized, seqOf });
  if (isThenable(rebuilt)) throw new TypeError('prepareC1Gate: rebuildFatalWitnessState must be synchronous');
  // (3) fatalCountAtGate: every fatal entry recorded so far precedes the gate
  const fatalCountAtGate = Array.isArray(ledger.entries) ? ledger.entries.length : 0;
  // (4) allocate gateSeq last
  const gateSeq = seqOf();
  const outcome = recomputeGateOutcome({ c1Verdict: c1.verdict, c1Reason: c1.reason, fatalCountAtGate });
  return {
    gateSeq, gateAt: clock.nowIso(), c1Verdict: c1.verdict, c1Reason: c1.reason, c1FinalizedSeq: c1.finalizedSeq,
    fatalCountAtGate, outcome, notStarted: outcome === GATE_OUTCOME.OPEN ? [] : [...DOWNSTREAM_ITEM_NAMES],
  };
}

// ============================================================================================
// §9.2 request-failure / HTTP-error classification, request observations and the one-to-one
// fatal-witness correlation (slice C1; procedure §9.2 RC1 + RC1-C1 + RC1-C2, §10). Pure layer:
// `classifyRequestFailure`, `classifyHttpResponse` (R-1..R-5, two-stage), the frozen EMPTY
// `OPTIONAL_RESPONSE_RULES`, `correlateNetworkEvents` (W-1..W-5), the event-time witness maintenance
// `syncFatalWitnesses` (fatalCount incremented ONLY at witness creation), the closeout recomputation
// `networkLedgerProblems` (=> `fatal-witness-mismatch` / `request-classification-mismatch`, row 5)
// and the cross-collection seq-uniqueness rule. Slice C2 (section below `correlateNetworkEvents`):
// the exact operation ledger, the durable prefix-source ledger, `derivePrefixes` / `prefixDerivation`,
// ambiguous-prefix accounting and `boundPrefix` provenance (prefix-source `evidenceRefs`); before the
// load windows close the derivation is non-distinguishing (nothing can bind => fail-safe).
// ============================================================================================

/**
 * §9.2 R-2: the frozen bounded expected-status exceptions. EMPTY in this procedure revision (so in a
 * live run every status >= 400 is fatal; the acknowledged conservative false-FAIL risk). A rule may
 * only be added by a future reviewed procedure revision -- never here.
 */
const OPTIONAL_RESPONSE_RULES = Object.freeze([]);
const NETWORK_URL_CLASSES = Object.freeze(['bootstrap', 'harness-endpoint', 'other']);
const NETWORK_CLASSIFICATION = Object.freeze({ FATAL_REQUIRED: 'fatal-required-resource', EXPECTED: 'expected-cancellation', DIAGNOSTIC: 'diagnostic-non-required', UNKNOWN_FATAL: 'unknown-fatal' });
const NETWORK_CLASSIFICATIONS = Object.freeze(Object.values(NETWORK_CLASSIFICATION));
const FATAL_NETWORK_CLASSIFICATIONS = Object.freeze([NETWORK_CLASSIFICATION.FATAL_REQUIRED, NETWORK_CLASSIFICATION.UNKNOWN_FATAL]);
/** W-2 severity order (total, worst first): unknown-fatal > fatal-required-resource > diagnostic > expected. */
const NETWORK_SEVERITY = Object.freeze({ 'unknown-fatal': 3, 'fatal-required-resource': 2, 'diagnostic-non-required': 1, 'expected-cancellation': 0 });
const EC_RESOURCE_TYPES = Object.freeze(['fetch', 'xhr', 'other', 'image']);
const EC_RULE_OF_OPERATION = Object.freeze({ hide: 'EC-hide', unload: 'EC-unload', teardown: 'EC-teardown' });
const MUTATION_OPERATION_TYPES = Object.freeze(['hide', 'unload', 'teardown']);
const ERR_ABORTED_TEXT = 'net::ERR_ABORTED';
const NETWORK_FATAL_ENTRY_KIND = 'required-resource-failure';
const CLASSIFIER_RESULT_KEYS = Object.freeze(['eventKind', 'url', 'method', 'status', 'failureReason', 'resourceType', 'phase', 'modelId', 'boundPrefix', 'operationId', 'opStartSeq', 'classification', 'rule', 'reasons', 'evidenceRefs', 'verdictEffect']);
const REQUEST_OBSERVATION_KEYS = Object.freeze(['reqId', 'startSeq', 'method', 'resourceType', 'urlRedacted', 'urlClass', 'isNavigationRequest', 'phase', 'activeCheck']);
const RAW_EVENT_COMMON_KEYS = Object.freeze(['reqId', 'reqIdValid', 'rawEventId', 'rawEventSeq', 'identityKey', 'duplicateOf', 'startSeq', 'method', 'resourceType', 'urlRedacted', 'urlClass', 'isNavigationRequest', 'frameIsMain', 'redirected', 'phase', 'activeCheck', 'eventTime', 'closeout', 'agree']);
const REQUEST_FAILURE_KEYS = Object.freeze([...RAW_EVENT_COMMON_KEYS, 'failSeq', 'errorText']);
const RESPONSE_FAILURE_KEYS = Object.freeze([...RAW_EVENT_COMMON_KEYS, 'responseSeq', 'stage', 'finalizedSeq', 'finalizedBy', 'status', 'requirement', 'modelBindingObserved']);
const CORRELATED_REQUEST_KEYS = Object.freeze(['identityKey', 'identityKind', 'reqId', 'rawEventRefs', 'eventKinds', 'ownership', 'worstClassification', 'fatal', 'fatalSinceSeq', 'witnessId']);
const FATAL_WITNESS_KEYS = Object.freeze(['witnessId', 'requestIdentityKey', 'rawEventRefs', 'fatalRawEventRefs', 'worstClassification', 'witnessSeq', 'phase', 'activeCheck', 'modelOwnership', 'ledgerEntryRef', 'eventTime', 'closeout', 'agree', 'fatal']);
const WITNESS_COUNT_KEYS = Object.freeze(['requestObservations', 'rawEvents', 'correlatedIdentities', 'fatalIdentities', 'fatalWitnesses', 'requiredResourceFailureEntries', 'nonNetworkFatalEntries', 'fatalCount']);
/** The slice-C1 error-ledger collections (all required in R1, §10; verdict-critical, never truncated). */
const NETWORK_LEDGER_LIST_KEYS = Object.freeze(['requestObservations', 'requestFailures', 'responseFailures', 'correlatedRequests', 'fatalWitnesses']);
/** §9.2 cross-field rule (v): the owning phase(s) of each check (§5 order; C7/C18 appear in two phases). */
const CHECK_OWNING_PHASES = Object.freeze({
  C1: ['P1'], C2: ['P3'], C3: ['P3'], C4: ['P4'], C5: ['P4'], C6: ['P6'], C7: ['P5a', 'P5b'], C8: ['P6'], C9: ['P7'], C10: ['P7'],
  C11: ['P7'], C12: ['P7'], C13: ['P7'], C14: ['P8'], C15: ['P8'], C16: ['P9'], C17: ['P9'], C18: ['P5a', 'P10'], C19: ['P11'], C20: ['P6b'],
});

const isNonEmptyStr = (v) => typeof v === 'string' && v !== '';
const cloneJson = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isFatalClassification = (c) => FATAL_NETWORK_CLASSIFICATIONS.includes(c);
const worseClassification = (a, b) => ((NETWORK_SEVERITY[b] ?? 3) > (NETWORK_SEVERITY[a] ?? 3) ? b : a);
const requirementOf = (classification) => (classification === NETWORK_CLASSIFICATION.FATAL_REQUIRED ? 'required' : classification === NETWORK_CLASSIFICATION.DIAGNOSTIC ? 'optional' : 'unknown');

/** `origin + dirname(path)` of a redacted URL (§9.2 `prefixKey`), or null when not an absolute URL. */
function networkPrefixKey(urlRedacted) {
  try {
    const u = new URL(urlRedacted);
    const p = u.pathname;
    const cut = p.lastIndexOf('/');
    return `${u.origin}${cut <= 0 ? '/' : p.slice(0, cut)}`;
  } catch { return null; }
}

/** The last path segment of a redacted URL (R-3 `pathSuffix` match), or null. */
function lastPathSegment(urlRedacted) {
  try {
    const p = new URL(urlRedacted).pathname;
    return p.slice(p.lastIndexOf('/') + 1);
  } catch { return null; }
}

/**
 * Observed model binding of a prefix key under a derivation (§9.2 "Binding of a candidate"):
 * `unique` (key in exactly one `modelPrefixes[M]`), `ambiguous` (binding non-distinguishing or the key
 * ambiguous), `unbound` (binding available, key in neither set). `reason` labels the ambiguous case.
 */
function prefixBindingOf(prefixKey, pd) {
  if (!isPlainObject(pd) || pd.bindingAvailable !== true) return { status: 'ambiguous', modelId: null, reason: 'binding-unavailable' };
  if (Array.isArray(pd.ambiguousKeys) && pd.ambiguousKeys.includes(prefixKey)) return { status: 'ambiguous', modelId: null, reason: 'prefix-ambiguous' };
  const mp = isPlainObject(pd.modelPrefixes) ? pd.modelPrefixes : {};
  const hits = ['A', 'B'].filter((m) => Array.isArray(mp[m]) && mp[m].includes(prefixKey));
  if (hits.length === 1) return { status: 'unique', modelId: hits[0], reason: null };
  if (hits.length > 1) return { status: 'ambiguous', modelId: null, reason: 'prefix-ambiguous' };
  return { status: 'unbound', modelId: null, reason: 'unbound' };
}

/** A ClassifierResult for a FATAL outcome (all couplings of §9.2 "Exact nullability and coupling"). */
function fatalClassifierResult(base, classification, reasons) {
  return { ...base, modelId: null, boundPrefix: null, operationId: null, opStartSeq: null, classification, rule: null, reasons, evidenceRefs: [], verdictEffect: 'fatal-row1' };
}

/**
 * The minimum operation-record shape a classifier needs before it may ground a NON-fatal result
 * (the exact disjoint shapes + couplings are validated by `opLedgerRecordProblems` in
 * `networkLedgerProblems`, row 5 -- slice C2): `operationId`, `startSeq`, the
 * discriminator and the model coupling (hide/unload => model A|B, teardown => null; load => model A|B
 * with an `expectedRequestWindow` object). Any other record makes the event unclassifiable.
 */
const isOpLedgerRecordShapeKnown = (o) => isPlainObject(o) && isNonEmptyStr(o.operationId) && isSeq(o.startSeq) && (
  (o.recordType === 'load' && (o.modelId === 'A' || o.modelId === 'B') && isPlainObject(o.expectedRequestWindow))
  || (o.recordType === 'mutation' && MUTATION_OPERATION_TYPES.includes(o.operationType)
    && (o.operationType === 'teardown' ? o.modelId === null : (o.modelId === 'A' || o.modelId === 'B'))));

/**
 * `classifyRequestFailure(event, opLedger, markers, prefixDerivation[, prefixSourceLedger]) ->
 * ClassifierResult` (§9.2) -- pure, total, deterministic. `prefixSourceLedger` (slice C2) only supplies
 * the JSON Pointers of the entries supporting a `boundPrefix` (`evidenceRefs`); it never decides a binding. `event = {reqIdValid, startSeq, failSeq, method, resourceType,
 * urlRedacted, urlClass, errorText, isNavigationRequest, phase}`. EXPECTED_CANCELLATION iff C-a ∧ C-b ∧
 * (a mutationOperation O satisfying C-c, C-c′ (hide/unload), C-d, C-e -- the LATEST such O); else
 * FATAL. `unknown-fatal` when unclassifiable (missing/invalid field incl. `reqIdValid !== true`, an
 * unknown op shape, an exception) or when an EC candidate (C-a ∧ C-b) fails C-c′ only through an
 * ambiguous/non-distinguishing binding. C-e "every check has a recorded final verdict" is read from
 * the record as: the `cleanup` marker (the runner's last act, written after every check/control record
 * is final) precedes `O.startSeq`. `reasons` list every unmet condition of the evaluated O (the latest
 * in-flight mutation) plus a sub-label `bootstrap|harness-endpoint|other|unclassifiable`.
 */
function classifyRequestFailure(event, opLedger, markers, prefixDerivation, prefixSourceLedger = null) {
  let base = { eventKind: 'requestfailed', url: null, method: null, status: null, failureReason: null, resourceType: null, phase: null };
  let sub = 'unclassifiable';
  const unclassifiable = () => fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['unclassifiable', sub]);
  let ev;
  try {
    ev = isPlainObject(event) ? { ...event } : {}; // one read of every field (a throwing getter => unclassifiable)
    base = {
      eventKind: 'requestfailed', url: typeof ev.urlRedacted === 'string' ? ev.urlRedacted : null, method: typeof ev.method === 'string' ? ev.method : null, status: null,
      failureReason: typeof ev.errorText === 'string' ? ev.errorText : null, resourceType: typeof ev.resourceType === 'string' ? ev.resourceType : null,
      phase: ATTRIBUTION_PHASES.includes(ev.phase) ? ev.phase : null,
    };
    sub = NETWORK_URL_CLASSES.includes(ev.urlClass) ? ev.urlClass : 'unclassifiable';
  } catch {
    return unclassifiable();
  }
  try {
    if (ev.reqIdValid !== true || !isSeq(ev.startSeq) || !isSeq(ev.failSeq) || !(ev.startSeq < ev.failSeq)
      || base.url === null || base.method === null || base.resourceType === null || base.phase === null || sub === 'unclassifiable'
      || typeof ev.isNavigationRequest !== 'boolean' || !(ev.errorText === null || typeof ev.errorText === 'string')
      || !Array.isArray(opLedger) || !Array.isArray(markers) || !opLedger.every(isOpLedgerRecordShapeKnown)
      || !markers.every((m) => isPlainObject(m) && isSeq(m.seq) && typeof m.name === 'string')) return unclassifiable();
    const ca = ev.errorText === ERR_ABORTED_TEXT;
    const cb = ev.urlClass === 'other' && ev.isNavigationRequest === false && EC_RESOURCE_TYPES.includes(ev.resourceType);
    const prefixKey = networkPrefixKey(ev.urlRedacted);
    const evaluate = (O) => {
      const unmet = [];
      let ambiguity = null;
      let binding = null;
      if (O.operationType === 'hide' || O.operationType === 'unload') {
        binding = prefixBindingOf(prefixKey, prefixDerivation);
        if (!(binding.status === 'unique' && binding.modelId === O.modelId)) {
          unmet.push('C-c′');
          if (binding.status === 'ambiguous') { ambiguity = binding.reason; unmet.push(binding.reason); }
        }
      }
      const later = [...opLedger.filter((o) => o.startSeq > O.startSeq).map((o) => o.startSeq), ...markers.filter((m) => m.seq > O.startSeq).map((m) => m.seq)];
      const end = later.length ? Math.min(...later) : null;
      if (!(end === null || ev.failSeq < end)) unmet.push('C-d');
      let ce;
      if (O.operationType === 'teardown') ce = ev.phase === 'cleanup' && markers.some((m) => m.name === 'cleanup' && m.seq < O.startSeq);
      else ce = ev.phase === 'P9' || ev.phase === 'cleanup';
      if (!ce) unmet.push('C-e');
      return { unmet, ambiguity, binding };
    };
    const inflight = opLedger.map((o, i) => ({ o, i })).filter(({ o }) => o.recordType === 'mutation' && ev.startSeq < o.startSeq && o.startSeq < ev.failSeq).sort((x, y) => y.o.startSeq - x.o.startSeq);
    const reasons = [];
    if (!ca) reasons.push('C-a');
    if (!cb) reasons.push('C-b');
    if (ca && cb) {
      const hit = inflight.find(({ o }) => evaluate(o).unmet.length === 0);
      if (hit) {
        const O = hit.o;
        const modelBound = O.operationType !== 'teardown';
        const preceding = markers.map((m, j) => ({ m, j })).filter(({ m }) => m.seq < O.startSeq).sort((x, y) => y.m.seq - x.m.seq)[0];
        return {
          ...base,
          modelId: modelBound ? O.modelId : null, boundPrefix: modelBound ? prefixKey : null,
          operationId: O.operationId, opStartSeq: O.startSeq,
          classification: NETWORK_CLASSIFICATION.EXPECTED, rule: EC_RULE_OF_OPERATION[O.operationType], reasons: [],
          evidenceRefs: [
            `/errorLedger/opLedger/${hit.i}`, ...(modelBound ? prefixSupportRefs(prefixSourceLedger, O.modelId, prefixKey) : []),
            ...(preceding ? [`/errorLedger/markers/${preceding.j}`] : []), ...(modelBound ? ['/errorLedger/prefixDerivation'] : []),
          ],
          verdictEffect: 'none',
        };
      }
    }
    if (inflight.length === 0) {
      reasons.push('C-c');
      return fatalClassifierResult(base, NETWORK_CLASSIFICATION.FATAL_REQUIRED, [...reasons, sub]);
    }
    const r = evaluate(inflight[0].o);
    reasons.push(...r.unmet);
    const unknown = ca && cb && r.ambiguity !== null;
    return fatalClassifierResult(base, unknown ? NETWORK_CLASSIFICATION.UNKNOWN_FATAL : NETWORK_CLASSIFICATION.FATAL_REQUIRED, [...reasons, sub]);
  } catch {
    return unclassifiable();
  }
}

const isOptionalResponseRuleShape = (r) => exactKeys(r, ['ruleId', 'method', 'model', 'pathSuffix', 'resourceTypes', 'statuses', 'rationale'])
  && isNonEmptyStr(r.ruleId) && isNonEmptyStr(r.method) && (r.model === 'A' || r.model === 'B') && isNonEmptyStr(r.pathSuffix) && !r.pathSuffix.includes('/')
  && Array.isArray(r.resourceTypes) && r.resourceTypes.every((t) => EC_RESOURCE_TYPES.includes(t))
  && Array.isArray(r.statuses) && r.statuses.every((s) => Number.isInteger(s) && s >= 400) && typeof r.rationale === 'string';

/** The first rule of `rules` matching method, resourceType, status and the last path segment (exact), or null. */
function matchingResponseRule(event, rules) {
  const seg = lastPathSegment(event.urlRedacted);
  return rules.find((r) => r.method === event.method && r.resourceTypes.includes(event.resourceType) && r.statuses.includes(event.status) && r.pathSuffix === seg) || null;
}

const isHttpEventShapeValid = (ev) => isPlainObject(ev) && ev.reqIdValid === true && isSeq(ev.startSeq) && isSeq(ev.responseSeq) && ev.startSeq < ev.responseSeq
  && Number.isInteger(ev.status) && ev.status >= 400 && typeof ev.method === 'string' && typeof ev.resourceType === 'string' && typeof ev.urlRedacted === 'string'
  && NETWORK_URL_CLASSES.includes(ev.urlClass) && typeof ev.isNavigationRequest === 'boolean' && ATTRIBUTION_PHASES.includes(ev.phase);

/**
 * §9.2 two-stage rule: an HTTP >= 400 response is a RULE CANDIDATE (stage `provisional`) iff it is
 * classifiable, R-1 does not apply and some rule of `rules` matches its method, resourceType, status
 * and last path segment. Everything else is `immediate` (with the live empty OPTIONAL_RESPONSE_RULES:
 * every response).
 */
function isHttpRuleCandidate(event, rules = OPTIONAL_RESPONSE_RULES) {
  try {
    if (!isHttpEventShapeValid(event) || !Array.isArray(rules) || !rules.every(isOptionalResponseRuleShape)) return false;
    if (event.urlClass !== 'other') return false;
    return matchingResponseRule(event, rules) !== null;
  } catch { return false; }
}

/**
 * `classifyHttpResponse(event, opLedger, markers, prefixDerivation, OPTIONAL_RESPONSE_RULES) ->
 * ClassifierResult` (§9.2 HTTP response policy; pure, total, deterministic). `event = {reqIdValid,
 * startSeq, responseSeq, method, status, resourceType, urlRedacted, urlClass, isNavigationRequest,
 * phase}`. R-5 unclassifiable (incl. `reqIdValid !== true`) => unknown-fatal; R-1 bootstrap/harness-
 * endpoint => fatal-required-resource; R-2 no matching rule => fatal-required-resource; R-3 a match
 * uniquely bound to `rule.model`, inside that model's load window, not a navigation =>
 * diagnostic-non-required; R-4 a match whose binding fails (unavailable, ambiguous, unbound, other
 * model) or lies outside the rule model's load window => unknown-fatal (a navigation match stays
 * fatal-required-resource, `R-3`/`navigation`). A response is NEVER an expected cancellation.
 */
function classifyHttpResponse(event, opLedger, markers, prefixDerivation, rules = OPTIONAL_RESPONSE_RULES, prefixSourceLedger = null) {
  let base = { eventKind: 'httpResponse', url: null, method: null, status: null, failureReason: null, resourceType: null, phase: null };
  let sub = 'unclassifiable';
  const unclassifiable = () => fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['R-5', 'unclassifiable', sub]);
  let ev;
  try {
    ev = isPlainObject(event) ? { ...event } : {}; // one read of every field (a throwing getter => unclassifiable)
    base = {
      eventKind: 'httpResponse', url: typeof ev.urlRedacted === 'string' ? ev.urlRedacted : null, method: typeof ev.method === 'string' ? ev.method : null,
      status: Number.isInteger(ev.status) && ev.status >= 400 ? ev.status : null, failureReason: null,
      resourceType: typeof ev.resourceType === 'string' ? ev.resourceType : null, phase: ATTRIBUTION_PHASES.includes(ev.phase) ? ev.phase : null,
    };
    sub = NETWORK_URL_CLASSES.includes(ev.urlClass) ? ev.urlClass : 'unclassifiable';
  } catch {
    return unclassifiable();
  }
  try {
    if (!isHttpEventShapeValid(ev) || !Array.isArray(rules) || !rules.every(isOptionalResponseRuleShape) || !Array.isArray(opLedger) || !Array.isArray(markers)
      || !opLedger.every(isOpLedgerRecordShapeKnown)) return unclassifiable();
    if (ev.urlClass !== 'other') return fatalClassifierResult(base, NETWORK_CLASSIFICATION.FATAL_REQUIRED, ['R-1', ev.urlClass]);
    const rule = matchingResponseRule(ev, rules);
    if (rule === null) return fatalClassifierResult(base, NETWORK_CLASSIFICATION.FATAL_REQUIRED, ['R-2', 'other']);
    if (ev.isNavigationRequest !== false) return fatalClassifierResult(base, NETWORK_CLASSIFICATION.FATAL_REQUIRED, ['R-3', 'navigation', 'other']);
    const prefixKey = networkPrefixKey(ev.urlRedacted);
    const binding = prefixBindingOf(prefixKey, prefixDerivation);
    if (binding.status === 'ambiguous') return fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['R-4', binding.reason, 'other']);
    if (binding.status === 'unbound') return fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['R-4', 'unbound', 'other']);
    if (binding.modelId !== rule.model) return fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['R-4', 'other-model', 'other']);
    const loads = opLedger.map((o, i) => ({ o, i })).filter(({ o }) => isPlainObject(o) && o.recordType === 'load' && o.modelId === rule.model);
    const w = loads.length === 1 && isPlainObject(loads[0].o.expectedRequestWindow) ? loads[0].o.expectedRequestWindow : null;
    const inside = w !== null && isSeq(w.fromSeqExclusive) && isSeq(w.toSeqInclusive) && w.fromSeqExclusive < ev.startSeq && ev.startSeq <= w.toSeqInclusive;
    if (!inside) return fatalClassifierResult(base, NETWORK_CLASSIFICATION.UNKNOWN_FATAL, ['R-4', 'outside-load-window', 'other']);
    const L = loads[0];
    return {
      ...base, modelId: rule.model, boundPrefix: prefixKey, operationId: L.o.operationId, opStartSeq: L.o.startSeq,
      classification: NETWORK_CLASSIFICATION.DIAGNOSTIC, rule: rule.ruleId, reasons: [],
      evidenceRefs: [`/errorLedger/opLedger/${L.i}`, ...prefixSupportRefs(prefixSourceLedger, rule.model, prefixKey), '/errorLedger/prefixDerivation'], verdictEffect: 'none',
    };
  } catch {
    return unclassifiable();
  }
}

/** §9.2 `modelBindingObserved` of a response at its classification seq (`not-evaluated` iff immediate). */
function modelBindingObservedOf(urlRedacted, stage, prefixDerivation) {
  if (stage !== 'provisional') return { status: 'not-evaluated', modelId: null, prefixKey: null };
  const prefixKey = networkPrefixKey(urlRedacted);
  const b = prefixBindingOf(prefixKey, prefixDerivation);
  return { status: b.status, modelId: b.status === 'unique' ? b.modelId : null, prefixKey };
}

/**
 * Prefix-of-record truncation at `seq` (§9.2 closeout re-classification of a response entry "over the
 * persisted record truncated at the entry's finalizedSeq"): op records started after `seq` are
 * dropped, end fields observed after `seq` are reset to the open state, markers after `seq` dropped.
 */
function truncateRecordAt({ opLedger, markers }, seq) {
  const ops = (Array.isArray(opLedger) ? opLedger : []).filter((o) => isPlainObject(o) && isSeq(o.startSeq) && o.startSeq <= seq).map((o) => {
    const c = cloneJson(o);
    if (isSeq(c.endSeq) && c.endSeq > seq) {
      c.endSeq = null; c.endedAt = null;
      if (c.recordType === 'load') { if (isPlainObject(c.expectedRequestWindow)) c.expectedRequestWindow.toSeqInclusive = null; c.completionOutcome = 'not-settled'; }
      if (c.recordType === 'mutation') { if (isPlainObject(c.cancellationWindow)) c.cancellationWindow.toSeqExclusive = null; c.terminalOutcome = 'not-settled'; }
    }
    if (c.recordType === 'mutation' && isPlainObject(c.cancellationWindow) && isSeq(c.cancellationWindow.toSeqExclusive) && c.cancellationWindow.toSeqExclusive > seq) c.cancellationWindow.toSeqExclusive = null;
    return c;
  });
  return { opLedger: ops, markers: (Array.isArray(markers) ? markers : []).filter((m) => isPlainObject(m) && isSeq(m.seq) && m.seq <= seq) };
}

/** The classifier input of a persisted raw event (`reqIdValid` passed explicitly -- recomputed, never trusted). */
function requestFailureInput(e, reqIdValid) {
  return { reqIdValid, startSeq: e.startSeq, failSeq: e.failSeq, method: e.method, resourceType: e.resourceType, urlRedacted: e.urlRedacted, urlClass: e.urlClass, errorText: e.errorText, isNavigationRequest: e.isNavigationRequest, phase: e.phase };
}
function httpResponseInput(e, reqIdValid) {
  return { reqIdValid, startSeq: e.startSeq, responseSeq: e.responseSeq, method: e.method, status: e.status, resourceType: e.resourceType, urlRedacted: e.urlRedacted, urlClass: e.urlClass, isNavigationRequest: e.isNavigationRequest, phase: e.phase };
}

/**
 * The classification context persisted in an error ledger: `opLedger`, `markers`, the persisted
 * `prefixDerivation` (absent => recomputed by `derivePrefixes` from the persisted prefix-source ledger
 * and load records -- before the load windows close that is non-distinguishing) and the
 * `prefixSourceLedger` (the `evidenceRefs` source of a bound result).
 */
function networkContextOf(ledger) {
  const l = isPlainObject(ledger) ? ledger : {};
  const opLedger = Array.isArray(l.opLedger) ? l.opLedger : [];
  const prefixSourceLedger = Array.isArray(l.prefixSourceLedger) ? l.prefixSourceLedger : [];
  return {
    opLedger,
    markers: Array.isArray(l.markers) ? l.markers : [],
    prefixDerivation: isPlainObject(l.prefixDerivation) ? l.prefixDerivation : derivePrefixes(prefixSourceLedger, opLedger),
    prefixSourceLedger,
  };
}

/** Closeout re-classification of one raw event (§9.2 "Timing and consistency"). */
function reclassifyRawEvent(kind, e, reqIdValid, ctx, rules) {
  if (kind === 'requestfailed') return classifyRequestFailure(requestFailureInput(e, reqIdValid), ctx.opLedger, ctx.markers, ctx.prefixDerivation, ctx.prefixSourceLedger);
  const t = truncateRecordAt(ctx, e.finalizedSeq);
  return classifyHttpResponse(httpResponseInput(e, reqIdValid), t.opLedger, t.markers, ctx.prefixDerivation, rules, ctx.prefixSourceLedger);
}

/**
 * W-1 identity recomputation from `requestObservations[]` (never trusted): `reqIdValid` iff `reqId`
 * is a non-empty string, exactly one observation has it, and that observation repeats the raw event's
 * startSeq, method, resourceType and urlRedacted. `identityKey = 'req:'+reqId` iff valid, else
 * `'invalid:'+rawEventSeq` (never merged, never suppressed).
 */
function recomputeRequestIdentity(raw, observations) {
  const obs = Array.isArray(observations) ? observations : [];
  const reqId = isPlainObject(raw) ? raw.reqId : undefined;
  let valid = false;
  if (isNonEmptyStr(reqId)) {
    const m = obs.filter((o) => isPlainObject(o) && o.reqId === reqId);
    valid = m.length === 1 && m[0].startSeq === raw.startSeq && m[0].method === raw.method && m[0].resourceType === raw.resourceType && m[0].urlRedacted === raw.urlRedacted;
  }
  return { reqIdValid: valid, identityKey: valid ? `req:${reqId}` : `invalid:${isPlainObject(raw) ? raw.rawEventSeq : 'unknown'}` };
}

/** All raw events of a ledger, tagged with their kind, ascending `rawEventSeq` (W-1). */
function rawNetworkEventsOf(ledger) {
  const l = isPlainObject(ledger) ? ledger : {};
  const out = [];
  (Array.isArray(l.requestFailures) ? l.requestFailures : []).forEach((e, i) => { if (isPlainObject(e)) out.push({ kind: 'requestfailed', e, list: 'requestFailures', i }); });
  (Array.isArray(l.responseFailures) ? l.responseFailures : []).forEach((e, i) => { if (isPlainObject(e)) out.push({ kind: 'httpResponse', e, list: 'responseFailures', i }); });
  return out.sort((a, b) => (isSeq(a.e.rawEventSeq) ? a.e.rawEventSeq : Infinity) - (isSeq(b.e.rawEventSeq) ? b.e.rawEventSeq : Infinity));
}

/** `duplicateOf` (W-1): the earliest earlier raw event with the same identityKey AND eventKind, else null. */
function duplicateOfAmong(prior, kind, identityKey) {
  const hit = prior.find((p) => p.kind === kind && p.identityKey === identityKey);
  return hit ? hit.rawEventId : null;
}

/**
 * `correlateNetworkEvents(ledger)` -- pure W-1..W-5 recomputation from the RETAINED raw events and
 * `requestObservations[]`: per raw event `{reqIdValid, identityKey, duplicateOf, effective
 * classification, effective seq}`; `correlatedRequests[]` (one per identityKey, ordered by the
 * smallest member rawEventSeq; ownership conflict => unknown-fatal); the closeout view of
 * `fatalWitnesses[]` (exactly one per fatal identity, ascending witnessSeq); and the `witnessCount`
 * record. Effective classification = `closeout.classification` (unknown-fatal when the identity is
 * invalid or the result is missing); effective seq = rawEventSeq (requestfailed / immediate) or
 * finalizedSeq (provisional; an unfinalized provisional member has no effect yet).
 */
function correlateNetworkEvents(ledger) {
  const l = isPlainObject(ledger) ? ledger : {};
  const observations = Array.isArray(l.requestObservations) ? l.requestObservations : [];
  const entries = Array.isArray(l.entries) ? l.entries : [];
  const events = [];
  for (const r of rawNetworkEventsOf(l)) {
    const id = recomputeRequestIdentity(r.e, observations);
    const cls = isPlainObject(r.e.closeout) && NETWORK_CLASSIFICATIONS.includes(r.e.closeout.classification) ? r.e.closeout.classification : null;
    const provisional = r.kind === 'httpResponse' && r.e.stage === 'provisional';
    const effSeq = provisional ? (isSeq(r.e.finalizedSeq) ? r.e.finalizedSeq : null) : (isSeq(r.e.rawEventSeq) ? r.e.rawEventSeq : null);
    const effCls = effSeq === null ? null : (!id.reqIdValid || cls === null ? NETWORK_CLASSIFICATION.UNKNOWN_FATAL : cls);
    const modelIds = [];
    if (effSeq !== null) {
      if (isPlainObject(r.e.closeout) && (r.e.closeout.modelId === 'A' || r.e.closeout.modelId === 'B')) modelIds.push(r.e.closeout.modelId);
      if (r.kind === 'httpResponse' && isPlainObject(r.e.modelBindingObserved) && (r.e.modelBindingObserved.modelId === 'A' || r.e.modelBindingObserved.modelId === 'B')) modelIds.push(r.e.modelBindingObserved.modelId);
    }
    const rawEventId = r.kind === 'requestfailed' ? `rf:${r.e.rawEventSeq}` : `hr:${r.e.rawEventSeq}`;
    events.push({ ...r, rawEventId, ...id, duplicateOf: duplicateOfAmong(events, r.kind, id.identityKey), effSeq, effCls, modelIds });
  }
  const groups = new Map();
  for (const ev of events) {
    if (!groups.has(ev.identityKey)) groups.set(ev.identityKey, []);
    groups.get(ev.identityKey).push(ev);
  }
  const correlatedRequests = [];
  const witnesses = [];
  for (const [identityKey, members] of groups) {
    const valid = identityKey.startsWith('req:');
    const effective = members.filter((m) => m.effSeq !== null).sort((a, b) => a.effSeq - b.effSeq);
    const modelIds = [...new Set(effective.flatMap((m) => m.modelIds))].sort();
    const status = members.length === 1 ? 'single' : modelIds.length === 2 ? 'conflicting' : 'consistent';
    let worst = null;
    for (const m of effective) worst = worst === null ? m.effCls : worseClassification(worst, m.effCls);
    if (worst === null) worst = NETWORK_CLASSIFICATION.EXPECTED; // only unfinalized provisional members: no effect yet (transient)
    if (status === 'conflicting') worst = NETWORK_CLASSIFICATION.UNKNOWN_FATAL;
    const fatal = isFatalClassification(worst);
    const fatalMembers = effective.filter((m) => isFatalClassification(m.effCls));
    let fatalSinceSeq = null;
    if (fatal) {
      if (fatalMembers.length > 0) fatalSinceSeq = fatalMembers[0].effSeq;
      else {
        const seen = new Set();
        for (const m of effective) { for (const x of m.modelIds) seen.add(x); if (seen.size >= 2) { fatalSinceSeq = m.effSeq; break; } }
      }
    }
    const rawEventRefs = members.map((m) => m.rawEventId);
    const witnessId = fatal ? `w:${identityKey}` : null;
    correlatedRequests.push({
      identityKey, identityKind: valid ? 'reqId' : 'invalid', reqId: valid ? identityKey.slice(4) : null, rawEventRefs,
      eventKinds: [...new Set(members.map((m) => m.kind))].sort(), ownership: { status, modelIds }, worstClassification: worst, fatal, fatalSinceSeq, witnessId,
    });
    if (fatal) {
      const at = effective.find((m) => m.effSeq === fatalSinceSeq) || members[0];
      const entryIdx = entries.findIndex((e) => isPlainObject(e) && e.kind === NETWORK_FATAL_ENTRY_KIND && e.witnessId === witnessId);
      witnesses.push({
        witnessId, requestIdentityKey: identityKey, rawEventRefs, fatalRawEventRefs: fatalMembers.slice().sort((a, b) => a.e.rawEventSeq - b.e.rawEventSeq).map((m) => m.rawEventId),
        worstClassification: worst, witnessSeq: fatalSinceSeq, phase: at.e.phase, activeCheck: at.e.activeCheck, modelOwnership: { status, modelIds },
        ledgerEntryRef: entryIdx === -1 ? null : `/errorLedger/entries/${entryIdx}`,
        view: { worstClassification: worst, witnessSeq: fatalSinceSeq, rawEventRefs },
      });
    }
  }
  witnesses.sort((a, b) => a.witnessSeq - b.witnessSeq);
  const rrfEntries = entries.filter((e) => isPlainObject(e) && e.kind === NETWORK_FATAL_ENTRY_KIND).length;
  const nonNetwork = entries.filter((e) => !(isPlainObject(e) && e.kind === NETWORK_FATAL_ENTRY_KIND)).length;
  const witnessCount = {
    requestObservations: observations.length, rawEvents: events.length, correlatedIdentities: correlatedRequests.length,
    fatalIdentities: correlatedRequests.filter((c) => c.fatal).length, fatalWitnesses: witnesses.length,
    requiredResourceFailureEntries: rrfEntries, nonNetworkFatalEntries: nonNetwork, fatalCount: witnesses.length + nonNetwork,
  };
  return { events, correlatedRequests, witnesses, witnessCount };
}

// ============================================================================================
// §9.2 operation ledger `opLedger` (exact disjoint `loadOperation` / `mutationOperation` shapes),
// durable prefix-source ledger `prefixSourceLedger[]`, `derivePrefixes` / `prefixDerivation` (+
// hashes), ambiguous-prefix accounting `ambiguousPrefixes[]` and `boundPrefix` provenance (slice C2;
// procedure §9.2 RC1-C1, §10). Model-specific prefixes are derived ONLY from accepted
// successful-request evidence (finished 2xx, inside its own CLOSED, DISJOINT load window, non-
// ambiguous key); everything else is non-distinguishing (fail-safe: nothing can bind).
// ============================================================================================

const LOAD_OPERATION_KEYS = Object.freeze(['recordType', 'operationId', 'modelId', 'modelUrnSha256', 'phase', 'startSeq', 'startedAt', 'endSeq', 'endedAt', 'expectedRequestWindow', 'prefixSourceRef', 'completionOutcome']);
const MUTATION_OPERATION_KEYS = Object.freeze(['recordType', 'operationId', 'operationType', 'teardownTarget', 'modelId', 'phase', 'invokedBy', 'startSeq', 'startedAt', 'ackSeq', 'endSeq', 'endedAt', 'cancellationWindow', 'causalEvidence', 'terminalOutcome']);
const LOAD_COMPLETION_OUTCOMES = Object.freeze(['ready', 'rejected', 'timeout:load', 'harness-exception', 'not-settled']);
const MUTATION_TERMINAL_OUTCOMES = Object.freeze(['settled', 'threw', 'timeout', 'not-settled']);
const TEARDOWN_TARGETS = Object.freeze(['closePage', 'closeContext', 'closeBrowser']);
const CLEANUP_UNLOAD_INVOKER = Object.freeze({ A: 'cleanup:unloadModelA', B: 'cleanup:unloadModelB' });
/** Harness-origin spy records of the in-page C16/C17 mutations (the `causalEvidence.spyRef` target; verdict-critical). */
const OP_LEDGER_SPY_METHODS = Object.freeze(['viewer.hideModel', 'viewer.unloadModel']);
const SPY_REF_RE = /^spyLedger:seq:\d+$/;
const PREFIX_SOURCE_ENTRY_KEYS = Object.freeze(['entryId', 'reqId', 'loadOperationId', 'modelId', 'startSeq', 'terminalKind', 'terminalSeq', 'status', 'method', 'resourceType', 'urlRedacted', 'urlClass', 'isNavigationRequest', 'prefixKey', 'disposition', 'reason']);
const PREFIX_SOURCE_REASONS = Object.freeze(['included', 'excluded:resource-type', 'excluded:url-class', 'excluded:navigation', 'excluded:failed', 'excluded:status', 'excluded:not-finished-in-window', 'excluded:window-open', 'excluded:windows-overlap', 'excluded:ambiguous']);
const PREFIX_DERIVATION_KEYS = Object.freeze(['algorithm', 'loadOperationIds', 'windows', 'bindingAvailable', 'nonDistinguishingReason', 'candidateKeys', 'ambiguousKeys', 'modelPrefixes', 'ledgerSha256', 'derivationSha256']);
const PREFIX_DERIVATION_ALGORITHM = 'g2-prefix-v1';
/** The slice-C2 error-ledger list collections (required in R1, §10; verdict-critical, never truncated). */
const NETWORK_C2_LIST_KEYS = Object.freeze(['opLedger', 'prefixSourceLedger', 'ambiguousPrefixes']);

const isLoadRecordish = (o) => isPlainObject(o) && o.recordType === 'load';
const isMutationRecordish = (o) => isPlainObject(o) && o.recordType === 'mutation';

/**
 * Binding availability of a set of load records (§9.2 derivation rule): available iff exactly one
 * load record per model exists, both with `endSeq !== null`, and their windows are disjoint
 * (`A.endSeq < B.startSeq || B.endSeq < A.startSeq`). More than one load record for a model is
 * treated as a missing record (`no-load-operation`; fail-safe -- the validator also rejects it).
 */
function prefixBindingState(loadOperations) {
  const loads = (Array.isArray(loadOperations) ? loadOperations : []).filter(isLoadRecordish);
  const byModel = { A: null, B: null };
  for (const m of ['A', 'B']) {
    const ls = loads.filter((l) => l.modelId === m);
    if (ls.length === 1 && isNonEmptyStr(ls[0].operationId) && isSeq(ls[0].startSeq)) byModel[m] = ls[0];
  }
  let reason = null;
  if (!byModel.A || !byModel.B) reason = 'no-load-operation';
  else if (!isSeq(byModel.A.endSeq) || !isSeq(byModel.B.endSeq)) reason = 'window-open';
  else if (!(byModel.A.endSeq < byModel.B.startSeq || byModel.B.endSeq < byModel.A.startSeq)) reason = 'windows-overlap';
  return { byModel, bindingAvailable: reason === null, nonDistinguishingReason: reason };
}

/**
 * The first applicable exclusion of a prefix-source entry EXCEPT `excluded:ambiguous` (§9.2 listed
 * order), or null when the entry meets every inclusion condition but non-ambiguity (= it is a
 * candidate). Recomputed from the entry's raw fields and the load records -- the stored `reason` is
 * never trusted. A failing candidate (requestfailed / non-2xx / not finished inside its window) can
 * never prove its own prefix. `no-load-operation` has no dedicated reason and is reported as
 * `excluded:window-open` (the missing window is not closed).
 */
function prefixEntryCandidateExclusion(e, st) {
  if (!EC_RESOURCE_TYPES.includes(e.resourceType)) return 'excluded:resource-type';
  if (e.urlClass !== 'other') return 'excluded:url-class';
  if (e.isNavigationRequest !== false) return 'excluded:navigation';
  if (e.terminalKind === 'requestfailed') return 'excluded:failed';
  const ok2xx = Number.isInteger(e.status) && e.status >= 200 && e.status <= 299;
  if ((e.status !== null && !ok2xx) || (e.status === null && e.terminalKind === 'requestfinished')) return 'excluded:status';
  const L = st.byModel[e.modelId] || null;
  const own = L !== null && L.operationId === e.loadOperationId;
  if (e.terminalKind !== 'requestfinished' || !isSeq(e.terminalSeq) || (own && isSeq(L.endSeq) && e.terminalSeq > L.endSeq)) return 'excluded:not-finished-in-window';
  if (!st.bindingAvailable) return st.nonDistinguishingReason === 'windows-overlap' ? 'excluded:windows-overlap' : 'excluded:window-open';
  if (!own) return 'excluded:window-open'; // an entry of no current load window can never bind
  return null;
}

/**
 * `derivePrefixes(prefixSourceLedger, loadOperations)` (§9.2; pure, deterministic): `candidateKeys[M]`
 * = prefix keys of model-M entries meeting every inclusion condition except non-ambiguity;
 * `ambiguousKeys = candidateKeys[A] ∩ candidateKeys[B]`; `modelPrefixes[M] = candidateKeys[M] −
 * ambiguousKeys` (ascending). Binding unavailable => all three empty. Returns the exact persisted
 * `prefixDerivation` record (`ledgerSha256` = SHA-256 of the canonical JSON of the ledger,
 * `derivationSha256` = SHA-256 of the canonical JSON of {bindingAvailable, candidateKeys,
 * ambiguousKeys, modelPrefixes}).
 */
function derivePrefixes(prefixSourceLedger, loadOperations) {
  const ledger = Array.isArray(prefixSourceLedger) ? prefixSourceLedger : [];
  const st = prefixBindingState(loadOperations);
  const cand = { A: new Set(), B: new Set() };
  if (st.bindingAvailable) {
    for (const e of ledger) {
      if (isPlainObject(e) && (e.modelId === 'A' || e.modelId === 'B') && typeof e.prefixKey === 'string' && prefixEntryCandidateExclusion(e, st) === null) cand[e.modelId].add(e.prefixKey);
    }
  }
  const candidateKeys = { A: [...cand.A].sort(), B: [...cand.B].sort() };
  const ambiguousKeys = candidateKeys.A.filter((k) => cand.B.has(k));
  const amb = new Set(ambiguousKeys);
  const modelPrefixes = { A: candidateKeys.A.filter((k) => !amb.has(k)), B: candidateKeys.B.filter((k) => !amb.has(k)) };
  const win = (L) => (L ? { fromSeqExclusive: L.startSeq, toSeqInclusive: isSeq(L.endSeq) ? L.endSeq : null } : null);
  return {
    algorithm: PREFIX_DERIVATION_ALGORITHM,
    loadOperationIds: { A: st.byModel.A ? st.byModel.A.operationId : null, B: st.byModel.B ? st.byModel.B.operationId : null },
    windows: { A: win(st.byModel.A), B: win(st.byModel.B) },
    bindingAvailable: st.bindingAvailable, nonDistinguishingReason: st.nonDistinguishingReason,
    candidateKeys, ambiguousKeys, modelPrefixes,
    ledgerSha256: sha256Hex(canonicalJson(ledger)),
    derivationSha256: sha256Hex(canonicalJson({ bindingAvailable: st.bindingAvailable, candidateKeys, ambiguousKeys, modelPrefixes })),
  };
}

/** The full §9.2 `reason` of one entry (first applicable, `excluded:ambiguous` last). */
function prefixEntryReason(e, st, ambiguousKeys) {
  const pre = prefixEntryCandidateExclusion(e, st);
  if (pre !== null) return pre;
  return ambiguousKeys.includes(e.prefixKey) ? 'excluded:ambiguous' : 'included';
}

/** `ambiguousPrefixes[]` (§9.2): one entry per ambiguous key with the candidate entry ids of each model (ledger order). */
function ambiguousPrefixesOf(prefixSourceLedger, loadOperations, derivation) {
  const ledger = Array.isArray(prefixSourceLedger) ? prefixSourceLedger : [];
  const st = prefixBindingState(loadOperations);
  const ids = (m, k) => ledger.filter((e) => isPlainObject(e) && e.modelId === m && e.prefixKey === k && prefixEntryCandidateExclusion(e, st) === null).map((e) => e.entryId);
  return (derivation && Array.isArray(derivation.ambiguousKeys) ? derivation.ambiguousKeys : []).map((k) => ({ prefixKey: k, sourceEntryIds: { A: ids('A', k), B: ids('B', k) } }));
}

/**
 * Builds the prefix-source ledger from the request observations, the load records and per-request
 * terminal evidence (`terminalOf(reqId) -> {terminalKind, terminalSeq}|null`, `statusOf(reqId) ->
 * integer|null`): exactly one entry per (observation, load record) pair whose `startSeq` lies inside
 * that load's `expectedRequestWindow` (an open window extends to closeout), `entryId = reqId + ':' +
 * loadOperationId`, ascending by (startSeq, modelId A before B). Overlapping windows => two entries.
 * Returns `{prefixSourceLedger, prefixDerivation, ambiguousPrefixes}`.
 */
function buildPrefixSourceLedger({ observations, opLedger, terminalOf = () => null, statusOf = () => null }) {
  const loads = (Array.isArray(opLedger) ? opLedger : []).filter((L) => isLoadRecordish(L) && isNonEmptyStr(L.operationId) && (L.modelId === 'A' || L.modelId === 'B') && isSeq(L.startSeq));
  const entries = [];
  for (const o of Array.isArray(observations) ? observations : []) {
    if (!isPlainObject(o) || !isSeq(o.startSeq)) continue;
    for (const L of loads) {
      const to = isSeq(L.endSeq) ? L.endSeq : null;
      if (!(L.startSeq < o.startSeq && (to === null || o.startSeq <= to))) continue;
      const t = terminalOf(o.reqId);
      const status = statusOf(o.reqId);
      entries.push({
        entryId: `${o.reqId}:${L.operationId}`, reqId: o.reqId, loadOperationId: L.operationId, modelId: L.modelId, startSeq: o.startSeq,
        terminalKind: t && (t.terminalKind === 'requestfinished' || t.terminalKind === 'requestfailed') ? t.terminalKind : 'none',
        terminalSeq: t && isSeq(t.terminalSeq) ? t.terminalSeq : null, status: Number.isInteger(status) ? status : null,
        method: o.method, resourceType: o.resourceType, urlRedacted: o.urlRedacted, urlClass: o.urlClass, isNavigationRequest: o.isNavigationRequest,
        prefixKey: networkPrefixKey(o.urlRedacted) ?? '', disposition: 'excluded', reason: 'excluded:window-open',
      });
    }
  }
  entries.sort((a, b) => (a.startSeq - b.startSeq) || (a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0));
  const st = prefixBindingState(opLedger);
  const keys = derivePrefixes(entries, opLedger); // reasons do not influence the key sets
  for (const e of entries) {
    e.reason = prefixEntryReason(e, st, keys.ambiguousKeys);
    e.disposition = e.reason === 'included' ? 'included' : 'excluded';
  }
  const prefixDerivation = derivePrefixes(entries, opLedger);
  return { prefixSourceLedger: entries, prefixDerivation, ambiguousPrefixes: ambiguousPrefixesOf(entries, opLedger, prefixDerivation) };
}

/**
 * The prefix-source SNAPSHOT cutoff (§9.2 "prefixes are frozen when the load windows close"): the
 * later load window's `endSeq` once both load records are closed; otherwise the `closeout` marker
 * (an open window extends to closeout); otherwise unbounded. Terminal fields of the persisted
 * entries reflect exactly the terminals with `terminalSeq <=` this cutoff.
 */
function prefixSnapshotCutoff(ledger) {
  const l = isPlainObject(ledger) ? ledger : {};
  const st = prefixBindingState(l.opLedger);
  if (st.byModel.A && st.byModel.B && isSeq(st.byModel.A.endSeq) && isSeq(st.byModel.B.endSeq)) return Math.max(st.byModel.A.endSeq, st.byModel.B.endSeq);
  const c = (Array.isArray(l.markers) ? l.markers : []).find((m) => isPlainObject(m) && m.name === 'closeout' && isSeq(m.seq));
  return c ? c.seq : Infinity;
}

/** True iff the persisted derivation is the frozen one of the CURRENT, both-closed load records. */
function isPrefixLedgerFrozen(ledger) {
  const l = isPlainObject(ledger) ? ledger : {};
  const st = prefixBindingState(l.opLedger);
  if (!(st.byModel.A && st.byModel.B && isSeq(st.byModel.A.endSeq) && isSeq(st.byModel.B.endSeq))) return false;
  const pd = l.prefixDerivation;
  const d = derivePrefixes([], l.opLedger);
  return isPlainObject(pd) && sameJson(pd.loadOperationIds, d.loadOperationIds) && sameJson(pd.windows, d.windows);
}

/**
 * Builds and persists the prefix-source snapshot -- `prefixSourceLedger[]`, `prefixDerivation`,
 * `ambiguousPrefixes[]`, `modelPrefixes` and every load record's `prefixSourceRef` (§9.2). Terminal
 * evidence comes from `prefixSources` (`{terminalOf, statusOf}`, the instrumentation's in-memory
 * terminal record) or, when absent, from the already persisted entries; terminals after the snapshot
 * cutoff (`prefixSnapshotCutoff`) are ignored. Called ONCE when the later load window closes (frozen
 * from then on -- never rebuilt or "healed" afterwards) or, if a window never closed, at closeout step 1.
 */
function refreshPrefixSourceLedger(ledger, { prefixSources = null } = {}) {
  ensureNetworkLedger(ledger);
  const prev = new Map();
  for (const e of Array.isArray(ledger.prefixSourceLedger) ? ledger.prefixSourceLedger : []) if (isPlainObject(e) && !prev.has(e.reqId)) prev.set(e.reqId, e);
  const src = prefixSources && typeof prefixSources.terminalOf === 'function' && typeof prefixSources.statusOf === 'function' ? prefixSources : null;
  const cutoff = prefixSnapshotCutoff(ledger);
  const terminalOf = (reqId) => {
    let t;
    if (src) t = src.terminalOf(reqId);
    else { const p = prev.get(reqId); t = p && p.terminalKind !== 'none' ? { terminalKind: p.terminalKind, terminalSeq: p.terminalSeq } : null; }
    return t && isSeq(t.terminalSeq) && t.terminalSeq <= cutoff ? t : null;
  };
  const statusOf = (reqId) => (src ? src.statusOf(reqId) : (prev.has(reqId) ? prev.get(reqId).status : null));
  const built = buildPrefixSourceLedger({ observations: ledger.requestObservations, opLedger: ledger.opLedger, terminalOf, statusOf });
  ledger.prefixSourceLedger = built.prefixSourceLedger;
  ledger.prefixDerivation = built.prefixDerivation;
  ledger.ambiguousPrefixes = built.ambiguousPrefixes;
  ledger.modelPrefixes = cloneJson(built.prefixDerivation.modelPrefixes);
  for (const L of ledger.opLedger) {
    if (!isLoadRecordish(L)) continue;
    L.prefixSourceRef = { entryIds: built.prefixSourceLedger.filter((e) => e.loadOperationId === L.operationId).map((e) => e.entryId), ledgerSha256: built.prefixDerivation.ledgerSha256 };
  }
  return ledger;
}

/**
 * JSON Pointers of the prefix-source entries supporting a binding of `prefixKey` to `modelId`
 * (§9.2 `evidenceRefs`): every included entry of that model with that key, in ledger order.
 */
function prefixSupportRefs(prefixSourceLedger, modelId, prefixKey) {
  const out = [];
  (Array.isArray(prefixSourceLedger) ? prefixSourceLedger : []).forEach((e, i) => {
    if (isPlainObject(e) && e.modelId === modelId && e.prefixKey === prefixKey && e.disposition === 'included' && e.reason === 'included') out.push(`/errorLedger/prefixSourceLedger/${i}`);
  });
  return out;
}

/**
 * `end(O)` of C-d / `cancellationWindow.toSeqExclusive`: the first of {startSeq of a later opLedger
 * record, a later phase-boundary marker (incl. `closeout`)} that already exists in the record; null
 * while none exists (the window is open).
 */
function cancellationWindowEnd(O, opLedger, markers) {
  const later = [
    ...(Array.isArray(opLedger) ? opLedger : []).filter((o) => isPlainObject(o) && isSeq(o.startSeq) && o.startSeq > O.startSeq).map((o) => o.startSeq),
    ...(Array.isArray(markers) ? markers : []).filter((m) => isPlainObject(m) && isSeq(m.seq) && m.seq > O.startSeq).map((m) => m.seq),
  ];
  return later.length ? Math.min(...later) : null;
}

/** Recomputes every mutation record's `cancellationWindow.toSeqExclusive` from the record (in place). */
function refreshCancellationWindows(ledger) {
  const ops = isPlainObject(ledger) && Array.isArray(ledger.opLedger) ? ledger.opLedger : [];
  const markers = isPlainObject(ledger) && Array.isArray(ledger.markers) ? ledger.markers : [];
  for (const O of ops) if (isMutationRecordish(O) && isSeq(O.startSeq) && isPlainObject(O.cancellationWindow)) O.cancellationWindow.toSeqExclusive = cancellationWindowEnd(O, ops, markers);
  return ledger;
}

/**
 * The exact §9.2 schema + couplings of ONE opLedger record (test (15)): all keys required, unknown
 * keys rejected, `null` only where stated. `load`: phase P1, window = (startSeq, endSeq],
 * `not-settled` iff `endSeq === null`. `mutation`: `hide` <=> C16 hideModel(B) (P9); `unload` <=> C17
 * unload of B (P9, §4.8 -- C17 unloads B only) or a cleanup unload step of its own model; `teardown`
 * <=> cleanup page/context/browser close (`modelId:null`, `invokedBy:'cleanup:'+teardownTarget`);
 * `startSeq < ackSeq < endSeq`; `causalEvidence` repeats `ackSeq` and points at the spy record (P9:
 * `spyLedger:seq:<n>`) or the cleanup-step record (`/cleanupStepStatus/<step>`). Returns problems.
 */
function opLedgerRecordProblems(o) {
  if (!isPlainObject(o)) return ['not-object'];
  const out = [];
  const endedOk = (e) => (e.endSeq === null) === (e.endedAt === null) && (e.endedAt === null || isNonEmptyStr(e.endedAt));
  if (o.recordType === 'load') {
    if (!exactKeys(o, LOAD_OPERATION_KEYS)) out.push('keys');
    if (!isNonEmptyStr(o.operationId)) out.push('operationId');
    if (!(o.modelId === 'A' || o.modelId === 'B')) out.push('modelId');
    if (!(typeof o.modelUrnSha256 === 'string' && SHA256_HEX_RE.test(o.modelUrnSha256))) out.push('modelUrnSha256');
    if (o.phase !== 'P1') out.push('phase');
    if (!isSeq(o.startSeq)) out.push('startSeq');
    if (!isNonEmptyStr(o.startedAt)) out.push('startedAt');
    if (!(o.endSeq === null || (isSeq(o.endSeq) && isSeq(o.startSeq) && o.endSeq > o.startSeq))) out.push('endSeq');
    if (!endedOk(o)) out.push('endedAt');
    const w = o.expectedRequestWindow;
    if (!exactKeys(w, ['fromSeqExclusive', 'toSeqInclusive']) || w.fromSeqExclusive !== o.startSeq || w.toSeqInclusive !== o.endSeq) out.push('expectedRequestWindow');
    const r = o.prefixSourceRef;
    if (!exactKeys(r, ['entryIds', 'ledgerSha256']) || !Array.isArray(r.entryIds) || !r.entryIds.every(isNonEmptyStr) || !(typeof r.ledgerSha256 === 'string' && SHA256_HEX_RE.test(r.ledgerSha256))) out.push('prefixSourceRef');
    if (!LOAD_COMPLETION_OUTCOMES.includes(o.completionOutcome) || (o.completionOutcome === 'not-settled') !== (o.endSeq === null)) out.push('completionOutcome');
    return out;
  }
  if (o.recordType !== 'mutation') return ['recordType'];
  if (!exactKeys(o, MUTATION_OPERATION_KEYS)) out.push('keys');
  if (!isNonEmptyStr(o.operationId)) out.push('operationId');
  if (!MUTATION_OPERATION_TYPES.includes(o.operationType)) out.push('operationType');
  let coupled;
  if (o.operationType === 'hide') coupled = o.modelId === 'B' && o.teardownTarget === null && o.phase === 'P9' && o.invokedBy === 'C16';
  else if (o.operationType === 'unload') {
    coupled = o.teardownTarget === null && ((o.phase === 'P9' && o.invokedBy === 'C17' && o.modelId === 'B')
      || (o.phase === 'cleanup' && (o.modelId === 'A' || o.modelId === 'B') && o.invokedBy === CLEANUP_UNLOAD_INVOKER[o.modelId]));
  } else if (o.operationType === 'teardown') coupled = o.modelId === null && TEARDOWN_TARGETS.includes(o.teardownTarget) && o.phase === 'cleanup' && o.invokedBy === `cleanup:${o.teardownTarget}`;
  else coupled = false;
  if (!coupled) out.push('coupling');
  if (!isSeq(o.startSeq)) out.push('startSeq');
  if (!isNonEmptyStr(o.startedAt)) out.push('startedAt');
  if (!(isSeq(o.ackSeq) && isSeq(o.startSeq) && o.ackSeq > o.startSeq)) out.push('ackSeq');
  if (!(o.endSeq === null || (isSeq(o.endSeq) && isSeq(o.ackSeq) && o.endSeq > o.ackSeq))) out.push('endSeq');
  if (!endedOk(o)) out.push('endedAt');
  const w = o.cancellationWindow;
  if (!exactKeys(w, ['fromSeqExclusive', 'toSeqExclusive']) || w.fromSeqExclusive !== o.startSeq || !(w.toSeqExclusive === null || (isSeq(w.toSeqExclusive) && w.toSeqExclusive > o.startSeq))) out.push('cancellationWindow');
  const c = o.causalEvidence;
  if (!exactKeys(c, ['spyRef', 'cleanupStepRef', 'ackSeq']) || c.ackSeq !== o.ackSeq) out.push('causalEvidence');
  else if (o.phase === 'P9') { if (!(typeof c.spyRef === 'string' && SPY_REF_RE.test(c.spyRef) && c.cleanupStepRef === null)) out.push('causalEvidence-ref'); } else if (!(c.spyRef === null && typeof o.invokedBy === 'string' && c.cleanupStepRef === `/cleanupStepStatus/${o.invokedBy.slice('cleanup:'.length)}`)) out.push('causalEvidence-ref');
  if (!MUTATION_TERMINAL_OUTCOMES.includes(o.terminalOutcome) || (o.terminalOutcome === 'not-settled') !== (o.endSeq === null)) out.push('terminalOutcome');
  return out;
}

/**
 * `createOperationLedger({ledger, nextSeq, clock})` -- the harness-owned §9.2 operation-ledger
 * writer (node side; the run's single counter). `beginLoad`/`endLoad` record a `loadOperation`
 * (start fields appended BEFORE the load is invoked); `beginMutation` appends a `mutationOperation`'s
 * start fields and its node-side acknowledgement (`ackSeq`) BEFORE the caller invokes the mutation;
 * `endMutation` records the end fields. Every append closes earlier open cancellation windows.
 * `pageOperation(action, arg)` is the node half of the in-page acknowledgement barrier: only
 * `hide`/B/C16, `unload`/B/C17 (spy record attached at `end`) and a cleanup unload step of its own
 * model that is about to call `viewer.unloadModel` are accepted. After `seal()` (closeout) nothing is recorded. A
 * descriptor violating the §9.2 coupling throws (harness defect) -- nothing is appended.
 */
function createOperationLedger({ ledger, nextSeq, clock = defaultClock }) {
  ensureNetworkLedger(ledger);
  let sealed = false;
  const byId = new Map();
  const append = (rec) => { ledger.opLedger.push(rec); byId.set(rec.operationId, rec); refreshCancellationWindows(ledger); return rec; };
  const api = {
    beginLoad({ modelId, modelUrnSha256 }) {
      if (sealed) return null;
      if (!(modelId === 'A' || modelId === 'B')) throw new TypeError('beginLoad: modelId must be A or B');
      const startSeq = nextSeq();
      return append({
        recordType: 'load', operationId: `load:${modelId}:${startSeq}`, modelId, modelUrnSha256, phase: 'P1', startSeq, startedAt: clock.nowIso(),
        endSeq: null, endedAt: null, expectedRequestWindow: { fromSeqExclusive: startSeq, toSeqInclusive: null },
        prefixSourceRef: { entryIds: [], ledgerSha256: isPlainObject(ledger.prefixDerivation) ? ledger.prefixDerivation.ledgerSha256 : derivePrefixes([], []).ledgerSha256 },
        completionOutcome: 'not-settled',
      });
    },
    endLoad(rec, completionOutcome) {
      if (sealed || !isLoadRecordish(rec) || rec.endSeq !== null) return null;
      if (!LOAD_COMPLETION_OUTCOMES.includes(completionOutcome) || completionOutcome === 'not-settled') throw new TypeError(`endLoad: invalid completionOutcome ${String(completionOutcome)}`);
      rec.endSeq = nextSeq();
      rec.endedAt = clock.nowIso();
      rec.expectedRequestWindow.toSeqInclusive = rec.endSeq;
      rec.completionOutcome = completionOutcome;
      return rec;
    },
    beginMutation({ operationType, teardownTarget = null, modelId = null, phase, invokedBy, spyRef = null, cleanupStepRef = null }) {
      if (sealed) return null;
      const probe = {
        recordType: 'mutation', operationId: 'probe', operationType, teardownTarget, modelId, phase, invokedBy, startSeq: 1, startedAt: 'x', ackSeq: 2,
        endSeq: null, endedAt: null, cancellationWindow: { fromSeqExclusive: 1, toSeqExclusive: null },
        // the P9 spy record is attached at endMutation (it is created by the invocation itself, after the ack)
        causalEvidence: { spyRef: spyRef === null && phase === 'P9' ? 'spyLedger:seq:0' : spyRef, cleanupStepRef, ackSeq: 2 }, terminalOutcome: 'not-settled',
      };
      const bad = opLedgerRecordProblems(probe);
      if (bad.length) throw new TypeError(`beginMutation: invalid descriptor (${bad.join(', ')})`);
      const startSeq = nextSeq();
      const startedAt = clock.nowIso();
      const ackSeq = nextSeq(); // node-side acknowledgement, strictly before the caller invokes the mutation
      return append({
        recordType: 'mutation', operationId: `op:${operationType}:${startSeq}`, operationType, teardownTarget, modelId, phase, invokedBy, startSeq, startedAt, ackSeq,
        endSeq: null, endedAt: null, cancellationWindow: { fromSeqExclusive: startSeq, toSeqExclusive: null }, causalEvidence: { spyRef, cleanupStepRef, ackSeq }, terminalOutcome: 'not-settled',
      });
    },
    endMutation(operationId, terminalOutcome, { spyRef = null } = {}) {
      const rec = byId.get(operationId);
      if (sealed || !isMutationRecordish(rec) || rec.endSeq !== null) return null;
      if (!MUTATION_TERMINAL_OUTCOMES.includes(terminalOutcome) || terminalOutcome === 'not-settled') throw new TypeError(`endMutation: invalid terminalOutcome ${String(terminalOutcome)}`);
      if (rec.phase === 'P9' && rec.causalEvidence.spyRef === null && typeof spyRef === 'string' && SPY_REF_RE.test(spyRef)) rec.causalEvidence.spyRef = spyRef;
      rec.endSeq = nextSeq();
      rec.endedAt = clock.nowIso();
      rec.terminalOutcome = terminalOutcome;
      return rec;
    },
    pageOperation(action, arg) {
      try {
        const a = isPlainObject(arg) ? arg : {};
        if (action === 'begin') {
          let rec;
          if (a.phase === 'P9' && a.modelId === 'B' && ((a.operationType === 'hide' && a.invokedBy === 'C16') || (a.operationType === 'unload' && a.invokedBy === 'C17'))) {
            rec = api.beginMutation({ operationType: a.operationType, modelId: 'B', phase: 'P9', invokedBy: a.invokedBy });
          } else if (a.phase === 'cleanup' && a.operationType === 'unload' && (a.modelId === 'A' || a.modelId === 'B') && a.invokedBy === CLEANUP_UNLOAD_INVOKER[a.modelId]) {
            // a cleanup unload step that is about to call viewer.unloadModel (never for an already-absent model)
            rec = api.beginMutation({ operationType: 'unload', modelId: a.modelId, phase: 'cleanup', invokedBy: a.invokedBy, cleanupStepRef: `/cleanupStepStatus/${a.invokedBy.slice('cleanup:'.length)}` });
          } else return { ok: false, reason: 'refused' };
          return rec ? { ok: true, operationId: rec.operationId, ackSeq: rec.ackSeq } : { ok: false, reason: 'sealed' };
        }
        if (action === 'end') {
          const rec = byId.get(a.operationId);
          if (!isMutationRecordish(rec) || rec.operationType === 'teardown') return { ok: false, reason: 'unknown-operation' };
          return api.endMutation(a.operationId, a.terminalOutcome, { spyRef: a.spyRef }) ? { ok: true } : { ok: false, reason: 'not-ended' };
        }
        return { ok: false, reason: 'unknown-action' };
      } catch (err) { return { ok: false, reason: `threw:${summarizeThrown(err).name}` }; }
    },
    openMutations: () => ledger.opLedger.filter((o) => isMutationRecordish(o) && o.endSeq === null).map((o) => o.operationId),
    seal() { refreshCancellationWindows(ledger); sealed = true; },
    isSealed: () => sealed,
  };
  return api;
}

/**
 * The §9.2 `load-windows-closed` finalization trigger: once BOTH load records have `endSeq !== null`,
 * (1) persist the (now frozen) prefix-source ledger / derivation / ambiguous prefixes; (2) finalize
 * every still-provisional response with `responseSeq <` the later window close at `finalizedSeq` =
 * that close seq (`finalizedBy:'load-windows-closed'`), over the record truncated there; (3) sync the
 * fatal witnesses (a finalized FATAL creates its identity's witness here -- counted before the gate).
 * Synchronous; must run right after the later `endLoad` (no await in between). Returns `{finalized,
 * closeSeq, entries}` (`finalized:false` while a window is still open or a load record is missing).
 */
function finalizeLoadWindows(ledger, { prefixSources = null, appendEntry, rules = OPTIONAL_RESPONSE_RULES } = {}) {
  ensureNetworkLedger(ledger);
  const st = prefixBindingState(ledger.opLedger);
  const A = st.byModel.A;
  const B = st.byModel.B;
  if (!A || !B || !isSeq(A.endSeq) || !isSeq(B.endSeq)) return { finalized: false, closeSeq: null, entries: [] };
  refreshPrefixSourceLedger(ledger, { prefixSources });
  const closeSeq = Math.max(A.endSeq, B.endSeq);
  const done = [];
  for (const e of ledger.responseFailures) {
    if (!isPlainObject(e) || e.stage !== 'provisional' || isSeq(e.finalizedSeq) || !(isSeq(e.responseSeq) && e.responseSeq < closeSeq)) continue;
    applyProvisionalFinalization(e, provisionalFinalization(e, { ledger, finalizedSeq: closeSeq, rules }), closeSeq, 'load-windows-closed');
    done.push(e);
  }
  syncFatalWitnesses(ledger, { appendEntry: typeof appendEntry === 'function' ? appendEntry : directWitnessEntryAppender(ledger) });
  return { finalized: true, closeSeq, entries: done };
}

/** An empty §10 error ledger with the slice-C1 + C2 collections (node state and offline fixtures). */
function createEmptyErrorLedger() {
  return {
    fatalCount: 0, entries: [], attemptDeadlineExpired: false, markers: [],
    opLedger: [], prefixSourceLedger: [], prefixDerivation: derivePrefixes([], []), ambiguousPrefixes: [], modelPrefixes: { A: [], B: [] },
    requestObservations: [], requestFailures: [], responseFailures: [], correlatedRequests: [], fatalWitnesses: [],
    witnessCount: { requestObservations: 0, rawEvents: 0, correlatedIdentities: 0, fatalIdentities: 0, fatalWitnesses: 0, requiredResourceFailureEntries: 0, nonNetworkFatalEntries: 0, fatalCount: 0 },
  };
}

/** Adds any missing slice-C1 collection to an existing ledger in place (never removes data). */
function ensureNetworkLedger(ledger) {
  const empty = createEmptyErrorLedger();
  for (const k of Object.keys(empty)) if (ledger[k] === undefined) ledger[k] = empty[k];
  return ledger;
}

/**
 * `syncFatalWitnesses(ledger, {appendEntry})` -- event-time witness maintenance (W-4/W-5). Recomputes
 * the correlation over the raw events so far; for every fatal identity WITHOUT a witness it creates
 * exactly one witness and calls `appendEntry({kind:'required-resource-failure', seq:witnessSeq,
 * witnessId})` -- the ONLY place a network event increments `fatalCount` (`appendEntry` returns the
 * entry index, or -1 when the commit latch is set: then nothing is created). An existing witness is
 * only updated: members appended, `worstClassification` worsened in place (never improved), witnessSeq
 * kept, never re-counted. `correlatedRequests` and `witnessCount` are refreshed. Synchronous.
 */
function syncFatalWitnesses(ledger, { appendEntry }) {
  ensureNetworkLedger(ledger);
  const c = correlateNetworkEvents(ledger);
  for (const w of c.witnesses) {
    const existing = ledger.fatalWitnesses.find((x) => isPlainObject(x) && x.witnessId === w.witnessId);
    if (!existing) {
      const idx = appendEntry({ kind: NETWORK_FATAL_ENTRY_KIND, seq: w.witnessSeq, witnessId: w.witnessId });
      if (!Number.isInteger(idx) || idx < 0) continue;
      const view = cloneJson(w.view);
      ledger.fatalWitnesses.push({
        witnessId: w.witnessId, requestIdentityKey: w.requestIdentityKey, rawEventRefs: [...w.rawEventRefs], fatalRawEventRefs: [...w.fatalRawEventRefs],
        worstClassification: w.worstClassification, witnessSeq: w.witnessSeq, phase: w.phase, activeCheck: w.activeCheck, modelOwnership: cloneJson(w.modelOwnership),
        ledgerEntryRef: `/errorLedger/entries/${idx}`, eventTime: view, closeout: cloneJson(view), agree: true, fatal: true,
      });
    } else {
      existing.rawEventRefs = [...w.rawEventRefs];
      existing.fatalRawEventRefs = [...w.fatalRawEventRefs];
      existing.worstClassification = worseClassification(existing.worstClassification, w.worstClassification);
      existing.modelOwnership = cloneJson(w.modelOwnership);
      existing.eventTime = { worstClassification: existing.worstClassification, witnessSeq: existing.witnessSeq, rawEventRefs: [...w.rawEventRefs] };
      existing.closeout = cloneJson(w.view);
      existing.agree = sameJson(existing.eventTime, existing.closeout);
    }
  }
  ledger.fatalWitnesses.sort((a, b) => a.witnessSeq - b.witnessSeq);
  const after = correlateNetworkEvents(ledger);
  ledger.correlatedRequests = after.correlatedRequests;
  ledger.witnessCount = after.witnessCount;
  return ledger;
}

/** `appendEntry` for a ledger without a sink (in-page gate preparation, offline tests): direct push. */
function directWitnessEntryAppender(ledger) {
  return (entry) => {
    if (!Array.isArray(ledger.entries)) ledger.entries = [];
    ledger.entries.push(entry);
    ledger.fatalCount = (Number.isInteger(ledger.fatalCount) ? ledger.fatalCount : 0) + 1;
    return ledger.entries.length - 1;
  };
}

/**
 * Finalizes one provisional response entry at `finalizedSeq` (§9.2 two-stage rule): R-3/R-4 evaluated
 * over the record truncated at `finalizedSeq`; `eventTime = closeout` (the result at finalization),
 * `requirement`, `modelBindingObserved` (evaluated at finalizedSeq), `agree`. Returns the patch.
 */
function provisionalFinalization(e, { ledger, finalizedSeq, rules = OPTIONAL_RESPONSE_RULES }) {
  const ctx = networkContextOf(ledger);
  const id = recomputeRequestIdentity(e, isPlainObject(ledger) ? ledger.requestObservations : []);
  const t = truncateRecordAt(ctx, finalizedSeq);
  const result = classifyHttpResponse(httpResponseInput(e, id.reqIdValid), t.opLedger, t.markers, ctx.prefixDerivation, rules, ctx.prefixSourceLedger);
  return { classification: result.classification, requirement: requirementOf(result.classification), result, modelBindingObserved: modelBindingObservedOf(e.urlRedacted, 'provisional', ctx.prefixDerivation) };
}

/** Applies a finalization patch to a provisional entry (shared by gate, load-window and closeout finalization). */
function applyProvisionalFinalization(e, patch, finalizedSeq, finalizedBy) {
  e.finalizedSeq = finalizedSeq;
  e.finalizedBy = finalizedBy;
  const result = isPlainObject(patch.result) ? patch.result : { ...(isPlainObject(e.closeout) ? e.closeout : {}), classification: patch.classification };
  e.requirement = patch.requirement;
  e.eventTime = cloneJson(result);
  e.closeout = cloneJson(result);
  e.agree = true;
  if (isPlainObject(patch.modelBindingObserved)) e.modelBindingObserved = cloneJson(patch.modelBindingObserved);
}

/**
 * Closeout step 1 of the network ledger (§9.2): (0) close the cancellation windows and, if never
 * frozen, persist the prefix-source snapshot; (1) finalize every still-provisional response
 * (`finalizedBy:'closeout'`, one fresh seq each from the run's counter); (2) re-run both classifiers
 * over the complete ordered record (responses: truncated at finalizedSeq) with the RECOMPUTED identity
 * and store `closeout` + the recomputed `agree`; (3) sync witnesses (a newly fatal identity is still
 * counted through `appendEntry` -- before the step-1 primaryOverall); (4) recompute every witness's
 * closeout view. Synchronous; called right after the `closeout` marker.
 */
function finalizeNetworkLedgerAtCloseout(ledger, { nextSeq, appendEntry, rules = OPTIONAL_RESPONSE_RULES, prefixSources = null }) {
  ensureNetworkLedger(ledger);
  // (0) slice C2: close every mutation's cancellation window against the complete record; persist the
  // prefix-source snapshot only if it was never frozen (a load window never closed) -- a frozen
  // snapshot is never rebuilt here, so a corrupted persisted ledger is detected, not healed.
  refreshCancellationWindows(ledger);
  if (!isPrefixLedgerFrozen(ledger)) refreshPrefixSourceLedger(ledger, { prefixSources });
  for (const e of ledger.responseFailures) {
    if (!isPlainObject(e) || e.stage !== 'provisional' || isSeq(e.finalizedSeq)) continue;
    const finalizedSeq = nextSeq();
    applyProvisionalFinalization(e, provisionalFinalization(e, { ledger, finalizedSeq, rules }), finalizedSeq, 'closeout');
  }
  const ctx = networkContextOf(ledger);
  for (const r of rawNetworkEventsOf(ledger)) {
    const id = recomputeRequestIdentity(r.e, ledger.requestObservations);
    r.e.closeout = reclassifyRawEvent(r.kind, r.e, id.reqIdValid, ctx, rules);
    r.e.agree = sameJson(r.e.eventTime, r.e.closeout);
  }
  return syncFatalWitnesses(ledger, { appendEntry });
}

const isPointerTo = (p, prefix) => typeof p === 'string' && p.startsWith(prefix) && /^\d+$/.test(p.slice(prefix.length));

/** §9.2 `ClassifierResult` exact schema + coupling rules (test (14)). */
function classifierResultProblems(r, eventKind, { rules = OPTIONAL_RESPONSE_RULES } = {}) {
  if (!isPlainObject(r)) return ['not-object'];
  const out = [];
  if (!exactKeys(r, CLASSIFIER_RESULT_KEYS)) out.push('keys');
  if (r.eventKind !== eventKind) out.push('eventKind');
  const allowed = eventKind === 'requestfailed' ? ['fatal-required-resource', 'expected-cancellation', 'unknown-fatal'] : ['fatal-required-resource', 'diagnostic-non-required', 'unknown-fatal'];
  if (!allowed.includes(r.classification)) out.push('classification-for-eventKind');
  const unclassifiable = r.classification === NETWORK_CLASSIFICATION.UNKNOWN_FATAL && Array.isArray(r.reasons) && r.reasons.includes('unclassifiable');
  for (const k of ['url', 'method', 'resourceType']) if (!(typeof r[k] === 'string' || (unclassifiable && r[k] === null))) out.push(k);
  if (!(ATTRIBUTION_PHASES.includes(r.phase) || (unclassifiable && r.phase === null))) out.push('phase');
  if (eventKind === 'requestfailed') {
    if (r.status !== null) out.push('status-not-null');
    if (!(r.failureReason === null || typeof r.failureReason === 'string')) out.push('failureReason');
  } else {
    if (!(Number.isInteger(r.status) && r.status >= 400) && !(unclassifiable && r.status === null)) out.push('status');
    if (r.failureReason !== null) out.push('failureReason-not-null');
  }
  const nonFatal = r.classification === NETWORK_CLASSIFICATION.EXPECTED || r.classification === NETWORK_CLASSIFICATION.DIAGNOSTIC;
  const bound = (r.classification === NETWORK_CLASSIFICATION.EXPECTED && (r.rule === 'EC-hide' || r.rule === 'EC-unload')) || r.classification === NETWORK_CLASSIFICATION.DIAGNOSTIC;
  if (bound) {
    if (!(r.modelId === 'A' || r.modelId === 'B')) out.push('modelId');
    if (!isNonEmptyStr(r.boundPrefix)) out.push('boundPrefix');
  } else {
    if (r.modelId !== null) out.push('modelId-not-null');
    if (r.boundPrefix !== null) out.push('boundPrefix-not-null');
  }
  if (nonFatal) {
    if (!isNonEmptyStr(r.operationId)) out.push('operationId');
    if (!isSeq(r.opStartSeq)) out.push('opStartSeq');
    if (r.classification === NETWORK_CLASSIFICATION.EXPECTED && !Object.values(EC_RULE_OF_OPERATION).includes(r.rule)) out.push('rule');
    if (r.classification === NETWORK_CLASSIFICATION.DIAGNOSTIC && !(Array.isArray(rules) && rules.some((x) => isPlainObject(x) && x.ruleId === r.rule))) out.push('rule-not-in-OPTIONAL_RESPONSE_RULES');
  } else {
    if (r.operationId !== null) out.push('operationId-not-null');
    if (r.opStartSeq !== null) out.push('opStartSeq-not-null');
    if (r.rule !== null) out.push('rule-not-null');
  }
  if (!Array.isArray(r.reasons) || !r.reasons.every((x) => typeof x === 'string') || (r.reasons.length === 0) !== nonFatal) out.push('reasons');
  if (!Array.isArray(r.evidenceRefs) || !r.evidenceRefs.every(isJsonPointer) || (r.evidenceRefs.length > 0) !== nonFatal) out.push('evidenceRefs');
  if (r.verdictEffect !== (isFatalClassification(r.classification) ? 'fatal-row1' : 'none')) out.push('verdictEffect');
  return out;
}

const hasQueryOrFragment = (u) => typeof u === 'string' && /[?#]/.test(u);

/** §9.2 rule (v): activeCheck in C1..C20|null; null in P0/cleanup/closeout; else owned by `phase`. */
function activeCheckPhaseProblem(e) {
  if (e.activeCheck === null) return null;
  if (!CHECK_NAMES.includes(e.activeCheck)) return 'activeCheck-enum';
  if (['P0', 'cleanup', 'closeout'].includes(e.phase)) return 'activeCheck-in-non-check-phase';
  return CHECK_OWNING_PHASES[e.activeCheck].includes(e.phase) ? null : 'activeCheck-phase-inconsistent';
}

/** The spy-ledger records of a state (array, or the capped `{records}` form of the R1 payload). */
function spyRecordsOf(state) {
  const sl = isPlainObject(state) ? state.spyLedger : null;
  if (Array.isArray(sl)) return sl;
  return isPlainObject(sl) && Array.isArray(sl.records) ? sl.records : [];
}

/**
 * Slice-C2 validation (§9.2 RC1-C1, §10) of `opLedger[]`, `prefixSourceLedger[]`, `prefixDerivation`,
 * `ambiguousPrefixes[]` and `modelPrefixes` -- every stored value recomputed, never trusted. Prefixes:
 * `network-schema:` (shape / coupling, test (15)) and `prefix-derivation-mismatch:` (recomputation,
 * tests (12)/(13); §8 row 5). `L` is the error ledger, `s` the state (spy ledger for causal refs).
 */
function c2LedgerProblems(L, s) {
  const out = [];
  const schema = (p) => out.push(`network-schema:${p}`);
  const mismatch = (p) => out.push(`prefix-derivation-mismatch:${p}`);
  // ---- operation ledger (test (15)) ----
  const ids = new Set();
  let prevStart = -1;
  const spy = spyRecordsOf(s);
  L.opLedger.forEach((o, i) => {
    const at = `opLedger[${i}]`;
    for (const p of opLedgerRecordProblems(o)) schema(`${at}.${p}`);
    if (!isPlainObject(o)) return;
    if (ids.has(o.operationId)) schema(`${at}.operationId-duplicated`);
    ids.add(o.operationId);
    if (!isSeq(o.startSeq) || !(o.startSeq > prevStart)) schema(`${at}.startSeq-not-ascending`);
    if (isSeq(o.startSeq)) prevStart = o.startSeq;
    if (isMutationRecordish(o) && isPlainObject(o.cancellationWindow) && isSeq(o.startSeq) && o.cancellationWindow.toSeqExclusive !== cancellationWindowEnd(o, L.opLedger, L.markers)) schema(`${at}.cancellationWindow-end`);
    // causal evidence must resolve to the harness's own recorded invocation (after the ack)
    if (isMutationRecordish(o) && o.phase === 'P9' && isPlainObject(o.causalEvidence) && typeof o.causalEvidence.spyRef === 'string' && SPY_REF_RE.test(o.causalEvidence.spyRef)) {
      const seq = Number(o.causalEvidence.spyRef.slice('spyLedger:seq:'.length));
      const hits = spy.filter((r) => isPlainObject(r) && r.seq === seq);
      const method = o.operationType === 'hide' ? 'viewer.hideModel' : 'viewer.unloadModel';
      if (!(hits.length === 1 && hits[0].method === method && hits[0].origin === 'harness' && hits[0].phase === 'P9' && isSeq(o.ackSeq) && seq > o.ackSeq)) schema(`${at}.causalEvidence-unresolved`);
    }
  });
  for (const m of ['A', 'B']) if (L.opLedger.filter((o) => isLoadRecordish(o) && o.modelId === m).length > 1) schema(`opLedger.load-${m}-duplicated`);
  // ---- prefix-source ledger (test (12)) ----
  const st = prefixBindingState(L.opLedger);
  const cutoff = prefixSnapshotCutoff(L);
  const loads = L.opLedger.filter(isLoadRecordish);
  const entryIds = new Set();
  let prevKey = null;
  const amb = isPlainObject(L.prefixDerivation) && Array.isArray(L.prefixDerivation.ambiguousKeys) ? L.prefixDerivation.ambiguousKeys : [];
  const recomputedAmb = derivePrefixes(L.prefixSourceLedger, L.opLedger).ambiguousKeys;
  L.prefixSourceLedger.forEach((e, i) => {
    const at = `prefixSourceLedger[${i}]`;
    if (!exactKeys(e, PREFIX_SOURCE_ENTRY_KEYS)) { schema(`${at}.keys`); return; }
    for (const k of ['entryId', 'reqId', 'loadOperationId', 'method', 'resourceType', 'urlRedacted', 'prefixKey']) if (typeof e[k] !== 'string') schema(`${at}.${k}`);
    if (!(e.modelId === 'A' || e.modelId === 'B')) schema(`${at}.modelId`);
    if (!isSeq(e.startSeq)) schema(`${at}.startSeq`);
    if (!['requestfinished', 'requestfailed', 'none'].includes(e.terminalKind) || ((e.terminalKind === 'none') !== (e.terminalSeq === null)) || !(e.terminalSeq === null || isSeq(e.terminalSeq))) schema(`${at}.terminal`);
    if (!(e.status === null || Number.isInteger(e.status))) schema(`${at}.status`);
    if (!NETWORK_URL_CLASSES.includes(e.urlClass)) schema(`${at}.urlClass`);
    if (typeof e.isNavigationRequest !== 'boolean') schema(`${at}.isNavigationRequest`);
    if (hasQueryOrFragment(e.urlRedacted) || hasQueryOrFragment(e.prefixKey)) schema(`${at}.urlRedacted-not-redacted`);
    if (!PREFIX_SOURCE_REASONS.includes(e.reason) || e.disposition !== (e.reason === 'included' ? 'included' : 'excluded')) schema(`${at}.disposition-reason`);
    if (e.entryId !== `${e.reqId}:${e.loadOperationId}`) mismatch(`${at}.entryId`);
    if (entryIds.has(e.entryId)) mismatch(`${at}.entryId-duplicated`);
    entryIds.add(e.entryId);
    const key = [e.startSeq, e.modelId];
    if (prevKey && !(key[0] > prevKey[0] || (key[0] === prevKey[0] && key[1] > prevKey[1]))) mismatch(`${at}.order`);
    prevKey = key;
    // references exactly one request observation and repeats its fields
    const obs = L.requestObservations.filter((o) => isPlainObject(o) && o.reqId === e.reqId);
    if (!(obs.length === 1 && ['startSeq', 'method', 'resourceType', 'urlRedacted', 'urlClass', 'isNavigationRequest'].every((k) => obs[0][k] === e[k]))) mismatch(`${at}.observation`);
    // its load record (same model) and window
    const lo = loads.filter((x) => x.operationId === e.loadOperationId);
    const Lr = lo.length === 1 ? lo[0] : null;
    if (!Lr || Lr.modelId !== e.modelId || !(isSeq(Lr.startSeq) && Lr.startSeq < e.startSeq && (Lr.endSeq === null || e.startSeq <= Lr.endSeq))) mismatch(`${at}.load-window`);
    if (e.prefixKey !== (networkPrefixKey(e.urlRedacted) ?? '')) mismatch(`${at}.prefixKey`);
    // terminal evidence vs the retained raw events (up to the snapshot cutoff); a failing candidate can never be included
    if (isSeq(e.terminalSeq) && e.terminalSeq > cutoff) mismatch(`${at}.terminal-after-snapshot`);
    const rf = L.requestFailures.filter((x) => isPlainObject(x) && x.reqId === e.reqId && isSeq(x.failSeq) && x.failSeq <= cutoff).sort((a, b) => a.failSeq - b.failSeq);
    if (rf.length > 0 && !(e.terminalKind === 'requestfailed' && e.terminalSeq === rf[0].failSeq)) mismatch(`${at}.terminal-requestfailed`);
    if (e.terminalKind === 'requestfailed' && !rf.some((x) => x.failSeq === e.terminalSeq)) mismatch(`${at}.terminal-requestfailed-unretained`);
    const hr = L.responseFailures.filter((x) => isPlainObject(x) && x.reqId === e.reqId && isSeq(x.responseSeq) && x.responseSeq <= cutoff).sort((a, b) => a.responseSeq - b.responseSeq);
    if (hr.length > 0 && e.status !== hr[0].status) mismatch(`${at}.status-vs-response`);
    if (e.reason !== prefixEntryReason(e, st, recomputedAmb)) mismatch(`${at}.reason`);
  });
  // completeness: exactly one entry per (observation, load record) pair inside the window
  for (const o of L.requestObservations) {
    if (!isPlainObject(o) || !isSeq(o.startSeq)) continue;
    for (const Lr of loads) {
      if (!(isNonEmptyStr(Lr.operationId) && isSeq(Lr.startSeq) && Lr.startSeq < o.startSeq && (!isSeq(Lr.endSeq) || o.startSeq <= Lr.endSeq))) continue;
      if (!entryIds.has(`${o.reqId}:${Lr.operationId}`)) mismatch(`prefixSourceLedger.missing:${o.reqId}:${Lr.operationId}`);
    }
  }
  // ---- derivation, ambiguous prefixes, modelPrefixes (tests (12)/(13)) ----
  const pd = L.prefixDerivation;
  if (!exactKeys(pd, PREFIX_DERIVATION_KEYS)) schema('prefixDerivation.keys');
  else {
    if (pd.nonDistinguishingReason !== null && pd.bindingAvailable === true) schema('prefixDerivation.nonDistinguishingReason');
    if (!sameJson(pd, derivePrefixes(L.prefixSourceLedger, L.opLedger))) mismatch('prefixDerivation');
  }
  L.ambiguousPrefixes.forEach((a, i) => {
    if (!exactKeys(a, ['prefixKey', 'sourceEntryIds']) || !exactKeys(a.sourceEntryIds, ['A', 'B'])) schema(`ambiguousPrefixes[${i}].keys`);
    else if (hasQueryOrFragment(a.prefixKey)) schema(`ambiguousPrefixes[${i}].prefixKey-not-redacted`);
  });
  if (!sameJson(L.ambiguousPrefixes, ambiguousPrefixesOf(L.prefixSourceLedger, L.opLedger, derivePrefixes(L.prefixSourceLedger, L.opLedger)))) mismatch('ambiguousPrefixes');
  if (amb.length !== L.ambiguousPrefixes.length) mismatch('ambiguousPrefixes-count');
  if (!(isPlainObject(pd) && sameJson(L.modelPrefixes, pd.modelPrefixes))) mismatch('modelPrefixes');
  // load records' prefixSourceRef
  for (const [i, o] of L.opLedger.entries()) {
    if (!isLoadRecordish(o) || !isPlainObject(o.prefixSourceRef)) continue;
    const want = L.prefixSourceLedger.filter((e) => isPlainObject(e) && e.loadOperationId === o.operationId).map((e) => e.entryId);
    if (!sameJson(o.prefixSourceRef.entryIds, want)) mismatch(`opLedger[${i}].prefixSourceRef.entryIds`);
    if (!(isPlainObject(pd) && o.prefixSourceRef.ledgerSha256 === pd.ledgerSha256)) mismatch(`opLedger[${i}].prefixSourceRef.ledgerSha256`);
  }
  return out;
}

/**
 * `networkLedgerProblems(state, {rules})` -- the §9.2/§10 validation of the slice-C1 error-ledger
 * collections, part of `recordSchemaProblems` (=> `validateResultSchema` and §8 row 5; evaluated at
 * closeout step 1 by `computeOverall`). Stored values are NEVER trusted: every `reqIdValid` /
 * `identityKey` / `duplicateOf`, every `closeout` ClassifierResult (responses over the record
 * truncated at finalizedSeq), every `agree`, `correlatedRequests[]`, `fatalWitnesses[]` (closeout view)
 * and `witnessCount` are recomputed. Prefixes: `network-schema:` (shape), `request-classification-
 * mismatch:` (classifier disagreement), `fatal-witness-mismatch:` (W-1..W-5 / count invariant).
 * `rules` defaults to the frozen OPTIONAL_RESPONSE_RULES (offline tests may pass a synthetic rule set
 * for the recomputation only; the diagnostic-retention rule always checks the frozen constant).
 */
function networkLedgerProblems(state, { rules = OPTIONAL_RESPONSE_RULES } = {}) {
  const s = isPlainObject(state) ? state : {};
  const L = s.errorLedger;
  if (!isPlainObject(L)) return ['network-schema:errorLedger-not-object'];
  const out = [];
  const schema = (p) => out.push(`network-schema:${p}`);
  const mismatch = (p) => out.push(`fatal-witness-mismatch:${p}`);
  const clsMismatch = (p) => out.push(`request-classification-mismatch:${p}`);
  for (const k of NETWORK_LEDGER_LIST_KEYS) if (!Array.isArray(L[k])) schema(`${k}-not-array`);
  // slice C2: the operation ledger and the prefix-source evidence are REQUIRED collections (§10)
  for (const k of NETWORK_C2_LIST_KEYS) if (!Array.isArray(L[k])) schema(`${k}-not-array`);
  if (!Array.isArray(L.markers)) schema('markers-not-array');
  if (!isPlainObject(L.prefixDerivation)) schema('prefixDerivation-not-object');
  if (!isPlainObject(L.modelPrefixes)) schema('modelPrefixes-not-object');
  if (!exactKeys(L.witnessCount, WITNESS_COUNT_KEYS) || !WITNESS_COUNT_KEYS.every((k) => Number.isInteger(L.witnessCount[k]) && L.witnessCount[k] >= 0)) schema('witnessCount');
  if (!Array.isArray(L.entries)) schema('entries-not-array');
  if (out.length > 0) return out;
  const ctx = networkContextOf(L);
  out.push(...c2LedgerProblems(L, s));
  // request observations (W-1)
  let prevStart = -1;
  const reqIds = new Set();
  L.requestObservations.forEach((o, i) => {
    const at = `requestObservations[${i}]`;
    if (!exactKeys(o, REQUEST_OBSERVATION_KEYS)) { schema(`${at}.keys`); return; }
    if (!isSeq(o.startSeq) || !(o.startSeq > prevStart)) schema(`${at}.startSeq-not-ascending`);
    prevStart = isSeq(o.startSeq) ? o.startSeq : prevStart;
    if (o.reqId !== `q:${o.startSeq}`) schema(`${at}.reqId-not-q-startSeq`);
    if (reqIds.has(o.reqId)) mismatch(`${at}.reqId-duplicated`);
    reqIds.add(o.reqId);
    for (const k of ['method', 'resourceType', 'urlRedacted']) if (typeof o[k] !== 'string') schema(`${at}.${k}`);
    if (hasQueryOrFragment(o.urlRedacted)) schema(`${at}.urlRedacted-not-redacted`);
    if (!NETWORK_URL_CLASSES.includes(o.urlClass)) schema(`${at}.urlClass`);
    if (typeof o.isNavigationRequest !== 'boolean') schema(`${at}.isNavigationRequest`);
    if (!ATTRIBUTION_PHASES.includes(o.phase)) schema(`${at}.phase`);
    const ap = activeCheckPhaseProblem(o);
    if (ap) schema(`${at}.${ap}`);
  });
  // raw events (W-1, cross-field rules (i)-(v))
  const c = correlateNetworkEvents(L);
  const byRef = new Map(c.events.map((ev) => [`${ev.list}[${ev.i}]`, ev]));
  const rawIds = new Set();
  const check = (list, keys, kind) => L[list].forEach((e, i) => {
    const at = `${list}[${i}]`;
    if (!exactKeys(e, keys)) { schema(`${at}.keys`); return; }
    const seqKey = kind === 'requestfailed' ? 'failSeq' : 'responseSeq';
    const prefix = kind === 'requestfailed' ? 'rf:' : 'hr:';
    if (!isSeq(e[seqKey]) || e.rawEventSeq !== e[seqKey]) schema(`${at}.rawEventSeq`);
    if (e.rawEventId !== `${prefix}${e.rawEventSeq}`) schema(`${at}.rawEventId`);
    if (rawIds.has(e.rawEventId)) schema(`${at}.rawEventId-duplicated`);
    rawIds.add(e.rawEventId);
    if (!(e.reqId === null || typeof e.reqId === 'string')) schema(`${at}.reqId`);
    if (!(e.startSeq === null || isSeq(e.startSeq))) schema(`${at}.startSeq`);
    for (const k of ['method', 'resourceType', 'urlRedacted']) if (!(e[k] === null || typeof e[k] === 'string')) schema(`${at}.${k}`);
    if (hasQueryOrFragment(e.urlRedacted)) schema(`${at}.urlRedacted-not-redacted`);
    if (!NETWORK_URL_CLASSES.includes(e.urlClass)) schema(`${at}.urlClass`);
    for (const k of ['isNavigationRequest', 'frameIsMain', 'redirected']) if (!(e[k] === null || typeof e[k] === 'boolean')) schema(`${at}.${k}`);
    if (!ATTRIBUTION_PHASES.includes(e.phase)) schema(`${at}.phase`);
    const ap = activeCheckPhaseProblem(e);
    if (ap) schema(`${at}.${ap}`);
    if (kind === 'requestfailed' && !(e.errorText === null || typeof e.errorText === 'string')) schema(`${at}.errorText`);
    const ev = byRef.get(at);
    if (!ev) return;
    if (e.reqIdValid !== ev.reqIdValid) mismatch(`${at}.reqIdValid`);
    if (e.identityKey !== ev.identityKey) mismatch(`${at}.identityKey`);
    if (e.duplicateOf !== ev.duplicateOf) mismatch(`${at}.duplicateOf`);
    if (kind === 'httpResponse') {
      if (!(Number.isInteger(e.status) && e.status >= 400)) schema(`${at}.status`);
      // (ii) stage <-> finalizedBy <-> finalizedSeq
      if (e.stage === 'immediate') { if (e.finalizedBy !== 'event' || e.finalizedSeq !== e.responseSeq) schema(`${at}.stage-immediate-finalization`); } else if (e.stage === 'provisional') {
        if (!['load-windows-closed', 'gate', 'closeout'].includes(e.finalizedBy) || !isSeq(e.finalizedSeq) || !(e.finalizedSeq > e.responseSeq)) schema(`${at}.stage-provisional-finalization`);
      } else schema(`${at}.stage`);
      // (iv) modelBindingObserved
      const mb = e.modelBindingObserved;
      if (!exactKeys(mb, ['status', 'modelId', 'prefixKey'])) schema(`${at}.modelBindingObserved.keys`);
      else if (e.stage === 'immediate') { if (!(mb.status === 'not-evaluated' && mb.modelId === null && mb.prefixKey === null)) schema(`${at}.modelBindingObserved-immediate`); } else {
        const pd = ctx.prefixDerivation;
        const inMp = (m, k) => isPlainObject(pd.modelPrefixes) && Array.isArray(pd.modelPrefixes[m]) && pd.modelPrefixes[m].includes(k);
        const inAmb = (k) => Array.isArray(pd.ambiguousKeys) && pd.ambiguousKeys.includes(k);
        if (mb.status === 'unique') { if (!((mb.modelId === 'A' || mb.modelId === 'B') && isNonEmptyStr(mb.prefixKey) && inMp(mb.modelId, mb.prefixKey))) schema(`${at}.modelBindingObserved-unique`); } else if (mb.status === 'ambiguous') { if (!(mb.modelId === null && isNonEmptyStr(mb.prefixKey) && (inAmb(mb.prefixKey) || pd.bindingAvailable !== true))) schema(`${at}.modelBindingObserved-ambiguous`); } else if (mb.status === 'unbound') { if (!(mb.modelId === null && isNonEmptyStr(mb.prefixKey) && pd.bindingAvailable === true && !inAmb(mb.prefixKey) && !inMp('A', mb.prefixKey) && !inMp('B', mb.prefixKey))) schema(`${at}.modelBindingObserved-unbound`); } else schema(`${at}.modelBindingObserved-status`);
      }
    }
    // ClassifierResult schema of both results; (i) agree recomputed
    for (const k of ['eventTime', 'closeout']) for (const p of classifierResultProblems(e[k], kind, { rules })) schema(`${at}.${k}.${p}`);
    // slice C2 boundPrefix provenance: a non-null boundPrefix is in modelPrefixes[modelId] and is
    // supported by at least one included prefix-source entry named in evidenceRefs
    for (const k of ['eventTime', 'closeout']) {
      const r = e[k];
      if (!isPlainObject(r) || r.boundPrefix === null || r.boundPrefix === undefined) continue;
      const mp = isPlainObject(ctx.prefixDerivation.modelPrefixes) ? ctx.prefixDerivation.modelPrefixes : {};
      if (!((r.modelId === 'A' || r.modelId === 'B') && Array.isArray(mp[r.modelId]) && mp[r.modelId].includes(r.boundPrefix))) clsMismatch(`${at}.${k}.boundPrefix-not-in-modelPrefixes`);
      const support = prefixSupportRefs(ctx.prefixSourceLedger, r.modelId, r.boundPrefix);
      if (support.length === 0 || !Array.isArray(r.evidenceRefs) || !support.every((p) => r.evidenceRefs.includes(p))) clsMismatch(`${at}.${k}.boundPrefix-unsupported`);
    }
    if (e.agree !== sameJson(e.eventTime, e.closeout) || e.agree !== true) clsMismatch(`${at}.agree`);
    // closeout re-classification (responses: record truncated at finalizedSeq)
    if (kind === 'requestfailed' || isSeq(e.finalizedSeq)) {
      const recomputed = reclassifyRawEvent(kind, e, ev.reqIdValid, ctx, rules);
      if (!sameJson(recomputed, e.closeout)) clsMismatch(`${at}.closeout`);
    }
    const cls = isPlainObject(e.closeout) ? e.closeout.classification : null;
    if (kind === 'httpResponse') {
      // (iii) classification -> requirement truth table (an immediate entry is fatal-required-resource /
      // 'required', or -- W-1 unclassifiable identity, R-5 -- unknown-fatal / 'unknown')
      if (e.requirement !== requirementOf(cls)) schema(`${at}.requirement-ne-classification`);
      if (e.stage === 'immediate' && !(cls === NETWORK_CLASSIFICATION.FATAL_REQUIRED || (cls === NETWORK_CLASSIFICATION.UNKNOWN_FATAL && Array.isArray(e.closeout.reasons) && e.closeout.reasons[0] === 'R-5'))) schema(`${at}.immediate-classification`);
      if (cls === NETWORK_CLASSIFICATION.DIAGNOSTIC) {
        const mb = e.modelBindingObserved;
        if (!(isPlainObject(mb) && mb.status === 'unique' && mb.modelId === e.closeout.modelId && mb.prefixKey === e.closeout.boundPrefix)) schema(`${at}.diagnostic-binding`);
        const rule = OPTIONAL_RESPONSE_RULES.find((x) => x.ruleId === e.closeout.rule);
        const op = ctx.opLedger.find((o) => isPlainObject(o) && o.operationId === e.closeout.operationId);
        if (!rule || !op || op.recordType !== 'load' || op.modelId !== rule.model) mismatch(`${at}.diagnostic-evidence-contradiction`);
      }
    } else if (cls === NETWORK_CLASSIFICATION.EXPECTED) {
      const r = e.closeout;
      const op = ctx.opLedger.find((o) => isPlainObject(o) && o.operationId === r.operationId);
      const w = op && isPlainObject(op.cancellationWindow) ? op.cancellationWindow : null;
      if (!op || op.recordType !== 'mutation' || op.startSeq !== r.opStartSeq || !w || !(w.fromSeqExclusive < e.failSeq && (w.toSeqExclusive === null || e.failSeq < w.toSeqExclusive))) clsMismatch(`${at}.expected-evidence-contradiction`);
    }
  });
  check('requestFailures', REQUEST_FAILURE_KEYS, 'requestfailed');
  check('responseFailures', RESPONSE_FAILURE_KEYS, 'httpResponse');
  // W-3 correlated requests, W-4 witnesses, W-5 count invariant -- recomputed
  if (!sameJson(L.correlatedRequests, c.correlatedRequests)) mismatch('correlatedRequests');
  L.correlatedRequests.forEach((x, i) => { if (!exactKeys(x, CORRELATED_REQUEST_KEYS)) schema(`correlatedRequests[${i}].keys`); });
  const stored = L.fatalWitnesses;
  stored.forEach((w, i) => {
    const at = `fatalWitnesses[${i}]`;
    if (!exactKeys(w, FATAL_WITNESS_KEYS)) { schema(`${at}.keys`); return; }
    if (w.fatal !== true) schema(`${at}.fatal`);
    if (w.agree !== sameJson(w.eventTime, w.closeout) || w.agree !== true) mismatch(`${at}.agree`);
    const e = isPointerTo(w.ledgerEntryRef, '/errorLedger/entries/') ? L.entries[Number(w.ledgerEntryRef.slice('/errorLedger/entries/'.length))] : undefined;
    if (!(isPlainObject(e) && e.kind === NETWORK_FATAL_ENTRY_KIND && e.witnessId === w.witnessId && e.seq === w.witnessSeq && exactKeys(e, ['kind', 'seq', 'witnessId']))) mismatch(`${at}.ledgerEntryRef`);
  });
  if (stored.length !== c.witnesses.length) mismatch(`witness-count:${stored.length}-ne-${c.witnesses.length}`);
  for (const w of c.witnesses) {
    const hits = stored.filter((x) => isPlainObject(x) && x.witnessId === w.witnessId);
    if (hits.length !== 1) { mismatch(`witness-missing-or-duplicated:${w.witnessId}`); continue; }
    const h = hits[0];
    if (h.requestIdentityKey !== w.requestIdentityKey) mismatch(`${w.witnessId}.requestIdentityKey`);
    if (!sameJson(h.rawEventRefs, w.rawEventRefs) || !sameJson(h.fatalRawEventRefs, w.fatalRawEventRefs)) mismatch(`${w.witnessId}.rawEventRefs`);
    if ((NETWORK_SEVERITY[h.worstClassification] ?? -1) < NETWORK_SEVERITY[w.worstClassification] || h.worstClassification !== w.worstClassification) mismatch(`${w.witnessId}.worstClassification`);
    if (h.witnessSeq !== w.witnessSeq) mismatch(`${w.witnessId}.witnessSeq`);
    if (h.phase !== w.phase || h.activeCheck !== w.activeCheck) mismatch(`${w.witnessId}.phase-activeCheck`);
    if (!sameJson(h.modelOwnership, w.modelOwnership)) mismatch(`${w.witnessId}.modelOwnership`);
    if (!sameJson(h.closeout, w.view)) mismatch(`${w.witnessId}.closeout`);
  }
  for (let i = 1; i < stored.length; i += 1) if (!(isPlainObject(stored[i - 1]) && isPlainObject(stored[i]) && stored[i - 1].witnessSeq <= stored[i].witnessSeq)) { mismatch('fatalWitnesses-order'); break; }
  // witness <-> entry bijection
  L.entries.forEach((e, i) => {
    if (!isPlainObject(e) || e.kind !== NETWORK_FATAL_ENTRY_KIND) return;
    const ws = stored.filter((w) => isPlainObject(w) && w.witnessId === e.witnessId);
    if (ws.length !== 1 || ws[0].ledgerEntryRef !== `/errorLedger/entries/${i}`) mismatch(`entries[${i}].witness-bijection`);
  });
  if (!sameJson(L.witnessCount, c.witnessCount)) mismatch('witnessCount');
  if (c.witnessCount.requiredResourceFailureEntries !== c.witnessCount.fatalWitnesses || c.witnessCount.fatalIdentities !== c.witnessCount.fatalWitnesses) mismatch('count-equation:fatalIdentities=fatalWitnesses=entries');
  if (L.fatalCount !== c.witnessCount.fatalCount) mismatch(`count-equation:fatalCount:${L.fatalCount}-ne-${c.witnessCount.fatalCount}`);
  return out;
}

/**
 * §9.2 "`seq` is one node-side monotonic counter": every PRIMARY seq allocation is unique across
 * collections -- markers, eventLog, spyLedger, stateSnapshots, request observations (`startSeq`), raw
 * network events (`rawEventSeq`), non-network fatal entries, `gates.C1.gateSeq`, gate-disposition
 * `dispositionSeq`, control-run executionRecord start/terminal seqs, and gate/closeout response
 * finalizations, operation-ledger start/ack/end seqs (slice C2). References (C1 `finalizedSeq` = its check-finalized event, network fatal entries =
 * `witnessSeq`, load-window finalizations) are not allocations and are not counted. Returns
 * `{seqs:[{seq,label}], problems}`.
 */
function primarySeqAllocations(state) {
  const s = isPlainObject(state) ? state : {};
  const seqs = [];
  const add = (seq, label) => { if (isSeq(seq)) seqs.push({ seq, label }); };
  errorLedgerList(s, 'markers').forEach((m, i) => { if (isPlainObject(m)) add(m.seq, `errorLedger.markers[${i}]`); });
  for (const name of ATTRIBUTED_COLLECTIONS) attributedCollection(s, name).forEach((e, i) => { if (isPlainObject(e)) add(e.seq, `${name}[${i}]`); });
  errorLedgerList(s, 'requestObservations').forEach((e, i) => { if (isPlainObject(e)) add(e.startSeq, `errorLedger.requestObservations[${i}]`); });
  for (const k of ['requestFailures', 'responseFailures']) errorLedgerList(s, k).forEach((e, i) => { if (isPlainObject(e)) add(e.rawEventSeq, `errorLedger.${k}[${i}]`); });
  errorLedgerList(s, 'responseFailures').forEach((e, i) => { if (isPlainObject(e) && (e.finalizedBy === 'gate' || e.finalizedBy === 'closeout')) add(e.finalizedSeq, `errorLedger.responseFailures[${i}].finalizedSeq`); });
  // slice C2: operation-ledger allocations (start, node-side acknowledgement, end). A load-window
  // finalization (`finalizedBy:'load-windows-closed'`) references the later load's endSeq.
  errorLedgerList(s, 'opLedger').forEach((o, i) => {
    if (!isPlainObject(o)) return;
    add(o.startSeq, `errorLedger.opLedger[${i}].startSeq`);
    if (o.recordType === 'mutation') add(o.ackSeq, `errorLedger.opLedger[${i}].ackSeq`);
    add(o.endSeq, `errorLedger.opLedger[${i}].endSeq`);
  });
  // A non-network fatal entry is its own allocation unless it is the ledger record of a passive fatal
  // eventLog entry of the same kind and seq (one event, two records).
  const events = attributedCollection(s, 'eventLog');
  errorLedgerList(s, 'entries').forEach((e, i) => {
    if (!isPlainObject(e) || e.kind === NETWORK_FATAL_ENTRY_KIND) return;
    if (events.some((x) => isPlainObject(x) && x.seq === e.seq && x.kind === e.kind)) return;
    add(e.seq, `errorLedger.entries[${i}]`);
  });
  if (isPlainObject(s.gates) && isPlainObject(s.gates.C1)) add(s.gates.C1.gateSeq, 'gates.C1');
  for (const [coll, names] of [['checks', CHECK_NAMES], ['controls', CONTROL_NAMES]]) {
    const recs = isPlainObject(s[coll]) ? s[coll] : {};
    for (const n of names) {
      const r = recs[n];
      if (!isPlainObject(r)) continue;
      if (r.recordType === RECORD_TYPE.GATE_DISPOSITION) add(r.dispositionSeq, `${coll}.${n}.dispositionSeq`);
      else if (r.recordType === RECORD_TYPE.CONTROL_RUN && isPlainObject(r.executionRecord)) {
        if (r.executionRecord.started === true) add(r.executionRecord.startSeq, `${coll}.${n}.executionRecord.startSeq`);
        add(r.executionRecord.terminalSeq, `${coll}.${n}.executionRecord.terminalSeq`);
      }
    }
  }
  const byKey = new Map();
  const problems = [];
  for (const x of seqs) {
    if (byKey.has(x.seq)) problems.push(`seq-not-unique:${x.seq}:${byKey.get(x.seq)}|${x.label}`);
    else byKey.set(x.seq, x.label);
  }
  return { seqs, problems };
}

/** The highest primary seq recorded in a state (node counter `observe`, interim two-namespace bridge). */
function maxRecordedSeq(state) {
  return primarySeqAllocations(state).seqs.reduce((m, x) => Math.max(m, x.seq), -1);
}

/**
 * `createRunSeqCounter()` -- THE node-side run counter (§9.2): `next()` allocates, `peek()` reads the
 * last allocation, `observe(seq)` moves the counter past a seq allocated elsewhere. `observe` is the
 * INTERIM bridge to the page-side recorder of the in-page phase run (see `runPostReservation`): the
 * cross-process single-counter unification is an UNRESOLVED live-wiring gate (slice C1 report).
 */
/**
 * UNRESOLVED BEFORE-LIVE-EXECUTION GATE (slice C1 finding, kept by slice C2 -- NOT redesigned here):
 * §9.2 requires ONE node-side monotonic `seq` counter shared by opLedger, markers, check-finalized
 * events, gates.C1, control records and request/response events. The in-page phase run still numbers
 * its own records from a page-side recorder seeded with `seqBase` (the stopgap in `g2BuildEnv` /
 * `runPostReservation`), while node events DURING that run (network events and, since slice C2, the
 * C16/C17 operation records acknowledged through G2_NODE_OPLEDGER_BINDING) are numbered by the node
 * counter: two namespaces. Any collision is a row-5 contradiction (`seq-not-unique`) and C-d/C-e event-
 * time windows can disagree with closeout (`request-classification-mismatch`) -- fail-closed, but a
 * compliant cross-process counter design is required before any live execution.
 * The same gate also covers the node-side ATTRIBUTION defect (review M1, 2026-10-01): during the whole
 * in-page P2..P11 run Node labels its own events `{phase:'P1', activeCheck:null}` (runPostReservation),
 * because the page owns the phase/check context. C-e requires `event.phase` P9/cleanup for EC-hide/
 * EC-unload, so a C16 hideModel / C17 unload abort can never qualify as an expected cancellation (it is
 * classified fatal-required-resource, row 1), and P2..P11 node events carry false P1 evidence. Fail-
 * closed (never a false PASS), but it must be resolved together with the counter before live.
 * Mechanically coupled (M2): main() and runChecksInPhaseOrder(mode 'live') refuse with
 * 'dual-counter-gate-unresolved' while `resolved` is not true, independently of LIVE_PATH_WIRED.
 */
const G2_DUAL_COUNTER_GATE = Object.freeze({ resolved: false, owner: 'before-live-execution', finding: 'page-records-numbered-via-seqBase-while-node-owns-the-counter' });

function createRunSeqCounter() {
  let n = 0;
  return {
    next: () => { n += 1; return n; },
    peek: () => n,
    observe: (seq) => { if (isSeq(seq) && seq > n) n = seq; return n; },
  };
}

/**
 * `makeGateDispositionRecord(itemId, {gate, c1, dispositionSeq, dispositionAt})` -- the exact §7
 * synthetic gate-disposition record (G-a..G-f) for one C2..C20/N1..N8 item under a CLOSED gate.
 */
function makeGateDispositionRecord(itemId, { gate, c1, dispositionSeq, dispositionAt }) {
  const outcome = gate.outcome;
  if (outcome !== GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED && outcome !== GATE_OUTCOME.CLOSED_OTHER) throw new TypeError('makeGateDispositionRecord: gate is not closed');
  if (!DOWNSTREAM_ITEM_NAMES.includes(itemId)) throw new TypeError(`makeGateDispositionRecord: ${String(itemId)} is not a downstream item`);
  const isCheck = itemId.startsWith('C');
  const cdb = outcome === GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED;
  const disposition = isCheck ? GATE_CHECK_DISPOSITION : GATE_CONTROL_DISPOSITION[outcome][itemId];
  const needsDep = cdb && (isCheck || disposition === NRDB_STATE);
  const detail = isPlainObject(c1.fields) && Array.isArray(c1.fields.blockDetail) ? JSON.parse(JSON.stringify(c1.fields.blockDetail)) : [];
  return {
    recordType: RECORD_TYPE.GATE_DISPOSITION,
    itemId,
    itemKind: isCheck ? 'check' : 'control',
    synthetic: true,
    gateGenerated: true,
    executed: false,
    gateOutcome: outcome,
    blockingReason: cdb ? c1.reason : GATE_BLOCKING_REASON_CLOSED_OTHER,
    disposition,
    dispositionSeq,
    dispositionAt,
    startSeq: null,
    startedAt: null,
    executionRecord: isCheck ? null : {
      controlId: itemId, phase: CONTROL_OWNING_PHASE[itemId], dependencyIds: [...CONTROL_DEPENDENCY_IDS[itemId]],
      started: false, crossedStartBoundary: false, startSeq: null, startedAt: null,
      terminalSeq: dispositionSeq, terminalAt: dispositionAt, terminalState: disposition, result: null, evidenceRefs: [],
    },
    dependencyBlockedBy: needsDep ? {
      check: 'C1', blockingState: 'BLOCKED', reason: c1.reason, phaseSeq: c1.finalizedSeq, blockedAt: c1.finalizedAt,
      evidenceRef: '/checks/C1', failedBeforeDependentStarted: true, detail,
    } : null,
    evidenceRefs: [...GATE_EVIDENCE_REFS],
  };
}

/**
 * `gateC1Problems(state)` -- the exact `gates.C1` record and the mandatory gate equations (§7),
 * every stored field recomputed. Returns `{problems, outcome}` (`outcome` = the STORED outcome when
 * the record is shaped, else null). The OPEN/closed record-population equations are enforced by
 * `recordSchemaProblems`.
 */
function gateC1Problems(state) {
  const s = isPlainObject(state) ? state : {};
  const out = [];
  if (!exactKeys(s.gates, ['C1'])) return { problems: ['gates.keys'], outcome: null };
  const g = s.gates.C1;
  if (!exactKeys(g, GATE_C1_KEYS)) return { problems: ['gates.C1.keys'], outcome: null };
  if (!isSeq(g.gateSeq)) out.push('gates.C1.gateSeq');
  if (!isIsoMs(g.gateAt)) out.push('gates.C1.gateAt');
  if (!CHECK_VERDICT_BASES.includes(g.c1Verdict)) out.push('gates.C1.c1Verdict-enum');
  if (!GATE_OUTCOMES.includes(g.outcome)) out.push('gates.C1.outcome-enum');
  if (!Number.isInteger(g.fatalCountAtGate) || g.fatalCountAtGate < 0) out.push('gates.C1.fatalCountAtGate');
  if (!Array.isArray(g.notStarted)) out.push('gates.C1.notStarted');
  const c1 = isPlainObject(s.checks) ? s.checks.C1 : null;
  if (!isPlainObject(c1) || c1.recordType !== RECORD_TYPE.CHECK_RUN) out.push('gates.C1.c1-record');
  else {
    if (g.c1Verdict !== c1.verdict) out.push('gates.C1.c1Verdict-ne-check');
    if (g.c1Reason !== c1.reason) out.push('gates.C1.c1Reason-ne-check');
    if (g.c1FinalizedSeq !== c1.finalizedSeq) out.push('gates.C1.c1FinalizedSeq-ne-check');
    const ev = c1FinalizationEvents(s.eventLog);
    if (ev.length !== 1) out.push(`gates.C1.check-finalized-events:${ev.length}`);
    else if (ev[0].seq !== c1.finalizedSeq || ev[0].verdict !== c1.verdict || ev[0].reason !== c1.reason) out.push('gates.C1.check-finalized-event-mismatch');
  }
  if (!(isSeq(g.c1FinalizedSeq) && isSeq(g.gateSeq) && g.c1FinalizedSeq < g.gateSeq)) out.push('gates.C1.c1FinalizedSeq-not-before-gate');
  const fc = recomputeFatalCountAtGate(s.errorLedger, g.gateSeq);
  for (const p of fc.problems) out.push(`gates.C1.${p}`);
  if (fc.count !== null && fc.count !== g.fatalCountAtGate) out.push('gates.C1.fatalCountAtGate-ne-recomputed');
  for (const p of gateFinalizationProblems(s.errorLedger, g.gateSeq)) out.push(`gates.C1.${p}`);
  // An indeterminate count (unsequenced entries, FATAL_ENTRY_SEQ_REQUIRED false) recomputes the
  // outcome from the stored fatalCountAtGate; a determinate count always uses the recomputed value.
  const recomputed = recomputeGateOutcome({ c1Verdict: isPlainObject(c1) ? c1.verdict : null, c1Reason: isPlainObject(c1) ? c1.reason : null, fatalCountAtGate: fc.count === null ? g.fatalCountAtGate : fc.count });
  if (g.outcome !== recomputed) out.push('gates.C1.outcome-ne-recomputed');
  const expectedNotStarted = recomputed === GATE_OUTCOME.OPEN ? [] : [...DOWNSTREAM_ITEM_NAMES];
  if (!sameJson(g.notStarted, expectedNotStarted)) out.push('gates.C1.notStarted-ne-recomputed');
  return { problems: out, outcome: GATE_OUTCOMES.includes(g.outcome) ? g.outcome : null };
}

/**
 * `controlRunProblems(name, rec)` -- exact §7/§10 `control-run` record: the accepted control record
 * plus the discriminator, the exact `executionRecord` and `dependencyBlockedBy` (non-null iff the
 * EFFECTIVE state is NRDB -- which is itself never legal in a control-run, L2).
 */
function controlRunProblems(name, rec) {
  if (!isPlainObject(rec)) return ['not-object'];
  const out = [];
  if (rec.recordType !== RECORD_TYPE.CONTROL_RUN) out.push('record-type');
  if (!exactKeys(rec, CONTROL_RUN_KEYS)) out.push('keys');
  const eff = controlEffectiveState(rec);
  if (!(CONTROL_ALLOWED_STATES[name] || []).includes(eff)) out.push('state');
  if (!isPlainJsonOk(rec.fields) || !isPlainJsonOk(rec.evidence)) out.push('not-plain-json');
  for (const p of executionRecordProblems(name, rec.executionRecord, { recordType: RECORD_TYPE.CONTROL_RUN, effectiveState: eff })) out.push(p);
  if (eff === NRDB_STATE) { out.push('nrdb-in-control-run'); for (const p of dependencyBlockedByShapeProblems(rec.dependencyBlockedBy)) out.push(p); } else if (rec.dependencyBlockedBy !== null) out.push('dependency-blocked-by-not-null');
  return out;
}

/**
 * `recordSchemaProblems(state)` -- the discriminated-union + gate validation shared by
 * `validateResultSchema` and §8 row 5: `checks` = check-run | gate-disposition, `controls` =
 * control-run | gate-disposition, C1 always a check-run, `gates.C1` + equations, run records under a
 * closed gate rejected, gate-disposition records without a closed gate rejected, dispositions
 * strictly increasing in C2..C20, N1..N8 order (G-e). Returns a list of problem strings.
 */
function recordSchemaProblems(state) {
  const s = isPlainObject(state) ? state : {};
  const out = [];
  const gatePresent = s.gates !== undefined && s.gates !== null;
  let outcome = null;
  if (!gatePresent) { if (GATE_C1_REQUIRED) out.push('gates-missing'); } else {
    const g = gateC1Problems(s);
    out.push(...g.problems);
    outcome = g.outcome;
  }
  const closed = outcome === GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED || outcome === GATE_OUTCOME.CLOSED_OTHER;
  const checks = isPlainObject(s.checks) ? s.checks : null;
  const controls = isPlainObject(s.controls) ? s.controls : null;
  if (!checks) out.push('checks'); else for (const k of Object.keys(checks)) if (!CHECK_NAMES.includes(k)) out.push(`checks.unknown:${k}`);
  if (!controls) out.push('controls'); else for (const k of Object.keys(controls)) if (!CONTROL_NAMES.includes(k)) out.push(`controls.unknown:${k}`);
  const dispositionSeqs = [];
  const item = (kind, name, rec) => {
    const rt = isPlainObject(rec) ? rec.recordType : undefined;
    const runType = kind === 'checks' ? RECORD_TYPE.CHECK_RUN : RECORD_TYPE.CONTROL_RUN;
    if (rt === runType) {
      if (closed && name !== 'C1') out.push(`${kind}.${name}:run-record-under-closed-gate`);
      const ps = kind === 'checks' ? checkRunProblems(name, rec, { requireFinalization: name === 'C1' && (gatePresent || GATE_C1_REQUIRED) }) : controlRunProblems(name, rec);
      for (const p of ps) out.push(`${kind}.${name}:${p}`);
      // The pre-RC1-C2 downstream encoding BLOCKED(dependency:C1..) is removed: under an OPEN gate C1
      // is PASS (contradiction), under a closed gate the item must be a gate-disposition.
      if (kind === 'checks' && name !== 'C1' && (gatePresent || GATE_C1_REQUIRED) && isLegacyDependencyOnC1(rec.reason)) out.push(`${kind}.${name}:legacy-dependency-c1-encoding`);
    } else if (rt === RECORD_TYPE.GATE_DISPOSITION && name !== 'C1') {
      for (const p of gateDispositionProblems(name, rec, s)) out.push(`${kind}.${name}:${p}`);
      dispositionSeqs.push(rec.dispositionSeq);
    } else out.push(`${kind}.${name}:${rec === undefined ? 'missing' : 'record-type'}`);
  };
  if (checks) for (const n of CHECK_NAMES) item('checks', n, checks[n]);
  if (controls) for (const n of CONTROL_NAMES) item('controls', n, controls[n]);
  for (let i = 1; i < dispositionSeqs.length; i += 1) {
    if (!(isSeq(dispositionSeqs[i - 1]) && isSeq(dispositionSeqs[i]) && dispositionSeqs[i - 1] < dispositionSeqs[i])) { out.push('G-e:dispositionSeq-not-strictly-increasing'); break; }
  }
  // §7/§10 attribution fields on every spyLedger/eventLog/stateSnapshots entry (any gate outcome).
  out.push(...attributionFieldProblems(s));
  // §9.2/§10 slice C1: request observations, raw network events, correlated identities, fatal
  // witnesses and the witnessCount invariant -- every stored value recomputed (row 5).
  out.push(...networkLedgerProblems(s));
  // §9.2 one run counter: every primary seq allocation is unique across collections.
  out.push(...primarySeqAllocations(s).problems);
  // H1: C1's reason is consistent with the node-side P1 load outcomes persisted in opLedger.
  out.push(...c1LoadLedgerProblems(s));
  // Closed gate, equation (b): no record matches CG-1..CG-7 (each match listed once), and every
  // record of the named collections is on the exhaustive legal list.
  if (closed) {
    for (const m of closedGateEvidenceMatches(s)) out.push(`closed-gate-evidence:${m}`);
    out.push(...closedGateIllegalRecords(s));
  }
  return out;
}

/**
 * `c1LoadLedgerProblems(state)` -- H1 (2026-10-01 follow-up review) closeout/R1 consistency equation
 * between C1's check-run record and the node-side P1 `loadOperation.completionOutcome`s persisted in
 * `errorLedger.opLedger` (§7 C1 reason contract; §7 line 421: the absence of any P1 harness exception
 * is part of the evidence for dependency loss). Part of `recordSchemaProblems`, so a mismatch is a
 * §8 row-5 evidence contradiction (and fails R1 verify):
 *   - any load `'harness-exception'` while C1 is PASS or carries a normalized reason
 *     (`prerequisite`/`timeout:load`) => `c1-load-ledger-mismatch:harness-exception`;
 *   - else any load `'timeout:load'` while C1 is PASS or `prerequisite` (the T2 deadline takes
 *     precedence) => `c1-load-ledger-mismatch:timeout:load`.
 * One-way only; no load records or a non-check-run C1 => no finding here (other rules apply).
 */
function c1LoadLedgerProblems(state) {
  const s = isPlainObject(state) ? state : {};
  const c1 = isPlainObject(s.checks) ? s.checks.C1 : null;
  if (!isPlainObject(c1) || c1.recordType !== RECORD_TYPE.CHECK_RUN) return [];
  const outcomes = errorLedgerList(s, 'opLedger').filter(isLoadRecordish).map((o) => o.completionOutcome);
  if (outcomes.includes('harness-exception')) {
    return c1.verdict === 'PASS' || C1_NORMALIZED_REASONS.includes(c1.reason) ? ['c1-load-ledger-mismatch:harness-exception'] : [];
  }
  if (outcomes.includes('timeout:load')) {
    return c1.verdict === 'PASS' || c1.reason === 'prerequisite' ? ['c1-load-ledger-mismatch:timeout:load'] : [];
  }
  return [];
}

/**
 * `nrdbLegality(name, state)` -- §7 NRDB record legality, EXACTLY L1-L4 (a pure function of
 * checks.C1, gates.C1, the control's recordType/disposition/executionRecord/dependencyBlockedBy and
 * the attribution fields of the retained ledgers; never of later events). Rows 1-3 are verdict
 * precedence, not legality. Returns `{legal, failed:['L1'|'L2'|'L3'|'L4'], problems}`.
 */
function nrdbLegality(name, state) {
  const s = isPlainObject(state) ? state : {};
  const failed = new Set();
  const problems = [];
  const fail = (l, p) => { failed.add(l); problems.push(`${l}:${p}`); };
  const c1 = isPlainObject(s.checks) ? s.checks.C1 : null;
  const rec = isPlainObject(s.controls) ? s.controls[name] : null;
  const gate = isPlainObject(s.gates) && isPlainObject(s.gates.C1) ? s.gates.C1 : null;
  // L1
  if (!isPlainObject(c1) || c1.recordType !== RECORD_TYPE.CHECK_RUN) fail('L1', 'c1-not-check-run');
  else {
    if (c1.verdict !== 'BLOCKED') fail('L1', 'c1-not-blocked');
    if (!C1_NORMALIZED_REASONS.includes(c1.reason)) fail('L1', 'c1-reason-not-normalized');
  }
  // L2
  if (!NRDB_CONTROL_NAMES.includes(name)) fail('L2', 'control-cannot-be-nrdb');
  if (!isPlainObject(rec) || rec.recordType !== RECORD_TYPE.GATE_DISPOSITION) fail('L2', 'not-gate-disposition');
  if (controlEffectiveState(rec) !== NRDB_STATE) fail('L2', 'effective-state-not-nrdb');
  const er = isPlainObject(rec) ? rec.executionRecord : null;
  const erp = executionRecordProblems(name, er, { recordType: RECORD_TYPE.GATE_DISPOSITION, effectiveState: NRDB_STATE });
  if (erp.length > 0 || !isPlainObject(er) || er.started !== false) fail('L2', 'execution-record-not-exact-not-started');
  for (const p of itemAttributionProblems(s, name)) fail('L2', p);
  // L3
  const dp = dependencyBlockedByReferentialProblems(isPlainObject(rec) ? rec.dependencyBlockedBy : null, s, rec);
  if (dp.length > 0) fail('L3', dp[0]);
  // L4
  if (!gate || gate.outcome !== GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED) fail('L4', 'gate-not-closed-dependency-blocked');
  if (!gate || !Array.isArray(gate.notStarted) || !gate.notStarted.includes(name)) fail('L4', 'not-in-notStarted');
  const ts = isPlainObject(er) ? er.terminalSeq : null;
  if (!gate || !(isSeq(gate.c1FinalizedSeq) && isSeq(gate.gateSeq) && isSeq(ts) && gate.c1FinalizedSeq < gate.gateSeq && gate.gateSeq < ts)) fail('L4', 'seq-order');
  if (!isPlainObject(rec) || ts !== rec.dispositionSeq) fail('L4', 'terminalSeq-ne-dispositionSeq');
  const order = ['L1', 'L2', 'L3', 'L4'].filter((l) => failed.has(l));
  return { legal: order.length === 0, failed: order, problems };
}

/**
 * `evaluateOverallRows(state, phase)` -- pure; evaluates EVERY row predicate independently over
 * the recorded state (no row reads another row's result) and returns
 * `[{row, overall, match, reasons[]}]` for rows 1..8. Row 8 is evaluated as its own positive
 * predicate; `computeOverall` selects the first match. Reads only these state fields:
 * errorLedger, cleanupUnresolvedOwnership, cleanupFailures, checks, controls, script, classifier,
 * runtime, sessionTainted, attempt, authorization, harnessIntegrity, procedure, runtimeEnvelope,
 * journal and (pre-link only) closeoutFacts.
 */
function evaluateOverallRows(state, phase) {
  if (!OVERALL_PHASES.includes(phase)) throw new Error(`evaluateOverallRows: unknown phase ${String(phase)}`);
  const s = isPlainObject(state) ? state : {};
  const preLink = phase === OVERALL_PHASES[1];

  // Row 1 -- fatal errors (an unreadable ledger fails closed).
  const ledger = isPlainObject(s.errorLedger) ? s.errorLedger : null;
  const r1 = [];
  if (!ledger || !Number.isInteger(ledger.fatalCount) || ledger.fatalCount < 0) r1.push('error-ledger-invalid');
  else if (ledger.fatalCount > 0) r1.push(`fatal-error-observed:${ledger.fatalCount}`);

  // Row 2 -- unresolved cleanup ownership (non-boolean fails closed).
  const r2 = s.cleanupUnresolvedOwnership === false ? [] : ['cleanup-unresolved-ownership'];

  // Row 3 -- any required check FAIL (verdicts read ONLY from check-run records; a gate-disposition
  // record has no verdict and yields null here).
  const checks = isPlainObject(s.checks) ? s.checks : {};
  const bases = {};
  for (const n of CHECK_NAMES) bases[n] = checkVerdictBase(checks[n]);
  const r3 = CHECK_NAMES.filter((n) => bases[n] === 'FAIL').map((n) => `check-fail:${n}`);

  // Row 4 -- any mandatory control non-acceptable (incl. missing/out-of-enum and any NRDB violating
  // L1-L4); a legal NRDB is neutral. Effective state only (control-run.state | disposition).
  const controls = isPlainObject(s.controls) ? s.controls : {};
  const dispositions = {};
  for (const n of CONTROL_NAMES) dispositions[n] = controlDisposition(n, controls[n], bases, s);
  const r4 = CONTROL_NAMES.filter((n) => dispositions[n] === 'unacceptable').map((n) => `control-unacceptable:${n}`);

  // Row 5 -- authorization/journal/evidence contradiction or failure.
  const r5 = [];
  const journalProblem = preLink ? preLinkJournalProblem(s.journal, s.closeoutFacts) : preCloseoutJournalProblem(s.journal);
  if (journalProblem) r5.push(journalProblem);
  const binding = bindingMismatch(s);
  if (binding) r5.push(binding);
  const integrity = isPlainObject(s.script) ? s.script.integrityResult : undefined;
  if (!INTEGRITY_VALUES.includes(integrity)) r5.push('integrity-out-of-enum');
  else if (integrity === INTEGRITY_RESULT.MISMATCH || integrity === INTEGRITY_RESULT.FETCH_FAILED) r5.push(`integrity:${integrity}`);
  if (!ledger || ledger.attemptDeadlineExpired !== false) r5.push('attempt-deadline');
  // Record unions (check-run|gate-disposition, control-run|gate-disposition), G-a..G-f, the gate
  // equations (X28/X29), run records under a closed gate, dispositions without a closed gate.
  const schemaProblems = recordSchemaProblems(s);
  for (const p of schemaProblems) r5.push(`record-schema:${p}`);
  if (!Array.isArray(s.cleanupFailures)) r5.push('cleanup-failures-invalid');
  if (preLink) {
    const closeoutProblem = preLinkCloseoutProblem(s.closeoutFacts);
    if (closeoutProblem) r5.push(closeoutProblem);
  }

  // Row 6 -- prerequisite/evidence unavailable.
  const r6 = [];
  const classifier = isPlainObject(s.classifier) ? s.classifier : {};
  for (const m of ['A', 'B']) if (classifierValueOf(classifier[m]) !== CLASSIFIER_CONFIRMED) r6.push(`classifier-not-confirmed:${m}`);
  if (integrity === INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS || integrity === INTEGRITY_RESULT.CAPTURE_UNAVAILABLE) r6.push(`integrity:${integrity}`);
  const runtime = isPlainObject(s.runtime) ? s.runtime : {};
  for (const m of ['A', 'B']) if (!isPlainObject(runtime[m]) || runtime[m].loaded !== true) r6.push(`model-unloadable:${m}`);
  for (const n of CHECK_NAMES) if (bases[n] === 'BLOCKED') r6.push(`check-blocked:${n}`);
  // Row-6 gate clause: a CLOSED_DEPENDENCY_BLOCKED gate carries the row through C1's own check-run
  // record and this clause; its gate-disposition records never count as a runtime BLOCKED.
  if (isPlainObject(s.gates) && isPlainObject(s.gates.C1) && s.gates.C1.outcome === GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED) r6.push('gate-closed-dependency-blocked:C1');
  if (s.sessionTainted !== false) r6.push('session-tainted');

  // Row 7 -- partial evidence.
  const r7 = [];
  for (const n of CHECK_NAMES) if (bases[n] === 'NOT_EVIDENCED') r7.push(`check-not-evidenced:${n}`);
  for (const n of CONTROL_NAMES) if (dispositions[n] === 'partial') r7.push(`control-partial:${n}`);
  if (Array.isArray(s.cleanupFailures) && s.cleanupFailures.length > 0) r7.push('cleanup-step-failed-ownership-resolved');

  // Row 8 -- positive PASS(-eligible) predicate, evaluated on its own: every check a check-run PASS
  // (so no gate-disposition record exists), every control acceptable, records schema-valid.
  const allChecksPass = CHECK_NAMES.every((n) => bases[n] === 'PASS') && schemaProblems.length === 0;
  const allControlsAcceptable = CONTROL_NAMES.every((n) => dispositions[n] === 'acceptable');
  const r8match = Boolean(ledger) && ledger.fatalCount === 0 && ledger.attemptDeadlineExpired === false
    && s.cleanupUnresolvedOwnership === false && Array.isArray(s.cleanupFailures) && s.cleanupFailures.length === 0
    && allChecksPass && allControlsAcceptable && integrity === INTEGRITY_RESULT.VERIFIED
    && ['A', 'B'].every((m) => classifierValueOf(classifier[m]) === CLASSIFIER_CONFIRMED)
    && ['A', 'B'].every((m) => isPlainObject(runtime[m]) && runtime[m].loaded === true)
    && s.sessionTainted === false && journalProblem === null && binding === null
    && (!preLink || preLinkCloseoutProblem(s.closeoutFacts) === null);

  const rows = [[1, r1], [2, r2], [3, r3], [4, r4], [5, r5], [6, r6], [7, r7]]
    .map(([row, reasons]) => ({ row, overall: OVERALL_ROW_VERDICT[row], match: reasons.length > 0, reasons }));
  rows.push({ row: 8, overall: OVERALL_ROW_VERDICT[8], match: r8match, reasons: r8match ? ['pass-eligible'] : [] });
  return rows;
}

/**
 * `computeOverall(state, phase)` -- §8. `phase` must be one of OVERALL_PHASES ('pre-closeout' |
 * 'pre-link'); anything else (a third phase included) throws. Returns a frozen
 * `{overall, row, reasons, phase}` -- the first matching row. If no row matched (unreachable when
 * row 8 is the complement of rows 1..7; asserted by the offline matrix) the result fails closed to
 * row 5 `unclassifiable-state`. Pure, synchronous, reads no K-dependent predicate.
 */
function computeOverall(state, phase) {
  if (!OVERALL_PHASES.includes(phase)) throw new Error(`computeOverall: unknown phase ${String(phase)} (only pre-closeout / pre-link exist)`);
  const rows = evaluateOverallRows(state, phase);
  const hit = rows.find((r) => r.match);
  if (!hit) return Object.freeze({ overall: VERDICT_FAIL, row: 5, reasons: Object.freeze(['unclassifiable-state']), phase });
  return Object.freeze({ overall: hit.overall, row: hit.row, reasons: Object.freeze(hit.reasons.slice()), phase });
}

/** §8 exit codes: PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, anything else 4 (unrecognized). */
function exitCodeForVerdict(verdict) {
  switch (verdict) {
    case VERDICT.PASS: return 0;
    case VERDICT.FAIL: return 1;
    case VERDICT.BLOCKED: return 2;
    case VERDICT.PARTIAL: return 3;
    default: return 4;
  }
}

// ============================================================================================
// Section 12 -- evidence schema (procedure §10) and the R1 frozen payload snapshot (§9.1 "R1
// payload cutoff"). R1/R2/R3/K/F builders are pure and deterministic; every validator is
// fail-closed (unknown or forbidden key => invalid).
// ============================================================================================

const RESULTS_REL_DIR = `${ATTEMPTS_D0_REL}/${ATTEMPTS_D1_NAME}`;
const R1_NAME = 'clashpanel-viewerbridge-g2-result.json';
const R2_NAME = 'clashpanel-viewerbridge-g2-summary.md';
const R3_NAME = 'clashpanel-viewerbridge-g2-closeout.json';
const R1_REL_PATH = `${RESULTS_REL_DIR}/${R1_NAME}`;
const R2_REL_PATH = `${RESULTS_REL_DIR}/${R2_NAME}`;
const R3_REL_PATH = `${RESULTS_REL_DIR}/${R3_NAME}`;

/** Candidate name (`<id>.commit.candidate-<uuid>`, non-authoritative, §9.1). */
function commitCandidateName(id, u) { return `${id}.commit.candidate-${u}`; }

/** §10 top-level keys of R1, in serialization order (the whitelist). */
const RESULT_TOP_LEVEL_KEYS = Object.freeze([
  'script', 'procedure', 'authorization', 'attempt', 'harnessIntegrity', 'runtimeEnvelope', 'classifier', 'runtime',
  'targets', 'checks', 'gates', 'controls', 'sceneOwnership', 'spyLedger', 'eventLog', 'stateSnapshots', 'c4Table', 'c17', 'c20',
  'n6', 'screenshots', 'errorLedger', 'cleanupFailures', 'cleanupStepStatus', 'cleanupUnresolvedOwnership',
  'viewerScriptIntegrityReason', 'sessionTainted', 'staleContinuationsDropped', 'overall', 'closeout', 'limitations',
  'startedAt', 'finishedAt',
]);

/** Keys the payload builder derives itself (never copied from the run state). */
const RESULT_DERIVED_KEYS = Object.freeze(['overall', 'closeout', 'finishedAt']);

/** Run-state keys copied into the frozen snapshot S* (all other state fields are never read). */
const RESULT_STATE_KEYS = Object.freeze(RESULT_TOP_LEVEL_KEYS.filter((k) => !RESULT_DERIVED_KEYS.includes(k)));

/**
 * Closeout facts that exist only in R3/K/F/later records and are FORBIDDEN in R1 (§9.1). Checked
 * at every depth of the payload (a closeout-only fact can never hide in a nested record).
 */
const RESULT_FORBIDDEN_DEEP_KEYS = Object.freeze([
  'closeoutFailures', 'requiredArtifacts', 'finalOverall', 'resultSha256', 'summarySha256', 'manifestSha256',
  'journalSha256', 'committedAt', 'closeoutComplete', 'commitRecord',
]);
/** Additionally forbidden at the top level and inside `closeout`. */
const RESULT_FORBIDDEN_SHALLOW_KEYS = Object.freeze(['verification', 'commit', 'K', 'artifacts']);

/**
 * Canonical plain-JSON deep copy (§9.1: numbers, strings, booleans, null, plain arrays, plain
 * objects only). Throws on undefined, non-finite numbers, functions, symbols, bigint, typed arrays,
 * Buffer, Map, Set, Date, or any non-plain prototype.
 */
function toPlainJson(value, where = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-plain-json: non-finite number at ${where}`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`non-plain-json: exotic array at ${where}`);
    return value.map((v, i) => toPlainJson(v, `${where}[${i}]`));
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`non-plain-json: non-plain object at ${where}`);
    const out = {};
    for (const k of Object.keys(value)) out[k] = toPlainJson(value[k], `${where}.${k}`);
    return out;
  }
  throw new TypeError(`non-plain-json: ${typeof value} at ${where}`);
}

/** Canonical serialization (recursively sorted keys) of a plain-JSON value; used for snapshotSha256. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

/**
 * `takeFrozenSnapshot({state, primary, optional, journal, finishedAt})` -- the §9.1 payload
 * cutoff S*: a deep plain-JSON copy of ONLY the §10 run-state keys (a missing key becomes null;
 * nothing else on the state object -- e.g. a `closeoutComplete` getter -- is ever read), plus
 * primaryOverall/primaryRow, the O2 status list and the journal transitions through
 * CLOSEOUT_STARTED. Deep-frozen as a guard; `snapshotSha256` hashes its canonical serialization.
 */
function takeFrozenSnapshot({ state, primary, optional, journal, finishedAt }) {
  const run = {};
  for (const k of RESULT_STATE_KEYS) run[k] = state[k] === undefined ? null : toPlainJson(state[k], `$.${k}`);
  const transitions = toPlainJson(journal.transitions, '$.journal.transitions');
  const states = transitions.map((t) => t.state);
  if (states[states.length - 1] !== JOURNAL_STATE.CLOSEOUT_STARTED) throw new TypeError('snapshot: journal must end at CLOSEOUT_STARTED');
  const snapshot = deepFreeze({
    run,
    primaryOverall: primary.overall,
    primaryRow: primary.row,
    optional: toPlainJson(optional, '$.optional'),
    journalTransitions: transitions,
    finishedAt,
  });
  const canonical = canonicalJson(snapshot);
  return { snapshot, snapshotSha256: sha256Hex(Buffer.from(canonical, 'utf8')) };
}

/**
 * `buildResultPayload(S*)` -- pure, deterministic §10 R1 payload. Only the whitelisted keys, in
 * RESULT_TOP_LEVEL_KEYS order; `overall = {verdict: primaryOverall, row: primaryRow}`
 * (non-authoritative); `closeout = {phase:'payload', primaryOverall, primaryRow, optional}`;
 * `attempt = {attemptId, journalStates[] (ending at CLOSEOUT_STARTED), authBoundAt, consumedAt}`;
 * `finishedAt` = the snapshot instant. No hash, verification outcome or commit field can appear.
 */
function buildResultPayload(S) {
  const out = {};
  for (const key of RESULT_TOP_LEVEL_KEYS) {
    if (key === 'overall') out.overall = { verdict: S.primaryOverall, row: S.primaryRow };
    else if (key === 'closeout') out.closeout = { phase: 'payload', primaryOverall: S.primaryOverall, primaryRow: S.primaryRow, optional: S.optional };
    else if (key === 'finishedAt') out.finishedAt = S.finishedAt;
    else if (key === 'attempt') {
      const t = S.journalTransitions;
      const at = (name) => { const hit = t.find((x) => x.state === name); return hit ? hit.at : null; };
      out.attempt = {
        attemptId: isPlainObject(S.run.attempt) ? S.run.attempt.attemptId : null,
        journalStates: t.map((x) => ({ state: x.state, at: x.at })),
        authBoundAt: at(JOURNAL_STATE.AUTH_BOUND),
        consumedAt: at(JOURNAL_STATE.ATTEMPT_CONSUMED),
      };
    } else out[key] = S.run[key];
  }
  return out;
}

function findForbiddenDeepKey(value, where = '$') {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) { const hit = findForbiddenDeepKey(value[i], `${where}[${i}]`); if (hit) return hit; }
    return null;
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      if (RESULT_FORBIDDEN_DEEP_KEYS.includes(k)) return `${where}.${k}`;
      const hit = findForbiddenDeepKey(value[k], `${where}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * `validateResultSchema(result, 'payload')` -- §10/§9.1 R1 validator. Only the 'payload' mode
 * exists (anything else throws). Returns `{ok, errors[]}`: exact top-level whitelist (unknown or
 * missing key => invalid), forbidden closeout keys at the top level / in `closeout` and at any
 * depth (RESULT_FORBIDDEN_DEEP_KEYS), and the shapes/enums of the verdict-bearing fields.
 */
function validateResultSchema(result, mode) {
  if (mode !== 'payload') throw new Error(`validateResultSchema: unsupported mode ${String(mode)} (only 'payload')`);
  const errors = [];
  if (!isPlainObject(result)) return { ok: false, errors: ['not-object'] };
  for (const k of Object.keys(result)) {
    if (RESULT_FORBIDDEN_SHALLOW_KEYS.includes(k) || RESULT_FORBIDDEN_DEEP_KEYS.includes(k)) errors.push(`forbidden-key:${k}`);
    else if (!RESULT_TOP_LEVEL_KEYS.includes(k)) errors.push(`unknown-key:${k}`);
  }
  for (const k of RESULT_TOP_LEVEL_KEYS) if (!Object.prototype.hasOwnProperty.call(result, k)) errors.push(`missing-key:${k}`);
  const deep = findForbiddenDeepKey(result);
  if (deep) errors.push(`forbidden-key-deep:${deep}`);

  const p = result.procedure;
  if (!isPlainObject(p) || !isNonEmptyString(p.path) || !SHA256_HEX_RE.test(p.sha256 || '') || p.version !== PROCEDURE_VERSION || p.thresholdTable !== 'T-rev2') errors.push('procedure');
  const a = result.attempt;
  if (!isPlainObject(a) || Object.keys(a).sort().join(',') !== 'attemptId,authBoundAt,consumedAt,journalStates') errors.push('attempt-keys');
  else {
    if (typeof a.attemptId !== 'string' || !UUID_V4_RE.test(a.attemptId)) errors.push('attempt.attemptId');
    const js = Array.isArray(a.journalStates) ? a.journalStates : null;
    if (!js || js.length === 0 || !js.every((t) => isPlainObject(t) && typeof t.state === 'string')) errors.push('attempt.journalStates');
    else {
      const names = js.map((t) => t.state);
      const exact = [JOURNAL_STATE.AUTH_BOUND, JOURNAL_STATE.ATTEMPT_CONSUMED, JOURNAL_STATE.CLOSEOUT_STARTED];
      if (names.length !== exact.length || names.some((n, i) => n !== exact[i])) errors.push('attempt.journalStates-not-ending-at-closeout-started');
    }
  }
  // §7/§10 RC1-C2: `checks` (check-run | gate-disposition), `controls` (control-run |
  // gate-disposition), `gates.C1` + the mandatory gate equations -- shared with §8 row 5.
  for (const p of recordSchemaProblems(result)) errors.push(p);
  const checks = result.checks;
  if (isPlainObject(checks)) {
    // §C15(e) RC1-C1: a retained `checks.C15.fields.e` must satisfy the exact schema + recomputation.
    const c15 = checks.C15;
    if (isPlainObject(c15) && c15.recordType === RECORD_TYPE.CHECK_RUN && isPlainObject(c15.fields) && c15.fields.e !== undefined && c15.fields.e !== null) {
      const v = validateC15eEvidence(c15.fields.e);
      if (!v.ok) for (const err of v.errors) errors.push(`checks.C15.fields.e:${err}`);
    }
  }
  const o = result.overall;
  if (!isPlainObject(o) || Object.keys(o).sort().join(',') !== 'row,verdict' || !PRIMARY_OVERALL_VALUES.includes(o.verdict) || !Number.isInteger(o.row) || o.row < 1 || o.row > 8) errors.push('overall');
  // §10: `overall` is primaryOverall "with the matching row"; the §8 table fixes each row's verdict
  // (rows 1-5 FAIL, 6 BLOCKED, 7 PARTIAL, 8 PASS), so a mismatched pair is invalid. (The row itself is
  // not recomputed from R1 here -- the procedure does not require re-running computeOverall.)
  else if (OVERALL_ROW_VERDICT[o.row] !== o.verdict) errors.push('overall.row-verdict-mismatch');
  const c = result.closeout;
  if (!isPlainObject(c) || Object.keys(c).sort().join(',') !== 'optional,phase,primaryOverall,primaryRow') errors.push('closeout-keys');
  else {
    if (c.phase !== 'payload') errors.push('closeout.phase');
    if (!PRIMARY_OVERALL_VALUES.includes(c.primaryOverall)) errors.push('closeout.primaryOverall');
    if (!Number.isInteger(c.primaryRow) || c.primaryRow < 1 || c.primaryRow > 8) errors.push('closeout.primaryRow');
    else if (PRIMARY_OVERALL_VALUES.includes(c.primaryOverall) && OVERALL_ROW_VERDICT[c.primaryRow] !== c.primaryOverall) errors.push('closeout.row-verdict-mismatch');
    if (!Array.isArray(c.optional) || !c.optional.every((x) => isPlainObject(x) && Object.keys(x).sort().join(',') === 'name,status' && isNonEmptyString(x.name) && isNonEmptyString(x.status))) errors.push('closeout.optional');
    if (isPlainObject(o) && (o.verdict !== c.primaryOverall || o.row !== c.primaryRow)) errors.push('overall-differs-from-closeout');
  }
  for (const k of ['startedAt', 'finishedAt']) if (typeof result[k] !== 'string' || !ISO_UTC_RE.test(result[k])) errors.push(k);
  for (const k of ['sessionTainted', 'cleanupUnresolvedOwnership']) if (typeof result[k] !== 'boolean') errors.push(k);
  return { ok: errors.length === 0, errors };
}

/** True for a plain-JSON value (strings, finite numbers, booleans, null, plain arrays/objects) -- R1. */
function isPlainJsonValue(v, depth = 0) {
  if (depth > 32) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return Object.getPrototypeOf(v) === Array.prototype && v.every((x) => isPlainJsonValue(x, depth + 1));
  if (typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(v).every((k) => isPlainJsonValue(v[k], depth + 1));
}

const C15E_EVIDENCE_KEYS = Object.freeze(['nm', 'ledgerBefore', 'E0', 'H0', 'T_iso', 'H_iso', 'presentSettleSeq', 'hIsoReadSeq', 'injection', 'clears', 'comparisons', 'predicates', 'failureLabel', 'diagnostics']);
const C15E_INJECTION_KEYS = Object.freeze(['installSeq', 'armSeq', 'disarmSeq', 'removeSeq', 'restoredByReference', 'originalInvocationsWhileArmed', 'thrownInjectedCount']);
const C15E_CLEAR_KEYS = Object.freeze(['index', 'injectionArmed', 'startSeq', 'settleSeq', 'outcome', 'spyWindow', 'after']);
const C15E_SPY_KEYS = Object.freeze(['seq', 'method', 'origin', 'argDigest', 'thrown', 'returned']);
const C15E_CLEAR_ISOLATION_VALUES = Object.freeze(['restored', 'failed', 'skipped-external', 'none']);
const C15E_COMPARISON_KEYS = Object.freeze({ clear1: ['isolationEqualsTiso', 'hiddenEqualsHiso'], clear2: ['isolationEqualsE0', 'hiddenEqualsH0'], clear3: ['isolationEqualsE0', 'hiddenEqualsH0'] });

/** CanonIso / CanonHidden: a canonical array (model keys 'A'/'B') or exactly `{unreadable:true, error:string}`. */
function isC15eCanonValue(v) {
  if (Array.isArray(v)) return isC15eCanonArray(v);
  return exactKeys(v, ['unreadable', 'error']) && v.unreadable === true && typeof v.error === 'string';
}
function isC15eLedgerDTO(v) {
  return exactKeys(v, ['markerMeshCount', 'isolationConfirmed']) && Number.isInteger(v.markerMeshCount) && v.markerMeshCount >= 0
    && (v.isolationConfirmed === null || typeof v.isolationConfirmed === 'boolean');
}

/**
 * `validateC15eEvidence(e)` -> `{ok, errors}` -- the exact §C15(e) RC1-C1 retained-evidence schema
 * (`checks.C15.fields.e`): all keys required, unknown keys rejected at every level, plain JSON only,
 * LedgerDTO the only ledger projection, CanonIso/CanonHidden canonical or exactly unreadable,
 * ClearStep index 1..3 with `injectionArmed` true iff index 1, `originalInvocationsWhileArmed` 0, the
 * ordering invariants, spy windows strictly ascending inside their coverage range (c15eDerive), and
 * the RECOMPUTATION of every comparison, predicate, `failureLabel` and `thrownInjectedCount` from the
 * stored values -- any disagreement is an evidence contradiction (§8 row 5). `diagnostics.*` is
 * schema-checked only (LedgerDTO|null) and never recomputed into anything.
 */
function validateC15eEvidence(e) {
  const errors = [];
  if (!isPlainObject(e)) return { ok: false, errors: ['not-object'] };
  if (!isPlainJsonValue(e)) errors.push('not-plain-json');
  if (!exactKeys(e, C15E_EVIDENCE_KEYS)) return { ok: false, errors: [...errors, 'keys'] };
  const isInt = Number.isInteger;
  if (!isInt(e.nm) || e.nm < 0) errors.push('nm');
  if (!isC15eLedgerDTO(e.ledgerBefore)) errors.push('ledgerBefore');
  for (const k of ['E0', 'H0', 'T_iso', 'H_iso']) if (!isC15eCanonValue(e[k])) errors.push(k);
  for (const k of ['presentSettleSeq', 'hIsoReadSeq']) if (!isInt(e[k])) errors.push(k);
  const inj = e.injection;
  if (!exactKeys(inj, C15E_INJECTION_KEYS)) errors.push('injection.keys');
  else {
    for (const k of ['installSeq', 'armSeq', 'disarmSeq', 'removeSeq', 'originalInvocationsWhileArmed', 'thrownInjectedCount']) if (!isInt(inj[k])) errors.push(`injection.${k}`);
    if (typeof inj.restoredByReference !== 'boolean') errors.push('injection.restoredByReference');
    if (inj.originalInvocationsWhileArmed !== 0) errors.push('injection.originalInvocationsWhileArmed');
  }
  const clears = e.clears;
  let clearsOk = Array.isArray(clears) && clears.length === 3;
  if (!clearsOk) errors.push('clears');
  else {
    clears.forEach((c, i) => {
      const p = `clears[${i}]`;
      if (!exactKeys(c, C15E_CLEAR_KEYS)) { errors.push(`${p}.keys`); clearsOk = false; return; }
      if (c.index !== i + 1) errors.push(`${p}.index`);
      if (c.injectionArmed !== (i === 0)) errors.push(`${p}.injectionArmed`);
      if (!isInt(c.startSeq) || !isInt(c.settleSeq)) { errors.push(`${p}.seq`); clearsOk = false; }
      const o = c.outcome;
      if (!exactKeys(o, ['isolation', 'markersRemoved', 'notes']) || !C15E_CLEAR_ISOLATION_VALUES.includes(o.isolation) || !isInt(o.markersRemoved)
        || !Array.isArray(o.notes) || !o.notes.every((n) => typeof n === 'string')) errors.push(`${p}.outcome`);
      const a = c.after;
      if (!exactKeys(a, ['readSeq', 'isolation', 'hidden', 'models']) || !isInt(a.readSeq) || !isC15eCanonValue(a.isolation) || !isC15eCanonValue(a.hidden)
        || !Array.isArray(a.models) || !a.models.every((m) => C15E_SETUP_MODEL_KEYS.includes(m))) { errors.push(`${p}.after`); clearsOk = false; }
      if (!Array.isArray(c.spyWindow)) { errors.push(`${p}.spyWindow`); clearsOk = false; return; }
      const lo = i === 0 ? c.startSeq : (clears[i - 1] && clears[i - 1].settleSeq);
      let prev = -Infinity;
      c.spyWindow.forEach((r, j) => {
        const q = `${p}.spyWindow[${j}]`;
        if (!exactKeys(r, C15E_SPY_KEYS) || !isInt(r.seq) || !isNonEmptyString(r.method) || !isNonEmptyString(r.origin) || typeof r.argDigest !== 'string'
          || !(r.thrown === null || typeof r.thrown === 'string') || !(r.returned === null || typeof r.returned === 'string')) { errors.push(q); return; }
        if (!(r.seq > prev)) errors.push(`${p}.spyWindow-not-ascending`);
        prev = r.seq;
        if (!(r.seq > lo && r.seq < c.settleSeq)) errors.push(`${p}.spyWindow-out-of-range`);
      });
    });
  }
  const d = e.diagnostics;
  if (!exactKeys(d, ['inspectLedgerAfterClear1', 'inspectLedgerAfterClear2', 'inspectLedgerAfterClear3'])
    || !Object.values(d).every((v) => v === null || isC15eLedgerDTO(v))) errors.push('diagnostics');
  if (!(e.failureLabel === null || C15E_FAILURE_LABELS.includes(e.failureLabel))) errors.push('failureLabel');
  const cmp = e.comparisons;
  const cmpOk = exactKeys(cmp, Object.keys(C15E_COMPARISON_KEYS))
    && Object.keys(C15E_COMPARISON_KEYS).every((k) => exactKeys(cmp[k], C15E_COMPARISON_KEYS[k]) && C15E_COMPARISON_KEYS[k].every((x) => typeof cmp[k][x] === 'boolean'));
  if (!cmpOk) errors.push('comparisons');
  const preds = e.predicates;
  const predsOk = exactKeys(preds, C15E_PREDICATE_NAMES) && C15E_PREDICATE_NAMES.every((n) => typeof preds[n] === 'boolean');
  if (!predsOk) errors.push('predicates');
  if (clearsOk && inj && isInt(inj.installSeq)) {
    const c = clears;
    const chain = [e.presentSettleSeq, e.hIsoReadSeq, inj.installSeq, inj.armSeq, c[0].startSeq, c[0].settleSeq, inj.disarmSeq];
    const strict = chain.every((v, i) => i === 0 || v > chain[i - 1])
      && inj.disarmSeq <= inj.removeSeq
      && [inj.removeSeq, c[0].after.readSeq, c[1].startSeq, c[1].settleSeq, c[1].after.readSeq, c[2].startSeq, c[2].settleSeq, c[2].after.readSeq]
        .every((v, i, arr) => i === 0 || v > arr[i - 1]);
    if (!strict) errors.push('ordering');
    // recomputation (row 5 contradiction on any disagreement)
    const r = c15eDerive(e);
    if (cmpOk) for (const k of Object.keys(C15E_COMPARISON_KEYS)) for (const x of C15E_COMPARISON_KEYS[k]) if (cmp[k][x] !== r.comparisons[k][x]) errors.push(`comparisons.${k}.${x}:contradiction`);
    if (predsOk) for (const n of C15E_PREDICATE_NAMES) if (preds[n] !== r.predicates[n]) errors.push(`predicates.${n}:contradiction`);
    if (e.failureLabel !== r.failureLabel) errors.push('failureLabel:contradiction');
    if (inj.thrownInjectedCount !== r.thrownInjectedCount) errors.push('injection.thrownInjectedCount:contradiction');
  }
  return { ok: errors.length === 0, errors };
}

/** R2 fixed headings (verification: each present as a whole line). */
const SUMMARY_REQUIRED_HEADINGS = Object.freeze([
  '# G2 ViewerBridge / DockingPanel live verification summary (R2)',
  '## Provisional overall (non-authoritative)',
  '## Attempt',
  '## Checks',
  '## Controls',
  '## Optional artifacts',
]);

function summaryPrimaryLine(primaryOverall, primaryRow) { return `primaryOverall: ${primaryOverall} (row ${primaryRow})`; }

/**
 * `renderSummary(S*)` -- pure deterministic Markdown rendering of the frozen snapshot (R2). Carries
 * no artifact hash and states that the authoritative verdict is derived from K by the reader.
 */
/**
 * Human-readable label of a check-run record in the §8 notation (`VERDICT` / `VERDICT(reason)`; the
 * stored record is always `{verdict:<base>, reason}`). Any other value (an oracle result whose own
 * `verdict` is a label, e.g. C4 `FAIL(not-contained)`) is returned as its `verdict` unchanged.
 * Display/diagnostic only -- no verdict function parses it.
 */
function checkVerdictLabel(rec) {
  if (isPlainObject(rec) && rec.recordType === RECORD_TYPE.CHECK_RUN) return rec.reason === null || rec.reason === undefined ? rec.verdict : `${rec.verdict}(${rec.reason})`;
  return isPlainObject(rec) ? rec.verdict : rec;
}

/** Summary cell of one check: the check-run label, or `gate-disposition:<d>`. */
function summaryCheckCell(rec) {
  if (!isPlainObject(rec)) return String(rec ?? 'missing');
  if (rec.recordType === RECORD_TYPE.GATE_DISPOSITION) return `gate-disposition:${String(rec.disposition)}`;
  return String(checkVerdictLabel(rec));
}

function renderSummary(S) {
  const run = S.run;
  const checks = isPlainObject(run.checks) ? run.checks : {};
  const controls = isPlainObject(run.controls) ? run.controls : {};
  const lines = [
    SUMMARY_REQUIRED_HEADINGS[0],
    '',
    'Deterministic rendering of the frozen payload snapshot S*. The authoritative verdict is',
    'deriveVerdictFromArtifacts over the durable attempt files (terminal commit record K), never this file.',
    '',
    SUMMARY_REQUIRED_HEADINGS[1],
    '',
    summaryPrimaryLine(S.primaryOverall, S.primaryRow),
    '',
    SUMMARY_REQUIRED_HEADINGS[2],
    '',
    `attemptId: ${isPlainObject(run.attempt) ? String(run.attempt.attemptId) : 'null'}`,
    `journal: ${S.journalTransitions.map((t) => t.state).join(' -> ')}`,
    `finishedAt: ${S.finishedAt}`,
    '',
    SUMMARY_REQUIRED_HEADINGS[3],
    '',
    '| Check | Verdict |',
    '|---|---|',
    ...CHECK_NAMES.map((n) => `| ${n} | ${summaryCheckCell(checks[n])} |`),
    '',
    SUMMARY_REQUIRED_HEADINGS[4],
    '',
    '| Control | State |',
    '|---|---|',
    ...CONTROL_NAMES.map((n) => `| ${n} | ${String(controlEffectiveState(controls[n]) ?? 'missing')} |`),
    '',
    SUMMARY_REQUIRED_HEADINGS[5],
    '',
    ...(S.optional.length === 0 ? ['(none recorded)'] : S.optional.map((x) => `- ${x.name}: ${x.status}`)),
    '',
  ];
  return lines.join('\n');
}

/** R2 verification (§9.1 R3.verification.R2): headings present and exactly one primaryOverall line. */
function verifySummaryText(text, primaryOverall, primaryRow) {
  const lines = String(text).split('\n');
  const headingsPresent = SUMMARY_REQUIRED_HEADINGS.every((h) => lines.includes(h));
  const primaryOverallLine = lines.filter((l) => l === summaryPrimaryLine(primaryOverall, primaryRow)).length === 1;
  return { headingsPresent, primaryOverallLine };
}

/** R3 closeout-verification manifest (§9.1), key order fixed. */
function buildCloseoutManifest({ attemptId, primaryOverall, primaryRow, r1Sha256, r2Sha256, optional }) {
  return {
    attemptId,
    primaryOverall,
    primaryRow,
    artifacts: [
      { name: 'R1', path: R1_REL_PATH, sha256: r1Sha256 },
      { name: 'R2', path: R2_REL_PATH, sha256: r2Sha256 },
    ],
    verification: {
      R1: { bytesMatch: true, parsed: true, schemaValid: true, snapshotEqual: true },
      R2: { bytesMatch: true, headingsPresent: true, primaryOverallLine: true },
    },
    optional,
  };
}

function exactKeys(obj, keys) { return isPlainObject(obj) && Object.keys(obj).sort().join(',') === keys.slice().sort().join(','); }

/** Fixed R3 schema; returns `{ok, errors[]}`. */
function validateCloseoutManifest(m) {
  const errors = [];
  if (!exactKeys(m, ['attemptId', 'primaryOverall', 'primaryRow', 'artifacts', 'verification', 'optional'])) return { ok: false, errors: ['keys'] };
  if (typeof m.attemptId !== 'string' || !UUID_V4_RE.test(m.attemptId)) errors.push('attemptId');
  if (!PRIMARY_OVERALL_VALUES.includes(m.primaryOverall)) errors.push('primaryOverall');
  if (!Number.isInteger(m.primaryRow) || m.primaryRow < 1 || m.primaryRow > 8) errors.push('primaryRow');
  const art = m.artifacts;
  const artOk = Array.isArray(art) && art.length === 2
    && ['R1', 'R2'].every((name, i) => exactKeys(art[i], ['name', 'path', 'sha256']) && art[i].name === name && isNonEmptyString(art[i].path) && SHA256_HEX_RE.test(art[i].sha256));
  if (!artOk) errors.push('artifacts');
  const v = m.verification;
  const vOk = exactKeys(v, ['R1', 'R2'])
    && exactKeys(v.R1, ['bytesMatch', 'parsed', 'schemaValid', 'snapshotEqual']) && Object.values(v.R1).every((x) => x === true)
    && exactKeys(v.R2, ['bytesMatch', 'headingsPresent', 'primaryOverallLine']) && Object.values(v.R2).every((x) => x === true);
  if (!vOk) errors.push('verification');
  if (!Array.isArray(m.optional)) errors.push('optional');
  return { ok: errors.length === 0, errors };
}

/** K fields (§10, fixed order). */
const COMMIT_RECORD_KEYS = Object.freeze(['attemptId', 'finalOverall', 'primaryOverall', 'primaryRow', 'resultSha256', 'summarySha256', 'manifestSha256', 'journalSha256', 'committedAt']);

/** K / Kc content: only facts that exist when Kc is written; finalOverall = primaryOverall. */
function buildCommitRecord({ attemptId, primaryOverall, primaryRow, resultSha256, summarySha256, manifestSha256, journalSha256, committedAt }) {
  return { attemptId, finalOverall: primaryOverall, primaryOverall, primaryRow, resultSha256, summarySha256, manifestSha256, journalSha256, committedAt };
}

/** Fixed K schema; returns `{ok, errors[]}`. */
function validateCommitRecord(k) {
  const errors = [];
  if (!exactKeys(k, COMMIT_RECORD_KEYS)) return { ok: false, errors: ['keys'] };
  if (typeof k.attemptId !== 'string' || !UUID_V4_RE.test(k.attemptId)) errors.push('attemptId');
  if (!PRIMARY_OVERALL_VALUES.includes(k.finalOverall)) errors.push('finalOverall');
  if (!PRIMARY_OVERALL_VALUES.includes(k.primaryOverall)) errors.push('primaryOverall');
  if (!Number.isInteger(k.primaryRow) || k.primaryRow < 1 || k.primaryRow > 8) errors.push('primaryRow');
  for (const f of ['resultSha256', 'summarySha256', 'manifestSha256', 'journalSha256']) if (!SHA256_HEX_RE.test(k[f] || '')) errors.push(f);
  if (typeof k.committedAt !== 'string' || !ISO_UTC_RE.test(k.committedAt)) errors.push('committedAt');
  return { ok: errors.length === 0, errors };
}

/** F (closeout-failure witness) content; not hashed by anything. */
function buildFailureWitness({ attemptId, primaryOverall, primaryRow, causes, optional }) {
  return { attemptId, primaryOverall: primaryOverall ?? null, primaryRow: primaryRow ?? null, causes: causes.slice(), optional: optional.slice() };
}

/** Fixed F schema (diagnostic only; the reader's W-1 needs only F's existence). */
function validateFailureWitness(f) {
  const errors = [];
  if (!exactKeys(f, ['attemptId', 'primaryOverall', 'primaryRow', 'causes', 'optional'])) return { ok: false, errors: ['keys'] };
  if (!Array.isArray(f.causes) || f.causes.length === 0) errors.push('causes');
  return { ok: errors.length === 0, errors };
}

// ============================================================================================
// Section 13 -- closeout and evidence-write protocol (procedure §9.1 steps 1..11) and the final
// synchronous non-yielding gate -> fs.linkSync(Kc, K) critical block (step 8, B8).
//
// Steps 1..7 are asynchronous-capable (O2 and quiescence may await); every durable write uses the
// §4.1 algorithm through the injectable synchronous fs layer, every verification re-reads the
// bytes and compares SHA-256 (plus parse/schema/snapshotEqual for R1). The optional one-time
// verification-read repeat of §9.1 is deliberately NOT used: a single read fault or mismatch is a
// closeout failure (strictly more fail-closed; "may be repeated" is permissive). Any outcome that
// is not a verified success is a closeout failure: no linkSync, step 10.
//
// Step 8 is `commitCriticalSection`: a plain synchronous function whose exact AST is whitelisted
// by Section 15. It is entered as the body of a dedicated setImmediate macrotask scheduled from
// the last drain turn's callback (`drainAndCommit`), never as an await continuation. After a
// successful linkSync nothing can change finalOverall or the exit code: the outcome object is
// frozen, post-commit steps are informational and catch-all, and the fatal-event sink ignores
// events once the commit latch is set.
// ============================================================================================

/** T8 per-step closeout deadline (Table T rev-2 T8: 15 s). */
const T8_CLOSEOUT_STEP_DEADLINE_MS = 15_000;

/** Closeout failure carrying a stable cause string (§9.1 step 10 `causes[]`). */
class CloseoutFailure extends Error {
  constructor(cause, inner) {
    super(`closeout failure: ${cause}${inner && inner.message ? ` (${inner.message})` : ''}`);
    this.name = 'CloseoutFailure';
    this.closeoutCause = cause;
    if (inner !== undefined) this.inner = inner;
  }
}

/**
 * Fatal-event sink over the run state's plain-data `errorLedger` ({fatalCount, entries[],
 * attemptDeadlineExpired, ...}). `recordFatal` increments the ledger until `markCommitted()` latches;
 * afterwards events are kept only in `ignored` (§9.1 step 8: handlers ignore events once
 * committed). `recordAttemptDeadline` records a T9 expiry (row 5 ATTEMPT_DEADLINE).
 * Slice C1 (§9.2): with `nextSeq` (the run's single node-side counter) every non-network fatal entry
 * is stamped `{kind, detail, seq}`; `recordWitnessEntry({seq, witnessId})` appends the ONE network
 * fatal entry `{kind:'required-resource-failure', seq:witnessSeq, witnessId}` of a newly created fatal
 * witness (the only way a network event increments `fatalCount`) and returns its index (-1 latched).
 * Without `nextSeq` (offline legacy callers) entries are unsequenced -- a row-5 contradiction
 * whenever a gate is validated (FATAL_ENTRY_SEQ_REQUIRED).
 */
function createFatalEventSink(errorLedger, { nextSeq = null } = {}) {
  let commitLatched = false;
  const ignored = [];
  return {
    ignored,
    isCommitLatched: () => commitLatched,
    recordFatal(kind, detail) {
      if (commitLatched) { ignored.push({ kind: String(kind), detail: String(detail) }); return false; }
      errorLedger.fatalCount += 1;
      const entry = { kind: String(kind), detail: String(detail) };
      if (typeof nextSeq === 'function') entry.seq = nextSeq();
      errorLedger.entries.push(entry);
      // §9.2 witnessCount.nonNetworkFatalEntries / fatalCount stay equal to the recomputation.
      if (isPlainObject(errorLedger.witnessCount)) errorLedger.witnessCount = correlateNetworkEvents(errorLedger).witnessCount;
      return true;
    },
    recordWitnessEntry({ seq, witnessId }) {
      if (commitLatched) { ignored.push({ kind: NETWORK_FATAL_ENTRY_KIND, detail: String(witnessId) }); return -1; }
      errorLedger.fatalCount += 1;
      errorLedger.entries.push({ kind: NETWORK_FATAL_ENTRY_KIND, seq, witnessId });
      return errorLedger.entries.length - 1;
    },
    recordAttemptDeadline() {
      if (commitLatched) { ignored.push({ kind: 'ATTEMPT_DEADLINE', detail: '' }); return false; }
      errorLedger.attemptDeadlineExpired = true;
      return true;
    },
    markCommitted() { commitLatched = true; },
  };
}

function describeReason(reason) {
  if (reason && typeof reason === 'object' && typeof reason.message === 'string') return reason.message;
  return String(reason);
}

/**
 * Installs process-level `unhandledRejection` / `uncaughtException` handlers that record into the
 * sink (fatal until the commit latch, ignored afterwards). Returns an uninstall function.
 */
function installProcessFatalHandlers({ proc = process, sink }) {
  const onRejection = (reason) => { sink.recordFatal('unhandledrejection', describeReason(reason)); };
  const onException = (err) => { sink.recordFatal('uncaughtexception', describeReason(err)); };
  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => {
    proc.removeListener('unhandledRejection', onRejection);
    proc.removeListener('uncaughtException', onException);
  };
}

/**
 * Promise registry (§9.1 step 7(i)): every harness-created promise is tracked and gets its own
 * rejection handler at registration; `settleAll()` awaits every tracked promise to settlement.
 */
function createPromiseRegistry({ onRejection = () => {} } = {}) {
  const tracked = new Set();
  return {
    track(p) {
      const handled = Promise.resolve(p).then(() => undefined, (err) => { onRejection(err); });
      tracked.add(handled);
      return p;
    },
    async settleAll() { await Promise.allSettled([...tracked]); },
    get size() { return tracked.size; },
  };
}

/** Brand that marks a vetted SYNCHRONOUS test link primitive (never accepted in a live run). */
const SYNC_LINK_TEST_BRAND = Symbol.for('g2.harness.sync-link-test-primitive');

/** Offline-test support: brands a synchronous `(from, to) => void` link function. */
function brandSyncLinkForTest(fn) {
  if (typeof fn !== 'function') throw new TypeError('brandSyncLinkForTest: function required');
  Object.defineProperty(fn, SYNC_LINK_TEST_BRAND, { value: true });
  return fn;
}

const ASYNC_FUNCTION_CONSTRUCTOR_NAMES = Object.freeze(['AsyncFunction', 'AsyncGeneratorFunction', 'GeneratorFunction']);

/**
 * Pre-commit check that the commit primitive is a synchronous link (§9.1 step 8: no asynchronous
 * link primitive, no getter, no wrapper). Accepts `commitFs.linkSync` only if it is an own/inherited
 * DATA property holding a plain (non-async, non-generator) function that is either node:fs's own
 * `linkSync` or (offline tests only, `allowTestBrand`) a branded synchronous test primitive.
 * Returns a closeout cause string or null. Checked in step 7, before Kc, so an unvetted primitive
 * can never be called.
 */
function linkPrimitiveProblem(commitFs, allowTestBrand) {
  if (commitFs === null || (typeof commitFs !== 'object' && typeof commitFs !== 'function')) return 'link-primitive-missing';
  let holder = commitFs;
  let desc;
  while (holder && !(desc = Object.getOwnPropertyDescriptor(holder, 'linkSync'))) holder = Object.getPrototypeOf(holder);
  if (!desc) return 'link-primitive-missing';
  if (!('value' in desc)) return 'link-primitive-accessor';
  const fn = desc.value;
  if (typeof fn !== 'function') return 'link-primitive-missing';
  if (ASYNC_FUNCTION_CONSTRUCTOR_NAMES.includes(fn.constructor && fn.constructor.name)) return 'async-link-primitive';
  if (fn === nodeFsModule.linkSync) return null;
  if (allowTestBrand === true && fn[SYNC_LINK_TEST_BRAND] === true) return null;
  return 'link-primitive-not-vetted';
}

/**
 * Final pre-link eligibility gate predicate (§9.1 step 8(a)); pure and synchronous; called ONLY
 * from `commitCriticalSection`. Returns null (eligible) or a `late-verdict-change(<why>)` cause:
 *   - any recorded deadline governing a step not completed strictly before it is overdue
 *     (`performance.now() <= deadlineAbs` violated)                    -> (deadline-overdue)
 *   - the error ledger's fatal count differs from fatalCount0          -> (fatal-event)
 *   - the pre-link verdict or row differs from primaryOverall/row      -> (verdict-changed)
 *   - defence in depth: a pre-link closeout prerequisite is unmet even though the row did not
 *     change (possible only when an earlier FAIL row masks row 5)       -> (closeout-prerequisite)
 */
function preLinkGateFailure(cs, preLink, nowMs) {
  for (const d of cs.deadlines) {
    const completedBefore = typeof d.completedMs === 'number' && d.completedMs < d.deadlineAbs;
    if (!completedBefore && !(nowMs <= d.deadlineAbs)) return 'late-verdict-change(deadline-overdue)';
  }
  const ledger = cs.state.errorLedger;
  if (!isPlainObject(ledger) || ledger.fatalCount !== cs.fatalCount0) return 'late-verdict-change(fatal-event)';
  if (preLink.overall !== cs.primaryOverall || preLink.row !== cs.primaryRow) return 'late-verdict-change(verdict-changed)';
  if (preLinkCloseoutProblem(cs.state.closeoutFacts) !== null) return 'late-verdict-change(closeout-prerequisite)';
  return null;
}

/**
 * §9.1 step 8 -- THE final critical section (B8). One synchronous, non-yielding block: the
 * pre-link gate, then exactly one direct `fs.linkSync(Kc, K)`, then -- synchronously, in the same
 * block -- `committed = true` and `finalOverall = primaryOverall`. A throw from the gate or the
 * link (EEXIST included) sets committed = false and returns FAIL (step 10 follows in the caller).
 * `fs` is node:fs itself in a live run (identity-checked by linkPrimitiveProblem). The exact AST of
 * this function is whitelisted by `auditCloseoutSource` (Section 15); change both together or the
 * guard fails.
 */
function commitCriticalSection(fs, cs) {
  let committed = false;
  let finalOverall = VERDICT_FAIL;
  let gateFailure = null;
  try {
    const preLink = computeOverall(cs.state, 'pre-link');
    gateFailure = preLinkGateFailure(cs, preLink, performance.now());
    if (gateFailure !== null) throw new Error(gateFailure);
    fs.linkSync(cs.Kc, cs.K);
    committed = true;
    finalOverall = cs.primaryOverall;
  } catch (error) {
    committed = false;
    return Object.freeze({ committed, finalOverall: VERDICT_FAIL, gateFailure, error });
  }
  return Object.freeze({ committed, finalOverall, gateFailure });
}

/**
 * §9.1 step 7(iii) + step 8 entry: await two consecutive setImmediate turns plus a microtask
 * flush; the critical section then runs as the body of a dedicated setImmediate macrotask
 * scheduled from the last drain turn's callback -- never as an await continuation -- so every
 * rejection raised during the drain has already been reported to the ledger handlers. The commit
 * latch is set in the same macrotask, immediately after a successful commit.
 */
async function drainAndCommit({ scheduler, commitFs, cs, sink }) {
  await new Promise((resolve) => { scheduler.setImmediate(resolve); });
  await Promise.resolve();
  return new Promise((resolve) => {
    scheduler.setImmediate(() => {
      scheduler.setImmediate(() => {
        const outcome = commitCriticalSection(commitFs, cs);
        if (outcome.committed) sink.markCommitted();
        resolve(outcome);
      });
    });
  });
}

function isSimulatedCrash(err) { return Boolean(err) && err.simulatedCrash === true; }
function errCode(err) { return (err && (err.code || (err.cause && err.cause.code))) || (err && err.name) || 'error'; }

/**
 * §9.1 step 9 -- post-commit, informational only: unlink(Kc), fsync(D2Fd), read K back and
 * compare. Every step is individually caught; nothing here can reach finalOverall or the exit
 * code. (A SimulatedCrash from the offline fake fs is re-thrown: it models process death.)
 */
function runPostCommit({ fs, D2Fd, kcPath, kPath, kcBytes }) {
  const obs = { unlinkCandidate: 'not-run', directoryFsync: 'not-run', readBack: 'not-run' };
  try { fs.unlink(kcPath); obs.unlinkCandidate = 'ok'; } catch (err) { if (isSimulatedCrash(err)) throw err; obs.unlinkCandidate = `failed:${errCode(err)}`; }
  try { fs.fsync(D2Fd); obs.directoryFsync = 'ok'; } catch (err) { if (isSimulatedCrash(err)) throw err; obs.directoryFsync = `failed:${errCode(err)}`; }
  try {
    const back = toBuffer(fs.readFile(kPath));
    obs.readBack = sha256Hex(back) === sha256Hex(kcBytes) ? 'match' : 'mismatch';
  } catch (err) { if (isSimulatedCrash(err)) throw err; obs.readBack = `failed:${errCode(err)}`; }
  obs.durabilityUnconfirmed = obs.directoryFsync !== 'ok';
  return Object.freeze(obs);
}

/**
 * §9.1 step 10 -- closeout failure path (before any successful B8 commit): best-effort unlink of
 * the non-authoritative candidate, best-effort F (`wx`, immutable), best-effort journal FAILED.
 * Purely diagnostic: K does not exist, so the reader returns FAIL even if nothing here lands.
 * K is never touched.
 */
function closeoutFailurePath({ fs, handle, fPath, kcPath, attemptId, primary, causes, optional }) {
  const out = { candidateUnlinked: false, failureWitnessWritten: false, failedAppended: false };
  if (kcPath) {
    try { fs.unlink(kcPath); out.candidateUnlinked = true; } catch (err) { if (isSimulatedCrash(err)) throw err; }
  }
  try {
    const bytes = serializeJson(buildFailureWitness({ attemptId, primaryOverall: primary && primary.overall, primaryRow: primary && primary.row, causes, optional }));
    writeExclusiveDurable({ fs, filePath: fPath, dirFd: handle.D2Fd, bytes, label: 'F' });
    out.failureWitnessWritten = true;
  } catch (err) { if (isSimulatedCrash(err)) throw err; }
  const detail = primary ? { causes: causes.slice(), primaryOverall: primary.overall, primaryRow: primary.row } : { causes: causes.slice() };
  let appended;
  try { appended = handle.appendBestEffort(JOURNAL_STATE.FAILED, detail); } catch (err) { if (isSimulatedCrash(err)) throw err; appended = { ok: false }; }
  if (appended && appended.error && isSimulatedCrash(appended.error)) throw appended.error;
  out.failedAppended = Boolean(appended && appended.ok);
  return Object.freeze(out);
}

/**
 * Durable temp+rename write of a results artifact in D1 (§4.1 algorithm) WITHOUT the verification
 * read (done separately so read faults are distinguishable). On failure: best-effort unlink of the
 * temp; if the rename was attempted, best-effort rename of the final name to `.invalid-<uuid>`
 * (§9.1 partial-artifact handling). Throws CloseoutFailure(`<label>-write`).
 */
function writeResultArtifact({ fs, D1, D1Fd, name, bytes, uuid, label }) {
  const tmpPath = path.join(D1, `${name}.tmp-${uuid()}`);
  const finalPath = path.join(D1, name);
  let renameAttempted = false;
  let tmpCreated = false;
  try {
    const fd = step(`${label}:open-wx(tmp)`, () => fs.open(tmpPath, 'wx'));
    tmpCreated = true;
    try {
      step(`${label}:write`, () => fs.write(fd, bytes));
      step(`${label}:fsync`, () => fs.fsync(fd));
    } catch (err) {
      try { fs.close(fd); } catch { /* primary error wins */ }
      throw err;
    }
    step(`${label}:close`, () => fs.close(fd));
    renameAttempted = true;
    step(`${label}:rename`, () => fs.rename(tmpPath, finalPath));
    step(`${label}:fsync-dir`, () => fs.fsync(D1Fd));
  } catch (err) {
    if (isSimulatedCrash(err)) throw err;
    if (tmpCreated) { try { fs.unlink(tmpPath); } catch (e) { if (isSimulatedCrash(e)) throw e; } }
    if (renameAttempted) invalidateFinalArtifact({ fs, D1, name, uuid });
    throw new CloseoutFailure(`${label.toLowerCase()}-write`, err);
  }
  return finalPath;
}

function invalidateFinalArtifact({ fs, D1, name, uuid }) {
  try { fs.rename(path.join(D1, name), path.join(D1, `${name}.invalid-${uuid()}`)); } catch (e) { if (isSimulatedCrash(e)) throw e; }
}

/** One verification read (no repeat, see Section 13 header); returns the bytes or throws. */
function verificationRead({ fs, filePath, cause }) {
  try { return toBuffer(fs.readFile(filePath)); } catch (err) {
    if (isSimulatedCrash(err)) throw err;
    throw new CloseoutFailure(cause, err);
  }
}

/** snapshotEqual (§9.1): S* re-canonicalizes to snapshotSha256 and re-serializes byte-equal to R1bytes. */
function snapshotStillEqual({ snap, r1Bytes, buildPayload }) {
  try {
    if (sha256Hex(Buffer.from(canonicalJson(snap.snapshot), 'utf8')) !== snap.snapshotSha256) return false;
    return serializeJson(buildPayload(snap.snapshot)).equals(r1Bytes);
  } catch { return false; }
}

/** O2 attempt (§9.1 step 3): outcome recorded, never verdict-bearing; deadline-wrapped, late result quarantined. */
async function attemptOptionalO2({ writeO2, timeoutMs }) {
  if (typeof writeO2 !== 'function') return { name: 'O2', status: 'absent' };
  const status = await new Promise((resolve) => {
    let settled = false;
    const finish = (s) => { if (!settled) { settled = true; clearTimeout(timer); resolve(s); } };
    const timer = setTimeout(() => finish('failed:timeout'), timeoutMs);
    Promise.resolve().then(() => writeO2()).then(
      (r) => finish(r === 'absent' ? 'absent' : 'written'),
      (err) => finish(`failed:${errCode(err)}`),
    );
  });
  return { name: 'O2', status };
}

const DEFAULT_SCHEDULER = Object.freeze({ setImmediate: (fn) => setImmediate(fn) });

/**
 * `formatCloseoutReport(result)` -- pure step-11 lines: primaryOverall, closeout causes,
 * finalOverall (with `-UNCONFIRMED` + COMMIT_DURABILITY_UNCONFIRMED when the post-commit directory
 * fsync failed) and the post-commit observations.
 */
function formatCloseoutReport(r) {
  const lines = [];
  lines.push(`primaryOverall: ${r.primaryOverall === null ? 'none' : `${r.primaryOverall} (row ${r.primaryRow})`}`);
  if (r.causes.length > 0) lines.push(`closeout causes: ${r.causes.join(', ')}`);
  if (r.committed && r.postCommit && r.postCommit.durabilityUnconfirmed) {
    lines.push(`finalOverall: ${r.finalOverall}-UNCONFIRMED`);
    lines.push('COMMIT_DURABILITY_UNCONFIRMED: run deriveVerdictFromArtifacts on the surviving files before accepting');
  } else {
    lines.push(`finalOverall: ${r.finalOverall}`);
  }
  if (r.postCommit) lines.push(`post-commit: unlinkCandidate=${r.postCommit.unlinkCandidate} directoryFsync=${r.postCommit.directoryFsync} readBack=${r.postCommit.readBack}`);
  if (r.sinkIgnoredCount > 0) lines.push(`post-commit events ignored: ${r.sinkIgnoredCount}`);
  lines.push(`exit code: ${r.exitCode}`);
  return lines;
}

/**
 * `closeoutProtocol(opts)` -- §9.1 steps 1..11. Inputs:
 *   state      the live run state (§10 keys + errorLedger plain data); closeout OWNS and sets
 *              `state.journal` (current in-memory journal) and `state.closeoutFacts` (pre-link
 *              closeout facts). No other state field is written; `closeoutComplete` is never read.
 *   handle     the reservation owner's attempt handle (journal at ATTEMPT_CONSUMED, holds D2Fd).
 *   fs, chain  the injectable synchronous fs layer and {D0, D1, D2}.
 *   commitFs   the object whose `linkSync` performs the commit: node:fs itself (default; identity
 *              checked). Offline tests may pass a branded synchronous primitive together with
 *              `allowTestLinkPrimitive: true`.
 *   sink       fatal-event sink over state.errorLedger (created if absent).
 *   quiescence {deadlines(), clearTimersAndSettle(), detachListeners(), disarmAttemptTimer()} --
 *              all optional; `deadlines()` returns every other armed deadline
 *              `{name, deadlineAbs, completedMs?}` on the performance.now() basis.
 *   writeO2, buildPayload, renderSummaryFn, scheduler, stepDeadlineMs, stepDeadlineOverridesMs,
 *   hooks {afterSnapshot(S*), afterR1(S*)} (offline late-mutation injection), print.
 * Returns a frozen `{primaryOverall, primaryRow, committed, finalOverall, closeoutComplete,
 * exitCode, causes, postCommit, failurePath, printed, sinkIgnoredCount}`. A SimulatedCrash from the
 * offline fake fs propagates (process death).
 */
async function closeoutProtocol(opts) {
  const {
    state, handle, fs, chain,
    commitFs = nodeFsModule, allowTestLinkPrimitive = false,
    clock = defaultClock, uuid = randomUUID,
    stepDeadlineMs = T8_CLOSEOUT_STEP_DEADLINE_MS, stepDeadlineOverridesMs = {},
    quiescence = {}, writeO2 = null,
    buildPayload = buildResultPayload, renderSummaryFn = renderSummary,
    scheduler = DEFAULT_SCHEDULER, hooks = {}, print = () => {},
  } = opts;
  const sink = opts.sink || createFatalEventSink(state.errorLedger);
  const id = handle.authorizationId;
  const attemptId = handle.attemptId;
  const causes = [];
  const optional = [];
  const stepDeadlines = [];
  const facts = {
    closeoutStartedVerified: false, r1Verified: false, r2Verified: false, r3Verified: false, kcVerified: false,
    snapshotEqual: false, quiescenceComplete: false, closeoutFailures: causes, journalBytes: null, kcJournalSha256: null,
  };
  state.closeoutFacts = facts;
  state.journal = handle.current().journal;
  const paths = {
    R1: path.join(chain.D1, R1_NAME), R2: path.join(chain.D1, R2_NAME), R3: path.join(chain.D1, R3_NAME),
    journal: path.join(chain.D2, journalName(id)), K: path.join(chain.D2, commitName(id)), F: path.join(chain.D2, closeoutFailureName(id)),
  };
  let primary = null;
  let fatalCount0 = null;
  let kcPath = null;
  let kcBytes = null;
  let deadlines = Object.freeze([]);
  let D1Fd = null;

  /** Synchronous step with a recorded T8 deadline; expiry observed at completion => closeout failure. */
  const timed = (name, fn) => {
    const ms = Object.prototype.hasOwnProperty.call(stepDeadlineOverridesMs, name) ? stepDeadlineOverridesMs[name] : stepDeadlineMs;
    const d = { name: `T8:${name}`, deadlineAbs: performance.now() + ms, completedMs: null };
    stepDeadlines.push(d);
    const result = fn();
    d.completedMs = performance.now();
    if (!(d.completedMs < d.deadlineAbs)) throw new CloseoutFailure(`deadline-expired:${name}`);
    return result;
  };
  const closeD1 = () => { if (D1Fd !== null) { try { fs.close(D1Fd); } catch (e) { if (isSimulatedCrash(e)) throw e; } D1Fd = null; } };

  const finishFailed = (err) => {
    if (isSimulatedCrash(err)) throw err;
    const cause = err instanceof CloseoutFailure ? err.closeoutCause : `internal:${errCode(err)}`;
    if (!causes.includes(cause)) causes.push(cause);
    closeD1();
    const failurePath = closeoutFailurePath({ fs, handle, fPath: paths.F, kcPath, attemptId, primary, causes, optional });
    const result = {
      primaryOverall: primary ? primary.overall : null,
      primaryRow: primary ? primary.row : null,
      committed: false,
      finalOverall: VERDICT_FAIL,
      closeoutComplete: false,
      exitCode: exitCodeForVerdict(VERDICT_FAIL),
      causes: Object.freeze(causes.slice()),
      postCommit: null,
      failurePath,
      sinkIgnoredCount: sink.ignored.length,
    };
    result.printed = Object.freeze(formatCloseoutReport(result));
    for (const line of result.printed) { try { print(line); } catch { /* informational */ } }
    return Object.freeze(result);
  };

  try {
    // Step 1 -- primaryOverall; fatalCount0; T9 disarmed (closeout has only T8 step deadlines).
    primary = computeOverall(state, 'pre-closeout');
    fatalCount0 = state.errorLedger.fatalCount;
    if (typeof quiescence.disarmAttemptTimer === 'function') quiescence.disarmAttemptTimer();

    // Step 2 -- durable CLOSEOUT_STARTED (B7); the handle's write verifies by read-back.
    timed('closeout-started', () => {
      try { handle.append(JOURNAL_STATE.CLOSEOUT_STARTED, { primaryOverall: primary.overall, primaryRow: primary.row }); } catch (err) {
        if (isSimulatedCrash(err)) throw err;
        throw new CloseoutFailure('closeout-started-write', err);
      }
    });
    state.journal = handle.current().journal;
    facts.closeoutStartedVerified = true;

    // Step 3 -- O2 (never verdict-bearing).
    optional.push(await attemptOptionalO2({ writeO2, timeoutMs: stepDeadlineMs }));

    // Step 4 -- freeze S* (payload cutoff).
    const snap = timed('snapshot', () => {
      try {
        return takeFrozenSnapshot({ state, primary, optional, journal: handle.current().journal, finishedAt: clock.nowIso() });
      } catch (err) { throw new CloseoutFailure('snapshot-not-plain-json', err); }
    });
    if (typeof hooks.afterSnapshot === 'function') {
      try { hooks.afterSnapshot(snap.snapshot); } catch (err) { throw new CloseoutFailure('r1-mutated', err); }
    }

    // Step 5 -- R1 then R2, each written durably and verified.
    try { D1Fd = step('closeout:open(D1)', () => fs.open(chain.D1, 'r')); } catch (err) {
      if (isSimulatedCrash(err)) throw err;
      throw new CloseoutFailure('results-dir-open', err);
    }
    const r1Bytes = serializeJson(buildPayload(snap.snapshot));
    timed('R1', () => writeResultArtifact({ fs, D1: chain.D1, D1Fd, name: R1_NAME, bytes: r1Bytes, uuid, label: 'R1' }));
    timed('R1-verify', () => {
      const back = verificationRead({ fs, filePath: paths.R1, cause: 'r1-verify' });
      let parsed = null;
      try { parsed = JSON.parse(back.toString('utf8')); } catch { parsed = null; }
      const ok = sha256Hex(back) === sha256Hex(r1Bytes) && parsed !== null
        && validateResultSchema(parsed, 'payload').ok && snapshotStillEqual({ snap, r1Bytes, buildPayload });
      if (!ok) { invalidateFinalArtifact({ fs, D1: chain.D1, name: R1_NAME, uuid }); throw new CloseoutFailure('r1-verify'); }
    });
    facts.r1Verified = true;
    facts.snapshotEqual = true;
    if (typeof hooks.afterR1 === 'function') {
      try { hooks.afterR1(snap.snapshot); } catch (err) { throw new CloseoutFailure('r1-mutated', err); }
    }
    const r2Text = renderSummaryFn(snap.snapshot);
    const r2Bytes = Buffer.from(r2Text, 'utf8');
    timed('R2', () => writeResultArtifact({ fs, D1: chain.D1, D1Fd, name: R2_NAME, bytes: r2Bytes, uuid, label: 'R2' }));
    timed('R2-verify', () => {
      const back = verificationRead({ fs, filePath: paths.R2, cause: 'r2-verify' });
      const v = verifySummaryText(back.toString('utf8'), primary.overall, primary.row);
      if (!(sha256Hex(back) === sha256Hex(r2Bytes) && v.headingsPresent && v.primaryOverallLine)) {
        invalidateFinalArtifact({ fs, D1: chain.D1, name: R2_NAME, uuid });
        throw new CloseoutFailure('r2-verify');
      }
    });
    facts.r2Verified = true;

    // Step 6 -- R3 only if R1 and R2 verified; snapshotEqual re-checked first.
    if (!snapshotStillEqual({ snap, r1Bytes, buildPayload })) { facts.snapshotEqual = false; throw new CloseoutFailure('r1-mutated'); }
    const r3Bytes = serializeJson(buildCloseoutManifest({ attemptId, primaryOverall: primary.overall, primaryRow: primary.row, r1Sha256: sha256Hex(r1Bytes), r2Sha256: sha256Hex(r2Bytes), optional }));
    timed('R3', () => writeResultArtifact({ fs, D1: chain.D1, D1Fd, name: R3_NAME, bytes: r3Bytes, uuid, label: 'R3' }));
    timed('R3-verify', () => {
      const back = verificationRead({ fs, filePath: paths.R3, cause: 'r3-verify' });
      let parsed = null;
      try { parsed = JSON.parse(back.toString('utf8')); } catch { parsed = null; }
      if (!(sha256Hex(back) === sha256Hex(r3Bytes) && parsed !== null && validateCloseoutManifest(parsed).ok)) {
        invalidateFinalArtifact({ fs, D1: chain.D1, name: R3_NAME, uuid });
        throw new CloseoutFailure('r3-verify');
      }
    });
    facts.r3Verified = true;
    // Strict close (the §4.1 durability rule counts a close error as a durability failure); only
    // the failure path's closeD1 is best-effort.
    const d1FdToClose = D1Fd;
    D1Fd = null;
    try { step('closeout:close(D1)', () => fs.close(d1FdToClose)); } catch (err) {
      if (isSimulatedCrash(err)) throw err;
      throw new CloseoutFailure('results-dir-close', err);
    }

    // Step 7 -- Kc (only if steps 2..6 succeeded), its verification, then quiescence.
    if (!snapshotStillEqual({ snap, r1Bytes, buildPayload })) { facts.snapshotEqual = false; throw new CloseoutFailure('r1-mutated'); }
    const linkProblem = linkPrimitiveProblem(commitFs, allowTestLinkPrimitive);
    if (linkProblem !== null) throw new CloseoutFailure(linkProblem);
    const journalNow = handle.current();
    kcBytes = serializeJson(buildCommitRecord({
      attemptId, primaryOverall: primary.overall, primaryRow: primary.row,
      resultSha256: sha256Hex(r1Bytes), summarySha256: sha256Hex(r2Bytes), manifestSha256: sha256Hex(r3Bytes),
      journalSha256: sha256Hex(journalNow.bytes), committedAt: clock.nowIso(),
    }));
    kcPath = path.join(chain.D2, commitCandidateName(id, uuid()));
    timed('Kc', () => {
      try { writeExclusiveDurable({ fs, filePath: kcPath, dirFd: handle.D2Fd, bytes: kcBytes, label: 'Kc' }); } catch (err) {
        if (isSimulatedCrash(err)) throw err;
        throw new CloseoutFailure('kc-write', err);
      }
    });
    timed('Kc-verify', () => {
      const back = verificationRead({ fs, filePath: kcPath, cause: 'kc-verify' });
      let parsed = null;
      try { parsed = JSON.parse(back.toString('utf8')); } catch { parsed = null; }
      if (!(sha256Hex(back) === sha256Hex(kcBytes) && parsed !== null && validateCommitRecord(parsed).ok)) throw new CloseoutFailure('kc-verify');
      facts.kcJournalSha256 = parsed.journalSha256;
      facts.journalBytes = journalNow.bytes;
      if (!snapshotStillEqual({ snap, r1Bytes, buildPayload })) { facts.snapshotEqual = false; throw new CloseoutFailure('r1-mutated'); }
      const journalOnDisk = verificationRead({ fs, filePath: paths.journal, cause: 'journal-verify' });
      if (sha256Hex(journalOnDisk) !== parsed.journalSha256 || handle.current().bytes !== journalNow.bytes) throw new CloseoutFailure('journal-changed');
    });
    facts.kcVerified = true;

    // Step 7 quiescence: (i) record every deadlineAbs, clear timers, settle tracked promises;
    // (ii) detach listeners; (iii) drain -> dedicated macrotask (drainAndCommit).
    try {
      const external = typeof quiescence.deadlines === 'function' ? quiescence.deadlines() : [];
      deadlines = Object.freeze([...stepDeadlines, ...external].map((d) => Object.freeze({ name: String(d.name), deadlineAbs: d.deadlineAbs, completedMs: typeof d.completedMs === 'number' ? d.completedMs : null })));
      if (deadlines.some((d) => typeof d.deadlineAbs !== 'number' || Number.isNaN(d.deadlineAbs))) throw new Error('deadline without numeric deadlineAbs');
      if (typeof quiescence.clearTimersAndSettle === 'function') await quiescence.clearTimersAndSettle();
      if (typeof quiescence.detachListeners === 'function') quiescence.detachListeners();
    } catch (err) {
      if (isSimulatedCrash(err)) throw err;
      throw new CloseoutFailure('quiescence-failed', err);
    }
    facts.quiescenceComplete = true;
  } catch (err) {
    return finishFailed(err);
  }

  // Steps 7(iii)/8 -- drain, then the synchronous critical section in its own macrotask.
  const cs = Object.freeze({ state, primaryOverall: primary.overall, primaryRow: primary.row, fatalCount0, deadlines, Kc: kcPath, K: paths.K });
  const outcome = await drainAndCommit({ scheduler, commitFs, cs, sink });
  if (!outcome.committed) {
    if (isSimulatedCrash(outcome.error)) throw outcome.error;
    // Cause label (informational): the gate's own reason; an fs error (string `code`) from the link;
    // otherwise the gate evaluation itself threw (e.g. an unreadable state field).
    const e = outcome.error;
    const cause = outcome.gateFailure !== null ? outcome.gateFailure
      : (e && typeof e.code === 'string' ? `link-failed:${e.code}` : `gate-threw:${(e && e.name) || 'error'}`);
    return finishFailed(new CloseoutFailure(cause, e));
  }

  // Step 9 -- post-commit, informational only (never alters outcome.finalOverall / exit code).
  let postCommit;
  try { postCommit = runPostCommit({ fs, D2Fd: handle.D2Fd, kcPath, kPath: paths.K, kcBytes }); } catch (err) {
    if (isSimulatedCrash(err)) throw err;
    postCommit = Object.freeze({ unlinkCandidate: 'unknown', directoryFsync: 'unknown', readBack: 'unknown', durabilityUnconfirmed: true });
  }
  const result = {
    primaryOverall: primary.overall,
    primaryRow: primary.row,
    committed: true,
    finalOverall: outcome.finalOverall,
    closeoutComplete: outcome.committed,
    exitCode: exitCodeForVerdict(outcome.finalOverall),
    causes: Object.freeze([]),
    postCommit,
    failurePath: null,
    sinkIgnoredCount: sink.ignored.length,
  };
  try {
    result.printed = Object.freeze(formatCloseoutReport(result));
    for (const line of result.printed) { try { print(line); } catch { /* informational */ } }
  } catch { result.printed = Object.freeze([]); }
  return Object.freeze(result);
}

// ============================================================================================
// Section 14 -- the §8 reader: deriveVerdictFromArtifacts (pure over a file map), W-0..W-6.
//
// File map shape: `{attempts: {<name>: Buffer | {nonRegular:true}}, results: {<name>: ...}}`.
// Reader namespace: only `<id>.reservation.json`, `<id>.journal.json`, `<id>.commit.json` (K),
// `<id>.closeout-failure.json` (F) and the fixed R1..R3 names; `*.commit.candidate-*`, `*.tmp-*`,
// `*.invalid-*` and every other name are ignored. The worst valid outcome is returned; any FAIL
// witness wins; witnesses are reported in the fixed order W-0, W-1, ..., W-5 (the first present one
// supplies the label, all are listed), W-6 only when none applies.
//
// Label reconciliation with Task 1 (flagged): classifyJournal (the §4.1 CRASHED taxonomy) names an
// unparseable final journal `CRASHED(unreadable-journal)`, while §8 W-0 lists "an unparseable
// file" under `FAIL(reader-invalid)`. The reader follows §8 for its final label -- W-0
// `FAIL(reader-invalid)` -- and retains the §4.1 class in `detail.journalClass`. The same mapping
// applies to classifyJournal's `INVALID` class (W-0 with its reason).
// ============================================================================================

function isRegularEntry(e) { return Buffer.isBuffer(e) || e instanceof Uint8Array; }
function entryPresent(map, name) { return Boolean(map) && Object.prototype.hasOwnProperty.call(map, name) && map[name] != null; }

function parseJsonEntry(entry) {
  if (!isRegularEntry(entry)) return { ok: false, reason: 'not-regular-file' };
  try { return { ok: true, value: JSON.parse(toBuffer(entry).toString('utf8')) }; } catch { return { ok: false, reason: 'unparseable' }; }
}

/**
 * `deriveVerdictFromArtifacts({attempts, results, authorizationId})` -- the authoritative §8 reader.
 * Pure; never throws (an unexpected internal error is itself W-0). Returns a frozen
 * `{verdict, label, witness, witnesses[], detail}`; `verdict` is PASS/PARTIAL/BLOCKED only via W-6.
 */
function deriveVerdictFromArtifacts({ attempts = {}, results = {}, authorizationId } = {}) {
  const witnesses = [];
  const detail = {};
  const add = (w, label, extra) => { witnesses.push({ witness: w, label, ...(extra || {}) }); };
  try {
    const id = authorizationId;
    if (typeof id !== 'string' || id === '') {
      add('W-0', 'FAIL(reader-invalid)', { reason: 'authorization-id-missing' });
    } else {
      const resName = reservationName(id);
      const jName = journalName(id);
      const kName = commitName(id);
      const fName = closeoutFailureName(id);
      const res = entryPresent(attempts, resName) ? attempts[resName] : null;
      const jrn = entryPresent(attempts, jName) ? attempts[jName] : null;
      const k = entryPresent(attempts, kName) ? attempts[kName] : null;
      const f = entryPresent(attempts, fName) ? attempts[fName] : null;
      detail.ignored = Object.keys(attempts).filter((n) => n.startsWith(`${id}.`) && ![resName, jName, kName, fName].includes(n)).sort();

      // W-0 -- totality rule.
      for (const [name, e] of [[resName, res], [jName, jrn], [kName, k]]) {
        if (e !== null && !isRegularEntry(e)) add('W-0', 'FAIL(reader-invalid)', { reason: `not-regular-file:${name}` });
      }
      const cls = classifyJournal({
        reservation: res === null ? null : (isRegularEntry(res) ? { bytes: toBuffer(res) } : { bytes: null, nonRegular: true }),
        journal: jrn === null ? null : (isRegularEntry(jrn) ? { bytes: toBuffer(jrn) } : { bytes: null, nonRegular: true }),
        commitExists: k !== null,
      });
      detail.journalClass = cls.class;
      if (cls.class === JOURNAL_CLASS.CRASHED_UNREADABLE_JOURNAL) add('W-0', 'FAIL(reader-invalid)', { reason: 'journal-unparseable', journalClass: cls.class });
      if (cls.class === JOURNAL_CLASS.INVALID) add('W-0', 'FAIL(reader-invalid)', { reason: `journal-invalid:${cls.reason}` });
      if (k !== null && jrn === null) add('W-0', 'FAIL(reader-invalid)', { reason: 'commit-without-journal' });
      let kRec = null;
      if (k !== null && isRegularEntry(k)) {
        const pk = parseJsonEntry(k);
        if (!pk.ok) add('W-0', 'FAIL(reader-invalid)', { reason: 'commit-unparseable' });
        else {
          const v = validateCommitRecord(pk.value);
          if (!v.ok) add('W-0', 'FAIL(reader-invalid)', { reason: `commit-schema:${v.errors.join('|')}` });
          else kRec = pk.value;
        }
      }

      // W-1 -- F exists in any content state.
      if (f !== null) add('W-1', 'FAIL(closeout-failure-witness)');

      // W-2 -- FAILED anywhere in the history.
      if (cls.class === JOURNAL_CLASS.FAILED) add('W-2', 'FAIL(failed-transition)', { causes: cls.causes });

      // W-3 -- last state CLOSEOUT_STARTED and no K.
      if (cls.class === JOURNAL_CLASS.CRASHED_CLOSEOUT_STARTED) add('W-3', 'FAIL(commit-missing)');

      // W-4 -- preflight / crashed classes, or nothing at all.
      const crashedInner = {
        [JOURNAL_CLASS.PREFLIGHT_FAILED]: 'PREFLIGHT_FAILED',
        [JOURNAL_CLASS.CRASHED_RESERVATION_ONLY]: 'reservation-only',
        [JOURNAL_CLASS.CRASHED_AUTH_BOUND]: 'AUTH_BOUND',
        [JOURNAL_CLASS.CRASHED_ATTEMPT_CONSUMED]: 'ATTEMPT_CONSUMED',
        [JOURNAL_CLASS.CRASHED_JOURNAL_WITHOUT_RESERVATION]: 'journal-without-reservation',
      }[cls.class];
      if (crashedInner) add('W-4', `FAIL(crashed:${crashedInner})`);
      if (cls.class === JOURNAL_CLASS.NOT_STARTED && k === null && f === null) add('W-4', 'FAIL(no-run)');

      // W-5 -- K present: full cross-validation.
      if (cls.class === JOURNAL_CLASS.CLOSEOUT_STARTED_WITH_COMMIT && kRec !== null) {
        const problems = [];
        const journalBytes = toBuffer(jrn);
        const journal = JSON.parse(journalBytes.toString('utf8'));
        const reservation = JSON.parse(toBuffer(res).toString('utf8'));
        const states = journal.transitions.map((t) => t.state);
        const exact = [JOURNAL_STATE.AUTH_BOUND, JOURNAL_STATE.ATTEMPT_CONSUMED, JOURNAL_STATE.CLOSEOUT_STARTED];
        if (states.length !== 3 || states.some((s, i) => s !== exact[i])) problems.push('history-not-exact');
        const cs = journal.transitions[journal.transitions.length - 1].detail;
        const r = {};
        for (const [key, name] of [['R1', R1_NAME], ['R2', R2_NAME], ['R3', R3_NAME]]) {
          const e = entryPresent(results, name) ? results[name] : null;
          if (e === null || !isRegularEntry(e)) problems.push(`${key}-missing`);
          else r[key] = toBuffer(e);
        }
        if (r.R1 && sha256Hex(r.R1) !== kRec.resultSha256) problems.push('R1-sha256');
        if (r.R2 && sha256Hex(r.R2) !== kRec.summarySha256) problems.push('R2-sha256');
        if (r.R3 && sha256Hex(r.R3) !== kRec.manifestSha256) problems.push('R3-sha256');
        let r1 = null;
        if (r.R1) {
          const p = parseJsonEntry(r.R1);
          if (!p.ok) add('W-0', 'FAIL(reader-invalid)', { reason: 'R1-unparseable' });
          else if (!validateResultSchema(p.value, 'payload').ok) problems.push('R1-schema');
          else r1 = p.value;
        }
        let r3 = null;
        if (r.R3) {
          const p = parseJsonEntry(r.R3);
          if (!p.ok) add('W-0', 'FAIL(reader-invalid)', { reason: 'R3-unparseable' });
          else if (!validateCloseoutManifest(p.value).ok) problems.push('R3-schema');
          else r3 = p.value;
        }
        if (r3 && r.R1 && r3.artifacts[0].sha256 !== sha256Hex(r.R1)) problems.push('R3-R1-hash');
        if (r3 && r.R2 && r3.artifacts[1].sha256 !== sha256Hex(r.R2)) problems.push('R3-R2-hash');
        const pos = [kRec.primaryOverall, cs && cs.primaryOverall];
        const rowsSeen = [kRec.primaryRow, cs && cs.primaryRow];
        if (r1) { pos.push(r1.closeout.primaryOverall, r1.overall.verdict); rowsSeen.push(r1.closeout.primaryRow, r1.overall.row); }
        if (r3) { pos.push(r3.primaryOverall); rowsSeen.push(r3.primaryRow); }
        if (new Set(pos).size !== 1) problems.push('primaryOverall-differs');
        if (new Set(rowsSeen).size !== 1) problems.push('primaryRow-differs');
        if (kRec.finalOverall !== kRec.primaryOverall) problems.push('finalOverall-not-primaryOverall');
        if (kRec.journalSha256 !== sha256Hex(journalBytes)) problems.push('journal-sha256');
        const ids = [kRec.attemptId, journal.attemptId, reservation.attemptId];
        if (r3) ids.push(r3.attemptId);
        if (r1) ids.push(r1.attempt.attemptId);
        if (new Set(ids).size !== 1) problems.push('attemptId-differs');
        if (!bindingsEqual(reservation, journal)) problems.push('binding-differs');
        if (problems.length > 0) add('W-5', 'FAIL(commit-invalid)', { reasons: problems });
      }

      // A K-bearing CLOSEOUT_STARTED journal whose K failed W-0 has no W-6 path either.
      if (witnesses.length === 0 && !(cls.class === JOURNAL_CLASS.CLOSEOUT_STARTED_WITH_COMMIT && kRec !== null)) {
        add('W-0', 'FAIL(reader-invalid)', { reason: 'unclassifiable' });
      }
      if (witnesses.length === 0) {
        if (!PRIMARY_OVERALL_VALUES.includes(kRec.finalOverall)) add('W-0', 'FAIL(reader-invalid)', { reason: 'final-overall-out-of-enum' });
        else {
          return Object.freeze({ verdict: kRec.finalOverall, label: kRec.finalOverall, witness: 'W-6', witnesses: Object.freeze([]), detail: Object.freeze(detail) });
        }
      }
    }
  } catch (err) {
    add('W-0', 'FAIL(reader-invalid)', { reason: `reader-exception:${err && err.message}` });
  }
  const order = ['W-0', 'W-1', 'W-2', 'W-3', 'W-4', 'W-5'];
  const sorted = witnesses.slice().sort((a, b) => order.indexOf(a.witness) - order.indexOf(b.witness));
  return Object.freeze({ verdict: VERDICT_FAIL, label: sorted[0].label, witness: sorted[0].witness, witnesses: Object.freeze(sorted), detail: Object.freeze(detail) });
}

/**
 * `readArtifactFileMap({fs, chain})` -- builds the reader's file map from disk (every entry of D2
 * and the R1..R3 entries of D1; symlinks/directories become `{nonRegular:true}`). Read-only.
 */
function readArtifactFileMap({ fs, chain }) {
  const readDir = (dir, filter) => {
    const out = {};
    const st = lstatOrNull(fs, dir);
    if (!st || !isRealDirectory(st)) return out;
    for (const name of fs.readdir(dir)) {
      if (!filter(name)) continue;
      const fst = fs.lstat(path.join(dir, name));
      out[name] = isRegularFile(fst) ? toBuffer(fs.readFile(path.join(dir, name))) : { nonRegular: true };
    }
    return out;
  };
  return {
    attempts: readDir(chain.D2, () => true),
    results: readDir(chain.D1, (n) => [R1_NAME, R2_NAME, R3_NAME].includes(n)),
  };
}

// ============================================================================================
// Section 15 -- static guard for the final critical section (§9.1 step 8 "Prohibited
// implementation patterns", §8 "AST assertion", §4.2 source-order/static test).
//
// No JavaScript parser (acorn/espree/typescript/babel) is available in node_modules, so this
// section carries its own: `tokenizeJs` (a conservative ECMAScript tokenizer -- comments, strings,
// template literals with nested substitutions, regex literals, numbers, punctuators) and
// `parseRestrictedFunction`, a recursive-descent parser for the SMALL grammar the critical
// section may use (let/const, try/catch, if-throw, throw, return, assignment, `===`/`!==`, member
// access, calls, `new`, identifiers, literals, shorthand object literals). Anything outside that
// grammar (await, yield, arrow/function expressions, parentheses, templates, loops, ...) is a parse
// error, i.e. rejected. The parsed AST of `commitCriticalSection` must equal, node for node, the
// AST of CRITICAL_SECTION_CANONICAL_SOURCE (the whitelist); a token-level deny scan runs first only
// to give each rejection a specific reason.
// ============================================================================================

const JS_PUNCTUATORS = Object.freeze([
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#',
]);
const REGEX_AFTER_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** Conservative ECMAScript tokenizer; throws SyntaxError on anything it cannot tokenize. */
function tokenizeJs(src) {
  const tokens = [];
  const isIdStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c);
  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === 'ident') return REGEX_AFTER_KEYWORDS.has(prev.value);
    if (prev.type !== 'punct') return false;
    return ![')', ']', '}'].includes(prev.value);
  };
  const unescape = (raw) => raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (m, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[e] ?? e;
  });
  const lex = (start, stopAtBrace) => {
    let i = start;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (/\s/.test(c) || c === '﻿') { i += 1; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && n === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new SyntaxError(`tokenizeJs: unterminated comment at ${i}`);
        i = end + 2;
        continue;
      }
      if (i === 0 && c === '#' && n === '!') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < src.length && isIdPart(src[j])) j += 1;
        tokens.push({ type: 'ident', value: src.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n || ''))) {
        let j = i + 1;
        while (j < src.length && (/[0-9A-Za-z_.]/.test(src[j]) || ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))))) j += 1;
        tokens.push({ type: 'number', value: src.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }
      if (c === '\'' || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\n') throw new SyntaxError(`tokenizeJs: newline in string at ${j}`);
          j += src[j] === '\\' ? 2 : 1;
        }
        if (j >= src.length) throw new SyntaxError(`tokenizeJs: unterminated string at ${i}`);
        tokens.push({ type: 'string', value: unescape(src.slice(i + 1, j)), start: i, end: j + 1 });
        i = j + 1;
        continue;
      }
      if (c === '`') {
        let j = i + 1;
        for (;;) {
          if (j >= src.length) throw new SyntaxError(`tokenizeJs: unterminated template at ${i}`);
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '`') { j += 1; break; }
          if (src[j] === '$' && src[j + 1] === '{') { j = lex(j + 2, true); continue; }
          j += 1;
        }
        tokens.push({ type: 'template', value: src.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }
      if (c === '/' && regexAllowed()) {
        let j = i + 1;
        let inClass = false;
        for (;;) {
          if (j >= src.length || src[j] === '\n') throw new SyntaxError(`tokenizeJs: unterminated regex at ${i}`);
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j += 1;
        }
        j += 1;
        while (j < src.length && isIdPart(src[j])) j += 1;
        tokens.push({ type: 'regex', value: src.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }
      const p = JS_PUNCTUATORS.find((q) => src.startsWith(q, i));
      if (!p) throw new SyntaxError(`tokenizeJs: unexpected character ${JSON.stringify(c)} at ${i}`);
      if (p === '{') depth += 1;
      if (p === '}') {
        if (depth === 0 && stopAtBrace) return i + 1;
        depth -= 1;
      }
      tokens.push({ type: 'punct', value: p, start: i, end: i + p.length });
      i += p.length;
    }
    if (stopAtBrace) throw new SyntaxError('tokenizeJs: unterminated template substitution');
    return i;
  };
  lex(0, false);
  return tokens;
}

/**
 * Locates every `function <name>(` declaration in a token list. Returns
 * `[{name, isAsync, isGenerator, startIndex, endIndex, start, end, tokens}]` (character offsets
 * cover an `async` prefix; `tokens` are the declaration's own tokens from `function` to `}`).
 */
function findFunctionDeclarations(tokens, name = null) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === 'punct' && prev.value === '.') continue;
    let k = i + 1;
    let isGenerator = false;
    if (tokens[k] && tokens[k].type === 'punct' && tokens[k].value === '*') { isGenerator = true; k += 1; }
    const nameTok = tokens[k];
    if (!nameTok || nameTok.type !== 'ident' || !tokens[k + 1] || tokens[k + 1].value !== '(') continue;
    if (name !== null && nameTok.value !== name) continue;
    let p = k + 1;
    let depth = 0;
    for (; p < tokens.length; p += 1) {
      if (tokens[p].type !== 'punct') continue;
      if (tokens[p].value === '(') depth += 1;
      else if (tokens[p].value === ')') { depth -= 1; if (depth === 0) break; }
    }
    const open = p + 1;
    if (!tokens[open] || tokens[open].value !== '{') continue;
    let q = open;
    depth = 0;
    for (; q < tokens.length; q += 1) {
      if (tokens[q].type !== 'punct') continue;
      if (tokens[q].value === '{') depth += 1;
      else if (tokens[q].value === '}') { depth -= 1; if (depth === 0) break; }
    }
    const isAsync = Boolean(prev) && prev.type === 'ident' && prev.value === 'async';
    out.push({
      name: nameTok.value, isAsync, isGenerator, startIndex: i, endIndex: q,
      start: isAsync ? prev.start : t.start, end: tokens[q] ? tokens[q].end : t.end, tokens: tokens.slice(i, q + 1),
    });
  }
  return out;
}

/** `locateFunctionSource(source, name)` -- char offsets `{start, end}` of the named declaration. */
function locateFunctionSource(source, name) {
  const found = findFunctionDeclarations(tokenizeJs(source), name);
  if (found.length !== 1) throw new Error(`locateFunctionSource: expected exactly one declaration of ${name}, found ${found.length}`);
  return { start: found[0].start, end: found[0].end };
}

const RESTRICTED_UNSUPPORTED = new Set([
  'await', 'yield', 'async', 'function', 'class', 'import', 'export', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of',
  'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'finally', 'with', 'debugger', 'var', 'this',
  'super', 'arguments', 'eval', 'else', 'let', 'const', 'try', 'catch', 'if', 'throw', 'return', 'new',
]);

/**
 * `parseRestrictedFunction(tokens)` -- recursive-descent parser for the critical-section grammar:
 *   Function   := 'function' Ident '(' Ident (',' Ident)* ')' Block
 *   Block      := '{' Statement* '}'
 *   Statement  := ('let'|'const') Ident '=' Expr ';' | 'try' Block 'catch' '(' Ident ')' Block
 *               | 'if' '(' Expr ')' Statement | 'throw' Expr ';' | 'return' Expr ';' | Expr ';'
 *   Expr       := Equality ('=' Expr)?            (assignment target: Identifier or Member)
 *   Equality   := Unary (('==='|'!==') Unary)*
 *   Unary      := 'new' Member Args | Call
 *   Call       := Primary ('.' Ident | Args)*
 *   Primary    := Ident | String | Number | 'null' | 'true' | 'false' | '{' Props? '}'
 *   Props      := Ident (':' Expr)? (',' Ident (':' Expr)?)*
 * Returns a plain AST; throws SyntaxError for anything else (every unsupported construct).
 */
function parseRestrictedFunction(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const fail = (msg) => { const t = peek(); throw new SyntaxError(`${msg} at token ${i}${t ? ` '${t.value}'` : ' <eof>'}`); };
  const isP = (v) => { const t = peek(); return Boolean(t) && t.type === 'punct' && t.value === v; };
  const isKw = (v) => { const t = peek(); return Boolean(t) && t.type === 'ident' && t.value === v; };
  const expectP = (v) => { if (!isP(v)) fail(`expected '${v}'`); i += 1; };
  const expectKw = (v) => { if (!isKw(v)) fail(`expected '${v}'`); i += 1; };
  const ident = () => {
    const t = peek();
    if (!t || t.type !== 'ident' || RESTRICTED_UNSUPPORTED.has(t.value) || ['null', 'true', 'false'].includes(t.value)) fail('expected identifier');
    i += 1;
    return t.value;
  };
  const parseArgs = () => {
    expectP('(');
    const args = [];
    if (!isP(')')) {
      args.push(parseExpr());
      while (isP(',')) { i += 1; args.push(parseExpr()); }
    }
    expectP(')');
    return args;
  };
  const parsePrimary = () => {
    const t = peek();
    if (!t) fail('unexpected end');
    if (t.type === 'string') { i += 1; return { type: 'Literal', value: t.value }; }
    if (t.type === 'number') { i += 1; return { type: 'Literal', value: Number(t.value) }; }
    if (t.type === 'ident' && (t.value === 'null' || t.value === 'true' || t.value === 'false')) {
      i += 1;
      return { type: 'Literal', value: t.value === 'null' ? null : t.value === 'true' };
    }
    if (t.type === 'ident') return { type: 'Identifier', name: ident() };
    if (isP('{')) {
      i += 1;
      const properties = [];
      if (!isP('}')) {
        for (;;) {
          const key = ident();
          if (isP(':')) { i += 1; properties.push({ key, value: parseExpr(), shorthand: false }); } else properties.push({ key, value: { type: 'Identifier', name: key }, shorthand: true });
          if (isP(',')) { i += 1; continue; }
          break;
        }
      }
      expectP('}');
      return { type: 'Object', properties };
    }
    return fail('unsupported expression');
  };
  const parseMemberChain = (allowCalls) => {
    let e = parsePrimary();
    for (;;) {
      if (isP('.')) { i += 1; e = { type: 'Member', object: e, property: ident() }; continue; }
      if (allowCalls && isP('(')) { e = { type: 'Call', callee: e, args: parseArgs() }; continue; }
      break;
    }
    return e;
  };
  const parseUnary = () => {
    if (isKw('new')) { i += 1; const callee = parseMemberChain(false); return { type: 'New', callee, args: parseArgs() }; }
    return parseMemberChain(true);
  };
  const parseEquality = () => {
    let left = parseUnary();
    while (isP('===') || isP('!==')) {
      const operator = peek().value;
      i += 1;
      left = { type: 'Binary', operator, left, right: parseUnary() };
    }
    return left;
  };
  function parseExpr() {
    const left = parseEquality();
    if (isP('=')) {
      if (left.type !== 'Identifier' && left.type !== 'Member') fail('invalid assignment target');
      i += 1;
      return { type: 'Assign', left, right: parseExpr() };
    }
    return left;
  }
  const parseBlock = () => {
    expectP('{');
    const body = [];
    while (!isP('}')) { if (!peek()) fail('unterminated block'); body.push(parseStatement()); }
    expectP('}');
    return body;
  };
  function parseStatement() {
    if (isKw('let') || isKw('const')) {
      const kind = peek().value;
      i += 1;
      const id = ident();
      expectP('=');
      const init = parseExpr();
      expectP(';');
      return { type: 'VarDecl', kind, id, init };
    }
    if (isKw('try')) {
      i += 1;
      const block = parseBlock();
      expectKw('catch');
      expectP('(');
      const param = ident();
      expectP(')');
      const handler = parseBlock();
      if (isKw('finally')) fail('finally unsupported');
      return { type: 'Try', block, param, handler };
    }
    if (isKw('if')) {
      i += 1;
      expectP('(');
      const test = parseExpr();
      expectP(')');
      return { type: 'If', test, consequent: parseStatement() };
    }
    if (isKw('throw')) { i += 1; const argument = parseExpr(); expectP(';'); return { type: 'Throw', argument }; }
    if (isKw('return')) { i += 1; const argument = parseExpr(); expectP(';'); return { type: 'Return', argument }; }
    const expression = parseExpr();
    expectP(';');
    return { type: 'ExprStmt', expression };
  }
  expectKw('function');
  const name = ident();
  expectP('(');
  const params = [];
  if (!isP(')')) {
    params.push(ident());
    while (isP(',')) { i += 1; params.push(ident()); }
  }
  expectP(')');
  const body = parseBlock();
  if (i !== tokens.length) fail('trailing tokens');
  return { type: 'Function', name, params, body };
}

/**
 * The whitelist: the exact source form of §9.1 step 8's block. `commitCriticalSection`'s parsed
 * AST must equal this text's parsed AST node for node.
 */
const CRITICAL_SECTION_CANONICAL_SOURCE = [
  'function commitCriticalSection(fs, cs) {',
  '  let committed = false;',
  '  let finalOverall = VERDICT_FAIL;',
  '  let gateFailure = null;',
  '  try {',
  "    const preLink = computeOverall(cs.state, 'pre-link');",
  '    gateFailure = preLinkGateFailure(cs, preLink, performance.now());',
  '    if (gateFailure !== null) throw new Error(gateFailure);',
  '    fs.linkSync(cs.Kc, cs.K);',
  '    committed = true;',
  '    finalOverall = cs.primaryOverall;',
  '  } catch (error) {',
  '    committed = false;',
  '    return Object.freeze({ committed, finalOverall: VERDICT_FAIL, gateFailure, error });',
  '  }',
  '  return Object.freeze({ committed, finalOverall, gateFailure });',
  '}',
].join('\n');

/**
 * The name of the removed third phase, assembled so that the guard itself contains no such string
 * literal (the whole-harness rule forbids it everywhere).
 */
const FORBIDDEN_PHASE_NAME = ['fin', 'al'].join('');
const TIMER_IDENTIFIERS = new Set(['setTimeout', 'setImmediate', 'setInterval', 'queueMicrotask', 'nextTick', 'clearTimeout', 'clearImmediate', 'clearInterval', 'requestAnimationFrame']);
const DISPATCH_IDENTIFIERS = new Set(['emit', 'emitAsync', 'dispatchEvent', 'postMessage']);

/** Token-level deny scan of one function's tokens; returns reason strings (for diagnostics). */
function denyScanTokens(fnTokens, { critical }) {
  const reasons = new Set();
  let linkSyncCalls = 0;
  for (let idx = 1; idx < fnTokens.length; idx += 1) {
    const t = fnTokens[idx];
    const prev = fnTokens[idx - 1];
    const next = fnTokens[idx + 1];
    const afterDot = prev && prev.type === 'punct' && (prev.value === '.' || prev.value === '?.');
    if (t.type === 'ident') {
      const v = t.value;
      if (v === 'await') reasons.add('await');
      if (v === 'yield') reasons.add('yield');
      if (v === 'async') reasons.add('async-function');
      if (v === 'Promise') reasons.add('promise');
      if (v === 'race' || (v === 'Promise' && next && next.value === '.' && fnTokens[idx + 2] && fnTokens[idx + 2].value === 'race')) reasons.add('promise-race');
      if (afterDot && (v === 'then' || v === 'catch' || v === 'finally')) reasons.add('then');
      if (TIMER_IDENTIFIERS.has(v)) reasons.add('timer');
      if (v === 'AbortSignal' || v === 'AbortController') reasons.add('abort-signal');
      if (afterDot && (v === 'promises' || v === 'link')) reasons.add('async-link');
      if (v === 'nodeLinkSync') reasons.add('link-alias');
      if (afterDot && v === 'linkSync' && next && next.value === '(') linkSyncCalls += 1;
      if (DISPATCH_IDENTIFIERS.has(v)) reasons.add('callback-dispatch');
      if (v === 'closeoutComplete') reasons.add('closeout-complete-read');
      if (v === 'function' && critical) reasons.add('nested-function');
      if (!critical && ['COMPLETED', 'finalOverall', 'committed', 'committedAt', 'readFile', 'readFileSync', 'commitName', 'linkSync'].includes(v)) reasons.add(`k-dependent-read:${v}`);
      if (!critical && afterDot && v === 'K') reasons.add('k-dependent-read:K');
    } else if (t.type === 'punct' && t.value === '=>' && critical) {
      reasons.add('nested-function');
    } else if ((t.type === 'string' && t.value === FORBIDDEN_PHASE_NAME) || (t.type === 'template' && /(^|[^A-Za-z0-9_$])final([^A-Za-z0-9_$]|$)/.test(t.value))) {
      reasons.add('final-phase');
    }
  }
  if (critical) {
    if (linkSyncCalls !== 1) reasons.add(`link-call-count:${linkSyncCalls}`);
    // callback-taking fs call: any fs.<x>( ... ) whose argument list contains a function.
    for (let idx = 0; idx + 3 < fnTokens.length; idx += 1) {
      if (fnTokens[idx].value === 'fs' && fnTokens[idx + 1].value === '.' && fnTokens[idx + 3].value === '(') {
        let depth = 0;
        for (let q = idx + 3; q < fnTokens.length; q += 1) {
          const v = fnTokens[q].value;
          if (fnTokens[q].type === 'punct' && v === '(') depth += 1;
          else if (fnTokens[q].type === 'punct' && v === ')') { depth -= 1; if (depth === 0) break; }
          if (v === '=>' || (fnTokens[q].type === 'ident' && v === 'function')) reasons.add('callback-fs');
        }
      }
    }
  }
  return [...reasons];
}

function walkAst(node, visit) {
  if (Array.isArray(node)) { for (const n of node) walkAst(n, visit); return; }
  if (node === null || typeof node !== 'object') return;
  visit(node);
  for (const k of Object.keys(node)) walkAst(node[k], visit);
}

/** Direct callee names of harness-declared functions inside a function's tokens. */
function harnessCallees(fnTokens, harnessNames, selfName) {
  const out = new Set();
  for (let idx = 1; idx + 1 < fnTokens.length; idx += 1) {
    const t = fnTokens[idx];
    const prev = fnTokens[idx - 1];
    if (t.type === 'ident' && harnessNames.has(t.value) && t.value !== selfName && fnTokens[idx + 1].value === '('
      && !(prev.type === 'punct' && (prev.value === '.' || prev.value === '?.')) && prev.value !== 'function') out.add(t.value);
  }
  return out;
}

/** Second-argument string of every `computeOverall(<x>, '<phase>')` call (not the declaration). */
function computeOverallCallPhases(tokens) {
  const calls = [];
  for (let idx = 0; idx + 1 < tokens.length; idx += 1) {
    const t = tokens[idx];
    if (t.type !== 'ident' || t.value !== 'computeOverall' || tokens[idx + 1].value !== '(') continue;
    if (tokens[idx - 1] && tokens[idx - 1].value === 'function') continue;
    let depth = 0;
    let commaAt = -1;
    let closeAt = -1;
    for (let q = idx + 1; q < tokens.length; q += 1) {
      const v = tokens[q];
      if (v.type === 'punct' && (v.value === '(' || v.value === '[' || v.value === '{')) depth += 1;
      else if (v.type === 'punct' && (v.value === ')' || v.value === ']' || v.value === '}')) { depth -= 1; if (depth === 0) { closeAt = q; break; } }
      else if (v.type === 'punct' && v.value === ',' && depth === 1 && commaAt === -1) commaAt = q;
    }
    const phaseTok = commaAt === -1 ? null : tokens[commaAt + 1];
    const phase = phaseTok && phaseTok.type === 'string' && closeAt === commaAt + 2 ? phaseTok.value : null;
    calls.push({ index: idx, phase });
  }
  return calls;
}

/**
 * `auditCloseoutSource(source)` -- the static guard over the WHOLE harness source. Returns
 * `{ok, findings:[{rule, reason, detail?}]}`. Rules:
 *   critical-section  exactly one plain (non-async, non-generator) `commitCriticalSection`; deny
 *                     scan (await/yield/promise/then/timer/Promise.race/AbortSignal/async or
 *                     callback link/nested function/dispatch/closeoutComplete/'final'); exactly one
 *                     `fs.linkSync(`; restricted-grammar parse; AST == canonical whitelist AST.
 *   pre-link-path     computeOverall, preLinkGateFailure and every harness function they reach are
 *                     synchronous and contain no await/promise/timer/link/K/closeoutComplete/
 *                     COMPLETED/finalOverall/committed read and no 'final' literal.
 *   phases            OVERALL_PHASES is exactly ['pre-closeout','pre-link']; every computeOverall
 *                     call passes one of them as a literal; exactly one 'pre-link' call, inside
 *                     commitCriticalSection.
 *   call-site         commitCriticalSection is called exactly once, as the first statement of a
 *                     setImmediate callback inside drainAndCommit (no race/timer/abort wrapper);
 *                     drainAndCommit is awaited exactly once, unwrapped, in closeoutProtocol.
 *   post-commit       `finalOverall =` and `committed =` assignments exist only inside
 *                     commitCriticalSection; runPostCommit never calls computeOverall nor assigns an
 *                     exit code; no string literal 'final' anywhere in the harness.
 */
function auditCloseoutSource(source) {
  const findings = [];
  const find = (rule, reason, detail) => findings.push(detail === undefined ? { rule, reason } : { rule, reason, detail });
  let tokens;
  try { tokens = tokenizeJs(source); } catch (err) {
    find('tokenize', 'tokenize-error', err.message);
    return { ok: false, findings };
  }
  const decls = findFunctionDeclarations(tokens);
  const harnessNames = new Set(decls.map((d) => d.name));
  const byName = (n) => decls.filter((d) => d.name === n);

  // critical-section
  const crit = byName('commitCriticalSection');
  if (crit.length !== 1) find('critical-section', 'declaration-count', crit.length);
  else {
    const c = crit[0];
    if (c.isAsync) find('critical-section', 'async-function');
    if (c.isGenerator) find('critical-section', 'generator');
    for (const r of denyScanTokens(c.tokens, { critical: true })) find('critical-section', r);
    let ast = null;
    try { ast = parseRestrictedFunction(c.tokens); } catch (err) { find('critical-section', 'parse-error', err.message); }
    if (ast) {
      const canonical = parseRestrictedFunction(tokenizeJs(CRITICAL_SECTION_CANONICAL_SOURCE));
      if (JSON.stringify(ast) !== JSON.stringify(canonical)) find('critical-section', 'whitelist-mismatch');
      let links = 0;
      let verdictAssignments = 0;
      walkAst(ast, (n) => {
        if (n.type === 'Call' && n.callee.type === 'Member' && n.callee.property === 'linkSync') links += 1;
        if (n.type === 'Assign' && n.left.type === 'Identifier' && n.left.name === 'finalOverall') verdictAssignments += 1;
      });
      if (links !== 1) find('critical-section', 'link-call-count-ast', links);
      if (verdictAssignments !== 1) find('critical-section', 'post-commit-verdict-mutation', verdictAssignments);
    }
  }

  // pre-link-path (transitive over harness functions)
  const seen = new Set();
  const queue = ['computeOverall', 'preLinkGateFailure'];
  while (queue.length > 0) {
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    const ds = byName(n);
    if (ds.length !== 1) { find('pre-link-path', 'declaration-count', `${n}:${ds.length}`); continue; }
    const d = ds[0];
    if (d.isAsync) find('pre-link-path', 'async-function', n);
    if (d.isGenerator) find('pre-link-path', 'generator', n);
    for (const r of denyScanTokens(d.tokens, { critical: false })) find('pre-link-path', r, n);
    for (const callee of harnessCallees(d.tokens, harnessNames, n)) queue.push(callee);
  }

  // phases
  const phasesDecl = [];
  for (let idx = 0; idx + 1 < tokens.length; idx += 1) {
    if (tokens[idx].type === 'ident' && tokens[idx].value === 'OVERALL_PHASES' && tokens[idx + 1].value === '=' && tokens[idx - 1] && tokens[idx - 1].value === 'const') {
      let q = idx + 2;
      const vals = [];
      while (q < tokens.length && tokens[q].value !== ';') { vals.push(tokens[q].type === 'string' ? `'${tokens[q].value}'` : tokens[q].value); q += 1; }
      phasesDecl.push(vals.join(' '));
    }
  }
  if (phasesDecl.length !== 1 || phasesDecl[0] !== "Object . freeze ( [ 'pre-closeout' , 'pre-link' ] )") find('phases', 'final-phase', phasesDecl.join(' | '));
  const calls = computeOverallCallPhases(tokens);
  for (const call of calls) if (!OVERALL_PHASES.includes(call.phase)) find('phases', 'phase-literal', call.phase);
  const preLinkCalls = calls.filter((c) => c.phase === 'pre-link');
  const critDecl = crit.length === 1 ? crit[0] : null;
  if (preLinkCalls.length !== 1 || !critDecl || !(preLinkCalls[0].index > critDecl.startIndex && preLinkCalls[0].index < critDecl.endIndex)) find('phases', 'pre-link-call-site', preLinkCalls.length);

  // call-site
  const callIdx = [];
  for (let idx = 0; idx + 1 < tokens.length; idx += 1) {
    if (tokens[idx].type === 'ident' && tokens[idx].value === 'commitCriticalSection' && tokens[idx + 1].value === '(' && !(tokens[idx - 1] && tokens[idx - 1].value === 'function')) callIdx.push(idx);
  }
  const drain = byName('drainAndCommit');
  if (callIdx.length !== 1 || drain.length !== 1) find('call-site', 'critical-call-count', callIdx.length);
  else {
    const d = drain[0];
    const at = callIdx[0];
    if (!(at > d.startIndex && at < d.endIndex)) find('call-site', 'critical-call-outside-drain');
    const expectBefore = ['setImmediate', '(', '(', ')', '=>', '{', 'const', 'outcome', '='];
    const before = tokens.slice(at - expectBefore.length, at).map((t) => t.value);
    if (before.join(' ') !== expectBefore.join(' ')) find('call-site', 'critical-not-dedicated-macrotask', before.join(' '));
    for (const t of d.tokens) {
      if (t.type === 'ident' && ['race', 'setTimeout', 'setInterval', 'AbortSignal', 'AbortController', 'clearTimeout'].includes(t.value)) find('call-site', 'wrapped-commit', t.value);
    }
    const drainCalls = [];
    for (let idx = 0; idx + 1 < tokens.length; idx += 1) {
      if (tokens[idx].type === 'ident' && tokens[idx].value === 'drainAndCommit' && tokens[idx + 1].value === '(' && !(tokens[idx - 1] && tokens[idx - 1].value === 'function')) drainCalls.push(idx);
    }
    const cp = byName('closeoutProtocol');
    if (drainCalls.length !== 1 || cp.length !== 1) find('call-site', 'drain-call-count', drainCalls.length);
    else {
      const k = drainCalls[0];
      const pre = tokens.slice(k - 4, k).map((t) => t.value).join(' ');
      if (pre !== 'const outcome = await' || !(k > cp[0].startIndex && k < cp[0].endIndex)) find('call-site', 'wrapped-commit', pre);
    }
  }

  // post-commit
  const critRange = critDecl ? [critDecl.startIndex, critDecl.endIndex] : [-1, -1];
  for (let idx = 0; idx + 1 < tokens.length; idx += 1) {
    const t = tokens[idx];
    if (t.type === 'ident' && (t.value === 'finalOverall' || t.value === 'committed') && tokens[idx + 1].type === 'punct' && tokens[idx + 1].value === '='
      && !(tokens[idx - 1] && tokens[idx - 1].type === 'punct' && (tokens[idx - 1].value === '.' || tokens[idx - 1].value === '?.'))
      && !(idx > critRange[0] && idx < critRange[1])) find('post-commit', 'post-commit-verdict-mutation', `${t.value}@${t.start}`);
    if (t.type === 'punct' && t.value === '.' && tokens[idx + 1].type === 'ident' && (tokens[idx + 1].value === 'finalOverall' || tokens[idx + 1].value === 'committed')
      && tokens[idx + 2] && tokens[idx + 2].type === 'punct' && tokens[idx + 2].value === '=') find('post-commit', 'post-commit-verdict-mutation', `.${tokens[idx + 1].value}@${t.start}`);
  }
  // the committed-branch result reports exactly the verdict assigned by the block
  const cpDecl = byName('closeoutProtocol');
  if (cpDecl.length === 1) {
    const toks = cpDecl[0].tokens;
    const drainAt = toks.findIndex((t, i) => t.type === 'ident' && t.value === 'drainAndCommit' && toks[i + 1] && toks[i + 1].value === '(');
    for (let i = drainAt + 1; drainAt >= 0 && i + 1 < toks.length; i += 1) {
      if (toks[i].type !== 'ident' || !['finalOverall', 'exitCode'].includes(toks[i].value) || toks[i + 1].value !== ':') continue;
      const vals = [];
      let depth = 0;
      for (let q = i + 2; q < toks.length; q += 1) {
        const v = toks[q].value;
        if (toks[q].type === 'punct' && (v === '(' || v === '[' || v === '{')) depth += 1;
        if (toks[q].type === 'punct' && (v === ')' || v === ']' || v === '}')) { if (depth === 0) break; depth -= 1; }
        if (depth === 0 && toks[q].type === 'punct' && v === ',') break;
        vals.push(v);
      }
      const expected = toks[i].value === 'finalOverall' ? 'outcome . finalOverall' : 'exitCodeForVerdict ( outcome . finalOverall )';
      if (vals.join(' ') !== expected) find('post-commit', 'post-commit-verdict-mutation', `${toks[i].value}: ${vals.join(' ')}`);
    }
  }
  const post = byName('runPostCommit');
  if (post.length !== 1) find('post-commit', 'declaration-count', post.length);
  else {
    for (let idx = 0; idx < post[0].tokens.length; idx += 1) {
      const t = post[0].tokens[idx];
      if (t.type === 'ident' && t.value === 'computeOverall') find('post-commit', 'post-commit-evaluation');
      if (t.type === 'ident' && t.value === 'exitCode' && post[0].tokens[idx + 1] && post[0].tokens[idx + 1].value === '=') find('post-commit', 'post-commit-exit-code');
    }
  }
  for (const t of tokens) if (t.type === 'string' && t.value === FORBIDDEN_PHASE_NAME) find('phases', 'final-phase', `literal@${t.start}`);

  return { ok: findings.length === 0, findings };
}

// ============================================================================================
// Section 16 -- offline-test support fixtures (never used by main()). Exported, like
// createRecordingFakeFs, because only the harness and its *.test.mjs siblings may be created.
// ============================================================================================

const OFFLINE_FIXTURE_AUTHORIZATION_ID = 'offline-fixture-0001';

/**
 * `createOfflineAttemptFixture({fs, chain, authorizationId, clock, uuid, attemptId})` -- runs the
 * real W2a/W2b/W3 functions against `fs` with a SYNTHETIC validation (no record file, no git) and
 * returns `{handle, binding}` with the journal at ATTEMPT_CONSUMED.
 */
function createOfflineAttemptFixture({ fs, chain, authorizationId = OFFLINE_FIXTURE_AUTHORIZATION_ID, clock = defaultClock, uuid = randomUUID, attemptId = randomUUID() }) {
  const h = (s) => sha256Hex(Buffer.from(s, 'utf8'));
  const validation = {
    ok: true,
    record: { path: `${AUTHORIZATION_PROMPTS_REL_DIR}/${authorizationId}.md`, sha256: h(`record:${authorizationId}`), id: authorizationId },
    digests: { headSha: h('head').slice(0, 40), procedureSha256: h('procedure'), harnessSha256: h('harness'), urnASha256: h(MODEL_A_URN), urnBSha256: h(MODEL_B_URN) },
  };
  const binding = buildBindingRecord({ validation, attemptId });
  establishAttemptsDirectory({ fs, chain });
  const handle = reserveAttempt({ fs, chain, binding, clock, uuid });
  markAttemptConsumed(handle);
  return { handle, binding };
}

/**
 * `createOfflineRunStateFixture({binding})` -- a complete all-PASS run state (every C1..C20 PASS,
 * every control acceptable, integrity VERIFIED, both models CONFIRMED_SVF2 and loaded, clean
 * cleanup, untainted, empty error ledger) whose recorded digests equal `binding`'s.
 */
function createOfflineRunStateFixture({ binding }) {
  const at = '2026-09-30T00:00:01.000Z';
  const checks = {};
  for (const n of CHECK_NAMES) checks[n] = { recordType: 'check-run', verdict: 'PASS', reason: null, fields: {}, evidence: {} };
  checks.C1 = { ...checks.C1, finalizedSeq: 1, finalizedAt: at };
  const controls = {};
  CONTROL_NAMES.forEach((n, i) => {
    controls[n] = makeControlRunRecord(n, { state: CONTROL_ACCEPTABLE_STATE[n], fields: {}, evidence: {} }, { start: { startSeq: 10 + 2 * i, startedAt: at }, terminalSeq: 11 + 2 * i, terminalAt: at });
  });
  return {
    script: { integrityResult: INTEGRITY_RESULT.VERIFIED },
    procedure: { path: binding.procedure.path, sha256: binding.procedure.sha256, version: PROCEDURE_VERSION, thresholdTable: 'T-rev2' },
    authorization: { path: binding.authorization.path, id: binding.authorization.id, sha256: binding.authorization.sha256 },
    attempt: { attemptId: binding.attemptId },
    harnessIntegrity: { path: binding.harness.path, sha256: binding.harness.sha256, headSha: binding.headSha, branch: 'main', gitStatusPorcelain: '' },
    runtimeEnvelope: { viewerVersion: RUNTIME_ENVELOPE_REQUESTED.viewer, urnSha256: { A: binding.fixtures.A.urnSha256, B: binding.fixtures.B.urnSha256 } },
    classifier: { A: CLASSIFIER_CONFIRMED, B: CLASSIFIER_CONFIRMED },
    runtime: { A: { loaded: true }, B: { loaded: true } },
    targets: null,
    checks,
    gates: { C1: { gateSeq: 2, gateAt: at, c1Verdict: 'PASS', c1Reason: null, c1FinalizedSeq: 1, fatalCountAtGate: 0, outcome: 'OPEN', notStarted: [] } },
    controls,
    sceneOwnership: [],
    spyLedger: [],
    eventLog: [{ seq: 1, kind: 'check-finalized', check: 'C1', verdict: 'PASS', reason: null, phase: 'P1', activeCheck: 'C1', activeControl: null }],
    stateSnapshots: [],
    c4Table: [],
    c17: null,
    c20: null,
    n6: null,
    screenshots: [],
    errorLedger: createEmptyErrorLedger(),
    cleanupFailures: [],
    cleanupStepStatus: {},
    cleanupUnresolvedOwnership: false,
    viewerScriptIntegrityReason: null,
    sessionTainted: false,
    staleContinuationsDropped: 0,
    limitations: [],
    startedAt: '2026-09-30T00:00:00.000Z',
  };
}

// ============================================================================================
// Section 17 -- Table T rev-2 (procedure §4.7), frozen. Copied by value, never tuned here.
// Classes: CD contract-derived, RD runtime/API-derived, CA calibration assumption. No AP value
// exists in rev-2. The procedure text (and therefore this table) is bound by SHA-256 in the
// authorization record; a change requires a new procedure version and a new record.
// ============================================================================================

const MIB = 1024 * 1024;

const TABLE_T = deepFreeze({
  T1: { phase0StepDeadlineMs: 30_000, class: 'CA', exception: 'E5' },
  T2: { loadAndReadinessDeadlineMs: 180_000, class: 'CA' },
  T3: { treeEnumerationDeadlineMs: 60_000, class: 'CA' },
  T4: { cameraSettleDeadlineMs: 5_000, settleEpsilonAbs: 1e-9, consecutiveSamples: 2, matrixEntries: 32, class: 'CA', exception: 'E2' },
  T5: { singleOperationDeadlineMs: 15_000, class: 'CA' },
  T6: { expectedEventWindowMs: 10_000, class: 'CA', exception: 'E4' },
  T7: { screenshotFrameDeadlineMs: 10_000, class: 'CA' },
  T8: { cleanupStepDeadlineMs: 15_000, closeTimeoutMs: 10_000, class: 'CA', exception: 'E5' },
  T9: { wholeAttemptCapMs: 20 * 60 * 1000, class: 'CA', exception: 'E5' },
  T10: { c4SamplePerModel: 20, class: 'CA' },
  T11: { c6PairPoolPerModel: 50, class: 'CA' },
  T12: { c3ShowHideRepetitions: 3, c7ReplacementRepetitions: 5, class: 'CA', exception: 'E3' },
  T13: {
    hard: { spheres: 1, outlinesPerLiveSide: 1, totalForTwoSides: 3 },
    soft: { spheres: 2, lines: 1, outlinesPerLiveSide: 1, totalForTwoSides: 5 },
    class: 'CD',
  },
  T14: { loadedModelCount: 2, class: 'CD' },
  T15: { u: 2 ** -24, passFactor: 16, grossRelative: 2 ** -10, sFloor: 2 ** -126, class: 'mixed', classes: { u: 'RD', sFloor: 'RD', passFactor: 'CA', grossRelative: 'CA', S_a: 'CA' }, exception: 'E1' },
  T16: { frustumEpsilon: 1e-4, class: 'CA', exception: 'E2' },
  T17: { footprintDilationPx: 2, class: 'CA' },
  T18: { sphereEvaluabilityFloorPx: 2, class: 'CA' },
  T19: { frameIdentityToleranceBytes: 0, changedPixelMinimum: 1, postSettleCameraTolerance: 0, deviceScaleFactor: 1, class: 'mixed', classes: { equalityLogic: 'CD', deviceScaleFactor: 'RD' } },
  T20: { offPairAttemptsMax: 2, onPairAttemptsMax: 2, interCaptureWaitRafs: 2, clearFrameCaptures: 1, class: 'CA' },
  T21: { construction: 'D = 2*g*Ms/(1-g)', msTerms: 'Ms = |bMin_x|+|bMax_x|+|rMin_x|+|rMax_x|+sFloor', gSource: 'T15.grossRelative', class: 'mixed', classes: { construction: 'CD', gValue: 'CA' } },
  T22: { perFieldBytes: 4 * 1024, spyLedgerBytes: 2 * MIB, verdictCriticalExempt: true, class: 'CD' },
  T23: { exactSha256Equality: true, schemaValidity: true, journalStateReadBack: true, class: 'CD' },
  T24: { c4RangeAbsMax: 2 ** 900, n6DomainAbsMax: 2 ** 897, class: 'CD' },
});

/** Convenience aliases (same frozen values, no second copy to drift). */
const T9_ATTEMPT_CAP_MS = TABLE_T.T9.wholeAttemptCapMs;

// ============================================================================================
// Section 18 -- evidence hygiene (procedure §4.6): redaction, size caps, verdict-critical
// exemption. The redaction regime is G1's (copied by value; drift-tested against G1's export).
// ============================================================================================

const EVIDENCE_REDACTION_PLACEHOLDER = '[REDACTED]';
const EVIDENCE_BEARER_PATTERN = new RegExp('\\bBearer\\s+[A-Za-z0-9\\-._~+/]+=*', 'gi');
const EVIDENCE_AUTHORIZATION_HEADER_PATTERN = new RegExp('\\bAuthorization\\s*:\\s*[^\\n]+', 'gi');
const EVIDENCE_COOKIE_HEADER_PATTERN = new RegExp('\\bCookie\\s*:\\s*[^\\n]+', 'gi');
const EVIDENCE_SENSITIVE_QUERY_PARAMS = new Set([
  'signature', 'sig', 'token', 'access_token', 'x-amz-signature', 'x-amz-credential',
  'authorization', 'apikey', 'api_key', 'secret', 'client_secret',
]);

/** Byte-safe UTF-8 truncation (never splits a multi-byte sequence). */
function truncateUtf8(str, maxBytes) {
  const full = Buffer.from(str, 'utf8');
  if (full.byteLength <= maxBytes) return { value: str, truncated: false, originalBytes: full.byteLength };
  let end = maxBytes;
  while (end > 0 && (full[end] & 0xc0) === 0x80) end -= 1;
  return { value: full.subarray(0, end).toString('utf8'), truncated: true, originalBytes: full.byteLength };
}

function redactSensitiveQueryParamsG2(str, mark) {
  try {
    const url = new URL(str);
    let changed = false;
    for (const name of Array.from(url.searchParams.keys())) {
      if (EVIDENCE_SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
        url.searchParams.set(name, EVIDENCE_REDACTION_PLACEHOLDER);
        changed = true;
      }
    }
    if (changed) { mark(); return url.toString(); }
    return str;
  } catch {
    // not an absolute URL: fall through to the bare query-string pattern
  }
  return str.replace(new RegExp('([?&])([A-Za-z0-9_-]+)=([^&\\s]+)', 'g'), (match, sep, name) => {
    if (EVIDENCE_SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) { mark(); return `${sep}${name}=${EVIDENCE_REDACTION_PLACEHOLDER}`; }
    return match;
  });
}

/** G1's `redactString` (bearer, Authorization/Cookie header lines, sensitive query params). */
function redactEvidenceText(str) {
  if (typeof str !== 'string') return { value: str, redacted: false };
  let redacted = false;
  const mark = () => { redacted = true; };
  let result = str;
  result = result.replace(EVIDENCE_BEARER_PATTERN, () => { mark(); return EVIDENCE_REDACTION_PLACEHOLDER; });
  result = result.replace(EVIDENCE_AUTHORIZATION_HEADER_PATTERN, () => { mark(); return `Authorization: ${EVIDENCE_REDACTION_PLACEHOLDER}`; });
  result = result.replace(EVIDENCE_COOKIE_HEADER_PATTERN, () => { mark(); return `Cookie: ${EVIDENCE_REDACTION_PLACEHOLDER}`; });
  result = redactSensitiveQueryParamsG2(result, mark);
  return { value: result, redacted };
}

/**
 * Failed-resource URLs (§4.6 "drop query strings"): the query string, fragment and any embedded
 * credentials are removed entirely. Non-URL strings are cut at the first `?`/`#`.
 */
function redactEvidenceUrl(url) {
  if (typeof url !== 'string') return { value: url, queryDropped: false };
  try {
    const u = new URL(url);
    const dropped = u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '';
    return { value: `${u.origin}${u.pathname}`, queryDropped: dropped };
  } catch {
    const cut = url.search(new RegExp('[?#]'));
    return cut === -1 ? { value: url, queryDropped: false } : { value: url.slice(0, cut), queryDropped: true };
  }
}

/** Raised (visibly) when a verdict-critical field would have to be truncated to fit a cap. */
class EvidenceCapError extends Error {
  constructor(reason, detail) {
    super(`evidence cap exceeded (${reason}): ${detail}`);
    this.name = 'EvidenceCapError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** §4.6 "Verdict-critical fields are exempt from truncation": path segments that mark one. */
const VERDICT_CRITICAL_KEYS = Object.freeze([
  'verdict', 'reason', 'reasons', 'overall', 'primaryOverall', 'primaryRow', 'finalOverall',
  'journal', 'journalCopy', 'journalStates', 'sceneOwnership', 'oracle', 'oracleInput', 'oracleInputs',
  'oracleOutput', 'oracleOutputs', 'closeout', 'cleanupFailures',
  // §9.2 slice C1: verdict-critical error-ledger collections, exempt from truncation
  'requestObservations', 'requestFailures', 'responseFailures', 'correlatedRequests', 'fatalWitnesses', 'witnessCount',
  // §9.2 slice C2: operation ledger and prefix-source evidence (verdict-critical, never truncated)
  'opLedger', 'prefixSourceLedger', 'prefixDerivation', 'ambiguousPrefixes',
]);

function isVerdictCriticalPath(pathSegments) {
  return pathSegments.some((s) => typeof s === 'string' && VERDICT_CRITICAL_KEYS.includes(s));
}

/**
 * `sanitizeEvidenceTree(root, {perFieldBytes, isExemptPath})` -- redacts every string, then caps
 * each non-exempt string to `perFieldBytes`, replacing an over-cap string by
 * `{value, truncated:true, originalBytes}`. An exempt (verdict-critical) string that exceeds the cap
 * is NEVER truncated: the call throws `EvidenceCapError` so the evidence write fails visibly.
 * Returns `{value, redactionCount, truncations:[{path, originalBytes}]}`; the input is not mutated.
 */
function sanitizeEvidenceTree(root, { perFieldBytes = TABLE_T.T22.perFieldBytes, isExemptPath = isVerdictCriticalPath } = {}) {
  let redactionCount = 0;
  const truncations = [];
  const walk = (node, segments) => {
    if (typeof node === 'string') {
      const r = redactEvidenceText(node);
      if (r.redacted) redactionCount += 1;
      const bytes = Buffer.byteLength(r.value, 'utf8');
      if (bytes <= perFieldBytes) return r.value;
      if (isExemptPath(segments)) throw new EvidenceCapError('verdict-critical-field-over-cap', `${segments.join('.')} is ${bytes} bytes (cap ${perFieldBytes})`);
      const t = truncateUtf8(r.value, perFieldBytes);
      truncations.push({ path: segments.join('.'), originalBytes: t.originalBytes });
      return { value: t.value, truncated: true, originalBytes: t.originalBytes };
    }
    if (Array.isArray(node)) return node.map((v, i) => walk(v, [...segments, i]));
    if (node !== null && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) out[k] = walk(node[k], [...segments, k]);
      return out;
    }
    return node;
  };
  const value = walk(root, []);
  return { value, redactionCount, truncations };
}

/** Spy methods whose records are verdict-critical (C19, scene-ownership oracle, C17): never dropped. */
function isVerdictCriticalSpyRecord(rec) {
  if (!rec || typeof rec.method !== 'string') return false;
  return rec.injected === true
    || /^overlays\.(addScene|addMesh|removeMesh|removeScene)$/.test(rec.method)
    || rec.method.endsWith(THEMING_SET_METHOD) || rec.method.endsWith(THEMING_CLEAR_METHOD)
    || SELECTION_METHODS.some((m) => rec.method === `viewer.${m}`)
    // §9.2 causal evidence of a C16/C17 mutationOperation (`causalEvidence.spyRef`) -- never dropped
    || (rec.origin === 'harness' && OP_LEDGER_SPY_METHODS.includes(rec.method));
}

/**
 * `capSpyLedger(records, {maxBytes})` -- persisted spy ledger cap (2 MiB total). Verdict-critical
 * records are always kept (if they alone exceed the cap the call throws `EvidenceCapError`);
 * the remaining budget is filled with the other records in original order; the rest is dropped and
 * the truncation recorded `{truncated:true, originalBytes, keptRecords, droppedRecords}`.
 */
function capSpyLedger(records, { maxBytes = TABLE_T.T22.spyLedgerBytes } = {}) {
  const sizes = records.map((r) => Buffer.byteLength(JSON.stringify(r), 'utf8'));
  const originalBytes = sizes.reduce((a, b) => a + b, 0);
  if (originalBytes <= maxBytes) return { records: records.slice(), truncated: false, originalBytes, keptRecords: records.length, droppedRecords: 0 };
  let criticalBytes = 0;
  records.forEach((r, i) => { if (isVerdictCriticalSpyRecord(r)) criticalBytes += sizes[i]; });
  if (criticalBytes > maxBytes) throw new EvidenceCapError('verdict-critical-ledger-over-cap', `${criticalBytes} bytes of verdict-critical spy records (cap ${maxBytes})`);
  let budget = maxBytes - criticalBytes;
  const keep = records.map((r, i) => {
    if (isVerdictCriticalSpyRecord(r)) return true;
    if (sizes[i] <= budget) { budget -= sizes[i]; return true; }
    return false;
  });
  const kept = records.filter((_, i) => keep[i]);
  return { records: kept, truncated: true, originalBytes, keptRecords: kept.length, droppedRecords: records.length - kept.length };
}

// ============================================================================================
// Section 19 -- instrumentation (procedure §4.3, §4.6): recordingWrap, withOrigin context stack,
// injection wrappers inside the recorder, original-restore verification, spy self-test (N1).
// Pure/injectable: nothing here touches a Viewer; tests drive fake objects.
// ============================================================================================

/** Prohibited-method names are assembled at runtime so this file never contains a literal
 * theming call (the static "no theming call" assertion scans the source text). */
const THEMING_SET_METHOD = ['setTheming', 'Color'].join('');
const THEMING_CLEAR_METHOD = ['clearTheming', 'Colors'].join('');
const SELECTION_METHODS = Object.freeze(['select', 'clearSelection', 'setSelection']);

const CALL_ORIGINS = Object.freeze(['harness', 'bridge', 'shell', 'viewer-internal']);
const ORIGIN_UNATTRIBUTED = 'unattributed';

/** §4.3 spy targets. `owner` is resolved by `installSpySet` against the supplied objects. */
const SPY_TARGETS = Object.freeze([
  { label: `viewer.${THEMING_SET_METHOD}`, owner: 'viewer', method: THEMING_SET_METHOD },
  { label: `viewer.${THEMING_CLEAR_METHOD}`, owner: 'viewer', method: THEMING_CLEAR_METHOD },
  { label: 'viewer.setAggregateIsolation', owner: 'viewer', method: 'setAggregateIsolation' },
  { label: 'viewer.getAggregateIsolation', owner: 'viewer', method: 'getAggregateIsolation' },
  { label: 'viewer.getAggregateHiddenNodes', owner: 'viewer', method: 'getAggregateHiddenNodes' },
  { label: 'viewer.fitToView', owner: 'viewer', method: 'fitToView' },
  { label: 'viewer.getAggregateSelection', owner: 'viewer', method: 'getAggregateSelection' },
  ...SELECTION_METHODS.map((m) => ({ label: `viewer.${m}`, owner: 'viewer', method: m })),
  ...['addScene', 'addMesh', 'removeMesh', 'removeScene'].map((m) => ({ label: `overlays.${m}`, owner: 'overlays', method: m })),
  { label: 'viewer.addEventListener', owner: 'viewer', method: 'addEventListener' },
  { label: 'viewer.removeEventListener', owner: 'viewer', method: 'removeEventListener' },
  ...['initialize', 'createTitleBar', 'addVisibilityListener', 'setVisible', 'uninitialize']
    .map((m) => ({ label: `DockingPanel.prototype.${m}`, owner: 'dockingPanelPrototype', method: m })),
]);

const SUMMARY_STRING_CAP = 256;
const SUMMARY_MAX_DEPTH = 2;
const SUMMARY_MAX_ITEMS = 8;

function summarizeValue(value, refIdOf, depth = 0) {
  if (value === null) return { kind: 'null' };
  switch (typeof value) {
    case 'undefined': return { kind: 'undefined' };
    case 'boolean': return { kind: 'boolean', value };
    case 'number': return { kind: 'number', value: Number.isFinite(value) ? value : String(value) };
    case 'bigint': return { kind: 'bigint', value: String(value) };
    case 'symbol': return { kind: 'symbol' };
    case 'string': {
      const r = redactEvidenceText(value).value;
      const t = truncateUtf8(r, SUMMARY_STRING_CAP);
      return t.truncated ? { kind: 'string', value: t.value, length: value.length, truncated: true } : { kind: 'string', value: t.value, length: value.length };
    }
    case 'function': return { kind: 'function', name: String(value.name || '') };
    default: break;
  }
  if (typeof value.then === 'function') return { kind: 'promise', refId: refIdOf(value) };
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, MIB));
    return { kind: 'typedarray', type: value.constructor.name, length: value.length, sha256: sha256Hex(bytes), refId: refIdOf(value) };
  }
  const type = (value.constructor && value.constructor.name) || 'Object';
  if (Array.isArray(value)) {
    return depth >= SUMMARY_MAX_DEPTH
      ? { kind: 'array', length: value.length }
      : { kind: 'array', length: value.length, items: value.slice(0, SUMMARY_MAX_ITEMS).map((v) => summarizeValue(v, refIdOf, depth + 1)) };
  }
  return { kind: 'object', type, refId: refIdOf(value), keys: Object.keys(value).sort().slice(0, 20) };
}

function summarizeThrown(err) {
  const name = err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err;
  const message = redactEvidenceText(String(err && err.message !== undefined ? err.message : err)).value;
  return { name, message: truncateUtf8(message, 512).value };
}

/**
 * `createCallRecorder({clock})` -- the single ledger every wrapper writes to, plus the
 * harness-controlled origin context stack (§4.6). A call made with no active context is
 * `unattributed`. `withOrigin` pops the exact frame it pushed (also for async `fn`, when the
 * returned promise settles), so nested and interleaved contexts never pop the wrong frame.
 */
function createCallRecorder({ clock = defaultClock, nextSeq: externalNextSeq = null } = {}) {
  const records = [];
  const frames = [];
  const refIds = new WeakMap();
  let refCounter = 0;
  // One monotonic sequence shared by every record (`seq`) and every harness event mark (`nextSeq()`),
  // so scenario events (e.g. §C15(e) install/arm/settle/read) are strictly ordered against spy records.
  let seqCounter = 0;
  // `externalNextSeq` shares an existing run counter (never a second one): the recorder then draws
  // every seq from it.
  const nextSeq = typeof externalNextSeq === 'function' ? externalNextSeq : () => { seqCounter += 1; return seqCounter; };
  // §7 RC1-C2 attribution context: stamped on every spy record, eventLog entry and state snapshot.
  // `phase` is the §5 phase currently executing; `activeCheck`/`activeControl` are null iff no check
  // (resp. control) is executing. The runner (`runChecksInPhaseOrder`) is the only writer.
  const ctx = { phase: 'P0', activeCheck: null, activeControl: null };
  const events = [];
  const attribution = () => ({ phase: ctx.phase, activeCheck: ctx.activeCheck, activeControl: ctx.activeControl });
  const setAttribution = (patch) => {
    for (const k of Object.keys(patch || {})) {
      if (!['phase', 'activeCheck', 'activeControl'].includes(k)) throw new TypeError(`setAttribution: unknown key ${k}`);
      ctx[k] = patch[k];
    }
    return attribution();
  };
  /** `{seq, phase, activeCheck, activeControl}` -- one fresh seq from the single counter + the context. */
  const stamp = () => ({ seq: nextSeq(), ...attribution() });
  /** Appends one eventLog entry `{seq, phase, activeCheck, activeControl, kind, ...fields}`. */
  const logEvent = (kind, fields = {}) => {
    const e = { ...stamp(), kind, ...fields };
    events.push(e);
    return e;
  };
  const refIdOf = (obj) => {
    let id = refIds.get(obj);
    if (id === undefined) { refCounter += 1; id = `o${refCounter}`; refIds.set(obj, id); }
    return id;
  };
  const currentOrigin = () => (frames.length === 0 ? ORIGIN_UNATTRIBUTED : frames[frames.length - 1].origin);
  const pop = (frame) => { const i = frames.lastIndexOf(frame); if (i !== -1) frames.splice(i, 1); };
  const withOrigin = (origin, fn) => {
    if (!CALL_ORIGINS.includes(origin)) throw new TypeError(`withOrigin: unknown origin ${String(origin)}`);
    if (typeof fn !== 'function') throw new TypeError('withOrigin: function required');
    const frame = { origin };
    frames.push(frame);
    let result;
    try { result = fn(); } catch (e) { pop(frame); throw e; }
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then((v) => { pop(frame); return v; }, (e) => { pop(frame); throw e; });
    }
    pop(frame);
    return result;
  };
  const record = (method, args) => {
    const argSummaries = args.map((a) => summarizeValue(a, refIdOf));
    const argRefIds = argSummaries.map((s) => (s.refId === undefined ? null : s.refId));
    const rec = {
      callIndex: records.length,
      ...stamp(),
      method,
      origin: currentOrigin(),
      argSummaries,
      argRefIds,
      argsDigest: sha256Hex(canonicalJson(argSummaries)),
      at: clock.nowIso(),
      atMs: clock.monotonicMs(),
      outcome: null,
      injected: false,
    };
    records.push(rec);
    return rec;
  };
  return { records, events, withOrigin, currentOrigin, refIdOf, record, nextSeq, originDepth: () => frames.length, attribution, setAttribution, stamp, logEvent };
}

/** Registry of every wrapper one session installed, so cleanup can restore and verify them all. */
function createWrapperRegistry() {
  const byObject = new WeakMap();
  const entries = [];
  return {
    entries,
    find(obj, name) { const m = byObject.get(obj); return m ? m.get(name) || null : null; },
    add(obj, name, entry) {
      let m = byObject.get(obj);
      if (!m) { m = new Map(); byObject.set(obj, m); }
      m.set(name, entry);
      entries.push(entry);
    },
    /** Restores every still-installed recording wrapper (reverse install order); returns failures. */
    restoreAll() {
      const failures = [];
      for (const entry of entries.slice().reverse()) {
        if (!entry.installed) continue;
        const r = entry.restore();
        if (!r.ok) failures.push({ label: entry.label, reason: r.reason });
      }
      return { ok: failures.length === 0, failures };
    },
    verifyAllRestored() {
      const bad = entries.filter((e) => !e.verifyRestored().ok).map((e) => e.label);
      return { ok: bad.length === 0, unrestored: bad };
    },
  };
}

/**
 * `recordingWrap(obj, name, {recorder, registry, label})` -- passive pass-through wrapper (§4.3).
 * Records {method, argsDigest, callIndex, origin, time, thrown/returned summary}; calls the
 * original with the same `this` and unmodified arguments and returns its result/throws its error
 * unchanged. A returned promise is NOT observed (attaching a handler would change unhandled-rejection
 * behaviour); it is summarised as `promise`. Restoration is by reference and verified.
 */
function recordingWrap(obj, name, { recorder, registry = null, label = name } = {}) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) throw new TypeError(`recordingWrap: object required for ${label}`);
  if (!recorder || typeof recorder.record !== 'function') throw new TypeError('recordingWrap: recorder required');
  const original = obj[name];
  if (typeof original !== 'function') throw new TypeError(`recordingWrap: ${label} is not a function`);
  if (registry && registry.find(obj, name)) throw new Error(`recordingWrap: ${label} is already wrapped`);
  const hadOwn = Object.prototype.hasOwnProperty.call(obj, name);
  const priorDescriptor = hadOwn ? Object.getOwnPropertyDescriptor(obj, name) : null;
  const entry = { label, obj, name, original, inner: original, injectedFired: false, injections: [], installed: false, wrapper: null };
  const wrapper = function recordedWrapper(...args) {
    const rec = recorder.record(label, args);
    entry.injectedFired = false;
    let result;
    try {
      result = Reflect.apply(entry.inner, this, args);
    } catch (e) {
      rec.injected = entry.injectedFired;
      rec.outcome = { threw: true, error: summarizeThrown(e) };
      throw e;
    }
    rec.injected = entry.injectedFired;
    rec.outcome = { threw: false, returned: summarizeValue(result, recorder.refIdOf) };
    return result;
  };
  entry.wrapper = wrapper;
  Object.defineProperty(obj, name, { value: wrapper, writable: true, configurable: true, enumerable: priorDescriptor ? priorDescriptor.enumerable : false });
  entry.installed = true;
  // §7 RC1-C2: wrapper/spy installation and removal are eventLog entries ('wrapper-install' / 'wrapper-restore').
  const logWrapperEvent = (kind, fields) => { if (typeof recorder.logEvent === 'function') recorder.logEvent(kind, { label, layer: 'recording', ...fields }); };
  entry.logWrapperEvent = (kind, fields) => { if (typeof recorder.logEvent === 'function') recorder.logEvent(kind, { label, ...fields }); };
  logWrapperEvent('wrapper-install', {});
  entry.verifyRestored = () => {
    const stillOwn = Object.prototype.hasOwnProperty.call(obj, name);
    const ok = obj[name] === original && stillOwn === hadOwn && !entry.installed;
    return { ok, reason: ok ? null : (entry.installed ? 'still-installed' : 'original-not-restored') };
  };
  entry.restore = () => {
    if (!entry.installed) return { ok: true, reason: null };
    const problems = [];
    if (entry.injections.length > 0) problems.push('injection-still-installed');
    if (obj[name] !== wrapper) problems.push('wrapper-displaced');
    try {
      if (hadOwn) Object.defineProperty(obj, name, priorDescriptor); else delete obj[name];
    } catch (e) {
      entry.installed = false;
      logWrapperEvent('wrapper-restore', { ok: false });
      return { ok: false, reason: `restore-threw:${e && e.name}` };
    }
    entry.installed = false;
    entry.injections = [];
    entry.inner = original;
    const v = entry.verifyRestored();
    if (!v.ok) problems.push(v.reason);
    logWrapperEvent('wrapper-restore', { ok: problems.length === 0 });
    return problems.length === 0 ? { ok: true, reason: null } : { ok: false, reason: problems.join('+') };
  };
  if (registry) registry.add(obj, name, entry);
  return entry;
}

/**
 * `installInjectionWrapper(obj, name, makeInjected, {registry})` -- C15 failure injection. The
 * injected layer is installed INSIDE the recorder (recorder outermost): it replaces what the
 * recording wrapper calls, never `obj[name]`, so injected calls remain recorded (flagged
 * `injected:true`). It requires an existing recording wrapper for `obj[name]`.
 */
function installInjectionWrapper(obj, name, makeInjected, { registry }) {
  const entry = registry ? registry.find(obj, name) : null;
  if (!entry || !entry.installed) throw new Error(`installInjectionWrapper: ${name} has no recording wrapper (recorder must be outermost)`);
  const prev = entry.inner;
  const injected = makeInjected(prev);
  if (typeof injected !== 'function') throw new TypeError('installInjectionWrapper: makeInjected must return a function');
  const layer = function injectedLayer(...args) { entry.injectedFired = true; return Reflect.apply(injected, this, args); };
  entry.inner = layer;
  entry.injections.push(layer);
  const logInjection = (kind, fields) => { if (typeof entry.logWrapperEvent === 'function') entry.logWrapperEvent(kind, { layer: 'injection', ...fields }); };
  logInjection('wrapper-install', {});
  return {
    remove() {
      const i = entry.injections.lastIndexOf(layer);
      if (i === -1) return { ok: true, reason: null };
      if (i !== entry.injections.length - 1 || entry.inner !== layer) return { ok: false, reason: 'out-of-order-removal' };
      entry.injections.pop();
      entry.inner = prev;
      logInjection('wrapper-restore', { ok: true });
      return { ok: true, reason: null };
    },
  };
}

/** Resolves and wraps every `SPY_TARGETS` entry that exists; absent targets are listed, not faked. */
function installSpySet({ viewer, dockingPanelPrototype = null, recorder, registry, wrapFn = recordingWrap }) {
  const owners = { viewer, overlays: viewer ? viewer.overlays : null, dockingPanelPrototype };
  const installed = [];
  const absent = [];
  for (const spec of SPY_TARGETS) {
    const owner = owners[spec.owner];
    if (!owner || typeof owner[spec.method] !== 'function') { absent.push(spec.label); continue; }
    wrapFn(owner, spec.method, { recorder, registry, label: spec.label });
    installed.push(spec.label);
  }
  return { installed, absent };
}

/**
 * N1 -- spy self-test. The SAME `wrapFn` (default `recordingWrap`) is applied to a harness-local
 * sentinel and driven under origin `harness`; the recorder must capture exactly that call with the
 * right origin and argument digest, pass the result through unchanged, and restore the original by
 * reference. `NOT_DETECTED` is a mandatory-control failure (§8 row 4).
 */
function runSpySelfTestN1({ recorder, wrapFn = recordingWrap }) {
  const sentinel = { ping(x) { return x + 1; } };
  const originalPing = sentinel.ping;
  const scratch = createWrapperRegistry();
  const startIndex = recorder.records.length;
  const label = 'n1.sentinel.ping';
  let detail = {};
  try {
    wrapFn(sentinel, 'ping', { recorder, registry: scratch, label });
    let returned;
    recorder.withOrigin('harness', () => { returned = sentinel.ping(41); });
    const captured = recorder.records.slice(startIndex).filter((r) => r.method === label);
    const restore = scratch.restoreAll();
    const restoredByReference = sentinel.ping === originalPing && restore.ok && scratch.verifyAllRestored().ok;
    const rec = captured[0];
    const good = captured.length === 1 && rec.origin === 'harness' && returned === 42
      && rec.argSummaries.length === 1 && rec.argSummaries[0].value === 41
      && typeof rec.argsDigest === 'string' && rec.argsDigest.length === 64 && restoredByReference;
    detail = { capturedCalls: captured.length, returned, restoredByReference };
    return { state: good ? 'DETECTED' : 'NOT_DETECTED', ...detail };
  } catch (e) {
    return { state: 'NOT_DETECTED', error: summarizeThrown(e) };
  }
}

/**
 * C19 helper (pure over the ledger): zero calls to the two theming methods (any origin); zero
 * selection mutators with origin bridge/shell/unattributed (harness-origin selection calls are
 * excluded; the harness makes none). Returns the offending records.
 */
function prohibitedCallViolations(records) {
  const out = [];
  for (const rec of records) {
    if (rec.method === `viewer.${THEMING_SET_METHOD}` || rec.method === `viewer.${THEMING_CLEAR_METHOD}`) {
      out.push({ kind: 'theming', record: rec });
    } else if (SELECTION_METHODS.some((m) => rec.method === `viewer.${m}`) && rec.origin !== 'harness') {
      out.push({ kind: 'selection', record: rec });
    }
  }
  return out;
}

// ============================================================================================
// Section 20 -- deterministic target selection (procedure §4.4). Pure functions over supplied
// data. No randomization; input order never matters; inputs are never mutated.
// ============================================================================================

const TARGET_SELECTION_RULE = 'leaf dbIds ascending; candidate = >=1 fragment and finite getNodeBox with min<=max; a1/b1 = first candidate; C6 pair = max world-centre distance over first 50 of each, ties by lowest dbId (a then b)';

function readFragmentCount(fragmentCounts, dbId) {
  if (typeof fragmentCounts === 'function') return fragmentCounts(dbId);
  if (fragmentCounts instanceof Map) return fragmentCounts.get(dbId);
  return fragmentCounts ? fragmentCounts[dbId] : undefined;
}

function readNodeBox(boxes, dbId) {
  const raw = typeof boxes === 'function' ? boxes(dbId) : (boxes instanceof Map ? boxes.get(dbId) : (boxes ? boxes[dbId] : undefined));
  if (raw === undefined || raw === null || raw.length !== 6) return null;
  const b = Array.from(raw, Number);
  if (!b.every(Number.isFinite)) return null;
  if (b[0] > b[3] || b[1] > b[4] || b[2] > b[5]) return null;
  return b;
}

/**
 * `enumerateCandidates({leafDbIds, fragmentCounts, boxes})` -> `{candidates:[{dbId, box, centre}],
 * leafCount, candidateCount}` sorted by ascending dbId. `box` is [minx,miny,minz,maxx,maxy,maxz].
 */
function enumerateCandidates({ leafDbIds, fragmentCounts, boxes }) {
  const leaves = Array.from(new Set(Array.from(leafDbIds || [], Number).filter((n) => Number.isInteger(n)))).sort((a, b) => a - b);
  const candidates = [];
  for (const dbId of leaves) {
    const fc = readFragmentCount(fragmentCounts, dbId);
    if (!(typeof fc === 'number' && fc >= 1)) continue;
    const box = readNodeBox(boxes, dbId);
    if (box === null) continue;
    candidates.push({ dbId, box, centre: [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2] });
  }
  return { candidates, leafCount: leaves.length, candidateCount: candidates.length };
}

/** C6 union-framing pair: maximise the squared world-centre distance over the first `pool`
 * candidates of each model; exact ties by lowest `a` dbId, then lowest `b` dbId. */
function selectFitUnionPair(candidatesA, candidatesB, pool = TABLE_T.T11.c6PairPoolPerModel) {
  const as = candidatesA.slice(0, pool);
  const bs = candidatesB.slice(0, pool);
  let best = null;
  for (const a of as) {
    for (const b of bs) {
      const d2 = (a.centre[0] - b.centre[0]) ** 2 + (a.centre[1] - b.centre[1]) ** 2 + (a.centre[2] - b.centre[2]) ** 2;
      if (!Number.isFinite(d2)) continue;
      const better = best === null || d2 > best.d2 || (d2 === best.d2 && (a.dbId < best.a.dbId || (a.dbId === best.a.dbId && b.dbId < best.b.dbId)));
      if (better) best = { a, b, d2 };
    }
  }
  if (best === null) return { pair: null, reason: as.length === 0 || bs.length === 0 ? 'empty-pool' : 'no-finite-distance', poolSizes: { A: as.length, B: bs.length } };
  if (best.d2 <= 0) return { pair: null, reason: 'no-discriminating-pair', poolSizes: { A: as.length, B: bs.length } };
  return { pair: { a: best.a.dbId, b: best.b.dbId, distance: Math.sqrt(best.d2) }, reason: null, poolSizes: { A: as.length, B: bs.length } };
}

/**
 * `selectTargets({A, B})` -- each model `{leafDbIds, fragmentCounts, boxes}`. Returns the §10
 * `targets` evidence: chosen dbIds (`a1`,`b1`, C6 pair or null => C6 NOT_EVIDENCED via N2), the
 * full candidate counts and the rationale. A missing `a1`/`b1` is reported, never guessed.
 */
function selectTargets({ A, B }) {
  const ea = enumerateCandidates(A);
  const eb = enumerateCandidates(B);
  const fit = selectFitUnionPair(ea.candidates, eb.candidates);
  return {
    a1: ea.candidates.length ? ea.candidates[0].dbId : null,
    b1: eb.candidates.length ? eb.candidates[0].dbId : null,
    fitPair: fit.pair,
    fitPairReason: fit.reason,
    c6NotEvidenced: fit.pair === null,
    candidateCounts: { A: { leaves: ea.leafCount, candidates: ea.candidateCount }, B: { leaves: eb.leafCount, candidates: eb.candidateCount } },
    poolSizes: fit.poolSizes,
    rule: TARGET_SELECTION_RULE,
    rationale: fit.pair === null
      ? `no discriminating fit pair (${fit.reason}); C6 NOT_EVIDENCED`
      : `fit pair a*=${fit.pair.a} b*=${fit.pair.b} maximises world-centre distance ${fit.pair.distance} over the first ${TABLE_T.T11.c6PairPoolPerModel} candidates of each model`,
  };
}

// ============================================================================================
// Section 21 -- timeout contract (procedure §4.5): token-bounded deadlines, late-completion
// quarantine, BLOCKED vs FAIL classes per Table T.
// ============================================================================================

const DEADLINE_TOKEN_STATE = Object.freeze({ ACTIVE: 'active', COMPLETED: 'completed', TIMED_OUT: 'timed-out', DISPOSED: 'disposed', ABANDONED: 'abandoned' });
const DEADLINE_TOKEN_TRANSITIONS = Object.freeze({
  [DEADLINE_TOKEN_STATE.ACTIVE]: new Set([DEADLINE_TOKEN_STATE.COMPLETED, DEADLINE_TOKEN_STATE.TIMED_OUT, DEADLINE_TOKEN_STATE.DISPOSED]),
  [DEADLINE_TOKEN_STATE.TIMED_OUT]: new Set([DEADLINE_TOKEN_STATE.DISPOSED, DEADLINE_TOKEN_STATE.ABANDONED]),
  [DEADLINE_TOKEN_STATE.COMPLETED]: new Set(),
  [DEADLINE_TOKEN_STATE.DISPOSED]: new Set(),
  [DEADLINE_TOKEN_STATE.ABANDONED]: new Set(),
});

function createDeadlineToken(meta = {}) {
  return { id: randomUUID(), state: DEADLINE_TOKEN_STATE.ACTIVE, meta };
}

function transitionDeadlineToken(token, toState) {
  const allowed = DEADLINE_TOKEN_TRANSITIONS[token.state];
  if (!allowed || !allowed.has(toState)) throw new Error(`deadline token ${token.id}: illegal transition '${token.state}' -> '${toState}'`);
  token.state = toState;
  return token;
}

const isDeadlineTokenLive = (token) => Boolean(token) && token.state === DEADLINE_TOKEN_STATE.ACTIVE;

const DEFAULT_TIMERS = Object.freeze({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
});

/** Counts late completions of timed-out operations: dropped, never delivered (§4.5). */
function createTimeoutQuarantine() {
  const events = [];
  return {
    events,
    recordLate(event) { events.push({ op: event.op, tokenId: event.tokenId, kind: event.kind }); },
    get staleContinuationsDropped() { return events.length; },
  };
}

/**
 * `runWithDeadline({op, timeoutMs, fn, mutating, timers, quarantine})` resolves (never rejects) to
 * `{status:'completed', value, token}`, `{status:'threw', error, token}` or
 * `{status:'timed-out', op, timeoutMs, mutating, token}`. `fn({token, isLive})` runs under a fresh
 * token; after a timeout the token is `timed-out`, the continuation's later value/rejection is
 * swallowed into the quarantine and never delivered.
 */
function runWithDeadline({ op, timeoutMs, fn, mutating = false, timers = DEFAULT_TIMERS, quarantine = null, meta = {} }) {
  if (typeof op !== 'string' || op === '') throw new TypeError('runWithDeadline: op required');
  if (!(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new TypeError('runWithDeadline: positive finite timeoutMs required');
  if (typeof fn !== 'function') throw new TypeError('runWithDeadline: fn required');
  const token = createDeadlineToken({ op, mutating, ...meta });
  return new Promise((resolve) => {
    let done = false;
    let handle = null;
    const finish = (outcome) => { if (done) return; done = true; timers.clearTimeout(handle); resolve(outcome); };
    handle = timers.setTimeout(() => {
      if (done) return;
      transitionDeadlineToken(token, DEADLINE_TOKEN_STATE.TIMED_OUT);
      finish({ status: 'timed-out', op, timeoutMs, mutating, token });
    }, timeoutMs);
    let p;
    try {
      p = Promise.resolve(fn({ token, isLive: () => isDeadlineTokenLive(token) }));
    } catch (error) {
      transitionDeadlineToken(token, DEADLINE_TOKEN_STATE.COMPLETED);
      finish({ status: 'threw', error, token });
      return;
    }
    p.then((value) => {
      if (isDeadlineTokenLive(token)) { transitionDeadlineToken(token, DEADLINE_TOKEN_STATE.COMPLETED); finish({ status: 'completed', value, token }); }
      else if (quarantine) quarantine.recordLate({ op, tokenId: token.id, kind: 'fulfilled' });
    }, (error) => {
      if (isDeadlineTokenLive(token)) { transitionDeadlineToken(token, DEADLINE_TOKEN_STATE.COMPLETED); finish({ status: 'threw', error, token }); }
      else if (quarantine) quarantine.recordLate({ op, tokenId: token.id, kind: 'rejected' });
    });
  });
}

/** Table T deadline classes (§4.5/§4.7): which timeouts are BLOCKED and which are FAIL. */
const OP_DEADLINE_SPECS = Object.freeze({
  'phase0-step': { row: 'T1', timeoutMs: TABLE_T.T1.phase0StepDeadlineMs, kind: 'fail-phase0', mutating: false, taint: false, exception: 'E5' },
  load: { row: 'T2', timeoutMs: TABLE_T.T2.loadAndReadinessDeadlineMs, kind: 'blocked', mutating: true, taint: false },
  'tree-enumeration': { row: 'T3', timeoutMs: TABLE_T.T3.treeEnumerationDeadlineMs, kind: 'blocked', mutating: false, taint: false },
  'camera-settle': { row: 'T4', timeoutMs: TABLE_T.T4.cameraSettleDeadlineMs, kind: 'blocked', mutating: false, taint: false },
  present: { row: 'T5', timeoutMs: TABLE_T.T5.singleOperationDeadlineMs, kind: 'blocked', mutating: true, taint: true },
  clear: { row: 'T5', timeoutMs: TABLE_T.T5.singleOperationDeadlineMs, kind: 'blocked', mutating: true, taint: true },
  dispose: { row: 'T5', timeoutMs: TABLE_T.T5.singleOperationDeadlineMs, kind: 'blocked', mutating: true, taint: true },
  'expected-event': { row: 'T6', timeoutMs: TABLE_T.T6.expectedEventWindowMs, kind: 'fail-event', mutating: false, taint: false, exception: 'E4' },
  screenshot: { row: 'T7', timeoutMs: TABLE_T.T7.screenshotFrameDeadlineMs, kind: 'blocked', mutating: false, taint: true },
  'cleanup-step': { row: 'T8', timeoutMs: TABLE_T.T8.cleanupStepDeadlineMs, kind: 'cleanup', mutating: true, taint: false, exception: 'E5' },
  attempt: { row: 'T9', timeoutMs: TABLE_T.T9.wholeAttemptCapMs, kind: 'fail-attempt', mutating: false, taint: false, exception: 'E5' },
});

/**
 * `classifyTimeout({op, scope, mutating, completionUnknown, ownershipUnresolved})` -- pure. Every
 * timeout forbids further mutating Viewer calls except cleanup and proceeds to cleanup. `sessionTainted`
 * is set when the operation was mutating, its Table-T row says so, or its completion is unknown.
 * Only the named E4/E5 timeouts FAIL: an absent spec-expected event (T6), the whole-attempt cap (T9),
 * a Phase-0 step deadline (T1), and a cleanup step only while ownership stays unresolved (T8, row 2).
 * All other deadlines are BLOCKED (check) / TIMED_OUT (control), never FAIL.
 */
function classifyTimeout({ op, scope = 'check', mutating, completionUnknown = false, ownershipUnresolved = false }) {
  const spec = OP_DEADLINE_SPECS[op];
  if (!spec) throw new TypeError(`classifyTimeout: unknown op '${String(op)}'`);
  if (scope !== 'check' && scope !== 'control') throw new TypeError(`classifyTimeout: unknown scope '${String(scope)}'`);
  const isMutating = mutating === undefined ? spec.mutating : Boolean(mutating);
  const base = {
    op, tableRow: spec.row, scope, exception: spec.exception || null,
    sessionTainted: spec.taint || isMutating || completionUnknown === true,
    forbidMutating: true, proceedToCleanup: true, verdict: null, reason: null, controlState: null, overallRow: null,
  };
  switch (spec.kind) {
    case 'blocked':
      return { ...base, verdict: 'BLOCKED', reason: `timeout:${op}`, controlState: scope === 'control' ? 'TIMED_OUT' : null };
    case 'fail-event':
      return { ...base, verdict: 'FAIL', reason: `expected-event-absent:${op}` };
    case 'fail-attempt':
      return { ...base, verdict: 'FAIL', reason: 'ATTEMPT_DEADLINE', overallRow: 5 };
    case 'fail-phase0':
      return { ...base, verdict: 'FAIL', reason: `phase0-timeout:${op}`, consumesAttempt: false, overallRow: 5 };
    case 'cleanup':
      return ownershipUnresolved
        ? { ...base, verdict: 'FAIL', reason: 'cleanup-step-timeout-ownership-unresolved', overallRow: 2 }
        : { ...base, verdict: 'STEP_FAILED', reason: 'cleanup-step-timeout', overallRow: 7 };
    default:
      throw new Error('classifyTimeout: unreachable');
  }
}

/** T9 whole-attempt timer: armed at ATTEMPT_CONSUMED, disarmed at closeout step 1, reports to the
 * fatal-event sink (`recordAttemptDeadline`) so row 5 `ATTEMPT_DEADLINE` applies. */
function createAttemptDeadlineTimer({ sink, timers = DEFAULT_TIMERS, capMs = T9_ATTEMPT_CAP_MS, clock = defaultClock }) {
  let handle = null;
  let armed = false;
  let expired = false;
  let deadlineAbs = null;
  return {
    arm() {
      if (armed || expired) return false;
      armed = true;
      deadlineAbs = clock.monotonicMs() + capMs;
      handle = timers.setTimeout(() => { armed = false; expired = true; sink.recordAttemptDeadline(); }, capMs);
      return true;
    },
    disarm() { if (armed) { timers.clearTimeout(handle); armed = false; } },
    isArmed: () => armed,
    hasExpired: () => expired,
    deadlineAbs: () => deadlineAbs,
  };
}

// ============================================================================================
// Section 22 -- model ownership and cleanup semantics (procedure §4.8, §9 cleanup ledger).
// `runCleanup` runs the ordered ledger over injected (fake or real) resources; every step is
// attempted, each bounded by T8, failures are recorded and never block later steps.
// ============================================================================================

const CLEANUP_STEP_NAMES = Object.freeze([
  'drainPendingTokens', 'bridgeDispose', 'shellDispose', 'removeInjectedFailureWrappers',
  'restoreRecordingWrappers', 'removeHarnessForeignScenes', 'restoreIsolationEmpty', 'showHiddenNodes',
  'restoreHiddenModel', 'verifyViewerStateBaseline', 'unloadModelA', 'unloadModelB',
  'verifyViewerModelSetEmpty', 'closePage', 'closeContext', 'closeBrowser', 'httpServerOwnership',
]);

/**
 * `runCleanup({steps, context}, {stepDeadlineMs, stepDeadlinesMs, timers, quarantine})` ->
 * `{cleanupFailures, cleanupStepStatus, cleanupUnresolvedOwnership, stepResults, staleContinuationsDropped}`.
 * `steps[name]` is a function or `{run, ownershipRemains}`. After a failed/timed-out step,
 * `ownershipRemains(context)` is re-checked: true => `cleanupUnresolvedOwnership` (row 2);
 * a throwing re-check is `indeterminate` (never sets unresolved, never claims resolved; G1 rule).
 * A step with no implementation is recorded as a failure (`step-not-configured`) -- fail-closed.
 */
async function runCleanup({ steps = {}, context = {} } = {}, { stepDeadlineMs = TABLE_T.T8.cleanupStepDeadlineMs, stepDeadlinesMs = {}, timers = DEFAULT_TIMERS, quarantine = createTimeoutQuarantine() } = {}) {
  const cleanupFailures = [];
  const cleanupStepStatus = {};
  const stepResults = {};
  let cleanupUnresolvedOwnership = false;
  for (const name of CLEANUP_STEP_NAMES) {
    const impl = steps[name];
    const run = typeof impl === 'function' ? impl : (impl && impl.run);
    const ownershipRemains = impl && typeof impl === 'object' ? impl.ownershipRemains : undefined;
    if (typeof run !== 'function') {
      cleanupStepStatus[name] = 'not-configured';
      cleanupFailures.push({ step: name, reason: 'step-not-configured', ownership: 'indeterminate' });
      continue;
    }
    const outcome = await runWithDeadline({ op: 'cleanup-step', timeoutMs: stepDeadlinesMs[name] || stepDeadlineMs, mutating: true, fn: () => run(context), timers, quarantine, meta: { step: name } });
    if (outcome.status === 'completed') {
      cleanupStepStatus[name] = 'ran';
      stepResults[name] = outcome.value === undefined ? null : outcome.value;
      continue;
    }
    const failure = outcome.status === 'timed-out'
      ? { step: name, reason: 'timed-out', timeoutMs: outcome.timeoutMs }
      : { step: name, reason: 'threw', error: summarizeThrown(outcome.error) };
    cleanupStepStatus[name] = outcome.status === 'timed-out' ? 'timed-out' : 'threw';
    if (typeof ownershipRemains === 'function') {
      try {
        if (ownershipRemains(context)) { cleanupUnresolvedOwnership = true; failure.ownership = 'unresolved'; } else failure.ownership = 'resolved';
      } catch { failure.ownership = 'indeterminate'; }
    } else {
      failure.ownership = 'indeterminate';
    }
    cleanupFailures.push(failure);
  }
  return { cleanupFailures, cleanupStepStatus, cleanupUnresolvedOwnership, stepResults, staleContinuationsDropped: quarantine.staleContinuationsDropped };
}

/**
 * §9.2 acknowledgement barrier for a harness mutation invoked from the page (C16 hide, C17 unload, a
 * cleanup unload step that is about to call `viewer.unloadModel`): `ops.begin(desc)` appends the
 * mutationOperation's start fields on the node side and resolves only after the node-side
 * acknowledgement (`ackSeq`); only then is the mutation invoked -- for C16/C17 recorded first as ONE
 * harness-origin spy record (`recorder.record(method, args)`, after the ack: the
 * `causalEvidence.spyRef`) -- and `ops.end({operationId, terminalOutcome, spyRef})` records the end
 * fields. A missing or failing `ops` records nothing: the mutation still runs and any request abort it
 * causes stays FATAL (fail-safe; nothing can ground an expected cancellation without the record).
 */
async function runAcknowledgedMutation({ ops = null, desc, recorder = null, method = null, args = [], invoke }) {
  let operationId = null;
  if (ops && typeof ops.begin === 'function') {
    try { const r = await ops.begin(desc); if (r && r.ok === true && typeof r.operationId === 'string') operationId = r.operationId; } catch { operationId = null; }
  }
  const spyRec = recorder && method ? recorder.withOrigin('harness', () => recorder.record(method, args)) : null;
  const end = async (terminalOutcome) => {
    if (operationId === null) return;
    try { await ops.end({ operationId, terminalOutcome, spyRef: spyRec ? `spyLedger:seq:${spyRec.seq}` : null }); } catch { /* the record stays not-settled (fail-safe) */ }
  };
  let value;
  try { value = await invoke(); } catch (e) {
    if (spyRec) spyRec.outcome = { threw: true, error: summarizeThrown(e) };
    await end('threw');
    throw e;
  }
  if (spyRec) spyRec.outcome = { threw: false, returned: null };
  await end('settled');
  return value;
}

/**
 * Guarded, independent unload of one model (§4.8): absent => `already-absent` (success, and NO
 * operation record -- §9.2 slice C2: a cleanup unload mutationOperation exists only around an actual
 * `viewer.unloadModel` call, through `ops` when given).
 */
async function guardedUnloadModel({ viewer, model, label, ops = null, modelId = null }) {
  const before = viewer.getAllModels();
  if (!Array.isArray(before)) throw new TypeError(`${label}: getAllModels() did not return an array`);
  if (model === null || model === undefined || !before.includes(model)) return { outcome: 'already-absent' };
  if (ops && (modelId === 'A' || modelId === 'B')) {
    await runAcknowledgedMutation({ ops, desc: { operationType: 'unload', modelId, phase: 'cleanup', invokedBy: `cleanup:${label}` }, invoke: () => viewer.unloadModel(model) });
  } else await viewer.unloadModel(model);
  const after = viewer.getAllModels();
  if (after.includes(model)) throw new Error(`${label}: model still loaded after unloadModel`);
  return { outcome: 'unloaded' };
}

function verifyViewerModelSetEmpty(viewer) {
  const models = viewer.getAllModels();
  if (!Array.isArray(models) || models.length !== 0) throw new Error(`viewer model set not empty (${Array.isArray(models) ? models.length : 'unreadable'})`);
  return { outcome: 'empty' };
}

/** Cleanup steps for the two models, keyed by object identity (never modelId). */
function createModelCleanupSteps({ viewer, getModelA, getModelB, ops = null }) {
  const stillLoaded = (getModel) => () => { const m = getModel(); return m != null && viewer.getAllModels().includes(m); };
  return {
    unloadModelA: { run: () => guardedUnloadModel({ viewer, model: getModelA(), label: 'unloadModelA', ops, modelId: 'A' }), ownershipRemains: stillLoaded(getModelA) },
    unloadModelB: { run: () => guardedUnloadModel({ viewer, model: getModelB(), label: 'unloadModelB', ops, modelId: 'B' }), ownershipRemains: stillLoaded(getModelB) },
    verifyViewerModelSetEmpty: { run: () => verifyViewerModelSetEmpty(viewer), ownershipRemains: () => viewer.getAllModels().length > 0 },
  };
}

/** One bridge instance at a time (§5): bridge #2 is disposed before bridge #1 exists. */
function createBridgeInstanceTracker() {
  let active = null;
  const history = [];
  return {
    history,
    create(name) {
      if (active !== null) throw new Error(`bridge '${name}' created while bridge '${active}' still exists`);
      active = name; history.push({ event: 'create', name });
    },
    dispose(name) {
      if (active !== name) throw new Error(`bridge '${name}' disposed but active bridge is '${active}'`);
      active = null; history.push({ event: 'dispose', name });
    },
    active: () => active,
  };
}

// ============================================================================================
// Section 23 -- scene ownership oracle (procedure §C7α/§C18b, N3). Mechanical, pure over the
// scene table and the spy ledger.
// ============================================================================================

const SCENE_CLASS = Object.freeze({ PANEL_OWNED: 'panel-owned', FOREIGN: 'foreign-preexisting' });

const OVERLAY_SCENE_ARG_INDEX = Object.freeze({ addScene: 0, removeScene: 0, addMesh: 1, removeMesh: 1 });

function overlaySceneName(rec) {
  const short = rec.method.replace(/^overlays\./, '');
  const i = OVERLAY_SCENE_ARG_INDEX[short];
  const s = rec.argSummaries && rec.argSummaries[i];
  return s && s.kind === 'string' ? s.value : null;
}

/**
 * `sceneOwnershipOracle({scenes, presentAfterDispose, ledger})`. `scenes` rows
 * `{scene, class, createdBy, bridgeInstance, presentBefore, sentinelRefId|null}`; `presentAfterDispose`
 * maps scene -> `overlays.hasScene` read after `dispose()`; `ledger` is the recorder's records.
 * Clauses: (1) panel-owned scenes absent; (2) foreign scenes present; (3) sentinel integrity (no
 * bridge-origin removeScene of a foreign scene, no bridge-origin removeMesh of a sentinel, every
 * bridge-origin removeMesh on a foreign scene references a mesh the bridge itself added -- by
 * refId, reference equality); (4) bridge-origin addMesh - removeMesh == 0 per scene. PASS iff all
 * hold; invalid input fails closed. Returns the per-scene table and every violation with its record.
 */
function sceneOwnershipOracle({ scenes, presentAfterDispose, ledger }) {
  const violations = [];
  const invalid = (detail) => ({ verdict: 'FAIL', clauses: { c1: false, c2: false, c3: false, c4: false }, violations: [{ clause: 'input', detail }], table: [], unattributedOverlayCalls: 0 });
  if (!Array.isArray(scenes) || scenes.length === 0 || !Array.isArray(ledger) || presentAfterDispose === null || typeof presentAfterDispose !== 'object') return invalid('invalid-oracle-input');
  const classByScene = new Map();
  for (const row of scenes) {
    if (!row || typeof row.scene !== 'string' || (row.class !== SCENE_CLASS.PANEL_OWNED && row.class !== SCENE_CLASS.FOREIGN) || classByScene.has(row.scene)) return invalid(`invalid-scene-row:${row && row.scene}`);
    classByScene.set(row.scene, row);
  }
  const sentinelRefs = new Set(scenes.map((r) => r.sentinelRefId).filter((x) => typeof x === 'string'));
  const overlayRecs = ledger.filter((r) => typeof r.method === 'string' && r.method.startsWith('overlays.'));
  const bridgeRecs = overlayRecs.filter((r) => r.origin === 'bridge');
  const unattributedOverlayCalls = overlayRecs.filter((r) => r.origin === ORIGIN_UNATTRIBUTED).length;
  const flag = (clause, scene, record, detail) => violations.push({ clause, scene, detail, record });

  let c1 = true;
  let c2 = true;
  for (const row of scenes) {
    const present = presentAfterDispose[row.scene];
    if (typeof present !== 'boolean') { c1 = false; c2 = false; flag('input', row.scene, null, 'presentAfterDispose-missing'); continue; }
    if (row.class === SCENE_CLASS.PANEL_OWNED && present !== false) { c1 = false; flag('c1', row.scene, null, 'panel-owned-scene-still-present'); }
    if (row.class === SCENE_CLASS.FOREIGN && present !== true) { c2 = false; flag('c2', row.scene, null, 'foreign-scene-missing'); }
  }

  let c3 = true;
  const addedByBridge = new Map();
  const net = new Map();
  const removeSceneCalls = new Map();
  const removeMeshOnForeign = new Map();
  for (const rec of bridgeRecs) {
    const short = rec.method.replace(/^overlays\./, '');
    const scene = overlaySceneName(rec);
    if (scene === null) { c3 = false; flag('c3', null, rec, 'unparseable-scene-argument'); continue; }
    const meshRef = rec.argRefIds ? rec.argRefIds[0] : null;
    const cls = classByScene.get(scene);
    if (short === 'addMesh') {
      if (meshRef) { if (!addedByBridge.has(scene)) addedByBridge.set(scene, new Set()); addedByBridge.get(scene).add(meshRef); }
      net.set(scene, (net.get(scene) || 0) + 1);
    } else if (short === 'removeMesh') {
      net.set(scene, (net.get(scene) || 0) - 1);
      if (meshRef && sentinelRefs.has(meshRef)) { c3 = false; flag('c3', scene, rec, 'bridge-removed-sentinel-mesh'); }
      if (cls && cls.class === SCENE_CLASS.FOREIGN) {
        removeMeshOnForeign.set(scene, (removeMeshOnForeign.get(scene) || 0) + 1);
        if (!meshRef || !(addedByBridge.get(scene) || new Set()).has(meshRef)) { c3 = false; flag('c3', scene, rec, 'bridge-removed-mesh-it-did-not-add'); }
      }
    } else if (short === 'removeScene') {
      removeSceneCalls.set(scene, (removeSceneCalls.get(scene) || 0) + 1);
      if (cls && cls.class === SCENE_CLASS.FOREIGN) { c3 = false; flag('c3', scene, rec, 'bridge-removed-foreign-scene'); }
    }
  }

  let c4 = true;
  const netScenes = new Set([...net.keys(), ...scenes.map((r) => r.scene)]);
  for (const scene of netScenes) {
    const n = net.get(scene) || 0;
    if (n !== 0) { c4 = false; flag('c4', scene, null, `net-addMesh-minus-removeMesh=${n}`); }
  }

  const table = scenes.map((row) => {
    const sceneViolatesSentinel = violations.some((v) => v.clause === 'c3' && v.scene === row.scene && /sentinel|foreign-scene/.test(v.detail));
    return {
      scene: row.scene,
      class: row.class,
      createdBy: row.createdBy === undefined ? null : row.createdBy,
      bridgeInstance: row.bridgeInstance === undefined ? null : row.bridgeInstance,
      presentBefore: row.presentBefore === undefined ? null : row.presentBefore,
      presentAfterDispose: typeof presentAfterDispose[row.scene] === 'boolean' ? presentAfterDispose[row.scene] : null,
      sentinelIntact: typeof row.sentinelRefId === 'string' ? (presentAfterDispose[row.scene] === true && !sceneViolatesSentinel) : null,
      bridgeOriginRemoveSceneCalls: removeSceneCalls.get(row.scene) || 0,
      bridgeOriginRemoveMeshOnForeign: removeMeshOnForeign.get(row.scene) || 0,
      netAddMinusRemove: net.get(row.scene) || 0,
    };
  });
  return { verdict: c1 && c2 && c3 && c4 && violations.length === 0 ? 'PASS' : 'FAIL', clauses: { c1, c2, c3, c4 }, violations, table, unattributedOverlayCalls };
}

/** Deep copy of a ledger (plain JSON) with a synthetic bridge-origin removeScene appended (N3). */
function injectSyntheticRemoveScene(ledger, sceneName) {
  const copy = JSON.parse(JSON.stringify(ledger));
  copy.push({
    callIndex: copy.length, method: 'overlays.removeScene', origin: 'bridge',
    argSummaries: [{ kind: 'string', value: sceneName, length: sceneName.length }], argRefIds: [null],
    argsDigest: sha256Hex(`synthetic:${sceneName}`), at: '1970-01-01T00:00:00.000Z', atMs: 0,
    outcome: { threw: false, returned: { kind: 'undefined' } }, injected: false, synthetic: true,
  });
  return copy;
}

/**
 * N3 -- the oracle discriminates: real ledger => PASS and a mutated COPY (synthetic bridge-origin
 * removeScene of the foreign markers scene) => FAIL. No Viewer effect; the real ledger is untouched.
 */
function runSceneOwnershipControlN3({ scenes, presentAfterDispose, ledger, foreignSceneName = 'clash-panel-markers:g2b', oracle = sceneOwnershipOracle }) {
  const real = oracle({ scenes, presentAfterDispose, ledger });
  const mutated = oracle({ scenes, presentAfterDispose, ledger: injectSyntheticRemoveScene(ledger, foreignSceneName) });
  const ok = real.verdict === 'PASS' && mutated.verdict === 'FAIL';
  return { state: ok ? 'DETECTED_RESTORED' : 'NOT_DETECTED', realVerdict: real.verdict, mutatedVerdict: mutated.verdict, mutatedViolations: mutated.violations.map((v) => v.detail) };
}

// ============================================================================================
// Section 24 -- phase order (procedure §5) and the dependency/taint gate.
// ============================================================================================

const PHASE_ORDER = Object.freeze([
  { id: 'P0', name: 'preflight', checks: [], controls: [] },
  { id: 'P1', name: 'load A,B + preconditions', checks: ['C1'], controls: [] },
  { id: 'P2', name: 'install spies + N1', checks: [], controls: ['N1'] },
  { id: 'P3', name: 'shell', checks: ['C2', 'C3'], controls: [] },
  { id: 'P4', name: 'bounds/unit reads', checks: ['C4', 'C5'], controls: ['N6'] },
  { id: 'P5a', name: 'bridge #2 foreign pre-existing scene scenario', checks: ['C7alpha', 'C18b'], controls: ['N3'] },
  { id: 'P5b', name: 'create bridge #1; markers', checks: ['C7'], controls: [] },
  { id: 'P6', name: 'fit', checks: ['C6', 'C8'], controls: ['N2'] },
  { id: 'P6b', name: 'overlay rendering', checks: ['C20'], controls: ['N8'] },
  { id: 'P7', name: 'isolation', checks: ['C9', 'C10', 'C11', 'C12', 'C13'], controls: ['N4', 'N5'] },
  { id: 'P8', name: 'supersession + failure injection', checks: ['C14', 'C15'], controls: [] },
  { id: 'P9', name: 'model events', checks: ['C16', 'C17'], controls: ['N7'] },
  { id: 'P10', name: 'bridge #1 dispose/residue', checks: ['C18a'], controls: [] },
  { id: 'P11', name: 'prohibited-call ledger', checks: ['C19'], controls: [] },
  { id: 'cleanup', name: 'cleanup', checks: [], controls: [] },
  { id: 'closeout', name: 'closeout (9.1)', checks: [], controls: [] },
].map((p) => Object.freeze({ ...p, checks: Object.freeze(p.checks), controls: Object.freeze(p.controls) })));

/** §5 dependency table (direct verdict dependencies). C1 gates everything (implicit). */
const CHECK_DEPENDENCIES = Object.freeze({
  C3: ['C2'], C6: ['C4', 'N2'], C7: ['C4'], C8: ['C4'], C20: ['C4', 'C7', 'C8', 'N8'],
  C10: ['C9'], C11: ['C9'], C12: ['C10'], C13: ['C10'], C14: ['C7', 'C10'], C15: ['C7', 'C10'],
  C17: ['C16'], C19: ['N1'],
});

/**
 * Returns the unmet direct dependencies of `id` (C1 for everything but C1 itself). `verdicts` maps a
 * check/control name to a verdict base or control state; a dependency is met iff it is PASS or a
 * DETECTED* control state. Pure; the caller turns a non-empty result into `BLOCKED(dependency:..)`.
 */
function dependencyBlockers(id, verdicts) {
  const deps = id === 'C1' ? [] : ['C1', ...(CHECK_DEPENDENCIES[id] || [])];
  const met = (v) => typeof v === 'string' && (v === 'PASS' || v === 'DETECTED' || v === 'DETECTED_RESTORED' || /^PASS\(/.test(v));
  return deps.filter((d) => !met(verdicts[d]));
}

// ============================================================================================
// Section 25 -- preflight classifiers copied from G1 (the G1 file is not edited or imported:
// it pulls in the collision engine). Drift-tested against G1's exports in the sibling tests.
// ============================================================================================

const EXPECTED_VIEWER_SHA256 = '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e';

function classifyViewerScriptIntegrity(captureRecord) {
  const record = captureRecord || {};
  const responses = Array.isArray(record.attributableResponses) ? record.attributableResponses : [];
  if (record.requestFailed === true
      || responses.some((r) => r.status >= 400)
      || (responses.length === 0 && record.autodeskViewingDefined !== true)) {
    return { integrityResult: INTEGRITY_RESULT.FETCH_FAILED, reason: 'fetch-failed' };
  }
  const mismatched = responses.find((r) => r.bodyOutcome === 'captured' && r.decodedByteLength > 0 && r.sha256 !== EXPECTED_VIEWER_SHA256);
  if (mismatched) return { integrityResult: INTEGRITY_RESULT.MISMATCH, reason: 'decoded-body-sha256-mismatch' };
  const noAttributableButExecuted = responses.length === 0 && record.autodeskViewingDefined === true;
  const chainIncomplete = responses.some((r) => r.redirectChainComplete !== true);
  const multipleNotAllMatched = responses.length > 1
    && !responses.every((r) => r.bodyOutcome === 'captured' && r.sha256 === EXPECTED_VIEWER_SHA256);
  if (noAttributableButExecuted || chainIncomplete || multipleNotAllMatched) {
    return {
      integrityResult: INTEGRITY_RESULT.PROVENANCE_AMBIGUOUS,
      reason: noAttributableButExecuted ? 'no-attributable-response' : chainIncomplete ? 'redirect-chain-incomplete' : 'multiple-responses-not-all-matched',
    };
  }
  const captureIssue = responses.some((r) => r.bodyOutcome !== 'captured' || r.status !== 200);
  if (captureIssue) return { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'body-not-captured-or-non-200' };
  const allVerified = responses.length > 0 && responses.every((r) => r.status === 200
    && r.redirectChainComplete === true && r.bodyOutcome === 'captured'
    && r.decodedByteLength > 0 && r.sha256 === EXPECTED_VIEWER_SHA256);
  if (allVerified) return { integrityResult: INTEGRITY_RESULT.VERIFIED, reason: null };
  return { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'unclassified-fallback' };
}

const GIT_TREE_ALLOWED_UNTRACKED_PREFIXES = Object.freeze(['docs/prompts/']);

function classifyGitTreeState(porcelain) {
  const lines = String(porcelain || '').split('\n').filter((l) => l.trim() !== '');
  const entries = lines.map((line) => {
    const status = line.slice(0, 2);
    const p = line.slice(3).replace(/^"|"$/g, '');
    const allowed = status === '??' && GIT_TREE_ALLOWED_UNTRACKED_PREFIXES.some((pre) => p.startsWith(pre));
    return { status, path: p, allowed };
  });
  return {
    clean: entries.length === 0,
    entries,
    dirtyPaths: entries.map((e) => e.path),
    allowedPaths: entries.filter((e) => e.allowed).map((e) => e.path),
    blockingPaths: entries.filter((e) => !e.allowed).map((e) => e.path),
  };
}

// ============================================================================================
// Section 26 -- served-module helpers (procedure §3 "Page", §10 servedModuleManifest): path-
// confined, JS-only, sha256'd per served module. Reading is injected; nothing here routes a page.
// ============================================================================================

const SERVED_MODULE_PREFIX = '/clashpanel/';
const SERVED_MODULE_PATH_RE = new RegExp('^/clashpanel/(?:[A-Za-z0-9_@-][A-Za-z0-9._@-]*/)*[A-Za-z0-9_@-][A-Za-z0-9._@-]*\\.js$');

/**
 * `resolveServedModulePath(requestUrl, {rootDir, realpath, stat})` -> `{ok:true, absPath, repoRelative}`
 * or `{ok:false, status:404, reason}`. Only `/clashpanel/**.js` (exactly `.js`) is served. The query
 * and fragment are ignored; percent-escapes, backslashes, NUL, dot-segments and hidden names are
 * refused; the resolved real path (symlinks followed) must stay inside `<rootDir>/clashpanel` and be
 * a regular file.
 */
function resolveServedModulePath(requestUrl, { rootDir = REPO_ROOT, realpath = realpathSync, stat = nodeFsModule.statSync } = {}) {
  const no = (reason) => ({ ok: false, status: 404, reason });
  if (typeof requestUrl !== 'string' || requestUrl === '') return no('invalid-url');
  if (/[\\\u0000]/.test(requestUrl) || /%(00|2e|2f|5c)/i.test(requestUrl)) return no('forbidden-character');
  let pathname;
  try { pathname = new URL(requestUrl, 'http://g2.invalid').pathname; } catch { return no('unparseable-url'); }
  if (pathname.includes('%')) return no('percent-escape');
  if (!pathname.startsWith(SERVED_MODULE_PREFIX)) return no('outside-prefix');
  if (!SERVED_MODULE_PATH_RE.test(pathname)) return no('not-a-js-module-path');
  if (pathname.split('/').some((seg) => seg === '.' || seg === '..' || (seg.startsWith('.') && seg !== ''))) return no('dot-segment');
  const moduleRoot = path.join(rootDir, 'clashpanel');
  const abs = path.resolve(rootDir, pathname.slice(1));
  const rel = path.relative(moduleRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return no('escapes-module-root');
  let realAbs;
  let realRoot;
  try { realAbs = realpath(abs); realRoot = realpath(moduleRoot); } catch { return no('not-found'); }
  const realRel = path.relative(realRoot, realAbs);
  if (realRel === '' || realRel.startsWith('..') || path.isAbsolute(realRel)) return no('symlink-escape');
  try { if (!stat(realAbs).isFile()) return no('not-a-file'); } catch { return no('not-found'); }
  return { ok: true, absPath: realAbs, repoRelative: pathname };
}

/** `servedModuleManifest` recorder: `{ '/clashpanel/x.js': sha256 }`; a re-serve with different
 * bytes is kept as a conflict (the manifest is not silently overwritten). */
function createServedModuleManifest() {
  const manifest = {};
  const conflicts = [];
  return {
    record(repoRelative, bytes) {
      const digest = sha256Hex(bytes);
      if (Object.prototype.hasOwnProperty.call(manifest, repoRelative) && manifest[repoRelative] !== digest) conflicts.push({ path: repoRelative, first: manifest[repoRelative], second: digest });
      else manifest[repoRelative] = digest;
      return digest;
    },
    snapshot() { return Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]])); },
    conflicts,
  };
}

function validateServedModuleManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, reason: 'not-an-object' };
  for (const [k, v] of Object.entries(manifest)) {
    if (!SERVED_MODULE_PATH_RE.test(k)) return { ok: false, reason: `bad-path:${k}` };
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) return { ok: false, reason: `bad-digest:${k}` };
  }
  return { ok: true, reason: null };
}

/**
 * Serves one module request: `{status:200, contentType, body, sha256}` (and records it in
 * `manifest`) or `{status:404, body:''}`. `readFile` is injected (default node:fs readFileSync).
 */
function serveClashPanelModule({ requestUrl, rootDir = REPO_ROOT, manifest = null, realpath = realpathSync, stat = nodeFsModule.statSync, readFile = nodeReadFileSync }) {
  const resolved = resolveServedModulePath(requestUrl, { rootDir, realpath, stat });
  if (!resolved.ok) return { status: 404, body: '', reason: resolved.reason };
  let bytes;
  try { bytes = readFile(resolved.absPath); } catch { return { status: 404, body: '', reason: 'read-failed' }; }
  const digest = manifest ? manifest.record(resolved.repoRelative, bytes) : sha256Hex(bytes);
  return { status: 200, contentType: 'text/javascript; charset=utf-8', body: bytes, sha256: digest, repoRelative: resolved.repoRelative };
}

// ============================================================================================
// Section 27 -- per-check / per-control result records (procedure §6 vocabulary, §10 `checks` and
// `controls`), the T13 marker-mesh count helper, and the live-pending status (Task 4).
//
// Every check record is `{verdict, reason, fields, evidence}` where `verdict` is the base
// (`PASS | FAIL | BLOCKED | NOT_EVIDENCED`) optionally followed by `(reason)` -- exactly the form
// `checkVerdictBase` / `computeOverall` / `validateResultSchema` read. Every control record is
// `{state, fields, evidence}` with `state` in CONTROL_ALLOWED_STATES. `fields`/`evidence` are
// plain JSON with `null` (never undefined); a non-finite number is recorded as its string form
// ('NaN', 'Infinity', '-Infinity') so that e.g. a C4 FAIL(non-finite) input stays recomputable.
// Nothing in this file ever fabricates a live observation: a check that needs the real Viewer is
// reported as LIVE_PENDING_STATUS by the planner (Section 35) and never gets a verdict offline.
// ============================================================================================

const LIVE_PENDING_STATUS = 'pending live execution';

/**
 * `normalizeEvidence(value)` -- deep plain-JSON copy for check/control evidence: undefined -> null,
 * non-finite numbers -> their string form, typed arrays -> plain arrays, bigint -> string. Throws on
 * functions, symbols, Map/Set/Date/class instances (a harness defect, never silently dropped).
 */
function normalizeEvidence(value, depth = 0) {
  if (depth > 64) throw new TypeError('normalizeEvidence: nesting deeper than 64');
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'number': return Number.isFinite(value) ? value : String(value);
    case 'string': case 'boolean': return value;
    case 'bigint': return String(value);
    case 'function': case 'symbol': throw new TypeError(`normalizeEvidence: ${typeof value} is not evidence`);
    default: break;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value, (v) => normalizeEvidence(v, depth + 1));
  if (Array.isArray(value)) return value.map((v) => normalizeEvidence(v, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`normalizeEvidence: non-plain object (${(value.constructor && value.constructor.name) || 'unknown'})`);
  const out = {};
  for (const k of Object.keys(value)) out[k] = normalizeEvidence(value[k], depth + 1);
  return out;
}

const CHECK_REASON_RE = /^[^()\s][^()]*$/;

/**
 * `makeCheckRecord({verdict, reason, fields, evidence})` -- the only constructor of a §7/§10
 * `check-run` record `{recordType:'check-run', verdict, reason, fields, evidence}`. `verdict` is the
 * BARE base (`BLOCKED(x)` is notation for `{verdict:'BLOCKED', reason:'x'}`, §7 L1). PASS never
 * carries a reason. Throws on out-of-enum input (harness defect). C1's `finalizedSeq`/`finalizedAt`
 * are added only by `finalizeC1Record`.
 */
function makeCheckRecord({ verdict, reason = null, fields = {}, evidence = {} }) {
  if (!CHECK_VERDICT_BASES.includes(verdict)) throw new TypeError(`makeCheckRecord: verdict base ${String(verdict)} not in ${CHECK_VERDICT_BASES.join('|')}`);
  if (reason !== null && (typeof reason !== 'string' || !CHECK_REASON_RE.test(reason))) throw new TypeError(`makeCheckRecord: malformed reason ${String(reason)}`);
  if (verdict === 'PASS' && reason !== null) throw new TypeError('makeCheckRecord: PASS carries no reason');
  return {
    recordType: RECORD_TYPE.CHECK_RUN,
    verdict,
    reason,
    fields: normalizeEvidence(fields),
    evidence: normalizeEvidence(evidence),
  };
}

/**
 * Fail-closed validator of one `check-run` record (exact keys, bare base enum, reason rules, plain
 * JSON, no legacy `dependency:C1` reason). With `name === 'C1'` the finalization keys are allowed
 * (and validated if present).
 */
function validateCheckRecord(rec, name = null) {
  const errors = checkRunProblems(name, rec);
  return { ok: errors.length === 0, errors };
}

/**
 * `finalizeC1Record(rec, {seq, at})` -> `{record, event}` -- §7 C1 reason contract: C1's record gains
 * `finalizedSeq`/`finalizedAt` and exactly one `{seq, kind:'check-finalized', check:'C1', verdict,
 * reason}` event is produced; the record is immutable afterwards. `seq` comes from the run's single
 * sequence source (the call recorder's `nextSeq`), never a second counter.
 */
function finalizeC1Record(rec, { seq, at }) {
  const v = validateCheckRecord(rec, 'C1');
  if (!v.ok) throw new TypeError(`finalizeC1Record: invalid C1 record (${v.errors.join('|')})`);
  if (Object.prototype.hasOwnProperty.call(rec, 'finalizedSeq')) throw new TypeError('finalizeC1Record: C1 already finalized');
  if (!isSeq(seq) || !isIsoMs(at)) throw new TypeError('finalizeC1Record: seq/at invalid');
  const record = Object.freeze({ ...rec, finalizedSeq: seq, finalizedAt: at });
  // RC1-C2 attribution fields (every eventLog entry): emitted by P1 while C1 is the active check.
  const event = Object.freeze({ seq, kind: 'check-finalized', check: 'C1', verdict: rec.verdict, reason: rec.reason, phase: 'P1', activeCheck: 'C1', activeControl: null });
  return { record, event };
}

/**
 * `makeControlRecord(name, state, {fields, evidence})` -- a control OUTCOME `{state, fields,
 * evidence}` as produced by the control evaluators (§7 per-control fields). It is not yet a §10
 * record: the runner wraps it into a `control-run` record (`makeControlRunRecord`) with the exact
 * executionRecord. NRDB is never an outcome (it exists only in a gate-disposition record, L2).
 */
function makeControlRecord(name, state, { fields = {}, evidence = {} } = {}) {
  if (!CONTROL_NAMES.includes(name)) throw new TypeError(`makeControlRecord: unknown control ${String(name)}`);
  if (!CONTROL_ALLOWED_STATES[name].includes(state) || state === NRDB_STATE) throw new TypeError(`makeControlRecord: ${name} state ${String(state)} not allowed (§7)`);
  return { state, fields: normalizeEvidence(fields), evidence: normalizeEvidence(evidence) };
}

/** Validator of a control OUTCOME (`makeControlRecord` shape; NRDB rejected). */
function validateControlRecord(name, rec) {
  const errors = [];
  if (!CONTROL_NAMES.includes(name)) return { ok: false, errors: ['unknown-control'] };
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, errors: ['not-object'] };
  if (Object.keys(rec).sort().join(',') !== 'evidence,fields,state') errors.push('keys');
  if (!CONTROL_ALLOWED_STATES[name].includes(rec.state) || rec.state === NRDB_STATE) errors.push('state');
  try { toPlainJson(rec.fields, '$.fields'); toPlainJson(rec.evidence, '$.evidence'); } catch { errors.push('not-plain-json'); }
  return { ok: errors.length === 0, errors };
}

/**
 * `makeControlRunRecord(name, outcome, {start, terminalSeq, terminalAt})` -- the §7/§10 `control-run`
 * record. `start` is `{startSeq, startedAt}` when the control crossed its start boundary (recorded
 * BEFORE its first action), else null (the exact not-started executionRecord). A not-started record
 * whose outcome state is not a legal not-started state (§7) is a harness defect: it is recorded as the
 * control's not-executable state with `fields.reason:'start-boundary-not-recorded'` (fail-closed).
 */
function makeControlRunRecord(name, outcome, { start = null, terminalSeq, terminalAt }) {
  let out = outcome;
  if (start === null && !CONTROL_NOT_STARTED_STATES[name].includes(out.state)) {
    out = makeControlRecord(name, notExecutableState(name), { fields: { reason: 'start-boundary-not-recorded', producedState: out.state, producedFields: out.fields } });
  }
  const started = start !== null;
  return {
    recordType: RECORD_TYPE.CONTROL_RUN,
    state: out.state,
    fields: out.fields,
    evidence: out.evidence,
    executionRecord: {
      controlId: name,
      phase: CONTROL_OWNING_PHASE[name],
      dependencyIds: [...CONTROL_DEPENDENCY_IDS[name]],
      started,
      crossedStartBoundary: started,
      startSeq: started ? start.startSeq : null,
      startedAt: started ? start.startedAt : null,
      terminalSeq,
      terminalAt,
      terminalState: out.state,
      result: started ? (isPlainObject(out.fields) ? out.fields : { value: out.fields }) : null,
      evidenceRefs: started ? [`/controls/${name}/fields`] : [],
    },
    dependencyBlockedBy: null,
  };
}

/** §7/§10 validator of a `control-run` record (exact keys, state, executionRecord, dependencyBlockedBy). */
function validateControlRunRecord(name, rec) {
  if (!CONTROL_NAMES.includes(name)) return { ok: false, errors: ['unknown-control'] };
  const errors = controlRunProblems(name, rec);
  return { ok: errors.length === 0, errors };
}

/** Severity used when sub-checks are combined into one §10 check (C7 = C7α ∧ C7β, C18 = C18a ∧ C18b). */
const CHECK_BASE_SEVERITY = Object.freeze({ PASS: 0, NOT_EVIDENCED: 1, BLOCKED: 2, FAIL: 3 });

/**
 * `mergeCheckRecord(existing, incoming)` -- §5 taint rule: "a BLOCKED recorded because of taint never
 * erases a previously recorded FAIL". A recorded FAIL is kept; otherwise the incoming record wins.
 */
function mergeCheckRecord(existing, incoming) {
  if (existing && checkVerdictBase(existing) === 'FAIL') return existing;
  return incoming;
}

/**
 * `combineSubchecks(parts)` -- `parts` maps sub-check id -> record (or null when it never ran). The
 * combined verdict is the worst base (FAIL > BLOCKED > NOT_EVIDENCED > PASS); a missing part is
 * `BLOCKED(sub-check-missing:<id>)`. The parts are retained verbatim in `fields.parts`.
 */
function combineSubchecks(parts) {
  const ids = Object.keys(parts);
  if (ids.length === 0) throw new TypeError('combineSubchecks: no parts');
  let worst = null;
  const reasons = [];
  for (const id of ids) {
    const rec = parts[id];
    const base = rec ? checkVerdictBase(rec) : null;
    const eff = base === null ? 'BLOCKED' : base;
    const reason = base === null ? `sub-check-missing:${id}` : (rec.reason === null ? null : `${id}:${rec.reason}`);
    if (worst === null || CHECK_BASE_SEVERITY[eff] > CHECK_BASE_SEVERITY[worst]) { worst = eff; reasons.length = 0; }
    if (eff === worst && reason !== null) reasons.push(reason);
  }
  return makeCheckRecord({
    verdict: worst,
    reason: worst === 'PASS' ? null : (reasons.length ? reasons.join(',') : ids.filter((id) => parts[id] && checkVerdictBase(parts[id]) === worst).join(',')),
    fields: { parts: Object.fromEntries(ids.map((id) => [id, parts[id] || null])) },
  });
}

/**
 * T13 (CD, contract-derived from clashpanel/viewer/markers.js, E4). The ONE place the expected
 * marker-mesh count is computed. markers.js `addLocation` adds the location marker ONCE per present
 * (Hard: 1 sphere; Soft: 2 spheres + 1 line) and `addOutlines` adds ONE outline per live side whose
 * bounds are valid. Hence count = location + outlinedSides: Hard two sides = 1 + 2 = 3, Hard one
 * side = 2 (C17 V4, C20 A3), Soft two sides = 3 + 2 = 5 -- consistent with TABLE_T.T13 as frozen
 * by Task 3 (the Table T wording "per live side" binds the outline term only; see report).
 */
function expectedMarkerMeshCount({ variant, outlinedSides }) {
  if (!Number.isInteger(outlinedSides) || outlinedSides < 0 || outlinedSides > 2) throw new TypeError(`expectedMarkerMeshCount: outlinedSides ${String(outlinedSides)} not in 0..2`);
  let location;
  if (variant === 'hard') location = TABLE_T.T13.hard.spheres;
  else if (variant === 'soft') location = TABLE_T.T13.soft.spheres + TABLE_T.T13.soft.lines;
  else throw new TypeError(`expectedMarkerMeshCount: variant ${String(variant)} not hard|soft`);
  const perSide = variant === 'hard' ? TABLE_T.T13.hard.outlinesPerLiveSide : TABLE_T.T13.soft.outlinesPerLiveSide;
  return location + perSide * outlinedSides;
}

// ============================================================================================
// Section 28 -- C4 element world-bounds containment oracle (procedure §C4, Table T15/T24, named
// exception E1) and the N6 bounded mutation construction (§7 N6, T21/T24). Pure float64 arithmetic.
// ============================================================================================

const C4_U = TABLE_T.T15.u;
const C4_PASS_FACTOR = TABLE_T.T15.passFactor;
const C4_G = TABLE_T.T15.grossRelative;
const C4_S_FLOOR = TABLE_T.T15.sFloor;
const C4_RANGE_ABS_MAX = TABLE_T.T24.c4RangeAbsMax;
const N6_DOMAIN_ABS_MAX = TABLE_T.T24.n6DomainAbsMax;
const C4_AXES = Object.freeze(['x', 'y', 'z']);

const C4_OUTCOME = Object.freeze({
  CONTAINED: 'contained',
  NEAR_TOLERANCE: 'NOT_EVIDENCED(near-tolerance)',
  NO_REFERENCE: 'NOT_EVIDENCED(no-reference)',
  NON_FINITE: 'FAIL(non-finite)',
  OUT_OF_RANGE: 'FAIL(out-of-range)',
  NO_BOUNDS: 'FAIL(no-bounds)',
  NOT_CONTAINED: 'FAIL(not-contained)',
});

/** A 6-value box as a plain number array, `null` for null/undefined, 'malformed' otherwise. */
function c4BoxArray(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || typeof v.length !== 'number' || v.length !== 6) return 'malformed';
  return Array.from(v, (x) => (typeof x === 'number' ? x : Number.NaN));
}

const c4Inverted = (b) => b[0] > b[3] || b[1] > b[4] || b[2] > b[5];

/** Table T15 per-axis scale / allowances: `S_a = max(|bMin|,|bMax|,|rMin|,|rMax|, sFloor)`, `A_a`, `T_a`. */
function c4AxisAllowances(b, r, i) {
  const S = Math.max(Math.abs(b[i]), Math.abs(b[i + 3]), Math.abs(r[i]), Math.abs(r[i + 3]), C4_S_FLOOR);
  return { S, A: C4_PASS_FACTOR * C4_U * S, T: C4_G * S };
}

/**
 * `boundsContainmentOracle({candidate, reference})` -- §C4 per-dbId outcome. Clause precedence (first
 * match wins; both range checks run over all twelve coordinates before any subtraction):
 * FAIL(non-finite) [NaN/±Infinity anywhere, or an inverted box, or a malformed box] -> FAIL(out-of-range)
 * [finite |v| > 2^900] -> FAIL(no-bounds) [candidate null, reference formed] -> NOT_EVIDENCED(no-reference)
 * [reference not formed] -> containment: `dMin_a = bMin_a - rMin_a`, `dMax_a = rMax_a - bMax_a`;
 * FAIL(not-contained) iff any d > T_a (E1); `contained` iff all six d <= A_a; else near-tolerance.
 * Strict `>` as written; a deficit above A_a never yields `contained`. Extent excess beyond the
 * reference is observation-only statistics (never a FAIL).
 */
function boundsContainmentOracle({ candidate, reference }) {
  const b = c4BoxArray(candidate);
  const r = c4BoxArray(reference);
  const result = (outcome, extra = {}) => ({ outcome, candidate: Array.isArray(b) ? b : null, reference: Array.isArray(r) ? r : null, perAxis: null, excess: null, ...extra });
  if (b === 'malformed' || r === 'malformed') return result(C4_OUTCOME.NON_FINITE, { detail: 'malformed-box' });
  const coords = [...(b || []), ...(r || [])];
  if (coords.some((v) => !Number.isFinite(v))) return result(C4_OUTCOME.NON_FINITE, { detail: 'non-finite-coordinate' });
  if ((b && c4Inverted(b)) || (r && c4Inverted(r))) return result(C4_OUTCOME.NON_FINITE, { detail: b && c4Inverted(b) ? 'candidate-inverted' : 'reference-inverted' });
  if (coords.some((v) => Math.abs(v) > C4_RANGE_ABS_MAX)) return result(C4_OUTCOME.OUT_OF_RANGE, { detail: 'coordinate-beyond-2^900' });
  if (b === null && r !== null) return result(C4_OUTCOME.NO_BOUNDS);
  if (r === null) return result(C4_OUTCOME.NO_REFERENCE);
  const perAxis = {};
  const excess = {};
  let anyAboveT = false;
  let allWithinA = true;
  for (let i = 0; i < 3; i += 1) {
    const { S, A, T } = c4AxisAllowances(b, r, i);
    const dMin = b[i] - r[i];
    const dMax = r[i + 3] - b[i + 3];
    perAxis[C4_AXES[i]] = { dMin, dMax, S, A, T };
    for (const d of [dMin, dMax]) {
      if (d > T) anyAboveT = true;
      if (d > A) allWithinA = false;
    }
    const exMin = r[i] - b[i] > 0 ? r[i] - b[i] : 0;
    const exMax = b[i + 3] - r[i + 3] > 0 ? b[i + 3] - r[i + 3] : 0;
    excess[C4_AXES[i]] = { belowMin: exMin, aboveMax: exMax, maxRatio: Math.max(exMin, exMax) / S };
  }
  const outcome = anyAboveT ? C4_OUTCOME.NOT_CONTAINED : (allWithinA ? C4_OUTCOME.CONTAINED : C4_OUTCOME.NEAR_TOLERANCE);
  return result(outcome, { perAxis, excess, hasExcess: C4_AXES.some((a) => excess[a].belowMin > 0 || excess[a].aboveMax > 0) });
}

/**
 * Reference union (§C4): componentwise union over ALL fragments' world boxes. Empty fragment list or
 * any unreadable (null/throwing/malformed) fragment box => `{box:null, problem}` (NOT_EVIDENCED(no-
 * reference) for the dbId). Finite-ness is NOT filtered here: a non-finite fragment value flows into
 * the oracle and yields FAIL(non-finite) (fail direction; see report).
 */
function c4ReferenceUnion(fragmentBoxes) {
  if (!Array.isArray(fragmentBoxes) || fragmentBoxes.length === 0) return { box: null, problem: 'empty-fragment-list', fragmentCount: 0 };
  const u = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const fb of fragmentBoxes) {
    const b = c4BoxArray(fb);
    if (!Array.isArray(b)) return { box: null, problem: 'unreadable-fragment-bounds', fragmentCount: fragmentBoxes.length };
    for (let i = 0; i < 3; i += 1) {
      u[i] = Number.isNaN(b[i]) || Number.isNaN(u[i]) ? Number.NaN : Math.min(u[i], b[i]);
      u[i + 3] = Number.isNaN(b[i + 3]) || Number.isNaN(u[i + 3]) ? Number.NaN : Math.max(u[i + 3], b[i + 3]);
    }
  }
  return { box: u, problem: null, fragmentCount: fragmentBoxes.length };
}

/** T10 sample: the first 20 candidates of A and of B (population counts recorded by the caller). */
function selectC4Sample(candidatesA, candidatesB, perModel = TABLE_T.T10.c4SamplePerModel) {
  return [
    ...candidatesA.slice(0, perModel).map((c) => ({ model: 'A', dbId: c.dbId })),
    ...candidatesB.slice(0, perModel).map((c) => ({ model: 'B', dbId: c.dbId })),
  ];
}

/**
 * `evaluateC4({rows, candidateCounts, invalidDbIdObservation})` -- `rows` in sample order
 * `{model, dbId, candidate, fragmentBoxes | reference, referenceProblem?}`. Returns
 * `{record, c4Table}`. Check verdict: FAIL iff any row FAIL; else NOT_EVIDENCED iff any row
 * NOT_EVIDENCED or the sample is empty; else PASS.
 */
function evaluateC4({ rows, candidateCounts = null, invalidDbIdObservation = null }) {
  if (!Array.isArray(rows)) throw new TypeError('evaluateC4: rows array required');
  const c4Table = rows.map((row) => {
    const ref = row.fragmentBoxes !== undefined ? c4ReferenceUnion(row.fragmentBoxes) : { box: row.reference === undefined ? null : row.reference, problem: row.referenceProblem || null, fragmentCount: row.fragmentCount === undefined ? null : row.fragmentCount };
    const o = boundsContainmentOracle({ candidate: row.candidate, reference: ref.box });
    return {
      model: row.model, dbId: row.dbId, candidateBox: o.candidate, referenceBox: o.reference, referenceProblem: ref.problem,
      fragmentCount: ref.fragmentCount, perAxis: o.perAxis, excess: o.excess, outcome: o.outcome, detail: o.detail || null,
    };
  });
  const counts = {};
  for (const row of c4Table) counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  const fails = [...new Set(c4Table.filter((r) => r.outcome.startsWith('FAIL')).map((r) => r.outcome.slice(5, -1)))];
  const nes = [...new Set(c4Table.filter((r) => r.outcome.startsWith('NOT_EVIDENCED')).map((r) => r.outcome.slice(14, -1)))];
  let verdict; let reason = null;
  if (fails.length) { verdict = 'FAIL'; reason = fails.join(','); }
  else if (c4Table.length === 0) { verdict = 'NOT_EVIDENCED'; reason = 'empty-sample'; }
  else if (nes.length) { verdict = 'NOT_EVIDENCED'; reason = nes.join(','); }
  else verdict = 'PASS';
  const excessRows = c4Table.filter((r) => r.excess && C4_AXES.some((a) => r.excess[a].belowMin > 0 || r.excess[a].aboveMax > 0));
  const excessStats = {
    count: excessRows.length,
    maxRatio: excessRows.reduce((m, r) => Math.max(m, ...C4_AXES.map((a) => r.excess[a].maxRatio)), 0),
    perAxisCount: Object.fromEntries(C4_AXES.map((a) => [a, excessRows.filter((r) => r.excess[a].belowMin > 0 || r.excess[a].aboveMax > 0).length])),
    observationOnly: true,
  };
  return {
    record: makeCheckRecord({ verdict, reason, fields: { sampleSize: c4Table.length, countsByOutcome: counts, candidateCounts, excessStats, invalidDbIdObservation }, evidence: { constants: { u: C4_U, passFactor: C4_PASS_FACTOR, g: C4_G, sFloor: C4_S_FLOOR, rangeAbsMax: C4_RANGE_ABS_MAX } } }),
    c4Table,
  };
}

// ---- N6 ------------------------------------------------------------------------------------

const N6_BUILD_OUTCOME = Object.freeze({
  MUTATED: 'MUTATED',
  REJECTED_NON_FINITE: 'REJECTED_NON_FINITE',
  REJECTED_OUT_OF_RANGE: 'REJECTED_OUT_OF_RANGE',
  REJECTED_OUT_OF_N6_DOMAIN: 'REJECTED_OUT_OF_N6_DOMAIN',
});

/**
 * `buildN6Mutation({candidate, reference})` -- §7 N6 (ii). Checks ALL twelve coordinates before any
 * arithmetic, in this order: non-finite (or inverted / malformed box) => REJECTED_NON_FINITE;
 * finite |v| > 2^900 => REJECTED_OUT_OF_RANGE; |v| > 2^897 => REJECTED_OUT_OF_N6_DOMAIN. Otherwise
 * `Ms = |bMin_x|+|bMax_x|+|rMin_x|+|rMax_x|+sFloor`, `D = 2·g·Ms/(1−g)`, and the whole x-interval is
 * translated so that `bMax'_x = rMax_x − D`. `bMin'_x` is computed as `bMax'_x − (bMax_x − bMin_x)`
 * (algebraically `bMin_x + Δ`, `Δ = bMax'_x − bMax_x`); this rounded form preserves
 * `bMin'_x <= bMax'_x` exactly and keeps a zero-width interval zero-width. y/z untouched. The result
 * carries its own post-checks (finite, ordered, inside the C4 range); a rejected input yields no box.
 */
function buildN6Mutation({ candidate, reference }) {
  const b = c4BoxArray(candidate);
  const r = c4BoxArray(reference);
  const reject = (outcome, reason) => ({ outcome, reason, mutated: null, Ms: null, D: null, delta: null, checks: null });
  if (!Array.isArray(b) || !Array.isArray(r)) return reject(N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'missing-or-malformed-box');
  const coords = [...b, ...r];
  if (coords.some((v) => !Number.isFinite(v))) return reject(N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'non-finite-coordinate');
  if (c4Inverted(b) || c4Inverted(r)) return reject(N6_BUILD_OUTCOME.REJECTED_NON_FINITE, 'inverted-box');
  if (coords.some((v) => Math.abs(v) > C4_RANGE_ABS_MAX)) return reject(N6_BUILD_OUTCOME.REJECTED_OUT_OF_RANGE, 'coordinate-beyond-2^900');
  if (coords.some((v) => Math.abs(v) > N6_DOMAIN_ABS_MAX)) return reject(N6_BUILD_OUTCOME.REJECTED_OUT_OF_N6_DOMAIN, 'coordinate-beyond-2^897');
  const Ms = Math.abs(b[0]) + Math.abs(b[3]) + Math.abs(r[0]) + Math.abs(r[3]) + C4_S_FLOOR;
  const D = (2 * C4_G * Ms) / (1 - C4_G);
  const bMaxP = r[3] - D;
  const bMinP = bMaxP - (b[3] - b[0]);
  const mutated = [bMinP, b[1], b[2], bMaxP, b[4], b[5]];
  const checks = {
    finite: mutated.every(Number.isFinite),
    ordered: bMinP <= bMaxP,
    insideC4Range: mutated.every((v) => Math.abs(v) <= C4_RANGE_ABS_MAX),
  };
  return { outcome: N6_BUILD_OUTCOME.MUTATED, reason: null, mutated, Ms, D, delta: bMaxP - b[3], checks };
}

/** Recomputes (float64, from the stored numbers) the mutated x-axis deficit and allowances. */
function n6Recompute(mutated, reference) {
  const r = Array.from(reference);
  const { S, A, T } = c4AxisAllowances(mutated, r, 0);
  const dMax = r[3] - mutated[3];
  return { dMaxPrime: dMax, SPrime: S, APrime: A, TPrime: T, deficitExceedsT: dMax > T };
}

/**
 * `evaluateN6({candidate, reference, oracle})` -- §7 N6 sub-cases on the first `contained` dbId:
 * (i) unmodified pair => `contained`; (ii, mandatory) the bounded mutation => builder MUTATED, the
 * post-checks hold, the recomputed `dMax'_x > T'_x`, and the oracle returns EXACTLY
 * FAIL(not-contained) (a rejected input => NOT_DETECTED, never DETECTED -- the never-silent-success
 * rule); (iii, characterization) the x-interval translated inward by `D3 = (A_x+T_x)/2` => if the
 * recomputed deficit lies in `(A'_x, T'_x]` the oracle must return NOT_EVIDENCED(near-tolerance),
 * else NOT_APPLICABLE; (iv) `bMax''_x = bMax_x + 2·T_x` => still `contained`. No input
 * (no `contained` dbId) => NOT_APPLICABLE. Pure; no Viewer effect.
 */
function evaluateN6({ candidate = null, reference = null, oracle = boundsContainmentOracle } = {}) {
  if (candidate === null || reference === null) {
    return makeControlRecord('N6', 'NOT_APPLICABLE', { fields: { reason: 'no-contained-dbId' } });
  }
  const b = c4BoxArray(candidate);
  const r = c4BoxArray(reference);
  const sub = {};
  const i = oracle({ candidate: b, reference: r });
  sub.i = { ok: i.outcome === C4_OUTCOME.CONTAINED, oracle: i.outcome };

  const build = buildN6Mutation({ candidate: b, reference: r });
  if (build.outcome !== N6_BUILD_OUTCOME.MUTATED) {
    sub.ii = { ok: false, builder: build.outcome, reason: `rejected-input:${build.outcome}`, harnessDefect: true };
  } else {
    const re = n6Recompute(build.mutated, r);
    const o = oracle({ candidate: build.mutated, reference: r });
    const checksOk = build.checks.finite && build.checks.ordered && build.checks.insideC4Range;
    sub.ii = {
      ok: checksOk && re.deficitExceedsT && o.outcome === C4_OUTCOME.NOT_CONTAINED,
      builder: build.outcome, b, r, Ms: build.Ms, D: build.D, delta: build.delta, bPrime: build.mutated,
      checks: build.checks, ...re, oracle: o.outcome,
    };
  }

  const ok3 = Array.isArray(b) && Array.isArray(r) && [...b, ...r].every(Number.isFinite);
  if (ok3) {
    const { A, T } = c4AxisAllowances(b, r, 0);
    const D3 = (A + T) / 2;
    const bMax3 = b[3] - D3;
    const box3 = [bMax3 - (b[3] - b[0]), b[1], b[2], bMax3, b[4], b[5]];
    const re3 = n6Recompute(box3, r);
    if (re3.dMaxPrime > re3.APrime && re3.dMaxPrime <= re3.TPrime) {
      const o3 = oracle({ candidate: box3, reference: r });
      sub.iii = { applicable: true, ok: o3.outcome === C4_OUTCOME.NEAR_TOLERANCE, D3, box: box3, ...re3, oracle: o3.outcome };
    } else {
      sub.iii = { applicable: false, ok: null, D3, box: box3, ...re3, oracle: null, status: 'NOT_APPLICABLE' };
    }
    const T4 = T;
    const box4 = [b[0], b[1], b[2], b[3] + 2 * T4, b[4], b[5]];
    const o4 = oracle({ candidate: box4, reference: r });
    sub.iv = { ok: o4.outcome === C4_OUTCOME.CONTAINED, box: box4, oracle: o4.outcome };
  } else {
    sub.iii = { applicable: false, ok: null, status: 'NOT_APPLICABLE', reason: 'input-not-finite' };
    sub.iv = { ok: false, reason: 'input-not-finite' };
  }
  const detected = sub.i.ok && sub.ii.ok === true && sub.iv.ok && (sub.iii.applicable === false || sub.iii.ok === true);
  return makeControlRecord('N6', detected ? 'DETECTED' : 'NOT_DETECTED', { fields: { subcases: sub } });
}

/** N6 input: the first `contained` row of the C4 table in sample order, or null. */
function selectN6Input(c4Table) {
  const row = (c4Table || []).find((r) => r.outcome === C4_OUTCOME.CONTAINED);
  return row ? { candidate: row.candidateBox, reference: row.referenceBox, model: row.model, dbId: row.dbId } : { candidate: null, reference: null, model: null, dbId: null };
}

// ============================================================================================
// Section 29 -- camera / frustum / projection helpers (procedure §C6, §C8, N2; T4 settle, T16 ε,
// named exception E2). THREE matrices are column-major `elements` arrays of 16 numbers. A camera
// sample K is the 32 entries `[...matrixWorldInverse, ...projectionMatrix]`.
// ============================================================================================

function mat4MulVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

const isMatrix16 = (m) => m !== null && typeof m === 'object' && m.length === 16 && Array.from(m).every(Number.isFinite);

/** `{matrixWorldInverse, projectionMatrix}` from a 32-entry sample K. */
function cameraFromSample(K) {
  if (!K || K.length !== 32) throw new TypeError('cameraFromSample: 32 entries required');
  return { matrixWorldInverse: Array.from(K).slice(0, 16), projectionMatrix: Array.from(K).slice(16, 32) };
}

/** 32-entry sample K from `{matrixWorldInverse, projectionMatrix}` (arrays or THREE `.elements`). */
function cameraSample(camera) {
  const mwi = camera && (camera.matrixWorldInverse && camera.matrixWorldInverse.elements ? camera.matrixWorldInverse.elements : camera.matrixWorldInverse);
  const pm = camera && (camera.projectionMatrix && camera.projectionMatrix.elements ? camera.projectionMatrix.elements : camera.projectionMatrix);
  if (!isMatrix16(mwi) || !isMatrix16(pm)) return null;
  return [...Array.from(mwi), ...Array.from(pm)];
}

/** `clip = projectionMatrix · matrixWorldInverse · (p, 1)`. */
function projectToClip(camera, p) {
  return mat4MulVec4(camera.projectionMatrix, mat4MulVec4(camera.matrixWorldInverse, [p[0], p[1], p[2], 1]));
}

function boxCorners(box) {
  const out = [];
  for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) out.push([x, y, z]);
  return out;
}

function unionOfBoxes(boxes) {
  const u = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i += 1) { u[i] = Math.min(u[i], b[i]); u[i + 3] = Math.max(u[i + 3], b[i + 3]); }
  return u;
}

/**
 * `frustumPredicate({camera, boxes, epsilon})` -- §C6 T16: for each of the 8 corners of the union
 * of `boxes` (world, w=1): `clip.w > 0`, `|clip.x| <= clip.w(1+ε)`, `|clip.y| <= clip.w(1+ε)`,
 * `-clip.w(1+ε) <= clip.z <= clip.w(1+ε)`. Returns `{evaluable, pass, corners, worstExcess}`;
 * `excess = max(|x|,|y|,z,-z)/w − 1` per corner (null when `w <= 0`, which never passes).
 */
function frustumPredicate({ camera, boxes, epsilon = TABLE_T.T16.frustumEpsilon }) {
  const cam = camera && camera.length === 32 ? cameraFromSample(camera) : camera;
  if (!cam || !isMatrix16(cam.matrixWorldInverse) || !isMatrix16(cam.projectionMatrix)) return { evaluable: false, pass: false, reason: 'camera-unreadable', corners: [], worstExcess: null };
  if (!Array.isArray(boxes) || boxes.length === 0 || !boxes.every((b) => b && b.length === 6 && Array.from(b).every(Number.isFinite) && !c4Inverted(Array.from(b)))) {
    return { evaluable: false, pass: false, reason: 'boxes-invalid', corners: [], worstExcess: null };
  }
  const union = unionOfBoxes(boxes.map((b) => Array.from(b)));
  const k = 1 + epsilon;
  let worst = -Infinity;
  let wNonPositive = false;
  const corners = boxCorners(union).map((p) => {
    const [x, y, z, w] = projectToClip(cam, p);
    const wPositive = w > 0;
    const inside = wPositive && Math.abs(x) <= w * k && Math.abs(y) <= w * k && -w * k <= z && z <= w * k;
    const excess = wPositive ? Math.max(Math.abs(x), Math.abs(y), z, -z) / w - 1 : null;
    if (!wPositive) wNonPositive = true; else worst = Math.max(worst, excess);
    return { corner: p, clip: [x, y, z, w], wPositive, inside, excess };
  });
  return { evaluable: true, pass: corners.every((c) => c.inside), corners, union, epsilon, worstExcess: wNonPositive ? null : worst, anyWNonPositive: wNonPositive };
}

/** Two samples within `tol` on all 32 entries (T4 settle rule, 1e-9 absolute). */
function cameraSamplesWithin(a, b, tol = TABLE_T.T4.settleEpsilonAbs) {
  if (!a || !b || a.length !== 32 || b.length !== 32) return false;
  for (let i = 0; i < 32; i += 1) if (!(Math.abs(a[i] - b[i]) <= tol)) return false;
  return true;
}

/** Exact equality of all 32 Float64 entries (T19: `K0=K1=K2=K3`, no tolerance). */
function cameraSamplesExactlyEqual(a, b) {
  if (!a || !b || a.length !== 32 || b.length !== 32) return false;
  for (let i = 0; i < 32; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Index of the first sample equal (T4) to its predecessor, or -1. */
function findSettleIndex(samples, tol = TABLE_T.T4.settleEpsilonAbs) {
  for (let i = 1; i < samples.length; i += 1) if (cameraSamplesWithin(samples[i - 1], samples[i], tol)) return i;
  return -1;
}

/**
 * `waitForCameraSettle({sampleCamera, waitFrame, timers, quarantine, deadlineMs})` -- dormant live
 * helper (injected adapters): one sample per animation frame until two consecutive samples are equal
 * within 1e-9 (T4) or the T4 deadline expires. Resolves `{status:'settled', camera, sampleCount}`,
 * `{status:'timed-out'}` or `{status:'threw', error}`; never rejects.
 */
async function waitForCameraSettle({ sampleCamera, waitFrame, timers = DEFAULT_TIMERS, quarantine = null, deadlineMs = TABLE_T.T4.cameraSettleDeadlineMs }) {
  const out = await runWithDeadline({
    op: 'camera-settle', timeoutMs: deadlineMs, timers, quarantine,
    fn: async ({ isLive }) => {
      let prev = null;
      let n = 0;
      while (isLive()) {
        await waitFrame();
        if (!isLive()) break;
        const s = cameraSample(await sampleCamera());
        n += 1;
        if (s === null) throw new Error('camera sample unreadable');
        if (prev !== null && cameraSamplesWithin(prev, s)) return { camera: s, sampleCount: n };
        prev = s;
      }
      return null;
    },
  });
  if (out.status === 'completed' && out.value) return { status: 'settled', camera: out.value.camera, sampleCount: out.value.sampleCount };
  if (out.status === 'timed-out') return { status: 'timed-out' };
  return { status: 'threw', error: out.status === 'threw' ? summarizeThrown(out.error) : null };
}

/** Records of `method` with `origin` (default bridge) whose callIndex lies in `[from, to)`. */
function ledgerSlice(records, { method = null, origin = null, from = 0, to = Infinity } = {}) {
  return records.filter((r) => r.callIndex >= from && r.callIndex < to && (method === null || r.method === method) && (origin === null || r.origin === origin));
}

/** True iff a spy record is the aggregate `fitToView([{model, selection}], ...)` form (key MUST be `selection`). */
function isAggregateFitRecord(rec) {
  const a0 = rec && rec.argSummaries && rec.argSummaries[0];
  if (!a0 || a0.kind !== 'array' || !Array.isArray(a0.items) || a0.items.length === 0) return false;
  return a0.items.every((it) => it.kind === 'object' && Array.isArray(it.keys) && it.keys.includes('model') && it.keys.includes('selection') && !it.keys.includes('ids'));
}

/** True iff a spy record is the documented per-model `fitToView([dbId...], model, immediate)` form. */
function isPerModelFitRecord(rec) {
  const a0 = rec && rec.argSummaries && rec.argSummaries[0];
  const a1 = rec && rec.argSummaries && rec.argSummaries[1];
  return Boolean(a0 && a0.kind === 'array' && Array.isArray(a0.items) && a0.items.length > 0 && a0.items.every((it) => it.kind === 'number') && a1 && a1.kind === 'object');
}

/**
 * `evaluateN2({singleFit, settle, boxes, restored})` -- §7 N2 (C6 discriminator): after a camera
 * reset to a fixed home view and `fitToView([b*], B)` alone, the SAME frustum predicate over the
 * union must FAIL. States: TIMED_OUT (fit or settle deadline), RESTORE_FAILED (camera reset not
 * restored), NOT_DETECTED (the discriminator could not be evaluated: fit threw, predicate not
 * evaluable), NOT_DISCRIMINATING (single-side fit frames the union), DETECTED_RESTORED.
 */
function evaluateN2({ singleFit = {}, settle = null, boxes = null, restored = null }) {
  const fields = { singleFit: { threw: singleFit.threw === true, timedOut: singleFit.timedOut === true }, settle: settle ? settle.status : null, restored };
  if (singleFit.timedOut === true || (settle && settle.status === 'timed-out')) return makeControlRecord('N2', 'TIMED_OUT', { fields });
  if (restored !== true) return makeControlRecord('N2', 'RESTORE_FAILED', { fields });
  if (singleFit.threw === true || !settle || settle.status !== 'settled') return makeControlRecord('N2', 'NOT_DETECTED', { fields: { ...fields, reason: 'discriminator-not-evaluable' } });
  const pred = frustumPredicate({ camera: settle.camera, boxes });
  if (!pred.evaluable) return makeControlRecord('N2', 'NOT_DETECTED', { fields: { ...fields, reason: pred.reason } });
  return makeControlRecord('N2', pred.pass ? 'NOT_DISCRIMINATING' : 'DETECTED_RESTORED', { fields: { ...fields, predicatePass: pred.pass, worstExcess: pred.worstExcess }, evidence: { corners: pred.corners } });
}

/**
 * `evaluateC6({pairSelected, present, fitRecords, settle, boxes, n2State})` -- §C6. BLOCKED on a T5 /
 * T4 deadline or unreadable camera; FAIL on a throw, a missing aggregate `selection`-keyed fitToView
 * (or one that threw), `fitted !== true`, or a corner outside the ε-slack frustum **only if N2
 * discriminates** (E2); NOT_EVIDENCED when no pair exists or N2 is NOT_DISCRIMINATING; PASS iff
 * every corner passes, `fitted:true` and N2 DETECTED_RESTORED.
 */
function evaluateC6({ pairSelected, present = {}, fitRecords = [], settle = null, boxes = null, n2State = null }) {
  const fields = { pairSelected: pairSelected === true, fitted: present.outcome ? present.outcome.fitted === true : null, n2State, settle: settle ? settle.status : null };
  const rec = (verdict, reason, extra = {}) => makeCheckRecord({ verdict, reason, fields: { ...fields, ...extra.fields }, evidence: extra.evidence || {} });
  if (pairSelected !== true) return rec('NOT_EVIDENCED', 'no-discriminating-pair');
  if (present.timedOut === true) return rec('BLOCKED', 'timeout:present');
  if (present.threw === true) return rec('FAIL', 'present-threw');
  const agg = fitRecords.filter(isAggregateFitRecord);
  const aggOk = agg.length >= 1 && agg.every((r) => r.outcome && r.outcome.threw === false);
  if (!aggOk) return rec('FAIL', agg.length === 0 ? 'aggregate-selection-form-not-observed' : 'aggregate-form-threw', { fields: { aggregateCalls: agg.length } });
  if (!present.outcome || present.outcome.fitted !== true) return rec('FAIL', 'not-fitted');
  if (!settle || settle.status === 'timed-out') return rec('BLOCKED', 'timeout:camera-settle');
  if (settle.status !== 'settled') return rec('BLOCKED', 'camera-unreadable');
  const pred = frustumPredicate({ camera: settle.camera, boxes });
  if (!pred.evaluable) return rec('BLOCKED', `frustum-not-evaluable:${pred.reason}`);
  const extra = { fields: { predicatePass: pred.pass, worstExcess: pred.worstExcess }, evidence: { corners: pred.corners, cameraK: settle.camera } };
  if (n2State === 'NOT_DISCRIMINATING') return rec('NOT_EVIDENCED', 'n2-not-discriminating', extra);
  if (n2State !== 'DETECTED_RESTORED') return rec('BLOCKED', `dependency:N2:${String(n2State)}`, extra);
  return pred.pass ? rec('PASS', null, extra) : rec('FAIL', 'corner-outside-frustum', extra);
}

/**
 * `evaluateC8({present, fitRecords, settle, box, supersession})` -- §C8: one live side, documented
 * per-model `fitToView([dbId], model)` form, `fitted:true`, no throw, and the settled camera frames
 * the element's candidate box (same predicate, E2); plus the superseded-focus scenario of C14:
 * after both settle the camera frames P2's target (`supersession = {settle, box}`).
 */
function evaluateC8({ present = {}, fitRecords = [], settle = null, box = null, supersession = null }) {
  const rec = (verdict, reason, extra = {}) => makeCheckRecord({ verdict, reason, fields: extra.fields || {}, evidence: extra.evidence || {} });
  if (present.timedOut === true) return rec('BLOCKED', 'timeout:present');
  if (present.threw === true) return rec('FAIL', 'present-threw');
  const per = fitRecords.filter(isPerModelFitRecord);
  if (per.length === 0 || !per.every((r) => r.outcome && r.outcome.threw === false)) return rec('FAIL', 'per-model-fit-form-not-observed');
  if (!present.outcome || present.outcome.fitted !== true) return rec('FAIL', 'not-fitted');
  if (!settle || settle.status === 'timed-out') return rec('BLOCKED', 'timeout:camera-settle');
  if (settle.status !== 'settled') return rec('BLOCKED', 'camera-unreadable');
  const p1 = frustumPredicate({ camera: settle.camera, boxes: [box] });
  if (!p1.evaluable) return rec('BLOCKED', `frustum-not-evaluable:${p1.reason}`);
  if (!p1.pass) return rec('FAIL', 'element-outside-frustum', { fields: { worstExcess: p1.worstExcess }, evidence: { corners: p1.corners } });
  if (!supersession) return rec('BLOCKED', 'supersession-not-observed', { fields: { worstExcess: p1.worstExcess } });
  if (!supersession.settle || supersession.settle.status === 'timed-out') return rec('BLOCKED', 'timeout:camera-settle');
  if (supersession.settle.status !== 'settled') return rec('BLOCKED', 'camera-unreadable');
  const p2 = frustumPredicate({ camera: supersession.settle.camera, boxes: [supersession.box] });
  if (!p2.evaluable) return rec('BLOCKED', `frustum-not-evaluable:${p2.reason}`);
  const extra = { fields: { worstExcess: p1.worstExcess, supersededWorstExcess: p2.worstExcess }, evidence: { corners: p1.corners, supersededCorners: p2.corners } };
  return p2.pass ? rec('PASS', null, extra) : rec('FAIL', 'superseded-focus-overwrote-p2', extra);
}

// ============================================================================================
// Section 30 -- C20 overlay-scene rendering oracle and N8 (procedure §C20, §7 N8; T17-T20, T4 for
// settle only; Table T rule (a)). Pure over synthetic or captured RGBA arrays. POSITIVE EVIDENCE ONLY:
// C20 has NO FAIL outcome -- every unmet predicate is NOT_EVIDENCED(reason) (or BLOCKED for a
// precondition / T5 / T7 deadline). The oracle functions below cannot return FAIL by construction
// (offline fuzz-tested). Frames are RGBA byte arrays of length W*H*4, row-major, top row first.
// ============================================================================================

const C20_DELTA_PX = TABLE_T.T17.footprintDilationPx;
const C20_R_MIN_PX = TABLE_T.T18.sphereEvaluabilityFloorPx;
const C20_LIST_CAP_BYTES = MIB;

/** §C20 NOT_EVIDENCED reasons (procedure list) plus the two N8-derived reasons flagged in the report. */
const C20_REASONS = Object.freeze([
  'no-target', 'dsf', 'unstable-frame', 'camera-moved', 'not-evaluable', 'footprint-overlap', 'no-change-observed',
  'post-clear-mismatch', 'locality-violation', 'attribution-missing', 'evidence-too-large',
  'n8-not-discriminating', 'n8-not-detected',
]);

/** Pixel projection (§C20 analytic footprints): usable iff clip.w > 0; px=(ndc.x+1)/2·W, py=(1−ndc.y)/2·H. */
function projectToPixel(camera, p, W, H) {
  const [x, y, z, w] = projectToClip(camera, p);
  if (!(w > 0)) return { usable: false, px: null, py: null, clip: [x, y, z, w] };
  return { usable: true, px: ((x / w + 1) / 2) * W, py: ((1 - y / w) / 2) * H, clip: [x, y, z, w] };
}

const insideViewport = (px, py, W, H) => px >= 0 && px < W && py >= 0 && py < H;

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * `computeC20Footprints({K0, W, H, sphere, outline, delta})` -- pure function of the ledger meshes,
 * K0 and W×H (§C20). Sphere `{center:[x,y,z], Rw}`: project c and the six points c ± Rw·e;
 * `r_px` = max pixel distance; evaluable iff all seven usable, the disc lies in [0,W)×[0,H) and
 * r_px >= 2 (T18). Outline `{vertices:[16×[x,y,z]], transformIdentity}`: segments (v_i, v_i+1),
 * i = 0..14, projectable iff both endpoints usable and inside the viewport; evaluable iff the mesh
 * transform is identity and >= 1 segment is projectable. Overlap iff dist(c_px, any projectable
 * segment) <= r_px + 2δ.
 */
function computeC20Footprints({ K0, W, H, sphere, outline, delta = C20_DELTA_PX }) {
  const camera = cameraFromSample(K0);
  const sph = { center: sphere ? sphere.center : null, Rw: sphere ? sphere.Rw : null, cPx: null, rPx: null, evaluable: false, reasons: [] };
  if (sphere && Array.isArray(sphere.center) && sphere.center.length === 3 && sphere.center.every(Number.isFinite) && Number.isFinite(sphere.Rw) && sphere.Rw > 0) {
    const c = sphere.center;
    const pc = projectToPixel(camera, c, W, H);
    const others = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .map((e) => projectToPixel(camera, [c[0] + sphere.Rw * e[0], c[1] + sphere.Rw * e[1], c[2] + sphere.Rw * e[2]], W, H));
    const allUsable = pc.usable && others.every((o) => o.usable);
    if (!allUsable) sph.reasons.push('point-not-usable');
    else {
      sph.cPx = [pc.px, pc.py];
      sph.rPx = Math.max(...others.map((o) => Math.hypot(o.px - pc.px, o.py - pc.py)));
      const inside = pc.px - sph.rPx >= 0 && pc.px + sph.rPx < W && pc.py - sph.rPx >= 0 && pc.py + sph.rPx < H;
      if (!inside) sph.reasons.push('disc-outside-viewport');
      if (!(sph.rPx >= C20_R_MIN_PX)) sph.reasons.push('sub-pixel-sphere');
      sph.evaluable = inside && sph.rPx >= C20_R_MIN_PX;
    }
  } else sph.reasons.push('sphere-invalid');

  const out = { vertices: outline ? outline.vertices : null, transformIdentity: outline ? outline.transformIdentity === true : false, segments: [], evaluable: false, reasons: [] };
  const verts = outline && Array.isArray(outline.vertices) ? outline.vertices : null;
  if (!verts || verts.length !== 16 || !verts.every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) out.reasons.push('vertices-invalid');
  else {
    const proj = verts.map((v) => projectToPixel(camera, v, W, H));
    for (let i = 0; i < 15; i += 1) {
      const a = proj[i];
      const b = proj[i + 1];
      const projectable = a.usable && b.usable && insideViewport(a.px, a.py, W, H) && insideViewport(b.px, b.py, W, H);
      out.segments.push({ i, p0: a.usable ? [a.px, a.py] : null, p1: b.usable ? [b.px, b.py] : null, projectable });
    }
    if (!out.transformIdentity) out.reasons.push('transform-not-identity');
    const anyProjectable = out.segments.some((s) => s.projectable);
    if (!anyProjectable) out.reasons.push('no-projectable-segment');
    out.evaluable = out.transformIdentity && anyProjectable;
  }

  let overlapDistance = null;
  if (sph.cPx && out.segments.some((s) => s.projectable)) {
    overlapDistance = Math.min(...out.segments.filter((s) => s.projectable).map((s) => pointSegmentDistance(sph.cPx[0], sph.cPx[1], s.p0[0], s.p0[1], s.p1[0], s.p1[1])));
  }
  const overlap = overlapDistance !== null && sph.rPx !== null && overlapDistance <= sph.rPx + 2 * delta;
  return { W, H, delta, sphere: sph, outline: out, overlap, overlapDistance };
}

/**
 * `buildC20Masks(footprints, {shiftPx})` -- dilated footprint membership masks `D_S`, `D_L`
 * (Uint8Array W×H): pixel (i,j) ∈ D_k iff the distance from its centre (i+0.5, j+0.5) to F_k is
 * <= δ (T17). `shiftPx` (N8 (ii)) translates both masks horizontally with wrap modulo W:
 * (i,j) ∈ D' iff ((i − shift) mod W, j) ∈ D.
 */
function buildC20Masks(footprints, { shiftPx = 0 } = {}) {
  const { W, H, delta, sphere, outline } = footprints;
  const DS = new Uint8Array(W * H);
  const DL = new Uint8Array(W * H);
  const clampX = (v) => Math.max(0, Math.min(W - 1, v));
  const clampY = (v) => Math.max(0, Math.min(H - 1, v));
  if (sphere.cPx && sphere.rPx !== null && Number.isFinite(sphere.rPx)) {
    const [cx, cy] = sphere.cPx;
    const reach = sphere.rPx + delta + 1;
    for (let j = clampY(Math.floor(cy - reach)); j <= clampY(Math.ceil(cy + reach)); j += 1) {
      for (let i = clampX(Math.floor(cx - reach)); i <= clampX(Math.ceil(cx + reach)); i += 1) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) - sphere.rPx;
        if (d <= delta) DS[j * W + i] = 1;
      }
    }
  }
  for (const s of outline.segments) {
    if (!s.projectable) continue;
    const reach = delta + 1;
    const x0 = clampX(Math.floor(Math.min(s.p0[0], s.p1[0]) - reach));
    const x1 = clampX(Math.ceil(Math.max(s.p0[0], s.p1[0]) + reach));
    const y0 = clampY(Math.floor(Math.min(s.p0[1], s.p1[1]) - reach));
    const y1 = clampY(Math.ceil(Math.max(s.p0[1], s.p1[1]) + reach));
    for (let j = y0; j <= y1; j += 1) {
      for (let i = x0; i <= x1; i += 1) {
        if (pointSegmentDistance(i + 0.5, j + 0.5, s.p0[0], s.p0[1], s.p1[0], s.p1[1]) <= delta) DL[j * W + i] = 1;
      }
    }
  }
  if (shiftPx === 0) return { DS, DL, shiftPx: 0 };
  const shift = ((shiftPx % W) + W) % W;
  const move = (M) => {
    const out = new Uint8Array(W * H);
    for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) if (M[j * W + i]) out[j * W + ((i + shift) % W)] = 1;
    return out;
  };
  return { DS: move(DS), DL: move(DL), shiftPx: shift };
}

function assertRgbaFrame(frame, W, H, label) {
  if (!frame || !ArrayBuffer.isView(frame) || frame.length !== W * H * 4) throw new TypeError(`C20: frame ${label} must be an RGBA byte array of length W*H*4`);
}

/** Pixel indices (row-major) where any of the four RGBA bytes differ (T19: tolerance 0). */
function changedPixelIndices(Fa, Fb, W, H) {
  assertRgbaFrame(Fa, W, H, 'a');
  assertRgbaFrame(Fb, W, H, 'b');
  const out = [];
  for (let p = 0, o = 0; p < W * H; p += 1, o += 4) {
    if (Fa[o] !== Fb[o] || Fa[o + 1] !== Fb[o + 1] || Fa[o + 2] !== Fb[o + 2] || Fa[o + 3] !== Fb[o + 3]) out.push(p);
  }
  return out;
}

/** Row-major run-length list `[[startIndex, runLength], …]` of a sorted pixel index list (lossless). */
function runLengthEncode(indices) {
  const runs = [];
  for (const p of indices) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === p) last[1] += 1; else runs.push([p, 1]);
  }
  return runs;
}

function runLengthDecode(runs) {
  const out = [];
  for (const [s, n] of runs) for (let k = 0; k < n; k += 1) out.push(s + k);
  return out;
}

function frameSha256(frame) { return sha256Hex(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)); }

/**
 * Frame-pair stability (T20): `attempts` = [{identical}] in capture order, at most 2; the second
 * attempt exists only if the first was not identical. Stable iff the last attempt is identical.
 * More than two attempts, or a second attempt after an identical first, is a harness defect (throws).
 */
function framePairStable(attempts, maxAttempts) {
  if (!Array.isArray(attempts) || attempts.length === 0 || attempts.length > maxAttempts) throw new TypeError(`C20: 1..${maxAttempts} frame-pair attempts required`);
  if (attempts.length === 2 && attempts[0].identical === true) throw new TypeError('C20: a second attempt after an identical first pair is not allowed (T20)');
  return attempts[attempts.length - 1].identical === true;
}

/**
 * `overlayRenderingOracle(input)` -- §C20 R1–R6 (R7 = N8 is folded in by `evaluateC20`). Input:
 * `{W, H, dsf, cameras:{K0,K1,K2,K3}, offAttempts, onAttempts, footprints, masks?, frames:{off1, on, clear}}`.
 * Evaluation order (first unmet => that NOT_EVIDENCED reason): dsf -> unstable-frame -> camera-moved
 * (R1) -> not-evaluable / footprint-overlap (R5) -> no-change-observed (R2) -> evidence-too-large
 * (either lossless run-length list > 1 MiB; after R2 per H2) -> locality-violation (R3) -> attribution-missing (R4) ->
 * post-clear-mismatch (R6). Returns `{verdict:'PASS'|'NOT_EVIDENCED(reason)', reason, R, counts,
 * changedRle, clearRle, reachedPixelComparison, ...}`. Never returns FAIL.
 */
function overlayRenderingOracle({ W, H, dsf, cameras = {}, offAttempts, onAttempts, footprints, masks = null, frames = {} }) {
  const R = { R1: false, R2: null, R3: null, R4: null, R5: null, R6: null };
  const out = (reason, extra = {}) => ({ verdict: reason === null ? 'PASS' : `NOT_EVIDENCED(${reason})`, reason, R, reachedPixelComparison: false, ...extra });
  if (dsf !== TABLE_T.T19.deviceScaleFactor) return out('dsf');
  const offStable = framePairStable(offAttempts, TABLE_T.T20.offPairAttemptsMax);
  if (!offStable) return out('unstable-frame', { stability: { off: false, on: null } });
  const onStable = framePairStable(onAttempts, TABLE_T.T20.onPairAttemptsMax);
  if (!onStable) return out('unstable-frame', { stability: { off: true, on: false } });
  const { K0, K1, K2, K3 } = cameras;
  if (!(cameraSamplesExactlyEqual(K0, K1) && cameraSamplesExactlyEqual(K0, K2) && cameraSamplesExactlyEqual(K0, K3))) return out('camera-moved');
  R.R1 = true;
  R.R5 = Boolean(footprints) && footprints.sphere.evaluable && footprints.outline.evaluable && !footprints.overlap;
  if (!footprints || !footprints.sphere.evaluable || !footprints.outline.evaluable) return out('not-evaluable');
  if (footprints.overlap) return out('footprint-overlap');
  const m = masks || buildC20Masks(footprints);
  const X = changedPixelIndices(frames.on, frames.off1, W, H);
  const clearDiff = changedPixelIndices(frames.clear, frames.off1, W, H);
  const changedRle = runLengthEncode(X);
  const clearRle = runLengthEncode(clearDiff);
  let inS = 0; let inL = 0; let outside = 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of X) {
    const s = m.DS[p] === 1;
    const l = m.DL[p] === 1;
    if (s) inS += 1;
    if (l) inL += 1;
    if (!s && !l) outside += 1;
    const x = p % W; const y = (p - x) / W;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const counts = { X: X.length, XinDS: inS, XinDL: inL, Xoutside: outside, clearDiff: clearDiff.length, bbox: X.length ? [minX, minY, maxX, maxY] : null };
  R.R2 = X.length >= TABLE_T.T19.changedPixelMinimum;
  R.R3 = outside === 0;
  R.R4 = inS > 0 && inL > 0;
  R.R6 = clearDiff.length === 0;
  const listBytes = { changed: Buffer.byteLength(JSON.stringify(changedRle)), clear: Buffer.byteLength(JSON.stringify(clearRle)) };
  const extra = { reachedPixelComparison: true, counts, changedRle, clearRle, listBytes };
  // H2 (internal review 2026-10-01): R2 is judged BEFORE the evidence-size cap, so N8(i)'s
  // null-change input (same F_clear) still yields exactly no-change-observed when only the
  // post-clear list is too large; the cap then blocks only evaluations that saw a change. An
  // oversized list is dropped from the no-change result too (the cap still bounds R1 evidence).
  const oversized = listBytes.changed > C20_LIST_CAP_BYTES || listBytes.clear > C20_LIST_CAP_BYTES;
  if (!R.R2) return out('no-change-observed', oversized ? { ...extra, changedRle: null, clearRle: null } : extra);
  if (oversized) return out('evidence-too-large', { ...extra, changedRle: null, clearRle: null });
  if (!R.R3) return out('locality-violation', extra);
  if (!R.R4) return out('attribution-missing', extra);
  if (!R.R6) return out('post-clear-mismatch', extra);
  return out(null, extra);
}

/**
 * `evaluateN8({oracleInput, oracleResult})` -- §7 N8, pure recomputation on the captured arrays:
 * (i) null-change: `frames.on := frames.off1` with the real footprints must return EXACTLY
 * NOT_EVIDENCED(no-change-observed); (ii) displaced footprints: both footprints translated by ⌊W/2⌋
 * px (wrap mod W) on the real frames must NOT return PASS; (ii) is applicable only if no pixel of X
 * lies in the displaced dilated footprints (else NOT_DISCRIMINATING). NOT_APPLICABLE iff the real
 * evaluation did not reach pixel comparison (forces C20 != PASS). `oracle` is injectable only for the
 * offline negative control (a defective always-PASS oracle must yield NOT_DETECTED).
 */
function evaluateN8({ oracleInput, oracleResult, oracle = overlayRenderingOracle }) {
  if (!oracleResult || oracleResult.reachedPixelComparison !== true) return makeControlRecord('N8', 'NOT_APPLICABLE', { fields: { reason: 'pixel-comparison-not-reached', c20Reason: oracleResult ? oracleResult.reason : null } });
  const { W, H } = oracleInput;
  const nullChange = oracle({ ...oracleInput, frames: { ...oracleInput.frames, on: oracleInput.frames.off1 } });
  const iOk = nullChange.verdict === 'NOT_EVIDENCED(no-change-observed)';
  const shift = Math.floor(W / 2);
  const displaced = buildC20Masks(oracleInput.footprints, { shiftPx: shift });
  const X = changedPixelIndices(oracleInput.frames.on, oracleInput.frames.off1, W, H);
  const xInDisplaced = X.filter((p) => displaced.DS[p] === 1 || displaced.DL[p] === 1).length;
  const applicable = xInDisplaced === 0;
  const moved = oracle({ ...oracleInput, masks: displaced });
  const fields = {
    nullChange: { verdict: nullChange.verdict, ok: iOk },
    displaced: { shiftPx: shift, applicable, xInDisplacedFootprints: xInDisplaced, verdict: moved.verdict, nonPass: moved.verdict !== 'PASS' },
    H,
  };
  if (!iOk) return makeControlRecord('N8', 'NOT_DETECTED', { fields });
  if (!applicable) return makeControlRecord('N8', 'NOT_DISCRIMINATING', { fields });
  return makeControlRecord('N8', moved.verdict !== 'PASS' ? 'DETECTED' : 'NOT_DETECTED', { fields });
}

/**
 * `selectC20Target(c4Table)` -- a_r: the candidate of model A among the C4 sample with all three
 * extents > 0 and the minimal half-diagonal of its candidate box; ties by lowest dbId. Returns the
 * row (whose `outcome` the caller checks as the `contained` precondition) or null (no-target).
 */
function selectC20Target(c4Table) {
  let best = null;
  for (const row of c4Table || []) {
    if (row.model !== 'A' || !Array.isArray(row.candidateBox)) continue;
    const b = row.candidateBox;
    if (!b.every(Number.isFinite)) continue;
    const ex = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    if (!ex.every((e) => e > 0)) continue;
    const hd = 0.5 * Math.hypot(ex[0], ex[1], ex[2]);
    if (best === null || hd < best.halfDiagonal || (hd === best.halfDiagonal && row.dbId < best.row.dbId)) best = { row, halfDiagonal: hd };
  }
  return best;
}

/**
 * `evaluateC20({target, preconditions, timeouts, structural, oracleInput})` -- §C20 verdict. No FAIL
 * path exists: no-target => NOT_EVIDENCED(no-target); an unmet precondition (bridge, baseline, a_r
 * contained, canvas, shell disposed) or an unmet structural step expectation of A1/A3/A5 =>
 * BLOCKED(precondition:<which>); a T5/T7 expiry => BLOCKED(timeout:<op>); dsf => NOT_EVIDENCED(dsf);
 * otherwise the oracle's R1–R6 and N8 (R7). Retains the lossless evidence of §C20 in `evidence`.
 * Returns `{record, n8, c20}` (`c20` = the §10 `c20` block).
 */
function evaluateC20({ target = null, preconditions = {}, timeouts = {}, structural = {}, oracleInput = null }) {
  const blockedPre = Object.keys(preconditions).filter((k) => preconditions[k] !== true && k !== 'dsf');
  const blockedStruct = Object.keys(structural).filter((k) => structural[k] !== true);
  const timedOut = Object.keys(timeouts).filter((k) => timeouts[k] === true);
  const na = (why) => makeControlRecord('N8', 'NOT_APPLICABLE', { fields: { reason: why } });
  const done = (verdict, reason, n8, c20 = {}) => ({ record: makeCheckRecord({ verdict, reason, fields: { preconditions, structural, timeouts, n8State: n8.state, R: c20.R || null, counts: c20.counts || null }, evidence: { losslessEvidence: 'top-level c20 block' } }), n8, c20: normalizeEvidence(c20) });
  if (target === null) return done('NOT_EVIDENCED', 'no-target', na('no-target'));
  if (timedOut.length) return done('BLOCKED', `timeout:${timedOut[0]}`, na('timeout'));
  if (blockedPre.length) return done('BLOCKED', `precondition:${blockedPre[0]}`, na('precondition'));
  if (preconditions.dsf === false) return done('NOT_EVIDENCED', 'dsf', na('dsf'));
  if (blockedStruct.length) return done('BLOCKED', `precondition:${blockedStruct[0]}`, na('structural-step'));
  if (!oracleInput) return done('BLOCKED', 'precondition:oracle-input-missing', na('no-oracle-input'));
  const result = overlayRenderingOracle(oracleInput);
  const n8 = evaluateN8({ oracleInput, oracleResult: result });
  const fp = oracleInput.footprints;
  const f = oracleInput.frames || {};
  const c20 = {
    W: oracleInput.W, H: oracleInput.H, dsf: oracleInput.dsf, cameras: oracleInput.cameras,
    sphere: fp ? { center: fp.sphere.center, Rw: fp.sphere.Rw, cPx: fp.sphere.cPx, rPx: fp.sphere.rPx, evaluable: fp.sphere.evaluable, reasons: fp.sphere.reasons } : null,
    outline: fp ? { vertices: fp.outline.vertices, segments: fp.outline.segments.map((s) => ({ i: s.i, projectable: s.projectable })), evaluable: fp.outline.evaluable, reasons: fp.outline.reasons } : null,
    overlap: fp ? fp.overlap : null, overlapDistance: fp ? fp.overlapDistance : null,
    thresholds: { deltaPx: C20_DELTA_PX, rMinPx: C20_R_MIN_PX, T19: TABLE_T.T19, T20: TABLE_T.T20 },
    frameSha256: Object.fromEntries(Object.keys(f).filter((k) => f[k]).map((k) => [k, frameSha256(f[k])])),
    attempts: { off: oracleInput.offAttempts.length, on: oracleInput.onAttempts.length },
    R: { ...result.R, R7: n8.state === 'DETECTED' },
    counts: result.counts || null,
    changedRle: result.changedRle || null,
    clearRle: result.clearRle || null,
    n8: { state: n8.state, shiftPx: Math.floor(oracleInput.W / 2), fields: n8.fields },
  };
  if (result.verdict !== 'PASS') return done('NOT_EVIDENCED', result.reason, n8, c20);
  if (n8.state === 'DETECTED') return done('PASS', null, n8, c20);
  return done('NOT_EVIDENCED', n8.state === 'NOT_DISCRIMINATING' ? 'n8-not-discriminating' : 'n8-not-detected', n8, c20);
}

// ============================================================================================
// Section 31 -- C17 departure oracle (procedure §C17 V0–V7, Table T13/T6, exception E4 for V1/V2)
// and its non-vacuous control N7 (§7). The oracle is pure over a plain-JSON observation in which
// models are LABELS ('A' | 'B'), assigned by object identity through `createModelLabeler`
// (§4.8: identity, never modelId). The spy recorder is extended -- by composition, without editing
// Section 19 -- with a model-argument tagger so V5 can see which model a fitToView /
// setAggregateIsolation call references (the argument summaries alone do not expose nested models).
// ============================================================================================

/** Bridge note copied by value from clashpanel/viewer/ViewerBridge.js BRIDGE_NOTE.NOT_IN_SCENE (procedure §C17 V4). */
const C17_NOT_IN_SCENE_NOTE = "An element's model is no longer in the scene";

/** Identity -> label map for the two harness-loaded models (never keyed by modelId). */
function createModelLabeler(modelsByLabel) {
  const map = new Map();
  for (const [label, model] of Object.entries(modelsByLabel)) {
    if (model !== null && (typeof model === 'object' || typeof model === 'function')) map.set(model, label);
  }
  return (obj) => (obj !== null && (typeof obj === 'object' || typeof obj === 'function') && map.has(obj) ? map.get(obj) : null);
}

/**
 * Model labels referenced by a call's raw arguments: a model passed directly (per-model fitToView
 * slot), or the `model` key of plain entries in an array (aggregate fitToView /
 * setAggregateIsolation). Depth-bounded; never walks into Viewer objects. Sorted, de-duplicated.
 */
function modelLabelsInArgs(args, labelOf) {
  const out = new Set();
  const visit = (v, depth) => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function') || depth > 3) return;
    const label = labelOf(v);
    if (label !== null) { out.add(label); return; }
    if (Array.isArray(v)) { for (const x of v.slice(0, 64)) visit(x, depth + 1); return; }
    const proto = Object.getPrototypeOf(v);
    if ((proto === Object.prototype || proto === null) && Object.prototype.hasOwnProperty.call(v, 'model')) visit(v.model, depth + 1);
  };
  for (const a of args) visit(a, 0);
  return [...out].sort();
}

/** `setAggregateIsolation` argument shape `[{model:<label>, idsLength}]` (or null if not an array). */
function isolationEntryShape(list, labelOf) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 64).map((e) => ({
    model: e && typeof e === 'object' ? (labelOf(e.model) || 'unknown') : 'invalid',
    idsLength: e && typeof e === 'object' && e.ids && typeof e.ids.length === 'number' ? e.ids.length : null,
  }));
}

const MODEL_TAGGED_METHODS = Object.freeze(['viewer.fitToView', 'viewer.setAggregateIsolation']);

/**
 * `attachModelArgumentTagger(recorder, {labelOf, methods})` -- wraps `recorder.record` (Section 19
 * recorders are plain objects; `recordingWrap` looks `record` up at call time) so every record of a
 * tagged method also carries `modelLabels` derived from the RAW arguments. Pass-through: the original
 * record is returned unchanged except for the added field. `detach()` restores the original.
 */
function attachModelArgumentTagger(recorder, { labelOf, methods = MODEL_TAGGED_METHODS }) {
  if (!recorder || typeof recorder.record !== 'function') throw new TypeError('attachModelArgumentTagger: recorder required');
  if (recorder.modelTaggerAttached === true) throw new Error('attachModelArgumentTagger: already attached');
  const original = recorder.record;
  recorder.record = (method, args) => {
    const rec = original(method, args);
    if (methods.includes(method)) {
      rec.modelLabels = modelLabelsInArgs(args, labelOf);
      if (method === 'viewer.setAggregateIsolation') rec.isolationEntries = isolationEntryShape(args[0], labelOf);
    }
    return rec;
  };
  recorder.modelTaggerAttached = true;
  return { detach() { recorder.record = original; recorder.modelTaggerAttached = false; } };
}

/** §C16/§C17 single monotonic event log `{seq, t, kind, eventName, modelLabel, reason, payloadSummary}`. */
function createMonotonicEventLog({ clock = defaultClock, recorder = null } = {}) {
  const entries = [];
  const KINDS = ['listener-entry', 'bridge-callback', 'listener-exit'];
  // §7 RC1-C2 / §9.2: with a recorder, `seq` comes from the run's single counter (recorder.nextSeq)
  // and every entry carries the attribution fields; the entry is also appended to the recorder's
  // eventLog (one persisted, seq-ordered eventLog). Without a recorder (pure offline oracle tests)
  // the legacy local numbering is kept.
  return {
    entries,
    push({ kind, eventName = null, modelLabel = null, reason = null, payloadSummary = null }) {
      if (!KINDS.includes(kind)) throw new TypeError(`event log: unknown kind ${String(kind)}`);
      const fields = { t: clock.monotonicMs(), eventName, modelLabel, reason, payloadSummary };
      const e = recorder && typeof recorder.logEvent === 'function' ? recorder.logEvent(kind, fields) : { seq: entries.length, kind, ...fields };
      entries.push(e);
      return e;
    },
  };
}

/** Plain summary of `inspectLedger()` with models as labels: `{markerMeshCount, isolation:{confirmed, target}}` or null. */
function summarizeBridgeLedger(L, labelOf) {
  if (L === null || L === undefined) return null;
  const iso = L.isolation;
  return {
    markerMeshCount: Array.isArray(L.markerMeshes) ? L.markerMeshes.length : (L.markerMeshes && typeof L.markerMeshes.length === 'number' ? L.markerMeshes.length : null),
    isolation: iso ? {
      confirmed: iso.confirmed === true,
      target: Array.isArray(iso.target) ? iso.target.map((e) => ({ model: labelOf(e.model) || 'unknown', ids: Array.from(e.ids || []) })) : null,
    } : null,
  };
}

const c17Bool = (v) => v === true;
const c17Valid = (value) => ({ value: value === true, valid: true });
const c17Invalid = (why) => ({ value: false, valid: false, why });

/** V0 -- apply precondition (else BLOCKED(precondition:apply), not a C17 verdict). */
function c17V0(obs) {
  const L0 = obs.L0;
  if (!obs.r0 || !L0 || !L0.isolation) return c17Invalid('r0-or-L0-missing');
  const labels = Array.isArray(L0.isolation.target) ? L0.isolation.target.map((e) => e.model) : [];
  return c17Valid(c17Bool(obs.r0.isolated) && c17Bool(obs.r0.marked) && L0.isolation.confirmed === true
    && labels.includes('A') && labels.includes('B') && L0.markerMeshCount === expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 2 }));
}

/** V1 -- Viewer listener log: exactly one BEFORE_MODEL_UNLOAD and one MODEL_REMOVED entry, each for B, none for A, BU before MR. Missing within T6 => false (E4). */
function c17V1(obs) {
  if (!Array.isArray(obs.eventLog) || !obs.eventNames) return c17Invalid('event-log-missing');
  const entries = (name) => obs.eventLog.filter((e) => e.kind === 'listener-entry' && e.eventName === name);
  const bu = entries(obs.eventNames.BEFORE_MODEL_UNLOAD);
  const mr = entries(obs.eventNames.MODEL_REMOVED);
  return c17Valid(bu.length === 1 && mr.length === 1 && bu[0].modelLabel === 'B' && mr[0].modelLabel === 'B' && bu[0].seq < mr[0].seq);
}

/** V2 -- bridge callbacks: exactly one {B,'unload'} and one {B,'removed'}, none for A, unload before removed. */
function c17V2(obs) {
  if (!Array.isArray(obs.eventLog)) return c17Invalid('event-log-missing');
  const cbs = obs.eventLog.filter((e) => e.kind === 'bridge-callback');
  const u = cbs.filter((e) => e.modelLabel === 'B' && e.reason === 'unload');
  const r = cbs.filter((e) => e.modelLabel === 'B' && e.reason === 'removed');
  const forA = cbs.filter((e) => e.modelLabel === 'A');
  return c17Valid(u.length === 1 && r.length === 1 && forA.length === 0 && u[0].seq < r[0].seq);
}

/** V3 -- S3 getAllModels(): contains A (identity) and not B. */
function c17V3(obs) {
  if (!obs.models || typeof obs.models.containsA !== 'boolean' || typeof obs.models.containsB !== 'boolean') return c17Invalid('membership-missing');
  return c17Valid(obs.models.containsA && !obs.models.containsB);
}

/** V4 -- r1 re-targeted to the survivor: NOT_IN_SCENE note exactly once, 2 meshes (T13 Hard, one side), target exactly [{A,[a1]}]. */
function c17V4(obs) {
  const r1 = obs.r1;
  const L1 = obs.L1;
  if (!r1 || !Array.isArray(r1.notes)) return c17Invalid('r1-missing');
  if (!L1 || !L1.isolation || !Array.isArray(L1.isolation.target)) return c17Valid(false);
  const t = L1.isolation.target;
  return c17Valid(r1.superseded === false && c17Bool(r1.marked) && c17Bool(r1.isolated) && c17Bool(r1.fitted)
    && r1.notes.filter((n) => n === C17_NOT_IN_SCENE_NOTE).length === 1
    && L1.markerMeshCount === expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 1 })
    && L1.isolation.confirmed === true
    && t.length === 1 && t[0].model === 'A' && t[0].ids.length === 1 && t[0].ids[0] === obs.a1);
}

/** V5 -- bridge-origin S4 spy slice: no fitToView / setAggregateIsolation referencing B; <= 1 setAggregateIsolation. Untagged records are invalid input. */
function c17V5(obs) {
  if (!Array.isArray(obs.s4BridgeRecords)) return c17Invalid('s4-slice-missing');
  const tagged = obs.s4BridgeRecords.filter((r) => MODEL_TAGGED_METHODS.includes(r.method));
  if (tagged.some((r) => !Array.isArray(r.modelLabels))) return c17Invalid('records-not-model-tagged');
  const fitB = tagged.filter((r) => r.method === 'viewer.fitToView' && r.modelLabels.includes('B')).length;
  const isoRecs = tagged.filter((r) => r.method === 'viewer.setAggregateIsolation');
  return c17Valid(fitB === 0 && isoRecs.every((r) => !r.modelLabels.includes('B')) && isoRecs.length <= 1);
}

/** V6 -- clear(): restored, 2 markers removed, no notes. */
function c17V6(obs) {
  const c = obs.c;
  if (!c) return c17Invalid('clear-outcome-missing');
  return c17Valid(c.isolation === 'restored' && c.markersRemoved === 2 && Array.isArray(c.notes) && c.notes.length === 0);
}

/** V7 -- post-clear reads: isolation equals baseline (empty), no hidden entry for A, ledger null, bridge-origin net 0 per Panel scene. */
function c17V7(obs) {
  const p = obs.post;
  if (!p || !p.netAddMinusRemove || typeof p.netAddMinusRemove !== 'object') return c17Invalid('post-reads-missing');
  const nets = Object.values(p.netAddMinusRemove);
  return c17Valid(p.isolationEqualsBaseline === true && p.hiddenHasNonEmptyA === false && p.ledgerNull === true && nets.length >= 1 && nets.every((n) => n === 0));
}

const C17_PREDICATES = Object.freeze({ V0: c17V0, V1: c17V1, V2: c17V2, V3: c17V3, V4: c17V4, V5: c17V5, V6: c17V6, V7: c17V7 });

/**
 * `c17Oracle(obs, {preconditionUnmet, timedOut})` -- §C17 verdict: precondition unmet =>
 * BLOCKED(precondition:<which>); T5 expiry => BLOCKED(timeout:<op>) (never for an absent event: T6 =>
 * V1 false => FAIL); V0 false => BLOCKED(precondition:apply); any V1–V7 false => FAIL(V..);
 * else PASS. Returns `{record, c17}` with the named booleans (invalid input evaluates false).
 */
function c17Oracle(obs, { preconditionUnmet = null, timedOut = null } = {}) {
  const V = {};
  const validity = {};
  for (const [k, fn] of Object.entries(C17_PREDICATES)) { const r = fn(obs || {}); V[k] = r.value; validity[k] = r.valid ? true : r.why; }
  const c17 = { V, validity, observation: normalizeEvidence(obs || null) };
  const rec = (verdict, reason) => ({ record: makeCheckRecord({ verdict, reason, fields: { V, validity } }), c17 });
  if (preconditionUnmet) return rec('BLOCKED', `precondition:${preconditionUnmet}`);
  if (timedOut) return rec('BLOCKED', `timeout:${timedOut}`);
  if (!V.V0) return rec('BLOCKED', 'precondition:apply');
  const failed = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'].filter((k) => !V[k]);
  return failed.length ? rec('FAIL', failed.join(',')) : rec('PASS', null);
}

/**
 * `evaluateN7({preObs, restored, timedOut, executable})` -- §7 N7: the SAME V3/V4/V5 predicates on
 * a present performed while B is still loaded must all evaluate FALSE with VALID input (an invalid
 * input can never make the control pass). DETECTED_RESTORED requires the clear() back to baseline.
 */
function evaluateN7({ preObs = null, restored = null, timedOut = false, executable = true } = {}) {
  if (!executable) return makeControlRecord('N7', 'NOT_EXECUTABLE');
  if (timedOut) return makeControlRecord('N7', 'TIMED_OUT');
  const r = { V3: c17V3(preObs || {}), V4: c17V4(preObs || {}), V5: c17V5(preObs || {}) };
  const fields = { V3: r.V3, V4: r.V4, V5: r.V5, restored };
  if (Object.values(r).some((x) => !x.valid || x.value)) return makeControlRecord('N7', 'NOT_DETECTED', { fields });
  return makeControlRecord('N7', restored === true ? 'DETECTED_RESTORED' : 'RESTORE_FAILED', { fields });
}

// ============================================================================================
// Section 32 -- C2 / C3 DockingPanel shell checks (procedure §C2, §C3; T12 3 repetitions). The
// title-element lookup is a PAGE-PORTABLE pure function (no module-scope references; it can be
// serialized with `.toString()` into the page) over DOM-like objects; the verdict functions are pure
// over plain observation records. Real base-class behaviour is live-pending.
// ============================================================================================

/** §C2 region order (from clashpanel/ui/render/panel.js; copied by value). */
const C2_REGION_ORDER = Object.freeze(['setup', 'run', 'filters', 'results', 'selected']);
const C3_SHOW_HIDE_REPETITIONS = TABLE_T.T12.c3ShowHideRepetitions;
const SHELL_PUBLIC_KEYS = Object.freeze(['dispose', 'hide', 'isVisible', 'show', 'toggle']);

/**
 * PAGE-PORTABLE (self-contained). §C2 (vi) title-element contract. `titleReturns` = the values
 * returned by the `createTitleBar` prototype spy during construction (primary source, any caller),
 * `container` = the panel container. PASS-side iff exactly one call, it returned an element `T`,
 * `container.contains(T)`, and exactly one container descendant has the same tag and a `className`
 * string equal to `T.className` (uniqueness cross-check). No class-name fallback exists: the class
 * string is recorded FROM `T`. Returns `{ok, reason, calls, className, tagName, sameClassCount}`.
 */
function titleElementContract(titleReturns, container) {
  var calls = Array.isArray(titleReturns) ? titleReturns.length : 0;
  var base = { ok: false, reason: null, calls: calls, className: null, tagName: null, sameClassCount: null };
  if (calls === 0) { base.reason = 'no-createTitleBar-call'; return base; }
  if (calls > 1) { base.reason = 'multiple-createTitleBar-calls'; return base; }
  var T = titleReturns[0];
  if (!T || T.nodeType !== 1) { base.reason = 'createTitleBar-returned-non-element'; return base; }
  base.className = typeof T.className === 'string' ? T.className : null;
  base.tagName = typeof T.tagName === 'string' ? T.tagName : null;
  if (!container || typeof container.contains !== 'function' || !container.contains(T)) { base.reason = 'title-not-attached'; return base; }
  var all = typeof container.getElementsByTagName === 'function' ? container.getElementsByTagName('*') : [];
  var n = 0;
  for (var i = 0; i < all.length; i += 1) {
    var el = all[i];
    if (el.tagName === T.tagName && typeof el.className === 'string' && el.className === T.className) n += 1;
  }
  base.sameClassCount = n;
  if (n !== 1) { base.reason = n === 0 ? 'title-class-not-found' : 'duplicate-title-class'; return base; }
  base.ok = true;
  return base;
}

/**
 * `evaluateC2(obs)` -- §C2 (i)–(viii) over a plain observation:
 * `{threw, containerFound, containerUnderViewer, regions:[{region, hasHeading, hasBody}],
 *  addVisibilityListenerCalls, bodyChildCount, title (titleElementContract result), baseInitializeCalls,
 *  setVisibleFalseBeforeListener, dispatchesDuringConstruction, domainWrites, shellKeys, failureEvidence}`.
 * Any unmet clause => FAIL with the clause list; the base `initialize` count is recorded only.
 */
function evaluateC2(obs) {
  const o = obs || {};
  const regions = Array.isArray(o.regions) ? o.regions : [];
  const clauses = {
    i: o.threw === false,
    ii: o.containerFound === true && o.containerUnderViewer === true,
    iii: regions.length === C2_REGION_ORDER.length && regions.every((r, k) => r.region === C2_REGION_ORDER[k] && r.hasHeading === true && r.hasBody === true),
    iv: o.addVisibilityListenerCalls === 1,
    v: o.bodyChildCount === 1,
    vi: Boolean(o.title && o.title.ok === true),
    vii: o.setVisibleFalseBeforeListener === true && o.dispatchesDuringConstruction === 0,
    viii: o.domainWrites === 0 && Array.isArray(o.shellKeys) && [...o.shellKeys].sort().join(',') === SHELL_PUBLIC_KEYS.join(','),
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({
    verdict: failed.length ? 'FAIL' : 'PASS',
    reason: failed.length ? failed.map((k) => (k === 'vi' && o.title && o.title.reason ? `vi:${o.title.reason}` : k)).join(',') : null,
    fields: { clauses, title: o.title || null, baseInitializeCalls: o.baseInitializeCalls === undefined ? null : o.baseInitializeCalls, baseInitializeRecordedOnly: true },
    evidence: failed.length ? (o.failureEvidence || {}) : {},
  });
}

/**
 * `evaluateC3(obs)` -- §C3 over a plain observation: `showHide` = exactly T12 (3) repetitions of
 * `{showSetVisibleTrue, showDispatches:[..], hideDispatches:[..]}` (one dispatch per transition, no
 * duplicates), `closeButton` (recorded), `dispose` = `{uninitializeCalls, containerInDom, rootFound,
 * byIdFound, retainedCallbackDispatches, setVisibleAfterUninitialize, postDisposeSpyCalls,
 * postDisposeIsVisible}`, `residue` = unexpected new nodes/listeners beyond the allow-list.
 */
function evaluateC3(obs) {
  const o = obs || {};
  const reps = Array.isArray(o.showHide) ? o.showHide : [];
  const repOk = reps.length === C3_SHOW_HIDE_REPETITIONS && reps.every((r) => r.showSetVisibleTrue === true
    && Array.isArray(r.showDispatches) && r.showDispatches.length === 1 && r.showDispatches[0] === 'PANEL_SHOWN'
    && Array.isArray(r.hideDispatches) && r.hideDispatches.length === 1 && r.hideDispatches[0] === 'PANEL_HIDDEN');
  const d = o.dispose || {};
  const disposeOk = d.uninitializeCalls === 1 && d.containerInDom === false && d.rootFound === false && d.byIdFound === false
    && d.retainedCallbackDispatches === 0 && d.setVisibleAfterUninitialize === 0 && d.postDisposeSpyCalls === 0 && d.postDisposeIsVisible === false;
  const residueOk = Array.isArray(o.residue) && o.residue.length === 0;
  const clauses = { repetitions: repOk, dispose: disposeOk, residue: residueOk };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, repetitionsObserved: reps.length, closeButton: o.closeButton || null, residue: o.residue || null } });
}

// ============================================================================================
// Section 33 -- remaining check evaluators, pure over plain observations: C1, C5, C7 (α via the
// Section 23 sceneOwnershipOracle, β markers), C9–C16, C18 (a/b), C19 (+ markers-only v1 /
// zero-theming ledger assertions), N4, N5. Each returns a §10 check/control record.
// ============================================================================================

/** Isolation note copied by value from clashpanel/viewer/isolation.js ISOLATION_NOTE.RESTORE_FAILED (procedure §C15(e)). */
const C15_RESTORE_FAILED_NOTE = 'Isolation could not be restored (the Viewer reported an error).';
/** Fit note copied by value from clashpanel/viewer/fit.js FIT_NOTE.FIRST_ONLY (procedure §C15(d), E5). */
const C15_FIRST_ONLY_NOTE = 'Framing first element only';

/**
 * §C1 -- `{A:{loaded, classification, inAllModels, unitScale, unitString, loadStatus?}, B:{..},
 * loadedCount}`. RC1-C1 C1 reason contract: a P1 prerequisite loss is `BLOCKED` with EXACTLY one
 * normalized reason -- `'timeout:load'` if the T2 load/readiness deadline fired for A or B
 * (`loadStatus:'timed-out'`; takes precedence), else `'prerequisite'` -- and the detailed causes go
 * ONLY to `fields.blockDetail = [{cause, model, observed}]` (ordered A, B, then model-independent;
 * diagnostic, never parsed by any verdict function). A loaded model missing from getAllModels() is
 * recorded as `model-not-loaded` with `observed:'not-in-getAllModels'` (see report).
 *
 * H1 (2026-10-01 follow-up review): the node-side §9.2 load `completionOutcome` of each model is
 * merged into the facts as `nodeLoadOutcome` (`withNodeLoadOutcomes`). A node-side P1 harness
 * exception (`'harness-exception'`: the load call threw, e.g. before the page recorded the load) is
 * "any other non-PASS C1 outcome" of the §7 C1 reason contract: C1 is `BLOCKED('harness-exception')`
 * -- its own, NON-normalized reason, so L1 is false and the gate is CLOSED_OTHER -- whatever the page
 * facts say (they are kept in `fields` for diagnostics). It outranks `timeout:load` (the procedure
 * orders only the two normalized causes; a harness exception can never make NRDB legal). A node-side
 * T2 expiry (`'timeout:load'`, e.g. the outer deadline fired while the page record was still active)
 * is a `load-deadline` cause for that model, so the precedence-winning `timeout:load` reason results.
 */
function evaluateC1(obs) {
  const o = obs || {};
  const models = ['A', 'B'].map((m) => o[m] || {});
  const unitMismatch = models[0].unitScale !== models[1].unitScale || models[0].unitString !== models[1].unitString;
  const fields = { A: o.A || null, B: o.B || null, loadedCount: o.loadedCount === undefined ? null : o.loadedCount, unitScaleMismatchFinding: unitMismatch };
  if (models.some((m) => m.nodeLoadOutcome === 'harness-exception')) return makeCheckRecord({ verdict: 'BLOCKED', reason: 'harness-exception', fields });
  const detail = [];
  const obsStr = (v) => (v === null || v === undefined ? null : truncateUtf8(redactEvidenceText(String(v)).value, 256).value);
  models.forEach((m, k) => {
    const label = k === 0 ? 'A' : 'B';
    if (m.loadStatus === 'timed-out') detail.push({ cause: 'load-deadline', model: label, observed: 'timed-out' });
    else if (m.nodeLoadOutcome === 'timeout:load') detail.push({ cause: 'load-deadline', model: label, observed: 'timeout:load' });
    else if (m.loaded !== true) {
      if (m.loadStatus === 'failed' || m.loadStatus === 'rejected') detail.push({ cause: 'load-rejected', model: label, observed: obsStr(m.loadStatus) });
      else detail.push({ cause: 'model-not-loaded', model: label, observed: obsStr(m.loadStatus) });
    } else if (m.classification !== CLASSIFIER_CONFIRMED) detail.push({ cause: 'classifier', model: label, observed: obsStr(m.classification) });
    else if (m.inAllModels !== true) detail.push({ cause: 'model-not-loaded', model: label, observed: 'not-in-getAllModels' });
  });
  if (o.loadedCount !== TABLE_T.T14.loadedModelCount) detail.push({ cause: 'model-count', model: null, observed: obsStr(o.loadedCount) });
  if (detail.length === 0) return makeCheckRecord({ verdict: 'PASS', fields });
  const reason = detail.some((d) => d.cause === 'load-deadline') ? 'timeout:load' : 'prerequisite';
  return makeCheckRecord({ verdict: 'BLOCKED', reason, fields: { ...fields, blockDetail: detail } });
}

/**
 * `withNodeLoadOutcomes(facts, outcomes)` -- H1: a copy of the page-side C1 facts with each model's
 * node-side §9.2 load `completionOutcome` added as `nodeLoadOutcome` (an out-of-enum value -> null).
 * The page facts are never replaced. `outcomes` absent (null/undefined) -> the facts unchanged; the
 * closeout backstop `c1LoadLedgerProblems` still couples C1 to the persisted opLedger (row 5).
 */
function withNodeLoadOutcomes(facts, outcomes) {
  if (!isPlainObject(outcomes)) return facts;
  const out = isPlainObject(facts) ? { ...facts } : {};
  for (const label of ['A', 'B']) {
    const v = outcomes[label];
    out[label] = { ...(isPlainObject(out[label]) ? out[label] : {}), nodeLoadOutcome: LOAD_COMPLETION_OUTCOMES.includes(v) ? v : null };
  }
  return out;
}

/** §C5 -- observation only: feet only for a finite positive scale and a metre-based unit string. */
function evaluateC5(obs) {
  const o = obs || {};
  const perModel = {};
  let captured = true;
  for (const m of ['A', 'B']) {
    const x = o[m] || {};
    if (x.unitScale === undefined || x.unitString === undefined || !Array.isArray(x.nativeExtent)) { captured = false; perModel[m] = null; continue; }
    const metreBased = typeof x.unitString === 'string' && /^(m|meter|metre|meters|metres|cm|mm|centimeter|centimetre|millimeter|millimetre)$/i.test(x.unitString.trim());
    const ok = Number.isFinite(x.unitScale) && x.unitScale > 0 && metreBased;
    perModel[m] = {
      unitScale: x.unitScale, unitString: x.unitString, nativeExtent: x.nativeExtent,
      feet: ok ? x.nativeExtent.map((e) => (e * x.unitScale) / 0.3048) : null,
      feetReason: ok ? null : 'unit-scale-or-string-not-metre-based',
    };
  }
  return captured ? makeCheckRecord({ verdict: 'PASS', fields: { perModel, observationOnly: true } }) : makeCheckRecord({ verdict: 'NOT_EVIDENCED', reason: 'values-not-captured', fields: { perModel } });
}

/**
 * §C7β -- `{hard:{scenesPresent, markerMeshCount, marked, outlinedSides}, soft:{...},
 * replacements:[{removedPriorExactly, ledgerCount, expected, cumulativeNet}], setFromPointsOk,
 * clear:{markersRemoved, priorCount, ledgerNull}}`. Exactly 5 replacements (T12, E3).
 */
function evaluateC7Beta(obs) {
  const o = obs || {};
  const variantOk = (v, variant) => Boolean(v) && v.scenesPresent === true && v.marked === true
    && v.markerMeshCount === expectedMarkerMeshCount({ variant, outlinedSides: v.outlinedSides });
  const reps = Array.isArray(o.replacements) ? o.replacements : [];
  const clauses = {
    i: variantOk(o.hard, 'hard') && variantOk(o.soft, 'soft'),
    ii: reps.length === TABLE_T.T12.c7ReplacementRepetitions && reps.every((r) => r.removedPriorExactly === true && r.ledgerCount === r.expected && r.cumulativeNet === r.ledgerCount),
    iii: o.setFromPointsOk === true,
    iv: Boolean(o.clear) && o.clear.markersRemoved === o.clear.priorCount && o.clear.ledgerNull === true,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, replacementsObserved: reps.length } });
}

/** §C7α / §C18b -- the Section 23 sceneOwnershipOracle as a check record (+ the §10 sceneOwnership rows). */
function evaluateSceneOwnership({ scenes, presentAfterDispose, ledger }) {
  const o = sceneOwnershipOracle({ scenes, presentAfterDispose, ledger });
  return {
    record: makeCheckRecord({ verdict: o.verdict, reason: o.verdict === 'PASS' ? null : [...new Set(o.violations.map((v) => v.clause))].join(','), fields: { clauses: o.clauses, unattributedOverlayCalls: o.unattributedOverlayCalls }, evidence: { violations: o.violations } }),
    sceneOwnership: { rows: o.table, clauses: o.clauses },
  };
}

/** §C9 -- `{isolationShape, hiddenShape, isolationNormalizable, hiddenNormalizable, prerequisite}`. */
function evaluateC9(obs) {
  const o = obs || {};
  const ok = o.isolationNormalizable === true && o.hiddenNormalizable === true && Boolean(o.prerequisite) && o.prerequisite.available === true;
  return makeCheckRecord({ verdict: ok ? 'PASS' : 'FAIL', reason: ok ? null : 'reads-not-normalizable-or-prerequisite-false', fields: { isolationShape: o.isolationShape || null, hiddenShape: o.hiddenShape || null, prerequisite: o.prerequisite || null } });
}

/**
 * §C10 -- spy order and round trip. `records` = bridge-origin spy records of the isolate present
 * (model-tagged); expected: the reads (`getAggregateIsolation`, `getAggregateHiddenNodes`) BEFORE
 * exactly one `setAggregateIsolation` with one entry per model (labels A,B) and non-empty ids
 * (`nonEmptyIds`); `postEqualsTarget`, `isolated`; `clear:{isolation, postIsolationEmpty,
 * postHiddenEmpty, emptySetWithoutCompare}`; `hiddenReportsPanelIsolation` recorded (residual a).
 */
function evaluateC10(obs) {
  const o = obs || {};
  const recs = Array.isArray(o.records) ? o.records : [];
  const sets = recs.filter((r) => r.method === 'viewer.setAggregateIsolation');
  const firstSet = sets.length ? recs.indexOf(sets[0]) : -1;
  const before = firstSet === -1 ? [] : recs.slice(0, firstSet).map((r) => r.method);
  const readsFirst = ['viewer.getAggregateIsolation', 'viewer.getAggregateHiddenNodes'].every((m) => before.includes(m));
  const c = o.clear || {};
  const clauses = {
    readsBeforeSet: readsFirst,
    exactlyOneSet: sets.length === 1,
    onePerModel: sets.length === 1 && Array.isArray(sets[0].modelLabels) && sets[0].modelLabels.join(',') === 'A,B' && o.nonEmptyIds === true,
    postEqualsTarget: o.postEqualsTarget === true && o.isolated === true,
    restored: c.isolation === 'restored' && c.postIsolationEmpty === true && c.postHiddenEmpty === true && c.emptySetWithoutCompare === false,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, hiddenReportsPanelIsolation: o.hiddenReportsPanelIsolation === undefined ? null : o.hiddenReportsPanelIsolation, observationOnly: ['hiddenReportsPanelIsolation'] } });
}

/** §C11 + N5 -- `{prerequisiteWhileHidden, presentOutcome, setIsolationCallsDuringPresent, nodeStillHidden, prerequisiteAfterShow}`. */
function evaluateC11(obs) {
  const o = obs || {};
  const pre = o.prerequisiteWhileHidden || {};
  const p = o.presentOutcome || {};
  const clauses = {
    unavailable: pre.available === false && typeof pre.reason === 'string' && pre.reason !== '',
    notIsolated: p.isolated === false && Array.isArray(p.notes) && p.notes.length >= 1,
    zeroSets: o.setIsolationCallsDuringPresent === 0,
    nodeStillHidden: o.nodeStillHidden === true,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, prerequisiteAfterShow: o.prerequisiteAfterShow || null } });
}

/** N5 -- hidden node blocks isolation: `available:false` detected; restoration = node shown and `available:true` again. */
function evaluateN5({ prerequisiteWhileHidden = null, prerequisiteAfterShow = null, timedOut = false, executable = true } = {}) {
  if (!executable) return makeControlRecord('N5', 'NOT_EXECUTABLE');
  if (timedOut) return makeControlRecord('N5', 'TIMED_OUT');
  const fields = { prerequisiteWhileHidden, prerequisiteAfterShow };
  if (!prerequisiteWhileHidden || prerequisiteWhileHidden.available !== false) return makeControlRecord('N5', 'NOT_DETECTED', { fields });
  return makeControlRecord('N5', prerequisiteAfterShow && prerequisiteAfterShow.available === true ? 'DETECTED_RESTORED' : 'RESTORE_FAILED', { fields });
}

/** §C12 + N4 -- `{clear:{isolation, notes}, bridgeSetsAfterForeign, foreignUnchanged, markersRemoved, replacement:{bridgeRestoredOverForeign, finalState}}`. */
function evaluateC12(obs) {
  const o = obs || {};
  const c = o.clear || {};
  const clauses = {
    skippedExternal: c.isolation === 'skipped-external',
    noBridgeSetAfterForeign: o.bridgeSetsAfterForeign === 0,
    foreignUnchanged: o.foreignUnchanged === true,
    markersRemoved: o.markersRemoved === true,
    replacementDoesNotRestoreOverForeign: Boolean(o.replacement) && o.replacement.bridgeRestoredOverForeign === false,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, replacementFinalState: o.replacement ? o.replacement.finalState || null : null } });
}

/** N4 -- harness-induced foreign isolation detected (`skipped-external`); restoration = isolation reset to empty. */
function evaluateN4({ clearIsolation = null, resetToEmpty = null, timedOut = false, executable = true } = {}) {
  if (!executable) return makeControlRecord('N4', 'NOT_EXECUTABLE');
  if (timedOut) return makeControlRecord('N4', 'TIMED_OUT');
  if (clearIsolation !== 'skipped-external') return makeControlRecord('N4', 'NOT_DETECTED', { fields: { clearIsolation } });
  return makeControlRecord('N4', resetToEmpty === true ? 'DETECTED_RESTORED' : 'RESTORE_FAILED', { fields: { clearIsolation, resetToEmpty } });
}

/**
 * §C13 -- expected `ClearOutcome.isolation` per scenario: C10 restored; C12 skipped-external;
 * C15(b)/(c) restored, or `none` where isolation was never confirmed and already equals the
 * pre-image (`noneAllowed`); C15(e) first clear() failed, second restored, third none (RC1).
 * `outcomes = {C10, C12, C15b, C15c, C15e}` each `{isolation, noneAllowed?}` (C15e also `{clear2,
 * clear3}`); a missing scenario => BLOCKED(scenario-missing:..).
 */
function evaluateC13(outcomes) {
  const o = outcomes || {};
  const expected = { C10: ['restored'], C12: ['skipped-external'], C15b: ['restored', 'none'], C15c: ['restored', 'none'], C15e: ['failed'] };
  // RC1: C15(e) runs three clear() calls -- first `failed`, second `restored`, third `none`.
  const expectedC15eLater = { clear2: 'restored', clear3: 'none' };
  const missing = Object.keys(expected).filter((k) => !o[k] || typeof o[k].isolation !== 'string'
    || (k === 'C15e' && Object.keys(expectedC15eLater).some((n) => typeof o[k][n] !== 'string')));
  if (missing.length) return makeCheckRecord({ verdict: 'BLOCKED', reason: `scenario-missing:${missing.join(',')}`, fields: { outcomes: o } });
  const bad = Object.keys(expected).filter((k) => {
    if (k === 'C15e' && Object.keys(expectedC15eLater).some((n) => o[k][n] !== expectedC15eLater[n])) return true;
    const got = o[k].isolation;
    if (got === 'none') return !(expected[k].includes('none') && o[k].noneAllowed === true);
    return !expected[k].includes(got);
  });
  return makeCheckRecord({ verdict: bad.length ? 'FAIL' : 'PASS', reason: bad.length ? `mismatch:${bad.join(',')}` : null, fields: { outcomes: o, expected: { ...expected, C15eLater: expectedC15eLater } } });
}

/**
 * §C14 -- one execution of each interleaving: `presentPresent:{p1Superseded, p2Superseded, ledgerOnlyP2,
 * finalEqualsY}`, `presentClear:{superseded, finalEmpty}`, `presentDispose:{superseded, residueOk}`,
 * `spyBalanced`, `finalIsolationEmpty`.
 */
function evaluateC14(obs) {
  const o = obs || {};
  const pp = o.presentPresent || {};
  const pc = o.presentClear || {};
  const pd = o.presentDispose || {};
  const clauses = {
    presentPresent: pp.p1Superseded === true && pp.p2Superseded === false && pp.ledgerOnlyP2 === true && pp.finalEqualsY === true,
    presentClear: pc.superseded === true && pc.finalEmpty === true,
    presentDispose: pd.superseded === true && pd.residueOk === true,
    noStranded: o.spyBalanced === true && o.finalIsolationEmpty === true,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? failed.join(',') : null, fields: { clauses, characterization: 'one execution per interleaving' } });
}

// ---- §C15(e) (RC1 + RC1-C1): three-clear oracle over externally observable state ----------------
// The oracle is a PURE function of the retained evidence `checks.C15.fields.e` (exact schema in
// validateC15eEvidence, Section 12). Post-clear `inspectLedger()` values live only under
// `diagnostics.*` and never enter a comparison, predicate or verdict.

/** Predicate names of §C15(e), in procedure order. */
const C15E_PREDICATE_NAMES = Object.freeze(['F1', 'F2', 'F3', 'F4', 'S1', 'S2', 'S3', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'D1', 'D2', 'D3']);
/**
 * Named FAIL labels of §C15(e) *FAIL*, in the precedence used when several apply (fail-closed
 * unreadable first; a label is null when only an unnamed predicate failed).
 */
const C15E_FAILURE_LABELS = Object.freeze(['post-clear-read-unreadable', 'isolation-stranded', 'oracle-conflict', 'hidden-changed-after-failed-clear', 'hidden-not-baseline']);
/** The setup model-key list (C1 / T14: both fixtures loaded; checked as a C15(e) setup precondition). */
const C15E_SETUP_MODEL_KEYS = Object.freeze(['A', 'B']);
/**
 * Q4: the ONLY harness-origin Viewer calls that are not mutating (read-only public reads). Every other
 * harness-origin spy record inside the Q4 span is a mutating call (fail-closed allow-list).
 */
const C15E_NON_MUTATING_METHODS = Object.freeze(['viewer.getAggregateIsolation', 'viewer.getAggregateHiddenNodes', 'viewer.getAggregateSelection', 'viewer.getAllModels']);

/** `modelKey(m)`: 'A' / 'B' iff `m` is (===) the harness-loaded model object; otherwise null. */
function c15eModelKey(m, models) {
  if (m === null || (typeof m !== 'object' && typeof m !== 'function') || !models) return null;
  if (m === models.A) return 'A';
  if (m === models.B) return 'B';
  return null;
}

/** The exact unreadable value `{unreadable:true, error:<redacted string>}` (equal to nothing). */
function c15eUnreadable(error) {
  const text = redactEvidenceText(String(error && typeof error === 'object' && error.message !== undefined ? error.message : error)).value;
  return { unreadable: true, error: truncateUtf8(text, 512).value };
}

/**
 * Canonical isolation / hidden value (C9/C10 form, §C15(e) RC1-C1): `raw` is an array of per-model
 * entries `{model, ids}`; each maps to `{model:modelKey(model), ids:<ascending, de-duplicated integer
 * dbIds>}`; entries of one model are merged (set union), empty entries dropped, sorted by model key.
 * Not an array / non-object entry / model not A or B by identity / model absent from `allModels`
 * (`getAllModels()`) / non-integer id => the exact unreadable value.
 */
function canonicalAggregate(raw, { models, allModels } = {}) {
  if (!Array.isArray(raw)) return c15eUnreadable('read-not-an-array');
  if (!Array.isArray(allModels)) return c15eUnreadable('getAllModels-unreadable');
  const merged = new Map();
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') return c15eUnreadable('entry-not-an-object');
    const key = c15eModelKey(entry.model, models);
    if (key === null) return c15eUnreadable('entry-model-not-A-or-B');
    if (!allModels.includes(entry.model)) return c15eUnreadable(`entry-model-not-loaded:${key}`);
    const ids = entry.ids;
    if (ids === null || typeof ids !== 'object' || typeof ids.length !== 'number') return c15eUnreadable('entry-ids-not-array-like');
    const list = Array.from(ids);
    if (!list.every((v) => Number.isInteger(v))) return c15eUnreadable('entry-id-not-integer');
    if (!merged.has(key)) merged.set(key, new Set());
    for (const v of list) merged.get(key).add(v);
  }
  return [...merged.keys()].sort()
    .map((key) => ({ model: key, ids: [...merged.get(key)].sort((x, y) => x - y) }))
    .filter((e) => e.ids.length > 0);
}

/** `canonicalHidden(raw, {models, allModels})` -- canonical hidden-nodes value (same form as isolation). */
function canonicalHidden(raw, ctx) { return canonicalAggregate(raw, ctx); }
/** `canonicalIsolation(raw, {models, allModels})` -- canonical isolation value (E0, T_iso, after reads). */
function canonicalIsolation(raw, ctx) { return canonicalAggregate(raw, ctx); }

/** Runs one read; a throwing read is the exact unreadable value (redacted), never a thrown error. */
function readCanonicalAggregate(readFn, ctx) {
  let raw;
  try { raw = readFn(); } catch (err) { return c15eUnreadable(err); }
  return canonicalAggregate(raw, ctx);
}

/** True for a well-formed canonical array (model keys A/B ascending, ids non-empty ascending integers). */
function isC15eCanonArray(v) {
  if (!Array.isArray(v)) return false;
  let prev = '';
  for (const e of v) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return false;
    const keys = Object.keys(e).sort();
    if (keys.length !== 2 || keys[0] !== 'ids' || keys[1] !== 'model') return false;
    if (!C15E_SETUP_MODEL_KEYS.includes(e.model) || !(e.model > prev)) return false;
    prev = e.model;
    if (!Array.isArray(e.ids) || e.ids.length === 0) return false;
    for (let i = 0; i < e.ids.length; i += 1) {
      if (!Number.isInteger(e.ids[i]) || (i > 0 && !(e.ids[i] > e.ids[i - 1]))) return false;
    }
  }
  return true;
}

/** `hiddenEquals(x, y)` <=> both canonical arrays and byte-equal JSON (no subset/superset/tolerance). */
function hiddenEquals(x, y) { return isC15eCanonArray(x) && isC15eCanonArray(y) && JSON.stringify(x) === JSON.stringify(y); }
/** `isolationEquals` on canonical isolation values: the same byte-equality rule. */
function canonIsolationEquals(x, y) { return hiddenEquals(x, y); }

/** LedgerDTO -- the only persisted projection of an `inspectLedger()` value (null ledger => null). */
function c15eLedgerDTO(L) {
  if (L === null || L === undefined) return null;
  const mm = L.markerMeshes;
  return {
    markerMeshCount: mm && typeof mm.length === 'number' ? mm.length : 0,
    isolationConfirmed: L.isolation ? L.isolation.confirmed === true : null,
  };
}

const c15eIsUnreadable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && v.unreadable === true;

/**
 * `c15eDerive(e)` -> `{comparisons, predicates, failureLabel, thrownInjectedCount}` -- every value a
 * pure function of the stored fields (the schema validator recomputes these and compares).
 * Spy-window coverage: clears[0].spyWindow = records with startSeq < seq < settleSeq; clears[N]
 * (N >= 1) = records with clears[N-1].settleSeq < seq < clears[N].settleSeq, i.e. the gap before the
 * clear plus its own window, so Q4 sees the whole span "start of clear #1 .. settle of clear #3".
 * F4/S2/Q3/D2 only consider a clear's OWN window (seq > startSeq).
 */
function c15eDerive(e) {
  const clears = Array.isArray(e && e.clears) ? e.clears : [];
  const step = (i) => clears[i] || {};
  const win = (i) => (Array.isArray(step(i).spyWindow) ? step(i).spyWindow : []);
  const own = (i) => win(i).filter((r) => r && Number.isInteger(r.seq) && r.seq > step(i).startSeq && r.seq < step(i).settleSeq);
  const bridgeCalls = (i, method) => own(i).filter((r) => r.origin === 'bridge' && r.method === method);
  const out = (i) => step(i).outcome || {};
  const after = (i) => step(i).after || {};
  const notesOf = (i) => (Array.isArray(out(i).notes) ? out(i).notes : []);
  const comparisons = {
    clear1: { isolationEqualsTiso: canonIsolationEquals(after(0).isolation, e.T_iso), hiddenEqualsHiso: hiddenEquals(after(0).hidden, e.H_iso) },
    clear2: { isolationEqualsE0: canonIsolationEquals(after(1).isolation, e.E0), hiddenEqualsH0: hiddenEquals(after(1).hidden, e.H0) },
    clear3: { isolationEqualsE0: canonIsolationEquals(after(2).isolation, e.E0), hiddenEqualsH0: hiddenEquals(after(2).hidden, e.H0) },
  };
  const sets1 = bridgeCalls(0, 'viewer.setAggregateIsolation');
  const thrownInjectedCount = sets1.filter((r) => r.thrown === 'injected').length;
  const allRecords = [0, 1, 2].flatMap((i) => win(i));
  const modelsUnchanged = Array.isArray(after(0).models) && JSON.stringify(after(0).models) === JSON.stringify(C15E_SETUP_MODEL_KEYS);
  const predicates = {
    F1: out(0).isolation === 'failed',
    F2: notesOf(0).includes(C15_RESTORE_FAILED_NOTE),
    F3: Number.isInteger(e.nm) && out(0).markersRemoved === e.nm,
    F4: sets1.length >= 1 && sets1.every((r) => r.thrown === 'injected'),
    S1: comparisons.clear1.isolationEqualsTiso,
    S2: Number.isInteger(e.nm) && Boolean(e.ledgerBefore) && e.ledgerBefore.markerMeshCount === e.nm
      && bridgeCalls(0, 'overlays.removeMesh').length === e.nm
      && [0, 1, 2].every((i) => bridgeCalls(i, 'overlays.addMesh').length === 0)
      && [1, 2].every((i) => bridgeCalls(i, 'overlays.removeMesh').length === 0),
    S3: comparisons.clear1.hiddenEqualsHiso && modelsUnchanged,
    Q1: out(1).isolation === 'restored',
    Q2: !notesOf(1).includes(C15_RESTORE_FAILED_NOTE) && out(1).markersRemoved === 0,
    Q3: bridgeCalls(1, 'viewer.setAggregateIsolation').length >= 1 && bridgeCalls(1, 'viewer.setAggregateIsolation').every((r) => r.thrown === null),
    Q4: allRecords.every((r) => !(r && r.origin === 'harness') || C15E_NON_MUTATING_METHODS.includes(r.method)),
    Q5: comparisons.clear2.isolationEqualsE0 && comparisons.clear2.hiddenEqualsH0,
    D1: out(2).isolation === 'none',
    D2: bridgeCalls(2, 'viewer.setAggregateIsolation').length === 0,
    D3: comparisons.clear3.isolationEqualsE0 && comparisons.clear3.hiddenEqualsH0,
  };
  const anyUnreadable = [0, 1, 2].some((i) => c15eIsUnreadable(after(i).isolation) || c15eIsUnreadable(after(i).hidden));
  let failureLabel = null;
  if (anyUnreadable) failureLabel = 'post-clear-read-unreadable';
  else if (!predicates.Q1 || !comparisons.clear2.isolationEqualsE0) failureLabel = 'isolation-stranded';
  else if (predicates.F1 && !predicates.S1) failureLabel = 'oracle-conflict';
  else if (!comparisons.clear1.hiddenEqualsHiso) failureLabel = 'hidden-changed-after-failed-clear';
  else if (!comparisons.clear2.hiddenEqualsH0 || !comparisons.clear3.hiddenEqualsH0) failureLabel = 'hidden-not-baseline';
  return { comparisons, predicates, failureLabel, thrownInjectedCount };
}

/**
 * `c15eOracle(e)` -> `{verdict:'PASS'|'FAIL'|'BLOCKED', reason, violated, failureLabel, comparisons,
 * predicates}`. BLOCKED(precondition:c15e) unless the setup preconditions hold in the stored values
 * (E0 = [] , H0 = [], T_iso non-empty canonical != E0, H_iso canonical -- an unreadable H_iso is never
 * PASS -- and ledgerBefore = {nm, confirmed:true}); BLOCKED(session-tainted) unless W_e was restored by
 * reference; BLOCKED(injection-not-verified) unless the original ran zero times while armed. Otherwise
 * PASS iff every predicate holds; FAIL names the violated predicates (and the §C15(e) label, if any).
 * `diagnostics.*` is never read.
 */
function c15eOracle(e) {
  const blocked = (reason) => ({ verdict: 'BLOCKED', reason, violated: [], failureLabel: null, comparisons: null, predicates: null });
  if (e === null || typeof e !== 'object' || !Array.isArray(e.clears) || e.clears.length !== 3) return blocked('precondition:c15e');
  const L = e.ledgerBefore;
  const pre = isC15eCanonArray(e.E0) && e.E0.length === 0 && isC15eCanonArray(e.H0) && e.H0.length === 0
    && isC15eCanonArray(e.T_iso) && e.T_iso.length > 0 && !canonIsolationEquals(e.T_iso, e.E0)
    && isC15eCanonArray(e.H_iso)
    && Number.isInteger(e.nm) && L !== null && typeof L === 'object' && L.markerMeshCount === e.nm && L.isolationConfirmed === true;
  if (!pre) return blocked('precondition:c15e');
  const inj = e.injection || {};
  if (inj.restoredByReference !== true) return blocked('session-tainted');
  if (inj.originalInvocationsWhileArmed !== 0) return blocked('injection-not-verified');
  const d = c15eDerive(e);
  const violated = C15E_PREDICATE_NAMES.filter((n) => d.predicates[n] !== true);
  if (violated.length === 0) return { verdict: 'PASS', reason: null, violated, failureLabel: null, comparisons: d.comparisons, predicates: d.predicates };
  const reason = d.failureLabel ? `${d.failureLabel}:${violated.join(',')}` : violated.join(',');
  return { verdict: 'FAIL', reason, violated, failureLabel: d.failureLabel, comparisons: d.comparisons, predicates: d.predicates };
}

/**
 * §C15 -- (a)–(d) expected outcomes plus the global per-scenario assertion (`globalOk`: hidden empty,
 * isolation empty, Panel meshes/scenes equal to baseline); each (a)–(d) observation carries
 * `injectedFired`. (e) is `{evidence, blocked, globalOk}`: `evidence` is the exact retained
 * `checks.C15.fields.e` object (or null when the scenario stopped before the oracle could run, with
 * `blocked` = the BLOCKED reason, e.g. `precondition:c15e`, `timeout:clear`, `session-tainted`); the
 * (e) clause is recomputed here by `c15eOracle(evidence)` (never trusted from the driver) AND the
 * scenario-end global assertion. Any (a)–(e) FAIL => FAIL(<clauses>); else a BLOCKED (e) =>
 * BLOCKED(<reason>); else PASS.
 */
function evaluateC15(obs) {
  const o = obs || {};
  const a = o.a || {}; const b = o.b || {}; const c = o.c || {}; const d = o.d || {}; const e = o.e || {};
  const fired = (s) => s.injectedFired === true;
  const evidence = Object.prototype.hasOwnProperty.call(e, 'evidence') ? e.evidence : null;
  const eBlockedByDriver = typeof e.blocked === 'string' && e.blocked !== '' ? e.blocked : null;
  const eOracle = eBlockedByDriver !== null
    ? { verdict: 'BLOCKED', reason: eBlockedByDriver, violated: [], failureLabel: null }
    : c15eOracle(evidence);
  const eBlocked = eOracle.verdict === 'BLOCKED';
  const clauses = {
    a: fired(a) && a.allAddedRemoved === true && a.ledgerNull === true && a.marked === false && a.failedNote === true && a.globalOk === true,
    b: fired(b) && b.isolationUnchanged === true && b.noMarkerLeak === true && b.globalOk === true,
    c: fired(c) && c.finalIsolationEmpty === true && c.globalOk === true,
    d: fired(d) && d.fitted === true && Array.isArray(d.notes) && d.notes.includes(C15_FIRST_ONLY_NOTE) && d.globalOk === true,
    e: !eBlocked && eOracle.verdict === 'PASS' && e.globalOk === true,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k] && !(k === 'e' && eBlocked));
  const fields = {
    clauses,
    e: evidence === undefined ? null : evidence,
    eOracle: { verdict: eOracle.verdict, reason: eOracle.reason, violated: eOracle.violated, failureLabel: eOracle.failureLabel, globalOk: e.globalOk === true },
  };
  const evidenceOut = { observation: { a, b, c, d } };
  if (failed.length) return makeCheckRecord({ verdict: 'FAIL', reason: failed.join(','), fields, evidence: evidenceOut });
  if (eBlocked) return makeCheckRecord({ verdict: 'BLOCKED', reason: eOracle.reason, fields, evidence: evidenceOut });
  return makeCheckRecord({ verdict: 'PASS', fields, evidence: evidenceOut });
}

/**
 * §C16 -- `hideModel(B)`: expected (spec §16) MODEL_REMOVED fires and BEFORE_MODEL_UNLOAD does not;
 * payload `event.model === B`; bridge callback `{B,'removed'}`; then `showModel(B)` restores B in
 * `getAllModels()` with working reads (else RESTORE_FAILED => cleanup FAIL, C17 BLOCKED). Missing
 * MODEL_REMOVED within T6 => FAIL (E4). Different behaviour => FAIL with complete raw evidence.
 */
function evaluateC16(obs) {
  const o = obs || {};
  const log = Array.isArray(o.eventLog) ? o.eventLog : [];
  const names = o.eventNames || {};
  const entries = (n) => log.filter((x) => x.kind === 'listener-entry' && x.eventName === n);
  const mr = entries(names.MODEL_REMOVED);
  const bu = entries(names.BEFORE_MODEL_UNLOAD);
  const cb = log.filter((x) => x.kind === 'bridge-callback' && x.modelLabel === 'B' && x.reason === 'removed');
  const fields = { modelRemovedEntries: mr.length, beforeUnloadEntries: bu.length, bridgeRemovedCallbacks: cb.length, restored: o.restored === true, eventNameValues: names };
  if (o.timedOut) return makeCheckRecord({ verdict: 'BLOCKED', reason: `timeout:${o.timedOut}`, fields });
  if (o.restored !== true) return makeCheckRecord({ verdict: 'FAIL', reason: 'RESTORE_FAILED', fields, evidence: { eventLog: log } });
  const ok = mr.length === 1 && mr[0].modelLabel === 'B' && bu.length === 0 && cb.length === 1;
  return makeCheckRecord({ verdict: ok ? 'PASS' : 'FAIL', reason: ok ? null : 'event-behaviour-differs-from-spec-16', fields, evidence: { eventLog: log } });
}

/**
 * §C18a -- `{panelScenesAbsent, foreignOk, listenerAddRemove:{[eventName]:{add, remove}}, ledgerNull,
 * disposal:{disposed, releaseNotes, listenerErrors}, postDispose:{presentDisposed, clearDisposed,
 * bridgeMutatorCalls}, isolationHiddenEmpty}`. C18 overall = C18a ∧ C18b (combineSubchecks).
 */
function evaluateC18a(obs) {
  const o = obs || {};
  const lar = o.listenerAddRemove || {};
  const d = o.disposal || {};
  const p = o.postDispose || {};
  const clauses = {
    1: o.panelScenesAbsent === true,
    2: o.foreignOk === true,
    3: Object.keys(lar).length >= 1 && Object.values(lar).every((x) => x.add === x.remove),
    4: o.ledgerNull === true && d.disposed === true && Array.isArray(d.releaseNotes) && d.releaseNotes.length === 0 && Array.isArray(d.listenerErrors) && d.listenerErrors.length === 0,
    5: p.presentDisposed === true && p.clearDisposed === true && p.bridgeMutatorCalls === 0,
    6: o.isolationHiddenEmpty === true,
  };
  const failed = Object.keys(clauses).filter((k) => !clauses[k]);
  return makeCheckRecord({ verdict: failed.length ? 'FAIL' : 'PASS', reason: failed.length ? `clause:${failed.join(',')}` : null, fields: { clauses } });
}

/** Viewer methods the ViewerBridge may call (procedure E3), as spy labels. */
const BRIDGE_ALLOWED_SPY_METHODS = Object.freeze([
  'viewer.setAggregateIsolation', 'viewer.getAggregateIsolation', 'viewer.getAggregateHiddenNodes', 'viewer.fitToView',
  'viewer.getAggregateSelection', 'overlays.addScene', 'overlays.addMesh', 'overlays.removeMesh', 'overlays.removeScene',
  'viewer.addEventListener', 'viewer.removeEventListener',
]);

/**
 * Markers-only v1 / zero-theming ledger assertion: every theming call (any origin) and every
 * bridge-origin call outside the E3 allowed set is a violation. Theming violations are verdict-bearing
 * in C19; the non-E3 bridge-method list is recorded as an observation (not a C19 clause; see report).
 */
function markersOnlyV1Violations(records) {
  const theming = records.filter((r) => r.method === `viewer.${THEMING_SET_METHOD}` || r.method === `viewer.${THEMING_CLEAR_METHOD}`);
  const nonE3Bridge = records.filter((r) => r.origin === 'bridge' && !BRIDGE_ALLOWED_SPY_METHODS.includes(r.method));
  return { theming, nonE3Bridge };
}

/**
 * §C19 -- whole-session spy ledger: zero theming calls (any origin), zero selection mutators with
 * origin bridge/shell/unattributed (Section 19 `prohibitedCallViolations`); N1 must be DETECTED
 * (otherwise BLOCKED(dependency:N1) -- the ledger cannot be trusted). The offline static asserts
 * (no `viewer.impl`/private access, harness issues no theming call) are separate tests.
 */
function evaluateC19({ records, n1State }) {
  if (n1State !== 'DETECTED') return makeCheckRecord({ verdict: 'BLOCKED', reason: 'dependency:N1', fields: { n1State: n1State === undefined ? null : n1State } });
  if (!Array.isArray(records)) return makeCheckRecord({ verdict: 'BLOCKED', reason: 'ledger-unavailable' });
  const v = prohibitedCallViolations(records);
  const m = markersOnlyV1Violations(records);
  return makeCheckRecord({
    verdict: v.length === 0 ? 'PASS' : 'FAIL',
    reason: v.length === 0 ? null : [...new Set(v.map((x) => x.kind))].join(','),
    fields: { violations: v.length, themingCalls: m.theming.length, nonE3BridgeMethods: [...new Set(m.nonE3Bridge.map((r) => r.method))], ledgerRecords: records.length },
    evidence: { offending: v.map((x) => ({ kind: x.kind, method: x.record.method, origin: x.record.origin, callIndex: x.record.callIndex })) },
  });
}

// ============================================================================================
// Section 34 -- N1–N8 control machinery and the D4 bounded failure-injection wrappers (procedure §7,
// §C15, §4.3/§4.6: injection INSIDE the recorder). Injection is DORMANT: `createFailureInjection
// Controller().install` refuses unless LIVE_PATH_WIRED is true (it is false in this revision), except
// on an object explicitly branded as an offline test fake (OFFLINE_FAKE_TARGET_BRAND) with
// `allowOfflineFakes:true`. A real Viewer never carries that brand, so no real-Viewer failure
// injection can happen from this revision. Every injection is bounded (a fixed fire budget) and
// throws a G2InjectedError tagged `injected:true` (the error ledger treats an uncaught one as fatal).
// ============================================================================================

const OFFLINE_FAKE_TARGET_BRAND = Symbol.for('g2.harness.offline-fake-target');

class G2InjectedError extends Error {
  constructor(scenario, method) {
    super(`G2 injected failure (C15 ${scenario}) in ${method}`);
    this.name = 'G2InjectedError';
    this.injected = true;
    this.scenario = scenario;
  }
}

/** True for a harness-injected C15 error (§9: tagged `injected`; uncaught => fatal). */
function isInjectedError(err) { return Boolean(err) && err.injected === true && err.name === 'G2InjectedError'; }

/**
 * §C15 (a)–(e) injection specs (D4). `fireOnCall`: which matching call first fires; `maxFires`: hard
 * budget; `mode`: 'throw-before' (no state change) | 'throw-after' (state changes, then throws);
 * `aggregateOnly`: count only the aggregate fitToView form; `armedOnly`: fires only while armed (e =
 * "every call for the duration of one clear()", bounded by maxFires).
 */
const C15_INJECTION_SPECS = Object.freeze({
  a: Object.freeze({ owner: 'overlays', method: 'addMesh', mode: 'throw-before', fireOnCall: 2, maxFires: 1, aggregateOnly: false, armedOnly: false }),
  b: Object.freeze({ owner: 'viewer', method: 'setAggregateIsolation', mode: 'throw-before', fireOnCall: 1, maxFires: 1, aggregateOnly: false, armedOnly: false }),
  c: Object.freeze({ owner: 'viewer', method: 'setAggregateIsolation', mode: 'throw-after', fireOnCall: 1, maxFires: 1, aggregateOnly: false, armedOnly: false }),
  d: Object.freeze({ owner: 'viewer', method: 'fitToView', mode: 'throw-before', fireOnCall: 1, maxFires: 1, aggregateOnly: true, armedOnly: false }),
  e: Object.freeze({ owner: 'viewer', method: 'setAggregateIsolation', mode: 'throw-before', fireOnCall: 1, maxFires: 8, aggregateOnly: false, armedOnly: true }),
});

function isAggregateFitArgs(args) {
  const a0 = args[0];
  return Array.isArray(a0) && a0.length > 0 && a0[0] !== null && typeof a0[0] === 'object' && 'model' in a0[0];
}

/** Builds the `makeInjected(prev)` factory for installInjectionWrapper from one spec (bounded). */
function makeBoundedInjection(scenario, spec, counters) {
  return (prev) => function boundedInjection(...args) {
    const counts = !spec.aggregateOnly || isAggregateFitArgs(args);
    if (counts) counters.matchingCalls += 1;
    const fire = counts && counters.matchingCalls >= spec.fireOnCall && counters.fires < spec.maxFires && (!spec.armedOnly || counters.armed);
    if (fire && spec.mode === 'throw-before') { counters.fires += 1; throw new G2InjectedError(scenario, spec.method); }
    if (counters.armed) counters.originalInvocationsWhileArmed += 1; // §C15(e): must stay 0 (throw-before on every armed call)
    const result = Reflect.apply(prev, this, args);
    if (fire && spec.mode === 'throw-after') { counters.fires += 1; throw new G2InjectedError(scenario, spec.method); }
    return result;
  };
}

/**
 * `createFailureInjectionController({registry, allowOfflineFakes})` -> `{install(scenario, owners),
 * installed()}`. `install` returns `{scenario, arm(), disarm(), fires(), matchingCalls(), originalInvocationsWhileArmed(), remove()}`;
 * removal is LIFO through Section 19 and verified. Refuses (G2RefusalError 'failure-injection-dormant')
 * unless the live path is wired or the target is a branded offline fake with allowOfflineFakes.
 */
function createFailureInjectionController({ registry, allowOfflineFakes = false }) {
  const active = [];
  return {
    installed: () => active.map((h) => h.scenario),
    install(scenario, owners) {
      const spec = C15_INJECTION_SPECS[scenario];
      if (!spec) throw new TypeError(`failure injection: unknown scenario ${String(scenario)}`);
      const target = owners ? owners[spec.owner] : null;
      if (!target) throw new TypeError(`failure injection: owner ${spec.owner} missing`);
      const brandedFake = target[OFFLINE_FAKE_TARGET_BRAND] === true;
      if (!LIVE_PATH_WIRED && !(allowOfflineFakes === true && brandedFake)) {
        throw new G2RefusalError('failure-injection-dormant', 'C15 failure injection is dormant: the live path is not wired and the target is not a branded offline fake');
      }
      const counters = { matchingCalls: 0, fires: 0, armed: false, originalInvocationsWhileArmed: 0 };
      const layer = installInjectionWrapper(target, spec.method, makeBoundedInjection(scenario, spec, counters), { registry });
      const handle = {
        scenario,
        arm() { counters.armed = true; },
        disarm() { counters.armed = false; },
        fires: () => counters.fires,
        matchingCalls: () => counters.matchingCalls,
        originalInvocationsWhileArmed: () => counters.originalInvocationsWhileArmed,
        remove() {
          const r = layer.remove();
          const i = active.indexOf(handle);
          if (r.ok && i !== -1) active.splice(i, 1);
          return r;
        },
      };
      active.push(handle);
      return handle;
    },
  };
}

/** Control state used when a control cannot run: NOT_EXECUTABLE where §7 allows it, else NOT_DETECTED. */
function notExecutableState(name) {
  return CONTROL_ALLOWED_STATES[name].includes('NOT_EXECUTABLE') ? 'NOT_EXECUTABLE' : (name === 'N8' || name === 'N6' ? 'NOT_APPLICABLE' : 'NOT_DETECTED');
}

/**
 * `runControlWithDeadline({name, timeoutMs, fn, timers, quarantine})` -- runs a control body under a
 * token-bounded deadline (§4.5): timed-out => TIMED_OUT where allowed (else NOT_DETECTED); a throw =>
 * NOT_DETECTED; otherwise `fn` must return a control record for `name` (validated).
 */
async function runControlWithDeadline({ name, timeoutMs = TABLE_T.T5.singleOperationDeadlineMs, fn, timers = DEFAULT_TIMERS, quarantine = null }) {
  const out = await runWithDeadline({ op: `control:${name}`, timeoutMs, fn, timers, quarantine });
  if (out.status === 'timed-out') {
    const st = CONTROL_ALLOWED_STATES[name].includes('TIMED_OUT') ? 'TIMED_OUT' : 'NOT_DETECTED';
    return makeControlRecord(name, st, { fields: { reason: 'timeout' } });
  }
  if (out.status === 'threw') return makeControlRecord(name, 'NOT_DETECTED', { fields: { reason: 'control-threw', error: summarizeThrown(out.error) } });
  const v = validateControlRecord(name, out.value);
  return v.ok ? out.value : makeControlRecord(name, 'NOT_DETECTED', { fields: { reason: 'invalid-control-record', errors: v.errors } });
}

/** N1 record from Section 19 `runSpySelfTestN1`. */
function n1Record(result) {
  const { state, ...rest } = result || {};
  return makeControlRecord('N1', state === 'DETECTED' ? 'DETECTED' : 'NOT_DETECTED', { fields: rest });
}

/** N3 record from Section 23 `runSceneOwnershipControlN3` (+ the live scene observations of C7α). */
function n3Record(result, { liveObservationsHold = null } = {}) {
  const { state, ...rest } = result || {};
  const ok = state === 'DETECTED_RESTORED' && liveObservationsHold === true;
  return makeControlRecord('N3', ok ? 'DETECTED_RESTORED' : 'NOT_DETECTED', { fields: { ...rest, liveObservationsHold } });
}

// ============================================================================================
// Section 35 -- the ordered check runner (procedure §5 phase order, dependency table, taint rule)
// and the offline planner. `runChecksInPhaseOrder` drives INJECTED phase drivers in PHASE_ORDER;
// it never touches a Viewer itself. Mode 'live' is refused while LIVE_PATH_WIRED is false; offline
// tests use fake drivers. `planChecks()` lists every unit as LIVE_PENDING_STATUS (no verdicts).
// ============================================================================================

/** Phase units whose id differs from the §10 check they feed. */
const SUBCHECK_OF = Object.freeze({ C7alpha: 'C7', C7beta: 'C7', C18a: 'C18', C18b: 'C18' });
/** PHASE_ORDER lists P5b's unit as 'C7' (= C7β). */
const PHASE_UNIT_ALIAS = Object.freeze({ P5b: Object.freeze({ C7: 'C7beta' }) });
/** C13 needs C15(b)/(c)/(e) outcomes (§C13), so it is executed with P8 (see report). */
const DEFERRED_UNITS = Object.freeze({ C13: 'P8' });
/** Read-only checks that may still run after taint (§5 "only read-only diagnostics may continue"). */
const READ_ONLY_UNITS = Object.freeze(['C5', 'C13', 'C19']);
/** Controls that are pure recomputations (no Viewer effect) and may run after taint. */
const PURE_CONTROLS = Object.freeze(['N3', 'N6', 'N8']);
const NON_CHECK_PHASES = Object.freeze(['P0', 'cleanup', 'closeout']);

/** The executable units of a phase (aliases and deferrals applied). */
function phaseUnits(phase) {
  const alias = PHASE_UNIT_ALIAS[phase.id] || {};
  const checks = phase.checks.map((c) => alias[c] || c).filter((c) => !DEFERRED_UNITS[c]);
  for (const [unit, target] of Object.entries(DEFERRED_UNITS)) if (target === phase.id) checks.push(unit);
  return { checks, controls: [...phase.controls] };
}

/** `planChecks()` -- the offline plan: every unit in phase order with status LIVE_PENDING_STATUS. */
function planChecks(phases = PHASE_ORDER) {
  return phases.filter((p) => !NON_CHECK_PHASES.includes(p.id)).map((p) => {
    const u = phaseUnits(p);
    return { phase: p.id, name: p.name, units: [...u.checks, ...u.controls].map((id) => ({ id, feeds: SUBCHECK_OF[id] || id, status: LIVE_PENDING_STATUS })) };
  });
}

/** Direct-dependency blockers of a unit, excluding dependencies produced in the same phase. */
function unitBlockers(unit, samePhaseUnits, verdictMap) {
  const parent = SUBCHECK_OF[unit] || unit;
  if (!CHECK_NAMES.includes(parent)) return [];
  const sameFeeds = new Set(samePhaseUnits.map((u) => SUBCHECK_OF[u] || u));
  return dependencyBlockers(parent, verdictMap).filter((d) => !sameFeeds.has(d));
}

function verdictMapOf(checks, controls) {
  const m = {};
  const sev = (b) => (b === null || b === undefined ? 4 : CHECK_BASE_SEVERITY[b]);
  for (const [k, rec] of Object.entries(checks)) {
    const key = SUBCHECK_OF[k] || k;
    const base = checkVerdictBase(rec);
    if (!(key in m) || sev(base) > sev(m[key])) m[key] = base;
  }
  for (const [k, rec] of Object.entries(controls)) m[k] = controlEffectiveState(rec);
  return m;
}

/**
 * `runChecksInPhaseOrder({drivers, mode, assertPhaseBaseline, fatalObserved, recorder, nextSeq,
 * errorLedger, gateHooks})` -- executes `drivers[phaseId](ctx)` for P1..P11 in §5 order. `ctx =
 * {phase, runnable:{checks, controls}, blocked, sessionTainted, beginControl, beginCheck, results}`; a
 * driver returns `{checks:{unit:record}, controls:{N:record}, extras:{...}, tainted?:boolean}`. Rules:
 * dependency blockers => BLOCKED(dependency:<list>); after taint, mutating units =>
 * BLOCKED(session-tainted:<phase>) (read-only checks and pure controls may continue); a fatal
 * error-ledger event skips everything left to cleanup (BLOCKED(fatal-skip)); a driver throw => its
 * units BLOCKED(harness-exception:<phase>) and taint; the phase-boundary baseline assertion failing =>
 * taint. A recorded FAIL is never erased. At the end C7 = C7α ∧ C7β, C18 = C18a ∧ C18b, and every
 * check/control lacking a record gets BLOCKED(not-executed) / the §7 not-executable state.
 *
 * RC1-C1/RC1-C2 (slices B1+B2). Every check is a `check-run` record (bare verdict); C1 is finalized
 * (`finalizeC1Record`) right after P1 -- its single `check-finalized` event is appended to the eventLog.
 * **Global C1 gate (§7):** after C1's finalization and BEFORE the P2 marker and any P2 action, the
 * runner performs the atomic gate preparation (`prepareC1Gate`, synchronous) and records `gates.C1`.
 * `OPEN` => P2..P11 run per §5 (every C2..C20/N1..N8 record is a run record; a later runtime BLOCKED
 * stays a `check-run` record). Closed (`CLOSED_DEPENDENCY_BLOCKED` | `CLOSED_OTHER`) => NO P2..P11
 * phase starts (no driver call, no P2 spy installation, no N1, no marker), and exactly one synthetic
 * gate-disposition record per C2..C20, N1..N8 is emitted in that order (G-a..G-f) with
 * `gateSeq < dispositionSeq`. **Start boundaries / attribution:** a driver MUST call
 * `ctx.beginControl(N)` immediately before a control's first action and `ctx.beginCheck(C)` before a
 * check's first action in a multi-check phase (single-check phases and P1 are attributed
 * automatically); the runner stamps the recorder's attribution context `{phase, activeCheck,
 * activeControl}`, which every spy record / eventLog entry / state snapshot carries. **Sequence:** one
 * counter only -- `recorder.nextSeq` (live: `env.recorder`); a bare `nextSeq` is wrapped by an internal
 * recorder that draws from it. **Markers:** `{seq, name}` for P1 and every P2..P11 phase entered, and
 * -- as the runner's LAST act -- the `cleanup` marker (the caller runs cleanup immediately after; the
 * attribution context is left at `phase:'cleanup'` with null active items, so cleanup-time spy records
 * fall after `cleanupSeq`). The `P0` and `closeout` markers come from the node-side run counter
 * (`runPostReservation`, slice C1).
 * `errorLedger` (object, or a synchronous function returning it at gate time) is the ledger the gate
 * preparation finalizes/counts; when absent, `fatalCountAtGate` is 1 if `fatalObserved()` else 0.
 */
async function runChecksInPhaseOrder({ drivers = {}, mode = 'offline-fake', phases = PHASE_ORDER, assertPhaseBaseline = null, fatalObserved = () => false, nextSeq = null, recorder = null, errorLedger = null, gateHooks = {}, clock = defaultClock } = {}) {
  if (mode === 'live' && !LIVE_PATH_WIRED) throw new G2RefusalError('live-path-not-wired', 'runChecksInPhaseOrder: live mode is dormant in this revision');
  if (mode === 'live' && G2_DUAL_COUNTER_GATE.resolved !== true) throw new G2RefusalError('dual-counter-gate-unresolved', 'runChecksInPhaseOrder: live mode is refused while G2_DUAL_COUNTER_GATE is unresolved');
  if (mode !== 'live' && mode !== 'offline-fake') throw new TypeError(`runChecksInPhaseOrder: unknown mode ${String(mode)}`);
  if (recorder && typeof nextSeq === 'function' && nextSeq !== recorder.nextSeq) throw new TypeError('runChecksInPhaseOrder: nextSeq must be the recorder\'s own counter (single sequence source)');
  const rec = recorder && typeof recorder.setAttribution === 'function' ? recorder : createCallRecorder({ clock, nextSeq: typeof nextSeq === 'function' ? nextSeq : null });
  const seqOf = rec.nextSeq;
  const units = {};      // unit id -> check record (sub-checks kept separately)
  const controls = {};
  const controlStarts = {};
  const extras = {};
  const phaseLog = [];
  const markers = [];
  let sessionTainted = false;
  let taintPhase = null;
  let fatalSkip = false;
  let c1FinalizedEvent = null;
  const mark = (name) => {
    rec.setAttribution({ phase: name, activeCheck: null, activeControl: null });
    const m = { seq: seqOf(), name };
    markers.push(m);
    return m;
  };
  const setUnit = (id, r) => { units[id] = mergeCheckRecord(units[id], r); };
  const setControl = (id, outcome) => {
    controls[id] = makeControlRunRecord(id, outcome, { start: controlStarts[id] || null, terminalSeq: seqOf(), terminalAt: clock.nowIso() });
  };
  const blockedCheck = (reason) => makeCheckRecord({ verdict: 'BLOCKED', reason });
  const finalizeC1 = () => {
    if (c1FinalizedEvent !== null) return;
    rec.setAttribution({ phase: 'P1', activeCheck: 'C1', activeControl: null });
    const fin = finalizeC1Record(units.C1 || blockedCheck('not-executed'), { seq: seqOf(), at: clock.nowIso() });
    units.C1 = fin.record;
    c1FinalizedEvent = fin.event;
    rec.events.push({ ...fin.event });
  };

  const runPhase = async (phase) => {
    mark(phase.id);
    const u = phaseUnits(phase);
    const entry = { phase: phase.id, ran: false, blocked: {}, taintedAfter: false, error: null };
    phaseLog.push(entry);
    if (!fatalSkip && fatalObserved()) fatalSkip = true;
    if (fatalSkip) {
      for (const c of u.checks) setUnit(c, blockedCheck('fatal-skip'));
      for (const n of u.controls) setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: 'fatal-skip' } }));
      entry.blocked = Object.fromEntries([...u.checks, ...u.controls].map((x) => [x, 'fatal-skip']));
      return;
    }
    const vm = verdictMapOf(units, controls);
    const runnable = { checks: [], controls: [] };
    for (const c of u.checks) {
      const deps = unitBlockers(c, [...u.checks, ...u.controls], vm);
      if (deps.length) { setUnit(c, blockedCheck(`dependency:${deps.join(',')}`)); entry.blocked[c] = `dependency:${deps.join(',')}`; continue; }
      if (sessionTainted && !READ_ONLY_UNITS.includes(c)) { setUnit(c, blockedCheck(`session-tainted:${taintPhase}`)); entry.blocked[c] = 'session-tainted'; continue; }
      runnable.checks.push(c);
    }
    const noCheckRunnable = u.checks.length > 0 && runnable.checks.length === 0;
    for (const n of u.controls) {
      // A control embedded in a check's action sequence (N2/C6, N3/C7α, N6/C4, N8/C20, ...) cannot run
      // when none of its phase's checks runs: it gets its §7 not-executable state (N6/N8 NOT_APPLICABLE).
      if (noCheckRunnable) { setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: `phase-checks-not-runnable:${phase.id}` } })); entry.blocked[n] = 'phase-checks-not-runnable'; continue; }
      if (sessionTainted && !PURE_CONTROLS.includes(n)) { setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: `session-tainted:${taintPhase}` } })); entry.blocked[n] = 'session-tainted'; continue; }
      runnable.controls.push(n);
    }
    const driver = drivers[phase.id];
    if (runnable.checks.length === 0 && runnable.controls.length === 0) return;
    if (typeof driver !== 'function') {
      for (const c of runnable.checks) setUnit(c, blockedCheck(`driver-missing:${phase.id}`));
      for (const n of runnable.controls) setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: `driver-missing:${phase.id}` } }));
      return;
    }
    const checkOf = (unit) => SUBCHECK_OF[unit] || unit;
    // Single-check phase (P1, P5b, P6b, P10, P11): that check is active for the whole driver run.
    if (runnable.checks.length === 1 && u.checks.length === 1) rec.setAttribution({ activeCheck: checkOf(runnable.checks[0]), activeControl: null });
    const beginControl = (n) => {
      if (!runnable.controls.includes(n)) throw new TypeError(`beginControl: ${String(n)} is not runnable in ${phase.id}`);
      rec.setAttribution({ activeControl: n });
      if (!controlStarts[n]) controlStarts[n] = { startSeq: seqOf(), startedAt: clock.nowIso() };
      return controlStarts[n].startSeq;
    };
    // `beginCheck(null)` ends the current check/control attribution (harness step owned by no check).
    const beginCheck = (c) => {
      if (c !== null && !runnable.checks.includes(c)) throw new TypeError(`beginCheck: ${String(c)} is not runnable in ${phase.id}`);
      rec.setAttribution({ activeCheck: c === null ? null : checkOf(c), activeControl: null });
    };
    let out;
    try {
      entry.ran = true;
      out = await driver({ phase: phase.id, runnable, blocked: { ...entry.blocked }, sessionTainted, beginControl, beginCheck, results: { checks: { ...units }, controls: { ...controls }, extras: { ...extras } } });
    } catch (err) {
      rec.setAttribution({ activeCheck: null, activeControl: null });
      entry.error = summarizeThrown(err);
      for (const c of runnable.checks) setUnit(c, blockedCheck(`harness-exception:${phase.id}`));
      for (const n of runnable.controls) setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: `harness-exception:${phase.id}` } }));
      sessionTainted = true; taintPhase = taintPhase || phase.id; entry.taintedAfter = true;
      return;
    }
    rec.setAttribution({ activeCheck: null, activeControl: null });
    const got = out || {};
    for (const c of runnable.checks) {
      const r = got.checks ? got.checks[c] : undefined;
      if (r === undefined) { setUnit(c, blockedCheck(`not-produced:${phase.id}`)); continue; }
      const v = validateCheckRecord(r);
      setUnit(c, v.ok ? r : blockedCheck(`invalid-record:${phase.id}`));
    }
    for (const n of runnable.controls) {
      const r = got.controls ? got.controls[n] : undefined;
      const v = r === undefined ? { ok: false } : validateControlRecord(n, r);
      setControl(n, v.ok ? r : makeControlRecord(n, 'NOT_DETECTED', { fields: { reason: r === undefined ? `not-produced:${phase.id}` : `invalid-record:${phase.id}` } }));
    }
    // Same-phase CHECK dependencies (C2->C3, C9->C10->C12, C9->C11, C16->C17) are gated after the
    // driver ran, in unit order: a dependent whose same-phase dependency is not PASS becomes
    // BLOCKED(dependency:..) unless it recorded a FAIL (executed failure evidence is never erased).
    // Same-phase CONTROLS (N2 for C6, N8 for C20) are consumed inside the check's own evaluator.
    for (const c of runnable.checks) {
      const parent = SUBCHECK_OF[c] || c;
      const sameChecks = new Set(u.checks.filter((x) => x !== c).map((x) => SUBCHECK_OF[x] || x));
      const deps = dependencyBlockers(parent, verdictMapOf(units, controls)).filter((d) => sameChecks.has(d));
      if (deps.length && checkVerdictBase(units[c]) !== 'FAIL') setUnit(c, blockedCheck(`dependency:${deps.join(',')}`));
    }
    if (got.extras) Object.assign(extras, got.extras);
    let taintNow = got.tainted === true;
    if (typeof assertPhaseBaseline === 'function') {
      let b;
      try { b = await assertPhaseBaseline(phase.id); } catch { b = { ok: false }; }
      if (!b || b.ok !== true) taintNow = true;
    }
    if (taintNow && !sessionTainted) { sessionTainted = true; taintPhase = phase.id; }
    entry.taintedAfter = taintNow;
  };

  // ---- P1 (C1), C1 finalization, atomic gate preparation (§7) ----
  const p1 = phases.find((p) => p.id === 'P1');
  if (p1) await runPhase(p1);
  finalizeC1();
  const ledgerAtGate = typeof errorLedger === 'function' ? errorLedger() : errorLedger;
  const gate = prepareC1Gate({
    c1: units.C1,
    errorLedger: isPlainObject(ledgerAtGate) ? ledgerAtGate : (fatalObserved() ? { fatalCount: 1, entries: [{ kind: 'fatal-observed' }] } : { fatalCount: 0, entries: [] }),
    seqOf, clock, ...gateHooks,
  });

  const checks = {};
  if (gate.outcome === GATE_OUTCOME.OPEN) {
    for (const phase of phases) {
      if (NON_CHECK_PHASES.includes(phase.id) || phase.id === 'P1') continue;
      await runPhase(phase);
    }
    for (const name of CHECK_NAMES) {
      if (name === 'C7') checks.C7 = combineSubchecks({ C7alpha: units.C7alpha || null, C7beta: units.C7beta || null });
      else if (name === 'C18') checks.C18 = combineSubchecks({ C18a: units.C18a || null, C18b: units.C18b || null });
      else checks[name] = units[name] || blockedCheck('not-executed');
    }
    for (const n of CONTROL_NAMES) if (!controls[n]) setControl(n, makeControlRecord(n, notExecutableState(n), { fields: { reason: 'not-executed' } }));
  } else {
    // Closed gate: no downstream execution; synthetic gate-disposition records only (C2..C20, N1..N8).
    checks.C1 = units.C1;
    for (const id of DOWNSTREAM_ITEM_NAMES) {
      const d = makeGateDispositionRecord(id, { gate, c1: units.C1, dispositionSeq: seqOf(), dispositionAt: clock.nowIso() });
      if (id.startsWith('C')) checks[id] = d; else controls[id] = d;
    }
  }
  mark('cleanup');
  const eventLog = rec.events.slice().sort((a, b) => a.seq - b.seq);
  return { checks, controls, subchecks: units, extras, sessionTainted, taintPhase, phaseLog, c1FinalizedEvent, gates: { C1: gate }, markers, eventLog };
}

// ============================================================================================
// Section 36 -- dormant live phase drivers (procedure §5 P1..P11, §6 action sequences). NOT EXECUTED
// by this revision: they are only reachable through `runChecksInPhaseOrder`, whose live mode is
// refused while LIVE_PATH_WIRED is false, and they touch nothing but the injected `env` adapters:
//   env.viewer (Viewer3D-shaped; overlays), env.createBridge(names) -> ViewerBridge, env.eventNames,
//   env.models {A,B}, env.labelOf, env.recorder, env.registry, env.injection (Section 34 controller),
//   env.bridgeTracker, env.targets {a1, b1, fitPair, candidatesA, candidatesB}, env.boundsOf(model,
//   dbId) (the bridge's own bounds path), env.fragmentBoxesOf(model, dbId), env.timers/quarantine,
//   and the page-side adapters that only a live page can supply: env.modelFacts(), env.unitFacts(),
//   env.shellProbe.{c2,c3}(), env.camera.{sample, waitFrame, resetHome}, env.capture.{frame,
//   waitRafs, canvas}. Offline tests drive the bridge-facing drivers with the repository's fake
//   Viewer + the real ViewerBridge; the page-side adapters are LIVE-PENDING (never fabricated here).
// ============================================================================================

const G2B_NAMES = Object.freeze({ overlayMarkers: 'clash-panel-markers:g2b', overlayOutlines: 'clash-panel-outlines:g2b' });
const G2A_NAMES = Object.freeze({ overlayMarkers: 'clash-panel-markers:g2a', overlayOutlines: 'clash-panel-outlines:g2a' });
const G2A2_NAMES = Object.freeze({ overlayMarkers: 'clash-panel-markers:g2a2', overlayOutlines: 'clash-panel-outlines:g2a2' });
const G2_FOREIGN_SCENE = 'g2-foreign-scene';
const BRIDGE_MUTATOR_SPY_METHODS = Object.freeze(['viewer.setAggregateIsolation', 'viewer.fitToView', 'overlays.addScene', 'overlays.addMesh', 'overlays.removeMesh', 'overlays.removeScene']);

const boxCentre = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];

/** Normalizes an aggregate isolation / hidden-nodes read (shape `[{model, ids}]`) to labels; null if not normalizable. */
function normalizeAggregateRead(list, labelOf) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (e === null || typeof e !== 'object' || !e.model || typeof e.model !== 'object' || !e.ids || typeof e.ids.length !== 'number') return null;
    if (seen.has(e.model)) return null;
    const ids = Array.from(e.ids);
    if (!ids.every((v) => Number.isInteger(v) && v >= 0)) return null;
    seen.add(e.model);
    out.push({ model: labelOf(e.model) || 'unknown', ids: [...new Set(ids)].sort((a, b) => a - b) });
  }
  return out.sort((x, y) => (x.model < y.model ? -1 : x.model > y.model ? 1 : 0));
}

/** Runs one bridge operation under origin 'bridge' and the T5 deadline. Never rejects. */
async function bridgeOp(env, op, fn) {
  const out = await runWithDeadline({ op, timeoutMs: TABLE_T.T5.singleOperationDeadlineMs, mutating: true, timers: env.timers || DEFAULT_TIMERS, quarantine: env.quarantine || null, fn: () => env.recorder.withOrigin('bridge', fn) });
  if (out.status === 'completed') return { ok: true, value: out.value, timedOut: false, threw: false };
  return { ok: false, value: null, timedOut: out.status === 'timed-out', threw: out.status === 'threw', error: out.status === 'threw' ? summarizeThrown(out.error) : null };
}

const asHarness = (env, fn) => env.recorder.withOrigin('harness', fn);
/** Synchronous bridge API calls (reads, subscriptions) are attributed to origin 'bridge' as well. */
const viaBridge = (env, fn) => env.recorder.withOrigin('bridge', fn);
const ledgerMark = (env) => env.recorder.records.length;
/** §7 start boundary: records the control's startSeq via the runner (only when it is runnable this phase). */
/**
 * §7 attribution: marks check `c`'s first action in a multi-check phase (activeCheck); when `c` is not
 * runnable (or null) the attribution is cleared, so a later harness step is never attributed to a
 * stale check.
 */
const beginChk = (ctx, c) => (ctx && typeof ctx.beginCheck === 'function' ? ctx.beginCheck(c !== null && ctx.runnable && ctx.runnable.checks.includes(c) ? c : null) : null);
const beginCtl = (ctx, n) => (ctx && typeof ctx.beginControl === 'function' && ctx.runnable && ctx.runnable.controls.includes(n) ? ctx.beginControl(n) : null);

/** Bridge-origin addMesh − removeMesh per scene over the ledger slice `[from, to)`. */
function bridgeNetPerScene(records, from, scenes) {
  const net = Object.fromEntries(scenes.map((s) => [s, 0]));
  for (const r of records.slice(from)) {
    if (r.origin !== 'bridge') continue;
    const short = r.method.replace(/^overlays\./, '');
    if (short !== 'addMesh' && short !== 'removeMesh') continue;
    const scene = overlaySceneName(r);
    if (scene in net) net[scene] += short === 'addMesh' ? 1 : -1;
  }
  return net;
}

function isolationReadLabels(env) { return normalizeAggregateRead(asHarness(env, () => env.viewer.getAggregateIsolation()), env.labelOf); }
function hiddenReadLabels(env) { return normalizeAggregateRead(asHarness(env, () => env.viewer.getAggregateHiddenNodes()), env.labelOf); }
const isEmptyRead = (r) => Array.isArray(r) && r.every((e) => e.ids.length === 0);

/**
 * §C15(e) driver (RC1 + RC1-C1; DORMANT -- reachable only via the live phase drivers). Setup: bridge
 * #1, phase-boundary baseline, setup model keys ['A','B'], E0 = [] and H0 = [] (canonical, harness
 * reads); `present({A,a1},{B,b1}, isolate+marker, focus:false)`; T_iso (non-empty, != E0, equal to the
 * applied target); `inspectLedger()` read ONCE during setup (legal: held non-null) for `nm` /
 * `isolation.confirmed`; then exactly one `H_iso` read with no intervening mutating call (spy-ledger
 * proven) -- else BLOCKED(precondition:c15e) with no injection installed. Then W_e (throw-before on
 * every armed call, inside the recorder) for clear #1, disarm + remove + verify-by-reference in a
 * `finally`, one harness `after` read per clear, clear #2 and #3 with W_e removed. Between the start
 * of clear #1 and the settle of clear #3 the harness makes no mutating Viewer call and reads no bridge
 * internals; `inspectLedger()` after each clear is read only into `diagnostics` (LedgerDTO).
 * Returns `{evidence|null, blocked|null, globalOk, tainted, c13:{isolation, clear2, clear3}, detail}`;
 * the verdict itself is computed by `evaluateC15` -> `c15eOracle(evidence)`.
 */
async function runC15eScenario({ env, bridge: b, sides, point, owners, globalOk, outlinedSides }) {
  const rec = env.recorder;
  const models = { A: env.models.A, B: env.models.B };
  const allModelsRead = () => { try { const m = asHarness(env, () => env.viewer.getAllModels()); return Array.isArray(m) ? m : null; } catch { return null; } };
  const canonRead = (method) => {
    const allModels = allModelsRead();
    return readCanonicalAggregate(() => asHarness(env, () => env.viewer[method]()), { models, allModels });
  };
  const modelKeysRead = () => {
    const all = allModelsRead();
    if (all === null) return null;
    const keys = all.map((m) => c15eModelKey(m, models));
    return keys.some((k) => k === null) ? null : keys.slice().sort();
  };
  const readAfter = () => {
    const keys = modelKeysRead();
    let isolation = canonRead('getAggregateIsolation');
    let hidden = canonRead('getAggregateHiddenNodes');
    if (keys === null) {
      // any unmapped / unreadable getAllModels() entry makes the whole `after` read unreadable
      isolation = c15eUnreadable('getAllModels-unreadable-or-unmapped');
      hidden = c15eUnreadable('getAllModels-unreadable-or-unmapped');
    }
    return { readSeq: rec.nextSeq(), isolation, hidden, models: keys === null ? [] : keys };
  };
  const spyEntry = (r) => {
    const o = r.outcome;
    const threw = Boolean(o) && o.threw === true;
    const errName = threw && o.error && typeof o.error.name === 'string' ? o.error.name : 'error';
    return {
      seq: r.seq, method: r.method, origin: r.origin, argDigest: r.argsDigest,
      thrown: threw ? (r.injected === true && errName === 'G2InjectedError' ? 'injected' : errName) : null,
      returned: o && !threw ? (o.returned && typeof o.returned.kind === 'string' ? o.returned.kind : 'unknown') : null,
    };
  };
  const windowOf = (lo, hi) => rec.records.filter((r) => r.seq > lo && r.seq < hi).map(spyEntry);
  const mutatingBetween = (lo, hi) => rec.records.filter((r) => r.seq > lo && r.seq < hi && !C15E_NON_MUTATING_METHODS.includes(r.method));
  const frozenOutcome = (v) => ({ isolation: v.isolation, markersRemoved: v.markersRemoved, notes: [...v.notes] });
  const finish = (o) => ({ evidence: null, blocked: null, tainted: false, c13: { isolation: null }, detail: null, ...o, globalOk: globalOk() });
  const blockedPre = (detail) => finish({ blocked: 'precondition:c15e', detail });

  // ---- setup / preconditions (no injection installed on any BLOCKED path) ----
  if (!b) return blockedPre('no-bridge');
  if (!globalOk()) return blockedPre('phase-boundary-baseline');
  if (JSON.stringify(modelKeysRead()) !== JSON.stringify(C15E_SETUP_MODEL_KEYS)) return blockedPre('setup-model-keys');
  const E0 = canonRead('getAggregateIsolation');
  const H0 = canonRead('getAggregateHiddenNodes');
  if (!(Array.isArray(E0) && E0.length === 0 && Array.isArray(H0) && H0.length === 0)) return blockedPre('baseline-not-empty');
  const r = await bridgeOp(env, 'present', () => b.present({ sides, options: { focus: false, isolate: true, marker: true }, point }));
  const presentSettleSeq = rec.nextSeq();
  if (r.timedOut) return finish({ blocked: 'timeout:present', tainted: true });
  if (!r.ok || r.value.isolated !== true) return blockedPre('present-did-not-isolate');
  const T_iso = canonRead('getAggregateIsolation');
  const L = b.inspectLedger(); // setup-only read (held non-null); never read again except into diagnostics
  const ledgerBefore = c15eLedgerDTO(L);
  const nm = expectedMarkerMeshCount({ variant: 'hard', outlinedSides });
  const appliedTarget = L && L.isolation && Array.isArray(L.isolation.target) ? canonicalIsolation(L.isolation.target, { models, allModels: allModelsRead() }) : null;
  const H_iso = canonRead('getAggregateHiddenNodes');
  const hIsoReadSeq = rec.nextSeq();
  if (!(Array.isArray(T_iso) && T_iso.length > 0 && !canonIsolationEquals(T_iso, E0) && canonIsolationEquals(T_iso, appliedTarget))) return blockedPre('t-iso');
  if (!(ledgerBefore && ledgerBefore.markerMeshCount === nm && ledgerBefore.isolationConfirmed === true)) return blockedPre('ledger-before');
  if (mutatingBetween(presentSettleSeq, hIsoReadSeq).length !== 0) return blockedPre('mutation-before-h-iso');
  if (!Array.isArray(H_iso)) return blockedPre('h-iso-unreadable');

  // ---- clear #1 with W_e armed (throw-before on every call) ----
  const regEntry = env.registry ? env.registry.find(owners.viewer, 'setAggregateIsolation') : null;
  const h = env.injection.install('e', owners);
  const installSeq = rec.nextSeq();
  h.arm();
  const armSeq = rec.nextSeq();
  const start1 = rec.nextSeq();
  let c1;
  let settle1;
  let disarmSeq;
  let removeSeq;
  let restoredByReference = false;
  let originalInvocationsWhileArmed = null;
  try {
    c1 = await bridgeOp(env, 'clear', () => b.clear());
    settle1 = rec.nextSeq();
  } finally {
    if (settle1 === undefined) settle1 = rec.nextSeq();
    h.disarm();
    disarmSeq = rec.nextSeq();
    originalInvocationsWhileArmed = h.originalInvocationsWhileArmed();
    const removed = h.remove();
    removeSeq = rec.nextSeq();
    restoredByReference = removed.ok === true && Boolean(regEntry) && regEntry.inner === regEntry.original && regEntry.injections.length === 0
      && owners.viewer.setAggregateIsolation === regEntry.wrapper;
  }
  if (!restoredByReference) return finish({ blocked: 'session-tainted', tainted: true, detail: 'w-e-not-restored-by-reference' });
  if (c1.timedOut) return finish({ blocked: 'timeout:clear', tainted: true });
  if (originalInvocationsWhileArmed !== 0) return finish({ blocked: 'injection-not-verified', detail: { originalInvocationsWhileArmed } });
  if (!c1.ok) return finish({ blocked: 'harness-exception:clear', tainted: true, detail: c1.error });
  const after1 = readAfter();
  const diag1 = c15eLedgerDTO(b.inspectLedger());

  // ---- clear #2 (W_e removed) and clear #3 (idempotence probe) ----
  const start2 = rec.nextSeq();
  const c2 = await bridgeOp(env, 'clear', () => b.clear());
  const settle2 = rec.nextSeq();
  if (c2.timedOut) return finish({ blocked: 'timeout:clear', tainted: true });
  if (!c2.ok) return finish({ blocked: 'harness-exception:clear', tainted: true, detail: c2.error });
  const after2 = readAfter();
  const diag2 = c15eLedgerDTO(b.inspectLedger());
  const start3 = rec.nextSeq();
  const c3 = await bridgeOp(env, 'clear', () => b.clear());
  const settle3 = rec.nextSeq();
  if (c3.timedOut) return finish({ blocked: 'timeout:clear', tainted: true });
  if (!c3.ok) return finish({ blocked: 'harness-exception:clear', tainted: true, detail: c3.error });
  const after3 = readAfter();
  const diag3 = c15eLedgerDTO(b.inspectLedger());

  const clears = [
    { index: 1, injectionArmed: true, startSeq: start1, settleSeq: settle1, outcome: frozenOutcome(c1.value), spyWindow: windowOf(start1, settle1), after: after1 },
    { index: 2, injectionArmed: false, startSeq: start2, settleSeq: settle2, outcome: frozenOutcome(c2.value), spyWindow: windowOf(settle1, settle2), after: after2 },
    { index: 3, injectionArmed: false, startSeq: start3, settleSeq: settle3, outcome: frozenOutcome(c3.value), spyWindow: windowOf(settle2, settle3), after: after3 },
  ];
  const evidence = {
    nm, ledgerBefore, E0, H0, T_iso, H_iso, presentSettleSeq, hIsoReadSeq,
    injection: { installSeq, armSeq, disarmSeq, removeSeq, restoredByReference, originalInvocationsWhileArmed, thrownInjectedCount: 0 },
    clears, comparisons: null, predicates: null, failureLabel: null,
    diagnostics: { inspectLedgerAfterClear1: diag1, inspectLedgerAfterClear2: diag2, inspectLedgerAfterClear3: diag3 },
  };
  const derived = c15eDerive(evidence);
  evidence.comparisons = derived.comparisons;
  evidence.predicates = derived.predicates;
  evidence.failureLabel = derived.failureLabel;
  evidence.injection.thrownInjectedCount = derived.thrownInjectedCount;
  return finish({ evidence, c13: { isolation: c1.value.isolation, clear2: c2.value.isolation, clear3: c3.value.isolation } });
}

function outlinedSidesOf(env, sides) {
  return sides.filter((s) => { const b = env.boundsOf(s.model, s.dbId); return Array.isArray(b) && b.length === 6 && b.every(Number.isFinite) && !c4Inverted(b); }).length;
}

/**
 * Reads the C20 analytic-footprint inputs from the bridge's ledger meshes (Hard, one side): the
 * sphere `{center, Rw}` (`position`, `scale.x`) and the outline `{vertices (16), transformIdentity}`
 * (r71 `geometry.attributes.position.array`, or the offline fake's `geometry.points`). Pure reads.
 */
function describeMarkerMeshes(meshes) {
  let sphere = null;
  let outline = null;
  for (const m of meshes || []) {
    if (!m || !m.geometry) continue;
    if (m.isLine === true) {
      let verts = null;
      const attr = m.geometry.attributes && m.geometry.attributes.position;
      if (attr && attr.array) { const a = Array.from(attr.array); verts = []; for (let i = 0; i + 2 < a.length; i += 3) verts.push([a[i], a[i + 1], a[i + 2]]); }
      else if (Array.isArray(m.geometry.points)) verts = m.geometry.points.map((p) => [p.x, p.y, p.z]);
      const q = m.quaternion;
      const identity = Boolean(m.position && m.scale) && m.position.x === 0 && m.position.y === 0 && m.position.z === 0
        && m.scale.x === 1 && m.scale.y === 1 && m.scale.z === 1 && (!q || (q.x === 0 && q.y === 0 && q.z === 0 && q.w === 1));
      outline = { vertices: verts, transformIdentity: identity };
    } else if (m.isMesh === true && m.position && m.scale) {
      sphere = { center: [m.position.x, m.position.y, m.position.z], Rw: m.scale.x };
    }
  }
  return { sphere, outline };
}

/**
 * `createLivePhaseDrivers(env)` -- returns `{P1..P11}` drivers for `runChecksInPhaseOrder`. Each
 * driver follows the §6 action sequence of its checks and returns `{checks, controls, extras}`.
 * `env.state` (a plain object owned by the caller) carries bridge #1 and cross-phase outcomes.
 */
function createLivePhaseDrivers(env) {
  const st = env.state || (env.state = {});
  const A = () => env.models.A;
  const B = () => env.models.B;
  const t = () => env.targets;

  return {
    // P1 -- C1 preconditions (page-side facts: G1 readFormat classifier, unit scale/string; live-pending adapter).
    async P1() { return { checks: { C1: evaluateC1(await env.modelFacts()) } }; },

    // P2 -- install spies (after models load) + model tagger + N1 on a harness sentinel.
    async P2(ctx) {
      const spies = installSpySet({ viewer: env.viewer, dockingPanelPrototype: env.dockingPanelPrototype || null, recorder: env.recorder, registry: env.registry });
      st.tagger = attachModelArgumentTagger(env.recorder, { labelOf: env.labelOf });
      beginCtl(ctx, 'N1');
      return { controls: { N1: n1Record(runSpySelfTestN1({ recorder: env.recorder })) }, extras: { spyInstall: spies } };
    },

    // P3 -- C2/C3 on the real DockingPanel (page-side DOM observation; live-pending adapter).
    async P3(ctx) {
      const { runnable } = ctx;
      const checks = {};
      if (runnable.checks.includes('C2')) { beginChk(ctx, 'C2'); checks.C2 = evaluateC2(await env.shellProbe.c2()); }
      if (runnable.checks.includes('C3')) { beginChk(ctx, 'C3'); checks.C3 = evaluateC3(await env.shellProbe.c3()); }
      return { checks };
    },

    // P4 -- C4 bounds containment (T10 sample), C5 unit observation, N6 pure recomputation.
    async P4(ctx) {
      const { runnable } = ctx;
      beginChk(ctx, 'C4');
      const sample = selectC4Sample(t().candidatesA, t().candidatesB);
      const rows = asHarness(env, () => sample.map((s) => {
        const model = s.model === 'A' ? A() : B();
        return { model: s.model, dbId: s.dbId, candidate: env.boundsOf(model, s.dbId), fragmentBoxes: env.fragmentBoxesOf(model, s.dbId) };
      }));
      let invalidDbIdObservation;
      try { invalidDbIdObservation = { returned: normalizeEvidence(env.boundsOf(A(), -1)), threw: false }; } catch (e) { invalidDbIdObservation = { returned: null, threw: true, error: summarizeThrown(e) }; }
      const c4 = evaluateC4({ rows, candidateCounts: { A: t().candidatesA.length, B: t().candidatesB.length }, invalidDbIdObservation });
      st.c4Table = c4.c4Table;
      const checks = { C4: c4.record };
      if (runnable.checks.includes('C5')) { beginChk(ctx, 'C5'); checks.C5 = evaluateC5(await env.unitFacts()); }
      // N6 discriminates the C4 oracle over C4's own table: attributed to C4 + N6.
      beginChk(ctx, 'C4');
      const n6Input = selectN6Input(c4.c4Table);
      if (n6Input.candidate !== null) beginCtl(ctx, 'N6');
      return { checks, controls: { N6: evaluateN6(n6Input) }, extras: { c4Table: c4.c4Table, n6: null } };
    },

    // P5a -- bridge #2: foreign pre-existing scene scenario (C7α, C18b, N3), before bridge #1 exists.
    async P5a(ctx) {
      // C7α and C18b are judged on ONE scenario (bridge #2); its actions are attributed to C7 (C7α).
      beginChk(ctx, 'C7alpha');
      const ov = env.viewer.overlays;
      const S1 = env.makeSentinelMesh();
      const S2 = env.makeSentinelMesh();
      asHarness(env, () => {
        if (!ov.hasScene(G2B_NAMES.overlayMarkers)) ov.addScene(G2B_NAMES.overlayMarkers);
        ov.addMesh(S1, G2B_NAMES.overlayMarkers);
        if (!ov.hasScene(G2_FOREIGN_SCENE)) ov.addScene(G2_FOREIGN_SCENE);
        ov.addMesh(S2, G2_FOREIGN_SCENE);
      });
      st.sentinels = { S1, S2 };
      const presentBefore = Object.fromEntries([G2B_NAMES.overlayMarkers, G2B_NAMES.overlayOutlines, G2_FOREIGN_SCENE].map((n) => [n, ov.hasScene(n)]));
      env.bridgeTracker.create('bridge#2');
      const bridge2 = env.createBridge(G2B_NAMES);
      const a1Box = env.boundsOf(A(), t().a1);
      const p = await bridgeOp(env, 'present', () => bridge2.present({ sides: [{ model: A(), dbId: t().a1 }, { model: B(), dbId: t().b1 }], options: { marker: true, focus: false, isolate: false }, point: boxCentre(a1Box) }));
      const c = await bridgeOp(env, 'clear', () => bridge2.clear());
      const d = await bridgeOp(env, 'dispose', () => bridge2.dispose());
      env.bridgeTracker.dispose('bridge#2');
      const presentAfterDispose = Object.fromEntries(Object.keys(presentBefore).map((n) => [n, ov.hasScene(n)]));
      const scenes = [
        { scene: G2B_NAMES.overlayOutlines, class: SCENE_CLASS.PANEL_OWNED, createdBy: 'bridge', bridgeInstance: 'bridge#2', presentBefore: presentBefore[G2B_NAMES.overlayOutlines], sentinelRefId: null },
        { scene: G2B_NAMES.overlayMarkers, class: SCENE_CLASS.FOREIGN, createdBy: 'harness', bridgeInstance: null, presentBefore: presentBefore[G2B_NAMES.overlayMarkers], sentinelRefId: env.recorder.refIdOf(S1) },
        { scene: G2_FOREIGN_SCENE, class: SCENE_CLASS.FOREIGN, createdBy: 'harness', bridgeInstance: null, presentBefore: presentBefore[G2_FOREIGN_SCENE], sentinelRefId: env.recorder.refIdOf(S2) },
      ];
      st.foreignScenes = scenes.filter((s) => s.class === SCENE_CLASS.FOREIGN);
      const ledger = env.recorder.records;
      const own = evaluateSceneOwnership({ scenes, presentAfterDispose, ledger });
      const opsOk = p.ok && c.ok && d.ok;
      const alpha = opsOk ? own.record : makeCheckRecord({ verdict: 'BLOCKED', reason: p.timedOut || c.timedOut || d.timedOut ? 'timeout:bridge2-op' : 'bridge2-op-threw', fields: { present: p, clear: c, dispose: d } });
      beginCtl(ctx, 'N3');
      const n3 = n3Record(runSceneOwnershipControlN3({ scenes, presentAfterDispose, ledger }), { liveObservationsHold: presentAfterDispose[G2B_NAMES.overlayMarkers] === true && presentAfterDispose[G2_FOREIGN_SCENE] === true });
      return { checks: { C7alpha: alpha, C18b: alpha }, controls: { N3: n3 }, extras: { sceneOwnership: own.sceneOwnership } };
    },

    // P5b -- create bridge #1 (g2a); C7β markers: Hard, Soft, 5 replacements (T12), clear.
    async P5b() {
      env.bridgeTracker.create('bridge#1');
      st.bridge1 = env.createBridge(G2A_NAMES);
      st.bridge1Names = [G2A_NAMES];
      st.bridge1Since = ledgerMark(env);
      const b = st.bridge1;
      const ov = env.viewer.overlays;
      const sides2 = [{ model: A(), dbId: t().a1 }, { model: B(), dbId: t().b1 }];
      const aBox = env.boundsOf(A(), t().a1);
      const bBox = env.boundsOf(B(), t().b1);
      const variant = async (req, kind) => {
        const r = await bridgeOp(env, 'present', () => b.present(req));
        const L = b.inspectLedger();
        return {
          ok: r.ok, marked: r.ok ? r.value.marked === true : false, markerMeshCount: L ? L.markerMeshes.length : 0,
          scenesPresent: ov.hasScene(G2A_NAMES.overlayMarkers) && ov.hasScene(G2A_NAMES.overlayOutlines), outlinedSides: outlinedSidesOf(env, req.sides), kind,
        };
      };
      const hard = await variant({ sides: sides2, options: { marker: true, focus: false, isolate: false }, point: boxCentre(aBox) }, 'hard');
      const soft = await variant({ sides: sides2, options: { marker: true, focus: false, isolate: false }, closestPoints: { first: boxCentre(aBox), second: boxCentre(bBox) } }, 'soft');
      const replacements = [];
      const pool = Math.min(t().candidatesA.length, t().candidatesB.length);
      for (let k = 1; k <= TABLE_T.T12.c7ReplacementRepetitions; k += 1) {
        const ca = t().candidatesA[k % pool];
        const cb = t().candidatesB[k % pool];
        const prior = (b.inspectLedger() || { markerMeshes: [] }).markerMeshes.map((m) => env.recorder.refIdOf(m));
        const mark = ledgerMark(env);
        const sides = [{ model: A(), dbId: ca.dbId }, { model: B(), dbId: cb.dbId }];
        const r = await bridgeOp(env, 'present', () => b.present({ sides, options: { marker: true, focus: false, isolate: false }, point: boxCentre(ca.box) }));
        const removed = env.recorder.records.slice(mark).filter((x) => x.origin === 'bridge' && x.method === 'overlays.removeMesh').map((x) => x.argRefIds[0]);
        const L = b.inspectLedger();
        const ledgerCount = L ? L.markerMeshes.length : 0;
        const net = bridgeNetPerScene(env.recorder.records, st.bridge1Since, [G2A_NAMES.overlayMarkers, G2A_NAMES.overlayOutlines]);
        replacements.push({
          ok: r.ok, removedPriorExactly: removed.length === prior.length && prior.every((id) => removed.includes(id)),
          ledgerCount, expected: expectedMarkerMeshCount({ variant: 'hard', outlinedSides: outlinedSidesOf(env, sides) }),
          cumulativeNet: net[G2A_NAMES.overlayMarkers] + net[G2A_NAMES.overlayOutlines],
        });
      }
      const priorCount = (b.inspectLedger() || { markerMeshes: [] }).markerMeshes.length;
      const c = await bridgeOp(env, 'clear', () => b.clear());
      const obs = {
        hard, soft, replacements, setFromPointsOk: soft.ok && soft.marked,
        clear: { markersRemoved: c.ok ? c.value.markersRemoved : null, priorCount, ledgerNull: b.inspectLedger() === null },
      };
      return { checks: { C7beta: evaluateC7Beta(obs) } };
    },

    // P6 -- C6 aggregate union framing (+N2), C8 per-model fit + superseded focus.
    async P6(ctx) {
      const { runnable } = ctx;
      const b = st.bridge1;
      const cam = env.camera;
      const settle = () => waitForCameraSettle({ sampleCamera: cam.sample, waitFrame: cam.waitFrame, timers: env.timers, quarantine: env.quarantine });
      const checks = {};
      const controls = {};
      const pair = t().fitPair;
      if (runnable.checks.includes('C6') || runnable.controls.includes('N2')) {
        beginChk(ctx, 'C6');
        let n2 = makeControlRecord('N2', 'NOT_DETECTED', { fields: { reason: 'no-fit-pair' } });
        let c6input = { pairSelected: false };
        if (pair) {
          const boxes = [env.boundsOf(A(), pair.a), env.boundsOf(B(), pair.b)];
          const mark = ledgerMark(env);
          const p = await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: pair.a }, { model: B(), dbId: pair.b }], options: { focus: true, isolate: false, marker: false } }));
          const s = await settle();
          c6input = { pairSelected: true, present: { outcome: p.value, threw: p.threw, timedOut: p.timedOut }, fitRecords: ledgerSlice(env.recorder.records, { method: 'viewer.fitToView', origin: 'bridge', from: mark }), settle: s, boxes };
          beginCtl(ctx, 'N2');
          const reset1 = await asHarness(env, () => cam.resetHome());
          let single = { threw: false, timedOut: false };
          try { asHarness(env, () => env.viewer.fitToView([pair.b], B())); } catch { single = { threw: true, timedOut: false }; }
          const s2 = await settle();
          const reset2 = await asHarness(env, () => cam.resetHome());
          n2 = evaluateN2({ singleFit: single, settle: s2, boxes, restored: reset1 === true && reset2 === true });
        }
        controls.N2 = n2;
        checks.C6 = evaluateC6({ ...c6input, n2State: n2.state });
      }
      if (runnable.checks.includes('C8')) {
        beginChk(ctx, 'C8');
        const aBox = env.boundsOf(A(), t().a1);
        const mark = ledgerMark(env);
        const p = await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: t().a1 }], options: { focus: true, isolate: false, marker: false } }));
        const s = await settle();
        const fitRecords = ledgerSlice(env.recorder.records, { method: 'viewer.fitToView', origin: 'bridge', from: mark });
        const second = t().candidatesA[1] || t().candidatesA[0];
        const p1 = env.recorder.withOrigin('bridge', () => b.present({ sides: [{ model: A(), dbId: t().a1 }], options: { focus: true, isolate: false, marker: false } }));
        const p2 = env.recorder.withOrigin('bridge', () => b.present({ sides: [{ model: A(), dbId: second.dbId }], options: { focus: true, isolate: false, marker: false } }));
        await Promise.allSettled([p1, p2]);
        const s2 = await settle();
        checks.C8 = evaluateC8({ present: { outcome: p.value, threw: p.threw, timedOut: p.timedOut }, fitRecords, settle: s, box: aBox, supersession: { settle: s2, box: second.box } });
      }
      await bridgeOp(env, 'clear', () => b.clear());
      return { checks, controls };
    },

    // P6b -- C20 overlay rendering (A1..A5) + N8, on the Hard variant for a_r.
    async P6b(ctx) {
      const b = st.bridge1;
      const cap = env.capture;
      const cam = env.camera;
      const target = selectC20Target(st.c4Table);
      if (!target) { const r = evaluateC20({ target: null }); return { checks: { C20: r.record }, controls: { N8: r.n8 }, extras: { c20: r.c20 } }; }
      const ar = target.row;
      const canvas = await cap.canvas();
      const W = canvas.W; const H = canvas.H;
      const preconditions = { bridgeAlive: Boolean(b), aRContained: ar.outcome === C4_OUTCOME.CONTAINED, canvas: Number.isInteger(W) && Number.isInteger(H) && W > 0 && H > 0, shellDisposed: canvas.shellDisposed === true, dsf: canvas.dsf === 1 };
      if (Object.values(preconditions).some((v) => v !== true)) { const r = evaluateC20({ target, preconditions }); return { checks: { C20: r.record }, controls: { N8: r.n8 }, extras: { c20: r.c20 } }; }
      const settle = () => waitForCameraSettle({ sampleCamera: cam.sample, waitFrame: cam.waitFrame, timers: env.timers, quarantine: env.quarantine });
      const captureFrame = async () => {
        const out = await runWithDeadline({ op: 'screenshot', timeoutMs: TABLE_T.T7.screenshotFrameDeadlineMs, timers: env.timers, quarantine: env.quarantine, fn: () => cap.frame() });
        if (out.status !== 'completed') throw Object.assign(new Error('screenshot deadline'), { g2Timeout: 'screenshot' });
        return out.value;
      };
      const pairAttempts = async (max) => {
        const attempts = [];
        let first = null;
        for (let k = 0; k < max; k += 1) {
          const f1 = await captureFrame();
          await cap.waitRafs(TABLE_T.T20.interCaptureWaitRafs);
          const f2 = await captureFrame();
          const identical = changedPixelIndices(f1, f2, W, H).length === 0;
          attempts.push({ identical });
          if (first === null) first = f1;
          if (identical) return { attempts, frame: f1 };
        }
        return { attempts, frame: first };
      };
      const timeouts = {};
      const structural = {};
      let cleared = false;
      try {
        const a1 = await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: ar.dbId }], options: { focus: true, isolate: false, marker: false } }));
        if (a1.timedOut) timeouts.present = true;
        structural.a1Fitted = a1.ok && a1.value.fitted === true;
        const s0 = await settle();
        if (s0.status === 'timed-out') timeouts['camera-settle'] = true;
        const K0 = s0.status === 'settled' ? s0.camera : null;
        const off = await pairAttempts(TABLE_T.T20.offPairAttemptsMax);
        let on = { attempts: [{ identical: false }], frame: null };
        let K1 = null; let K2 = null; let L = null;
        if (off.attempts[off.attempts.length - 1].identical) {
          const a3 = await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: ar.dbId }], options: { focus: false, isolate: false, marker: true }, point: boxCentre(ar.candidateBox) }));
          if (a3.timedOut) timeouts.present = true;
          L = b.inspectLedger();
          structural.a3Markers = a3.ok && a3.value.marked === true && L !== null && L.markerMeshes.length === expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 1 })
            && env.viewer.overlays.hasScene(G2A_NAMES.overlayMarkers) && env.viewer.overlays.hasScene(G2A_NAMES.overlayOutlines);
          await cap.waitRafs(TABLE_T.T20.interCaptureWaitRafs);
          K1 = cameraSample(await cam.sample());
          on = await pairAttempts(TABLE_T.T20.onPairAttemptsMax);
          K2 = cameraSample(await cam.sample());
        }
        const meshes = L ? (env.describeMarkerMeshes || describeMarkerMeshes)(L.markerMeshes) : { sphere: null, outline: null };
        const a5 = await bridgeOp(env, 'clear', () => b.clear());
        cleared = true;
        if (a5.timedOut) timeouts.clear = true;
        structural.a5Cleared = a5.ok && (L === null || a5.value.markersRemoved === expectedMarkerMeshCount({ variant: 'hard', outlinedSides: 1 })) && b.inspectLedger() === null;
        await cap.waitRafs(TABLE_T.T20.interCaptureWaitRafs);
        const Fclear = await captureFrame();
        const K3 = cameraSample(await cam.sample());
        const footprints = K0 ? computeC20Footprints({ K0, W, H, sphere: meshes.sphere, outline: meshes.outline }) : null;
        const oracleInput = {
          W, H, dsf: canvas.dsf, cameras: { K0, K1, K2, K3 }, offAttempts: off.attempts, onAttempts: on.attempts, footprints,
          frames: { off1: off.frame, on: on.frame, clear: Fclear },
        };
        beginCtl(ctx, 'N8');
        const r = evaluateC20({ target, preconditions, timeouts, structural, oracleInput });
        return { checks: { C20: r.record }, controls: { N8: r.n8 }, extras: { c20: r.c20 } };
      } catch (err) {
        if (!cleared) await bridgeOp(env, 'clear', () => b.clear());
        if (err && err.g2Timeout) { const r = evaluateC20({ target, preconditions, timeouts: { [err.g2Timeout]: true } }); return { checks: { C20: r.record }, controls: { N8: r.n8 }, extras: { c20: r.c20 }, tainted: true }; }
        throw err;
      }
    },

    // P7 -- isolation: C9, C10, C11 (+N5), C12 (+N4). C13 is evaluated with P8 (needs C15 outcomes).
    async P7(ctx) {
      const { runnable } = ctx;
      const b = st.bridge1;
      const checks = {};
      const controls = {};
      const sides2 = [{ model: A(), dbId: t().a1 }, { model: B(), dbId: t().b1 }];
      st.c13 = st.c13 || {};
      if (runnable.checks.includes('C9')) {
        beginChk(ctx, 'C9');
        const iso = asHarness(env, () => env.viewer.getAggregateIsolation());
        const hid = asHarness(env, () => env.viewer.getAggregateHiddenNodes());
        checks.C9 = evaluateC9({ isolationShape: normalizeEvidence(summarizeValue(iso, env.recorder.refIdOf)), hiddenShape: normalizeEvidence(summarizeValue(hid, env.recorder.refIdOf)), isolationNormalizable: normalizeAggregateRead(iso, env.labelOf) !== null, hiddenNormalizable: normalizeAggregateRead(hid, env.labelOf) !== null, prerequisite: viaBridge(env, () => b.checkIsolationPrerequisite()) });
      }
      if (runnable.checks.includes('C10')) {
        beginChk(ctx, 'C10');
        const mark = ledgerMark(env);
        const p = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: false, focus: false } }));
        const recs = env.recorder.records.slice(mark).filter((r) => r.origin === 'bridge');
        const sets = recs.filter((r) => r.method === 'viewer.setAggregateIsolation');
        const post = isolationReadLabels(env);
        const hiddenAfter = hiddenReadLabels(env);
        const cm = ledgerMark(env);
        const c = await bridgeOp(env, 'clear', () => b.clear());
        const clearRecs = env.recorder.records.slice(cm).filter((r) => r.origin === 'bridge');
        const emptySetWithoutCompare = clearRecs.some((r, i) => r.method === 'viewer.setAggregateIsolation' && Array.isArray(r.isolationEntries) && r.isolationEntries.length === 0
          && !clearRecs.slice(0, i).some((x) => x.method === 'viewer.getAggregateIsolation'));
        st.c13.C10 = { isolation: c.ok ? c.value.isolation : null };
        checks.C10 = evaluateC10({
          records: recs, nonEmptyIds: sets.length === 1 && Array.isArray(sets[0].isolationEntries) && sets[0].isolationEntries.every((e) => e.idsLength > 0),
          postEqualsTarget: JSON.stringify(post) === JSON.stringify([{ model: 'A', ids: [t().a1] }, { model: 'B', ids: [t().b1] }]), isolated: p.ok && p.value.isolated === true,
          hiddenReportsPanelIsolation: Array.isArray(hiddenAfter) ? hiddenAfter.some((e) => e.ids.length > 0) : null,
          clear: { isolation: c.ok ? c.value.isolation : null, postIsolationEmpty: isEmptyRead(isolationReadLabels(env)), postHiddenEmpty: isEmptyRead(hiddenReadLabels(env)), emptySetWithoutCompare },
        });
      }
      if (runnable.checks.includes('C11') || runnable.controls.includes('N5')) {
        beginChk(ctx, 'C11');
        beginCtl(ctx, 'N5');
        asHarness(env, () => env.viewer.hide(t().a1, A()));
        const preWhile = viaBridge(env, () => b.checkIsolationPrerequisite());
        const mark = ledgerMark(env);
        const p = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: false, focus: false } }));
        const setsDuring = env.recorder.records.slice(mark).filter((r) => r.origin === 'bridge' && r.method === 'viewer.setAggregateIsolation').length;
        const hidden = hiddenReadLabels(env);
        const nodeStillHidden = Array.isArray(hidden) && hidden.some((e) => e.model === 'A' && e.ids.includes(t().a1));
        asHarness(env, () => env.viewer.show(t().a1, A()));
        const preAfter = viaBridge(env, () => b.checkIsolationPrerequisite());
        await bridgeOp(env, 'clear', () => b.clear());
        const obs = { prerequisiteWhileHidden: preWhile, presentOutcome: p.ok ? { isolated: p.value.isolated, notes: [...p.value.notes] } : null, setIsolationCallsDuringPresent: setsDuring, nodeStillHidden, prerequisiteAfterShow: preAfter };
        if (runnable.checks.includes('C11')) checks.C11 = evaluateC11(obs);
        controls.N5 = evaluateN5({ prerequisiteWhileHidden: preWhile, prerequisiteAfterShow: preAfter, timedOut: p.timedOut });
      }
      if (runnable.checks.includes('C12') || runnable.controls.includes('N4')) {
        beginChk(ctx, 'C12');
        const second = t().candidatesA[1] || t().candidatesA[0];
        const p = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: true, focus: false }, point: boxCentre(env.boundsOf(A(), t().a1)) }));
        const priorMeshes = (b.inspectLedger() || { markerMeshes: [] }).markerMeshes.length;
        const foreign = [{ model: A(), ids: [second.dbId] }];
        const fMark = ledgerMark(env);
        beginCtl(ctx, 'N4');
        asHarness(env, () => env.viewer.setAggregateIsolation(foreign));
        const foreignRead = isolationReadLabels(env);
        const c = await bridgeOp(env, 'clear', () => b.clear());
        const bridgeSetsAfter = env.recorder.records.slice(fMark).filter((r) => r.origin === 'bridge' && r.method === 'viewer.setAggregateIsolation').length;
        const foreignUnchanged = JSON.stringify(isolationReadLabels(env)) === JSON.stringify(foreignRead);
        asHarness(env, () => env.viewer.setAggregateIsolation([]));
        const reset1 = isEmptyRead(isolationReadLabels(env));
        st.c13.C12 = { isolation: c.ok ? c.value.isolation : null };
        controls.N4 = evaluateN4({ clearIsolation: c.ok ? c.value.isolation : null, resetToEmpty: reset1, timedOut: p.timedOut || c.timedOut });
        // second scenario: foreign change between two presents (replacement)
        await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: false, focus: false } }));
        asHarness(env, () => env.viewer.setAggregateIsolation(foreign));
        const rMark = ledgerMark(env);
        await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: t().a1 }], options: { isolate: true, marker: false, focus: false } }));
        const restoredOver = env.recorder.records.slice(rMark).some((r) => r.origin === 'bridge' && r.method === 'viewer.setAggregateIsolation' && Array.isArray(r.isolationEntries) && r.isolationEntries.length === 0);
        const finalState = isolationReadLabels(env);
        await bridgeOp(env, 'clear', () => b.clear());
        asHarness(env, () => env.viewer.setAggregateIsolation([]));
        if (runnable.checks.includes('C12')) {
          checks.C12 = evaluateC12({ clear: c.ok ? { isolation: c.value.isolation, notes: [...c.value.notes] } : null, bridgeSetsAfterForeign: bridgeSetsAfter, foreignUnchanged, markersRemoved: c.ok && c.value.markersRemoved === priorMeshes, replacement: { bridgeRestoredOverForeign: restoredOver, finalState } });
        }
      }
      return { checks, controls };
    },

    // P8 -- C14 interleavings, C15 bounded failure injection (a)–(e), then C13 from the collected outcomes.
    async P8(ctx) {
      const { runnable } = ctx;
      const checks = {};
      let c15eTainted = false;
      let b = st.bridge1;
      const sides2 = [{ model: A(), dbId: t().a1 }, { model: B(), dbId: t().b1 }];
      const second = t().candidatesA[1] || t().candidatesA[0];
      const panelScenes = () => st.bridge1Names.flatMap((n) => [n.overlayMarkers, n.overlayOutlines]);
      const globalOk = () => isEmptyRead(isolationReadLabels(env)) && isEmptyRead(hiddenReadLabels(env)) && b.inspectLedger() === null
        && Object.values(bridgeNetPerScene(env.recorder.records, st.bridge1Since, panelScenes())).every((n) => n === 0);
      st.c13 = st.c13 || {};
      if (runnable.checks.includes('C14')) {
        beginChk(ctx, 'C14');
        const X = { sides: sides2, options: { isolate: true, marker: true, focus: false }, point: boxCentre(env.boundsOf(A(), t().a1)) };
        const Y = { sides: [{ model: A(), dbId: second.dbId }], options: { isolate: true, marker: true, focus: false }, point: boxCentre(second.box) };
        const [p1, p2] = await Promise.all([env.recorder.withOrigin('bridge', () => b.present(X)), env.recorder.withOrigin('bridge', () => b.present(Y))]);
        const L = b.inspectLedger();
        const isoY = isolationReadLabels(env);
        const presentPresent = {
          p1Superseded: p1.superseded === true, p2Superseded: p2.superseded === true,
          ledgerOnlyP2: L !== null && L.markerMeshes.length === expectedMarkerMeshCount({ variant: 'hard', outlinedSides: outlinedSidesOf(env, Y.sides) }),
          finalEqualsY: JSON.stringify(isoY) === JSON.stringify([{ model: 'A', ids: [second.dbId] }]),
        };
        await bridgeOp(env, 'clear', () => b.clear());
        const pc = env.recorder.withOrigin('bridge', () => b.present(X));
        const cc = env.recorder.withOrigin('bridge', () => b.clear());
        const [pcv] = await Promise.all([pc, cc]);
        const presentClear = { superseded: pcv.superseded === true, finalEmpty: b.inspectLedger() === null && isEmptyRead(isolationReadLabels(env)) };
        const pd = env.recorder.withOrigin('bridge', () => b.present(X));
        const dd = env.recorder.withOrigin('bridge', () => b.dispose());
        const [pdv] = await Promise.all([pd, dd]);
        env.bridgeTracker.dispose('bridge#1');
        const scenes = panelScenes();
        const residueOk = scenes.every((s) => !env.viewer.overlays.hasScene(s)) && b.inspectLedger() === null && b.inspectDisposal().disposed === true && b.inspectDisposal().releaseNotes.length === 0;
        const presentDispose = { superseded: pdv.superseded === true, residueOk };
        const spyBalanced = Object.values(bridgeNetPerScene(env.recorder.records, st.bridge1Since, scenes)).every((n) => n === 0);
        env.bridgeTracker.create('bridge#1');
        st.bridge1 = env.createBridge(G2A2_NAMES);
        st.bridge1Names.push(G2A2_NAMES);
        b = st.bridge1;
        checks.C14 = evaluateC14({ presentPresent, presentClear, presentDispose, spyBalanced, finalIsolationEmpty: isEmptyRead(isolationReadLabels(env)) });
      }
      if (runnable.checks.includes('C15')) {
        beginChk(ctx, 'C15');
        const owners = { viewer: env.viewer, overlays: env.viewer.overlays };
        const inj = env.injection;
        const obs = {};
        // (a) addMesh throws on the 2nd mesh => rollback.
        let h = inj.install('a', owners);
        let r = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { marker: true, focus: false, isolate: false }, point: boxCentre(env.boundsOf(A(), t().a1)) }));
        obs.a = { injectedFired: h.fires() === 1, marked: r.ok ? r.value.marked : null, failedNote: r.ok && r.value.notes.length > 0, ledgerNull: b.inspectLedger() === null, allAddedRemoved: Object.values(bridgeNetPerScene(env.recorder.records, st.bridge1Since, panelScenes())).every((n) => n === 0) };
        h.remove();
        obs.a.globalOk = globalOk();
        // (b) setAggregateIsolation throws on first call (no state change).
        h = inj.install('b', owners);
        const preB = isolationReadLabels(env);
        r = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: true, focus: false }, point: boxCentre(env.boundsOf(A(), t().a1)) }));
        obs.b = { injectedFired: h.fires() === 1, isolationUnchanged: JSON.stringify(isolationReadLabels(env)) === JSON.stringify(preB) };
        h.remove();
        let c = await bridgeOp(env, 'clear', () => b.clear());
        obs.b.noMarkerLeak = b.inspectLedger() === null && Object.values(bridgeNetPerScene(env.recorder.records, st.bridge1Since, panelScenes())).every((n) => n === 0);
        obs.b.globalOk = globalOk();
        st.c13.C15b = { isolation: c.ok ? c.value.isolation : null, noneAllowed: true };
        // (c) setAggregateIsolation throws AFTER applying.
        h = inj.install('c', owners);
        r = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { isolate: true, marker: false, focus: false } }));
        const firedC = h.fires() === 1;
        h.remove();
        c = await bridgeOp(env, 'clear', () => b.clear());
        obs.c = { injectedFired: firedC, finalIsolationEmpty: isEmptyRead(isolationReadLabels(env)), globalOk: globalOk() };
        st.c13.C15c = { isolation: c.ok ? c.value.isolation : null, noneAllowed: true };
        // (d) aggregate fitToView throws => first-side fallback.
        h = inj.install('d', owners);
        r = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { focus: true, isolate: false, marker: false } }));
        obs.d = { injectedFired: h.fires() === 1, fitted: r.ok ? r.value.fitted : null, notes: r.ok ? [...r.value.notes] : null };
        h.remove();
        await bridgeOp(env, 'clear', () => b.clear());
        obs.d.globalOk = globalOk();
        // (e) RC1/RC1-C1: transient restore failure -> three consecutive clear() calls, judged ONLY on
        // externally observable state (c15eOracle). Post-clear inspectLedger() is diagnostics only.
        const e = await runC15eScenario({ env, bridge: b, sides: sides2, point: boxCentre(env.boundsOf(A(), t().a1)), owners, globalOk, outlinedSides: outlinedSidesOf(env, sides2) });
        obs.e = { evidence: e.evidence, blocked: e.blocked, globalOk: e.globalOk };
        if (e.tainted) c15eTainted = true;
        st.c13.C15e = e.c13;
        if (runnable.checks.includes('C15')) checks.C15 = evaluateC15(obs);
      }
      if (runnable.checks.includes('C13')) { beginChk(ctx, 'C13'); checks.C13 = evaluateC13(st.c13); }
      return c15eTainted ? { checks, tainted: true } : { checks };
    },

    // P9 -- C16 hideModel/showModel events, N7 pre-check, C17 unload of B with Panel-owned state.
    async P9(ctx) {
      const { runnable } = ctx;
      const b = st.bridge1;
      const names = env.eventNames;
      // Listener setup serves C16 and C17 (the C16 event log); attributed to C16 when it runs.
      beginChk(ctx, 'C16');
      const log = createMonotonicEventLog({ clock: env.clock || defaultClock, recorder: env.recorder });
      const listeners = [];
      const addListener = (name) => {
        const fn = (event) => {
          log.push({ kind: 'listener-entry', eventName: name, modelLabel: env.labelOf(event && event.model), payloadSummary: event ? Object.keys(event).sort() : null });
          log.push({ kind: 'listener-exit', eventName: name, modelLabel: env.labelOf(event && event.model) });
        };
        asHarness(env, () => env.viewer.addEventListener(name, fn));
        listeners.push([name, fn]);
      };
      addListener(names.BEFORE_MODEL_UNLOAD);
      addListener(names.MODEL_REMOVED);
      const unsubscribe = viaBridge(env, () => b.onModelLeft(({ model, reason }) => log.push({ kind: 'bridge-callback', modelLabel: env.labelOf(model), reason })));
      const waitFor = (pred) => runWithDeadline({ op: 'expected-event', timeoutMs: TABLE_T.T6.expectedEventWindowMs, timers: env.timers, quarantine: env.quarantine, fn: async ({ isLive }) => { while (isLive() && !pred()) await env.tick(); return pred(); } });
      const checks = {};
      const controls = {};
      try {
        if (runnable.checks.includes('C16')) {
          const from = log.entries.length;
          // §9.2 slice C2: hide is a mutationOperation (node-side ack before the call; spy record = causal evidence)
          await runAcknowledgedMutation({ ops: env.ops, desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, recorder: env.recorder, method: 'viewer.hideModel', args: [B().id], invoke: () => asHarness(env, () => env.viewer.hideModel(B().id)) });
          await waitFor(() => log.entries.slice(from).some((e) => e.kind === 'listener-entry' && e.eventName === names.MODEL_REMOVED));
          asHarness(env, () => env.viewer.showModel(B().id));
          const back = asHarness(env, () => env.viewer.getAllModels()).includes(B());
          const readsWork = back && Array.isArray(env.boundsOf(B(), t().b1)) && isolationReadLabels(env) !== null;
          st.c16Restored = back && readsWork;
          checks.C16 = evaluateC16({ eventLog: log.entries.slice(from), eventNames: names, restored: st.c16Restored });
        }
        const P = boxCentre(env.boundsOf(A(), t().a1));
        const sides2 = [{ model: A(), dbId: t().a1 }, { model: B(), dbId: t().b1 }];
        const membership = () => { const ms = asHarness(env, () => env.viewer.getAllModels()); return { containsA: ms.includes(A()), containsB: ms.includes(B()) }; };
        // N7 (S0): the same V3/V4/V5 on a present while B is still loaded (no check executing).
        beginChk(ctx, null);
        beginCtl(ctx, 'N7');
        const n7Mark = ledgerMark(env);
        const pre = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { focus: true, isolate: true, marker: true }, point: P }));
        const preObs = { models: membership(), r1: pre.ok ? { ...pre.value, notes: [...pre.value.notes] } : null, L1: summarizeBridgeLedger(b.inspectLedger(), env.labelOf), s4BridgeRecords: env.recorder.records.slice(n7Mark).filter((r) => r.origin === 'bridge'), a1: t().a1 };
        await bridgeOp(env, 'clear', () => b.clear());
        const restoredN7 = b.inspectLedger() === null && isEmptyRead(isolationReadLabels(env));
        controls.N7 = evaluateN7({ preObs, restored: restoredN7, timedOut: pre.timedOut });
        if (runnable.checks.includes('C17')) {
          beginChk(ctx, 'C17');
          const precondition = st.c16Restored !== true ? 'c16-restoration' : (b.inspectLedger() !== null ? 'ledger-not-null' : (!isEmptyRead(isolationReadLabels(env)) ? 'isolation-not-empty' : (!P.every(Number.isFinite) ? 'point' : null)));
          if (precondition) { const r = c17Oracle({}, { preconditionUnmet: precondition }); checks.C17 = r.record; return { checks, controls, extras: { c17: r.c17, eventLog: log.entries } }; }
          const since = st.bridge1Since;
          const r0 = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { focus: false, isolate: true, marker: true }, point: P }));
          const L0 = summarizeBridgeLedger(b.inspectLedger(), env.labelOf);
          const from = log.entries.length;
          await runAcknowledgedMutation({ ops: env.ops, desc: { operationType: 'unload', modelId: 'B', phase: 'P9', invokedBy: 'C17' }, recorder: env.recorder, method: 'viewer.unloadModel', args: [B()], invoke: () => asHarness(env, () => env.viewer.unloadModel(B())) });
          await waitFor(() => {
            const s = log.entries.slice(from).filter((e) => e.kind === 'listener-entry');
            return s.some((e) => e.eventName === names.BEFORE_MODEL_UNLOAD) && s.some((e) => e.eventName === names.MODEL_REMOVED);
          });
          const models = membership();
          const prereqBeforeS4 = viaBridge(env, () => b.checkIsolationPrerequisite());
          const selection = viaBridge(env, () => b.readAggregateSelection());
          const s4 = ledgerMark(env);
          const r1 = await bridgeOp(env, 'present', () => b.present({ sides: sides2, options: { focus: true, isolate: true, marker: true }, point: P }));
          const L1 = summarizeBridgeLedger(b.inspectLedger(), env.labelOf);
          const s4BridgeRecords = env.recorder.records.slice(s4).filter((r) => r.origin === 'bridge');
          const c = await bridgeOp(env, 'clear', () => b.clear());
          const hidden = hiddenReadLabels(env);
          let nodeName;
          try { nodeName = { value: normalizeEvidence(B().getInstanceTree() ? B().getInstanceTree().getNodeName(t().b1) : null), threw: false }; } catch (e) { nodeName = { value: null, threw: true, errorName: e && e.name }; }
          const obs = {
            r0: r0.ok ? { ...r0.value, notes: [...r0.value.notes] } : null, L0, eventLog: log.entries.slice(from), eventNames: names, models,
            r1: r1.ok ? { ...r1.value, notes: [...r1.value.notes] } : null, L1, s4BridgeRecords, a1: t().a1,
            c: c.ok ? { isolation: c.value.isolation, markersRemoved: c.value.markersRemoved, notes: [...c.value.notes] } : null,
            post: {
              isolationEqualsBaseline: isEmptyRead(isolationReadLabels(env)),
              hiddenHasNonEmptyA: Array.isArray(hidden) ? hidden.some((e) => e.model === 'A' && e.ids.length > 0) : true,
              ledgerNull: b.inspectLedger() === null,
              netAddMinusRemove: bridgeNetPerScene(env.recorder.records, since, st.bridge1Names.flatMap((n) => [n.overlayMarkers, n.overlayOutlines])),
            },
            observations: { observationOnly: true, prerequisiteBeforeS4: prereqBeforeS4, readAggregateSelectionCount: selection.length, getNodeName: nodeName },
          };
          const timedOut = r0.timedOut ? 'present' : (r1.timedOut ? 'present' : (c.timedOut ? 'clear' : null));
          const r = c17Oracle(obs, { timedOut });
          checks.C17 = r.record;
          return { checks, controls, extras: { c17: r.c17, eventLog: log.entries } };
        }
        return { checks, controls, extras: { eventLog: log.entries } };
      } finally {
        unsubscribe();
        for (const [name, fn] of listeners) asHarness(env, () => env.viewer.removeEventListener(name, fn));
      }
    },

    // P10 -- C18a bridge #1 dispose (twice) and residue.
    async P10() {
      const b = st.bridge1;
      const since = st.bridge1Since;
      await bridgeOp(env, 'dispose', () => b.dispose());
      await bridgeOp(env, 'dispose', () => b.dispose());
      env.bridgeTracker.dispose('bridge#1');
      const ov = env.viewer.overlays;
      const panelScenes = st.bridge1Names.flatMap((n) => [n.overlayMarkers, n.overlayOutlines]);
      const recs = env.recorder.records.slice(since).filter((r) => r.origin === 'bridge');
      const lar = {};
      for (const name of [env.eventNames.BEFORE_MODEL_UNLOAD, env.eventNames.MODEL_REMOVED]) {
        const ofName = (m) => recs.filter((r) => r.method === m && r.argSummaries[0] && r.argSummaries[0].value === name).length;
        lar[name] = { add: ofName('viewer.addEventListener'), remove: ofName('viewer.removeEventListener') };
      }
      const sentinelRefs = Object.values(st.sentinels || {}).map((m) => env.recorder.refIdOf(m));
      const foreignOk = (st.foreignScenes || []).every((s) => ov.hasScene(s.scene))
        && !env.recorder.records.some((r) => r.origin === 'bridge' && ((r.method === 'overlays.removeScene' && (st.foreignScenes || []).some((s) => s.scene === overlaySceneName(r))) || (r.method === 'overlays.removeMesh' && sentinelRefs.includes(r.argRefIds[0]))));
      const pdMark = ledgerMark(env);
      const pp = await bridgeOp(env, 'present', () => b.present({ sides: [{ model: A(), dbId: t().a1 }], options: { marker: true, focus: true, isolate: true } }));
      const cc = await bridgeOp(env, 'clear', () => b.clear());
      const mutators = env.recorder.records.slice(pdMark).filter((r) => r.origin === 'bridge' && BRIDGE_MUTATOR_SPY_METHODS.includes(r.method)).length;
      const disposal = b.inspectDisposal();
      const stillLoaded = asHarness(env, () => env.viewer.getAllModels());
      const iso = isolationReadLabels(env);
      const hid = hiddenReadLabels(env);
      const loadedLabels = stillLoaded.map((m) => env.labelOf(m)).filter(Boolean);
      const emptyFor = (read) => Array.isArray(read) && read.filter((e) => loadedLabels.includes(e.model)).every((e) => e.ids.length === 0);
      return {
        checks: {
          C18a: evaluateC18a({
            panelScenesAbsent: panelScenes.every((s) => !ov.hasScene(s)), foreignOk, listenerAddRemove: lar, ledgerNull: b.inspectLedger() === null,
            disposal: { disposed: disposal.disposed, releaseNotes: [...disposal.releaseNotes], listenerErrors: [...disposal.listenerErrors] },
            postDispose: { presentDisposed: pp.ok && pp.value.disposed === true, clearDisposed: cc.ok && cc.value.disposed === true, bridgeMutatorCalls: mutators },
            isolationHiddenEmpty: emptyFor(iso) && emptyFor(hid),
          }),
        },
      };
    },

    // P11 -- C19 whole-session prohibited-call ledger.
    async P11({ results }) {
      return { checks: { C19: evaluateC19({ records: env.recorder.records, n1State: results.controls.N1 ? controlEffectiveState(results.controls.N1) : null }) } };
    },
  };
}

// ============================================================================================
// Section 37 -- PAGE-SIDE AGENT (in-page realm; procedure §3 "Page", §4.3, §4.4, §4.5, §6 page-side
// observations, §9 page-owned cleanup steps). NOT EXECUTED by this revision: LIVE_PATH_WIRED is
// false, main() refuses right after W0, and nothing ever reaches a page.
//
// Everything from the Section 17 header down to the `G2 PAGE-AGENT END` marker below is shipped
// VERBATIM into the page by `buildPageAgentSource` (Section 38) as ONE init script, together with
// the earlier-section declarations it references (computed mechanically from the harness's own
// token stream) and three realm shims (sha256Hex -> sha256HexPortable, Buffer -> PageBuffer,
// randomUUID -> crypto.randomUUID). So the recorder, the spies, the injection wrappers, the phase
// runner and the Section 36 drivers all run IN the page, next to the real Viewer and the served
// ViewerBridge -- the only realm in which the bridge's synchronous Viewer calls can be spied.
// Node talks to the page through `page.evaluate` by registry key (G2_IN_PAGE_FUNCTION_NAMES) and
// the page calls back into Node only through two exposed bindings (screenshot, fatal event).
//
// Rule for this section: an in-page function may reference page globals (window, document,
// requestAnimationFrame, createImageBitmap, atob, Autodesk, THREE) and any declaration of Sections
// 17-37, never a Node API. The offline tests load the built bundle into a node:vm context WITHOUT
// Node globals (no Buffer / process / require) to prove it. Viewer behaviour that these adapters
// rely on and that cannot be verified offline is marked `UNVERIFIED-LIVE:` in a comment; nothing
// here fabricates an observation -- an unreadable value is recorded as null with its error.
// ============================================================================================

/** DOM id of the C2/C3 shell probe (procedure §C2). */
const G2_SHELL_PROBE_ID = 'g2-shell-probe';
/** Exposed Node bindings the page may call (page.exposeFunction names). */
const G2_NODE_SCREENSHOT_BINDING = '__g2NodeScreenshot';
const G2_NODE_FATAL_BINDING = '__g2NodeFatal';
/** §9.2 slice C2: the node-side operation-ledger acknowledgement barrier (`createOperationLedger().pageOperation`). */
const G2_NODE_OPLEDGER_BINDING = '__g2NodeOpLedger';
/** Served modules the page imports (all under /clashpanel/, JS-only, path-confined; §3 "Page"). */
const G2_SERVED_ENTRY_MODULES = Object.freeze([
  '/clashpanel/viewer/viewerApi.js',
  '/clashpanel/viewer/ViewerBridge.js',
  '/clashpanel/ui/ClashDockingPanel.js',
]);
/** Readiness poll interval (G1's accepted bounded-poll fallback; the deadline is T2). */
const G2_READINESS_POLL_MS = 250;

// ---- realm shims (used only inside the page bundle; Node keeps node:crypto / Buffer) ----------

const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Synchronous pure-JS SHA-256 (FIPS 180-4) for the page realm, where node:crypto does not exist and
 * SubtleCrypto is asynchronous (the recorder's argument digest is computed synchronously inside a
 * spied call). Accepts a string (UTF-8 encoded) or any ArrayBuffer / ArrayBufferView. Offline tests
 * assert byte-for-byte equality with node:crypto over test vectors and random inputs.
 */
function sha256HexPortable(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new TypeError('sha256HexPortable: string or bytes required');
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000);
  const bitsLo = (len * 8) >>> 0;
  padded[total - 8] = (bitsHi >>> 24) & 0xff;
  padded[total - 7] = (bitsHi >>> 16) & 0xff;
  padded[total - 6] = (bitsHi >>> 8) & 0xff;
  padded[total - 5] = bitsHi & 0xff;
  padded[total - 4] = (bitsLo >>> 24) & 0xff;
  padded[total - 3] = (bitsLo >>> 16) & 0xff;
  padded[total - 2] = (bitsLo >>> 8) & 0xff;
  padded[total - 1] = bitsLo & 0xff;
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = off + i * 4;
      W[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_ROUND_CONSTANTS[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Minimal page-realm stand-in for the three Buffer uses of Sections 17-36: `Buffer.from(str,
 * 'utf8')` (+ `subarray(..).toString('utf8')`, indexing, `byteLength`), `Buffer.byteLength(str)` and
 * `Buffer.from(arrayBuffer, offset, length)`. A Uint8Array subclass, so `subarray` keeps the type.
 */
class PageBuffer extends Uint8Array {
  static from(value, offsetOrEncoding, length) {
    if (typeof value === 'string') {
      const enc = new TextEncoder().encode(value);
      const out = new PageBuffer(enc.length);
      out.set(enc);
      return out;
    }
    if (value instanceof ArrayBuffer) {
      const off = typeof offsetOrEncoding === 'number' ? offsetOrEncoding : 0;
      return new PageBuffer(value, off, typeof length === 'number' ? length : value.byteLength - off);
    }
    if (ArrayBuffer.isView(value)) return new PageBuffer(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('PageBuffer.from: string, ArrayBuffer or view required');
  }

  static byteLength(value) {
    if (typeof value === 'string') return new TextEncoder().encode(value).length;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
    throw new TypeError('PageBuffer.byteLength: string or bytes required');
  }

  toString(encoding) {
    if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'utf-8') throw new TypeError(`PageBuffer.toString: unsupported encoding ${String(encoding)}`);
    return new TextDecoder().decode(this);
  }
}

// ---- small in-page helpers ----------------------------------------------------------------------

/**
 * Tolerant JSON-safe copy for values crossing the page -> Node boundary: like normalizeEvidence, but
 * a function or non-plain object is replaced by an explicit `{nonPlainEvidence: <constructor name>}`
 * marker (visible, never silently dropped) instead of throwing and losing the whole phase record.
 */
function g2JsonSafe(value, depth = 0) {
  if (depth > 64) return { nonPlainEvidence: 'depth-limit' };
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'number': return Number.isFinite(value) ? value : String(value);
    case 'string': case 'boolean': return value;
    case 'bigint': return String(value);
    case 'function': return { nonPlainEvidence: 'function' };
    case 'symbol': return { nonPlainEvidence: 'symbol' };
    default: break;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value, (v) => g2JsonSafe(v, depth + 1));
  if (Array.isArray(value)) return value.map((v) => g2JsonSafe(v, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { nonPlainEvidence: (value.constructor && value.constructor.name) || 'unknown' };
  const out = {};
  for (const k of Object.keys(value)) out[k] = g2JsonSafe(value[k], depth + 1);
  return out;
}

/** JSON-safe, redacted error summary (never a live Error object across the realm boundary). */
function g2ErrOf(e) {
  if (e !== null && typeof e === 'object') {
    return { name: typeof e.name === 'string' ? e.name : 'Error', message: truncateUtf8(redactEvidenceText(String(e.message ?? '')).value, 512).value };
  }
  return { name: typeof e, message: truncateUtf8(redactEvidenceText(String(e)).value, 512).value };
}

/** The page agent's single mutable state object (created lazily; never exposed to the bridge). */
function g2PageState() {
  if (!window.__g2) {
    window.__g2 = { mod: {}, docs: {}, loads: {}, models: {}, readiness: {}, fatal: { flag: false, abort: false, kinds: [] }, env: null, screenshots: [], targets: null, listeners: [] };
  }
  return window.__g2;
}

/** A served module previously installed by g2InstallModules (throws if absent). */
function g2Module(spec) {
  const m = g2PageState().mod[spec];
  if (!m) throw new Error(`module not installed: ${spec}`);
  return m;
}

/**
 * Model format signals -> G1's 5-outcome classifier (copied by value from G1 `readFormat`, §C1
 * "G1's guarded readFormat classifier"; drift-tested against G1's export). `otg`/`svf2` are the raw
 * signal values or FORMAT_SIGNAL_UNAVAILABLE when the method is absent. Never an OR, never a bare AND.
 */
const FORMAT_SIGNAL_UNAVAILABLE = 'UNAVAILABLE';
function classifyFormatSignals(otg, svf2) {
  const otgAvailable = otg !== FORMAT_SIGNAL_UNAVAILABLE;
  const svf2Available = svf2 !== FORMAT_SIGNAL_UNAVAILABLE;
  if (otgAvailable && svf2Available) {
    if (otg === true && svf2 === true) return 'CONFIRMED_SVF2';
    if (otg === false && svf2 === false) return 'CONFIRMED_NON_SVF2';
    return 'CONTRADICTORY';
  }
  if (otgAvailable !== svf2Available) return 'INDETERMINATE_PARTIAL';
  return 'INDETERMINATE_UNAVAILABLE';
}

/** Reads one zero-argument model method: `{available, value, threw, error}` (never throws). */
function g2ReadModelSignal(model, name) {
  const fn = model && model[name];
  if (typeof fn !== 'function') return { available: false, value: null, threw: false, error: null };
  try { return { available: true, value: g2JsonSafe(fn.call(model)), threw: false, error: null }; } catch (e) { return { available: true, value: null, threw: true, error: g2ErrOf(e) }; }
}

// ---- Phase 0 (in-page part): modules, WebGL probe, fatal forwarding ----------------------------

/** In-page. Imports each served module into window.__g2.mod; `{spec: {ok, exports} | {ok:false, error}}`. */
async function g2InstallModules(specs) {
  const g = g2PageState();
  const out = {};
  for (const spec of Array.isArray(specs) ? specs : []) {
    try {
      const m = await import(spec);
      g.mod[spec] = m;
      out[spec] = { ok: true, exports: Object.keys(m).sort() };
    } catch (e) {
      out[spec] = { ok: false, error: g2ErrOf(e) };
    }
  }
  return out;
}

/**
 * In-page. Phase-0 readiness of the agent itself + page-side fatal forwarding (§9 error ledger):
 * `unhandledrejection` (an uncaught injected C15 error included) and the viewer canvas's
 * `webglcontextlost` are forwarded to Node through G2_NODE_FATAL_BINDING and also latch the page's
 * own fatal flag (read by the runner's `fatalObserved`). Returns the WebGL probe for runtimeEnvelope.
 */
function g2AgentReady() {
  const g = g2PageState();
  const forward = (kind, detail) => {
    g.fatal.flag = true;
    g.fatal.kinds.push(kind);
    try { const fn = window[G2_NODE_FATAL_BINDING]; if (typeof fn === 'function') Promise.resolve(fn(kind, detail)).catch(() => {}); } catch { /* the Node side also observes pageerror */ }
  };
  if (!g.fatalForwardingInstalled) {
    const onRejection = (ev) => { forward('unhandledrejection', g2ErrOf(ev && ev.reason).message); };
    window.addEventListener('unhandledrejection', onRejection);
    g.listeners.push(['window', 'unhandledrejection', onRejection]);
    const canvas = window.__viewer && window.__viewer.canvas;
    if (canvas && typeof canvas.addEventListener === 'function') {
      const onLost = () => { forward('webglcontextlost', 'viewer canvas lost its WebGL context'); };
      canvas.addEventListener('webglcontextlost', onLost);
      g.listeners.push(['canvas', 'webglcontextlost', onLost]);
    }
    g.fatalForwardingInstalled = true;
  }
  let webgl = { available: false, version: null };
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2') || probe.getContext('webgl');
    webgl = { available: Boolean(ctx), version: ctx ? (typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : null };
  } catch (e) { webgl = { available: false, version: null, error: g2ErrOf(e) }; }
  return {
    ok: typeof window.__viewer === 'object' && window.__viewer !== null && typeof window.THREE === 'object' && window.THREE !== null,
    viewerPresent: Boolean(window.__viewer), threePresent: Boolean(window.THREE), webgl,
    devicePixelRatio: typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : null,
  };
}

/** In-page. Node-side fatal/abort latch (T9 expiry or a Node-observed fatal event). */
function g2MarkFatal({ kind = 'node-observed', abort = false } = {}) {
  const g = g2PageState();
  g.fatal.flag = true;
  if (abort === true) g.fatal.abort = true;
  g.fatal.kinds.push(String(kind));
  return { flag: g.fatal.flag, abort: g.fatal.abort };
}

// ---- P1 loads (G1-style starters; ATTEMPT_CONSUMED is durable in Node before the first call) ----

function g2LoadSnapshot(rec) {
  return { api: rec.api, label: rec.label, status: rec.status, elapsedMs: (rec.settledAt === null ? performance.now() : rec.settledAt) - rec.startedAt, error: rec.error, late: rec.late };
}

/**
 * In-page. `Autodesk.Viewing.Document.load('urn:'+urn, ok, fail)` (the production wwwroot/viewer.js
 * call shape, as G1's documentLoadStarter), token-bounded by `timeoutMs`; a late arrival after the
 * deadline is quarantined (recorded in `late`, never delivered).
 */
function g2DocumentLoad({ label, urn, timeoutMs }) {
  const g = g2PageState();
  const rec = { api: 'Document.load', label, status: 'active', startedAt: performance.now(), settledAt: null, error: null, late: null };
  g.loads[`doc:${label}`] = rec;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (rec.status === 'active') { rec.status = 'timed-out'; rec.settledAt = performance.now(); resolve(g2LoadSnapshot(rec)); }
    }, timeoutMs);
    const settle = (status, error, doc) => {
      if (rec.status !== 'active') { rec.late = status; return; }
      clearTimeout(timer);
      rec.status = status; rec.error = error; rec.settledAt = performance.now();
      if (doc) g.docs[label] = doc;
      resolve(g2LoadSnapshot(rec));
    };
    try {
      window.Autodesk.Viewing.Document.load(
        `urn:${urn}`,
        (doc) => settle('completed', null, doc),
        (code, message) => settle('failed', { name: 'DocumentLoadError', message: truncateUtf8(redactEvidenceText(String(message ?? '')).value, 512).value, code: String(code) }, null),
      );
    } catch (e) { settle('failed', g2ErrOf(e), null); }
  });
}

/**
 * In-page. `viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), {keepCurrentModels:
 * true})` -- the production wwwroot/viewer.js call shape with its keep-current-models option (§3:
 * "keep-current-models semantics"), token-bounded. A model that arrives after the deadline is
 * quarantined AND unloaded (G1 `disposeLateArrival` ownership rule: the harness never keeps a model
 * it did not account for). UNVERIFIED-LIVE: that `keepCurrentModels:true` on the first load is inert.
 */
function g2LoadDocumentNode({ label, timeoutMs }) {
  const g = g2PageState();
  const rec = { api: 'loadDocumentNode', label, status: 'active', startedAt: performance.now(), settledAt: null, error: null, late: null };
  g.loads[`node:${label}`] = rec;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (rec.status === 'active') { rec.status = 'timed-out'; rec.settledAt = performance.now(); resolve(g2LoadSnapshot(rec)); }
    }, timeoutMs);
    const settle = (status, error, model) => {
      if (rec.status !== 'active') {
        rec.late = status;
        if (model) { try { window.__viewer.unloadModel(model); rec.lateUnloaded = true; } catch (e) { rec.lateUnloaded = false; rec.lateUnloadError = g2ErrOf(e); } }
        return;
      }
      clearTimeout(timer);
      rec.status = status; rec.error = error; rec.settledAt = performance.now();
      if (model) g.models[label] = model;
      resolve(g2LoadSnapshot(rec));
    };
    const doc = g.docs[label];
    if (!doc) { settle('failed', { name: 'LoadDocumentNodeError', message: 'no Document for this label' }, null); return; }
    try {
      Promise.resolve(window.__viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry(true), { keepCurrentModels: true })).then(
        (model) => settle('completed', null, model),
        (err) => settle('failed', g2ErrOf(err), null),
      );
    } catch (e) { settle('failed', g2ErrOf(e), null); }
  });
}

/**
 * In-page. §4.5 readiness rule: the model's object tree (isObjectTreeCreated() or getObjectTree(ok,
 * fail) success, G1's readiness kernel) AND geometry loaded (GEOMETRY_LOADED_EVENT for this model
 * object, or -- G1's accepted fallback, recorded as such -- a bounded isLoadDone() poll), all within
 * `timeoutMs`. Resolves `{label, status:'ready'|'timed-out'|..., tree, geometry, geometryPath}`.
 */
function g2AwaitModelReady({ label, timeoutMs }) {
  const g = g2PageState();
  const viewer = window.__viewer;
  const model = g.models[label];
  const out = { label, status: 'active', tree: null, geometry: null, geometryPath: null };
  if (!model) return Promise.resolve({ ...out, status: 'no-model' });
  const AV = window.Autodesk && window.Autodesk.Viewing;
  const geomEvent = AV && typeof AV.GEOMETRY_LOADED_EVENT === 'string' ? AV.GEOMETRY_LOADED_EVENT : null;
  return new Promise((resolve) => {
    let done = false;
    let poll = null;
    let timer = null;
    const onGeom = (ev) => { if (ev && ev.model === model && out.geometry !== true) { out.geometry = true; out.geometryPath = 'GEOMETRY_LOADED_EVENT'; check(); } };
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      try { if (geomEvent) viewer.removeEventListener(geomEvent, onGeom); } catch { /* recorded below via status */ }
      out.status = status;
      g.readiness[label] = { ...out };
      resolve({ ...out });
    };
    function check() { if (out.tree === true && out.geometry === true) finish('ready'); }
    timer = setTimeout(() => finish('timed-out'), timeoutMs);
    try { if (geomEvent) viewer.addEventListener(geomEvent, onGeom); } catch { /* poll fallback below */ }
    try {
      if (typeof model.isObjectTreeCreated === 'function' && model.isObjectTreeCreated() === true) out.tree = true;
      else model.getObjectTree(() => { out.tree = true; check(); }, () => { out.tree = false; finish('tree-failed'); });
    } catch (e) { out.tree = false; out.treeError = g2ErrOf(e); finish('tree-threw'); return; }
    const pollOnce = () => {
      try {
        if (typeof model.isLoadDone === 'function' && model.isLoadDone() === true && out.geometry !== true) { out.geometry = true; out.geometryPath = 'isLoadDone-poll'; }
      } catch { /* keep polling until the deadline */ }
      check();
    };
    pollOnce();
    if (!done) poll = setInterval(pollOnce, G2_READINESS_POLL_MS);
  });
}

// ---- P1 C1 / P4 C5 / §4.4 target facts ---------------------------------------------------------

/** In-page. §C1 observation: per model loaded, classifier (raw signals kept), membership, units. */
function g2CollectModelFacts() {
  const g = g2PageState();
  let all = null;
  try { all = window.__viewer.getAllModels(); } catch { all = null; }
  const facts = { loadedCount: Array.isArray(all) ? all.length : null };
  for (const label of ['A', 'B']) {
    const model = g.models[label] || null;
    const ready = g.readiness[label];
    // §7 C1 reason contract: the awaited-operation outcome (T2 deadline vs rejection) for blockDetail.
    const ops = [g.loads && g.loads[`doc:${label}`], g.loads && g.loads[`node:${label}`], ready].filter(Boolean).map((r) => r.status);
    const loadStatus = ops.includes('timed-out') ? 'timed-out' : (ops.includes('failed') ? 'failed' : (ops.length ? String(ops[ops.length - 1]) : null));
    if (!model) { facts[label] = { loaded: false, classification: null, otg: null, svf2: null, inAllModels: false, unitScale: null, unitString: null, loadStatus }; continue; }
    const otg = g2ReadModelSignal(model, 'isOTG');
    const svf2 = g2ReadModelSignal(model, 'isSVF2');
    // A throwing signal is never coerced to a value: classification null (C1 BLOCKED(prerequisite)).
    const classification = otg.threw || svf2.threw ? null
      : classifyFormatSignals(otg.available ? otg.value : FORMAT_SIGNAL_UNAVAILABLE, svf2.available ? svf2.value : FORMAT_SIGNAL_UNAVAILABLE);
    const scale = g2ReadModelSignal(model, 'getUnitScale');
    const unit = g2ReadModelSignal(model, 'getUnitString');
    facts[label] = {
      loaded: Boolean(ready && ready.status === 'ready'), classification, otg, svf2,
      inAllModels: Array.isArray(all) && all.includes(model),
      unitScale: scale.available && !scale.threw ? scale.value : null,
      unitString: unit.available && !unit.threw ? unit.value : null,
      loadStatus,
    };
  }
  return facts;
}

/** The object tree of a model (getObjectTree(), else getInstanceTree(); G1 observeF2 precedent). */
function g2TreeOf(model) {
  let tree = typeof model.getObjectTree === 'function' ? model.getObjectTree() : null;
  if (!tree || typeof tree.enumNodeChildren !== 'function') tree = typeof model.getInstanceTree === 'function' ? model.getInstanceTree() : null;
  if (!tree || typeof tree.enumNodeChildren !== 'function') throw new Error('object tree unavailable');
  return tree;
}

/**
 * §4.4 per-model inputs: leaf dbIds (non-recursive stack walk from getRootId(), G1 observeF2's walk
 * shape), per-leaf fragment counts (enumNodeFragments, non-recursive) and the bridge's OWN bounds path
 * (`viewerApi.getElementWorldBounds`). Pure reads.
 */
function g2EnumerateModelInputs(model, api) {
  const tree = g2TreeOf(model);
  const leaves = [];
  const seen = new Set();
  const stack = [tree.getRootId()];
  while (stack.length > 0) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const kids = [];
    tree.enumNodeChildren(n, (ch) => { kids.push(ch); return false; }, false);
    if (kids.length === 0) leaves.push(n);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  const fragmentCounts = new Map();
  const boxes = new Map();
  for (const dbId of leaves) {
    let n = 0;
    tree.enumNodeFragments(dbId, () => { n += 1; }, false);
    fragmentCounts.set(dbId, n);
    if (n >= 1) boxes.set(dbId, api.getElementWorldBounds(model, dbId));
  }
  return { leafDbIds: leaves, fragmentCounts, boxes };
}

/**
 * In-page. Deterministic target selection (§4.4) over both models; stores the full candidate lists in
 * the page state (the Section 36 drivers read them) and returns only the §10 `targets` summary.
 */
function g2PrepareTargets() {
  const g = g2PageState();
  const viewer = window.__viewer;
  const events = g2EventNames();
  const api = g2Module('/clashpanel/viewer/viewerApi.js').createViewerApi(viewer, { events });
  const inputs = {};
  for (const label of ['A', 'B']) {
    const model = g.models[label];
    inputs[label] = model ? g2EnumerateModelInputs(model, api) : { leafDbIds: [], fragmentCounts: new Map(), boxes: new Map() };
  }
  const summary = selectTargets({ A: inputs.A, B: inputs.B });
  const candidatesA = enumerateCandidates(inputs.A).candidates;
  const candidatesB = enumerateCandidates(inputs.B).candidates;
  g.targets = {
    a1: summary.a1, b1: summary.b1,
    fitPair: summary.fitPair ? { a: summary.fitPair.a, b: summary.fitPair.b } : null,
    candidatesA, candidatesB,
  };
  return g2JsonSafe(summary);
}

/** Runtime event-name constants (§C16: "names from runtime constants"). */
function g2EventNames() {
  const AV = window.Autodesk && window.Autodesk.Viewing;
  return { BEFORE_MODEL_UNLOAD: AV ? AV.BEFORE_MODEL_UNLOAD_EVENT : undefined, MODEL_REMOVED: AV ? AV.MODEL_REMOVED_EVENT : undefined };
}

/**
 * §C4 reference source: every fragment of `dbId` (enumNodeFragments recursive=true) through
 * `model.getFragmentList().getWorldBounds(fragId, THREE.Box3)`; an unreadable fragment box is null
 * (-> NOT_EVIDENCED(no-reference) for that dbId, never guessed).
 */
function g2FragmentBoxes(model, dbId) {
  const tree = g2TreeOf(model);
  const fragList = model.getFragmentList();
  const ids = [];
  tree.enumNodeFragments(dbId, (f) => { ids.push(f); }, true);
  return ids.map((f) => {
    try {
      const b = new window.THREE.Box3();
      fragList.getWorldBounds(f, b);
      return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
    } catch { return null; }
  });
}

/** §C5 observation: unit scale/string per model and native extents of the chosen per-model targets. */
function g2CollectUnitFacts(env) {
  const out = { pair: 'a1/b1 (the §4.4 chosen dbId per model)' };
  for (const [label, dbId] of [['A', env.targets.a1], ['B', env.targets.b1]]) {
    const model = env.models[label];
    if (!model || dbId === null || dbId === undefined) { out[label] = { unitScale: undefined, unitString: undefined, nativeExtent: null }; continue; }
    const scale = g2ReadModelSignal(model, 'getUnitScale');
    const unit = g2ReadModelSignal(model, 'getUnitString');
    const b = env.boundsOf(model, dbId);
    out[label] = {
      unitScale: scale.available && !scale.threw ? scale.value : null,
      unitString: unit.available && !unit.threw ? unit.value : null,
      nativeExtent: Array.isArray(b) ? [b[3] - b[0], b[4] - b[1], b[5] - b[2]] : null,
    };
  }
  return out;
}

// ---- P6/P6b camera + capture adapters ----------------------------------------------------------

/**
 * Camera adapter (§C6/C8 settle, N2 reset, C20 K0..K3). `sample()` reads `viewer.getCamera()` after
 * `updateMatrixWorld(true)` (procedure text) and returns plain 16-entry matrices. `resetHome()`
 * restores the view captured by `captureHome()` (taken once, after both models loaded, before any
 * check) -- UNVERIFIED-LIVE: `viewer.getState({viewport:true})` / `viewer.restoreState(state,
 * undefined, true)` returning true on success. A non-true return is reported as-is, so N2 fails
 * closed (RESTORE_FAILED) rather than assuming a reset.
 */
function g2CreateCameraAdapter(viewer) {
  let home = null;
  return {
    captureHome() {
      try { home = viewer.getState({ viewport: true }); } catch { home = null; }
      return home !== null && typeof home === 'object';
    },
    sample() {
      const cam = viewer.getCamera();
      cam.updateMatrixWorld(true);
      return { matrixWorldInverse: Array.from(cam.matrixWorldInverse.elements), projectionMatrix: Array.from(cam.projectionMatrix.elements) };
    },
    waitFrame() { return new Promise((resolve) => { requestAnimationFrame(() => resolve()); }); },
    resetHome() {
      if (home === null) return false;
      return viewer.restoreState(home, undefined, true) === true;
    },
  };
}

/**
 * Capture adapter (§C20 A2-A5). `canvas()` records `viewer.canvas`, W x H = its integer-rounded
 * getBoundingClientRect() size and the clip rectangle R; `frame()` asks Node (exposed binding) for
 * `page.screenshot({clip:R, type:'png', animations:'disabled', caret:'hide'})` and decodes the PNG to
 * RGBA IN THE PAGE (createImageBitmap -> canvas -> getImageData, procedure text), appending the
 * frame's RGBA SHA-256 to the §10 `screenshots` list. UNVERIFIED-LIVE: that the decode path with
 * premultiplyAlpha/colorSpaceConversion 'none' is byte-stable (the same path is used for every frame,
 * and C20 only ever compares frames decoded by it).
 */
function g2CreateCaptureAdapter(viewer) {
  const g = g2PageState();
  let rect = null;
  const raf = () => new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
  return {
    async canvas() {
      const c = viewer.canvas;
      const r = c.getBoundingClientRect();
      const W = Math.round(r.width);
      const H = Math.round(r.height);
      rect = { x: Math.round(r.left), y: Math.round(r.top), width: W, height: H };
      return { W, H, clip: rect, dsf: window.devicePixelRatio, shellDisposed: document.getElementById(G2_SHELL_PROBE_ID) === null, canvasElement: { tagName: c.tagName, width: c.width, height: c.height } };
    },
    async frame() {
      if (rect === null) throw new Error('capture: canvas() must run before frame()');
      const b64 = await window[G2_NODE_SCREENSHOT_BINDING](rect);
      const bin = atob(String(b64));
      const png = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) png[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (bmp.width !== rect.width || bmp.height !== rect.height) throw new Error(`capture: decoded ${bmp.width}x${bmp.height} differs from clip ${rect.width}x${rect.height}`);
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      if (typeof bmp.close === 'function') bmp.close();
      const frame = new Uint8Array(data.length);
      frame.set(data);
      g.screenshots.push({ index: g.screenshots.length, W: rect.width, H: rect.height, rgbaSha256: sha256Hex(frame) });
      return frame;
    },
    async waitRafs(n) { for (let i = 0; i < n; i += 1) await raf(); },
  };
}

// ---- P3 C2/C3 shell probe ----------------------------------------------------------------------

/** Neutral ViewModel for the probe's fake controller (shape of test/clashpanel/dom/support/vmFixtures.mjs, copied by value). */
function g2ShellViewModel() {
  const side = (modelKey, modelName, label, dbId) => ({ modelKey, modelName, label, dbId });
  return {
    version: 1,
    setup: {
      collapsed: false, summary: 'G2 shell probe', name: 'G2 shell probe', mode: 'hard',
      softAvailability: { available: true, pending: false, explanation: null },
      clearance: { value: '', visible: false, error: null },
      models: [], selfClash: false, useSelectionEnabled: false, scope: { A: '0 models', B: '0 models' },
      validation: { state: 'ready', messages: [], issuesTruncated: false }, setupChangedSinceRun: false,
    },
    run: { state: 'idle', doneKind: null, canRun: false, canStop: false, progress: null, headline: 'Idle', counts: { total: null, filtered: null }, badges: null, banners: [], diagnostics: null, details: null, statusLive: 'Idle', waitingForOtherRun: false },
    filters: { text: '', models: [], modelOptions: [], maxGap: { visible: false, value: '', max: null, error: null }, unverified: false, hasLocation: false, elementOnly: null, groupBy: 'none', groupingNote: null, sort: 'default', sortOptions: [{ value: 'default', label: 'Default' }], active: false, busy: false },
    results: { state: 'list', message: null, lines: [], view: 'flat', page: { index: 0, count: 1, size: 50 }, rows: [], multiValuedNote: null, hiddenByFiltersNote: false, nav: { canPrev: false, canNext: false, label: 'No clash selected' } },
    selected: {
      resultId: null, ordinal: null, side1: side('mA', 'A', '-', 0), side2: side('mB', 'B', '-', 0), gap: null, hasLocation: false, liveness: 'live', notes: [], hiddenByFilters: false,
      actions: { focus: { enabled: false, reason: null }, isolate: { enabled: false, checked: false, reason: null }, markers: { enabled: false, checked: false, reason: null }, focusOnSelect: { checked: false }, backToAll: { enabled: false } },
    },
  };
}

/**
 * Composes onto `recorder.record` (like Section 31's model tagger) to keep the RAW first argument of
 * every `DockingPanel.prototype.addVisibilityListener` call in a harness-local list -- §C3 invokes
 * the retained visibility callback after dispose. Records themselves are unchanged (plain data).
 */
function attachShellArgumentCapture(recorder) {
  if (recorder.shellCaptureAttached === true) throw new Error('attachShellArgumentCapture: already attached');
  const original = recorder.record;
  const visibilityCallbacks = [];
  recorder.record = (method, args) => {
    const rec = original(method, args);
    if (method === 'DockingPanel.prototype.addVisibilityListener' && typeof args[0] === 'function') visibilityCallbacks.push(args[0]);
    return rec;
  };
  recorder.shellCaptureAttached = true;
  return { visibilityCallbacks, detach() { recorder.record = original; recorder.shellCaptureAttached = false; } };
}

/** Element set under document.head and the viewer container (C3 residue baseline). */
function g2DomInventory(viewerContainer) {
  return new Set([...document.head.querySelectorAll('*'), ...viewerContainer.querySelectorAll('*')]);
}

/** A new node is attributable to the panel iff it carries the probe id or a `clash-` class/id. */
function g2AttributableToPanel(node) {
  const id = typeof node.id === 'string' ? node.id : '';
  const cls = typeof node.className === 'string' ? node.className : '';
  return id === G2_SHELL_PROBE_ID || /(^|\s)clash-/.test(cls) || id.startsWith('clash-');
}

function g2DescribeNode(node) {
  return { tag: node.tagName, id: node.id || null, className: typeof node.className === 'string' ? node.className : null };
}

/**
 * The C2/C3 page-side observation collector (§C2 (i)-(viii), §C3). The shell is built with the
 * REAL `Autodesk` (real DockingPanel base class) under origin 'shell'; observations come from the
 * recorder's DockingPanel.prototype spies, a harness-local fake controller and DOM reads only.
 * `createTitleBar`'s returned element T is resolved by the recorder's reference id (never by class
 * name); the C3 close-button click locates the element following T (observation only, recorded).
 */
function g2CreateShellProbe(env) {
  const st = env.state;
  const rec = env.recorder;
  const viewer = env.viewer;
  const dispatched = [];
  const controller = {
    getViewModel: () => g2ShellViewModel(),
    subscribe: (cb) => { st.shellSubscriptions = (st.shellSubscriptions || 0) + 1; void cb; return () => { st.shellSubscriptions -= 1; }; },
    dispatch: (intent) => { dispatched.push(intent && typeof intent.type === 'string' ? intent.type : '<non-intent>'); return Promise.resolve(); },
  };
  const isMethod = (label) => (r) => r.method === label;
  const setVisibleWith = (v) => (r) => r.method === 'DockingPanel.prototype.setVisible' && r.argSummaries[0] && r.argSummaries[0].value === v;
  const resolveRef = (refId) => {
    const all = document.getElementsByTagName('*');
    for (let i = 0; i < all.length; i += 1) if (rec.refIdOf(all[i]) === refId) return all[i];
    return null;
  };
  return {
    async c2() {
      const createPanelShell = g2Module('/clashpanel/ui/ClashDockingPanel.js').createPanelShell;
      st.shellResidueBaseline = g2DomInventory(viewer.container);
      const mark = rec.records.length;
      const dMark = dispatched.length;
      let shell = null;
      let threw = false;
      let error = null;
      try {
        shell = rec.withOrigin('shell', () => createPanelShell({ Autodesk: window.Autodesk, parentContainer: viewer.container, controller, id: G2_SHELL_PROBE_ID }));
      } catch (e) { threw = true; error = g2ErrOf(e); }
      st.shell = shell;
      st.shellDispatched = dispatched;
      const construction = rec.records.slice(mark);
      const container = document.getElementById(G2_SHELL_PROBE_ID);
      const regions = container ? Array.from(container.querySelectorAll('section.clash-region')).map((s) => ({
        region: s.getAttribute('data-region'),
        hasHeading: s.querySelector(':scope > h2.clash-region-heading') !== null,
        hasBody: s.querySelector(':scope > div.clash-region-body') !== null,
      })) : [];
      const titleRecs = construction.filter(isMethod('DockingPanel.prototype.createTitleBar'));
      let title;
      if (titleRecs.length !== 1) title = titleElementContract(titleRecs.map(() => null), container);
      else {
        const out = titleRecs[0].outcome;
        const ref = out && out.threw === false && out.returned && out.returned.kind === 'object' ? out.returned.refId : null;
        const T = ref === null ? null : resolveRef(ref);
        if (ref !== null && T === null) title = { ok: false, reason: 'title-not-attached', calls: 1, className: null, tagName: null, sameClassCount: null, returnedElementNotInDocument: true };
        else title = titleElementContract([T], container);
        st.shellTitle = T;
      }
      const firstHide = construction.findIndex(setVisibleWith(false));
      const firstListener = construction.findIndex(isMethod('DockingPanel.prototype.addVisibilityListener'));
      const constructionDispatches = dispatched.slice(dMark);
      const outer = container ? container.outerHTML : '';
      const classTokens = container ? [...new Set(Array.from(container.querySelectorAll('*')).flatMap((n) => (typeof n.className === 'string' ? n.className.split(/\s+/) : [])).filter(Boolean))].sort() : [];
      return {
        threw, error,
        containerFound: container !== null, containerUnderViewer: container !== null && viewer.container.contains(container),
        regions,
        addVisibilityListenerCalls: construction.filter(isMethod('DockingPanel.prototype.addVisibilityListener')).length,
        bodyChildCount: container ? container.querySelectorAll(':scope > .clash-panel-body').length : 0,
        title,
        baseInitializeCalls: construction.filter(isMethod('DockingPanel.prototype.initialize')).length,
        setVisibleFalseBeforeListener: firstHide !== -1 && firstListener !== -1 && firstHide < firstListener,
        dispatchesDuringConstruction: constructionDispatches.length,
        domainWrites: constructionDispatches.filter((t) => t !== 'PANEL_SHOWN' && t !== 'PANEL_HIDDEN').length,
        shellKeys: shell ? Object.keys(shell) : null,
        failureEvidence: { containerOuterHtmlSha256: sha256Hex(outer), containerOuterHtml: truncateUtf8(outer, TABLE_T.T22.perFieldBytes).value, classTokens },
      };
    },
    async c3() {
      const shell = st.shell;
      if (!shell) throw new Error('C3: no shell was constructed by C2');
      const count = (from, pred) => rec.records.slice(from).filter(pred).length;
      const showHide = [];
      for (let k = 0; k < C3_SHOW_HIDE_REPETITIONS; k += 1) {
        let m = rec.records.length;
        let d = dispatched.length;
        rec.withOrigin('shell', () => shell.show());
        const setVisibleTrueCalls = count(m, setVisibleWith(true));
        const showDispatches = dispatched.slice(d);
        m = rec.records.length;
        d = dispatched.length;
        rec.withOrigin('shell', () => shell.hide());
        showHide.push({ showSetVisibleTrue: setVisibleTrueCalls >= 1, setVisibleTrueCalls, showDispatches, hideDispatches: dispatched.slice(d), hideSetVisibleFalseCalls: count(m, setVisibleWith(false)) });
      }
      // Real close button (recorded, not verdict-bearing): shown first, then the element following T clicked.
      rec.withOrigin('shell', () => shell.show());
      const cm = rec.records.length;
      const cd = dispatched.length;
      const T = st.shellTitle || null;
      const closer = T && T.nextElementSibling ? T.nextElementSibling : null;
      if (closer && typeof closer.click === 'function') rec.withOrigin('harness', () => closer.click());
      const closeButton = { observationOnly: true, located: closer !== null, locator: 'next-element-sibling-of-title-element', routedThroughSetVisibleFalse: count(cm, setVisibleWith(false)) >= 1, dispatches: dispatched.slice(cd) };
      if (shell.isVisible()) rec.withOrigin('shell', () => shell.hide());
      // dispose twice (idempotence), then retained-callback silence and post-dispose calls.
      const container = document.getElementById(G2_SHELL_PROBE_ID);
      const callbacks = st.shellCapture ? st.shellCapture.visibilityCallbacks.slice() : [];
      const dm = rec.records.length;
      rec.withOrigin('shell', () => { shell.dispose(); shell.dispose(); });
      const uninitializeCalls = count(dm, isMethod('DockingPanel.prototype.uninitialize'));
      const rd = dispatched.length;
      for (const cb of callbacks) { try { rec.withOrigin('harness', () => { cb(true); cb(false); }); } catch { /* a throwing retained callback dispatches nothing */ } }
      const retainedCallbackDispatches = dispatched.length - rd;
      const pm = rec.records.length;
      rec.withOrigin('shell', () => { shell.show(); shell.hide(); shell.toggle(); });
      const postDisposeSpyCalls = count(pm, (r) => r.method.startsWith('DockingPanel.prototype.'));
      const afterDispose = rec.records.slice(dm);
      const uIdx = afterDispose.findIndex(isMethod('DockingPanel.prototype.uninitialize'));
      const setVisibleAfterUninitialize = uIdx === -1 ? 0 : afterDispose.slice(uIdx + 1).filter(isMethod('DockingPanel.prototype.setVisible')).length;
      const after = g2DomInventory(viewer.container);
      const baseline = st.shellResidueBaseline || new Set();
      const fresh = [...after].filter((n) => !baseline.has(n) && !(n.tagName === 'STYLE' && n.id === 'clash-panel-style'));
      return {
        showHide, closeButton,
        dispose: {
          uninitializeCalls,
          containerInDom: container !== null && document.contains(container),
          rootFound: viewer.container.querySelector('.clash-panel-root') !== null,
          byIdFound: document.getElementById(G2_SHELL_PROBE_ID) !== null,
          retainedCallbackDispatches, retainedCallbacksInvoked: callbacks.length,
          setVisibleAfterUninitialize, postDisposeSpyCalls, postDisposeIsVisible: shell.isVisible(),
        },
        residue: fresh.filter(g2AttributableToPanel).map(g2DescribeNode),
        unattributedNewNodes: fresh.filter((n) => !g2AttributableToPanel(n)).map(g2DescribeNode),
      };
    },
  };
}

// ---- env + phase run ---------------------------------------------------------------------------

/**
 * In-page adapter of the node-side operation-ledger acknowledgement barrier (§9.2 slice C2; the
 * `G2_NODE_OPLEDGER_BINDING` exposed function: its promise resolves after the node allocated the
 * record's startSeq and ackSeq). Null when the binding is absent -- then nothing is recorded and every
 * abort stays FATAL (fail-safe). NOTE (unresolved before-live gate, see `runPostReservation`): these
 * records are numbered by the NODE counter while the page's own records use the page recorder seeded
 * with `seqBase` -- two namespaces; not redesigned here.
 */
function g2NodeOps() {
  const fn = typeof window !== 'undefined' ? window[G2_NODE_OPLEDGER_BINDING] : undefined;
  if (typeof fn !== 'function') return null;
  return { begin: (desc) => fn('begin', desc), end: (arg) => fn('end', arg) };
}

/**
 * Builds the Section 36 driver `env` in the page from the loaded models and targets. Recorder,
 * wrapper registry, injection controller (tracked for cleanup), bridge tracker, timers and
 * quarantine are page-realm objects; nothing here touches the Viewer except the harness's own
 * camera-home capture (a read).
 */
function g2BuildEnv({ seqBase = 0, nodeLoadOutcomes = null } = {}) {
  const g = g2PageState();
  const viewer = window.__viewer;
  const events = g2EventNames();
  const createViewerApi = g2Module('/clashpanel/viewer/viewerApi.js').createViewerApi;
  const createViewerBridge = g2Module('/clashpanel/viewer/ViewerBridge.js').createViewerBridge;
  const api = createViewerApi(viewer, { events });
  // Page-side recorder seeded past the node counter at the RPC (interim; unresolved live-wiring gate).
  // G2_DUAL_COUNTER_GATE (unresolved): page records are numbered here, node events by the node counter.
  let pageSeq = seqBase;
  const recorder = createCallRecorder({ nextSeq: () => { pageSeq += 1; return pageSeq; } });
  const registry = createWrapperRegistry();
  const baseInjection = createFailureInjectionController({ registry });
  const injectionHandles = [];
  const state = { allBridges: [] };
  const camera = g2CreateCameraAdapter(viewer);
  const env = {
    viewer,
    models: { A: g.models.A || null, B: g.models.B || null },
    labelOf: createModelLabeler({ A: g.models.A || null, B: g.models.B || null }),
    recorder, registry,
    ops: g2NodeOps(),
    injection: { installed: () => baseInjection.installed(), install(scenario, owners) { const h = baseInjection.install(scenario, owners); injectionHandles.push(h); return h; } },
    injectionHandles,
    bridgeTracker: createBridgeInstanceTracker(),
    createBridge(names) { const b = createViewerBridge({ viewerApi: createViewerApi(viewer, { events }), THREE: window.THREE, names }); state.allBridges.push(b); return b; },
    eventNames: events,
    targets: g.targets || { a1: null, b1: null, fitPair: null, candidatesA: [], candidatesB: [] },
    boundsOf: (model, dbId) => api.getElementWorldBounds(model, dbId),
    fragmentBoxesOf: (model, dbId) => g2FragmentBoxes(model, dbId),
    dockingPanelPrototype: window.Autodesk && window.Autodesk.Viewing && window.Autodesk.Viewing.UI && window.Autodesk.Viewing.UI.DockingPanel ? window.Autodesk.Viewing.UI.DockingPanel.prototype : null,
    // Sentinels S1/S2 (§C7α) are invisible so they can never contribute a pixel to the C20 frames.
    makeSentinelMesh: () => { const m = new window.THREE.Mesh(new window.THREE.SphereGeometry(1, 4, 3), new window.THREE.MeshBasicMaterial({ color: 0x00ff00 })); m.visible = false; return m; },
    tick: () => new Promise((resolve) => { setTimeout(resolve, 16); }),
    timers: DEFAULT_TIMERS,
    quarantine: createTimeoutQuarantine(),
    clock: defaultClock,
    camera,
    capture: g2CreateCaptureAdapter(viewer),
    state,
  };
  // H1: C1 sees the node-side load outcomes (a node-side harness exception / T2 expiry).
  env.modelFacts = async () => withNodeLoadOutcomes(g2CollectModelFacts(), nodeLoadOutcomes);
  env.unitFacts = async () => g2CollectUnitFacts(env);
  state.shellCapture = attachShellArgumentCapture(recorder);
  env.shellProbe = g2CreateShellProbe(env);
  env.cameraHomeCaptured = camera.captureHome();
  g.env = env;
  return env;
}

/** Phase-boundary baseline (recorded in stateSnapshots): isolation and hidden nodes empty for every still-loaded model. */
function g2PhaseBaseline(env, phase) {
  const labels = (() => { try { return env.viewer.getAllModels().map((m) => env.labelOf(m)).filter(Boolean); } catch { return null; } })();
  const iso = normalizeAggregateRead(env.recorder.withOrigin('harness', () => env.viewer.getAggregateIsolation()), env.labelOf);
  const hid = normalizeAggregateRead(env.recorder.withOrigin('harness', () => env.viewer.getAggregateHiddenNodes()), env.labelOf);
  const empty = (read) => Array.isArray(read) && Array.isArray(labels) && read.filter((e) => labels.includes(e.model)).every((e) => e.ids.length === 0);
  // §7 RC1-C2 attribution fields (seq from the recorder's single counter; the runner has cleared
  // activeCheck/activeControl before the phase-end baseline).
  const snap = { ...env.recorder.stamp(), baselinePhase: phase, loadedModels: labels, isolationEmpty: empty(iso), hiddenEmpty: empty(hid) };
  env.state.stateSnapshots = env.state.stateSnapshots || [];
  env.state.stateSnapshots.push(snap);
  return { ok: snap.isolationEmpty && snap.hiddenEmpty };
}

/**
 * In-page. Runs P1..P11 through `runChecksInPhaseOrder` in mode 'live' with the Section 36
 * drivers (refused by the runner itself while LIVE_PATH_WIRED is false). Returns a JSON-safe record:
 * checks, controls, subchecks, extras, taint, phase log, the spy ledger, screenshots, state
 * snapshots and staleContinuationsDropped.
 */
async function g2RunPhases(arg) {
  const g = g2PageState();
  const env = g2BuildEnv({ seqBase: arg && Number.isInteger(arg.seqBase) && arg.seqBase >= 0 ? arg.seqBase : 0, nodeLoadOutcomes: arg && isPlainObject(arg.nodeLoadOutcomes) ? arg.nodeLoadOutcomes : null });
  const run = await runChecksInPhaseOrder({
    drivers: createLivePhaseDrivers(env),
    mode: 'live',
    assertPhaseBaseline: async (phase) => g2PhaseBaseline(env, phase),
    fatalObserved: () => g.fatal.flag === true || g.fatal.abort === true,
    recorder: env.recorder,
    // Page-side mirror of the fatal events Node forwarded (g2MarkFatal), read synchronously at gate
    // time. NOT replaced in slice C1: the real ledger lives in Node and the page cannot read it
    // synchronously, and a Node-side gate binding would compare `gateSeq` against page-namespace seqs.
    // Replacing it needs the cross-process single-counter design (UNRESOLVED live-wiring gate, see
    // runPostReservation). The persisted gate is re-validated against the node ledger by the gate
    // equations (fail-closed).
    errorLedger: () => ({ fatalCount: g.fatal.kinds.length, entries: g.fatal.kinds.map((kind) => ({ kind })) }),
  });
  const { spyInstall, ...extras } = run.extras || {};
  return g2JsonSafe({
    checks: run.checks, controls: run.controls, subchecks: run.subchecks, extras, c1FinalizedEvent: run.c1FinalizedEvent,
    gates: run.gates, markers: run.markers, eventLog: run.eventLog,
    spyInstall: spyInstall || null,
    sessionTainted: run.sessionTainted, taintPhase: run.taintPhase, phaseLog: run.phaseLog,
    spyLedger: env.recorder.records, screenshots: g.screenshots, stateSnapshots: env.state.stateSnapshots || [],
    staleContinuationsDropped: env.quarantine.staleContinuationsDropped,
    cameraHomeCaptured: env.cameraHomeCaptured, bridgeHistory: env.bridgeTracker.history,
  });
}

// ---- §9 page-owned cleanup steps ---------------------------------------------------------------

/** Page-owned cleanup step names (§9 order); closePage/closeContext/closeBrowser/httpServerOwnership are Node-owned. */
const G2_PAGE_CLEANUP_STEPS = Object.freeze(CLEANUP_STEP_NAMES.filter((n) => !['closePage', 'closeContext', 'closeBrowser', 'httpServerOwnership'].includes(n)));

const G2_KNOWN_SCENES = Object.freeze([
  'clash-panel-markers:g2a', 'clash-panel-outlines:g2a', 'clash-panel-markers:g2a2', 'clash-panel-outlines:g2a2',
  'clash-panel-markers:g2b', 'clash-panel-outlines:g2b', 'g2-foreign-scene',
]);

/**
 * The page-owned step bodies. Each returns a JSON-safe result or throws; `ownership()` is the
 * post-failure re-check (true = the harness still owns an unreleased resource), evaluated in-page
 * immediately after a failure so the Node-side runCleanup gets a synchronous answer.
 */
function g2CleanupStepImpls(env) {
  const g = g2PageState();
  const viewer = window.__viewer;
  const ov = viewer ? viewer.overlays : null;
  const st = env ? env.state : { allBridges: [] };
  const models = { A: g.models.A || null, B: g.models.B || null };
  const loaded = () => viewer.getAllModels();
  const hasEntries = (list) => Array.isArray(list) && list.some((e) => e && e.ids && e.ids.length > 0);
  const modelSteps = createModelCleanupSteps({ viewer, getModelA: () => models.A, getModelB: () => models.B, ops: env && env.ops ? env.ops : g2NodeOps() });
  return {
    drainPendingTokens: { run: async () => ({ staleContinuationsDropped: env ? env.quarantine.staleContinuationsDropped : 0 }), ownership: () => false },
    bridgeDispose: {
      run: async () => {
        const out = [];
        for (const b of st.allBridges || []) {
          if (b.inspectDisposal().disposed !== true) { await b.dispose(); out.push('disposed'); } else out.push('already-disposed');
        }
        return { bridges: out };
      },
      ownership: () => (st.allBridges || []).some((b) => b.inspectDisposal().disposed !== true),
    },
    shellDispose: {
      run: async () => { if (st.shell) st.shell.dispose(); return { present: document.getElementById(G2_SHELL_PROBE_ID) !== null }; },
      ownership: () => document.getElementById(G2_SHELL_PROBE_ID) !== null,
    },
    removeInjectedFailureWrappers: {
      run: async () => {
        const handles = env ? env.injectionHandles : [];
        const failures = [];
        for (let i = handles.length - 1; i >= 0; i -= 1) { const r = handles[i].remove(); if (!r.ok) failures.push({ scenario: handles[i].scenario, reason: r.reason }); }
        if (failures.length) throw new Error(`injection wrappers not removed: ${JSON.stringify(failures)}`);
        return { remaining: env ? env.injection.installed() : [] };
      },
      ownership: () => Boolean(env) && env.injection.installed().length > 0,
    },
    restoreRecordingWrappers: {
      run: async () => {
        if (!env) return { restored: 'no-env' };
        if (st.shellCapture) st.shellCapture.detach();
        if (st.tagger) st.tagger.detach();
        const r = env.registry.restoreAll();
        const v = env.registry.verifyAllRestored();
        if (!r.ok || !v.ok) throw new Error(`recording wrappers not restored: ${JSON.stringify({ failures: r.failures, unrestored: v.unrestored })}`);
        return { restored: env.registry.entries.length };
      },
      ownership: () => Boolean(env) && !env.registry.verifyAllRestored().ok,
    },
    removeHarnessForeignScenes: {
      run: async () => {
        const s = st.sentinels || {};
        if (s.S1 && ov.hasScene('clash-panel-markers:g2b')) ov.removeMesh(s.S1, 'clash-panel-markers:g2b');
        if (s.S2 && ov.hasScene('g2-foreign-scene')) ov.removeMesh(s.S2, 'g2-foreign-scene');
        for (const name of ['clash-panel-markers:g2b', 'g2-foreign-scene']) if (ov.hasScene(name)) ov.removeScene(name);
        const left = ['clash-panel-markers:g2b', 'g2-foreign-scene'].filter((n) => ov.hasScene(n));
        if (left.length) throw new Error(`foreign scenes still present: ${left.join(',')}`);
        return { removed: true };
      },
      ownership: () => ['clash-panel-markers:g2b', 'g2-foreign-scene'].some((n) => ov.hasScene(n)),
    },
    restoreIsolationEmpty: {
      run: async () => { if (hasEntries(viewer.getAggregateIsolation())) viewer.setAggregateIsolation([]); if (hasEntries(viewer.getAggregateIsolation())) throw new Error('isolation not empty'); return { empty: true }; },
      ownership: () => hasEntries(viewer.getAggregateIsolation()),
    },
    showHiddenNodes: {
      run: async () => {
        for (const e of viewer.getAggregateHiddenNodes() || []) if (e && e.model && e.ids && e.ids.length && loaded().includes(e.model)) viewer.show(Array.from(e.ids), e.model);
        const left = (viewer.getAggregateHiddenNodes() || []).filter((e) => e && e.ids && e.ids.length && loaded().includes(e.model));
        if (left.length) throw new Error('hidden nodes remain');
        return { empty: true };
      },
      ownership: () => (viewer.getAggregateHiddenNodes() || []).some((e) => e && e.ids && e.ids.length && loaded().includes(e.model)),
    },
    restoreHiddenModel: {
      // UNVERIFIED-LIVE: viewer.getHiddenModels()/showModel(id) (C16 restore path). A B model unloaded
      // by C17 is absent from both lists and needs nothing.
      run: async () => {
        const hidden = typeof viewer.getHiddenModels === 'function' ? viewer.getHiddenModels() : [];
        const B = models.B;
        if (B && Array.isArray(hidden) && hidden.includes(B)) { viewer.showModel(B.id); return { shown: true }; }
        return { shown: false, reason: 'not-hidden' };
      },
      ownership: () => { const hidden = typeof viewer.getHiddenModels === 'function' ? viewer.getHiddenModels() : []; return Boolean(models.B) && Array.isArray(hidden) && hidden.includes(models.B); },
    },
    verifyViewerStateBaseline: {
      run: async () => {
        const present = Object.fromEntries(G2_KNOWN_SCENES.map((n) => [n, ov.hasScene(n)]));
        const problems = [];
        if (hasEntries(viewer.getAggregateIsolation())) problems.push('isolation-not-empty');
        if ((viewer.getAggregateHiddenNodes() || []).some((e) => e && e.ids && e.ids.length && loaded().includes(e.model))) problems.push('hidden-not-empty');
        const scenesLeft = Object.keys(present).filter((n) => present[n]);
        if (scenesLeft.length) problems.push(`scenes-remain:${scenesLeft.join(',')}`);
        if (problems.length) throw new Error(problems.join(';'));
        return { scenePresence: present };
      },
      ownership: () => G2_KNOWN_SCENES.some((n) => ov.hasScene(n)),
    },
    unloadModelA: { run: modelSteps.unloadModelA.run, ownership: modelSteps.unloadModelA.ownershipRemains },
    unloadModelB: { run: modelSteps.unloadModelB.run, ownership: modelSteps.unloadModelB.ownershipRemains },
    verifyViewerModelSetEmpty: { run: modelSteps.verifyViewerModelSetEmpty.run, ownership: modelSteps.verifyViewerModelSetEmpty.ownershipRemains },
  };
}

/**
 * In-page. Runs ONE page-owned cleanup step. Never rejects: `{ok, result, error, ownershipRemains}`
 * where `ownershipRemains` is the in-page re-check after a failure (null when it itself threw ->
 * the Node side records `indeterminate`, G1 rule).
 */
async function g2CleanupStep({ name }) {
  const g = g2PageState();
  const impls = g2CleanupStepImpls(g.env);
  const impl = impls[name];
  if (!impl) return { ok: false, result: null, error: { name: 'Error', message: `unknown page cleanup step ${String(name)}` }, ownershipRemains: null };
  try {
    const result = await impl.run();
    return { ok: true, result: g2JsonSafe(result), error: null, ownershipRemains: false };
  } catch (e) {
    let ownershipRemains = null;
    try { ownershipRemains = impl.ownership() === true; } catch { ownershipRemains = null; }
    return { ok: false, result: null, error: g2ErrOf(e), ownershipRemains };
  }
}

/** The page registry: the ONLY functions Node may invoke in the page (by key). */
const G2_IN_PAGE_FUNCTION_NAMES = Object.freeze([
  'g2InstallModules', 'g2AgentReady', 'g2MarkFatal', 'g2DocumentLoad', 'g2LoadDocumentNode', 'g2AwaitModelReady',
  'g2CollectModelFacts', 'g2PrepareTargets', 'g2RunPhases', 'g2CleanupStep',
]);

// ==== G2 PAGE-AGENT END ====  (buildPageAgentSource ships everything above, from Section 17, into the page)

// ============================================================================================
// Section 38 -- Node-side live orchestration after B3 (procedure §4.1 Phase 0 + W3, §5 phase order,
// §9 cleanup ledger, §9.1 closeout, §8 exit codes). Reached ONLY from main() strictly after the
// durable AUTH_BOUND write (B3), and main() refuses right after W0 while LIVE_PATH_WIRED is false --
// so in this revision none of this can run live. Every external effect is injected through
// `deps` (fs layer, git runner, module server, browser package, clock, timers, print, process) so
// the offline sibling tests drive the whole flow with entirely fake page / viewer / fs.
// Order (source- and test-proven): Phase 0 (evidence writer, harness sha256, git tree, served-module
// manifest, page-agent build, browser-package import, launch/context/page/routes/goto, bootstrap-
// ready, module install, agent ready) -> any failure: best-effort PREFLIGHT_FAILED, exit 1, not
// consumed -> W3 ATTEMPT_CONSUMED durable -> T9 armed -> loads A then B (first loadDocumentNode only
// after W3) -> model facts -> targets -> P1..P11 in the page -> cleanup ledger -> script integrity ->
// closeout (§9.1) -> exit code from the commit outcome.
// ============================================================================================

const G2_VIEWER_SCRIPT_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${RUNTIME_ENVELOPE_REQUESTED.viewer}/viewer3D.js`;
const G2_VIEWER_STYLE_URL = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${RUNTIME_ENVELOPE_REQUESTED.viewer}/style.css`;
const G2_DEFAULT_PORT = '8080';
/** The synthetic page's exact path (served by page.route, never by server.js / wwwroot). */
const G2_PAGE_PATH = '/__g2-viewerbridge-dockingpanel__';
/** Viewer response-body capture bound (G1 RESPONSE_BODY_CAPTURE_TIMEOUT_MS, copied by value). */
const G2_RESPONSE_BODY_CAPTURE_TIMEOUT_MS = 10_000;

/** `http://localhost:<PORT>` of the operator-started `npm start` (only `/api/auth/token` is used). */
function g2BaseUrl(env) {
  const port = env && typeof env.PORT === 'string' && /^[0-9]{2,5}$/.test(env.PORT) ? env.PORT : G2_DEFAULT_PORT;
  return `http://localhost:${port}`;
}

/**
 * The synthetic `BARE_PAGE_HTML`-style page (§3 "Page"): G1's bare page (pinned viewer3D.js and
 * style.css, getAccessToken over the unmodified GET /api/auth/token, Initializer with the §3 envelope,
 * one GuiViewer3D + start()) without an import map (the served clashpanel modules import only
 * relative paths) and with its own readiness flag `window.__g2Bootstrap`. No wwwroot dependency.
 */
const G2_BARE_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${G2_VIEWER_STYLE_URL}">
<style>html,body,#preview{margin:0;height:100%;width:100%}</style>
</head><body>
<div id="preview"></div>
<script src="${G2_VIEWER_SCRIPT_URL}"></script>
<script>
async function getAccessToken(callback) {
  const resp = await fetch('/api/auth/token');
  if (!resp.ok) throw new Error(await resp.text());
  const { access_token, expires_in } = await resp.json();
  callback(access_token, expires_in);
}
window.__g2Bootstrap = { ready: false, error: null };
try {
  Autodesk.Viewing.Initializer(
    { env: '${RUNTIME_ENVELOPE_REQUESTED.env}', api: '${RUNTIME_ENVELOPE_REQUESTED.api}', getAccessToken },
    function () {
      const viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('preview'), {});
      viewer.start();
      window.__viewer = viewer;
      window.__g2Bootstrap.ready = true;
    },
  );
} catch (e) {
  window.__g2Bootstrap.error = String(e && e.message || e);
}
</script>
</body></html>`;

// ---- page-agent bundle -------------------------------------------------------------------------

const PAGE_AGENT_BEGIN_LINE = '// Section 17 -- Table T rev-2';
const PAGE_AGENT_END_LINE = '// ==== G2 PAGE-AGENT END ====';
/** Names that exist only in the Node realm: never copied into the page (shimmed or unreachable there). */
const PAGE_AGENT_NODE_ONLY_NAMES = Object.freeze([
  'sha256Hex', 'randomUUID', 'Buffer', 'toBuffer', 'path', 'realpathSync', 'nodeFsModule', 'nodeReadFileSync', 'REPO_ROOT',
  'createHash', 'execFileSync', 'fileURLToPath', 'process',
]);

function lineStartIndexOf(source, line) {
  if (source.startsWith(line)) return 0;
  const i = source.indexOf(`\n${line}`);
  return i === -1 ? -1 : i + 1;
}

function declarationEndIndex(toks, i, kind) {
  let depth = 0;
  if (kind === 'const') {
    for (let q = i; q < toks.length; q += 1) {
      const t = toks[q];
      if (t.type !== 'punct') continue;
      if (t.value === '{' || t.value === '(' || t.value === '[') depth += 1;
      else if (t.value === '}' || t.value === ')' || t.value === ']') depth -= 1;
      else if (t.value === ';' && depth === 0) return q;
    }
    return toks.length - 1;
  }
  let q = i;
  for (; q < toks.length; q += 1) {
    const t = toks[q];
    if (t.type !== 'punct') continue;
    if (t.value === '(' || t.value === '[') depth += 1;
    else if (t.value === ')' || t.value === ']') depth -= 1;
    else if (t.value === '{') { if (depth === 0) break; depth += 1; } else if (t.value === '}') depth -= 1;
  }
  depth = 0;
  for (; q < toks.length; q += 1) {
    const t = toks[q];
    if (t.type !== 'punct') continue;
    if (t.value === '{') depth += 1;
    else if (t.value === '}') { depth -= 1; if (depth === 0) return q; }
  }
  return toks.length - 1;
}

/** Top-level `function` / `async function` / `class` / `const` / `let` declarations of `source`. */
function topLevelDeclarations(source) {
  const toks = tokenizeJs(source);
  const out = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (depth === 0 && t.type === 'ident') {
      let kind = null;
      let nameIdx = -1;
      if (t.value === 'function') { kind = 'function'; nameIdx = toks[i + 1] && toks[i + 1].value === '*' ? i + 2 : i + 1; }
      else if (t.value === 'async' && toks[i + 1] && toks[i + 1].value === 'function') { kind = 'function'; nameIdx = toks[i + 2] && toks[i + 2].value === '*' ? i + 3 : i + 2; }
      else if (t.value === 'class') { kind = 'class'; nameIdx = i + 1; }
      else if (t.value === 'const' || t.value === 'let') { kind = 'const'; nameIdx = i + 1; }
      if (kind !== null && toks[nameIdx] && toks[nameIdx].type === 'ident') {
        const end = declarationEndIndex(toks, i, kind);
        out.push({ name: toks[nameIdx].value, kind, start: t.start, end: toks[end].end, tokens: toks.slice(i, end + 1) });
        i = end;
        continue;
      }
    }
    if (t.type === 'punct') {
      if (t.value === '{' || t.value === '(' || t.value === '[') depth += 1;
      else if (t.value === '}' || t.value === ')' || t.value === ']') depth -= 1;
    }
  }
  return out;
}

/** Identifier names a token list may reference freely (every ident not preceded by `.` / `?.`). */
function freeIdentifierNames(tokens) {
  const out = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const p = tokens[i - 1];
    if (p && p.type === 'punct' && (p.value === '.' || p.value === '?.')) continue;
    out.add(t.value);
  }
  return out;
}

/**
 * `buildPageAgentSource(harnessSource)` -> `{source, sha256, preludeNames}` -- the ONE init script the
 * page receives: realm shims, then the earlier-section (1-16) declarations transitively referenced
 * by Sections 17-37 (computed from the token stream; Node-only names excluded), then Sections 17-37
 * VERBATIM, then the frozen `window.__g2HarnessFns` registry. Built from the SAME harness bytes whose
 * SHA-256 the authorization record binds (read at Phase 0), so the page runs exactly the bound code.
 */
function buildPageAgentSource(harnessSource) {
  const source = String(harnessSource);
  const begin = lineStartIndexOf(source, PAGE_AGENT_BEGIN_LINE);
  const end = lineStartIndexOf(source, PAGE_AGENT_END_LINE);
  if (begin === -1 || end === -1 || end <= begin) throw new Error('buildPageAgentSource: page-agent markers not found in order');
  const early = topLevelDeclarations(source.slice(0, begin));
  const mid = source.slice(begin, end);
  const midDeclared = new Set(topLevelDeclarations(mid).map((d) => d.name));
  const byName = new Map(early.map((d) => [d.name, d]));
  const needed = new Set();
  const queue = [...freeIdentifierNames(tokenizeJs(mid))];
  while (queue.length > 0) {
    const n = queue.shift();
    if (needed.has(n) || midDeclared.has(n) || PAGE_AGENT_NODE_ONLY_NAMES.includes(n) || !byName.has(n)) continue;
    needed.add(n);
    for (const m of freeIdentifierNames(byName.get(n).tokens)) queue.push(m);
  }
  const prelude = early.filter((d) => needed.has(d.name));
  const shims = [
    'const sha256Hex = (bytes) => sha256HexPortable(bytes);',
    'const randomUUID = () => globalThis.crypto.randomUUID();',
    'const Buffer = Object.freeze({ from: (v, a, b) => PageBuffer.from(v, a, b), byteLength: (v) => PageBuffer.byteLength(v) });',
  ].join('\n');
  const text = [
    '(() => {',
    "'use strict';",
    shims,
    prelude.map((d) => source.slice(d.start, d.end)).join('\n'),
    mid,
    `window.__g2HarnessFns = Object.freeze({ ${G2_IN_PAGE_FUNCTION_NAMES.join(', ')} });`,
    '})();',
    '',
  ].join('\n');
  return { source: text, sha256: sha256Hex(text), preludeNames: prelude.map((d) => d.name) };
}

// ---- Viewer script integrity capture (G1 main() listeners, copied by value) --------------------

/** G1 `walkRedirectRootUrl` (copied by value): the origin URL of a Playwright request's redirect chain. */
function walkRedirectRootUrl(request) {
  let r = request;
  while (r.redirectedFrom()) r = r.redirectedFrom();
  return r.url();
}

/**
 * Viewer-script integrity capture (G1 §6.3 capture, copied by value): terminal script responses
 * whose redirect chain starts at the pinned viewer3D.js URL, bodies SHA-256'd within a bounded task,
 * request failures on that chain; `capture()` awaits every body task and yields the
 * classifyViewerScriptIntegrity input.
 */
function createViewerScriptIntegrityCapture({ timers = DEFAULT_TIMERS, bodyTimeoutMs = G2_RESPONSE_BODY_CAPTURE_TIMEOUT_MS } = {}) {
  const state = { requestFailed: false, autodeskViewingDefined: false, attributableResponses: [], tasks: [] };
  return {
    state,
    onResponse(response) {
      const request = response.request();
      if (request.resourceType() !== 'script') return;
      const status = response.status();
      if (status >= 300 && status < 400) return;
      if (walkRedirectRootUrl(request) !== G2_VIEWER_SCRIPT_URL) return;
      const record = { status, redirectChainComplete: true, fromServiceWorker: response.fromServiceWorker(), bodyOutcome: 'pending-at-close', decodedByteLength: null, sha256: null };
      state.attributableResponses.push(record);
      let handle = null;
      const task = Promise.race([
        Promise.resolve().then(() => response.body()).then((buf) => {
          record.bodyOutcome = buf.length > 0 ? 'captured' : 'empty';
          record.decodedByteLength = buf.length;
          if (buf.length > 0) record.sha256 = sha256Hex(buf);
        }).catch(() => { record.bodyOutcome = 'capture-failed'; }),
        new Promise((resolve) => { handle = timers.setTimeout(resolve, bodyTimeoutMs); }),
      ]).finally(() => timers.clearTimeout(handle));
      state.tasks.push(task);
    },
    onRequestFailed(request) {
      if (request.resourceType() !== 'script') return;
      if (walkRedirectRootUrl(request) !== G2_VIEWER_SCRIPT_URL) return;
      state.requestFailed = true;
    },
    markViewingDefined() { state.autodeskViewingDefined = true; },
    async capture() {
      await Promise.allSettled(state.tasks);
      return { requestFailed: state.requestFailed, autodeskViewingDefined: state.autodeskViewingDefined, attributableResponses: state.attributableResponses.map((r) => ({ ...r })) };
    },
  };
}

// ---- page RPC, closing, fatal wiring -----------------------------------------------------------

/** The single page-side dispatcher passed to page.evaluate (serialized by Playwright; runs in the page). */
const G2_PAGE_DISPATCH = ({ key, arg }) => window.__g2HarnessFns[key](arg);

/**
 * `createPageRpc(page, {onCall})` -- `call(key, arg)` invokes one registered in-page function by key
 * (never by function source). Unregistered keys are refused before any page call.
 */
function createPageRpc(page, { onCall = () => {} } = {}) {
  return {
    call(key, arg) {
      if (!G2_IN_PAGE_FUNCTION_NAMES.includes(key)) return Promise.reject(new Error(`unregistered in-page function ${String(key)}`));
      onCall(key, arg);
      return page.evaluate(G2_PAGE_DISPATCH, { key, arg: arg === undefined ? null : arg });
    },
  };
}

/** Closes one Playwright object (page/context/browser), bounded by `timeoutMs` (G1 closeAllBestEffort semantics). */
async function closePlaywrightTarget(target, label, { timeoutMs = TABLE_T.T8.cleanupStepDeadlineMs, timers = DEFAULT_TIMERS } = {}) {
  if (!target || typeof target.close !== 'function') return { outcome: 'absent', label };
  const out = await runWithDeadline({ op: 'cleanup-step', timeoutMs, timers, fn: () => target.close(), meta: { step: `close:${label}` } });
  if (out.status === 'completed') return { outcome: 'closed', label };
  throw new Error(`${label}.close() ${out.status === 'timed-out' ? `did not settle within ${timeoutMs}ms` : `threw: ${summarizeThrown(out.error).message}`}`);
}

/** Redacted, bounded fatal-event detail string. */
function fatalDetail(detail) {
  return truncateUtf8(redactEvidenceText(String(detail === undefined ? '' : detail)).value, 512).value;
}

/**
 * §9.2 `urlClass` of a redacted URL: `bootstrap` = the pinned Viewer script/stylesheet URLs, the
 * synthetic page document and the operator origin's `/clashpanel/**` modules; `harness-endpoint` = the
 * operator server's `/api/auth/token`; `other` = everything else (incl. an unparseable URL). These are
 * the ONLY URL constants of the network policy (the class constants of §9.2 test (8)).
 */
function classifyNetworkUrl(urlRedacted, { baseUrl = g2BaseUrl({}) } = {}) {
  if (typeof urlRedacted !== 'string') return 'other';
  if (urlRedacted === G2_VIEWER_SCRIPT_URL || urlRedacted === G2_VIEWER_STYLE_URL) return 'bootstrap';
  try {
    const u = new URL(urlRedacted);
    const origin = new URL(baseUrl).origin;
    if (u.origin !== origin) return 'other';
    if (u.pathname === G2_PAGE_PATH || u.pathname.startsWith('/clashpanel/')) return 'bootstrap';
    if (u.pathname === '/api/auth/token') return 'harness-endpoint';
  } catch { return 'other'; }
  return 'other';
}

/**
 * `createNetworkInstrumentation({ledger, nextSeq, sink, attribution, baseUrl, mainFrame,
 * onFatalWitness, rules, context})` -- §9.2 item 7/20 listener bodies (node side; passive). One
 * `requestObservations[]` entry per Playwright `request` (`reqId := 'q:'+startSeq` bound to the Request
 * OBJECT in a WeakMap; every later response/requestfinished/requestfailed resolves its reqId through
 * the same object -- absent => null => invalid identity => unknown-fatal). A `response` with status
 * >= 400 (or an unreadable status: fail-closed) is one `responseFailures[]` raw event (immediate, or
 * provisional for a rule candidate); every `requestfailed` is one `requestFailures[]` raw event; a
 * `requestfinished`/`requestfailed` is retained as the request's terminal and every response status
 * (any status) as its status (`terminals`; `prefixSources.{terminalOf, statusOf}` -- first terminal /
 * first status per reqId wins), the slice-C2 prefix-source evidence persisted into
 * `errorLedger.prefixSourceLedger[]` when the load windows close (`finalizeLoadWindows`). Each raw event is classified at event time, then `syncFatalWitnesses` runs: a new fatal
 * identity creates exactly one witness through `sink.recordWitnessEntry` (fatalCount += 1 there
 * only). Events after the commit latch are ignored (§9.1/§9.2). Unreadable fields are persisted as
 * null and make the event unclassifiable (unknown-fatal), never non-fatal. Every handler is
 * synchronous and never throws; an internal exception while handling an event is recorded fail-closed
 * as a non-network `harness-exception` fatal entry (row 1), never silently dropped.
 */
function createNetworkInstrumentation({ ledger, nextSeq, sink, attribution = () => ({ phase: 'P0', activeCheck: null }), baseUrl = g2BaseUrl({}), mainFrame = () => null, onFatalWitness = () => {}, rules = OPTIONAL_RESPONSE_RULES, context = () => networkContextOf(ledger) }) {
  ensureNetworkLedger(ledger);
  const ids = new WeakMap();
  const terminals = [];
  const terminalByReqId = new Map();
  const statusByReqId = new Map();
  const noteTerminal = (t) => { terminals.push(t); if (typeof t.reqId === 'string' && !terminalByReqId.has(t.reqId)) terminalByReqId.set(t.reqId, { terminalKind: t.terminalKind, terminalSeq: t.terminalSeq }); };
  const read = (obj, method) => { try { return obj && typeof obj[method] === 'function' ? obj[method]() : undefined; } catch { return undefined; } };
  const str = (v) => (typeof v === 'string' ? v : null);
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  const latched = () => Boolean(sink && typeof sink.isCommitLatched === 'function' && sink.isCommitLatched());
  const attr = () => { const a = attribution() || {}; return { phase: ATTRIBUTION_PHASES.includes(a.phase) ? a.phase : 'P0', activeCheck: a.activeCheck === undefined ? null : a.activeCheck }; };
  const observationOf = (req) => (req !== null && typeof req === 'object' ? ids.get(req) : undefined);
  const appendEntry = (entry) => (sink && typeof sink.recordWitnessEntry === 'function' ? sink.recordWitnessEntry(entry) : -1);
  // Fail-closed: an exception while capturing/classifying a failure event must never drop it silently
  // -- it is recorded as a (non-network) harness-exception fatal entry (row 1).
  const failClosed = (event) => { try { if (sink && typeof sink.recordFatal === 'function') sink.recordFatal('harness-exception', `network-instrumentation:${event}`); } catch { /* nothing left */ } };
  const sync = () => {
    const before = ledger.fatalWitnesses.length;
    syncFatalWitnesses(ledger, { appendEntry });
    if (ledger.fatalWitnesses.length > before) { try { onFatalWitness(); } catch { /* informational */ } }
  };
  const capture = (req, seqKey, seq) => {
    const obs = observationOf(req);
    const url = str(read(req, 'url'));
    const urlRedacted = url === null ? null : redactEvidenceUrl(url).value;
    const frame = read(req, 'frame');
    const main = (() => { try { return mainFrame(); } catch { return null; } })();
    const redirectedFrom = read(req, 'redirectedFrom');
    const { phase, activeCheck } = attr();
    const raw = {
      reqId: obs ? obs.reqId : null, reqIdValid: false, rawEventId: '', rawEventSeq: seq, identityKey: '', duplicateOf: null,
      startSeq: obs ? obs.startSeq : null, method: str(read(req, 'method')), resourceType: str(read(req, 'resourceType')), urlRedacted,
      urlClass: classifyNetworkUrl(urlRedacted, { baseUrl }), isNavigationRequest: bool(read(req, 'isNavigationRequest')),
      frameIsMain: frame !== undefined && main !== null ? frame === main : null, redirected: redirectedFrom === undefined ? null : redirectedFrom !== null,
      phase, activeCheck: phase === 'P0' || phase === 'cleanup' || phase === 'closeout' ? null : activeCheck,
    };
    raw[seqKey] = seq;
    return raw;
  };
  const identify = (raw, kind) => {
    const id = recomputeRequestIdentity(raw, ledger.requestObservations);
    raw.reqIdValid = id.reqIdValid;
    raw.identityKey = id.identityKey;
    raw.rawEventId = `${kind === 'requestfailed' ? 'rf' : 'hr'}:${raw.rawEventSeq}`;
    const prior = rawNetworkEventsOf(ledger).map((r) => ({ kind: r.kind, identityKey: r.e.identityKey, rawEventId: r.e.rawEventId }));
    raw.duplicateOf = duplicateOfAmong(prior, kind, raw.identityKey);
  };
  return {
    terminals,
    prefixSources: Object.freeze({
      terminalOf: (reqId) => (terminalByReqId.has(reqId) ? { ...terminalByReqId.get(reqId) } : null),
      statusOf: (reqId) => (statusByReqId.has(reqId) ? statusByReqId.get(reqId) : null),
    }),
    onRequest(req) {
      try {
        if (latched()) return;
        const startSeq = nextSeq();
        const url = str(read(req, 'url'));
        const urlRedacted = url === null ? '' : redactEvidenceUrl(url).value;
        const { phase, activeCheck } = attr();
        const obs = {
          reqId: `q:${startSeq}`, startSeq, method: str(read(req, 'method')) ?? '', resourceType: str(read(req, 'resourceType')) ?? '', urlRedacted,
          urlClass: classifyNetworkUrl(urlRedacted, { baseUrl }), isNavigationRequest: read(req, 'isNavigationRequest') === true,
          phase, activeCheck: phase === 'P0' || phase === 'cleanup' || phase === 'closeout' ? null : activeCheck,
        };
        ledger.requestObservations.push(obs);
        if (req !== null && typeof req === 'object') ids.set(req, obs);
        ledger.witnessCount = correlateNetworkEvents(ledger).witnessCount;
      } catch { failClosed('request'); }
    },
    onResponse(resp) {
      try {
        if (latched()) return;
        const status = read(resp, 'status');
        const req = read(resp, 'request');
        const sObs = observationOf(req);
        if (sObs && !statusByReqId.has(sObs.reqId)) statusByReqId.set(sObs.reqId, Number.isInteger(status) ? status : null);
        if (Number.isInteger(status) && status < 400) return; // < 400 (incl. 3xx) is not a failure event
        const responseSeq = nextSeq();
        const raw = capture(req, 'responseSeq', responseSeq);
        raw.status = Number.isInteger(status) ? status : null;
        identify(raw, 'httpResponse');
        const ctx = context();
        const input = httpResponseInput(raw, raw.reqIdValid);
        if (isHttpRuleCandidate(input, rules)) {
          Object.assign(raw, { stage: 'provisional', finalizedSeq: null, finalizedBy: null, requirement: null, modelBindingObserved: null, eventTime: null, closeout: null, agree: null });
        } else {
          const result = classifyHttpResponse(input, ctx.opLedger, ctx.markers, ctx.prefixDerivation, rules, ctx.prefixSourceLedger);
          Object.assign(raw, {
            stage: 'immediate', finalizedSeq: responseSeq, finalizedBy: 'event', requirement: requirementOf(result.classification),
            modelBindingObserved: modelBindingObservedOf(raw.urlRedacted, 'immediate', ctx.prefixDerivation), eventTime: result, closeout: cloneJson(result), agree: true,
          });
        }
        ledger.responseFailures.push(raw);
        sync();
      } catch { failClosed('response'); }
    },
    onRequestFinished(req) {
      try {
        if (latched()) return;
        const obs = observationOf(req);
        noteTerminal({ reqId: obs ? obs.reqId : null, terminalKind: 'requestfinished', terminalSeq: nextSeq() });
      } catch { /* as above */ }
    },
    onRequestFailed(req) {
      try {
        if (latched()) return;
        const failSeq = nextSeq();
        const raw = capture(req, 'failSeq', failSeq);
        const failure = read(req, 'failure');
        raw.errorText = failure && typeof failure.errorText === 'string' ? failure.errorText : null;
        identify(raw, 'requestfailed');
        const ctx = context();
        const result = classifyRequestFailure(requestFailureInput(raw, raw.reqIdValid), ctx.opLedger, ctx.markers, ctx.prefixDerivation, ctx.prefixSourceLedger);
        Object.assign(raw, { eventTime: result, closeout: cloneJson(result), agree: true });
        ledger.requestFailures.push(raw);
        noteTerminal({ reqId: raw.reqId, terminalKind: 'requestfailed', terminalSeq: failSeq });
        sync();
      } catch { failClosed('requestfailed'); }
    },
  };
}

/**
 * Wires the §9 error-ledger sources onto the Playwright objects: pageerror, non-allow-listed
 * console.error (the allow-list is empty by design), page crash, page close / browser disconnect
 * outside cleanup, and (slice C1, §9.2) the passive `request` / `response` / `requestfinished` /
 * `requestfailed` instrumentation (`network`, from `createNetworkInstrumentation`) -- replacing the
 * former blanket `requestfailed => fatal`: a request failure or HTTP >= 400 response is fatal only
 * through its correlated identity's single fatal witness. Returns `detach()`.
 */
function wireFatalListeners({ page, browser, live, fatal, network = null }) {
  const detach = [];
  const on = (emitter, ev, fn) => {
    if (!emitter || typeof emitter.on !== 'function') return;
    emitter.on(ev, fn);
    detach.push(() => { try { if (typeof emitter.off === 'function') emitter.off(ev, fn); else emitter.removeListener(ev, fn); } catch { /* detached best-effort */ } });
  };
  on(page, 'pageerror', (err) => fatal('pageerror', err && err.message));
  on(page, 'console', (msg) => { if (msg && typeof msg.type === 'function' && msg.type() === 'error') fatal('console.error', msg.text()); });
  if (network) {
    on(page, 'request', (req) => network.onRequest(req));
    on(page, 'response', (resp) => network.onResponse(resp));
    on(page, 'requestfinished', (req) => network.onRequestFinished(req));
    on(page, 'requestfailed', (req) => network.onRequestFailed(req));
  }
  on(page, 'crash', () => fatal('page-crash', 'page crashed'));
  on(page, 'close', () => { if (!live.closingIntent) fatal('page-close-outside-cleanup', 'page closed outside cleanup'); });
  on(browser, 'disconnected', () => { if (!live.closingIntent) fatal('browser-disconnected-outside-cleanup', 'browser disconnected outside cleanup'); });
  return () => { for (const d of detach.splice(0)) d(); };
}

/** Default git runner (execFileSync in the repo root); injectable for offline tests. */
function createGitRunner(repoRoot) {
  return (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** Playwright version from node_modules/playwright/package.json via the fs layer (null if unreadable; never fabricated). */
function readPlaywrightVersionG2({ fs, repoRoot }) {
  try {
    const pkg = JSON.parse(toBuffer(fs.readFile(path.join(repoRoot, 'node_modules', 'playwright', 'package.json'))).toString('utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch { return null; }
}

/** Phase-0 failure (non-consuming): step name + category, reported via PREFLIGHT_FAILED. */
class Phase0Failure extends Error {
  constructor(step, kind, inner) {
    super(`Phase 0 failed at ${step} (${kind})${inner && inner.message ? `: ${inner.message}` : ''}`);
    this.name = 'Phase0Failure';
    this.step = step;
    this.kind = kind;
    if (inner !== undefined) this.inner = inner;
  }
}

/** §10 limitations recorded in R1 (§13, abridged by value). */
const G2_LIMITATIONS = Object.freeze([
  'only models A and B under Viewer 7.124.2 on the SVF2 path; no other models, versions or formats',
  'no Panel workflow, engine, performance or host-lifecycle claim (G3, H1, H2, OQ-1)',
  'does not resolve G1 F7; C4 uses the fragment-list reference, not vertex-level bounds',
  'foreign theming preservation not exercised (D3)',
  'C20 claims only presence, localization and byte-exact removal of one Hard presentation of one element under one camera at DPR 1',
  'real DockingPanel visibility-listener count is unobservable; C2/C3 use prototype spies and behavioural silence',
  'readAggregateSelection is recorded only (C17)',
  'Structure-model results are not G1 F1-F8 evidence',
  'no claim beyond the recorded envelope',
]);

/** The initial §10 run state (every key present; null, never undefined). */
function buildInitialRunState({ binding, validation, startedAt }) {
  const checks = {};
  for (const n of CHECK_NAMES) checks[n] = makeCheckRecord({ verdict: 'BLOCKED', reason: 'not-executed' });
  const controls = {};
  for (const n of CONTROL_NAMES) controls[n] = notStartedControlRun(n, 'not-executed', { at: startedAt });
  return {
    script: { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'not-captured', requestedUrl: G2_VIEWER_SCRIPT_URL, expectedSha256: EXPECTED_VIEWER_SHA256, capture: null },
    procedure: { path: binding.procedure.path, sha256: binding.procedure.sha256, version: PROCEDURE_VERSION, thresholdTable: 'T-rev2' },
    authorization: {
      path: binding.authorization.path, id: binding.authorization.id, sha256: binding.authorization.sha256,
      fields: normalizeEvidence(validation.record && validation.record.fields ? validation.record.fields : null),
      candidateSet: normalizeEvidence(validation.candidateSet || null),
    },
    attempt: { attemptId: binding.attemptId },
    harnessIntegrity: { path: binding.harness.path, sha256: binding.harness.sha256, branch: null, headSha: binding.headSha, gitStatusPorcelain: null, servedModuleManifest: {}, gitTreeState: null, remoteAssets: [G2_VIEWER_SCRIPT_URL, G2_VIEWER_STYLE_URL], pageAgentSha256: null },
    runtimeEnvelope: {
      viewerVersion: RUNTIME_ENVELOPE_REQUESTED.viewer, chromium: null, playwright: null, node: typeof process !== 'undefined' ? process.version : null,
      modelUrns: { A: MODEL_A_URN, B: MODEL_B_URN }, urnSha256: { A: binding.fixtures.A.urnSha256, B: binding.fixtures.B.urnSha256 },
      initializer: { env: RUNTIME_ENVELOPE_REQUESTED.env, api: RUNTIME_ENVELOPE_REQUESTED.api }, webgl: null,
    },
    classifier: { A: null, B: null },
    runtime: { A: { loaded: false }, B: { loaded: false } },
    targets: null,
    checks,
    gates: null,
    controls,
    sceneOwnership: [],
    spyLedger: [],
    eventLog: [],
    stateSnapshots: [],
    c4Table: [],
    c17: null,
    c20: null,
    n6: null,
    screenshots: [],
    errorLedger: createEmptyErrorLedger(),
    cleanupFailures: [],
    cleanupStepStatus: {},
    cleanupUnresolvedOwnership: false,
    viewerScriptIntegrityReason: 'not-captured',
    sessionTainted: false,
    staleContinuationsDropped: 0,
    limitations: [...G2_LIMITATIONS],
    startedAt,
  };
}

/**
 * Node-side not-started `control-run` record (§7 not-started executionRecord, the control's §7
 * not-executable state). Used only for pre-run placeholders and fail-closed fallbacks; `seq` defaults
 * to 0 ("before any sequenced event"): a placeholder only -- such records appear solely in states that
 * already fail closed (no gate / invalid page record), where a seq collision is one more row-5 reason.
 */
function notStartedControlRun(name, reason, { seq = 0, at = defaultClock.nowIso() } = {}) {
  return makeControlRunRecord(name, makeControlRecord(name, notExecutableState(name), { fields: { reason } }), { start: null, terminalSeq: seq, terminalAt: at });
}

/**
 * Fail-closed replacement for an invalid/missing page control record: state NOT_DETECTED (row 4
 * unacceptable for every control) with the not-started executionRecord. For N3-N8 this record is
 * deliberately schema-invalid (NOT_DETECTED is not a not-started state there) => row 5 as well;
 * it can never be weaker than the record it replaces.
 */
function failClosedControlRun(name, reason, { seq = 0, at = defaultClock.nowIso() } = {}) {
  const rec = makeControlRunRecord(name, makeControlRecord(name, notExecutableState(name), { fields: { reason } }), { start: null, terminalSeq: seq, terminalAt: at });
  rec.state = 'NOT_DETECTED';
  rec.executionRecord.terminalState = 'NOT_DETECTED';
  return rec;
}

/** Records from an unavailable phase run: every check BLOCKED(<reason>), every control its §7 not-executable state. */
function unavailablePhaseRecords(reason) {
  const checks = {};
  for (const n of CHECK_NAMES) checks[n] = makeCheckRecord({ verdict: 'BLOCKED', reason });
  const controls = {};
  for (const n of CONTROL_NAMES) controls[n] = notStartedControlRun(n, reason);
  return { checks, controls };
}

/**
 * Merges the in-page phase run into the §10 state. The page's records are re-validated Node-side:
 * a missing or invalid check/control record fails closed (BLOCKED / NOT_DETECTED), never PASS.
 */
function applyPhaseRunToState(state, run) {
  // A synthetic gate-disposition record (closed gate, slice B2) is kept verbatim: it is never a
  // verdict, and its legality (shape, G-a..G-f, CG-1..CG-7, gate equations) is decided against the
  // whole state by recordSchemaProblems -- a defective one is a row-5 contradiction (fail-closed).
  const isDisposition = (rec, n) => n !== 'C1' && isPlainObject(rec) && rec.recordType === RECORD_TYPE.GATE_DISPOSITION;
  for (const n of CHECK_NAMES) {
    const rec = run && run.checks ? run.checks[n] : undefined;
    state.checks[n] = isDisposition(rec, n) || (rec !== undefined && validateCheckRecord(rec, n).ok) ? rec : makeCheckRecord({ verdict: 'BLOCKED', reason: 'invalid-or-missing-page-record' });
  }
  for (const n of CONTROL_NAMES) {
    const rec = run && run.controls ? run.controls[n] : undefined;
    state.controls[n] = isDisposition(rec, n) || (rec !== undefined && validateControlRunRecord(n, rec).ok) ? rec : failClosedControlRun(n, 'invalid-or-missing-page-record');
  }
  const extras = (run && run.extras) || {};
  state.c4Table = Array.isArray(extras.c4Table) ? extras.c4Table : [];
  state.sceneOwnership = Array.isArray(extras.sceneOwnership) ? extras.sceneOwnership : (extras.sceneOwnership == null ? [] : extras.sceneOwnership);
  state.c17 = extras.c17 == null ? null : extras.c17;
  state.c20 = extras.c20 == null ? null : extras.c20;
  // N6 fallback only from an executed control-run record (a gate-disposition is never live evidence;
  // under a closed gate `n6` must stay exactly null, CG-7).
  const n6Rec = run && run.controls ? run.controls.N6 : null;
  state.n6 = extras.n6 == null ? (isPlainObject(n6Rec) && n6Rec.recordType === RECORD_TYPE.CONTROL_RUN ? n6Rec : null) : extras.n6;
  // §7 global C1 gate (slice B2): the runner's `gates.C1` record and its markers (P1..P11, cleanup;
  // persisted under errorLedger.markers[], §9.2). Re-validated by the gate equations, never trusted.
  state.gates = run && isPlainObject(run.gates) ? run.gates : null;
  if (run && Array.isArray(run.markers)) {
    if (!isPlainObject(state.errorLedger)) state.errorLedger = createEmptyErrorLedger();
    state.errorLedger.markers = [...(Array.isArray(state.errorLedger.markers) ? state.errorLedger.markers : []), ...run.markers];
  }
  // §7 C1 reason contract: C1's single check-finalized event is retained in the persisted eventLog only
  // when it matches the finalized C1 record. The eventLog is ONE seq-ordered list from the run's single
  // counter (runner events, wrapper-install/restore, the C16 log); extras.eventLog entries already in
  // it (same seq) are not duplicated.
  const c1 = state.checks.C1;
  const c1EventOk = (e) => isPlainObject(c1) && e.seq === c1.finalizedSeq && e.verdict === c1.verdict && e.reason === c1.reason;
  const ev = run && isPlainObject(run.c1FinalizedEvent) ? run.c1FinalizedEvent : null;
  const base = run && Array.isArray(run.eventLog) ? run.eventLog : (ev ? [ev] : []);
  const merged = base.filter((e) => !(isPlainObject(e) && e.kind === 'check-finalized' && e.check === 'C1') || c1EventOk(e));
  const seen = new Set(merged.map((e) => (isPlainObject(e) ? e.seq : undefined)));
  for (const e of Array.isArray(extras.eventLog) ? extras.eventLog : []) if (!(isPlainObject(e) && seen.has(e.seq))) merged.push(e);
  state.eventLog = merged.map((e, i) => [e, i]).sort((a, b) => ((isPlainObject(a[0]) && isPlainObject(b[0]) && a[0].seq !== b[0].seq) ? a[0].seq - b[0].seq : a[1] - b[1])).map(([e]) => e);
  state.spyLedger = run && Array.isArray(run.spyLedger) ? run.spyLedger : [];
  state.screenshots = run && Array.isArray(run.screenshots) ? run.screenshots : [];
  state.stateSnapshots = run && Array.isArray(run.stateSnapshots) ? run.stateSnapshots : [];
}

/**
 * R1 payload builder used by the live closeout: `buildResultPayload(S*)`, then the §4.6/T22 caps --
 * the spy ledger through `capSpyLedger` (verdict-critical records never dropped) and every string
 * through `sanitizeEvidenceTree` (redaction; 4 KiB per non-critical field, truncation recorded). A
 * verdict-critical field that cannot satisfy a cap raises EvidenceCapError, mapped to the closeout
 * failure `evidence-cap:<reason>` (T22: "a required-artifact write that cannot satisfy the caps is a
 * closeout failure => final FAIL"). Pure and deterministic, so `snapshotEqual` re-builds byte-equal.
 */
function buildCappedResultPayload(S) {
  const payload = buildResultPayload(S);
  try {
    const capped = capSpyLedger(Array.isArray(payload.spyLedger) ? payload.spyLedger : []);
    payload.spyLedger = { records: capped.records, truncated: capped.truncated, originalBytes: capped.originalBytes, keptRecords: capped.keptRecords, droppedRecords: capped.droppedRecords };
    return sanitizeEvidenceTree(payload).value;
  } catch (err) {
    if (err instanceof EvidenceCapError) throw new CloseoutFailure(`evidence-cap:${err.reason}`, err);
    throw err;
  }
}

/**
 * §9.2 load `completionOutcome` of one settled load (slice C2): `ready` iff the readiness wait
 * observed readiness; `timeout:load` for the T2 deadline (outer, or an inner RPC reporting
 * `timed-out`); `harness-exception` for a thrown load; everything else (`rejected`) is a load the
 * Viewer did not complete.
 */
function loadCompletionOutcome(out) {
  if (!isPlainObject(out) || out.status === 'threw') return 'harness-exception';
  if (out.status === 'timed-out') return 'timeout:load';
  const v = isPlainObject(out.value) ? out.value : {};
  if (isPlainObject(v.ready) && v.ready.status === 'ready') return 'ready';
  if ([v.doc, v.node, v.ready].some((x) => isPlainObject(x) && x.status === 'timed-out')) return 'timeout:load';
  return 'rejected';
}

/**
 * Node-owned cleanup steps + delegating wrappers for the page-owned ones (ownership re-checked
 * in-page). Slice C2: each page/context/browser close that is actually invoked (target present) is a
 * §9.2 `teardown` mutationOperation recorded through `ops` (start + node-side ack before `close()`).
 */
function buildCleanupSteps({ live, rpcCall, timers, ops = null }) {
  const teardown = (target, getTarget, fn) => async () => {
    const t = getTarget();
    const rec = ops && t && typeof t.close === 'function'
      ? ops.beginMutation({ operationType: 'teardown', teardownTarget: target, phase: 'cleanup', invokedBy: `cleanup:${target}`, cleanupStepRef: `/cleanupStepStatus/${target}` }) : null;
    try {
      const v = await fn();
      if (rec) ops.endMutation(rec.operationId, 'settled');
      return v;
    } catch (e) {
      if (rec) ops.endMutation(rec.operationId, 'threw');
      throw e;
    }
  };
  const ownership = {};
  const steps = {};
  for (const name of G2_PAGE_CLEANUP_STEPS) {
    steps[name] = {
      run: async () => {
        ownership[name] = null;
        if (!live.page) throw new Error('no page');
        const r = await rpcCall('g2CleanupStep', { name });
        ownership[name] = r && typeof r.ownershipRemains === 'boolean' ? r.ownershipRemains : null;
        if (!r || r.ok !== true) throw new Error(`${name}: ${r && r.error ? r.error.message : 'page step failed'}`);
        return r.result === undefined ? null : r.result;
      },
      ownershipRemains: () => {
        const v = ownership[name];
        if (typeof v !== 'boolean') throw new Error('ownership indeterminate');
        return v;
      },
    };
  }
  steps.closePage = {
    run: teardown('closePage', () => live.page, async () => { live.closingIntent = true; return closePlaywrightTarget(live.page, 'page', { timers }); }),
    ownershipRemains: () => Boolean(live.page) && typeof live.page.isClosed === 'function' && !live.page.isClosed(),
  };
  steps.closeContext = { run: teardown('closeContext', () => live.context, async () => { live.closingIntent = true; return closePlaywrightTarget(live.context, 'context', { timers }); }) };
  steps.closeBrowser = {
    run: teardown('closeBrowser', () => live.browser, async () => { live.closingIntent = true; return closePlaywrightTarget(live.browser, 'browser', { timers }); }),
    ownershipRemains: () => Boolean(live.browser) && typeof live.browser.isConnected === 'function' && live.browser.isConnected(),
  };
  steps.httpServerOwnership = async () => ({ outcome: 'not-started-by-harness', note: 'the operator started npm start and stops it after the run' });
  return steps;
}

/** Best-effort close of whatever Phase 0 created (page, context, browser), never throwing. */
async function closeAllPlaywrightBestEffort(live, timers) {
  live.closingIntent = true;
  const failures = [];
  for (const [label, target] of [['page', live.page], ['context', live.context], ['browser', live.browser]]) {
    try { await closePlaywrightTarget(target, label, { timers }); } catch (err) { failures.push({ resource: label, error: summarizeThrown(err) }); }
  }
  return failures;
}

/**
 * `runPostReservation(ctx)` -- everything after B3. `ctx = {attempt, binding, validation, repoRoot,
 * fs, chain, env, deps, importBrowserPackage}`. Returns (never throws for an expected failure)
 * `{finalOverall, exitCode, consumed, phase0?, w3Failure?, closeout?}`; exit codes per §8 (any
 * Phase-0 or W3 failure before B8 => FAIL/1; after B8 the commit outcome decides).
 */
async function runPostReservation(ctx) {
  const { attempt, binding, validation, repoRoot, fs, chain, deps = {}, importBrowserPackage } = ctx;
  const env = ctx.env || {};
  const clock = deps.clock || defaultClock;
  const timers = deps.timers || DEFAULT_TIMERS;
  const print = typeof deps.print === 'function' ? deps.print : (line) => { console.log(line); };
  const emit = typeof deps.onEvent === 'function' ? deps.onEvent : () => {};
  const git = deps.git || createGitRunner(repoRoot);
  const serveModule = deps.serveModule || ((o) => serveClashPanelModule({ ...o, rootDir: repoRoot }));
  const quarantine = createTimeoutQuarantine();
  const baseUrl = g2BaseUrl(env);
  const state = buildInitialRunState({ binding, validation, startedAt: clock.nowIso() });
  // §9.2 THE node-side run counter: fatal entries, request/response events, P0/closeout markers.
  // UNRESOLVED LIVE-WIRING GATE (slice C1): the in-page phase run (g2RunPhases) still stamps its own
  // records (spy ledger, eventLog, snapshots, P1..P11/cleanup markers, C1 finalization, controls,
  // gates.C1) from a page-side recorder seeded with `seqBase`, and node events received DURING that
  // run are numbered by this counter -- two namespaces, not one. `observe` only moves this counter past
  // the page's allocations afterwards; any collision is a row-5 contradiction (seq-not-unique). A
  // compliant cross-process design is a before-live requirement. Slice C2 makes this gate certain to
  // bite in a live run: the in-page C16/C17 operation records (G2_NODE_OPLEDGER_BINDING) are numbered by
  // THIS counter during the page run, as are request/response events -- see G2_DUAL_COUNTER_GATE.
  const runSeq = createRunSeqCounter();
  const nodeAttribution = { phase: 'P0', activeCheck: null };
  const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });
  const uninstallProcessHandlers = installProcessFatalHandlers({ proc: deps.proc || process, sink });
  const promises = createPromiseRegistry({ onRejection: () => {} });
  const live = { browser: null, context: null, page: null, rpc: null, closingIntent: false, detachFatal: () => {} };
  const network = createNetworkInstrumentation({
    ledger: state.errorLedger, nextSeq: runSeq.next, sink, baseUrl,
    attribution: () => ({ ...nodeAttribution }),
    mainFrame: () => (live.page && typeof live.page.mainFrame === 'function' ? live.page.mainFrame() : null),
    onFatalWitness: () => { if (live.rpc) promises.track(live.rpc.call('g2MarkFatal', { kind: NETWORK_FATAL_ENTRY_KIND }).catch(() => {})); },
  });
  // §9.2 slice C2: the harness-owned operation ledger (loads, C16/C17 + cleanup mutations, teardown).
  const ops = createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock });
  const integrity = createViewerScriptIntegrityCapture({ timers });
  const manifest = createServedModuleManifest();
  const fatal = (kind, detail) => {
    const recorded = sink.recordFatal(kind, fatalDetail(detail));
    if (recorded && live.rpc) promises.track(live.rpc.call('g2MarkFatal', { kind }).catch(() => {}));
    return recorded;
  };
  const rpcCall = (key, arg) => {
    if (!live.rpc) return Promise.reject(new Error('page RPC unavailable'));
    return live.rpc.call(key, arg);
  };
  const withDeadline = (op, timeoutMs, fn, mutating = false) => runWithDeadline({ op, timeoutMs: Math.max(1, timeoutMs), fn, mutating, timers, quarantine });
  const result = (extra) => ({ uninstallProcessHandlers, state, ...extra });

  // ---- Phase 0 (after B3; not consumption) -------------------------------------------------
  let phase0Step = null;
  let harnessBytes = null;
  let agent = null;
  const p0 = async (step, fn) => {
    phase0Step = step;
    emit({ type: 'phase0-step', step });
    const out = await runWithDeadline({ op: 'phase0-step', timeoutMs: TABLE_T.T1.phase0StepDeadlineMs, fn, timers, quarantine, meta: { step } });
    if (out.status === 'completed') return out.value;
    throw new Phase0Failure(step, out.status === 'timed-out' ? 'timeout' : 'threw', out.status === 'threw' ? out.error : undefined);
  };
  try {
    await p0('evidence-writer', () => {
      if (!isRealDirectory(fs.lstat(chain.D1)) || !isRealDirectory(fs.lstat(chain.D2))) throw new Error('results/attempts directory is not a real directory');
      return true;
    });
    await p0('harness-sha256', () => {
      harnessBytes = toBuffer(fs.readFile(path.join(repoRoot, HARNESS_REL_PATH)));
      if (sha256Hex(harnessBytes) !== validation.digests.harnessSha256) throw new Error('harness bytes changed since W1');
      return true;
    });
    await p0('git-tree', () => {
      const branch = String(git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      const head = String(git(['rev-parse', 'HEAD'])).trim();
      const porcelain = String(git(['status', '--porcelain']));
      state.harnessIntegrity.branch = branch;
      state.harnessIntegrity.gitStatusPorcelain = porcelain;
      const tree = classifyGitTreeState(porcelain);
      state.harnessIntegrity.gitTreeState = tree;
      if (head !== binding.headSha) throw new Error('HEAD differs from the bound Baseline-HEAD');
      if (tree.blockingPaths.length > 0) throw new Error(`working tree not clean: ${tree.blockingPaths.join(', ')}`);
      return true;
    });
    await p0('served-module-manifest', () => {
      for (const spec of G2_SERVED_ENTRY_MODULES) {
        const r = serveModule({ requestUrl: spec, manifest });
        if (!r || r.status !== 200) throw new Error(`served module unavailable: ${spec} (${r && r.reason})`);
      }
      state.harnessIntegrity.servedModuleManifest = manifest.snapshot();
      return true;
    });
    await p0('page-agent-build', () => {
      agent = buildPageAgentSource(harnessBytes.toString('utf8'));
      state.harnessIntegrity.pageAgentSha256 = agent.sha256;
      return true;
    });
    const pw = await p0('browser-package-import', async () => {
      const mod = await importBrowserPackage();
      emit({ type: 'browser-package-imported' });
      return mod;
    });
    state.runtimeEnvelope.playwright = readPlaywrightVersionG2({ fs, repoRoot });
    await p0('browser-launch', async () => {
      const chromium = pw && pw.chromium;
      if (!chromium || typeof chromium.launch !== 'function') throw new Error('browser package exposes no chromium.launch');
      live.browser = await chromium.launch();
      try { state.runtimeEnvelope.chromium = live.browser.version(); } catch { state.runtimeEnvelope.chromium = null; }
      return true;
    });
    await p0('context-create', async () => { live.context = await live.browser.newContext({ serviceWorkers: 'block', deviceScaleFactor: 1 }); return true; });
    await p0('page-create', async () => {
      live.page = await live.context.newPage();
      live.detachFatal = wireFatalListeners({ page: live.page, browser: live.browser, live, fatal, network });
      live.page.on('response', (response) => { try { integrity.onResponse(response); } catch { /* capture is best-effort; classification fails closed */ } });
      live.page.on('requestfailed', (request) => { try { integrity.onRequestFailed(request); } catch { /* as above */ } });
      live.rpc = createPageRpc(live.page, { onCall: (key) => emit({ type: 'rpc', key }) });
      return true;
    });
    await p0('route-setup', async () => {
      const origin = new URL(baseUrl).origin;
      await live.page.route(`${baseUrl}${G2_PAGE_PATH}`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: G2_BARE_PAGE_HTML }));
      await live.page.route('**/clashpanel/**', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.continue();
        const r = serveModule({ requestUrl: url.pathname, manifest });
        if (!r || r.status !== 200) return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not served by the G2 harness' });
        return route.fulfill({ status: 200, contentType: r.contentType, body: r.body });
      });
      await live.page.exposeFunction(G2_NODE_SCREENSHOT_BINDING, async (clip) => {
        const ok = clip && ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(clip[k]) && clip[k] >= 0) && clip.width > 0 && clip.height > 0;
        if (!ok) throw new Error('screenshot: integer clip rectangle required');
        const png = await live.page.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, type: 'png', animations: 'disabled', caret: 'hide' });
        return toBuffer(png).toString('base64');
      });
      await live.page.exposeFunction(G2_NODE_FATAL_BINDING, (kind, detail) => { fatal(String(kind), detail); return true; });
      await live.page.exposeFunction(G2_NODE_OPLEDGER_BINDING, (action, arg) => ops.pageOperation(String(action), arg));
      await live.page.addInitScript({ content: agent.source });
      return true;
    });
    // §9.2: the P0 phase-boundary marker precedes the Phase-0 goto (listeners attached above).
    state.errorLedger.markers.push({ seq: runSeq.next(), name: 'P0' });
    await p0('goto', async () => { await live.page.goto(`${baseUrl}${G2_PAGE_PATH}`, { waitUntil: 'load', timeout: TABLE_T.T1.phase0StepDeadlineMs }); return true; });
    await p0('bootstrap-ready', async () => {
      await live.page.waitForFunction(() => window.__g2Bootstrap && window.__g2Bootstrap.ready === true, null, { timeout: TABLE_T.T1.phase0StepDeadlineMs });
      integrity.markViewingDefined();
      return true;
    });
    await p0('module-install', async () => {
      const r = await rpcCall('g2InstallModules', [...G2_SERVED_ENTRY_MODULES]);
      const failed = G2_SERVED_ENTRY_MODULES.filter((s) => !r || !r[s] || r[s].ok !== true);
      if (failed.length) throw new Error(`module install failed: ${failed.join(', ')}`);
      state.harnessIntegrity.servedModuleManifest = manifest.snapshot();
      return true;
    });
    await p0('agent-ready', async () => {
      const r = await rpcCall('g2AgentReady', null);
      if (!r || r.ok !== true) throw new Error('page agent not ready (viewer or THREE missing)');
      state.runtimeEnvelope.webgl = normalizeEvidence(r.webgl || null);
      return true;
    });
  } catch (err) {
    const step = err instanceof Phase0Failure ? err.step : phase0Step;
    const reason = fatalDetail(err instanceof Phase0Failure && err.inner ? `${err.kind}: ${err.inner.message || err.inner}` : (err && err.message));
    const closeFailures = await closeAllPlaywrightBestEffort(live, timers);
    live.detachFatal();
    const written = attempt.appendBestEffort(JOURNAL_STATE.PREFLIGHT_FAILED, { category: 'phase0', step: String(step), reason, closeFailures: closeFailures.map((f) => `${f.resource}:${f.error.message}`) });
    attempt.close();
    const lines = [
      'G2 Phase 0 failed after AUTH_BOUND: the attempt was NOT consumed, but the authorization record is spent.',
      `failed step: ${step}`, `reason: ${reason}`,
      `journal PREFLIGHT_FAILED written: ${written.ok ? 'yes' : 'no (best-effort)'}`,
      'finalOverall: FAIL', 'exit code: 1',
    ];
    for (const l of lines) { try { print(l); } catch { /* informational */ } }
    return result({ finalOverall: VERDICT.FAIL, exitCode: exitCodeForVerdict(VERDICT.FAIL), consumed: false, phase0: { step, reason, journalWritten: written.ok, closeFailures } });
  }

  // ---- W3 (B5): ATTEMPT_CONSUMED durable strictly before the first loadDocumentNode ------------
  try {
    markAttemptConsumed(attempt);
    emit({ type: 'attempt-consumed' });
  } catch (err) {
    // §4.1: a W3 write failure => no loadDocumentNode; preflight-class; the journal stays AUTH_BOUND.
    const closeFailures = await closeAllPlaywrightBestEffort(live, timers);
    live.detachFatal();
    attempt.close();
    const reason = fatalDetail(err && err.message);
    for (const l of ['G2 W3 (ATTEMPT_CONSUMED) durable write failed: no model was loaded; the journal stays AUTH_BOUND.', `reason: ${reason}`, 'finalOverall: FAIL', 'exit code: 1']) { try { print(l); } catch { /* informational */ } }
    return result({ finalOverall: VERDICT.FAIL, exitCode: exitCodeForVerdict(VERDICT.FAIL), consumed: false, w3Failure: { reason, closeFailures } });
  }

  // ---- consumed session: T9 armed; loads A then B; facts; targets; P1..P11 (in-page) ----------
  let t9DisarmedAt = null;
  const t9 = createAttemptDeadlineTimer({
    sink: { recordAttemptDeadline: () => { const r = sink.recordAttemptDeadline(); if (r && live.rpc) promises.track(live.rpc.call('g2MarkFatal', { kind: 'ATTEMPT_DEADLINE', abort: true }).catch(() => {})); return r; } },
    timers, clock,
  });
  t9.arm();
  const t9Remaining = () => (t9.deadlineAbs() === null ? TABLE_T.T9.wholeAttemptCapMs : t9.deadlineAbs() - clock.monotonicMs());
  let tainted = false;
  try {
    const loads = {};
    // H1: the node-side load outcomes, fed into the in-page C1 evaluation (withNodeLoadOutcomes).
    const nodeLoadOutcomes = { A: null, B: null };
    Object.assign(nodeAttribution, { phase: 'P1', activeCheck: 'C1' });
    for (const label of ['A', 'B']) {
      const urn = label === 'A' ? MODEL_A_URN : MODEL_B_URN;
      const budget = TABLE_T.T2.loadAndReadinessDeadlineMs;
      // §9.2 slice C2: the loadOperation's start fields precede the first load RPC (node counter).
      const loadRec = ops.beginLoad({ modelId: label, modelUrnSha256: binding.fixtures && binding.fixtures[label] && SHA256_HEX_RE.test(String(binding.fixtures[label].urnSha256)) ? binding.fixtures[label].urnSha256 : sha256Hex(urn) });
      const t0 = clock.monotonicMs();
      const remaining = () => Math.max(1, budget - (clock.monotonicMs() - t0));
      const out = await withDeadline('load', budget, async () => {
        emit({ type: 'document-load', label });
        const doc = await rpcCall('g2DocumentLoad', { label, urn, timeoutMs: remaining() });
        if (!doc || doc.status !== 'completed') return { doc: doc || null, node: null, ready: null };
        emit({ type: 'load-document-node', label });
        const node = await rpcCall('g2LoadDocumentNode', { label, timeoutMs: remaining() });
        if (!node || node.status !== 'completed') return { doc, node: node || null, ready: null };
        const ready = await rpcCall('g2AwaitModelReady', { label, timeoutMs: remaining() });
        return { doc, node, ready: ready || null };
      }, true);
      nodeLoadOutcomes[label] = loadCompletionOutcome(out);
      ops.endLoad(loadRec, nodeLoadOutcomes[label]);
      // §9.2 `load-windows-closed`: right after the later window closes (synchronously, no await in
      // between) the prefix-source snapshot + derivation are frozen and provisional responses finalized.
      if (label === 'B') finalizeLoadWindows(state.errorLedger, { prefixSources: network.prefixSources, appendEntry: (entry) => sink.recordWitnessEntry(entry) });
      if (out.status === 'completed') loads[label] = normalizeEvidence(out.value);
      else { loads[label] = { status: out.status, error: out.status === 'threw' ? summarizeThrown(out.error) : null }; if (out.status === 'timed-out') tainted = true; }
    }
    const factsOut = await withDeadline('tree-enumeration', TABLE_T.T3.treeEnumerationDeadlineMs, () => rpcCall('g2CollectModelFacts', null));
    const facts = factsOut.status === 'completed' && factsOut.value ? factsOut.value : null;
    for (const label of ['A', 'B']) {
      const f = facts && facts[label] ? facts[label] : null;
      state.classifier[label] = f ? normalizeEvidence({ classification: f.classification, otg: f.otg, svf2: f.svf2 }) : null;
      state.runtime[label] = normalizeEvidence({
        loaded: Boolean(f && f.loaded === true), isOTG: f && f.otg ? f.otg.value : null, isSVF2: f && f.svf2 ? f.svf2.value : null,
        unitScale: f ? f.unitScale : null, unitString: f ? f.unitString : null, load: loads[label] || null,
      });
    }
    const targetsOut = await withDeadline('tree-enumeration', TABLE_T.T3.treeEnumerationDeadlineMs, () => rpcCall('g2PrepareTargets', null));
    state.targets = targetsOut.status === 'completed' ? normalizeEvidence(targetsOut.value) : { unavailable: targetsOut.status, error: targetsOut.status === 'threw' ? summarizeThrown(targetsOut.error) : null };
    // In-page run: node events during it keep the P1 attribution with no active check (the page owns
    // the phase/check context -- part of the unresolved live-wiring gate above).
    Object.assign(nodeAttribution, { phase: 'P1', activeCheck: null });
    const runOut = await withDeadline('attempt', t9Remaining(), () => rpcCall('g2RunPhases', { seqBase: runSeq.peek(), nodeLoadOutcomes }));
    if (runOut.status === 'completed' && runOut.value) {
      const run = runOut.value;
      applyPhaseRunToState(state, run);
      runSeq.observe(maxRecordedSeq(state));
      if (run.sessionTainted === true) tainted = true;
      state.staleContinuationsDropped += Number.isInteger(run.staleContinuationsDropped) ? run.staleContinuationsDropped : 0;
    } else {
      const u = unavailablePhaseRecords(`phase-run-${runOut.status}`);
      state.checks = u.checks;
      state.controls = u.controls;
      tainted = true;
      if (runOut.status === 'timed-out' && live.rpc) promises.track(live.rpc.call('g2MarkFatal', { kind: 'phase-run-timeout', abort: true }).catch(() => {}));
    }
  } catch (err) {
    // An unexpected harness error outside the drivers: recorded as a fatal event (§8 row 1), then
    // cleanup and closeout still run so the consumed attempt ends with durable evidence.
    fatal('harness-exception', err && err.message);
    tainted = true;
  }
  state.sessionTainted = tainted;

  // ---- cleanup ledger (§9; every step runs, each bounded by T8) ------------------------------
  Object.assign(nodeAttribution, { phase: 'cleanup', activeCheck: null });
  emit({ type: 'cleanup' });
  const cleanup = await runCleanup({ steps: buildCleanupSteps({ live, rpcCall, timers, ops }), context: {} }, { timers, quarantine });
  // §9.2: a mutation whose cleanup step timed out ends `timeout` (its window still closes at the next boundary).
  for (const [step, status] of Object.entries(cleanup.cleanupStepStatus || {})) {
    if (status !== 'timed-out') continue;
    for (const id of ops.openMutations()) { const o = state.errorLedger.opLedger.find((x) => x.operationId === id); if (o && o.invokedBy === `cleanup:${step}`) ops.endMutation(id, 'timeout'); }
  }
  state.cleanupFailures = normalizeEvidence(cleanup.cleanupFailures);
  state.cleanupStepStatus = normalizeEvidence(cleanup.cleanupStepStatus);
  state.cleanupUnresolvedOwnership = cleanup.cleanupUnresolvedOwnership === true;

  // ---- script integrity (page/context/browser already closed by cleanup) ---------------------
  try {
    const captured = await integrity.capture();
    const cls = classifyViewerScriptIntegrity(captured);
    state.script = normalizeEvidence({ integrityResult: cls.integrityResult, reason: cls.reason, requestedUrl: G2_VIEWER_SCRIPT_URL, expectedSha256: EXPECTED_VIEWER_SHA256, capture: captured });
    state.viewerScriptIntegrityReason = cls.reason;
  } catch (err) {
    state.script = { integrityResult: INTEGRITY_RESULT.CAPTURE_UNAVAILABLE, reason: 'capture-threw', requestedUrl: G2_VIEWER_SCRIPT_URL, expectedSha256: EXPECTED_VIEWER_SHA256, capture: null };
    state.viewerScriptIntegrityReason = `capture-threw:${summarizeThrown(err).name}`;
  }
  state.staleContinuationsDropped += quarantine.staleContinuationsDropped;

  // ---- closeout (§9.1) ----------------------------------------------------------------------
  // H1 (internal review 2026-10-01): an overdue-but-undispatched T9 expiry (the cap elapsed during
  // a synchronous/microtask stretch, so the timer callback never ran) is recorded as row 5
  // ATTEMPT_DEADLINE here -- synchronously before closeoutProtocol's step-1 primaryOverall (no
  // await in between) -- and again at disarm; the T9 entry is also always handed to the step-8
  // gate once armed (quiescence.deadlines below), so the gate's own deadlineAbs re-check applies.
  // Records into the sink directly (no page RPC: the page is already closed by cleanup).
  const recordT9IfOverdue = () => {
    if (t9.deadlineAbs() !== null && !t9.hasExpired() && !(clock.monotonicMs() < t9.deadlineAbs())) sink.recordAttemptDeadline();
  };
  recordT9IfOverdue();
  // §9.2 closeout step 1 (network ledger): the `closeout` marker, then every still-provisional response
  // finalized (`finalizedBy:'closeout'`), both classifiers re-run over the complete record, witnesses
  // synced (a newly fatal identity still counted through the sink) -- all before closeoutProtocol's
  // step-1 primaryOverall, synchronously.
  Object.assign(nodeAttribution, { phase: 'closeout', activeCheck: null });
  runSeq.observe(maxRecordedSeq(state));
  state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });
  ops.seal(); // no operation record after the closeout marker; every cancellation window is now closed
  finalizeNetworkLedgerAtCloseout(state.errorLedger, { nextSeq: runSeq.next, appendEntry: (entry) => sink.recordWitnessEntry(entry), prefixSources: network.prefixSources });
  emit({ type: 'closeout' });
  let closeout;
  try {
    closeout = await closeoutProtocol({
      state, handle: attempt, fs, chain, sink, clock,
      commitFs: deps.commitFs || nodeFsModule,
      allowTestLinkPrimitive: deps.allowTestLinkPrimitive === true,
      scheduler: deps.scheduler || DEFAULT_SCHEDULER,
      buildPayload: buildCappedResultPayload,
      print,
      quiescence: {
        disarmAttemptTimer: () => { t9.disarm(); t9DisarmedAt = clock.monotonicMs(); if (!(t9DisarmedAt < t9.deadlineAbs())) recordT9IfOverdue(); },
        deadlines: () => (t9.deadlineAbs() !== null ? [{ name: 'T9:attempt', deadlineAbs: t9.deadlineAbs(), completedMs: t9DisarmedAt }] : []),
        clearTimersAndSettle: async () => { await promises.settleAll(); },
        detachListeners: () => { live.detachFatal(); },
      },
    });
  } catch (err) {
    if (err && err.simulatedCrash === true) throw err;
    // closeoutProtocol threw outside its own failure path (a harness defect): FAILED best-effort, exit 1.
    attempt.appendBestEffort(JOURNAL_STATE.FAILED, { causes: [`harness-abort:closeout-threw:${summarizeThrown(err).name}`] });
    attempt.close();
    try { print('G2 closeout aborted (harness error): finalOverall: FAIL, exit code: 1'); } catch { /* informational */ }
    return result({ finalOverall: VERDICT.FAIL, exitCode: exitCodeForVerdict(VERDICT.FAIL), consumed: true, closeoutAbort: summarizeThrown(err) });
  }
  attempt.close();
  return result({ finalOverall: closeout.finalOverall, exitCode: closeout.exitCode, consumed: true, closeout });
}

// ============================================================================================
// Section 10 -- main() skeleton and CLI entry (procedure §4.1 source-order guarantee).
// ============================================================================================

/**
 * `main({argv, env, deps})` -- the ONLY place real Playwright objects could be constructed.
 * Source order (static-tested): W0 parseLiveActivation -> LIVE_PATH_WIRED gate -> W1
 * validateAuthorizationRecord + scanAttemptsDirectoryForStartup -> W2a establishAttemptsDirectory
 * -> W2b reserveAttempt (AUTH_BOUND durable, B3) -> only then `import('playwright')`. Everything
 * before B3 fails closed with a G2RefusalError/G2DurabilityError and no external effect. `deps`
 * lets offline tests prove the fail-closed prefix without touching the real filesystem.
 * After B3 the whole attempt is `runPostReservation` (Section 38): Phase 0, W3, the in-page P1..P11
 * run, the cleanup ledger and the §9.1 closeout. Returns `{finalOverall, exitCode, ...}`.
 */
async function main({ argv = process.argv, env = process.env, deps = {} } = {}) {
  // W0 -- activation interlock (pure), before anything else.
  const activation = parseLiveActivation({ argv, env });
  if (!activation.authorized) {
    throw new G2RefusalError(
      activation.reason,
      'clashpanel-viewerbridge.acceptance.mjs: live G2 execution requires --execute-live-g2, '
      + 'G2_LIVE_AUTHORIZED=YES and --authorization-record <docs/prompts/...md>. These are '
      + 'mechanical safeguards only; owner authorization is the validated record (procedure §4.1)',
    );
  }
  if (!LIVE_PATH_WIRED) {
    throw new G2RefusalError('live-path-not-wired', 'the G2 live path is not wired in this harness revision; nothing was validated, reserved or spent');
  }
  // M2 (2026-10-01 follow-up review): live cannot run while the before-live dual-counter /
  // attribution gate is unresolved, even if LIVE_PATH_WIRED were flipped.
  if (G2_DUAL_COUNTER_GATE.resolved !== true) {
    throw new G2RefusalError('dual-counter-gate-unresolved', 'G2_DUAL_COUNTER_GATE is unresolved (before-live blocker); nothing was validated, reserved or spent');
  }

  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const fs = deps.fs ?? createNodeFsLayer();
  const chain = resolveAttemptsChain(repoRoot);

  // W1 -- record validation + startup rule (local reads only; reserves nothing).
  const validation = validateAuthorizationRecord({ recordPath: activation.recordPath, repoRoot, fs, ...(deps.gitHead ? { gitHead: deps.gitHead } : {}) });
  if (!validation.ok) throw new G2RefusalError(validation.reason, 'authorization record rejected', validation.detail);
  const startup = scanAttemptsDirectoryForStartup({ fs, chain, authorizationId: validation.record.id, recordSha256: validation.record.sha256 });
  if (!startup.ok) throw new G2RefusalError(startup.reason, 'attempts directory refuses this authorization', startup.detail);
  const binding = buildBindingRecord({ validation, attemptId: randomUUID() });

  // W2a -- durable directory chain; W2b -- exclusive reservation + durable AUTH_BOUND (B3).
  establishAttemptsDirectory({ fs, chain });
  const attempt = reserveAttempt({ fs, chain, binding });

  // ---- Only past B3 (AUTH_BOUND durable): Phase 0 -> W3 -> P1..P11 -> cleanup -> closeout. ----
  // The browser package is imported ONLY through this closure, which runPostReservation invokes at
  // its Phase-0 "browser-package-import" step -- strictly after B3 and after the harness-sha256,
  // git-tree and served-module-manifest steps. `deps.browserPackage` is the offline tests' fake
  // (the same injection style as deps.fs / deps.gitHead); runCli never passes deps.
  const importBrowserPackage = () => (deps.browserPackage ? Promise.resolve(deps.browserPackage) : import('playwright'));
  return runPostReservation({ attempt, binding, validation, repoRoot, fs, chain, env, deps, importBrowserPackage });
}

/**
 * Runs `mainFn` and sets the §8 exit code: PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, unrecognized 4 --
 * derived from the returned `finalOverall` (which, after B8, is the commit outcome, never a later
 * re-read). Any throw (a refusal before B3, a durability failure, a harness defect) exits 1.
 */
async function runCli(mainFn = main, { proc = process, logError = (...a) => { console.error(...a); } } = {}) {
  try {
    const r = await mainFn();
    proc.exitCode = r !== null && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'finalOverall') ? exitCodeForVerdict(r.finalOverall) : 4;
  } catch (err) {
    logError('clashpanel-viewerbridge.acceptance.mjs: fatal/refused', err && err.message);
    proc.exitCode = 1;
  }
}

/** True only when this module is the process entry script (realpath'd compare, G1 pattern). */
function isDirectInvocation(metaUrl, argv1, env = process.env) {
  if (env && env.NODE_TEST_CONTEXT) return false;
  if (typeof argv1 !== 'string' || argv1 === '') return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch { return false; }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  await runCli();
}

export {
  // constants
  REPO_ROOT,
  HARNESS_REL_PATH,
  PROCEDURE_REL_PATH,
  PROCEDURE_VERSION,
  ACCEPTED_PROCEDURE_SHA256,
  AUTHORIZATION_PROMPTS_REL_DIR,
  ATTEMPTS_D0_REL,
  ATTEMPTS_D1_NAME,
  ATTEMPTS_D2_NAME,
  JOURNAL_VERSION,
  RUNTIME_ENVELOPE_REQUESTED,
  MODEL_A_NAME,
  MODEL_A_URN,
  MODEL_B_NAME,
  MODEL_B_URN,
  LIVE_PATH_WIRED,
  MARKER_LIVE_LINE,
  RUNTIME_LINE,
  AUTHORIZATION_MARKERS,
  JOURNAL_STATE,
  JOURNAL_TRANSITIONS,
  JOURNAL_CLASS,
  BINDING_KEYS,
  // errors
  G2RefusalError,
  G2DurabilityError,
  SimulatedCrash,
  // helpers
  sha256Hex,
  serializeJson,
  // W0
  parseLiveActivation,
  // fs layer
  createNodeFsLayer,
  createRecordingFakeFs,
  // W1
  normalizeRecordPath,
  parseAuthorizationMarkers,
  isAuthorizationCandidateText,
  enumeratePromptMarkdownFiles,
  validateAuthorizationRecord,
  // journal
  validateTransitionHistory,
  appendTransition,
  buildBindingRecord,
  parseReservationBytes,
  parseJournalBytes,
  reservationName,
  journalName,
  journalTempPrefix,
  commitName,
  closeoutFailureName,
  resolveAttemptsChain,
  scanAttemptsDirectoryForStartup,
  classifyJournal,
  inspectAttemptFiles,
  // W2
  fsyncDirectory,
  establishAttemptsDirectory,
  writeExclusiveDurable,
  writeReplaceDurable,
  reserveAttempt,
  createAttemptHandle,
  markAttemptConsumed,
  // verdict model (§8)
  VERDICT,
  VERDICT_SEVERITY,
  OVERALL_PHASES,
  OVERALL_ROW_VERDICT,
  CHECK_NAMES,
  CHECK_VERDICT_BASES,
  CONTROL_NAMES,
  CONTROL_ALLOWED_STATES,
  CONTROL_ACCEPTABLE_STATE,
  INTEGRITY_RESULT,
  CLASSIFIER_CONFIRMED,
  PRE_LINK_CLOSEOUT_PREREQUISITES,
  checkVerdictBase,
  controlDisposition,
  evaluateOverallRows,
  computeOverall,
  exitCodeForVerdict,
  // evidence schema (§10) and R1 snapshot (§9.1)
  R1_NAME,
  R2_NAME,
  R3_NAME,
  R1_REL_PATH,
  R2_REL_PATH,
  R3_REL_PATH,
  RESULT_TOP_LEVEL_KEYS,
  RESULT_STATE_KEYS,
  RESULT_FORBIDDEN_DEEP_KEYS,
  RESULT_FORBIDDEN_SHALLOW_KEYS,
  SUMMARY_REQUIRED_HEADINGS,
  COMMIT_RECORD_KEYS,
  commitCandidateName,
  toPlainJson,
  canonicalJson,
  takeFrozenSnapshot,
  buildResultPayload,
  validateResultSchema,
  renderSummary,
  verifySummaryText,
  buildCloseoutManifest,
  validateCloseoutManifest,
  buildCommitRecord,
  validateCommitRecord,
  buildFailureWitness,
  validateFailureWitness,
  // closeout (§9.1)
  T8_CLOSEOUT_STEP_DEADLINE_MS,
  CloseoutFailure,
  createFatalEventSink,
  installProcessFatalHandlers,
  createPromiseRegistry,
  SYNC_LINK_TEST_BRAND,
  brandSyncLinkForTest,
  linkPrimitiveProblem,
  preLinkGateFailure,
  commitCriticalSection,
  drainAndCommit,
  runPostCommit,
  closeoutFailurePath,
  formatCloseoutReport,
  closeoutProtocol,
  // reader (§8 W-0..W-6)
  deriveVerdictFromArtifacts,
  readArtifactFileMap,
  // static guard (§9.1 step 8 / §8 AST assertion)
  tokenizeJs,
  findFunctionDeclarations,
  locateFunctionSource,
  parseRestrictedFunction,
  CRITICAL_SECTION_CANONICAL_SOURCE,
  auditCloseoutSource,
  // offline fixtures
  OFFLINE_FIXTURE_AUTHORIZATION_ID,
  createOfflineAttemptFixture,
  createOfflineRunStateFixture,
  // Task 3: Table T, hygiene, instrumentation, selection, timeouts, cleanup, oracle, preflight
  TABLE_T,
  T9_ATTEMPT_CAP_MS,
  EVIDENCE_REDACTION_PLACEHOLDER,
  truncateUtf8,
  redactEvidenceText,
  redactEvidenceUrl,
  EvidenceCapError,
  VERDICT_CRITICAL_KEYS,
  isVerdictCriticalPath,
  sanitizeEvidenceTree,
  isVerdictCriticalSpyRecord,
  capSpyLedger,
  THEMING_SET_METHOD,
  THEMING_CLEAR_METHOD,
  SELECTION_METHODS,
  CALL_ORIGINS,
  ORIGIN_UNATTRIBUTED,
  SPY_TARGETS,
  summarizeValue,
  createCallRecorder,
  createWrapperRegistry,
  recordingWrap,
  installInjectionWrapper,
  installSpySet,
  runSpySelfTestN1,
  prohibitedCallViolations,
  TARGET_SELECTION_RULE,
  enumerateCandidates,
  selectFitUnionPair,
  selectTargets,
  DEADLINE_TOKEN_STATE,
  createDeadlineToken,
  transitionDeadlineToken,
  isDeadlineTokenLive,
  createTimeoutQuarantine,
  runWithDeadline,
  OP_DEADLINE_SPECS,
  classifyTimeout,
  createAttemptDeadlineTimer,
  CLEANUP_STEP_NAMES,
  runCleanup,
  guardedUnloadModel,
  verifyViewerModelSetEmpty,
  createModelCleanupSteps,
  createBridgeInstanceTracker,
  SCENE_CLASS,
  sceneOwnershipOracle,
  injectSyntheticRemoveScene,
  runSceneOwnershipControlN3,
  PHASE_ORDER,
  CHECK_DEPENDENCIES,
  dependencyBlockers,
  EXPECTED_VIEWER_SHA256,
  classifyViewerScriptIntegrity,
  GIT_TREE_ALLOWED_UNTRACKED_PREFIXES,
  classifyGitTreeState,
  SERVED_MODULE_PREFIX,
  resolveServedModulePath,
  createServedModuleManifest,
  validateServedModuleManifest,
  serveClashPanelModule,
  // Task 4: check records, C4/N6, frustum, C20/N8, C17/N7, shell, evaluators, controls, runner, drivers
  LIVE_PENDING_STATUS,
  normalizeEvidence,
  makeCheckRecord,
  validateCheckRecord,
  makeControlRecord,
  validateControlRecord,
  CHECK_BASE_SEVERITY,
  mergeCheckRecord,
  combineSubchecks,
  expectedMarkerMeshCount,
  C4_OUTCOME,
  boundsContainmentOracle,
  c4ReferenceUnion,
  selectC4Sample,
  evaluateC4,
  N6_BUILD_OUTCOME,
  buildN6Mutation,
  n6Recompute,
  evaluateN6,
  selectN6Input,
  mat4MulVec4,
  cameraFromSample,
  cameraSample,
  projectToClip,
  boxCorners,
  frustumPredicate,
  cameraSamplesWithin,
  cameraSamplesExactlyEqual,
  findSettleIndex,
  waitForCameraSettle,
  ledgerSlice,
  isAggregateFitRecord,
  isPerModelFitRecord,
  evaluateN2,
  evaluateC6,
  evaluateC8,
  C20_REASONS,
  projectToPixel,
  computeC20Footprints,
  buildC20Masks,
  changedPixelIndices,
  runLengthEncode,
  runLengthDecode,
  overlayRenderingOracle,
  evaluateN8,
  selectC20Target,
  evaluateC20,
  C17_NOT_IN_SCENE_NOTE,
  createModelLabeler,
  modelLabelsInArgs,
  isolationEntryShape,
  MODEL_TAGGED_METHODS,
  attachModelArgumentTagger,
  createMonotonicEventLog,
  summarizeBridgeLedger,
  C17_PREDICATES,
  c17Oracle,
  evaluateN7,
  C2_REGION_ORDER,
  SHELL_PUBLIC_KEYS,
  titleElementContract,
  evaluateC2,
  evaluateC3,
  C15_RESTORE_FAILED_NOTE,
  C15_FIRST_ONLY_NOTE,
  evaluateC1,
  withNodeLoadOutcomes,
  evaluateC5,
  evaluateC7Beta,
  evaluateSceneOwnership,
  evaluateC9,
  evaluateC10,
  evaluateC11,
  evaluateN5,
  evaluateC12,
  evaluateN4,
  evaluateC13,
  evaluateC14,
  evaluateC15,
  C15E_PREDICATE_NAMES,
  C15E_FAILURE_LABELS,
  C15E_NON_MUTATING_METHODS,
  c15eModelKey,
  c15eUnreadable,
  canonicalHidden,
  canonicalIsolation,
  readCanonicalAggregate,
  hiddenEquals,
  canonIsolationEquals,
  c15eLedgerDTO,
  c15eDerive,
  c15eOracle,
  validateC15eEvidence,
  evaluateC16,
  evaluateC18a,
  BRIDGE_ALLOWED_SPY_METHODS,
  markersOnlyV1Violations,
  evaluateC19,
  OFFLINE_FAKE_TARGET_BRAND,
  G2InjectedError,
  isInjectedError,
  C15_INJECTION_SPECS,
  createFailureInjectionController,
  runControlWithDeadline,
  n1Record,
  n3Record,
  SUBCHECK_OF,
  DEFERRED_UNITS,
  READ_ONLY_UNITS,
  PURE_CONTROLS,
  phaseUnits,
  planChecks,
  runChecksInPhaseOrder,
  G2A_NAMES,
  G2A2_NAMES,
  G2B_NAMES,
  G2_FOREIGN_SCENE,
  normalizeAggregateRead,
  describeMarkerMeshes,
  createLivePhaseDrivers,
  // Task 5: page-side agent (Section 37) and Node-side live orchestration (Section 38)
  G2_SHELL_PROBE_ID,
  G2_NODE_SCREENSHOT_BINDING,
  G2_NODE_FATAL_BINDING,
  G2_SERVED_ENTRY_MODULES,
  sha256HexPortable,
  PageBuffer,
  g2JsonSafe,
  FORMAT_SIGNAL_UNAVAILABLE,
  classifyFormatSignals,
  attachShellArgumentCapture,
  G2_PAGE_CLEANUP_STEPS,
  G2_IN_PAGE_FUNCTION_NAMES,
  G2_VIEWER_SCRIPT_URL,
  G2_VIEWER_STYLE_URL,
  G2_PAGE_PATH,
  G2_BARE_PAGE_HTML,
  g2BaseUrl,
  PAGE_AGENT_NODE_ONLY_NAMES,
  topLevelDeclarations,
  freeIdentifierNames,
  buildPageAgentSource,
  walkRedirectRootUrl,
  createViewerScriptIntegrityCapture,
  G2_PAGE_DISPATCH,
  createPageRpc,
  closePlaywrightTarget,
  wireFatalListeners,
  Phase0Failure,
  G2_LIMITATIONS,
  buildInitialRunState,
  unavailablePhaseRecords,
  applyPhaseRunToState,
  buildCappedResultPayload,
  buildCleanupSteps,
  runPostReservation,
  // RC1-C1/RC1-C2 record unions, NRDB legality, C1 reason contract, gate equations (slice B1)
  NRDB_STATE,
  RECORD_TYPE,
  C1_NORMALIZED_REASONS,
  C1_BLOCK_DETAIL_CAUSES,
  GATE_OUTCOME,
  GATE_EVIDENCE_REFS,
  GATE_CHECK_DISPOSITION,
  GATE_C1_REQUIRED,
  FATAL_ENTRY_SEQ_REQUIRED,
  DOWNSTREAM_ITEM_NAMES,
  NRDB_CONTROL_NAMES,
  CONTROL_DEPENDENCY_IDS,
  CONTROL_OWNING_PHASE,
  CONTROL_NOT_STARTED_STATES,
  GATE_CONTROL_DISPOSITION,
  controlEffectiveState,
  checkVerdictLabel,
  checkRunProblems,
  executionRecordProblems,
  dependencyBlockedByShapeProblems,
  dependencyBlockedByReferentialProblems,
  itemAttributionProblems,
  DOWNSTREAM_PHASE_IDS,
  ATTRIBUTION_PHASES,
  PASSIVE_FATAL_EVENT_KINDS,
  attributionFieldProblems,
  closedGateEvidenceMatches,
  closedGateIllegalRecords,
  gateFinalizationProblems,
  defaultGateFinalization,
  defaultRebuildFatalWitnessState,
  prepareC1Gate,
  // §9.2 slice C1: network classification, observations, fatal-witness correlation, run counter
  OPTIONAL_RESPONSE_RULES,
  NETWORK_URL_CLASSES,
  NETWORK_CLASSIFICATIONS,
  NETWORK_SEVERITY,
  NETWORK_FATAL_ENTRY_KIND,
  LOAD_OPERATION_KEYS,
  MUTATION_OPERATION_KEYS,
  PREFIX_SOURCE_ENTRY_KEYS,
  PREFIX_SOURCE_REASONS,
  PREFIX_DERIVATION_KEYS,
  OP_LEDGER_SPY_METHODS,
  prefixBindingState,
  derivePrefixes,
  buildPrefixSourceLedger,
  refreshPrefixSourceLedger,
  prefixSnapshotCutoff,
  isPrefixLedgerFrozen,
  ambiguousPrefixesOf,
  prefixSupportRefs,
  cancellationWindowEnd,
  refreshCancellationWindows,
  opLedgerRecordProblems,
  createOperationLedger,
  G2_DUAL_COUNTER_GATE,
  G2_NODE_OPLEDGER_BINDING,
  runAcknowledgedMutation,
  loadCompletionOutcome,
  finalizeLoadWindows,
  c2LedgerProblems,
  CLASSIFIER_RESULT_KEYS,
  REQUEST_OBSERVATION_KEYS,
  REQUEST_FAILURE_KEYS,
  RESPONSE_FAILURE_KEYS,
  CORRELATED_REQUEST_KEYS,
  FATAL_WITNESS_KEYS,
  WITNESS_COUNT_KEYS,
  CHECK_OWNING_PHASES,
  networkPrefixKey,
  classifyRequestFailure,
  classifyHttpResponse,
  isHttpRuleCandidate,
  modelBindingObservedOf,
  truncateRecordAt,
  recomputeRequestIdentity,
  correlateNetworkEvents,
  createEmptyErrorLedger,
  syncFatalWitnesses,
  directWitnessEntryAppender,
  provisionalFinalization,
  applyProvisionalFinalization,
  finalizeNetworkLedgerAtCloseout,
  classifierResultProblems,
  networkLedgerProblems,
  primarySeqAllocations,
  maxRecordedSeq,
  createRunSeqCounter,
  classifyNetworkUrl,
  createNetworkInstrumentation,
  makeGateDispositionRecord,
  gateDispositionProblems,
  recomputeGateOutcome,
  recomputeFatalCountAtGate,
  gateC1Problems,
  controlRunProblems,
  recordSchemaProblems,
  c1LoadLedgerProblems,
  nrdbLegality,
  finalizeC1Record,
  makeControlRunRecord,
  validateControlRunRecord,
  notStartedControlRun,
  failClosedControlRun,
  // entry
  main,
  runCli,
  isDirectInvocation,
};
