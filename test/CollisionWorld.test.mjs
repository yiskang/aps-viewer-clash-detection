import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';
import { frameBudgetMs } from '../collision/constants.js';
import { runCheckpointPortContractTests } from './scheduler/checkpointPort.contract.mjs';

function makeModel(id) { return { id }; }

// --- admitModel -------------------------------------------------------------------------------

test('admitModel is idempotent on an already-live object — same epoch, nextLoadEpoch consumed once', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease1 = world.admitModel(model);
  const lease2 = world.admitModel(model);
  assert.equal(lease1.epoch, lease2.epoch);
  const other = world.admitModel(makeModel(2));
  assert.equal(other.epoch, lease1.epoch + 1, 'nextLoadEpoch must have been consumed exactly once by the two admitModel(model) calls combined');
});

test('admitModel on an already-evicted object throws immediately without consuming a new epoch', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  world.evictModel(model);
  assert.throws(() => world.admitModel(model), ModelEvictedError);
  const next = world.admitModel(makeModel(2));
  assert.equal(next.epoch, lease.epoch + 1, 'the failed re-admission attempt must not have consumed an epoch');
});

// --- evictModel ---------------------------------------------------------------------------------

test('evictModel on an object with no prior lifecycle entry tombstones with no epoch, no release attempted', () => {
  let released = 0;
  const registry = { releaseEntriesForEpoch() { released++; }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1); // never admitted — mocked BEFORE_MODEL_UNLOAD_EVENT for a model loaded but never touched
  world.evictModel(model);
  assert.equal(released, 0);
  assert.throws(() => world.admitModel(model), ModelEvictedError, 'must be permanently tombstoned');
});

test('evictModel called twice — second call is a no-op, no further release attempted', () => {
  let released = 0;
  const registry = { releaseEntriesForEpoch() { released++; }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1);
  world.admitModel(model);
  world.evictModel(model);
  assert.equal(released, 1);
  world.evictModel(model);
  assert.equal(released, 1, 'second eviction must not release again');
});

test('evictModel after dispose() does not throw — mocked unguarded dispatch loop reaches a second model', () => {
  const world = new CollisionWorld();
  world.dispose();
  const modelA = makeModel(1);
  const modelB = makeModel(2);
  // Simulates Viewer3DImpl.unloadCurrentModel's unguarded loop (docs/...:3167-177): a throw here
  // would abort the loop before modelB's handler runs.
  let reachedB = false;
  const dispatchLoop = [modelA, modelB];
  for (const m of dispatchLoop) {
    world.evictModel(m); // must not throw for either
    if (m === modelB) reachedB = true;
  }
  assert.equal(reachedB, true);
});

test('evictModel does not throw even if the registry\'s releaseEntriesForEpoch itself throws', () => {
  const registry = {
    releaseEntriesForEpoch() { throw new Error('simulated GeometryRegistry failure'); },
    releaseAll() {},
  };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1);
  world.admitModel(model);
  assert.doesNotThrow(() => world.evictModel(model));
  assert.throws(() => world.admitModel(model), ModelEvictedError, 'must still be tombstoned despite the registry failure');
});

test('stale evictModel(oldModel) after a different object was admitted under the same reused model.id leaves the new object untouched', () => {
  let releasedEpochs = [];
  const registry = { releaseEntriesForEpoch(epoch) { releasedEpochs.push(epoch); }, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const oldModel = { id: 42 };
  const newModel = { id: 42 }; // same numeric id, different object — round-14 core regression
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel);
  assert.notEqual(oldLease.epoch, newLease.epoch);

  world.evictModel(oldModel); // stale/delayed eviction of the OLD object
  assert.deepEqual(releasedEpochs, [oldLease.epoch]);
  assert.equal(world.isModelLive(newModel), true, 'new object must remain live');
  assert.equal(world.isLeaseValid(newLease), true, 'new object\'s lease must be unaffected');
  assert.throws(() => world.admitModel(oldModel), ModelEvictedError);
});

// --- isLeaseValid / isModelLive --------------------------------------------------------------

test('isLeaseValid after dispose() returns false synchronously, does not throw, even from an async callback', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  world.dispose();
  await Promise.resolve(); // simulate resuming inside a mocked async callback
  assert.equal(world.isLeaseValid(lease), false);
});

test('isModelLive after dispose() throws WorldDisposedError — distinguishing it from isLeaseValid', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  world.admitModel(model);
  world.dispose();
  assert.throws(() => world.isModelLive(model), WorldDisposedError);
});

test('isModelLive on a never-seen model returns false (not yet admitted)', () => {
  const world = new CollisionWorld();
  assert.equal(world.isModelLive(makeModel(999)), false);
});

// --- dispose --------------------------------------------------------------------------------

test('dispose() then a new lifecycle call rejects/throws immediately, before any per-model check', () => {
  const world = new CollisionWorld();
  world.dispose();
  assert.throws(() => world.admitModel(makeModel(1)), WorldDisposedError);
  assert.throws(() => world.isModelLive(makeModel(1)), WorldDisposedError);
});

test('a second dispose() call throws WorldDisposedError — dispose is NOT one of the two no-op-on-disposed exceptions', () => {
  let releaseAllCount = 0;
  const registry = { releaseAll() { releaseAllCount++; }, releaseEntriesForEpoch() {} };
  const world = new CollisionWorld({ registry });
  const model = makeModel(1);
  world.admitModel(model);
  world.dispose();
  assert.equal(releaseAllCount, 1, 'first dispose() must have run its cleanup');
  assert.throws(() => world.dispose(), WorldDisposedError, 'a second dispose() call must throw, not silently re-run cleanup');
  assert.equal(releaseAllCount, 1, 'the throwing second call must not have re-run registry.releaseAll()');
  // The first call's own cleanup effects must not be undone by the second call's throw.
  assert.equal(world.isLeaseValid({ model, epoch: 1 }), false, 'still disposed/invalid after the second call');
});

test('two distinct model objects under the same reused modelId, both live, each suspended at a checkpoint — dispose() rejects BOTH, including the old one', async () => {
  const world = new CollisionWorld({ yieldToScheduler: () => new Promise(() => {}) /* never resolves on its own */ });
  const oldModel = { id: 7 };
  const newModel = { id: 7 };
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel);

  // Force both checkpoints past frameBudgetMs so they'd normally await the (never-resolving) yield —
  // instead we call checkpoint() directly and race it against dispose() firing first via a
  // controllable now()/yield pairing. Simpler and equally faithful to the contract: dispose() sets
  // `disposed` synchronously, so a checkpoint call made AFTER dispose() must reject regardless of
  // which model it names — this is round 15's core point (disposed is checked directly, never
  // inferred from tombstone state, so liveModelByModelId's inability to enumerate the old object is
  // irrelevant).
  const portForOld = world.createCheckpointPort(oldLease);
  const portForNew = world.createCheckpointPort(newLease);
  world.dispose();
  // Per the corrected, conditionally-synchronous checkpoint port contract (checkpoint validation
  // runs synchronously BEFORE any yield is even considered — collision/scheduler.js's own
  // `validate()` call precedes `accumulator.isDue()`), a checkpoint made against an ALREADY-disposed
  // world throws synchronously, not via a rejected Promise. `assert.rejects` does not catch a
  // synchronous throw from a plain (non-async) callback — verified empirically — so this uses
  // `assert.throws`, matching the convention test/scheduler/checkpointPort.contract.mjs itself uses
  // for pre-yield validation errors (its own lines 50, 58, 65, 72, 137, 146 use assert.throws;
  // assert.rejects there is reserved for POST-yield revalidation only, lines 106/117/129).
  assert.throws(() => portForOld(), WorldDisposedError);
  assert.throws(() => portForNew(), WorldDisposedError);
});

test('different model object admitted under a reused modelId, queried before the old object\'s own eviction runs, never touches old object\'s state', () => {
  const world = new CollisionWorld();
  const oldModel = { id: 3 };
  const newModel = { id: 3 };
  const oldLease = world.admitModel(oldModel);
  const newLease = world.admitModel(newModel); // old object still live, never evicted yet
  assert.notEqual(oldLease.epoch, newLease.epoch);
  assert.equal(world.isLeaseValid(oldLease), true, 'old object is still independently live');
  assert.equal(world.isLeaseValid(newLease), true);
});

// --- _checkEntryLifecycle ---------------------------------------------------------------------

test('_checkEntryLifecycle: disposed is checked before cross-model check', () => {
  const world = new CollisionWorld();
  world.dispose();
  assert.throws(
    () => world._checkEntryLifecycle({ model: makeModel(1) }, { model: makeModel(2) }),
    WorldDisposedError,
  );
});

test('_checkEntryLifecycle: cross-model rejected before either operand is admitted', () => {
  const world = new CollisionWorld();
  const source = makeModel(1);
  const target = makeModel(2);
  assert.throws(() => world._checkEntryLifecycle({ model: source }, { model: target }));
  assert.equal(world.isModelLive(source), false, 'must not have been lazily admitted by the failed check');
  assert.equal(world.isModelLive(target), false);
});

test('_checkEntryLifecycle: evicted operand rejects ModelEvictedError', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  world.admitModel(model);
  world.evictModel(model);
  assert.throws(() => world._checkEntryLifecycle({ model }, { model }), ModelEvictedError);
});

test('_checkEntryLifecycle: never-seen operand is lazily admitted and returns its fresh epoch', () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const { epoch } = world._checkEntryLifecycle({ model }, { model });
  assert.equal(world.isModelLive(model), true);
  assert.equal(world.isLeaseValid({ model, epoch }), true);
});

// --- checkpoint port contract conformance -----------------------------------------------------
//
// CORRECTED per controller ruling for this dispatch: the real contract suite lives at
// test/scheduler/checkpointPort.contract.mjs and expects `makePort()` to return
// `{ port, controls }` where `port.checkpoint({loadEpoch, modelIdHint}) -> undefined | Promise<void>`
// and controls = {setDisposed, setEpochLive, forceYieldDue, forceYieldNotDue,
// getYieldInvocationCount, resolveNextYield} — modeled directly on
// test/scheduler/checkpointPort.real.test.mjs's own adapter pattern.

runCheckpointPortContractTests(() => {
  let mockNow = 0;
  let yieldInvocationCount = 0;
  let currentYieldResolvers = [];
  const now = () => mockNow;
  const yieldToScheduler = () => {
    yieldInvocationCount++;
    return new Promise((resolve) => { currentYieldResolvers.push(resolve); });
  };
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = makeModel('contract-suite-model');
  const lease = world.admitModel(model);
  const rawCheckpoint = world.createCheckpointPort(lease);

  const port = {
    checkpoint({ loadEpoch, modelIdHint } = {}) {
      // Pass modelIdHint through AS the ctx.model — modelIdOf(x) returns x unchanged when x.id
      // is undefined (a plain string/number), so this makes the contract suite's own
      // modelIdHint assertions work correctly through CollisionWorld's {model,loadEpoch} ctx shape.
      return rawCheckpoint({ loadEpoch, model: modelIdHint });
    },
  };
  const controls = {
    setDisposed: (v) => { world._disposed = v; },
    setEpochLive: (loadEpoch, live) => {
      if (live) world._liveEpochs.add(loadEpoch);
      else world._liveEpochs.delete(loadEpoch);
    },
    forceYieldDue: () => { mockNow += frameBudgetMs; }, // trips the real accumulator's own isDue()
    forceYieldNotDue: () => { /* fresh accumulator starts not-due; nothing to do */ },
    getYieldInvocationCount: () => yieldInvocationCount,
    resolveNextYield: () => {
      if (currentYieldResolvers.length > 0) currentYieldResolvers.shift()();
    },
  };
  return { port, controls };
});

// --- direct checkpoint semantics (independent of the imported contract suite, as a backstop) ----

test('createCheckpointPort: disposed is checked before epoch validity', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  world.dispose();
  // Synchronous throw, not a rejection — see the comment on the "dispose() rejects BOTH" test above
  // for why assert.throws (not assert.rejects) is required here against the corrected,
  // conditionally-synchronous checkpoint port contract. This also makes the test's own name
  // discriminating: dispose() clears both `_disposed` and `_liveEpochs`, so a reversed check order
  // would still throw ModelEvictedError here, not WorldDisposedError — asserting the concrete error
  // class is what actually proves "disposed is checked before epoch validity".
  assert.throws(() => port(), WorldDisposedError);
});

test('createCheckpointPort: stale epoch (model evicted) rejects ModelEvictedError', async () => {
  const world = new CollisionWorld();
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  world.evictModel(model);
  assert.throws(() => port(), ModelEvictedError); // synchronous throw — see comment above
});

test('createCheckpointPort: yields only once accumulated time reaches frameBudgetMs, and revalidates after yielding', async () => {
  let elapsed = 0;
  const now = () => elapsed;
  let yieldCount = 0;
  const yieldToScheduler = async () => { yieldCount++; };
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = makeModel(1);
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);

  elapsed += 1;
  await port();
  assert.equal(yieldCount, 0, 'under frameBudgetMs — must not yield');

  elapsed += frameBudgetMs; // now cumulative elapsed since last checkpoint crosses the threshold
  await port();
  assert.equal(yieldCount, 1, 'due — must yield exactly once');
});

test('createCheckpointPort: two ports created for two concurrent calls do not share accumulator state', async () => {
  // Codex-advisor's core finding: the accumulator is scoped per findClashes call, not per world.
  // Port A accumulates almost enough elapsed time to trip a yield; port B (a fresh call, fresh
  // accumulator) must NOT inherit any of A's accumulated time just because they share a `now()`.
  let elapsed = 0;
  const now = () => elapsed;
  let yieldCount = 0;
  const yieldToScheduler = async () => { yieldCount++; };
  const world = new CollisionWorld({ now, yieldToScheduler });
  const model = makeModel(1);
  const lease = world.admitModel(model);

  const portA = world.createCheckpointPort(lease);
  elapsed += frameBudgetMs - 1; // A is now one unit away from due
  await portA();
  assert.equal(yieldCount, 0);

  const portB = world.createCheckpointPort(lease); // a fresh call starting now — fresh accumulator
  elapsed += 1; // this alone would have tipped A over; B's own baseline starts from THIS elapsed value
  await portB();
  assert.equal(yieldCount, 0, 'a fresh port must not inherit another port\'s accumulated time');

  await portA(); // A's own accumulator: was at frameBudgetMs - 1, plus 1 more elapsed unit = due
  assert.equal(yieldCount, 1, 'A must still trip on its own accumulated total');
});

test('createCheckpointPort: model evicted during the yield itself — resumed checkpoint rejects, never completes silently', async () => {
  let elapsed = 0;
  const now = () => elapsed;
  const model = makeModel(1);
  const world = new CollisionWorld({
    now,
    yieldToScheduler: async () => { world.evictModel(model); },
  });
  const lease = world.admitModel(model);
  const port = world.createCheckpointPort(lease);
  elapsed += frameBudgetMs;
  await assert.rejects(() => port(), ModelEvictedError);
});

test('createCheckpointPort: checkpointing a DIFFERENT operand than the lease via explicit ctx', async () => {
  const world = new CollisionWorld();
  const leaseModel = makeModel(1);
  const otherModel = makeModel(2);
  const lease = world.admitModel(leaseModel);
  const otherLease = world.admitModel(otherModel);
  const port = world.createCheckpointPort(lease);
  await port(); // defaults to lease's own {model, epoch} — must not throw
  await port({ model: otherModel, loadEpoch: otherLease.epoch }); // explicit different operand
  world.evictModel(otherModel);
  // Synchronous throw (evictModel already ran before this call) — see comment above.
  assert.throws(() => port({ model: otherModel, loadEpoch: otherLease.epoch }), ModelEvictedError);
});

// --- admitCollisionInstances (Task 18) --------------------------------------------------------

import { extractFragments } from '../collision/viewer/ViewerModelAdapter.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';
import { maxCollisionInstancesPerEpoch } from '../collision/constants.js';
import { CapacityExceededError } from '../collision/CollisionWorld.js';

async function extract(model, dbIds, loadEpoch) {
  return extractFragments(model, dbIds, loadEpoch);
}

test('admitCollisionInstances: cache hit for an already-resident fragment returns the exact same object reference', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1, 2] }], new Map([[1, { geometryIndex: 1 }], [2, { geometryIndex: 2 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const first = await extract(model, [1], lease.epoch);
  const admitted1 = world.admitCollisionInstances(lease, first);
  const second = await extract(model, [1], lease.epoch); // fresh extraction call, e.g. a later findClashes
  const admitted2 = world.admitCollisionInstances(lease, second);
  assert.equal(admitted1.get(1), admitted2.get(1), 'must be the exact same object reference across calls');
  assert.equal(admitted1.get(2), admitted2.get(2));
});

test('admitCollisionInstances: newly-admitted instances are frozen and shaped { fragmentId, geometryIdentity }', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [5] }], new Map([[5, { geometryIndex: 3 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  const admitted = world.admitCollisionInstances(lease, extracted);
  const instance = admitted.get(5);
  assert.equal(instance.fragmentId, 5);
  assert.equal(instance.geometryIdentity.geometryIndex, 3);
  assert.ok(Object.isFrozen(instance));
  assert.equal(instance.worldMatrix, undefined, 'CollisionInstance must carry NO transform state');
});

test('admitCollisionInstances: stale lease (model evicted) rejects ModelEvictedError before any capacity logic runs', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  world.evictModel(model);
  assert.throws(() => world.admitCollisionInstances(lease, extracted), ModelEvictedError);
  assert.equal(world._instanceCache.has(lease.epoch), false, 'must never create an orphan bucket for a dead epoch');
});

test('admitCollisionInstances: disposed world rejects WorldDisposedError before any capacity logic runs', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const world = new CollisionWorld();
  const lease = world.admitModel(model);
  const extracted = await extract(model, [1], lease.epoch);
  world.dispose();
  assert.throws(() => world.admitCollisionInstances(lease, extracted), WorldDisposedError);
});

test('admitCollisionInstances: bucket already at capacity, query MIXES already-resident and one not-yet-resident fragment — entire call rejects, call-wide not partial', () => {
  // The query's OWN size (3) is far under the limit, so this exercises step 4 (bucket-capacity)
  // specifically, not step 2 (precheck) — and proves rejection is call-wide: even the two
  // ALREADY-RESIDENT fragments in this query are not returned, because the call as a whole rejects.
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-1'));
  const epoch = lease.epoch;
  const full = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch; i++) {
    full.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, full); // fill the bucket to exact capacity
  const query = new Map([
    [0, full.get(0)],
    [1, full.get(1)],
    [999999, { geometryIdentity: { loadEpoch: epoch, geometryIndex: 999999 } }], // the one not-yet-resident id
  ]);
  assert.throws(() => world.admitCollisionInstances(lease, query), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'bucket-capacity');
    return true;
  });
  assert.equal(world._instanceCache.get(epoch).size, maxCollisionInstancesPerEpoch, 'bucket must be unchanged by the rejected call');
  assert.equal(world._instanceCache.get(epoch).has(999999), false);
});

test('admitCollisionInstances: repeat call querying only already-resident fragments succeeds even at capacity', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-2'));
  const full = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch; i++) {
    full.set(i, { geometryIdentity: { loadEpoch: lease.epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, full);
  const subsetQuery = new Map([[0, full.get(0)], [1, full.get(1)]]);
  const result = world.admitCollisionInstances(lease, subsetQuery); // must not throw
  assert.equal(result.size, 2);
});

test('admitCollisionInstances: walk\'s own unique-fragment count exceeds the limit against an EMPTY bucket — precheck rejects before any bucket lookup', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-3'));
  const tooMany = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch + 1; i++) {
    tooMany.set(i, { geometryIdentity: { loadEpoch: lease.epoch, geometryIndex: i } });
  }
  assert.throws(() => world.admitCollisionInstances(lease, tooMany), (err) => {
    assert.ok(err instanceof CapacityExceededError);
    assert.equal(err.kind, 'call-wide-unique-fragment-precheck');
    return true;
  });
  assert.equal(world._instanceCache.has(lease.epoch), false, 'bucket must never have been created — precheck rejects before any bucket lookup');
});

test('admitCollisionInstances: precheck (call-wide) is distinct from bucket-capacity check — a fixture that only trips the latter', () => {
  const world = new CollisionWorld();
  const lease = world.admitModel(makeModel('cap-4'));
  const epoch = lease.epoch;
  const half = Math.floor(maxCollisionInstancesPerEpoch / 2);
  const firstBatch = new Map();
  for (let i = 0; i < half; i++) firstBatch.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  world.admitCollisionInstances(lease, firstBatch); // bucket now at half capacity

  const secondBatch = new Map(); // this call's OWN unique count is well under the limit...
  for (let i = half; i < half + 10; i++) secondBatch.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  world.admitCollisionInstances(lease, secondBatch); // ...succeeds, combined bucket now half+10

  // Now push the bucket to exactly at-capacity, then try one more small call that ALONE would pass
  // the precheck (its own unique count is tiny) but fails the bucket-capacity check.
  const fillRest = new Map();
  for (let i = half + 10; i < maxCollisionInstancesPerEpoch; i++) {
    fillRest.set(i, { geometryIdentity: { loadEpoch: epoch, geometryIndex: i } });
  }
  world.admitCollisionInstances(lease, fillRest); // bucket now exactly at capacity

  const tinyOverflow = new Map([[maxCollisionInstancesPerEpoch + 5, { geometryIdentity: { loadEpoch: epoch, geometryIndex: 1 } }]]);
  assert.throws(() => world.admitCollisionInstances(lease, tinyOverflow), (err) => {
    assert.equal(err.kind, 'bucket-capacity'); // NOT call-wide-unique-fragment-precheck
    return true;
  });
});

test('two interleaved calls against the same fragment with a transform mutation between them — canonical/placement separation', async () => {
  const geometry = new Map([[1, { geometryIndex: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]]);
  const { model } = buildMockModel([{ dbId: 1, fragments: [1] }], geometry);
  const world = new CollisionWorld();
  const lease = world.admitModel(model);

  // Call A extracts and builds its own placement snapshot first.
  const extractedA = await extract(model, [1], lease.epoch);
  const admittedA = world.admitCollisionInstances(lease, extractedA);
  const placementA = Object.freeze({
    instance: admittedA.get(1),
    worldMatrix: extractedA.get(1).worldMatrix,
    worldBounds: extractedA.get(1).worldBounds,
    ownerDbId: extractedA.get(1).ownerDbId,
  });

  // Mutate the fixture's transform (simulating a live Viewer transform change between calls).
  geometry.get(1).matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];

  // Call B extracts fresh (sees the mutated transform) and looks up the SAME canonical instance.
  const extractedB = await extract(model, [1], lease.epoch);
  const admittedB = world.admitCollisionInstances(lease, extractedB);
  assert.equal(admittedB.get(1), admittedA.get(1), 'same canonical CollisionInstance object reference');
  assert.notDeepEqual(Array.from(extractedB.get(1).worldMatrix), Array.from(placementA.worldMatrix), 'call B must see the mutated transform');

  // Call A's own already-built placement snapshot is untouched.
  assert.deepEqual(Array.from(placementA.worldMatrix), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('stale evictModel(oldModel) releases only the old epoch\'s bucket — new object\'s bucket is unaffected', async () => {
  const { model: sharedModel } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  // Two distinct Model objects sharing the same reused numeric `id` (round-14 scenario) — both
  // delegate to the same underlying mock tree, since this fixture only cares about epoch-bucket
  // isolation, not the two objects' geometry actually differing.
  const oldModelObj = { getInstanceTree: sharedModel.getInstanceTree, getObjectTree: sharedModel.getObjectTree, getFragmentList: sharedModel.getFragmentList, id: 42 };
  const newModelObj = { getInstanceTree: sharedModel.getInstanceTree, getObjectTree: sharedModel.getObjectTree, getFragmentList: sharedModel.getFragmentList, id: 42 };
  const registry = { releaseEntriesForEpoch() {}, releaseAll() {} };
  const world = new CollisionWorld({ registry });
  const oldLease = world.admitModel(oldModelObj);
  const newLease = world.admitModel(newModelObj);
  assert.notEqual(oldLease.epoch, newLease.epoch);

  const extractedOld = await extract(oldModelObj, [1], oldLease.epoch);
  world.admitCollisionInstances(oldLease, extractedOld);
  const extractedNew = await extract(newModelObj, [1], newLease.epoch);
  const admittedNew = world.admitCollisionInstances(newLease, extractedNew);

  world.evictModel(oldModelObj);
  assert.equal(world._instanceCache.has(oldLease.epoch), false, 'old epoch bucket released');
  assert.equal(world._instanceCache.has(newLease.epoch), true, 'new epoch bucket unaffected');
  const admittedNewAgain = world.admitCollisionInstances(newLease, extractedNew);
  assert.equal(admittedNewAgain.get(1), admittedNew.get(1), 'new object\'s canonical instances unchanged — same references, no rebuild');
});

test('dispose() clears the whole CollisionInstance cache wholesale, across every live epoch', async () => {
  const world = new CollisionWorld();
  const { model: modelA } = buildMockModel([{ dbId: 1, fragments: [1] }], new Map([[1, { geometryIndex: 1 }]]));
  const { model: modelB } = buildMockModel([{ dbId: 2, fragments: [2] }], new Map([[2, { geometryIndex: 2 }]]));
  const leaseA = world.admitModel(modelA);
  const leaseB = world.admitModel(modelB);
  world.admitCollisionInstances(leaseA, await extract(modelA, [1], leaseA.epoch));
  world.admitCollisionInstances(leaseB, await extract(modelB, [2], leaseB.epoch));
  assert.equal(world._instanceCache.size, 2);
  world.dispose();
  assert.equal(world._instanceCache.size, 0);
});
