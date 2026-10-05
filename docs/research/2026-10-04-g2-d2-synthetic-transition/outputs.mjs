// Output caps (spec §14), atomic-ish writing, and digest ordering (spec §15).
import { mkdirSync, readdirSync, existsSync, realpathSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalBytes, canonicalStringify, sha256Hex } from './canonical.mjs';

export const SUMMARY_FILE = 'd2-summary.json';
export const WITNESSES_FILE = 'd2-witnesses.json';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORBIDDEN_DIRS = [
  resolve(REPO_ROOT, 'test', 'acceptance', 'results'),
  resolve(REPO_ROOT, 'docs', 'research', 'evidence'),
];

const byteLen = (v) => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : v.length);

function capError(code, msg, extra) {
  const e = new Error(msg);
  e.exitCode = 2;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

/** Never truncates. Per-file, total, summary (d2-summary.json) and trace-count limits all inclusive (<=). */
export function checkCaps({ files, fixturesCaps, traceCount }) {
  const c = fixturesCaps;
  const perFile = {};
  let total = 0;
  for (const [name, data] of Object.entries(files)) {
    perFile[name] = byteLen(data);
    total += perFile[name];
  }
  const limit = {
    perOutputBytes: c.perOutputBytes,
    totalOutputBytes: c.totalOutputBytes,
    summaryBytes: c.summaryBytes,
    maxTraces: c.maxTraces,
  };
  const violations = [];
  for (const [name, n] of Object.entries(perFile)) {
    if (n > c.perOutputBytes) violations.push(`file ${name}: ${n} > perOutputBytes ${c.perOutputBytes}`);
    if (name === SUMMARY_FILE && n > c.summaryBytes) violations.push(`file ${name}: ${n} > summaryBytes ${c.summaryBytes}`);
  }
  if (total > c.totalOutputBytes) violations.push(`total: ${total} > totalOutputBytes ${c.totalOutputBytes}`);
  if (traceCount > c.maxTraces) violations.push(`traceCount: ${traceCount} > maxTraces ${c.maxTraces}`);
  return { ok: violations.length === 0, observed: { perFile, total, traceCount }, limit, violations };
}

function realish(p) {
  // realpath of the nearest existing ancestor + remaining tail (guards symlinked parents).
  let cur = resolve(p);
  const tail = [];
  while (!existsSync(cur)) {
    tail.unshift(basename(cur));
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(realpathSync(cur), ...tail);
}

function under(p, root) {
  return p === root || p.startsWith(root + sep);
}

/**
 * Checks caps first (throws CAP-EXCEEDED, exitCode 2, before any filesystem effect), refuses forbidden
 * dirs (test/acceptance/results, docs/research/evidence) and any pre-existing NON-EMPTY dir, then writes
 * each file via temp-name + rename. Returns { dir, bytesWritten, files:{name:bytes} }.
 */
export function writeOutputsAtomically(dir, files, caps, { traceCount = 0 } = {}) {
  const check = checkCaps({ files, fixturesCaps: caps, traceCount });
  if (!check.ok) throw capError('CAP-EXCEEDED', `CAP-EXCEEDED: ${check.violations.join('; ')}`, { check });
  for (const name of Object.keys(files)) {
    if (name !== basename(name) || name.startsWith('.') || name === '') {
      throw capError('BAD-OUTPUT-NAME', `bad output file name: ${name}`);
    }
  }
  const abs = resolve(dir);
  const real = realish(abs);
  for (const f of FORBIDDEN_DIRS) {
    if (under(abs, f) || under(real, f) || under(real, realish(f))) {
      throw capError('FORBIDDEN-OUTPUT-DIR', `refusing to write under ${f}`);
    }
  }
  if (existsSync(abs) && readdirSync(abs).length > 0) {
    throw capError('OUTPUT-DIR-NOT-EMPTY', `refusing non-empty output dir ${abs}`);
  }
  mkdirSync(abs, { recursive: true });
  const written = {};
  let bytesWritten = 0;
  try {
    for (const [name, data] of Object.entries(files)) {
      const tmp = resolve(abs, `.${name}.tmp`);
      writeFileSync(tmp, data);
      renameSync(tmp, resolve(abs, name));
      written[name] = byteLen(data);
      bytesWritten += written[name];
    }
  } catch (err) {
    for (const name of Object.keys(files)) {
      rmSync(resolve(abs, `.${name}.tmp`), { force: true });
      rmSync(resolve(abs, name), { force: true });
    }
    throw err;
  }
  return { dir: abs, bytesWritten, files: written };
}

/** sha256 hex of canonicalStringify(summary without `outputDigestSha256`). */
export function digestSummary(summary) {
  const { outputDigestSha256: _omit, ...rest } = summary;
  return sha256Hex(canonicalStringify(rest));
}

/**
 * Ordering: (1) witnessesBytes = canonicalBytes(witnesses); (2) companionDigestSha256 = sha256(witnessesBytes)
 * stored in a COPY of summary (input not mutated); (3) outputDigestSha256 = digestSummary(copy) (computed with
 * the field omitted, so it covers companionDigestSha256) stored in the copy; (4) summaryBytes =
 * canonicalBytes(copy). Returns { summaryBytes, witnessesBytes, summary, companionDigestSha256, outputDigestSha256 }.
 */
export function withDigests({ summary, witnesses }) {
  const witnessesBytes = canonicalBytes(witnesses);
  const out = { ...summary };
  delete out.outputDigestSha256;
  out.companionDigestSha256 = sha256Hex(witnessesBytes);
  out.outputDigestSha256 = digestSummary(out);
  return {
    summaryBytes: canonicalBytes(out),
    witnessesBytes,
    summary: out,
    companionDigestSha256: out.companionDigestSha256,
    outputDigestSha256: out.outputDigestSha256,
  };
}
