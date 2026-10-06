// Input pins (spec §7.1) and read-once loading. Research tooling only; [SYN].
// Every input is read exactly once into an owned buffer. The digest is computed over that buffer and, only when it
// matches, the SAME buffer is parsed (JSON) or loaded as an ES module (D2 code, via a data: URL built from those bytes).
// Nothing re-opens a path after hashing, so the code/data that run are byte-identical to the bytes that were hashed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..', '..');
export const D2_DIR_REL = 'docs/research/2026-10-04-g2-d2-synthetic-transition';
export const D2_DIR = join(REPO, D2_DIR_REL);

export const D2_OUTPUT_DIGEST = 'e1d1b815ed351e6feba3e34822ba9895e54035158e685bfbe7f628f6d10bbb06';

/**
 * VB-0 pin (spec §6.1.3 "Whole-trace integrity", §6.3 C6; independent review H1). The ONE accepted Viewer build:
 * META.vv must be exactly this string (strict ===; no trim, case folding, prefix stripping or numeric coercion) AND
 * META.vd exactly this decoded viewer3D.js SHA-256 (R [SRC]; notes-A2). Anything else is a VB-0 mismatch.
 */
export const PINNED_VIEWER_VERSION = '7.124.2';
export const PINNED_VIEWER_BUNDLE_SHA256 = '12b9fe49f41dc99ccec62535e5c887da915980829da2e941cfe4da3d7197c02e';
/** VB-0 eligibility, derived from the observed values only (never from a guard flag). Total; never throws. */
export const viewerPinMatches = (vv, vd) => vv === PINNED_VIEWER_VERSION && vd === PINNED_VIEWER_BUNDLE_SHA256;

/** Expected SHA-256 per input (spec §7.1). `null` = record observed only (this spec, by D2 convention). */
export const EXPECTED = Object.freeze({
  d2Spec: '635d183415270eb842b47522e21a704bf3cdf5a9b7d0685d6e104f427499c574',
  d2Fixtures: '6ee6e9fa94266fcdd26875f60b280f16dc4343909baa03795180997a41f978e0',
  d2Machine: 'a78b096d795e058f6adcd02dc0e5c9f707627127c156755d8e639c35b98918bf',
  d2Schedules: '4b41fac2bec83ac8797c48749fe1cde3bc7f069d5fe5d37c756d2e52e9a85d4d',
  d2Contract: '71fa49cd85c3680ef560f8778896457444d2f36c90e317bdf7900b0dd7eea626',
  d2Canonical: '73bbeadcaf0248b9a6f5bb16c4c7c690b3158fa094f192be4dd6c106aeaa038b',
  d2Summary: 'fde4a12a443ad361d8d5f4be59b7b851689fd12f8cf9c2cf57399dd9029f17e2',
  thisSpec: null,
});

export const DEFAULT_PATHS = Object.freeze({
  d2Spec: join(REPO, 'docs/research/2026-10-04-g2-d2-synthetic-transition-spec.md'),
  d2Fixtures: join(D2_DIR, 'fixtures.json'),
  d2Machine: join(D2_DIR, 'machine.mjs'),
  d2Schedules: join(D2_DIR, 'schedules.mjs'),
  d2Contract: join(D2_DIR, 'contract.mjs'),
  d2Canonical: join(D2_DIR, 'canonical.mjs'),
  d2Summary: join(D2_DIR, 'results/d2-summary.json'),
  thisSpec: join(REPO, 'docs/research/2026-10-05-g2-diagnostic-instrumentation-spec.md'),
});

const INPUT_NAMES = Object.keys(EXPECTED);

export function fail(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { exitCode: 2, code });
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Reads every input once. Returns { records, snapshots } where snapshots[name] is the owned, validated Buffer.
 * Throws exit-2 INPUT-HASH on any unreadable input or digest mismatch (nothing is loaded or parsed in that case).
 */
export function readPinnedInputs({ paths = DEFAULT_PATHS, expected = EXPECTED, reader = readFileSync } = {}) {
  const records = {};
  const snapshots = {};
  const bad = [];
  for (const n of INPUT_NAMES) {
    const exp = expected[n] === undefined ? null : expected[n];
    if (n !== 'thisSpec' && (typeof exp !== 'string' || !/^[0-9a-f]{64}$/.test(exp))) { bad.push(`${n}(no expected digest)`); records[n] = { expected: exp, observed: null }; continue; }
    let bytes = null;
    try { bytes = Buffer.from(reader(paths[n])); } catch { bytes = null; }
    const observed = bytes ? sha(bytes) : null;
    records[n] = { expected: exp, observed };
    if (!bytes || (exp !== null && observed !== exp)) bad.push(n);
    else snapshots[n] = bytes;
  }
  if (bad.length) throw fail('INPUT-HASH', `input hash mismatch/unreadable: ${bad.join(', ')}`);
  return { records, snapshots };
}

const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;

/** Rewrites exactly one relative import specifier; fails closed if it is not present exactly once. */
function relink(src, spec, url, who) {
  const needle = `'${spec}'`;
  const parts = src.split(needle);
  if (parts.length !== 2) throw fail('INPUT-HASH', `${who}: expected exactly one import of ${spec}`);
  return parts.join(`'${url}'`);
}

/**
 * Loads D2 modules from the validated snapshot bytes (never from disk again). The only transformation is the
 * deterministic rewrite of the relative './contract.mjs' specifier to the data: URL of the validated contract bytes.
 */
export async function loadD2Modules(snapshots) {
  const contractSrc = snapshots.d2Contract.toString('utf8');
  const contractUrl = dataUrl(contractSrc);
  const canonical = await import(dataUrl(snapshots.d2Canonical.toString('utf8')));
  const contract = await import(contractUrl);
  const machine = await import(dataUrl(relink(snapshots.d2Machine.toString('utf8'), './contract.mjs', contractUrl, 'machine.mjs')));
  const schedules = await import(dataUrl(relink(snapshots.d2Schedules.toString('utf8'), './contract.mjs', contractUrl, 'schedules.mjs')));
  return { canonical, contract, machine, schedules };
}

/**
 * Full pinned load: hashes, then parses fixtures/summary from the same buffers, then checks the D2 output digest field.
 * Returns { records, fixtures, d2Summary, mods }.
 */
export async function loadPinned(opts = {}) {
  const { records, snapshots } = readPinnedInputs(opts);
  const mods = await loadD2Modules(snapshots);
  const fixtures = mods.contract.parseFixtures(snapshots.d2Fixtures.toString('utf8'));
  const d2Summary = JSON.parse(snapshots.d2Summary.toString('utf8'));
  const observedDigest = d2Summary.outputDigestSha256;
  records.d2SummaryOutputDigest = { expected: D2_OUTPUT_DIGEST, observed: typeof observedDigest === 'string' ? observedDigest : null };
  if (observedDigest !== D2_OUTPUT_DIGEST) throw fail('INPUT-HASH', `d2-summary outputDigestSha256 ${observedDigest} != ${D2_OUTPUT_DIGEST}`);
  return { records, fixtures, d2Summary, mods };
}
