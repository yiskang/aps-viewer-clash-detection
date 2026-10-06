// SC-C03 closeout (Part 2 §13.7, Appendix (viii)): offline research prototype. [SYN] Pure and deterministic: nothing here touches the
// file system, a Viewer, a browser or the network; every "directory" below is an in-memory object.
//
// Structural fix modelled here: when the two scratch analyses A and B differ, A and B stay byte-identical to the compared bytes
// (never rewritten or annotated), no derived/* and no TERMINAL-VERDICT.json are published, and a separate deterministic
// SC-C03-CLOSEOUT.json (the terminal carrier) records the WITHHELD decision. The closeout is a pure function of the two file tables
// (path, byte length, SHA-256), the run identity and the raw input digests: no timestamp, no absolute path, no evaluator output and
// nothing derived from file CONTENT other than hashes and lengths.
//
//   analysisTable(files, bounds?) / bundleDigest(table) / compareAnalyses(tableA, tableB)
//   buildCloseout(input, contract)            -> { ok, findings, closeout, bytes, sha256 }
//   validateCloseout(bytes, ctx, contract)    -> { ok, findings, recomputed }   (includes the P5.10 recompute from retained A/B)
//   simulateFinalization(opts, contract)      -> in-memory model of P5.01-P5.12 with an explicit event log
//   syntheticScC03Demo(contract)              -> deterministic synthetic mismatch scenario (used by run-preparation.mjs)
import { canonicalStringify, canonicalBytes, sha256 } from './envelope.mjs';
import { buildManifest, serializeManifest, pathProblem, LEDGER_PATH, MANIFEST_PATH, TERMINAL_VERDICT_PATH, CLOSEOUT_PATH } from './manifest-builder.mjs';

export { CLOSEOUT_PATH };
const HEX64 = /^[0-9a-f]{64}$/;
const AUTH_ID = /^[a-z0-9-]{8,64}$/;
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID = /^[a-z0-9-]{1,32}$/;
const isBytes = (b) => b instanceof Uint8Array;
const copy = (b) => Buffer.from(b); // defensive copy: a Buffer that owns its bytes
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0); // UTF-16 code-unit order
const sortedPaths = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const DEFAULT_BOUNDS = Object.freeze({ maxBytes: 262144, maxFilesPerAnalysis: 128, maxDifferingEntries: 256, maxPathBytes: 128 });
const boundsOf = (contract) => (contract && contract.closeoutSchema && contract.closeoutSchema.bounds) || DEFAULT_BOUNDS;

/** Thrown by analysisTable; carries machine-readable findings. */
export class CloseoutError extends Error {
  constructor(findings) { super(findings.join('; ')); this.name = 'CloseoutError'; this.findings = findings; }
}

/** files: { path: Uint8Array } (or Map). Returns the sorted [{bytes, path, sha256}] table (Appendix (viii) bundleRule). Throws CloseoutError, never truncates. */
export function analysisTable(files, bounds = DEFAULT_BOUNDS) {
  const entries = files instanceof Map ? [...files.entries()] : (files && typeof files === 'object' && !Array.isArray(files) ? Object.entries(files) : null);
  if (!entries) throw new CloseoutError(['ANALYSIS_FILES_NOT_OBJECT']);
  const F = [];
  if (entries.length > bounds.maxFilesPerAnalysis) F.push(`ANALYSIS_FILE_COUNT_EXCEEDED: ${entries.length} > ${bounds.maxFilesPerAnalysis}`);
  const table = [];
  const fold = new Map();
  for (const [p, b] of entries) {
    const pp = pathProblem(p);
    if (pp) { F.push(`ANALYSIS_PATH_UNSAFE: ${JSON.stringify(p)} (${pp})`); continue; }
    if (Buffer.byteLength(p, 'utf8') > bounds.maxPathBytes) F.push(`ANALYSIS_PATH_TOO_LONG: ${Buffer.byteLength(p, 'utf8')} bytes > ${bounds.maxPathBytes}`);
    const lower = p.toLowerCase();
    if (fold.has(lower)) F.push(`ANALYSIS_PATH_CASE_COLLISION: ${p} vs ${fold.get(lower)}`); else fold.set(lower, p);
    if (!isBytes(b)) { F.push(`ANALYSIS_BYTES_NOT_UINT8ARRAY: ${p}`); continue; }
    table.push({ bytes: b.length, path: p, sha256: sha256(b) });
  }
  if (F.length) throw new CloseoutError(F.sort());
  return table.sort(byPath);
}

/** SHA-256 of the canonical UTF-8 string of the sorted table (Appendix (viii) bundleRule). */
export const bundleDigest = (table) => sha256(Buffer.from(canonicalStringify(table), 'utf8'));
const analysisSummary = (table) => ({ bundleSha256: bundleDigest(table), fileCount: table.length, files: table.map((e) => ({ bytes: e.bytes, path: e.path, sha256: e.sha256 })), totalBytes: table.reduce((s, e) => s + e.bytes, 0) });

/** Per-file comparison of two tables (tables only; never file content). */
export function compareAnalyses(tableA, tableB) {
  const a = new Map(tableA.map((e) => [e.path, e])); const b = new Map(tableB.map((e) => [e.path, e]));
  const differing = [];
  for (const p of sortedPaths(new Set([...a.keys(), ...b.keys()]))) {
    const x = a.get(p); const y = b.get(p);
    if (x && y) { if (x.sha256 !== y.sha256 || x.bytes !== y.bytes) differing.push({ bytesA: x.bytes, bytesB: y.bytes, kind: 'CONTENT', path: p, sha256A: x.sha256, sha256B: y.sha256 }); }
    else if (x) differing.push({ bytesA: x.bytes, bytesB: null, kind: 'ONLY_IN_A', path: p, sha256A: x.sha256, sha256B: null });
    else differing.push({ bytesA: null, bytesB: y.bytes, kind: 'ONLY_IN_B', path: p, sha256A: null, sha256B: y.sha256 });
  }
  return { identical: differing.length === 0, differing };
}

function checkIdentityAndInputs(i, F) {
  const idn = (i && i.identity) || {};
  if (typeof idn.authorizationId !== 'string' || !AUTH_ID.test(idn.authorizationId)) F.push('CLOSEOUT_IDENTITY_FORMAT: authorizationId');
  if (typeof idn.attemptId !== 'string' || !ATTEMPT_ID.test(idn.attemptId)) F.push('CLOSEOUT_IDENTITY_FORMAT: attemptId');
  if (typeof idn.runId !== 'string' || !RUN_ID.test(idn.runId)) F.push('CLOSEOUT_IDENTITY_FORMAT: runId');
  const ids = i && i.inputDigests;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string' && HEX64.test(x))) F.push('CLOSEOUT_INPUT_DIGESTS_INVALID: non-empty hex64 array required');
  for (const k of ['bindingSha256', 'targetPlanSha256']) if (typeof (i && i[k]) !== 'string' || !HEX64.test(i[k])) F.push(`CLOSEOUT_NOT_HEX64: ${k}`);
  if (Array.isArray(ids) && typeof i.targetPlanSha256 === 'string' && !ids.includes(i.targetPlanSha256)) F.push('CLOSEOUT_TARGET_PLAN_NOT_IN_INPUTS: governance/target-plan.json digest must be among inputDigests');
}

/** Builds the closeout from already-computed tables (the compared tables). Pure. */
function closeoutFromTables(i, tableA, tableB, contract, F) {
  const bounds = boundsOf(contract);
  const schema = contract.closeoutSchema;
  checkIdentityAndInputs(i, F);
  const cmp = compareAnalyses(tableA, tableB);
  if (cmp.identical) F.push('CLOSEOUT_REFUSED_IDENTICAL_ANALYSES: no closeout is produced for byte-identical analyses');
  if (cmp.differing.length > bounds.maxDifferingEntries) F.push(`CLOSEOUT_DIFFERING_EXCEEDED: ${cmp.differing.length} > ${bounds.maxDifferingEntries}`);
  if (F.length) return null;
  const closeout = {
    ...schema.fixed,
    authorizationId: i.identity.authorizationId, attemptId: i.identity.attemptId, runId: i.identity.runId,
    comparison: { differing: cmp.differing, differingCount: cmp.differing.length, method: schema.properties.comparison.method, result: schema.properties.comparison.result },
    analysisA: analysisSummary(tableA), analysisB: analysisSummary(tableB),
    promotion: { ...schema.properties.promotion.fixed },
    attempt: { ...schema.properties.attempt.fixed },
    inputDigests: [...new Set(i.inputDigests)].sort(),
    bindingSha256: i.bindingSha256, targetPlanSha256: i.targetPlanSha256,
  };
  const bytes = canonicalBytes(closeout);
  if (bytes.length > bounds.maxBytes) { F.push(`CLOSEOUT_TOO_LARGE: ${bytes.length} > ${bounds.maxBytes}`); return null; }
  return { closeout, bytes, sha256: sha256(bytes) };
}

/**
 * input: { identity: {authorizationId, attemptId, runId}, filesA, filesB, inputDigests, bindingSha256, targetPlanSha256 }.
 * Refuses (findings, no closeout) for identical analyses, any exceeded bound (never truncates) and malformed identity.
 */
export function buildCloseout(input, contract) {
  const F = [];
  let tA; let tB;
  const bounds = boundsOf(contract);
  try { tA = analysisTable(input && input.filesA, bounds); } catch (e) { if (e instanceof CloseoutError) F.push(...e.findings.map((x) => `A:${x}`)); else throw e; }
  try { tB = analysisTable(input && input.filesB, bounds); } catch (e) { if (e instanceof CloseoutError) F.push(...e.findings.map((x) => `B:${x}`)); else throw e; }
  if (F.length) { checkIdentityAndInputs(input, F); return { ok: false, findings: [...new Set(F)].sort(), closeout: null, bytes: null, sha256: null }; }
  const r = closeoutFromTables(input, tA, tB, contract, F);
  if (!r) return { ok: false, findings: [...new Set(F)].sort(), closeout: null, bytes: null, sha256: null };
  return { ok: true, findings: [], closeout: r.closeout, bytes: r.bytes, sha256: r.sha256 };
}

const tableFromDoc = (side) => (side && Array.isArray(side.files) ? side.files : []);
const eq = (a, b) => canonicalStringify(a) === canonicalStringify(b);

/**
 * Structural + consistency validation of closeout bytes, and (when ctx.filesA/filesB are given) the P5.10 recompute: the closeout is
 * rebuilt from the retained A and B and must be byte-identical. ctx may also carry identity/inputDigests/bindingSha256/targetPlanSha256
 * to bind the recompute to values taken from elsewhere (otherwise the document's own values are used).
 */
export function validateCloseout(bytes, ctx, contract) {
  const F = [];
  const bounds = boundsOf(contract); const schema = contract.closeoutSchema;
  ctx = ctx || {};
  let doc = null; let recomputed = false;
  if (!isBytes(bytes)) return { ok: false, findings: ['CLOSEOUT_NOT_BYTES'], recomputed };
  if (bytes.length > bounds.maxBytes) F.push(`CLOSEOUT_TOO_LARGE: ${bytes.length} > ${bounds.maxBytes}`);
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { ok: false, findings: [...F, 'CLOSEOUT_NOT_JSON'], recomputed }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, findings: [...F, 'CLOSEOUT_NOT_OBJECT'], recomputed };
  try { if (!Buffer.from(bytes).equals(canonicalBytes(doc))) F.push('CLOSEOUT_NOT_CANONICAL'); } catch { F.push('CLOSEOUT_NOT_CANONICAL'); }
  for (const k of schema.required) if (!(k in doc)) F.push(`CLOSEOUT_REQUIRED_MISSING: ${k}`);
  for (const k of Object.keys(doc)) if (!schema.required.includes(k)) F.push(`CLOSEOUT_UNKNOWN_KEY: ${k}`);
  for (const [k, v] of Object.entries(schema.fixed)) if (k in doc && !eq(doc[k], v)) F.push(`CLOSEOUT_FIXED_FIELD_MISMATCH: ${k}`);
  for (const k of ['promotion', 'attempt']) if (k in doc && !eq(doc[k], schema.properties[k].fixed)) F.push(`CLOSEOUT_FIXED_FIELD_MISMATCH: ${k}`);
  checkIdentityAndInputs({ identity: doc, inputDigests: doc.inputDigests, bindingSha256: doc.bindingSha256, targetPlanSha256: doc.targetPlanSha256 }, F);
  if (Array.isArray(doc.inputDigests)) {
    const s = [...new Set(doc.inputDigests)].sort();
    if (!eq(s, doc.inputDigests)) F.push('CLOSEOUT_INPUT_DIGESTS_NOT_SORTED_UNIQUE');
  }
  // analyses and comparison, recomputed from the closeout's own tables
  let tA = []; let tB = [];
  for (const [name, side] of [['analysisA', doc.analysisA], ['analysisB', doc.analysisB]]) {
    if (!side || typeof side !== 'object') { F.push(`CLOSEOUT_ANALYSIS_INVALID: ${name}`); continue; }
    const t = tableFromDoc(side);
    const sorted = [...t].sort(byPath);
    if (!eq(sorted, t)) F.push(`CLOSEOUT_ANALYSIS_FILES_NOT_SORTED: ${name}`);
    if (t.length > bounds.maxFilesPerAnalysis) F.push(`CLOSEOUT_FILE_COUNT_EXCEEDED: ${name}`);
    for (const e of t) {
      if (!e || !Number.isInteger(e.bytes) || e.bytes < 0 || typeof e.sha256 !== 'string' || !HEX64.test(e.sha256) || typeof e.path !== 'string') { F.push(`CLOSEOUT_FILE_ENTRY_INVALID: ${name}`); continue; }
      const pp = pathProblem(e.path);
      if (pp || Buffer.byteLength(e.path, 'utf8') > bounds.maxPathBytes) F.push(`CLOSEOUT_FILE_PATH_INVALID: ${name} ${JSON.stringify(e.path)}`);
    }
    if (side.fileCount !== t.length) F.push(`CLOSEOUT_FILECOUNT_MISMATCH: ${name}`);
    if (side.totalBytes !== t.reduce((a, e) => a + (Number.isInteger(e.bytes) ? e.bytes : 0), 0)) F.push(`CLOSEOUT_TOTALBYTES_MISMATCH: ${name}`);
    try { if (side.bundleSha256 !== bundleDigest(t)) F.push(`CLOSEOUT_BUNDLE_DIGEST_MISMATCH: ${name}`); } catch { F.push(`CLOSEOUT_ANALYSIS_INVALID: ${name}`); }
    if (name === 'analysisA') tA = t; else tB = t;
  }
  if (doc.analysisA && doc.analysisB && doc.analysisA.bundleSha256 === doc.analysisB.bundleSha256) F.push('CLOSEOUT_IDENTICAL_BUNDLES: a closeout is never produced for identical analyses');
  const c = doc.comparison;
  if (!c || typeof c !== 'object') F.push('CLOSEOUT_COMPARISON_INVALID');
  else {
    if (c.method !== schema.properties.comparison.method || c.result !== schema.properties.comparison.result) F.push('CLOSEOUT_COMPARISON_INVALID: method/result');
    if (!Array.isArray(c.differing) || c.differing.length < 1 || c.differingCount !== c.differing.length) F.push('CLOSEOUT_DIFFERINGCOUNT_MISMATCH');
    else {
      if (c.differing.length > bounds.maxDifferingEntries) F.push('CLOSEOUT_DIFFERING_EXCEEDED');
      try { if (!eq(compareAnalyses(tA, tB).differing, c.differing)) F.push('CLOSEOUT_COMPARISON_NOT_TABLE_DERIVED'); } catch { F.push('CLOSEOUT_COMPARISON_INVALID'); }
    }
  }
  // P5.10 recompute from the retained A and B
  if (ctx.filesA !== undefined && ctx.filesB !== undefined) {
    recomputed = true;
    const rb = buildCloseout({
      identity: ctx.identity || { authorizationId: doc.authorizationId, attemptId: doc.attemptId, runId: doc.runId },
      filesA: ctx.filesA, filesB: ctx.filesB,
      inputDigests: ctx.inputDigests !== undefined ? ctx.inputDigests : doc.inputDigests,
      bindingSha256: ctx.bindingSha256 !== undefined ? ctx.bindingSha256 : doc.bindingSha256,
      targetPlanSha256: ctx.targetPlanSha256 !== undefined ? ctx.targetPlanSha256 : doc.targetPlanSha256,
    }, contract);
    if (!rb.ok) F.push(`CLOSEOUT_RECOMPUTE_MISMATCH: recomputation from retained A/B refused (${rb.findings[0]})`);
    else if (!Buffer.from(bytes).equals(rb.bytes)) F.push('CLOSEOUT_RECOMPUTE_MISMATCH: recomputed closeout bytes differ from the written closeout');
  }
  const findings = [...new Set(F)].sort();
  return { ok: findings.length === 0, findings, recomputed };
}

// ---------------------------------------------------------------- in-memory scratch directory

export class ScratchSealedError extends Error { constructor(msg) { super(msg); this.name = 'ScratchSealedError'; } }
export class FreezeViolation extends Error { constructor(msg) { super(msg); this.name = 'FreezeViolation'; } }

/** Write-once scratch directory outside the run root. Bytes are copied in and out; after seal() every write throws. */
export class ScratchDir {
  #files = new Map();
  #sealed = false;
  constructor(name) { this.name = name; }
  write(path, bytes) {
    if (this.#sealed) throw new ScratchSealedError(`scratch ${this.name} is sealed: write ${path} refused`);
    const pp = pathProblem(path);
    if (pp) throw new CloseoutError([`ANALYSIS_PATH_UNSAFE: ${JSON.stringify(path)} (${pp})`]);
    if (this.#files.has(path)) throw new ScratchSealedError(`scratch ${this.name}: ${path} already exists (write-once)`);
    if (!isBytes(bytes)) throw new CloseoutError([`ANALYSIS_BYTES_NOT_UINT8ARRAY: ${path}`]);
    this.#files.set(path, copy(bytes));
  }
  seal() { this.#sealed = true; }
  get sealed() { return this.#sealed; }
  paths() { return sortedPaths(this.#files.keys()); }
  read(path) { const b = this.#files.get(path); return b === undefined ? undefined : copy(b); }
  /** A fresh copy of every file: path -> Buffer. */
  files() { return Object.fromEntries(this.paths().map((p) => [p, copy(this.#files.get(p))])); }
  /** TEST-ONLY adversary access to the live internal bytes (models an attacker or a bug mutating retained scratch). */
  _unsafeInternals() { return this.#files; }
}

// ---------------------------------------------------------------- finalization simulator (P5.01-P5.12)

const PHASE_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
function rawPhase(path) {
  const top = path.split('/')[0];
  if (top === 'governance' || top === 'preflight' || top === 'env') return 'P0';
  if (path.startsWith('raw/control/') && path !== 'raw/control-disposal.json') return 'P2';
  if (path.startsWith('raw/target/') || path === 'raw/quiescence.json') return 'P3';
  return 'P4';
}
const lineBytes = (l) => Buffer.from(canonicalStringify(l), 'utf8');
const ledgerBytesOf = (lines) => Buffer.from(lines.map((l) => canonicalStringify(l)).join('\n') + (lines.length ? '\n' : ''), 'utf8');

/**
 * opts: { rawFiles: {path: bytes} (the frozen raw files P0-P4; may omit the ledger, which the simulator builds), analyze(rawCopy, {pass}) -> {path: bytes},
 *   identity, bindingSha256?, targetPlanSha256?, authorizationRecordSha256?, inputDigests?, digests?, hooks? }.
 * hooks (all optional, adversarial/test access; each receives the live state `s`): afterCompare, afterCloseout (after the terminal carrier is
 * written), afterManifestWrite (MANIFEST.json written, P5.10 not yet run), afterFreeze.
 * Event order (the §13.7 ordering): writeA, writeB, hash, compare, closeout|publish, manifest, finalizeTerminalMetadata, finalHashes, freeze, commit.
 * The P5.10 consistency check runs inside `finalHashes`; a failure makes the commit record INVALID (the freeze and commit still happen).
 */
export function simulateFinalization(opts, contract) {
  const o = opts || {};
  const hooks = o.hooks || {};
  const events = []; const eventDetail = []; const findings = []; const violations = [];
  const ev = (name, detail) => { events.push(name); eventDetail.push({ event: name, ...(detail || {}) }); };
  const bounds = boundsOf(contract);
  const identity = o.identity || {};
  const rawInput = o.rawFiles || {};
  const rawPaths = sortedPaths(Object.keys(rawInput)).filter((p) => p !== LEDGER_PATH);
  const raw = {}; for (const p of rawPaths) raw[p] = copy(rawInput[p]);
  const rawSnapshot = canonicalStringify(Object.fromEntries(rawPaths.map((p) => [p, sha256(raw[p])])));
  const shaOfRaw = (p) => (raw[p] ? sha256(raw[p]) : undefined);
  const authorizationRecordSha256 = o.authorizationRecordSha256 || shaOfRaw('governance/authorization-record.md') || sha256(Buffer.from('synthetic-authorization-record', 'utf8'));
  const bindingSha256 = o.bindingSha256 || shaOfRaw('governance/binding.json');
  const targetPlanSha256 = o.targetPlanSha256 || shaOfRaw('governance/target-plan.json');
  const inputDigests = o.inputDigests ? [...new Set(o.inputDigests)].sort() : [...new Set(rawPaths.filter((p) => !/\.trace\.json$/.test(p)).map(shaOfRaw))].sort();

  // ---- state
  const s = {
    A: new ScratchDir('A'), B: new ScratchDir('B'), runRoot: new Map(), ledger: [], frozen: false, attempts: new Map(),
    writeRunRoot(path, bytes) {
      if (s.frozen) { const m = `FREEZE_VIOLATION: write ${path} after the run root was frozen`; violations.push(m); throw new FreezeViolation(m); }
      if (path !== LEDGER_PATH && s.runRoot.has(path)) { const m = `WRITE_ONCE_VIOLATION: ${path} already exists`; violations.push(m); throw new Error(m); }
      s.runRoot.set(path, copy(bytes));
    },
    appendLedger(path, bytes, phase) {
      if (s.frozen) { const m = `FREEZE_VIOLATION: ledger append for ${path} after the run root was frozen`; violations.push(m); throw new FreezeViolation(m); }
      const prev = s.ledger.length ? sha256(lineBytes(s.ledger[s.ledger.length - 1])) : authorizationRecordSha256;
      s.ledger.push({ bytes: bytes.length, path, phase, prevSha256: prev, seq: s.ledger.length + 1, sha256: sha256(bytes) });
      s.runRoot.set(LEDGER_PATH, ledgerBytesOf(s.ledger));
    },
    freeze() { s.frozen = true; },
  };
  const finish = (extra) => {
    const runRootFiles = Object.fromEntries(sortedPaths(s.runRoot.keys()).map((p) => [p, copy(s.runRoot.get(p))]));
    return { events, eventDetail, findings: [...new Set(findings)].sort(), violations, runRootFiles, ledger: s.ledger.map((l) => ({ ...l })), scratch: { A: s.A.files(), B: s.B.files() }, ...extra };
  };

  // ---- raw files already exist and are ledgered (P0-P4); setup, not a P5 event
  for (const p of rawPaths) { s.runRoot.set(p, copy(raw[p])); }
  for (const p of [...rawPaths].sort((a, b) => (PHASE_ORDER[rawPhase(a)] - PHASE_ORDER[rawPhase(b)]) || (a < b ? -1 : a > b ? 1 : 0))) s.appendLedger(p, raw[p], rawPhase(p));
  if (!s.runRoot.has(LEDGER_PATH)) s.runRoot.set(LEDGER_PATH, ledgerBytesOf(s.ledger));

  // ---- P5.01-P5.06 into A; P5.07 rerun into B
  const runPass = (pass, dir) => {
    const out = o.analyze(Object.fromEntries(rawPaths.map((p) => [p, copy(raw[p])])), { pass });
    if (!out || typeof out !== 'object') throw new CloseoutError([`ANALYSIS_OUTPUT_INVALID: pass ${pass}`]);
    for (const p of sortedPaths(Object.keys(out))) dir.write(p, out[p]);
  };
  try { runPass('A', s.A); } catch (e) { if (e instanceof CloseoutError) { findings.push(...e.findings.map((x) => `A:${x}`)); return finish({ terminalState: { terminalVerdict: null, journal: 'CLOSEOUT_STARTED', failClosed: true, abort: 'SC-B07' }, commitRecord: null, manifest: null }); } throw e; }
  ev('writeA', { files: s.A.paths().length });
  try { runPass('B', s.B); } catch (e) { if (e instanceof CloseoutError) { findings.push(...e.findings.map((x) => `B:${x}`)); return finish({ terminalState: { terminalVerdict: null, journal: 'CLOSEOUT_STARTED', failClosed: true, abort: 'SC-B07' }, commitRecord: null, manifest: null }); } throw e; }
  ev('writeB', { files: s.B.paths().length });
  if (canonicalStringify(Object.fromEntries(rawPaths.map((p) => [p, sha256(s.runRoot.get(p))]))) !== rawSnapshot) findings.push('RAW_MUTATED_DURING_ANALYSIS');

  // ---- hash (step 3) and compare (step 4): the bytes hashed are the retained scratch bytes themselves
  let tA; let tB;
  try { tA = analysisTable(s.A.files(), bounds); tB = analysisTable(s.B.files(), bounds); } catch (e) { if (e instanceof CloseoutError) { findings.push(...e.findings); return finish({ terminalState: { terminalVerdict: null, journal: 'CLOSEOUT_STARTED', failClosed: true, abort: 'SC-B07' }, commitRecord: null, manifest: null }); } throw e; }
  const snapshot = { bundleA: bundleDigest(tA), bundleB: bundleDigest(tB), tableA: tA, tableB: tB };
  ev('hash', { bundleA: snapshot.bundleA, bundleB: snapshot.bundleB });
  s.A.seal(); s.B.seal(); // retained read-only: nothing is written, rewritten or annotated after this point
  const cmp = compareAnalyses(tA, tB);
  ev('compare', { identical: cmp.identical, differing: cmp.differing.length });
  if (hooks.afterCompare) hooks.afterCompare(s);

  // ---- P5.08: terminal set
  const path = cmp.identical ? 'ORDINARY' : 'SC-C03';
  let closeoutRes = null; let tvDoc = null;
  const carrierPath = cmp.identical ? TERMINAL_VERDICT_PATH : CLOSEOUT_PATH;
  if (cmp.identical) {
    const published = [];
    const AFiles = Object.fromEntries(tA.map((e) => [e.path, e]));
    for (const e of tA) {
      if (!(e.path.startsWith('derived/') || e.path === TERMINAL_VERDICT_PATH)) findings.push(`ANALYSIS_PATH_NOT_PUBLISHABLE: ${e.path}`);
    }
    if (!AFiles[TERMINAL_VERDICT_PATH]) findings.push('ANALYSIS_NO_TERMINAL_VERDICT');
    if (findings.length) return finish({ path, terminalState: { terminalVerdict: null, journal: 'CLOSEOUT_STARTED', failClosed: true, abort: 'SC-B07' }, commitRecord: null, manifest: null });
    const order = [...tA.map((e) => e.path).filter((p) => p !== TERMINAL_VERDICT_PATH), TERMINAL_VERDICT_PATH];
    for (const p of order) { const b = s.A.read(p); s.writeRunRoot(p, b); s.appendLedger(p, b, 'P5'); published.push(p); }
    try { tvDoc = JSON.parse(s.runRoot.get(TERMINAL_VERDICT_PATH).toString('utf8')); } catch { findings.push('TERMINAL_VERDICT_NOT_JSON'); }
    ev('publish', { published });
  } else {
    // built from the tables that were hashed and compared at P5.07 (a pure function of those tables, the identity and the raw input digests)
    const CF = [];
    closeoutRes = closeoutFromTables({ identity, inputDigests, bindingSha256, targetPlanSha256 }, tA, tB, contract, CF);
    if (!closeoutRes) { findings.push(...CF); return finish({ path, terminalState: { terminalVerdict: null, journal: 'CLOSEOUT_STARTED', failClosed: true, abort: 'SC-B07' }, commitRecord: null, manifest: null }); }
    s.writeRunRoot(CLOSEOUT_PATH, closeoutRes.bytes); s.appendLedger(CLOSEOUT_PATH, closeoutRes.bytes, 'P5');
    ev('closeout', { sha256: closeoutRes.sha256, bytes: closeoutRes.bytes.length });
  }
  if (hooks.afterCloseout) hooks.afterCloseout(s);

  // ---- P5.09: manifest entries
  const finalLedgerSeq = new Map(s.ledger.map((l) => [l.path, l.seq]));
  const entries = [];
  for (const p of sortedPaths(s.runRoot.keys())) {
    const bytes = s.runRoot.get(p);
    const seq = finalLedgerSeq.get(p);
    if (p === LEDGER_PATH) { entries.push({ path: p, bytes, role: 'raw' }); continue; }
    const base = { path: p, bytes, role: 'raw', ledgerSeq: seq };
    if (p === TERMINAL_VERDICT_PATH || p === CLOSEOUT_PATH || p.startsWith('derived/')) entries.push({ ...base, role: 'derived', inputs: inputDigests });
    else if (/^raw\/(?:control|target)\/[^/]+\.trace\.json$/.test(p)) { const sib = shaOfRaw(p.replace(/\.trace\.json$/, '.records.jsonl')); entries.push({ ...base, inputs: [sib || inputDigests[0]] }); }
    else entries.push(base);
  }
  ev('manifest', { entries: entries.length });

  // ---- P5.09/P5.10 (step 7): finalize terminal metadata
  const carrierBytes = s.runRoot.get(carrierPath);
  let terminalVerdict = 'WITHHELD';
  if (cmp.identical) terminalVerdict = tvDoc && tvDoc.verdictWithheld === true ? 'WITHHELD' : (tvDoc && tvDoc.runVerdict) || 'INVALID';
  const terminal = { terminalVerdict, terminalCarrierPath: carrierPath, terminalVerdictSha256: sha256(carrierBytes) };
  ev('finalizeTerminalMetadata', terminal);
  if (hooks.afterFinalizeTerminalMetadata) hooks.afterFinalizeTerminalMetadata(s, terminal);

  // ---- step 8: final manifest and stream hashes; the P5.10 consistency check
  const traceStreamSha256ByRole = {};
  for (const p of rawPaths) { const m = /^raw\/(?:control|target)\/([^/]+)\.records\.jsonl$/.exec(p); if (m) traceStreamSha256ByRole[m[1]] = shaOfRaw(p); }
  const digests = { repoCommit: 'x', procedureSha256: 'x', acceptanceHarnessSha256: 'x', diagnosticHarnessSha256: 'x', diagnosticPackageSha256: 'x', diagnosticSpecSha256: 'x', viewerVersionObserved: 'x', viewerBundleSha256Observed: 'x', ...(o.digests || {}), targetPlanSha256, traceStreamSha256ByRole };
  const hashLedgerSha256 = sha256(s.runRoot.get(LEDGER_PATH));
  const meta = { authorizationId: identity.authorizationId, attemptId: identity.attemptId, runId: identity.runId, bindingSha256, authorizationRecordSha256, digests, hashLedgerSha256, ...terminal };
  const built = buildManifest(entries, meta);
  let manifestBytes = null; let manifest = null; let manifestSha256 = null;
  if (!built.ok || !built.complete) findings.push(...built.findings.map((x) => `MANIFEST_BUILD: ${x}`), ...(built.complete ? [] : ['MANIFEST_BUILD: incomplete']));
  if (built.manifest) { manifest = built.manifest; manifestBytes = serializeManifest(manifest); manifestSha256 = sha256(manifestBytes); s.writeRunRoot(MANIFEST_PATH, manifestBytes); }
  if (hooks.afterManifestWrite) hooks.afterManifestWrite(s);
  const checks = p510Check(s, { carrierPath, path, snapshot, inputDigests, bindingSha256, targetPlanSha256, identity, contract });
  findings.push(...checks);
  ev('finalHashes', { hashLedgerSha256, manifestSha256, consistent: checks.length === 0 && manifest !== null });
  const consistent = checks.length === 0 && manifest !== null && findings.length === 0;

  // ---- P5.11 freeze; P5.12 commit record (attempts directory, not the run root)
  s.freeze(); ev('freeze');
  if (hooks.afterFreeze) hooks.afterFreeze(s);
  const finalCarrier = s.runRoot.get(carrierPath);
  const finalManifest = s.runRoot.get(MANIFEST_PATH); // the commit binds the bytes actually frozen, never a cached pre-check hash
  const committedManifestSha256 = finalManifest ? sha256(finalManifest) : null;
  const journalState = consistent ? 'CLOSEOUT_STARTED' : 'FAILED';
  const journalSha256 = sha256(canonicalBytes({ attemptId: identity.attemptId, authorizationId: identity.authorizationId, state: journalState }));
  const commitRecord = {
    attemptId: identity.attemptId, authorizationId: identity.authorizationId,
    committedAt: null, // the simulation records no timestamp (real runs carry committedAt only here and in the journal)
    journalSha256, manifestSha256: committedManifestSha256, terminalCarrierPath: carrierPath,
    terminalVerdict: consistent ? terminalVerdict : 'INVALID',
    terminalVerdictSha256: finalCarrier ? sha256(finalCarrier) : null,
  };
  s.attempts.set(`${identity.authorizationId}.commit.json`, canonicalBytes(commitRecord));
  ev('commit');
  const abUnchanged = (() => { try { return bundleDigest(analysisTable(s.A.files(), bounds)) === snapshot.bundleA && bundleDigest(analysisTable(s.B.files(), bounds)) === snapshot.bundleB; } catch { return false; } })();
  return finish({
    path, manifest, manifestBytes, manifestSha256, commitRecord, commitRecordBytes: s.attempts.get(`${identity.authorizationId}.commit.json`),
    closeout: closeoutRes ? closeoutRes.closeout : undefined, closeoutBytes: closeoutRes ? copy(closeoutRes.bytes) : undefined,
    promotion: cmp.identical ? { eligible: true } : { ...contract.closeoutSchema.properties.promotion.fixed },
    snapshot: { bundleA: snapshot.bundleA, bundleB: snapshot.bundleB }, abUnchanged,
    terminalState: { terminalVerdict: commitRecord.terminalVerdict, journal: journalState, failClosed: !cmp.identical || !consistent },
  });
}

/** P5.10 (fail closed, offline, read-only). Returns findings. */
function p510Check(s, c) {
  const F = [];
  const files = s.runRoot;
  const mb = files.get(MANIFEST_PATH);
  if (!mb) return ['MANIFEST_MISSING'];
  let m;
  try { m = JSON.parse(mb.toString('utf8')); } catch { return ['MANIFEST_NOT_JSON']; }
  try { if (!Buffer.from(mb).equals(canonicalBytes(m))) F.push('MANIFEST_NOT_CANONICAL'); } catch { F.push('MANIFEST_NOT_CANONICAL'); }
  // manifest lists exactly the run-root files except itself; digests and lengths match
  const listed = new Map((m.files || []).map((e) => [e.path, e]));
  const actual = sortedPaths([...files.keys()].filter((p) => p !== MANIFEST_PATH));
  if (!eqArr(sortedPaths([...listed.keys()]), actual)) F.push('MANIFEST_FILE_SET_MISMATCH');
  for (const [p, e] of listed) {
    const b = files.get(p);
    if (!b) continue;
    if (e.sha256 !== sha256(b) || e.bytes !== b.length) F.push(`MANIFEST_FILE_DIGEST_MISMATCH: ${p}`);
  }
  // ledger chain, lines <-> files, ledgerSeq, hashLedgerSha256
  const lb = files.get(LEDGER_PATH);
  if (!lb) F.push('LEDGER_MISSING');
  else {
    if (m.hashLedgerSha256 !== sha256(lb)) F.push('LEDGER_DIGEST_MISMATCH');
    let lines = null;
    try { const txt = lb.toString('utf8'); lines = txt === '' ? [] : txt.replace(/\n$/, '').split('\n').map((x) => JSON.parse(x)); if (txt !== '' && !txt.endsWith('\n')) F.push('LEDGER_NOT_LF_TERMINATED'); } catch { F.push('LEDGER_NOT_JSONL'); }
    if (lines) {
      let prev = null;
      lines.forEach((l, i) => {
        if (l.seq !== i + 1) F.push(`LEDGER_SEQ_BROKEN: line ${i + 1}`);
        if (i === 0 ? l.prevSha256 !== (m.authorizationRecordSha256) : l.prevSha256 !== prev) F.push(`LEDGER_CHAIN_BROKEN: line ${i + 1}`);
        prev = sha256(lineBytes(l));
        const b = files.get(l.path);
        if (!b || l.sha256 !== sha256(b) || l.bytes !== b.length) F.push(`LEDGER_LINE_FILE_MISMATCH: ${l.path}`);
        const e = listed.get(l.path);
        if (!e || e.ledgerSeq !== l.seq) F.push(`LEDGER_SEQ_MANIFEST_MISMATCH: ${l.path}`);
      });
      const lp = lines.map((l) => l.path);
      if (!eqArr(sortedPaths(lp), actual.filter((p) => p !== LEDGER_PATH))) F.push('LEDGER_FILE_SET_MISMATCH');
      if (lines.length && lines[lines.length - 1].path !== c.carrierPath) F.push('TERMINAL_CARRIER_NOT_LAST_LEDGER_LINE');
    }
  }
  // terminal carrier: exactly one, at terminalCarrierPath, digest matches
  const carriers = [TERMINAL_VERDICT_PATH, CLOSEOUT_PATH].filter((p) => files.has(p));
  if (carriers.length !== 1) F.push(`TERMINAL_CARRIER_COUNT: ${carriers.length}`);
  if (m.terminalCarrierPath !== c.carrierPath || !files.has(m.terminalCarrierPath)) F.push('TERMINAL_CARRIER_PATH_MISMATCH');
  else if (m.terminalVerdictSha256 !== sha256(files.get(m.terminalCarrierPath))) F.push('TERMINAL_VERDICT_DIGEST_MISMATCH');
  if (c.path === 'SC-C03') {
    if (m.terminalVerdict !== 'WITHHELD') F.push('CLOSEOUT_REQUIRES_WITHHELD');
    if ([...files.keys()].some((p) => p.startsWith('derived/') || p === TERMINAL_VERDICT_PATH)) F.push('CLOSEOUT_WITH_DERIVED_OR_TERMINAL_VERDICT');
    const cb = files.get(CLOSEOUT_PATH);
    if (cb) {
      // recompute from the retained read-only A and B (Part 2 §13.7 item 5)
      const v = validateCloseout(cb, { filesA: s.A.files(), filesB: s.B.files(), identity: c.identity, inputDigests: c.inputDigests, bindingSha256: c.bindingSha256, targetPlanSha256: c.targetPlanSha256 }, c.contract);
      F.push(...v.findings);
      let doc = null; try { doc = JSON.parse(cb.toString('utf8')); } catch { /* reported by validateCloseout */ }
      const digs = new Set((m.files || []).map((e) => e.sha256));
      if (doc && Array.isArray(doc.inputDigests)) for (const d of doc.inputDigests) if (!digs.has(d)) F.push(`CLOSEOUT_INPUT_NOT_IN_MANIFEST: ${d}`);
    }
  } else {
    // ordinary path: what was published is exactly what was compared
    const tbl = new Map(c.snapshot.tableA.map((e) => [e.path, e]));
    for (const [p, e] of tbl) { const b = files.get(p); if (!b || sha256(b) !== e.sha256 || b.length !== e.bytes) F.push(`PUBLISHED_DIFFERS_FROM_COMPARED: ${p}`); }
    if (files.has(CLOSEOUT_PATH)) F.push('TERMINAL_VERDICT_WITH_CLOSEOUT');
  }
  return [...new Set(F)].sort();
}
const eqArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- synthetic scenario (research demo and tests)

const txt = (s) => Buffer.from(s, 'utf8');
export const SYNTHETIC_IDENTITY = Object.freeze({ authorizationId: 'g2-diag-synthetic-0000c03', attemptId: '12345678-1234-4234-8234-123456789abc', runId: 'syn-c03' });
/** A small, fixed set of synthetic raw files (no real evidence). */
export function syntheticRawFiles() {
  const plan = txt('{"plan":"synthetic"}');
  return {
    'governance/authorization-record.md': txt('SYNTHETIC RECORD\n'),
    'governance/binding.json': txt('{"binding":"synthetic"}'),
    'governance/target-plan.json': plan,
    'raw/target/target.records.jsonl': txt('{"k":"META"}\n{"k":"END"}\n'),
    'raw/target/target.trace.json': txt('[{"k":"META"},{"k":"END"}]'),
    'raw/teardown.json': txt('{"teardown":"synthetic"}'),
  };
}
/** analysis factory: nondeterministic ? B differs from A on one file and has one extra file : B equals A. All content is synthetic. */
export function syntheticAnalyze({ nondeterministic = false, withheldFlagInside = false } = {}) {
  return (raw, { pass }) => {
    const verdict = (nondeterministic && pass === 'B') ? 'REJECTED' : 'INCONCLUSIVE';
    const tv = { schemaVersion: 1, runVerdict: verdict, verdictWithheld: withheldFlagInside, withheldBy: withheldFlagInside ? 'SC-C04' : null };
    const out = {
      'derived/verdict.json': canonicalBytes({ runVerdict: verdict }),
      'derived/integrity.T.json': canonicalBytes({ ok: true, rawBytes: Object.keys(raw).length }),
      'TERMINAL-VERDICT.json': canonicalBytes(tv),
    };
    if (nondeterministic && pass === 'B') out['derived/extra.json'] = canonicalBytes({ extra: true });
    return out;
  };
}
export function syntheticInputs() {
  const raw = syntheticRawFiles();
  return { rawFiles: raw, identity: { ...SYNTHETIC_IDENTITY }, inputDigests: ['governance/target-plan.json', 'raw/target/target.records.jsonl'].map((p) => sha256(raw[p])).sort() };
}

/** Runs the fixed synthetic SC-C03 scenario once and summarizes it (canonical-JSON-safe). Deterministic. */
export function syntheticScC03Demo(contract) {
  const base = syntheticInputs();
  const r = simulateFinalization({ ...base, analyze: syntheticAnalyze({ nondeterministic: true, withheldFlagInside: true }) }, contract);
  const v = r.closeoutBytes ? validateCloseout(r.closeoutBytes, { filesA: r.scratch.A, filesB: r.scratch.B }, contract) : { ok: false, findings: ['NO_CLOSEOUT'] };
  const ordinary = simulateFinalization({ ...base, analyze: syntheticAnalyze({ nondeterministic: false }) }, contract);
  const summary = {
    schema: 'g2-live-diag-sc-c03-closeout-demo', synthetic: true,
    events: r.events, terminalState: r.terminalState, path: r.path,
    analysisABundleSha256: r.snapshot.bundleA, analysisBBundleSha256: r.snapshot.bundleB,
    closeoutSha256: r.commitRecord.terminalVerdictSha256, manifestSha256: r.manifestSha256,
    commitRecord: r.commitRecord, abUnchanged: r.abUnchanged,
    promotionBlocked: r.promotion.eligible === false && !Object.keys(r.runRootFiles).some((p) => p.startsWith('derived/') || p === 'TERMINAL-VERDICT.json'),
    closeoutValid: v.ok, closeoutRecomputed: v.recomputed,
    manifestOkComplete: r.manifest !== null && r.findings.length === 0,
    runRootTerminalFiles: Object.keys(r.runRootFiles).filter((p) => p === 'TERMINAL-VERDICT.json' || p === CLOSEOUT_PATH || p.startsWith('derived/')),
    ordinaryControl: { events: ordinary.events, terminalCarrierPath: ordinary.commitRecord.terminalCarrierPath, terminalVerdict: ordinary.commitRecord.terminalVerdict, closeoutEmitted: ordinary.closeoutBytes !== undefined },
    findings: r.findings,
  };
  return { summary, closeoutBytes: r.closeoutBytes, result: r, validation: v };
}
