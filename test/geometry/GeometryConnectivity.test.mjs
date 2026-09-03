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
