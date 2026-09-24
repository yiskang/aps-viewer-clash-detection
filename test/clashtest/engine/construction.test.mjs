// test/clashtest/engine/construction.test.mjs
//
// Task P7.2: `createClashTestEngine` port wiring, engine-limit validation, registry join and the
// dispose lifecycle. The engine's world must carry BOTH surfaces (`findClashes` and the lease
// surface P1's registry validates at construction), so every world here is `createExecutionWorld()`
// or `makeLeaseWorld()` -- never P0's bare `createFakeWorld()`, whose missing `admitModel` would make
// the registry constructor throw `invalid-world` and let a mismatch test pass for the wrong reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClashTestEngine, createEngineCore, ENGINE_METHODS,
} from '../../../clashtest/engine.js';
import {
  InvalidOptionsError, ModelBindingError, EngineDisposedError, StoreNotConfiguredError,
} from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS, resolveRunOptions } from '../../../clashtest/options.js';
import { createModelRegistry } from '../../../clashtest/identity/ModelRegistry.js';
import { COORDINATOR_SLOT, getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createExecutionWorld } from '../support/executionWorld.mjs';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';
import { createFakeEnumerator } from '../support/fakeEnumerator.mjs';
import { createEngineWorld, createHungResolver } from '../support/engineWorld.mjs';

const base = () => ({ world: createExecutionWorld(), enumerator: createFakeEnumerator() });

/** `assert.throws` returns undefined, so capture the error the predicate saw. */
function thrownBy(fn, ErrorClass) {
  let seen;
  assert.throws(fn, (err) => { seen = err; return err instanceof ErrorClass; });
  return seen;
}

const issueKeys = (err) => err.issues.map((i) => `${i.path}:${i.code}`).sort();

// ---- required ports and the registry join -----------------------------------------------------------

test('required ports are required', () => {
  assert.throws(() => createClashTestEngine({ enumerator: createFakeEnumerator() }), /world/);
  assert.throws(() => createClashTestEngine({ world: createExecutionWorld() }), /enumerator/);
  assert.throws(() => createClashTestEngine(null), /config/);
});

test('two engines over one world share one registry object', () => {
  const cfg = base();
  const a = createClashTestEngine(cfg);
  const b = createClashTestEngine({ ...cfg });
  assert.equal(a.registry, b.registry);
  assert.equal(a.registry.registrySessionId, b.registry.registrySessionId);
});

test('the engine never builds a registry of its own: engine.registry is the coordinator\'s', () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  assert.equal(engine.registry, getWorldCoordinator(cfg.world).registry);
});

test('a foreign registry (built for a DIFFERENT world) is a registry-mismatch ModelBindingError', () => {
  const cfg = base();
  createClashTestEngine(cfg);
  const foreign = createModelRegistry({ world: makeLeaseWorld() });
  const err = thrownBy(() => createClashTestEngine({ ...cfg, registry: foreign }), ModelBindingError);
  assert.equal(err.reason, 'registry-mismatch');       // N1: `.reason`, and the class takes ONE object argument
});

test('a SECOND registry for the SAME world is also a registry-mismatch (R-P7-6)', () => {
  // `assertRegistryBelongsToWorld` alone accepts it (duck type + world identity); the coordinator's
  // one-registry-per-world rule (§4.3) is what rejects it, so the engine checks that itself.
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const rival = createModelRegistry({ world: cfg.world });
  assert.notEqual(rival, engine.registry);
  const err = thrownBy(() => createClashTestEngine({ ...cfg, registry: rival }), ModelBindingError);
  assert.equal(err.reason, 'registry-mismatch');
});

test('a value that is not a registry at all is a registry-mismatch, not a TypeError', () => {
  const err = thrownBy(() => createClashTestEngine({ ...base(), registry: {} }), ModelBindingError);
  assert.equal(err.reason, 'registry-mismatch');
});

test('the coordinator-owned registry is accepted when the host passes it back', () => {
  const cfg = base();
  const first = createClashTestEngine(cfg);
  const second = createClashTestEngine({ ...cfg, registry: first.registry });
  assert.equal(second.registry, first.registry);
});

test('an incompatible coordinator protocol surfaces as coordinator-version-mismatch', () => {
  const cfg = base();
  getWorldCoordinator(cfg.world, { protocolVersion: 999 });
  const err = thrownBy(() => createClashTestEngine(cfg), ModelBindingError);
  assert.equal(err.reason, 'coordinator-version-mismatch');
});

// ---- engine limits -----------------------------------------------------------------------------------

test('engine limits are validated synchronously and every issue is collected', () => {
  const err = thrownBy(() => createClashTestEngine({
    ...base(),
    limits: { maxResidentResultSets: 0, persistTimeoutMs: 1.5, nope: 1 },
  }), InvalidOptionsError);
  // P0 issue paths are JSON pointers, not bare key names.
  assert.deepEqual(issueKeys(err), [
    '/maxResidentResultSets:below-minimum',
    '/nope:unknown-key',
    '/persistTimeoutMs:not-an-integer',
  ]);
});

test('a RunOption passed as an engine limit is an unknown key', () => {
  const err = thrownBy(() => createClashTestEngine({ ...base(), limits: { broadPhase: 'tlas' } }), InvalidOptionsError);
  assert.deepEqual(err.issues.map((i) => i.code), ['unknown-key']);
});

test('the maxQueuedRuns <= maxResidentResultSets - 1 rule is enforced at construction', () => {
  const err = thrownBy(() => createClashTestEngine({
    ...base(), limits: { maxResidentResultSets: 2, maxQueuedRuns: 2 },
  }), InvalidOptionsError);
  assert.deepEqual(issueKeys(err), ['/maxQueuedRuns:cross-field']);
});

test('a construction that fails on its limits leaves no coordinator behind', () => {
  const cfg = base();
  assert.throws(() => createClashTestEngine({ ...cfg, limits: { nope: 1 } }), InvalidOptionsError);
  assert.equal(globalThis[COORDINATOR_SLOT]?.has(cfg.world) ?? false, false);
});

test('omitted limits take the §17.1 defaults', () => {
  const engine = createClashTestEngine(base());
  assert.equal(engine.retentionReport().cap, ENGINE_LIMIT_DEFAULTS.maxResidentResultSets);
});

test('supplied limits are the ones every port is built with', () => {
  const { engine, internals } = createEngineCore({ ...base(), limits: { maxResidentResultSets: 2 } });
  assert.equal(engine.retentionReport().cap, 2);
  assert.equal(internals.effectiveLimits.maxResidentResultSets, 2);
  assert.equal(internals.effectiveLimits.maxQueuedRuns, 1, 'the derived default follows the supplied cap');
  assert.equal(internals.effectiveLimits.persistTimeoutMs, ENGINE_LIMIT_DEFAULTS.persistTimeoutMs);
  assert.ok(Object.isFrozen(internals.effectiveLimits));
});

// ---- host-supplied strings ---------------------------------------------------------------------------

test('hierarchyInternalAcceptance is null or {recordRef: string <= 512 code units}', () => {
  const ok = createEngineCore({ ...base(), hierarchyInternalAcceptance: { recordRef: 'r'.repeat(512) } });
  assert.equal(ok.internals.hierarchyInternalAcceptance.recordRef.length, 512);
  assert.equal(createEngineCore(base()).internals.hierarchyInternalAcceptance, null, 'default = UNACCEPTED');
  assert.equal(createEngineCore({ ...base(), hierarchyInternalAcceptance: null }).internals.hierarchyInternalAcceptance, null);

  for (const [label, value, expected] of [
    ['a non-object', 'x', ['/hierarchyInternalAcceptance:bad-shape']],
    ['an array', ['x'], ['/hierarchyInternalAcceptance:bad-shape']],
    ['a non-string recordRef', { recordRef: 7 }, ['/hierarchyInternalAcceptance/recordRef:bad-shape']],
    ['a missing recordRef', {}, ['/hierarchyInternalAcceptance/recordRef:bad-shape']],
    ['an empty recordRef', { recordRef: '' }, ['/hierarchyInternalAcceptance/recordRef:below-minimum']],
    ['a 513-unit recordRef', { recordRef: 'r'.repeat(513) }, ['/hierarchyInternalAcceptance/recordRef:above-ceiling']],
    ['an unknown key', { recordRef: 'r', extra: 1 }, ['/hierarchyInternalAcceptance/extra:unknown-key']],
  ]) {
    const err = thrownBy(() => createClashTestEngine({ ...base(), hierarchyInternalAcceptance: value }), InvalidOptionsError);
    assert.deepEqual(issueKeys(err), expected, label);
  }
});

test('the accepted acceptance record is a frozen detached copy (a host cannot mutate it later)', () => {
  const host = { recordRef: 'docs/acceptance/hierarchy-internal.md' };
  const { internals } = createEngineCore({ ...base(), hierarchyInternalAcceptance: host });
  host.recordRef = 'changed';
  assert.equal(internals.hierarchyInternalAcceptance.recordRef, 'docs/acceptance/hierarchy-internal.md');
  assert.ok(Object.isFrozen(internals.hierarchyInternalAcceptance));
});

test('libraryVersion is a string of at most 256 code units, or null', () => {
  assert.equal(createEngineCore(base()).internals.libraryVersion, null);
  assert.equal(createEngineCore({ ...base(), libraryVersion: 'v'.repeat(256) }).internals.libraryVersion.length, 256);
  for (const [label, value, expected] of [
    ['a number', 3, ['/libraryVersion:bad-shape']],
    ['an empty string', '', ['/libraryVersion:below-minimum']],
    ['257 code units', 'v'.repeat(257), ['/libraryVersion:above-ceiling']],
  ]) {
    const err = thrownBy(() => createClashTestEngine({ ...base(), libraryVersion: value }), InvalidOptionsError);
    assert.deepEqual(issueKeys(err), expected, label);
  }
});

test('every bad host string is reported in one pass', () => {
  const err = thrownBy(() => createClashTestEngine({
    ...base(), libraryVersion: 3, hierarchyInternalAcceptance: { recordRef: 7 },
  }), InvalidOptionsError);
  assert.deepEqual(issueKeys(err), [
    '/hierarchyInternalAcceptance/recordRef:bad-shape', '/libraryVersion:bad-shape',
  ]);
});

// ---- store, executor and seam wiring -----------------------------------------------------------------

test('undefined selects the in-memory reference stores; an explicit null means "no store"', () => {
  const defaults = createEngineCore(base()).internals.stores;
  assert.equal(typeof defaults.test.put, 'function');
  assert.equal(typeof defaults.result.put, 'function');

  const none = createEngineCore({ ...base(), testStore: null, resultStore: null }).internals;
  assert.equal(none.stores.test, null);
  assert.equal(none.stores.result, null);

  const mine = { test: createInMemoryClashTestStore(), result: createInMemoryResultStore() };
  const given = createEngineCore({ ...base(), testStore: mine.test, resultStore: mine.result }).internals;
  assert.equal(given.stores.test, mine.test);
  assert.equal(given.stores.result, mine.result);
});

test('a no-store engine reaches StoreNotConfiguredError through the definition operations', async () => {
  const { internals } = createEngineCore({ ...base(), testStore: null });
  await assert.rejects(() => internals.definitions.getTest('T'), (e) => e instanceof StoreNotConfiguredError
    && e.store === 'testStore');
});

test('an injected unitExecutor is used as-is; the default is the local executor function', () => {
  const custom = async () => ({});
  assert.equal(createEngineCore({ ...base(), unitExecutor: custom }).internals.executor, custom);
  assert.equal(typeof createEngineCore(base()).internals.executor, 'function');
  assert.throws(() => createClashTestEngine({ ...base(), unitExecutor: {} }), /unitExecutor/);
});

test('the test seams must be functions when supplied', () => {
  for (const seam of ['now', 'yieldToScheduler', 'scheduleTimeout', 'spanRecorder']) {
    assert.throws(() => createClashTestEngine({ ...base(), [seam]: 'nope' }), new RegExp(seam), seam);
  }
});

test('a residency slot is the engine\'s own: two engines over one world do not share slots', () => {
  const cfg = base();
  const a = createEngineCore(cfg);
  const b = createEngineCore(cfg);
  a.internals.residency.reserveRunSlot('r1');
  assert.equal(a.engine.retentionReport().slotsInUse, 1);
  assert.equal(b.engine.retentionReport().slotsInUse, 0, 'slot accounting is per engine (§7.3)');
});

// ---- the method surface ------------------------------------------------------------------------------

test('the engine exposes exactly the §18 surface this build ships (no annotate, no derivations)', () => {
  const engine = createClashTestEngine(base());
  const methods = [...ENGINE_METHODS.sync, ...ENGINE_METHODS.async];
  assert.deepEqual(Object.keys(engine).sort(), ['registry', 'dispose', ...methods].sort());
  assert.deepEqual(methods.sort(), [
    'archiveTest', 'assessNoClashClaim', 'canClaimNoClashes', 'deleteTest', 'discardRun', 'getFreshness',
    'getPersistenceState', 'getResultSet', 'getRun', 'getTest', 'invalidateModelPlacement', 'listResults',
    'listTests', 'releaseResultSet', 'rerun', 'retainResultSet', 'retentionReport', 'retryPersist',
    'saveTest', 'startRun', 'validateTest',
  ].sort());
  for (const excluded of ['annotate', 'derivations', 'compareResultSets']) {
    assert.equal(excluded in engine, false, excluded);
  }
  assert.ok(Object.isFrozen(engine));
});

test('retentionReport is the residency report plus the read-slot count', () => {
  const engine = createClashTestEngine(base());
  const report = engine.retentionReport();
  assert.deepEqual(report, {
    slotsInUse: 0, cap: ENGINE_LIMIT_DEFAULTS.maxResidentResultSets, active: [], sets: [], readSlotsInUse: 0,
  });
});

// ---- dispose -----------------------------------------------------------------------------------------

test('dispose is idempotent, returns the same promise, and closes the surface', async () => {
  const engine = createClashTestEngine(base());
  const p = engine.dispose();
  assert.equal(engine.dispose(), p);
  const summary = await p;
  assert.deepEqual(summary, { droppedUnsaved: [], persistenceInFlight: [] });
  assert.equal(await engine.dispose(), summary);
  assert.equal(engine.dispose(), p, 'still the same promise after it settled');
});

test('after dispose the synchronous methods THROW and the Promise-returning ones REJECT (R1)', async () => {
  const engine = createClashTestEngine(base());
  await engine.dispose();
  for (const name of ENGINE_METHODS.sync) {
    assert.throws(() => engine[name]({}), EngineDisposedError, `${name} after dispose`);
  }
  for (const name of ENGINE_METHODS.async) {
    let returned;
    assert.doesNotThrow(() => { returned = engine[name]({}); }, `${name} must not throw synchronously`);
    assert.ok(returned instanceof Promise, `${name} returns a Promise`);
    await assert.rejects(returned, EngineDisposedError, `${name} after dispose`);
  }
});

test('the surface closes at the SYNCHRONOUS start of dispose, before it settles', async () => {
  const engine = createClashTestEngine(base());
  const pending = engine.dispose();
  assert.throws(() => engine.retentionReport(), EngineDisposedError);
  await pending;
});

test('dispose stops admitting this engine\'s runs at the coordinator', async () => {
  const world = createEngineWorld();
  const { engine, internals } = createEngineCore(world.config());
  const pending = engine.dispose();
  assert.throws(
    () => internals.coordinator.enqueue({ runId: 'late', engineId: internals.engineId, run: async () => {} }),
    EngineDisposedError,
  );
  await pending;
});

test('dispose of one engine does not stop admission for another engine over the same world', async () => {
  const world = createEngineWorld();
  const a = createEngineCore(world.config());
  const b = createEngineCore(world.config());
  await a.engine.dispose();
  const ticket = b.internals.coordinator.enqueue({ runId: 'ok', engineId: b.internals.engineId, run: async () => {} });
  assert.equal(ticket.runId, 'ok');
  await ticket.finished;
  await b.engine.dispose();
});

test('dispose signals EVERY owned run before it waits, then hands back the unsaved sets', async () => {
  const world = createEngineWorld();
  const { engine, internals } = createEngineCore(world.config({ resultStore: null }));
  const resolver = createHungResolver();
  const options = resolveRunOptions(undefined, internals.effectiveLimits);
  const spec = () => ({ source: { kind: 'definition', value: world.definition() }, options, resolver });
  const first = internals.admitAndBegin(spec());        // takes the world's one in-flight slot
  const second = internals.admitAndBegin(spec());       // waits behind it in the coordinator queue
  assert.equal(internals.coordinator.queueDepth(internals.engineId), 1);
  assert.equal(internals.ownRuns.size, 2);

  // Spy on each run's engine-only controller (the frozen controller object cannot be patched, so the
  // map entry is replaced by a wrapper that records the call and delegates).
  const signalled = [];
  for (const [runId, { handle, controller }] of [...internals.ownRuns]) {
    internals.ownRuns.set(runId, {
      handle,
      controller: { requestDispose: () => { signalled.push(runId); return controller.requestDispose(); } },
    });
  }
  let settledBeforeReturn = 0;
  first.done.then(() => { settledBeforeReturn += 1; });
  second.done.then(() => { settledBeforeReturn += 1; });

  const pending = engine.dispose();
  // SIGNAL-THEN-WAIT, pinned: the instant dispose() returns, BEFORE any promise can have settled,
  // BOTH runs have already been signalled. A signal-and-await-each-in-turn variant signals only the
  // first here (its `done` cannot settle before the second is signalled, and vice versa).
  assert.deepEqual(signalled.sort(), [first.runId, second.runId].sort(), 'every owned run is signalled synchronously');
  assert.equal(settledBeforeReturn, 0);
  // And neither run can settle unless dispose asked both to stop, because the in-flight one is
  // parked on a lookup that never settles and the other is queued behind it.
  const [doneA, doneB] = await Promise.all([first.done, second.done]);
  assert.equal(doneA.status, 'cancelled');
  assert.equal(doneB.status, 'cancelled');
  for (const done of [doneA, doneB]) {
    assert.ok(done.resultSet.outcome.reasons.includes('engine-disposed'), 'the reason is recorded (§16.7)');
  }
  const summary = await pending;
  assert.deepEqual(summary.persistenceInFlight, []);
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId).sort(), [first.runId, second.runId].sort());
  for (const dropped of summary.droppedUnsaved) assert.equal(dropped.resultSet.sealed, true);
  assert.equal(internals.ownRuns.size, 0, 'the engine keeps no run after it is gone');
});
