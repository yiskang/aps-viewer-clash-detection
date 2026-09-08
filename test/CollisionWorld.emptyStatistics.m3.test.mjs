// test/CollisionWorld.emptyStatistics.m3.test.mjs — exercise emptyStatistics() indirectly via a
// real findClashes call (emptyStatistics is not exported; assert on the returned statistics shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/index.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

test('M3 clearance statistics fields are always present and default to 0', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [] }], new Map());
  const world = new CollisionWorld();
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', groupBy: 'dbId',
  });
  for (const field of [
    'clearanceExpandedCandidatePairs', 'clearanceExactAabbSurvivors', 'clearanceOverlapPrechecksRun',
    'clearanceHardClashExclusions', 'clearanceDistanceQueriesRun', 'clearanceHits', 'clearanceQueryMs',
  ]) {
    assert.equal(statistics[field], 0, `${field} must default to 0 on a non-clearance call`);
  }
});
