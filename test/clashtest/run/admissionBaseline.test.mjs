// test/clashtest/run/admissionBaseline.test.mjs
//
// FIX-D1 (P6, owner-authorized cross-phase defect): the run's admission baseline (§13.2) called
// `world.getEpochCollisionInstanceCount(binding.lease)` with the LEASE OBJECT. The real signature is
// `CollisionWorld.getEpochCollisionInstanceCount(epoch)` -- an epoch NUMBER -- so against a real world
// the object made every baseline read 0. The doubles the earlier P6 tests use (`() => 1`) never
// looked at their argument, so nothing noticed. These tests use argument-STRICT worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { CollisionWorld } from '../../../collision/index.js';   // TEST-ONLY import; the engine core imports none of this
import { makeTwoModelFixture, box } from '../support/realWorldFixture.mjs';

const TWO_MODEL_PLAN = () => createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]);

test('the admission baseline reads each model\'s epoch NUMBER, never the lease object (FIX-D1)', async () => {
  const shared = createRunFixture.sharedWorld();
  const seen = [];
  shared.world.getEpochCollisionInstanceCount = (arg) => {
    seen.push(arg);
    // Strict: only a number is a legal epoch. A lease object (the defect) throws and seals the run
    // `failed:internal-error`, so the status assertion below fails loudly too.
    assert.equal(typeof arg, 'number', `getEpochCollisionInstanceCount(epoch) got ${typeof arg}, not a number`);
    return 1000 + arg * 7;                                 // distinct, non-zero, epoch-derived
  };
  const fx = createRunFixture({ shared, plan: TWO_MODEL_PLAN(), models: ['mk-a', 'mk-b'] });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;

  assert.equal(summary.status, 'completed');
  const leases = fx.registry.snapshotBindings(['mk-a', 'mk-b']).bindings.map((b) => b.lease);
  assert.deepEqual(seen, leases.map((l) => l.epoch), 'each bound lease\'s own epoch, in ascending model-key order');
  assert.equal(new Set(seen).size, 2, 'the two models hold DISTINCT epochs');
  assert.deepEqual(summary.resultSet.provenance.admissionBaseline, [
    { modelKey: 'mk-a', epochInstanceCount: 1000 + leases[0].epoch * 7 },
    { modelKey: 'mk-b', epochInstanceCount: 1000 + leases[1].epoch * 7 },
  ]);
});

test('against the REAL CollisionWorld the baseline is each model\'s real epoch instance count (FIX-D1)', async () => {
  const fixture = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [1] }],
    fragSpecsA: { 1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [2] }],
    fragSpecsB: { 2: { geometryIndex: 0, geometry: box(1, 1, 1), at: [5, 0, 0] } },
  });
  const world = await CollisionWorld.fromViewer(fixture.viewer, { now: () => 0 });
  const coordinator = getWorldCoordinator(world);           // the REAL world behind the REAL coordinator + ModelRegistry
  let nextRun = 0;
  const real = coordinator.registry;
  // The fixture only needs `has` beyond the real registry's surface; the run itself reads
  // `coordinator.registry`, which stays the untouched real ModelRegistry.
  const registry = {
    get registrySessionId() { return real.registrySessionId; },
    has: (key) => real.bindingFor(key) !== null,
    bindingFor: (key) => real.bindingFor(key),
  };
  const shared = { world, registry, coordinator, nextRunId: () => { nextRun += 1; return `run-${nextRun}`; } };
  real.register('mk-a', fixture.modelA, { modelVersion: 'v1' });
  real.register('mk-b', fixture.modelB, { modelVersion: 'v1' });

  // Populate the two models' epochs with DIFFERENT, non-zero instance counts, through the same
  // lease the registry will hand the run (admitModel is idempotent per model).
  const [bindingA, bindingB] = real.snapshotBindings(['mk-a', 'mk-b']).bindings;
  const prime = (lease, n) => world.admitCollisionInstances(lease, new Map(
    Array.from({ length: n }, (_, i) => [90_000_000 + i, { geometryIdentity: { loadEpoch: lease.epoch, geometryIndex: 0 } }])));
  prime(bindingA.lease, 3);
  prime(bindingB.lease, 5);
  assert.equal(world.getEpochCollisionInstanceCount(bindingA.lease.epoch), 3, 'test premise: real counts differ');
  assert.equal(world.getEpochCollisionInstanceCount(bindingB.lease.epoch), 5, 'test premise: real counts differ');

  const fx = createRunFixture({ shared, plan: TWO_MODEL_PLAN(), models: ['mk-a', 'mk-b'] });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;

  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.resultSet.provenance.admissionBaseline, [
    { modelKey: 'mk-a', epochInstanceCount: 3 },
    { modelKey: 'mk-b', epochInstanceCount: 5 },
  ]);
});
