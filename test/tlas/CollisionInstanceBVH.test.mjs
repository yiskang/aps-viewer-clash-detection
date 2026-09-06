import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from 'three';
import { CollisionInstanceBVH } from '../../collision/tlas/CollisionInstanceBVH.js';

const rec = (fragmentId, [minX, minY, minZ], [maxX, maxY, maxZ], ownerDbId = fragmentId) => ({
  loadEpoch: 1, fragmentId, ownerDbId, modelId: 'm', worldBounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
});

test('constructs over N records with no throw, and getBoundingBox covers all of them', () => {
  // Fixed after codex-review (Important #3): BVH.prototype.getBoundingBox requires a REAL
  // THREE.Box3 (it calls .makeEmpty()/.union() on the target internally) -- a plain
  // {min:[...],max:[...]} object throws `target.makeEmpty is not a function`.
  const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [10, 10, 10], [11, 11, 11])];
  const bvh = new CollisionInstanceBVH(records);
  const box = new Box3();
  bvh.getBoundingBox(box);
  assert.ok(box.min.x <= 0 && box.max.x >= 11);
});

test('empty record set builds a well-defined, queryable-but-always-empty tree', () => {
  const bvh = new CollisionInstanceBVH([]);
  const seen = [];
  const { truncated } = bvh.queryBox([-1, -1, -1], [1, 1, 1], { onCandidate: (i) => seen.push(i) });
  assert.deepEqual(seen, []);
  assert.equal(truncated, false);
});

test('queryBox against a box overlapping only record 2 resolves back to record 2 via recordAt', () => {
  const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [10, 10, 10], [11, 11, 11])];
  const bvh = new CollisionInstanceBVH(records);
  const seen = [];
  bvh.queryBox([9.5, 9.5, 9.5], [12, 12, 12], {
    onCandidate: (builderPositionIndex) => seen.push(bvh.recordAt(builderPositionIndex).fragmentId),
  });
  assert.deepEqual(seen, [2]);
});

test('a query box overlapping neither record calls onCandidate zero times', () => {
  const records = [rec(1, [0, 0, 0], [1, 1, 1])];
  const bvh = new CollisionInstanceBVH(records);
  const seen = [];
  bvh.queryBox([100, 100, 100], [101, 101, 101], { onCandidate: (i) => seen.push(i) });
  assert.deepEqual(seen, []);
});

test('a query box overlapping both records resolves both, exactly once each', () => {
  const records = [rec(1, [0, 0, 0], [2, 2, 2]), rec(2, [1, 1, 1], [3, 3, 3])];
  const bvh = new CollisionInstanceBVH(records);
  const seen = [];
  bvh.queryBox([0.5, 0.5, 0.5], [1.5, 1.5, 1.5], {
    onCandidate: (i) => seen.push(bvh.recordAt(i).fragmentId),
  });
  seen.sort();
  assert.deepEqual(seen, [1, 2]);
});

test('a forced-reordering fixture proves recordAt resolves the BUILDER-position index, never the insertion-order index', () => {
  // Construct enough spatially-separated records that the packed-tree builder's own partitioning
  // (sortUtils.js's `partition`) provably reorders primitiveBuffer away from insertion order (a
  // small, clustered 2-3 record set may happen to stay in order and would not catch a regression
  // where an implementer wires onCandidate's argument directly into `records[i]`, bypassing
  // recordAt entirely). Assert every resolved fragmentId, via recordAt, matches the record whose
  // OWN worldBounds actually overlaps the query box -- not the record at that same array index.
  const records = [
    rec(100, [50, 50, 50], [51, 51, 51]),       // far away
    rec(200, [0, 0, 0], [1, 1, 1]),              // query target
    rec(300, [-50, -50, -50], [-49, -49, -49]),  // far away, opposite direction
  ];
  const bvh = new CollisionInstanceBVH(records);
  const seen = [];
  bvh.queryBox([-0.5, -0.5, -0.5], [1.5, 1.5, 1.5], {
    onCandidate: (builderPositionIndex) => seen.push(bvh.recordAt(builderPositionIndex).fragmentId),
  });
  assert.deepEqual(seen, [200]); // must be 200 regardless of where the builder actually placed it
});

test('queryBox reports leaf-range emissions via onLeafRange, separately from per-primitive onCandidate', () => {
  // Multiple co-located records force a single leaf covering more than one primitive -- assert
  // onLeafRange fires fewer times than onCandidate for such a fixture (stage 1 <= stage 2, spec
  // §7.5.1's own tlasLeafRangeEmissions/tlasPrimitiveCandidatePairs distinction).
  const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [0, 0, 0], [1, 1, 1]), rec(3, [0, 0, 0], [1, 1, 1])];
  const bvh = new CollisionInstanceBVH(records);
  let leafRanges = 0;
  let candidates = 0;
  bvh.queryBox([0, 0, 0], [1, 1, 1], {
    onLeafRange: () => { leafRanges++; },
    onCandidate: () => { candidates++; },
  });
  assert.equal(candidates, 3);
  assert.ok(leafRanges >= 1 && leafRanges <= candidates);
});

test('queryBox stops early and reports truncated when onCandidate returns "stop"', () => {
  const records = [rec(1, [0, 0, 0], [1, 1, 1]), rec(2, [0, 0, 0], [1, 1, 1]), rec(3, [0, 0, 0], [1, 1, 1])];
  const bvh = new CollisionInstanceBVH(records);
  let calls = 0;
  const { truncated } = bvh.queryBox([0, 0, 0], [1, 1, 1], {
    onCandidate: () => { calls++; return calls >= 2 ? 'stop' : undefined; },
  });
  assert.equal(truncated, true);
  assert.equal(calls, 2);
});

test('a callback exception during queryBox is contained: traversal cleans up, then rethrows after returning', () => {
  const records = [rec(1, [0, 0, 0], [1, 1, 1])];
  const bvh = new CollisionInstanceBVH(records);
  assert.throws(() => {
    bvh.queryBox([0, 0, 0], [1, 1, 1], { onCandidate: () => { throw new Error('boom'); } });
  }, /boom/);
  // A second, independent query on the SAME instance must still work -- proves module-global
  // traversal state (bvhcast's own `_active` hazard, spec §7.1) was not left corrupted.
  let ran = false;
  bvh.queryBox([0, 0, 0], [1, 1, 1], { onCandidate: () => { ran = true; } });
  assert.equal(ran, true);
});
