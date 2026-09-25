// test/clashtest/support/leaseWorld.contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../../collision/index.js';
import { makeLeaseWorld } from './leaseWorld.mjs';

const IMPLS = [
  ['leaseWorld fake', () => makeLeaseWorld()],
  ['real CollisionWorld', () => new CollisionWorld()],
];
const throwsNamed = (name) => (e) => e?.name === name;

for (const [label, make] of IMPLS) {
  test(`${label}: admitModel is idempotent for a live model`, () => {
    const world = make();
    const m = { id: 1 };
    const l1 = world.admitModel(m);
    const l2 = world.admitModel(m);
    assert.equal(l1.model, m);
    assert.equal(l1.epoch, l2.epoch);
    assert.equal(world.isLeaseValid(l1), true);
    assert.notEqual(world.admitModel({ id: 2 }).epoch, l1.epoch);
  });

  test(`${label}: an evicted model can never be re-admitted and its lease dies`, () => {
    const world = make();
    const m = { id: 1 };
    const lease = world.admitModel(m);
    world.evictModel(m);
    world.evictModel(m); // idempotent, never throws
    assert.equal(world.isLeaseValid(lease), false);
    assert.throws(() => world.admitModel(m), throwsNamed('ModelEvictedError'));
  });

  test(`${label}: invalidateModelPlacement no-ops for a never-admitted model and throws for an evicted one`, () => {
    const world = make();
    assert.doesNotThrow(() => world.invalidateModelPlacement({ id: 9 }));
    const m = { id: 1 };
    world.admitModel(m);
    assert.doesNotThrow(() => world.invalidateModelPlacement(m));
    world.evictModel(m);
    assert.throws(() => world.invalidateModelPlacement(m), throwsNamed('ModelEvictedError'));
  });

  test(`${label}: once disposed, isLeaseValid is false, evictModel is a no-op, the others throw WorldDisposedError`, () => {
    const world = make();
    const m = { id: 1 };
    const lease = world.admitModel(m);
    world.dispose();
    assert.equal(world.isLeaseValid(lease), false);
    assert.doesNotThrow(() => world.evictModel(m));
    assert.throws(() => world.admitModel({ id: 2 }), throwsNamed('WorldDisposedError'));
    assert.throws(() => world.invalidateModelPlacement(m), throwsNamed('WorldDisposedError'));
  });
}

test('leaseWorld fake: call counters and re-entrancy hooks exist', () => {
  const world = makeLeaseWorld();
  const seen = [];
  world.hooks.beforeAdmitModel = (m) => seen.push(['admit', m.id]);
  world.hooks.beforeIsLeaseValid = (l) => seen.push(['valid', l.model.id]);
  const lease = world.admitModel({ id: 1 });
  world.isLeaseValid(lease);
  assert.deepEqual(seen, [['admit', 1], ['valid', 1]]);
  assert.deepEqual(world.calls, { admitModel: 1, isLeaseValid: 1, evictModel: 0, invalidateModelPlacement: 0 });
});
