// Offline evidence-manifest builder prototype (contract.manifestSchema, spec part 2 §13/App. v). Pure, deterministic; writes nothing.
// buildManifest(fileEntries, meta?) -> { ok, findings, manifest }.
//   fileEntries: [{ path, bytes: Uint8Array|Buffer, role: 'raw'|'derived', fileClass?, phase?, inputs?: hex64[], supersedesSha256?, ledgerSeq? }]
//   meta (optional): top-level manifest fields (authorizationId, attemptId, runId, bindingSha256, authorizationRecordSha256, digests,
//                    terminalVerdict, terminalVerdictSha256, ...). Absent required keys make the result's `complete` false (the manifest itself carries no such key).
import { createHash } from 'node:crypto';

export const MANIFEST_PATH = 'MANIFEST.json';
const HEX64 = /^[0-9a-f]{64}$/;
const CLASSES = ['governance', 'preflight', 'env', 'raw', 'rawDerivedByRule', 'derived', 'terminal'];
const PHASES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
const RAW_CLASSES = new Set(['governance', 'preflight', 'env', 'raw']);
const NEEDS_INPUTS = new Set(['derived', 'rawDerivedByRule', 'terminal']);
// terminalVerdict: one of the five verdicts, or WITHHELD when the verdict is withheld (SC-C03/SC-C04; Part 2 §13.5, App. v)
const VERDICTS = ['BLOCKED', 'INVALID', 'INCONCLUSIVE', 'REJECTED', 'SUPPORTED', 'WITHHELD'];
/** The hash ledger is listed without ledgerSeq: it cannot carry its own digest; MANIFEST.hashLedgerSha256 does (§13.4). */
export const LEDGER_PATH = 'raw/hash-ledger.jsonl';
/** The two possible terminal carriers (Appendix (v) terminalCarrierPath): exactly one exists in the run root. */
export const TERMINAL_VERDICT_PATH = 'TERMINAL-VERDICT.json';
export const CLOSEOUT_PATH = 'SC-C03-CLOSEOUT.json';
export const TERMINAL_CARRIERS = [TERMINAL_VERDICT_PATH, CLOSEOUT_PATH];

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canon(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite number'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  throw new Error(`non-serializable value of type ${typeof v}`);
}

/** Canonical JSON bytes (UTF-16 key order, no whitespace, no trailing newline per contract canonicalization). */
export function serializeManifest(manifest) { return Buffer.from(canon(manifest), 'utf8'); }

/** Returns an error string for an unsafe relative path, else null. */
export function pathProblem(p) {
  if (typeof p !== 'string' || p.length === 0) return 'empty or non-string';
  if (p.includes('\0')) return 'NUL byte';
  if (p.includes('\\')) return 'backslash';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('//')) return 'absolute path';
  if (p.startsWith('~')) return 'home-relative path';
  if (p.endsWith('/')) return 'trailing slash';
  if (p !== p.normalize('NFC')) return 'not NFC-normalized';
  for (const seg of p.split('/')) {
    if (seg === '') return 'empty segment';
    if (seg === '.') return '"." segment';
    if (seg === '..') return '".." segment';
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(seg)) return 'control character';
  }
  return null;
}

function inferClass(path) {
  if (path === TERMINAL_VERDICT_PATH || path === CLOSEOUT_PATH) return 'terminal';
  const top = path.split('/')[0];
  if (top === 'governance' || top === 'preflight' || top === 'env' || top === 'derived') return top;
  if (top === 'raw') return /^raw\/(?:control|target)\/[^/]+\.trace\.json$/.test(path) ? 'rawDerivedByRule' : 'raw';
  return null;
}
const inferPhase = (cls, path) => {
  if (cls === 'governance' || cls === 'preflight' || cls === 'env') return 'P0';
  if (cls === 'derived' || cls === 'terminal') return 'P5';
  if (path.startsWith('raw/control/')) return 'P2';
  if (path.startsWith('raw/target/') || path === 'raw/quiescence.json') return 'P3';
  if (cls === 'raw' || cls === 'rawDerivedByRule') return 'P4';
  return null;
};

export function buildManifest(fileEntries, meta = null) {
  const findings = [];
  const f = (m) => findings.push(m);
  if (!Array.isArray(fileEntries)) return { ok: false, findings: ['ENTRIES_NOT_ARRAY'], manifest: null };
  const seen = new Map();
  const seenFold = new Map();
  const files = [];
  fileEntries.forEach((e, idx) => {
    const label = e && typeof e.path === 'string' ? e.path : `#${idx}`;
    if (!e || typeof e !== 'object') { f(`ENTRY_INVALID: ${label}`); return; }
    const pp = pathProblem(e.path);
    if (pp) { f(`PATH_UNSAFE: ${JSON.stringify(e.path)} (${pp})`); return; }
    if (e.path === MANIFEST_PATH || e.path.endsWith('/' + MANIFEST_PATH)) { f(`MANIFEST_LISTS_ITSELF: ${e.path}`); return; }
    if (seen.has(e.path)) { f(`PATH_DUPLICATE: ${e.path}`); return; }
    seen.set(e.path, idx);
    const fold = e.path.toLowerCase();
    if (seenFold.has(fold)) f(`PATH_CASE_COLLISION: ${e.path} vs ${seenFold.get(fold)}`);
    else seenFold.set(fold, e.path);
    if (!(e.bytes instanceof Uint8Array)) { f(`BYTES_NOT_UINT8ARRAY: ${e.path}`); return; }
    if (e.role !== 'raw' && e.role !== 'derived') { f(`ROLE_INVALID: ${e.path} role ${JSON.stringify(e.role)}`); return; }
    const inferred = inferClass(e.path);
    const cls = e.fileClass !== undefined ? e.fileClass : (inferred === null ? (e.role === 'raw' ? 'raw' : 'derived') : inferred);
    if (!CLASSES.includes(cls)) { f(`FILECLASS_INVALID: ${e.path} class ${JSON.stringify(cls)}`); return; }
    const isRawClass = RAW_CLASSES.has(cls);
    // Raw vs derived separation: role and class and directory must agree.
    if (e.role === 'raw' && !(isRawClass || cls === 'rawDerivedByRule')) f(`RAW_DERIVED_SEPARATION: ${e.path} has role raw but class ${cls}`);
    if (e.role === 'derived' && (isRawClass)) f(`RAW_DERIVED_SEPARATION: ${e.path} has role derived but class ${cls}`);
    if (inferred !== null && e.fileClass !== undefined && e.fileClass !== inferred) f(`FILECLASS_CONTRADICTS_PATH: ${e.path} class ${cls} but path implies ${inferred}`);
    if (inferred !== null && e.fileClass === undefined && e.role === 'raw' && (inferred === 'derived' || inferred === 'terminal')) f(`RAW_DERIVED_SEPARATION: ${e.path} has role raw but lives in a derived location`);
    if (inferred !== null && e.fileClass === undefined && e.role === 'derived' && (inferred === 'raw' || inferred === 'governance' || inferred === 'preflight' || inferred === 'env')) f(`RAW_DERIVED_SEPARATION: ${e.path} has role derived but lives in a raw location`);
    const phase = e.phase !== undefined ? e.phase : inferPhase(cls, e.path);
    if (!PHASES.includes(phase)) f(`PHASE_INVALID: ${e.path} phase ${JSON.stringify(phase)}`);
    if (isRawClass && e.inputs !== undefined) f(`RAW_FILE_HAS_INPUTS: ${e.path}`);
    if (!isRawClass && e.supersedesSha256 !== undefined && !HEX64.test(e.supersedesSha256)) f(`SUPERSEDES_NOT_HEX64: ${e.path}`);
    if (isRawClass && e.supersedesSha256 !== undefined) f(`RAW_FILE_SUPERSEDES: ${e.path}`);
    if (e.ledgerSeq !== undefined && !(Number.isInteger(e.ledgerSeq) && e.ledgerSeq >= 1)) f(`LEDGERSEQ_INVALID: ${e.path}`);
    if (e.path === LEDGER_PATH && e.ledgerSeq !== undefined) f(`LEDGER_HAS_LEDGERSEQ: ${e.path}`);
    const entry = { path: e.path, sha256: sha256Hex(e.bytes), bytes: e.bytes.length, fileClass: cls, phase };
    if (e.path !== LEDGER_PATH) entry.ledgerSeq = e.ledgerSeq !== undefined ? e.ledgerSeq : idx + 1;
    if (NEEDS_INPUTS.has(cls)) {
      if (!Array.isArray(e.inputs) || e.inputs.length === 0 || !e.inputs.every((x) => typeof x === 'string' && HEX64.test(x))) f(`INPUTS_REQUIRED: ${e.path} (class ${cls} needs a non-empty hex64 inputs array)`);
      else entry.inputs = [...new Set(e.inputs)].sort();
    }
    if (e.supersedesSha256 !== undefined && !isRawClass) entry.supersedesSha256 = e.supersedesSha256;
    files.push(entry);
  });

  // ledgerSeq uniqueness.
  const seqs = new Set();
  for (const x of files) { if (x.ledgerSeq === undefined) continue; if (seqs.has(x.ledgerSeq)) f(`LEDGERSEQ_DUPLICATE: ${x.ledgerSeq}`); seqs.add(x.ledgerSeq); }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Derived inputs must point at digests of files in the inventory; a derived file never feeds a raw one.
  const byDigest = new Map();
  for (const x of files) { if (!byDigest.has(x.sha256)) byDigest.set(x.sha256, []); byDigest.get(x.sha256).push(x); }
  for (const x of files) for (const d of x.inputs || []) {
    const src = byDigest.get(d);
    if (!src) f(`INPUT_NOT_IN_INVENTORY: ${x.path} reads ${d}`);
    else if (src.some((s) => s.path === x.path)) f(`INPUT_IS_SELF: ${x.path}`);
    else if (x.fileClass === 'rawDerivedByRule' && !src.some((s) => s.fileClass === 'raw')) f(`RAW_DERIVED_BY_RULE_INPUT_NOT_RAW: ${x.path}`);
  }

  const manifest = { manifestSchemaVersion: 1, files };
  const ledger = files.find((x) => x.path === LEDGER_PATH);
  if (ledger) manifest.hashLedgerSha256 = ledger.sha256;
  let complete = false;
  if (meta !== null && meta !== undefined) {
    if (typeof meta !== 'object' || Array.isArray(meta)) f('META_NOT_OBJECT');
    else {
      for (const k of Object.keys(meta).sort()) {
        if (k === 'files' || k === 'manifestSchemaVersion') { f(`META_OVERRIDES_RESERVED_KEY: ${k}`); continue; }
        if (k === 'hashLedgerSha256' && ledger && meta[k] !== ledger.sha256) { f('HASH_LEDGER_DIGEST_MISMATCH'); continue; }
        manifest[k] = meta[k];
      }
      const req = ['authorizationId', 'attemptId', 'runId', 'bindingSha256', 'authorizationRecordSha256', 'digests', 'hashLedgerSha256', 'terminalVerdict', 'terminalCarrierPath', 'terminalVerdictSha256'];
      const missing = req.filter((k) => manifest[k] === undefined);
      for (const k of missing) f(`META_REQUIRED_MISSING: ${k}`);
      if (manifest.authorizationId !== undefined && !/^[a-z0-9-]{8,64}$/.test(manifest.authorizationId)) f('META_AUTHORIZATION_ID_FORMAT');
      if (manifest.attemptId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(manifest.attemptId)) f('META_ATTEMPT_ID_FORMAT');
      if (manifest.runId !== undefined && !/^[a-z0-9-]{1,32}$/.test(manifest.runId)) f('META_RUN_ID_FORMAT');
      for (const k of ['bindingSha256', 'authorizationRecordSha256', 'hashLedgerSha256', 'terminalVerdictSha256']) if (manifest[k] !== undefined && !HEX64.test(manifest[k])) f(`META_NOT_HEX64: ${k}`);
      if (manifest.terminalVerdict !== undefined && !VERDICTS.includes(manifest.terminalVerdict)) f('META_TERMINAL_VERDICT_INVALID');
      // Terminal carrier (Appendix (v) terminalCarrierPath): exactly one terminal-class file; terminalVerdictSha256 is the digest of the file AT terminalCarrierPath.
      const tv = files.find((x) => x.path === TERMINAL_VERDICT_PATH);
      const co = files.find((x) => x.path === CLOSEOUT_PATH);
      const cp = manifest.terminalCarrierPath;
      if (cp !== undefined && !TERMINAL_CARRIERS.includes(cp)) f('TERMINAL_CARRIER_PATH_INVALID');
      if (tv && co) f('TERMINAL_CARRIER_AMBIGUOUS: both TERMINAL-VERDICT.json and SC-C03-CLOSEOUT.json are listed');
      if (files.some((x) => x.fileClass === 'terminal' && !TERMINAL_CARRIERS.includes(x.path))) f('TERMINAL_CARRIER_AMBIGUOUS: unknown terminal-class file');
      if (!tv && !co) f('TERMINAL_CARRIER_MISSING: no terminal carrier file is listed');
      if (TERMINAL_CARRIERS.includes(cp)) {
        const carrier = cp === CLOSEOUT_PATH ? co : tv;
        if (!carrier) { if (tv || co) f(`TERMINAL_CARRIER_MISSING: terminalCarrierPath ${cp} is not listed`); }
        else if (manifest.terminalVerdictSha256 !== undefined && manifest.terminalVerdictSha256 !== carrier.sha256) f('TERMINAL_VERDICT_DIGEST_MISMATCH');
        if (cp === CLOSEOUT_PATH) {
          if (manifest.terminalVerdict !== undefined && manifest.terminalVerdict !== 'WITHHELD') f('CLOSEOUT_REQUIRES_WITHHELD');
          if (files.some((x) => x.path.startsWith('derived/') || x.fileClass === 'derived')) f('CLOSEOUT_WITH_DERIVED');
        } else if (co) f('TERMINAL_VERDICT_WITH_CLOSEOUT');
      }
      if (manifest.digests && typeof manifest.digests === 'object') {
        for (const k of ['repoCommit', 'procedureSha256', 'acceptanceHarnessSha256', 'diagnosticHarnessSha256', 'diagnosticPackageSha256', 'diagnosticSpecSha256', 'targetPlanSha256', 'viewerVersionObserved', 'viewerBundleSha256Observed', 'traceStreamSha256ByRole']) if (manifest.digests[k] === undefined) f(`META_DIGESTS_MISSING: ${k}`);
      }
      complete = missing.length === 0;
    }
  }
  findings.sort();
  const ok = findings.length === 0;
  return { ok, findings, complete: ok && complete, manifest: ok ? manifest : null };
}
