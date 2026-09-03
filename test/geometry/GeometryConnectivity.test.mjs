import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeGeometryConnectivity } from '../../collision/geometry/GeometryConnectivity.js';

function weldedBox(size = 1) {
  const box = new THREE.BoxGeometry(size, size, size);
  const stripped = new THREE.BufferGeometry();
  stripped.setAttribute('position', box.attributes.position.clone());
  stripped.setIndex(box.index.clone());
  const welded = mergeVertices(stripped);
  return { position: welded.attributes.position.array, index: Uint32Array.from(welded.index.array) };
}

test('closed manifold box: 1 component, closedManifold = [true]', () => {
  const { index } = weldedBox();
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [true]);
});

test('open shell (single triangle): closedManifold = [false]', () => {
  const index = new Uint32Array([0, 1, 2]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [false]);
});

test('non-manifold: three triangles sharing one edge -> that component flagged non-manifold', () => {
  // Triangles 0 and 1 share edge (0,1) normally; triangle 2 ALSO uses edge (0,1) --
  // a junction edge shared by 3 triangles.
  const index = new Uint32Array([
    0, 1, 2,
    1, 0, 3,
    0, 1, 4,
  ]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 1);
  assert.deepEqual(Array.from(result.closedManifold), [false]);
});

test('duplicated seam vertex over-segmentation: conservative, not a failure', () => {
  // Two triangles that SHOULD share an edge but reference different (unwelded,
  // duplicate) vertex ids for it -- edge-connectivity legitimately reports 2
  // components here (spec:1789-1805: over-segmentation is conservative, more
  // sampling, never less correctness).
  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 2, 'un-welded duplicate seam vertices legitimately over-segment');
});

test('two disjoint closed boxes: 2 components, both closed', () => {
  const boxA = weldedBox(1);
  const boxB = weldedBox(1);
  const vertexOffset = boxA.position.length / 3;
  const offsetIndex = Uint32Array.from(boxB.index, (i) => i + vertexOffset);
  const mergedIndex = new Uint32Array(boxA.index.length + offsetIndex.length);
  mergedIndex.set(boxA.index, 0);
  mergedIndex.set(offsetIndex, boxA.index.length);
  const result = computeGeometryConnectivity({ index: mergedIndex });
  assert.equal(result.componentCount, 2);
  assert.deepEqual(Array.from(result.closedManifold), [true, true]);
});

test('componentOf assigns every triangle of the same component the same id', () => {
  const { index } = weldedBox();
  const result = computeGeometryConnectivity({ index });
  const ids = new Set(result.componentOf);
  assert.equal(ids.size, 1);
  assert.equal(result.componentOf.length, index.length / 3);
});

test('DISCRIMINATOR: edge-based (not vertex-based): two triangles sharing only one vertex must NOT merge', () => {
  // Triangle A = [0,1,2], Triangle B = [0,3,4]: they share only vertex 0, not an edge.
  // Edge-based: 2 separate edges in A (0-1, 1-2, 2-0) and 2 in B (0-3, 3-4, 4-0) -- no match -> 2 components.
  // Vertex-based (wrong): both share vertex 0 -> would merge to 1 component.
  const index = new Uint32Array([
    0, 1, 2,  // Triangle A
    0, 3, 4,  // Triangle B (only shares vertex 0 with A)
  ]);
  const result = computeGeometryConnectivity({ index });
  assert.equal(result.componentCount, 2, 'two triangles sharing only a vertex must be separate components (edge-based, not vertex-based)');
});

test('Finding 1 (defense-in-depth): degenerate triangles (repeated vertex index) must not report closedManifold: true', () => {
  // Two degenerate triangles: [0,0,1] and [0,0,2]. Each has a repeated vertex index
  // (edge occurrences, not distinct triangles, would otherwise let their self-edges
  // spuriously satisfy the "shared by exactly 2" check and even spuriously union them
  // into a single falsely-manifold component via the shared "0_0" self-edge key).
  const index = new Uint32Array([0, 0, 1, 0, 0, 2]);
  const result = computeGeometryConnectivity({ index });
  assert.ok(
    Array.from(result.closedManifold).every((flag) => flag === false),
    'no component containing a degenerate triangle may be reported as closedManifold: true'
  );
  // Stronger than the aggregate check above: the two degenerate triangles must NOT be
  // spuriously unioned into one shared component via their coincidental "0_0" self-edge
  // -- each stays isolated in its own singleton component.
  assert.equal(result.componentCount, 2, 'two unrelated degenerate triangles must not be spuriously merged into one component');
  assert.notEqual(result.componentOf[0], result.componentOf[1], 'each degenerate triangle must be its own isolated component');
});

test('Finding 1 (defense-in-depth): a degenerate triangle does not corrupt an otherwise-valid neighboring component', () => {
  // A real closed box, plus one degenerate triangle referencing box vertices --
  // the degenerate triangle must not falsely certify itself as manifold, and must not
  // break the real box component's own correct closedManifold: true.
  const box = weldedBox();
  const boxTriangleCount = box.index.length / 3;
  const degenerateTriangle = new Uint32Array([0, 0, 1]); // repeated vertex index
  const mergedIndex = new Uint32Array(box.index.length + degenerateTriangle.length);
  mergedIndex.set(box.index, 0);
  mergedIndex.set(degenerateTriangle, box.index.length);

  const result = computeGeometryConnectivity({ index: mergedIndex });
  // Stronger than an aggregate flags.includes() check: pin down the EXACT component
  // each triangle lands in, not just that both true and false appear somewhere.
  const boxComponentId = result.componentOf[0];
  const degenerateComponentId = result.componentOf[boxTriangleCount];
  assert.notEqual(boxComponentId, degenerateComponentId, 'the degenerate triangle must not be merged into the box component');
  for (let t = 0; t < boxTriangleCount; t++) {
    assert.equal(result.componentOf[t], boxComponentId, 'every box triangle must share the box component');
  }
  assert.equal(result.closedManifold[boxComponentId], true, 'the real box component must still report closedManifold: true');
  assert.equal(result.closedManifold[degenerateComponentId], false, "the degenerate triangle's own component must report closedManifold: false");
});

test('DISCRIMINATOR: per-component (not per-geometry) manifold: mixed closed + open components have per-component flags', () => {
  // Component 0: a closed box (closed manifold).
  // Component 1: a single triangle (open shell, non-manifold).
  // If manifold classification were per-geometry, both would share one boolean.
  // Per-component: they have independent flags.
  const boxA = weldedBox(1);
  const boxVertexCount = boxA.position.length / 3;
  const openTriangleVertexOffset = boxVertexCount;

  // Merge box triangles with a separate open triangle (single triangle = non-manifold).
  const mergedIndex = new Uint32Array(boxA.index.length + 3);
  mergedIndex.set(boxA.index, 0);
  mergedIndex.set(
    new Uint32Array([openTriangleVertexOffset, openTriangleVertexOffset + 1, openTriangleVertexOffset + 2]),
    boxA.index.length
  );

  const result = computeGeometryConnectivity({ index: mergedIndex });
  assert.equal(result.componentCount, 2, 'one box + one open triangle = 2 components');

  // Component 0 (box) must be closed manifold; component 1 (single triangle) must be open/non-manifold.
  const flags = Array.from(result.closedManifold);
  assert.equal(flags.length, 2, 'must have 2 per-component flags');
  assert.equal(flags[0], true, 'box component is closed manifold');
  assert.equal(flags[1], false, 'open triangle component is not manifold');
});
