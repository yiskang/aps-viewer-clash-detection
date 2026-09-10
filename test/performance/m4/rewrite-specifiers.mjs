// test/performance/m4/rewrite-specifiers.mjs
//
// M4 Task 3.9: the pure core of S1''s bounded build/rewrite variant (§17's S1' row -- run ONLY
// if the relative-path variant also fails). A small, dependency-free Node rewrite: reads a worker
// entry's bare `three`/`three-mesh-bvh` specifiers and rewrites them to the SAME relative
// wwwroot/vendor/ paths wwwroot/index.html's own import map already resolves to
// (verified-refs.md: import map wwwroot/index.html:47-53). No bundler, no new dependency.

const BARE_SPECIFIER_TARGETS = {
  three: 'three/build/three.module.js',
  'three-mesh-bvh': 'three-mesh-bvh/src/index.js',
};

export function rewriteBareSpecifiers(sourceText, { relativeVendorPrefix }) {
  return sourceText.replace(
    /from\s+(['"])(three(?:-mesh-bvh)?)\1/g,
    (match, quote, specifier) => `from ${quote}${relativeVendorPrefix}${BARE_SPECIFIER_TARGETS[specifier]}${quote}`,
  );
}

// Exported for build-worker-graph.mjs (codex-review fix, Task 3.9 Important #1): the graph walker
// needs the SAME bare-specifier -> real-vendor-suffix mapping this module already owns, to resolve
// a bare specifier discovered ANYWHERE in the reachable module graph -- not just the worker entry --
// to its real on-disk file. Exporting the existing constant avoids a second, driftable copy of it.
export { BARE_SPECIFIER_TARGETS };
