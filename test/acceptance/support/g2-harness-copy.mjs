// test/acceptance/support/g2-harness-copy.mjs
//
// Shared TEST-ONLY helper (not a test file: scripts/run-tests.mjs only collects `*.test.mjs`) for
// building MUTATED COPIES of the G2 harness (`../clashpanel-viewerbridge.acceptance.mjs`) with the
// `LIVE_PATH_WIRED` switch forced to an explicitly requested boolean -- whatever value the real
// file currently declares. The real harness file is only ever READ here, never written.
//
// Why: the activation step of the G2 live execution plan (docs/research/2026-10-02-g2-live-execution-plan.md
// §9 step 2, gap G-15) flips `const LIVE_PATH_WIRED = false;` to `true` in the real harness. Suites
// that replaced the exact literal `false` line in a copy failed at LOAD once the flag flipped, and
// suites that relied on the real module's dormancy (or spawned the real harness as a CLI with a
// fully authorized interlock) would have started reaching W1/W2 against the REAL repository. Every
// such suite now goes through this helper instead:
//   * `forceLivePathWired(source, value)` tolerates `= false;` and `= true;` and FAILS LOUDLY
//     (throws LivePathWiredDeclarationError) if the canonical declaration is absent, duplicated, or
//     shadowed/reassigned anywhere -- never a silent no-op replacement.
//   * `writeHarnessCopy` / `importHarnessCopy` place the copy at `<tempRoot>/test/acceptance/<harness>`
//     inside a fresh os.tmpdir() root that is verified to lie OUTSIDE the real repository, so the
//     copy's own `REPO_ROOT` (derived from its location) is that temp root: its W1 record lookup,
//     prompt-candidate enumeration and attempts chain can only ever see the temp root.
//
// The single deliberate pin of the REAL harness's current value lives in
// clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs; nothing in this helper pins it.

import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HARNESS_BASENAME = 'clashpanel-viewerbridge.acceptance.mjs';
export const HARNESS_REL = `test/acceptance/${HARNESS_BASENAME}`;
export const REAL_HARNESS_FILE = fileURLToPath(new URL(`../${HARNESS_BASENAME}`, import.meta.url));
export const REAL_REPO_ROOT = realpathSync(path.resolve(path.dirname(REAL_HARNESS_FILE), '..', '..'));

/** The ONE canonical declaration form accepted (either boolean). */
const CANONICAL_DECL_RE = /^const LIVE_PATH_WIRED = (true|false);$/gm;
/** Any declaration of the name (const/let/var, any spacing) anywhere in the text. */
const ANY_DECL_RE = /\b(?:const|let|var)\s+LIVE_PATH_WIRED\b/g;
/** A statement-level (re)assignment `LIVE_PATH_WIRED = ...` (not `==`/`===`; comment lines never start with the name). */
const REASSIGN_RE = /^[ \t]*LIVE_PATH_WIRED[ \t]*=(?!=)/gm;

export class LivePathWiredDeclarationError extends Error {
  constructor(message) { super(`LIVE_PATH_WIRED declaration: ${message}`); this.name = 'LivePathWiredDeclarationError'; }
}

/**
 * Locates the single canonical `const LIVE_PATH_WIRED = <bool>;` line. Throws (loudly) if it is absent,
 * duplicated, written in any non-canonical form, or if any other declaration / reassignment of the
 * name exists. Returns `{ value, index, line }`. Does not pin the value.
 */
export function livePathWiredDeclaration(source) {
  if (typeof source !== 'string' || source.length === 0) throw new LivePathWiredDeclarationError('source must be a non-empty string');
  const canonical = [...source.matchAll(CANONICAL_DECL_RE)];
  const anyDecl = [...source.matchAll(ANY_DECL_RE)];
  const reassign = [...source.matchAll(REASSIGN_RE)];
  if (canonical.length === 0) {
    throw new LivePathWiredDeclarationError(anyDecl.length > 0
      ? `found ${anyDecl.length} non-canonical declaration(s) but no canonical "const LIVE_PATH_WIRED = true|false;" line`
      : 'absent (no "const LIVE_PATH_WIRED = true|false;" line)');
  }
  if (canonical.length > 1) throw new LivePathWiredDeclarationError(`ambiguous: ${canonical.length} canonical declaration lines`);
  if (anyDecl.length !== 1) throw new LivePathWiredDeclarationError(`ambiguous: ${anyDecl.length} declarations of the name (expected exactly the canonical one)`);
  if (reassign.length !== 0) throw new LivePathWiredDeclarationError(`ambiguous: ${reassign.length} statement-level reassignment(s) of the name`);
  const [m] = canonical;
  return { value: m[1] === 'true', index: m.index, line: m[0] };
}

/** Returns `source` with the canonical declaration set to `value` (idempotent if already equal). Throws loudly on anything ambiguous. */
export function forceLivePathWired(source, value) {
  if (typeof value !== 'boolean') throw new TypeError(`forceLivePathWired: value must be a boolean, got ${typeof value}`);
  const decl = livePathWiredDeclaration(source);
  const out = `${source.slice(0, decl.index)}const LIVE_PATH_WIRED = ${value};${source.slice(decl.index + decl.line.length)}`;
  const after = livePathWiredDeclaration(out);
  if (after.value !== value || out.length - source.length !== String(value).length - String(decl.value).length) {
    throw new LivePathWiredDeclarationError('post-condition failed after forcing');
  }
  return out;
}

/** The real harness bytes (read-only). */
export function readRealHarnessSource() {
  return readFileSync(REAL_HARNESS_FILE, 'utf8');
}

const createdRoots = new Set();
process.on('exit', () => {
  for (const r of createdRoots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** True when `p` (realpath'd) is the real repository root or lies inside it. */
export function isInsideRealRepo(p) {
  let rp;
  try { rp = realpathSync(p); } catch { rp = path.resolve(p); }
  const rel = path.relative(REAL_REPO_ROOT, rp);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A fresh, realpath'd os.tmpdir() root, asserted to lie outside the real repository; removed at process exit. */
export function createIsolatedRoot(prefix = 'g2-harness-copy-') {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  if (isInsideRealRepo(root)) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`isolated root ${root} resolves inside the real repository ${REAL_REPO_ROOT}`);
  }
  createdRoots.add(root);
  return root;
}

/** Removes a root previously returned by createIsolatedRoot (refuses anything else). */
export function removeIsolatedRoot(root) {
  if (!createdRoots.has(root)) throw new Error(`not an isolated root created by this helper: ${root}`);
  rmSync(root, { recursive: true, force: true });
  createdRoots.delete(root);
}

/** Writes `content` at `<root>/<rel>`; `rel` must stay inside `root`. */
export function writeRootFile(root, rel, content) {
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r === '' || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`writeRootFile: ${rel} escapes ${root}`);
  if (isInsideRealRepo(abs)) throw new Error(`writeRootFile: ${abs} is inside the real repository`);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/**
 * Writes a harness copy with LIVE_PATH_WIRED forced to `livePathWired` (required, boolean) at
 * `<root>/test/acceptance/<harness>`. `transform(text)` may apply further test mutations but must
 * not touch the wiring declaration (re-verified afterwards). `files` = { rel: content } fixtures
 * written under the same root. Returns `{ root, file, text }`.
 */
export function writeHarnessCopy({ livePathWired, source = readRealHarnessSource(), transform = null, root = null, files = {}, prefix } = {}) {
  if (typeof livePathWired !== 'boolean') throw new TypeError('writeHarnessCopy: livePathWired must be given explicitly as a boolean');
  let text = forceLivePathWired(source, livePathWired);
  if (transform) {
    text = transform(text);
    if (livePathWiredDeclaration(text).value !== livePathWired) throw new LivePathWiredDeclarationError('transform changed the forced value');
  }
  const base = root ?? createIsolatedRoot(prefix);
  if (isInsideRealRepo(base)) throw new Error(`writeHarnessCopy: root ${base} is inside the real repository`);
  const file = writeRootFile(base, HARNESS_REL, text);
  for (const [rel, content] of Object.entries(files)) writeRootFile(base, rel, content);
  return { root: base, file, text };
}

/** writeHarnessCopy + dynamic import; verifies the copy's REPO_ROOT is its isolated root and the flag is the forced value. */
export async function importHarnessCopy(opts = {}) {
  const copy = writeHarnessCopy(opts);
  const module = await import(pathToFileURL(copy.file).href);
  if (module.LIVE_PATH_WIRED !== opts.livePathWired) throw new Error(`imported copy has LIVE_PATH_WIRED=${module.LIVE_PATH_WIRED}, expected ${opts.livePathWired}`);
  if (realpathSync(module.REPO_ROOT) !== realpathSync(copy.root)) throw new Error(`copy REPO_ROOT ${module.REPO_ROOT} is not its isolated root ${copy.root}`);
  return { ...copy, module };
}

let dormant = null;
let activated = null;
/** A memoized (per process) unmodified-except-for-the-flag copy forced DORMANT (LIVE_PATH_WIRED=false). */
export function importDormantHarness() {
  dormant ??= importHarnessCopy({ livePathWired: false, prefix: 'g2-dormant-' });
  return dormant;
}
/** A memoized (per process) unmodified-except-for-the-flag copy forced ACTIVATED (LIVE_PATH_WIRED=true), in its own isolated root. */
export function importActivatedHarness() {
  activated ??= importHarnessCopy({ livePathWired: true, prefix: 'g2-activated-' });
  return activated;
}
