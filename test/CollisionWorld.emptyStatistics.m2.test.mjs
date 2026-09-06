// test/CollisionWorld.emptyStatistics.m2.test.mjs — exercise emptyStatistics() indirectly via a
// real findClashes call (emptyStatistics is not exported; assert on the returned statistics shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, CapacityExceededError } from '../collision/index.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

test('findClashes result.statistics always carries the 9 new TLAS fields, defaulted 0', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [] }], new Map());
  const world = await CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [] }, target: { model, dbIds: [] }, mode: 'surface-intersection', groupBy: 'dbId',
  });
  for (const field of [
    'tlasLeafRangeEmissions', 'tlasPrimitiveCandidatePairs', 'tlasExactRetestSurvivors',
    'tlasNarrowPhaseInputPairs', 'tlasBuilds', 'tlasCacheHits', 'tlasSharedBuildWaits',
    'tlasBuildMs', 'tlasQueryMs',
  ]) {
    assert.equal(statistics[field], 0, `${field} must default to 0`);
  }
});

test("CapacityExceededError('tlas-candidate-budget') carries a non-admission-worded message", () => {
  const err = new CapacityExceededError('tlas-candidate-budget', { limit: 10, completed: 10, attempted: 11 });
  assert.equal(err.kind, 'tlas-candidate-budget');
  assert.doesNotMatch(err.message, /admission rejected/);
});

test('existing kinds keep their exact original message text (no regression)', () => {
  const err = new CapacityExceededError('bucket-capacity', { loadEpoch: 1 });
  assert.equal(err.message, 'CollisionInstance admission rejected (bucket-capacity)');
});
