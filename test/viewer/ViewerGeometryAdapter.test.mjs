import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptViewerGeometry, computeActiveTriangleCount } from '../../collision/viewer/ViewerGeometryAdapter.js';
import * as THREE from '../../node_modules/three/build/three.module.js';

// A minimal two-triangle quad (4 vertices, 6 index elements = 2 triangles), reused
// across fixtures with different position-layout encodings.
const QUAD_POSITIONS_PLAIN = new Float32Array([
  0, 0, 0,   1, 0, 0,   1, 1, 0,   0, 1, 0,
]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

test('vb/vbstride/vblayout Viewer-internal interleaved layout (confirmed primary)', () => {
  const vb = new Float32Array([
    0, 0, 0, 9, 9,
    1, 0, 0, 9, 9,
    1, 1, 0, 9, 9,
    0, 1, 0, 9, 9,
  ]); // 5 floats/vertex: position(3) + filler(2), position at offset 0
  const geometry = { vb, vbstride: 5, vblayout: { position: { offset: 0 } }, ib: QUAD_INDEX };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positions, vb);
  assert.equal(result.positionStride, 5);
  assert.equal(result.positionOffset, 0);
  assert.equal(result.index, QUAD_INDEX);
  assert.equal(result.activeTriangleCount, 2);
});

test('standard attributes.position.array (non-interleaved BufferAttribute)', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positions, QUAD_POSITIONS_PLAIN);
  assert.equal(result.positionStride, 3);
  assert.equal(result.positionOffset, 0);
  assert.equal(result.index, QUAD_INDEX);
  assert.equal(result.activeTriangleCount, 2);
});

test('standard InterleavedBufferAttribute, stride > 3, nonzero position offset', () => {
  // position+normal+uv interleaved, 8 floats/vertex, position starts at offset 3 --
  // a wrong field mapping here would silently read normal/uv data as position.
  const interleaved = new Float32Array([
    9, 9, 9,   0, 0, 0,   9, 9,
    9, 9, 9,   1, 0, 0,   9, 9,
    9, 9, 9,   1, 1, 0,   9, 9,
    9, 9, 9,   0, 1, 0,   9, 9,
  ]);
  const geometry = {
    attributes: { position: { data: { array: interleaved, stride: 8 }, offset: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.equal(result.positionStride, 8);
  assert.equal(result.positionOffset, 3);
  const x1 = result.positions[1 * result.positionStride + result.positionOffset];
  assert.equal(x1, 1, 'the uniform accessor must read real position data, not the normal/uv filler');
});

test('index via geometry.index.array (never geometry.attributes.index.array)', () => {
  const geometry = {
    attributes: {
      position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 },
      index: { array: new Uint16Array([99, 99, 99]) }, // previous draft's bug location -- must never be read
    },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.index, QUAD_INDEX);
});

test('geometry.groups populated: ranges reflect each group', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: 0, count: 3 }, { start: 3, count: 3 }],
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 0, count: 3 }, { start: 3, count: 3 }]);
  assert.equal(result.activeTriangleCount, 2);
});

test('geometry.groups absent: synthesizes one full-coverage range', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 0, count: 6 }]);
  assert.equal(result.activeTriangleCount, 2);
});

test('geometry.groups === [] (empty-but-present): same triangle count as absent case', () => {
  // Standard BufferGeometry initializes groups = [] in its constructor -- every
  // fallback-path geometry hits this. A `groups ? ... : ...` truthiness check takes
  // the groups branch, iterates zero groups, and silently emits zero ranges: a clean
  // false negative indistinguishable from a verified no-clash. This is that regression.
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.activeTriangleCount, 2, 'must match the groups-absent case, not silently become 0');
});

test('geometry.groups AND geometry.drawRange both present: intersected, not either/or', () => {
  // Group covers index elements [0,6) (both triangles); drawRange only opens [3,6) --
  // a previous draft applied drawRange only when groups was ABSENT, which would keep
  // both triangles here instead of clipping to one.
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: 0, count: 6 }],
    drawRange: { start: 3, count: 3 },
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 3, count: 3 }]);
  assert.equal(result.activeTriangleCount, 1);
});

test('legacy offsets layout: rejected as rejected-primitive-range, not normalized', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    offsets: [{ start: 0, count: 6, index: 0 }],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'rejected-primitive-range');
});

test('unsupported layout: no recognizable position source', () => {
  const result = adaptViewerGeometry({ someUnknownField: true });
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'unsupported-geometry-layout');
});

test('computeActiveTriangleCount: sums floor(count/3) per range, not raw sum', () => {
  assert.equal(computeActiveTriangleCount([{ start: 0, count: 10 }]), 3); // floor(10/3)
  assert.equal(computeActiveTriangleCount([{ start: 0, count: 9 }, { start: 9, count: 9 }]), 6);
});

test('group range exceeding buffer bounds: clamped to [0, fullCount), not unclamped', () => {
  // A group that claims {start:0, count:30003} on a 6-element index should be
  // clamped to {start:0, count:6}, preventing 5000x overcounting and index overruns.
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX }, // 6 elements total
    groups: [{ start: 0, count: 30003 }], // absurdly large, exceeds buffer
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, false);
  assert.deepEqual(result.ranges, [{ start: 0, count: 6 }]);
  assert.equal(result.activeTriangleCount, 2, 'must clamp to actual buffer, not propagate overrun');
});

test('group + drawRange intersection still clamps group to fullCount', () => {
  // Group claims {start:0, count:30003}, drawRange is {start:0, count:3}.
  // Should clamp group first to [0,6), then intersect with drawRange -> [0,3).
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: 0, count: 30003 }],
    drawRange: { start: 0, count: 3 },
  };
  const result = adaptViewerGeometry(geometry);
  assert.deepEqual(result.ranges, [{ start: 0, count: 3 }]);
  assert.equal(result.activeTriangleCount, 1);
});

test('null input: returns unsupported, does not throw', () => {
  const result = adaptViewerGeometry(null);
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'unsupported-geometry-layout');
});

test('undefined input: returns unsupported, does not throw', () => {
  const result = adaptViewerGeometry(undefined);
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, 'unsupported-geometry-layout');
});

test('non-object input (string, number): returns unsupported, does not throw', () => {
  assert.equal(adaptViewerGeometry('not-a-geometry').unsupported, true);
  assert.equal(adaptViewerGeometry(123).unsupported, true);
});

test('NaN stride: returns unsupported instead of propagating NaN', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: NaN } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true, 'must reject NaN stride as invalid');
});

test('Infinity stride: returns unsupported instead of propagating Infinity', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: Infinity } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true, 'must reject Infinity stride as invalid');
});

test('negative stride: returns unsupported', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: -3 } },
    index: { array: QUAD_INDEX },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true);
});

test('NaN in drawRange: returns unsupported', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    drawRange: { start: 0, count: NaN },
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true);
});

test('negative group start: returns unsupported', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [{ start: -1, count: 6 }],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true);
});

test('groups array containing null: returns unsupported (not throw)', () => {
  const geometry = {
    attributes: { position: { array: QUAD_POSITIONS_PLAIN, itemSize: 3 } },
    index: { array: QUAD_INDEX },
    groups: [null],
  };
  const result = adaptViewerGeometry(geometry);
  assert.equal(result.unsupported, true, 'must reject null group, not throw');
});

test('REGRESSION: real THREE.BufferGeometry with default drawRange (Infinity)', () => {
  // three.js sets drawRange = { start: 0, count: Infinity } by default, meaning "draw all".
  // This is a legitimate sentinel value, not invalid input — Infinity is clamped by
  // intersectRange to the actual fullCount. Must NOT be rejected as unsupported.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD_POSITIONS_PLAIN, 3));
  geo.setIndex(new THREE.BufferAttribute(QUAD_INDEX, 1));

  // Verify the geometry has the default Infinity drawRange
  assert.equal(geo.drawRange.count, Infinity, 'test fixture has THREE default drawRange.count');

  const result = adaptViewerGeometry(geo);
  assert.equal(result.unsupported, false, 'must succeed on normal THREE.BufferGeometry');
  assert.equal(result.activeTriangleCount, 2, 'Infinity drawRange must be treated as "no limit"');
  assert.deepEqual(result.ranges, [{ start: 0, count: 6 }], 'ranges clamped to index length');
});
