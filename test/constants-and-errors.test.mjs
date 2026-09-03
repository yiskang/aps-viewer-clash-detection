import test from 'node:test';
import assert from 'node:assert/strict';
import * as constants from '../collision/constants.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';

test('constants: tolerances match spec defaults', () => {
  assert.equal(constants.barycentricEpsilon, 1e-6);
  assert.equal(constants.coplanarAngleEpsilon, 1e-6);
  assert.equal(constants.mergeDistanceFactor, 1e-6);
  assert.equal(constants.surfaceEpsilonFactor, 1e-6);
  assert.deepEqual(constants.offsetLadderFactors, [1e-3, 1e-4, 1e-5]);
  assert.deepEqual(constants.witnessLadderFactors, [1e-3, 1e-4, 1e-5]);
  assert.deepEqual(constants.crossingProbeFractions, [0.5, 0.1, 0.01]);
  assert.equal(constants.minPenetrationDepthFactor, 1e-5);
  assert.equal(constants.weldEpsilonMeters, 1e-4);
});

test('constants: budgets match spec defaults', () => {
  assert.equal(constants.frameBudgetMs, 8);
  assert.equal(constants.maxCandidatePairsExamined, 50_000);
  assert.equal(constants.maxCrossingPairsExamined, 64);
  assert.equal(constants.maxContainmentSamples, 512);
  assert.equal(constants.samplesPerComponent, 8);
  assert.equal(constants.maxWitnessTriangles, 8);
  assert.equal(constants.maxSyncTriangleCount, 12_000);
  assert.equal(constants.maxFragmentsPerDbId, 5_000);
  assert.equal(constants.maxChildrenPerNode, 10_000);
  assert.equal(constants.maxBroadPhaseInstancePairs, 1_000_000);
  assert.equal(constants.maxCollisionInstancesPerEpoch, 20_000);
});

test('errors: WorldDisposedError / ModelEvictedError shape', () => {
  const wd = new WorldDisposedError();
  assert.ok(wd instanceof Error);
  assert.equal(wd.name, 'WorldDisposedError');

  const me = new ModelEvictedError(42);
  assert.ok(me instanceof Error);
  assert.equal(me.name, 'ModelEvictedError');
  assert.equal(me.modelId, 42);
  assert.match(me.message, /42/);
});
