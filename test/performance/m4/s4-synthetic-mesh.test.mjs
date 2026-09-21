// test/performance/m4/s4-synthetic-mesh.test.mjs
//
// M4 Task 3.12: pure geometry-generator tests for the S4 synthetic dense-mesh fixture. See
// s4-synthetic-mesh.mjs's own header for why these functions exist and why they are plain
// {position, index} arrays rather than a THREE.BufferGeometry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleGrid, translatedGrid } from './s4-synthetic-mesh.mjs';
import { maxSyncTriangleCount, maxLocalAspectRatio } from '../../../collision/constants.js';

test('buildTriangleGrid: exactly maxSyncTriangleCount triangles, never approximated', () => {
  const grid = buildTriangleGrid(100, maxSyncTriangleCount / 200); // 100 cols x 60 rows
  assert.equal(grid.index.length / 3, maxSyncTriangleCount);
  // position is a flat [x,y,z,...] array, one vertex per (col,row) grid point
  assert.equal(grid.position.length / 3, 101 * 61);
});

test('buildTriangleGrid: deterministic — two calls with the same dims produce byte-identical output', () => {
  const a = buildTriangleGrid(20, 10);
  const b = buildTriangleGrid(20, 10);
  assert.deepEqual(a.position, b.position);
  assert.deepEqual(a.index, b.index);
});

test('translatedGrid: shifts every vertex by the given offset, index untouched', () => {
  const grid = buildTriangleGrid(4, 4);
  const shifted = translatedGrid(grid, [10, 0, 0]);
  assert.equal(shifted.position[0], grid.position[0] + 10);
  assert.equal(shifted.position[1], grid.position[1]); // y unchanged
  assert.deepEqual(shifted.index, grid.index); // topology never touched by a translation
});

test('translatedGrid: a small offset relative to the grid extent produces BROADLY OVERLAPPING bounds, per spec', () => {
  // 100x60 grid at unit spacing spans 100x60 world units. A source and a target mesh both
  // built from this grid, one translated by a few units, overlap over the vast majority of
  // their extent -- "broadly overlapping", not merely touching at one edge.
  const grid = buildTriangleGrid(100, 60);
  const shifted = translatedGrid(grid, [5, 5, 0]);
  const gridMaxX = Math.max(...Array.from({ length: grid.position.length / 3 }, (_, i) => grid.position[i * 3]));
  assert.ok(5 < gridMaxX * 0.5, 'offset must be small relative to grid extent, not merely non-zero');
});

// Real bug found running this task's own manual verification against the live app, confirmed via
// an independent codex-advisor consultation with direct experimental verification against this
// repo's own pinned BVH backend: a PERFECTLY FLAT (z=0 for every vertex) grid gives the mesh a
// LOCAL Z EXTENT OF EXACTLY ZERO. collision/blas/ThreeMeshBvhBackend.js's own aspect-ratio guard
// treats a zero minExtent as an unconditionally-exceeded (Infinity) aspect ratio -- a property of
// EACH MESH'S OWN local bounding box, entirely independent of any translation applied between the
// two operands ("a small z offset between the two grids", the brief's own anticipated fallback for
// a *different* coplanar-geometry concern, does NOT fix this: translating an already-flat mesh
// along Z still leaves that mesh's own local Z extent at zero). With aspectRatioExceeded true,
// collision/query/VolumeOverlapQuery.js SKIPS its crossing (hard-clash) test entirely for BOTH
// operands, so a flat S4 fixture never reaches real per-triangle narrow-phase work at all under
// volume-overlap mode -- confirmed live: `geometry-aspect-ratio-exceeds-tolerance-model` fired for
// both source and target, and `narrowPhasePairs` stayed non-zero only because of the SKIPPED
// (not real) crossing term.
//
// Fixed by tilting the grid: z = TILT_SLOPE * (c - r), a small but genuine per-vertex Z variation
// (never a uniform per-mesh Z offset, which cannot change a single mesh's own extent). `c - r`
// (not `c + r`) is deliberate: it is exactly what makes `[5, 5, dz]` (S4's own chosen XY offset,
// dx=dy=5) leave the two meshes' TILT PATTERNS in register with each other (see the "constant
// nonzero gap" test below) rather than accidentally cancelling into a wider, leaf-AABB-defeating
// gap -- confirmed experimentally: `c + r` with `[5,5,0]` produced a CONSTANT vertical separation
// exceeding a single grid cell's own Z variation, so BVH leaf AABBs no longer overlap AT ALL
// (zero candidate triangle-pair callbacks -- worse than the original bug, just below a different
// gate), while `c - r` with `[5,5,dz]` for a small dz keeps leaf AABBs overlapping and the crossing
// traversal fully engaged.
test('buildTriangleGrid: gives the mesh a genuine, nonzero local Z extent (never exactly flat)', () => {
  const cols = 20, rows = 10;
  const grid = buildTriangleGrid(cols, rows);
  const zs = Array.from({ length: grid.position.length / 3 }, (_, i) => grid.position[i * 3 + 2]);
  const zExtent = Math.max(...zs) - Math.min(...zs);
  assert.ok(zExtent > 0, 'a perfectly flat (z-extent === 0) mesh trips ThreeMeshBvhBackend.js\'s ' +
    'aspect-ratio guard as an unconditional Infinity, per collision/blas/ThreeMeshBvhBackend.js\'s ' +
    'own documented "zero minExtent -- treated as exceeded" rule');
  const planarExtent = Math.max(cols, rows); // x spans [0,cols], y spans [0,rows] at unit spacing
  const aspectRatio = Math.max(planarExtent, zExtent) / Math.min(planarExtent, zExtent);
  assert.ok(aspectRatio < maxLocalAspectRatio, `aspect ratio ${aspectRatio} must clear the ` +
    `library's own maxLocalAspectRatio (${maxLocalAspectRatio}) ceiling`);
});

test('buildTriangleGrid: the Z tilt is exactly linear in (col - row), never (col + row)', () => {
  // Vertex order is documented and public (buildTriangleGrid's own header/body): row-major, so
  // vertex index 0 is (c=0,r=0), index `cols` is (c=cols,r=0), and index `rows*(cols+1)` is
  // (c=0,r=rows). These three points fully determine an affine z(c,r) = TILT_SLOPE*(c-r) (never
  // TILT_SLOPE*(c+r), which would fail the "constant nonzero gap under a [5,5,dz] shift" property
  // the live S4 fixture depends on -- see the test below).
  const cols = 20, rows = 10;
  const grid = buildTriangleGrid(cols, rows);
  const stride = cols + 1;
  const zAt = (c, r) => grid.position[(r * stride + c) * 3 + 2];
  const z00 = zAt(0, 0);
  const zC0 = zAt(cols, 0);
  const z0R = zAt(0, rows);
  assert.equal(z00, 0, 'z(0,0) must be exactly 0 -- TILT_SLOPE*(c-r) at c=r=0');
  const tiltSlope = zC0 / cols;
  assert.ok(tiltSlope > 0, 'the tilt must be a real, nonzero slope');
  assert.ok(Math.abs(z0R - (-tiltSlope * rows)) < 1e-9,
    `z(0,rows) must equal -TILT_SLOPE*rows (i.e. z = TILT_SLOPE*(c-r)), got ${z0R} vs expected ${-tiltSlope * rows}`);
});

test('translatedGrid: a [5,5,dz] shift of the tilted grid produces a CONSTANT, exactly-dz vertical ' +
  'gap between corresponding overlapping-region points (never a degenerate/coincident or ' +
  'leaf-AABB-defeating separation)', () => {
  const cols = 20, rows = 20; // rows >= 5 so (c-5, r-5) is always a valid source-grid index below
  const grid = buildTriangleGrid(cols, rows);
  const stride = cols + 1;
  const zAt = (c, r) => grid.position[(r * stride + c) * 3 + 2];
  const dz = 0.1;
  const shifted = translatedGrid(grid, [5, 5, dz]);
  // The shifted grid's vertex at LOCAL index (c,r) now sits at WORLD (c+5, r+5, zAt(c,r)+dz).
  // Source's own vertex at world (c+5, r+5) is grid's LOCAL (c+5, r+5) -- i.e. zAt(c+5, r+5).
  // Both must exist on a 20x20 grid for every (c,r) in [0,15]x[0,15].
  for (const [c, r] of [[0, 0], [5, 3], [10, 10], [15, 2]]) {
    const targetWorldZ = shifted.position[(r * stride + c) * 3 + 2]; // == zAt(c,r) + dz
    const sourceWorldZ = zAt(c + 5, r + 5);
    assert.ok(Math.abs((sourceWorldZ - targetWorldZ) - (-dz)) < 1e-9 || Math.abs((targetWorldZ - sourceWorldZ) - dz) < 1e-9,
      `expected a constant dz=${dz} gap at (c=${c},r=${r}): source=${sourceWorldZ}, target=${targetWorldZ}`);
  }
});
