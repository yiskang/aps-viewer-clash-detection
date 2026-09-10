// test/performance/m4/build-worker-graph.mjs
//
// M4 Task 3.9 (codex-review fix, Important #1 -- "the build fallback does not rewrite transitive
// dependencies"): §17's S1' build/rewrite escape hatch, taken literally -- "it reads the single
// worker entry AND THE MODULES IT PULLS IN, rewrites their bare `three` / `three-mesh-bvh`
// specifiers" -- requires walking the FULL reachable module graph, not just the entry file. The
// original Task 3.9 implementation rewrote only the entry's own two top-level bare imports;
// empirically (this task's own manual verification, independently confirmed by codex-review)
// `three-mesh-bvh`'s OWN internal source files (wwwroot/vendor/three-mesh-bvh/src/core/MeshBVH.js
// and ~20 siblings) import `three` by BARE specifier too, so an entry-only rewrite still fails
// identically to the relative-path variant -- exactly the failure S1' exists to name, not to hide.
//
// Reuses `rewriteBareSpecifiers` (already unit-tested, unchanged) for every visited file: this
// module's only new job is discovering the transitive file set and choosing where each visited
// file's rewritten copy lives under `outDir`, in a way that keeps every RELATIVE import between
// vendor files valid with NO rewriting at all. The mirror below preserves each vendor file's
// position relative to `vendorRoot` exactly, under `<outDir>/vendor/...` -- so a relative import
// like `'../math/OrientedBox.js'` inside `core/MeshBVH.js` still resolves correctly, unchanged.
// Only the BARE `three`/`three-mesh-bvh` specifiers ever need rewriting, which `rewriteBareSpecifiers`
// already does per file, given the correct depth-relative prefix computed here.
//
// Still a "small, dependency-free Node rewrite script using built-in APIs only, adding no
// dependency" (§17) -- no AST parser, no bundler: a regex scan for `from '...'`/`from "..."`
// specifiers (the same simple mechanism `rewriteBareSpecifiers` itself already uses), real
// filesystem resolution, and a straight file copy-with-rewrite. It does not bundle -- every file
// stays its own separate ES module on disk, exactly the "worker entry modules using relative paths
// only" remedy §8.6 names, just applied transitively instead of at one file alone.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { rewriteBareSpecifiers, BARE_SPECIFIER_TARGETS } from './rewrite-specifiers.mjs';

// Anchored to a line that actually STARTS with `import`/`export` (real bug found running this
// module's own test against the real vendor tree): an unanchored `from\s+(['"])...` -- the same
// simple pattern `rewriteBareSpecifiers` already uses, safe there since it only ever matches the
// two literal package names -- badly over-matches here once the search is "any specifier", because
// three-mesh-bvh's own generated files carry plain-English comments in exactly this shape:
// `/* This file is generated from "raycast.template.js". */` (core/cast/raycast.generated.js:7).
// That is not an import at all, and treating it as one only ever produced a harmless
// `unresolvedSpecifiers` entry (it does not match a known bare package name, so `resolveSpecifier`
// already returns null for it and `visit` skips it) -- but it is noise a real caller should not
// have to filter, and a future comment that happened to READ like a real bare specifier could
// silently trigger an unnecessary resolution attempt. Verified empirically against the exact pinned
// vendor tree this spike walks (three@0.185.1, three-mesh-bvh@0.9.14): no import/export statement
// in that tree spans multiple lines with `from '...'` on a line of its own, so anchoring to a
// line-initial `import`/`export` keyword loses no real specifier here.
const IMPORT_SPECIFIER_RE = /^[ \t]*(?:import|export)[^'"\n]*\bfrom\s+(['"])([^'"]+)\1/gm;

function findImportSpecifiers(sourceText) {
  const specifiers = [];
  let m;
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  while ((m = IMPORT_SPECIFIER_RE.exec(sourceText)) !== null) specifiers.push(m[2]);
  return specifiers;
}

// Real, on-disk resolution for one specifier found inside `fromRealPath`'s own content. A bare
// `three`/`three-mesh-bvh` resolves against `vendorRootAbs` (§8.6's SAME relative wwwroot/vendor/
// paths wwwroot/index.html's own import map already resolves to); a relative specifier resolves
// against the file that contains it, exactly as ordinary ES module resolution would. Any other bare
// specifier is left unresolved here -- named by the caller instead of guessed at, since
// BARE_SPECIFIER_TARGETS only knows these two package names (matching this task's own bounded
// scope: `three`/`three-mesh-bvh` only, never a general-purpose bundler).
function resolveSpecifier(specifier, fromRealPath, vendorRootAbs) {
  if (specifier in BARE_SPECIFIER_TARGETS) return { realPath: join(vendorRootAbs, BARE_SPECIFIER_TARGETS[specifier]), bare: true };
  if (specifier.startsWith('./') || specifier.startsWith('../')) return { realPath: resolve(dirname(fromRealPath), specifier), bare: false };
  return null;
}

// Every real path under `vendorRootAbs` mirrors to the SAME relative position under
// `<outDir>/vendor/...`, which is what keeps every vendor-internal relative import valid with no
// rewriting (see this file's own header). The entry itself (never under vendorRootAbs) always
// mirrors to `<outDir>/worker.mjs`.
function outputPathFor(realPath, { entryRealPath, outDir, vendorRootAbs }) {
  if (realPath === entryRealPath) return join(outDir, 'worker.mjs');
  return join(outDir, 'vendor', relative(vendorRootAbs, realPath));
}

// Walks the reachable module graph from `entryPath`, writing a rewritten copy of every visited file
// under `outDir` (mirrored per `outputPathFor` above). Returns the generated entry's own path plus
// a manifest for the caller's own post-generation verification (§17 / codex-review: "verify that no
// bare target specifiers remain before launching the generated worker").
export async function buildBundledWorkerGraph({ entryPath, outDir, vendorRoot }) {
  const entryRealPath = resolve(entryPath);
  const vendorRootAbs = resolve(vendorRoot);
  // realPath -> outputPath, memoized so a dependency shared by many files (e.g. `Box3`, imported
  // from a dozen three-mesh-bvh modules) is read/written exactly once, never duplicated or
  // re-walked -- the same "first-discovery-wins" discipline §16.4 item 6 already documents for a
  // geometry resolved once and cached within an epoch.
  const visited = new Map();
  const unresolvedSpecifiers = new Set();

  async function visit(realPath) {
    if (visited.has(realPath)) return;
    const outputPath = outputPathFor(realPath, { entryRealPath, outDir, vendorRootAbs });
    visited.set(realPath, outputPath);

    const source = await readFile(realPath, 'utf8');
    // Real bug found running this module's own manual verification against a live browser: for the
    // entry file (whose output sits directly inside `outDir`, i.e. `vendor/` is its own direct
    // child), `path.relative` returns the bare string `'vendor'` -- NOT `'./vendor'`. ECMAScript
    // module resolution treats any specifier that does not start with `./`, `../`, `/`, or a scheme
    // as a BARE specifier, so `from 'vendor/three/...'` is exactly as unresolvable in a worker realm
    // as `from 'three'` is -- the fix never actually changed the entry's own failure mode. A leading
    // `./` is forced whenever `path.relative`'s own result does not already start with `.`.
    let relPart = relative(dirname(outputPath), join(outDir, 'vendor'));
    if (!relPart.startsWith('.')) relPart = `./${relPart}`;
    const relativeVendorPrefix = `${relPart}/`;
    const rewritten = rewriteBareSpecifiers(source, { relativeVendorPrefix });

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rewritten);

    for (const specifier of findImportSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, realPath, vendorRootAbs);
      if (!resolved) { unresolvedSpecifiers.add(specifier); continue; }
      await visit(resolved.realPath);
    }
  }

  await visit(entryRealPath);

  // Defence in depth (codex-review's own recommendation): re-scan every generated file's WRITTEN
  // content -- not the source text above, which is not retained per-file -- for a bare
  // `three`/`three-mesh-bvh` specifier that survived rewriting. Structurally this should never
  // happen given the mirroring rule above, but it is checked explicitly rather than assumed, the
  // same discipline this codebase already applies elsewhere (an unmapped stage label, an unknown
  // runtime label) -- a silent miss here would let S1' launch a worker it never actually proved
  // resolves cleanly.
  const remainingBareSpecifiers = [];
  for (const outputPath of visited.values()) {
    const written = await readFile(outputPath, 'utf8');
    for (const specifier of findImportSpecifiers(written)) {
      if (specifier in BARE_SPECIFIER_TARGETS) remainingBareSpecifiers.push({ file: outputPath, specifier });
    }
  }

  return {
    entryOutputPath: join(outDir, 'worker.mjs'),
    visitedRealPaths: [...visited.keys()],
    visitedOutputPaths: [...visited.values()],
    unresolvedSpecifiers: [...unresolvedSpecifiers],
    remainingBareSpecifiers,
  };
}
