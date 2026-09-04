import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { classifyPoint } from '../../collision/query/ContainmentQuery.js';

// Local geometry-building helpers, ported from spike/fixtures.mjs's box/mergeGeometries
// -- kept self-contained in this test file rather than assuming a shared
// test/fixtures/ geometry-helpers module another task may or may not have created.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function mergeGeometries(geoms) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g of geoms) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    positions.push(...g.attributes.position.array);
    for (const i of gi) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}
function weldedFromRaw(geometry) {
  // classifyPoint's own correctness does not depend on welding (Task 3's job) -- only
  // on a valid MeshBVH + accurate localDiagonal, so the raw (unwelded) buffer is fine here.
  const index = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from([...Array(geometry.attributes.position.count).keys()]);
  return { position: geometry.attributes.position.array, index, triangleCount: index.length / 3 };
}
function instanceOf(geometry) {
  return build(weldedFromRaw(geometry));
}

test('demonstrably inside / outside', () => {
  const b = instanceOf(box(2, 2, 2));
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
  assert.equal(classifyPoint(new THREE.Vector3(5, 0, 0), b.bvh, b.localDiagonal), 'outside');
});

test('ROUND 4 REGRESSION: point on the interior of a face is boundary, not inside (checked across several faces/ray directions)', () => {
  const b = instanceOf(box(2, 2, 2));
  const faceInteriorPoints = [
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  for (const p of faceInteriorPoints) {
    assert.equal(classifyPoint(p, b.bvh, b.localDiagonal), 'boundary', `face point ${p.toArray()} must be boundary`);
  }
});

test('point on edge, and on vertex -> boundary', () => {
  const b = instanceOf(box(2, 2, 2));
  assert.equal(classifyPoint(new THREE.Vector3(1, 1, 0), b.bvh, b.localDiagonal), 'boundary');
  assert.equal(classifyPoint(new THREE.Vector3(1, 1, 1), b.bvh, b.localDiagonal), 'boundary');
});

test('THREE.DoubleSide is mandatory: a thin open shell has more raycast hits with DoubleSide than FrontSide', () => {
  const shell = new THREE.PlaneGeometry(4, 4);
  const b = instanceOf(shell);
  const ray = new THREE.Ray(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1));
  const doubleSideHits = b.bvh.raycast(ray, THREE.DoubleSide);
  const frontSideHits = b.bvh.raycast(ray, THREE.FrontSide);
  assert.ok(doubleSideHits.length >= frontSideHits.length);
  assert.ok(doubleSideHits.length > 0, 'DoubleSide must see the back-facing crossing a FrontSide-only cast could miss');
});

test('coincident duplicate triangles: ray through them counts as ONE merged crossing, not two', () => {
  // A ray exiting the box crosses its (single) surface once -- odd parity, `inside`
  // from the centre. Duplicating every triangle exactly (same position, same
  // transform) makes each real crossing produce TWO near-zero-separation hits;
  // without distance-sort-then-merge these would double-count as even parity and
  // misclassify `outside`. Note: this tests coincident SURFACES, not a shared edge (a
  // shared-edge ray is rejected by barycentricEpsilon and retried on the next
  // direction -- it never reaches merge logic at all).
  const doubled = mergeGeometries([box(2, 2, 2), box(2, 2, 2)]);
  const b = instanceOf(doubled);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
});

test('target under non-uniform scale: tolerances scale with the target\'s own local diagonal', () => {
  const b = instanceOf(box(10, 0.5, 0.5)); // long, thin, non-uniform box
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
  assert.equal(classifyPoint(new THREE.Vector3(0, 0.25, 0), b.bvh, b.localDiagonal), 'boundary');
  assert.equal(classifyPoint(new THREE.Vector3(0, 100, 0), b.bvh, b.localDiagonal), 'outside');
});

test('point inside two nested closed shells (even-odd model): outside -- correct for a hollow container', () => {
  const nested = mergeGeometries([box(4, 4, 4), box(2, 2, 2)]);
  const b = instanceOf(nested);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'even-odd: correct for a hollow container/pipe, and the stated limitation for nested independent solids');
  assert.equal(classifyPoint(new THREE.Vector3(1.5, 0, 0), b.bvh, b.localDiagonal), 'inside',
    'the material region between the two shells');
});

test('pipe/annulus: a point in the bore reads outside (hollow, correct by design)', () => {
  const pipe = mergeGeometries([
    new THREE.CylinderGeometry(2, 2, 4, 24),
    new THREE.CylinderGeometry(1, 1, 4, 24),
  ]);
  const b = instanceOf(pipe);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'bore point crosses both shells -- even parity -- pipe is correctly hollow');
});

test('nested independent solids (stated M1 limitation, not a bug): same outside result as the hollow case', () => {
  // Geometrically identical triangle set to the nested-shells fixture above --
  // even-odd cannot distinguish "hollow container" from "two independent solids, one
  // nested inside the other" (spec:1669-1676). This documents the accepted
  // limitation rather than asserting incorrect behaviour is a bug.
  const twoSolids = mergeGeometries([box(4, 4, 4), box(2, 2, 2)]);
  const b = instanceOf(twoSolids);
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'stated M1 limitation: reads as a cavity, indistinguishable from the hollow case above');
});

test('representative BIM aspect ratio (~1000:1, e.g. a long thin duct/wall segment): classifyPoint remains correct', () => {
  // This pins correctness at a REALISTIC BIM/MEP envelope (a long thin duct or wall
  // segment: 0.01m thick x 10m long x 0.5m tall, ~1000:1 aspect ratio) -- it is NOT a
  // claim that the tolerance model (mergeDistance/surfaceEpsilon, both scaled off the
  // target's single global localDiagonal) is safe at ALL aspect ratios. See the
  // `{ todo: true }` extreme-aspect-ratio reproducer below (max/min local extent = 2,000,000:1, a scale real
  // BIM/MEP elements do not realistically approach) for the known, tracked gap in that
  // tolerance model, and the comment beside classifyPoint's tolerance calculation in
  // collision/query/ContainmentQuery.js for the full explanation of both failure modes.
  const b = instanceOf(box(0.01, 10, 0.5));
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside');
  assert.equal(classifyPoint(new THREE.Vector3(0.1, 0, 0), b.bvh, b.localDiagonal), 'outside');
  assert.equal(classifyPoint(new THREE.Vector3(0.005, 0, 0), b.bvh, b.localDiagonal), 'boundary');
  assert.equal(classifyPoint(new THREE.Vector3(0, 6, 0), b.bvh, b.localDiagonal), 'outside');
});

test('KNOWN GAP (tracked separately, not fixed by Task 6): extreme single-geometry aspect ratio (max/min local extent = 2,000,000:1) breaks both mergeDistance and surfaceEpsilon', { todo: true }, () => {
  // EXACT reproducer from the codex-review finding (independently reproduced by both
  // codex-advisor and the Task-6 implementer against the running implementation):
  // both classifyPoint tolerances scale off the target's single GLOBAL localDiagonal,
  // not any local/per-feature thickness, so an extreme single-geometry aspect ratio
  // (distinct from the spec's existing "anisotropic scale" passage, which covers
  // cross-instance transform anisotropy, a different mechanism) breaks two ways on
  // this SAME fixture:
  //   (a) merge-collapse: mergeDistance (~1.41 here) exceeds the box's actual 0.5
  //       thickness, merging the thin dimension's entry/exit crossings -- a genuinely
  //       OUTSIDE point currently misclassifies as `inside`.
  //   (b) boundary-expansion: surfaceEpsilon (same global-diagonal scale) catches the
  //       genuinely INTERIOR centre point in the Stage-1 proximity pre-check before
  //       parity casting runs -- it currently misclassifies as `boundary` instead of
  //       `inside`.
  // This asserts the DESIRED CORRECT answers, not today's actual (wrong) output, so a
  // future fix to the tolerance model turns this test green instead of leaving the gap
  // invisible. A proper fix needs geometric evidence beyond a single scalar (hit
  // positions/normals/local feature scale) -- a spec-revision-level redesign, out of
  // Task 6's scope. Do not attempt to fix this by editing this test's expectations.
  const b = instanceOf(box(0.5, 1_000_000, 1_000_000));
  assert.equal(classifyPoint(new THREE.Vector3(-10, 0, 0), b.bvh, b.localDiagonal), 'outside',
    'currently misclassifies inside due to merge-collapse (failure mode (a))');
  assert.equal(classifyPoint(new THREE.Vector3(0, 0, 0), b.bvh, b.localDiagonal), 'inside',
    'currently misclassifies boundary due to boundary-expansion (failure mode (b))');
});
