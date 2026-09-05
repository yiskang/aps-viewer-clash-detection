// test/performance/measure-geometry-phases.mjs
//
// Extends spike/measure.mjs's own BVH-cost-vs-triangle-count loop (measure.mjs:9-17) to also time
// weld and connectivity individually -- the gap Round 15 found: "Round 15 found the prior version
// of this gate only ever measured the BVH build... which is exactly how a ~16.8ms weld and a ~6.9ms
// connectivity build... went undetected for four rounds" (docs/...:4704-4709). Runs against the
// REAL production collision/ modules (not the spike's parallel implementation), which is the other
// half of the gap this task fills -- spike/measure.mjs times spike/geometry-core.mjs's own
// hand-rolled algorithms, never collision/geometry/activeRangeCompaction.js et al.
//
// Run with: node test/performance/measure-geometry-phases.mjs
//
// This task's own sanity check for this file is: does it run to completion and print three
// distinct, non-zero, plausible numbers at an *exactly*-asserted 12,000-triangle fixture -- not
// whether those numbers pass criterion 5 against the real ceiling (that needs the real MEP-scale
// model, Task 24, and the per-phase decision rule Task 24 Step 4 applies).

import * as THREE from 'three';
import { CheckpointRecorder } from './checkpoint-recorder.mjs';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';
import { computeGeometryConnectivity } from '../../collision/geometry/GeometryConnectivity.js';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { maxSyncTriangleCount } from '../../collision/constants.js';

/** A flat, deterministic cols*rows*2-triangle grid -- no tessellator-formula guessing. A
 *  SphereGeometry(1, 98, 98) under this repo's pinned three@0.185.1, for instance, produces
 *  19,012 triangles, not ~12,000 -- an approximated fixture would have the production size gate
 *  reject it before welding ever ran. */
function buildTriangleGrid(cols, rows) {
  const position = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) position.push(c, r, 0);
  const index = [];
  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c, b = a + 1, d = a + stride, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geom.setIndex(index);
  return geom;
}

const rec = new CheckpointRecorder();

console.log('\n=== GeometryRecord phase costs at maxSyncTriangleCount (criterion 5) ===');
console.log(`  Ceiling under test: maxSyncTriangleCount = ${maxSyncTriangleCount}\n`);

// 100 cols x 60 rows = 6,000 quads x 2 triangles = exactly 12,000 triangles.
const COLS = 100;
const ROWS = maxSyncTriangleCount / (COLS * 2);
const raw = buildTriangleGrid(COLS, ROWS);
const triangleCount = raw.index.count / 3;
if (triangleCount !== maxSyncTriangleCount) {
  throw new Error(`Fixture produced ${triangleCount} triangles, expected exactly ${maxSyncTriangleCount} -- fix COLS/ROWS.`);
}
console.log(`  Fixture triangle count: ${triangleCount} (exact ceiling, asserted)\n`);

// Real production pipeline: adaptViewerGeometry -> compactAndWeld -> computeGeometryConnectivity ->
// ThreeMeshBvhBackend.build -- exactly the sequence GeometryRegistry's own _runPhase chain drives,
// via createGeometryRegistry.js's real buildWeld/buildConnectivity/buildAcceleration wiring.
const view = adaptViewerGeometry(raw);
if (view.unsupported) {
  throw new Error(`adaptViewerGeometry rejected the synthetic fixture: ${view.reason}`);
}
if (view.activeTriangleCount !== maxSyncTriangleCount) {
  throw new Error(`adaptViewerGeometry reported activeTriangleCount=${view.activeTriangleCount}, expected ${maxSyncTriangleCount}.`);
}

const [weldMs, weldedGeom] = await rec.around('weld', () => compactAndWeld(view, { maxSyncTriangleCount }));
if (weldedGeom.oversized) {
  throw new Error(`compactAndWeld rejected the exactly-at-ceiling fixture as oversized: ${weldedGeom.reason}`);
}
const [connMs, connResult] = await rec.around('connectivity', () => computeGeometryConnectivity(weldedGeom));
const [bvhMs] = await rec.around('bvh-construction', () => build(weldedGeom));

console.log(`  weld              ${weldMs.toFixed(2).padStart(8)}ms  (triangleCount=${weldedGeom.triangleCount})`);
console.log(`  connectivity      ${connMs.toFixed(2).padStart(8)}ms  (componentCount=${connResult.componentCount})`);
console.log(`  bvh-construction  ${bvhMs.toFixed(2).padStart(8)}ms`);
console.log(`\n  sum               ${(weldMs + connMs + bvhMs).toFixed(2).padStart(8)}ms  (reported for context only --`);
console.log(`  criterion 5's actual pass/fail line is PER-PHASE, not the sum: docs/...:4708-4709 says each`);
console.log(`  phase must "individually clear its share of the accepted per-atomic-operation ceiling with`);
console.log(`  margin" -- Task 24 applies that per-phase, never against the summed figure.`);
console.log(`  measure.mjs's synthetic BVH-only figure for comparison: see spike/measure.mjs output directly`);
console.log(`  (not conflated -- docs/...:4688).`);

rec.dispose();
