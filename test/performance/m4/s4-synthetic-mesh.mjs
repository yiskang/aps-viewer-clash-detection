// test/performance/m4/s4-synthetic-mesh.mjs
//
// M4 Task 3.12: the S4 synthetic dense-mesh fixture's pure geometry generator. Deterministic,
// no tessellator-formula guessing (measure-geometry-phases.mjs's own documented lesson: an
// approximated fixture can silently miss the exact ceiling under test). Plain {position, index}
// arrays, not a THREE.BufferGeometry -- kept framework-agnostic here; the live half (run-gate-m4.mjs
// / browser-probes-m4.mjs) wraps this into whatever shape the Viewer's geometry accessors need.
//
// Mirrors measure-geometry-phases.mjs:26-45's grid-generation idiom (not imported -- that file is a
// standalone Node script outside this harness's own module graph, and duplicating ~15 lines of a
// pure, deterministic, well-commented function is cheaper and more legible than adding a
// cross-directory import between two independent harness scripts) -- EXCEPT that idiom's own grid is
// perfectly flat (z=0 for every vertex), which measure-geometry-phases.mjs can afford because it only
// times ONE geometry's own weld/connectivity/BVH build in isolation. This module's grid feeds a real
// PAIR query (S4's whole purpose), and a real, empirically-confirmed bug means flat cannot be reused
// verbatim here -- see TILT_SLOPE below.
//
// Real bug found running this task's own manual verification against the live app (independently
// confirmed via a codex-advisor consultation that directly re-ran the experiment against this repo's
// pinned BVH backend): a perfectly flat mesh (z=0 everywhere) has a LOCAL Z EXTENT OF EXACTLY ZERO.
// collision/blas/ThreeMeshBvhBackend.js's own aspect-ratio guard treats a zero minExtent as an
// unconditionally-exceeded (Infinity) ratio -- a property of EACH mesh's OWN local bounding box,
// entirely independent of any translation applied between two operands. With `aspectRatioExceeded`
// true, collision/query/VolumeOverlapQuery.js SKIPS its crossing (hard-clash) test entirely for BOTH
// operands -- confirmed live: `geometry-aspect-ratio-exceeds-tolerance-model` fired for both source
// and target, and no real per-triangle narrow-phase work ever ran under volume-overlap mode. (The
// brief's own anticipated fallback for a *different* coplanar-geometry concern -- "a small z offset
// between the two grids" -- does not fix this: translating an already-flat mesh along Z still leaves
// that mesh's own local Z extent at zero.)
//
// TILT_SLOPE gives each mesh a small but genuine per-vertex Z variation: z = TILT_SLOPE*(col - row).
// `col - row` (never `col + row`) is deliberate -- confirmed experimentally (codex-advisor,
// reproduced against the real BVH backend): S4's own live wiring translates the target grid by a
// FIXED `[5, 5, dz]` XY offset (dx=dy=5), and `(c+5) - (r+5) = c - r` leaves the two meshes' tilt
// PATTERNS in register with each other under that exact shift (the "constant nonzero gap" test
// below) -- `c + r` under the same `[5,5,dz]` shift instead produces a constant vertical separation
// LARGER than a single grid cell's own Z variation, which defeats BVH leaf-AABB overlap entirely
// (measured: zero candidate triangle-pair callbacks -- worse than the original bug, just tripping a
// different, silent gate instead of a loud diagnostic). `TILT_SLOPE = 0.01` over S4's own 200x30
// grid gives a ~2.3-unit local Z extent (aspect ratio ~87, comfortably under maxLocalAspectRatio's
// 10,000 ceiling) while staying small relative to the 200x30 planar footprint -- S4's pathological
// case is still primarily about triangle DENSITY and pair COUNT under broad overlap, not depth.
const TILT_SLOPE = 0.01;

export function buildTriangleGrid(cols, rows) {
  const position = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) position.push(c, r, TILT_SLOPE * (c - r));
  const index = [];
  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c, b = a + 1, d = a + stride, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  return { position, index };
}

export function translatedGrid(grid, [dx, dy, dz]) {
  const position = grid.position.slice();
  for (let i = 0; i < position.length; i += 3) {
    position[i] += dx; position[i + 1] += dy; position[i + 2] += dz;
  }
  return { position, index: grid.index };
}
