import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld, CapacityExceededError } from '../collision/CollisionWorld.js';
import { maxClearanceNarrowPhasePairs } from '../collision/constants.js';

test('candidates.length exactly at the limit does not throw', async () => {
  const world = new CollisionWorld();
  // Cheap placeholder tuples -- the preflight check runs BEFORE any narrow-phase geometry resolution
  // is attempted, so these never need to resolve to real instances.
  const candidates = Array.from({ length: maxClearanceNarrowPhasePairs }, () => [
    { instance: { fragmentId: 1, geometryIdentity: { loadEpoch: 1, geometryIndex: 0 } }, worldMatrix: [], worldBounds: {}, ownerDbId: 1 },
    { instance: { fragmentId: 2, geometryIdentity: { loadEpoch: 1, geometryIndex: 0 } }, worldMatrix: [], worldBounds: {}, ownerDbId: 2 },
    { model: {}, epoch: 1 },
  ]);
  // Unit-level: call the private preflight check function directly rather than driving a full
  // findClashes call through maxClearanceNarrowPhasePairs real candidates end-to-end.
  assert.doesNotThrow(() => world._checkClearanceNarrowPhaseBudget(candidates));
});

test('candidates.length one over the limit throws CapacityExceededError, never truncates', async () => {
  const world = new CollisionWorld();
  const candidates = Array.from({ length: maxClearanceNarrowPhasePairs + 1 }, () => [{}, {}, {}]);
  assert.throws(() => world._checkClearanceNarrowPhaseBudget(candidates), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'clearance-narrow-phase-budget');
    assert.equal(err.limit, maxClearanceNarrowPhasePairs);
    assert.equal(err.attempted, candidates.length);
    return true;
  });
});
