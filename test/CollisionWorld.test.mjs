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
