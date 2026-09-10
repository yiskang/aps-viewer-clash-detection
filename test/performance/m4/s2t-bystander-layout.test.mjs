import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S2T_LEVELS, bystanderLayout, syntheticIdRangeAbove } from './s2t-bystander-layout.mjs';

test('S2T_LEVELS are the four admitted-instance population levels', () => {
  assert.deepEqual(S2T_LEVELS, [5435, 10000, 15000, 20000]);
});

test('syntheticIdRangeAbove: strictly above the real measured maximum', () => {
  assert.equal(syntheticIdRangeAbove(5434), 5435);
});

test('bystanderLayout: deterministic, no two bystanders share an identical AABB position', () => {
  const layout = bystanderLayout(200, { syntheticFragmentIdStart: 5435, syntheticGeometryIdStart: 9000 });
  const positions = new Set(layout.map((b) => b.position.join(',')));
  assert.equal(positions.size, layout.length, 'every bystander must have a distinct position (no degenerate single-AABB BVH)');
});

test('bystanderLayout: every bystander AABB lies far outside a representative near-source box', () => {
  const nearSourceMax = 1000; // a generous upper bound on the real fixture's own coordinate range
  const layout = bystanderLayout(50, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  for (const b of layout) assert(b.position.every((c) => c > nearSourceMax), 'bystander must be outside the query region');
});

test('bystanderLayout: levels are nested — smaller level is an exact prefix of the larger level', () => {
  const small = bystanderLayout(10, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  const large = bystanderLayout(20, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  assert.deepEqual(large.slice(0, 10), small);
});

test('bystanderLayout: synthetic fragment/geometry ids are contiguous and disjoint from the real range', () => {
  const layout = bystanderLayout(5, { syntheticFragmentIdStart: 5435, syntheticGeometryIdStart: 9000 });
  assert.deepEqual(layout.map((b) => b.fragmentId), [5435, 5436, 5437, 5438, 5439]);
  assert.deepEqual(layout.map((b) => b.geometryId), [9000, 9001, 9002, 9003, 9004]);
});
