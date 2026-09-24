// test/clashtest/engine/deleteTest.tombstone.test.mjs
//
// Task P7.3: `engine.deleteTest` -- the two-layer, fail-closed delete of spec §5.5 -- and the engine-level
// NH3 bypass matrix for every path reachable WITHOUT `startRun`'s resolver:
//   (i) `resultStore.tombstoneTest(testId)` FIRST (if a result store is configured), (ii) THEN
//   `testStore.delete(testId)` (if a test store is configured); both idempotent; (i) done + (ii) failed
//   => the promise rejects, the reservation STAYS, a retry completes; the reverse order is never used;
//   `StoreNotConfiguredError` only when NEITHER store is configured.
//
// The run-resolution arms below were DEFERRED from P7.3 to P7.4 (ruling R-P7-14) and are now covered at
// the end of this file (Task P7.4, R-P7-15):
//   - a persisting direct-definition run after `deleteTest` seals `failed` / `test-unavailable`, no
//     `findClashes` call, `definition: null`, `testRef.semanticDigest: null` (§5.5 layer 2);
//   - the same run with `persist: false` completes and skips the check;
//   - a REJECTING `testStore.isTombstoned` seals `failed` / `test-unavailable` (fail closed);
//   - a stored-reference run against a deleted / archived / missing test;
//   - a persisting run admitted BEFORE the delete and finishing after it (persistence ends `failed`,
//     `error.name === 'TestDeletedError'`, run outcome unchanged, set `held`).
// (`rerun` from an embedded definition is P7.7's; `retryPersist` of a failed set is P7.5's.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import {
  StoreNotConfiguredError, TestDeletedError, InvalidTestDefinitionError, EngineDisposedError,
} from '../../../clashtest/errors.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import { withRunId } from '../support/resultSetFixtures.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';

// `withRunId` builds its sets for this test id (the shared P5 fixture's own).
const TEST_ID = 'T1';
const base = (extra = {}) => createEngineWorld().config(extra);
const validDef = (over = {}) => makeDefinition(over);

/** Wraps every function of a store so each call is recorded as `<label>.<method>` (in call order). */
function wrapStore(store, label, order) {
  const out = {};
  for (const [key, value] of Object.entries(store)) {
    out[key] = typeof value === 'function'
      ? (...args) => { order.push(`${label}.${key}`); return value(...args); }
      : value;
  }
  return out;
}

test('deleteTest tombstones the result store BEFORE deleting from the test store', async () => {
  const order = [];
  const resultStore = wrapStore(createInMemoryResultStore(), 'resultStore', order);
  const testStore = wrapStore(createInMemoryClashTestStore(), 'testStore', order);
  const engine = createClashTestEngine(base({ testStore, resultStore }));
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  order.length = 0;
  assert.equal(await engine.deleteTest('T'), undefined);
  assert.deepEqual(order, ['resultStore.tombstoneTest', 'testStore.delete']);
});

test('layer 2 does not start until layer 1 has SETTLED (a slow tombstone is awaited, not raced)', async () => {
  const order = [];
  let releaseTombstone;
  const slow = createInMemoryResultStore();
  const resultStore = {
    ...slow,
    tombstoneTest: (id) => new Promise((resolve) => {
      order.push('tombstone:start');
      releaseTombstone = () => { slow.tombstoneTest(id).then(() => { order.push('tombstone:done'); resolve(); }); };
    }),
  };
  const testStore = createInMemoryClashTestStore();
  const guarded = { ...testStore, delete: async (id) => { order.push('delete'); return testStore.delete(id); } };
  const engine = createClashTestEngine(base({ testStore: guarded, resultStore }));
  const pending = engine.deleteTest('T');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['tombstone:start']);                        // the delete is NOT issued yet
  releaseTombstone();
  await pending;
  assert.deepEqual(order, ['tombstone:start', 'tombstone:done', 'delete']);
});

test('a failing testStore.delete leaves the reservation in place and a retry completes', async () => {
  const resultStore = createInMemoryResultStore();
  const testStore = createInMemoryClashTestStore();
  let fail = true;
  const guarded = { ...testStore, delete: async (id) => {
    if (fail) throw new Error('backend down');
    return testStore.delete(id);
  } };
  const engine = createClashTestEngine(base({ testStore: guarded, resultStore }));
  await engine.saveTest(validDef({ testId: TEST_ID, revision: 1 }));
  await assert.rejects(() => engine.deleteTest(TEST_ID), /backend down/);
  // layer 1 already holds: a NEW set for the test can never be inserted.
  await assert.rejects(async () => resultStore.put(await withRunId('run-new')), TestDeletedError);
  assert.equal(await resultStore.isTombstoned(TEST_ID), true);
  assert.notEqual(await guarded.get(TEST_ID), null);                   // the definition body is still there
  fail = false;
  await engine.deleteTest(TEST_ID);                                     // the retry completes
  assert.equal(await guarded.get(TEST_ID), null);
  assert.equal(await testStore.isTombstoned(TEST_ID), true);
});

test('a failing resultStore.tombstoneTest stops the delete BEFORE layer 2 (the reverse order is never used)', async () => {
  const testStore = createInMemoryClashTestStore();
  const results = createInMemoryResultStore();
  let fail = true;
  const resultStore = { ...results, tombstoneTest: async (id) => {
    if (fail) throw new Error('tombstone unavailable');
    return results.tombstoneTest(id);
  } };
  const engine = createClashTestEngine(base({ testStore, resultStore }));
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await assert.rejects(() => engine.deleteTest('T'), /tombstone unavailable/);
  assert.notEqual(await engine.getTest('T'), null);                    // still live
  assert.equal(await testStore.isTombstoned('T'), false);              // layer 2 never ran
  fail = false;
  await engine.deleteTest('T');
  assert.equal(await engine.getTest('T'), null);
});

test('deleteTest is idempotent, also for a testId no store has seen', async () => {
  const testStore = createInMemoryClashTestStore();
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine(base({ testStore, resultStore }));
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await engine.deleteTest('T');
  await engine.deleteTest('T');
  await engine.deleteTest('never-saved');
  assert.equal(await testStore.isTombstoned('never-saved'), true);      // an unseen id is reserved too
  assert.equal(await resultStore.isTombstoned('never-saved'), true);
});

test('after deleteTest: reads as not found, unlisted, never re-creatable -- not even at revision 1', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await engine.saveTest(validDef({ testId: 'keep', revision: 1 }));
  await engine.deleteTest('T');
  assert.equal(await engine.getTest('T'), null);
  assert.deepEqual((await engine.listTests({})).summaries.map((s) => s.testId), ['keep']);
  await assert.rejects(() => engine.saveTest(validDef({ testId: 'T', revision: 1 })), TestDeletedError);
  await assert.rejects(() => engine.saveTest(validDef({ testId: 'T', revision: 2 })), TestDeletedError);
  assert.equal(await engine.getTest('T'), null);                        // the refused save changed nothing
  await engine.archiveTest('T');                                        // archive of a tombstoned id is a harmless no-op
  assert.equal(await engine.getTest('T'), null);
});

// ---- NH3 bypass matrix: the durable layer (§5.5 layer 1) on every path the engine can reach without a run ----

test('layer 1 (NH3): after deleteTest a host that PUTs a set for the test straight into the ResultStore is refused; older sets stay', async () => {
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine(base({ resultStore }));
  const before = await withRunId('run-before');
  await resultStore.put(before);
  await engine.deleteTest(TEST_ID);
  await assert.rejects(async () => resultStore.put(await withRunId('run-after')), TestDeletedError);   // a NEW insertion
  assert.equal(await resultStore.get('run-after'), null);                                               // nothing inserted
  await resultStore.put(structuredClone(before));                        // identical re-put is still idempotent
  assert.ok(await resultStore.get('run-before'));                         // sets stored before the tombstone stay readable
  assert.deepEqual((await engine.listResults({ testId: TEST_ID })).summaries.map((s) => s.runId), ['run-before']);
  await resultStore.delete('run-before');                                 // ...and deletable by runId
  assert.equal(await resultStore.isTombstoned(TEST_ID), true);            // the reservation survives every retention op
});

test('the reservation is per store: deleteTest tombstones ONLY the stores this engine holds', async () => {
  const mine = createInMemoryResultStore();
  const other = createInMemoryResultStore();                             // an independent ResultStore (residual, §5.5)
  const engine = createClashTestEngine(base({ resultStore: mine }));
  await engine.deleteTest(TEST_ID);
  assert.equal(await mine.isTombstoned(TEST_ID), true);
  assert.equal(await other.isTombstoned(TEST_ID), false);
});

// ---- missing stores: each configured step is performed, only "neither" is an error --------------------

test('with only a resultStore configured, deleteTest completes layer 1 and does not reject', async () => {
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine(base({ testStore: null, resultStore }));
  await engine.deleteTest('T');
  assert.equal(await resultStore.isTombstoned('T'), true);
});

test('with only a testStore configured, deleteTest completes layer 2 and does not reject', async () => {
  const testStore = createInMemoryClashTestStore();
  const engine = createClashTestEngine(base({ testStore, resultStore: null }));
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await engine.deleteTest('T');
  assert.equal(await engine.getTest('T'), null);
  assert.equal(await testStore.isTombstoned('T'), true);
});

test('with NEITHER store configured, deleteTest rejects StoreNotConfiguredError{store:"testStore"}', async () => {
  const engine = createClashTestEngine(base({ testStore: null, resultStore: null }));
  await assert.rejects(() => engine.deleteTest('T'), (e) => e instanceof StoreNotConfiguredError && e.store === 'testStore');
});

// ---- argument and lifecycle edges ----------------------------------------------------------------------

test('deleteTest rejects an unusable testId before either store is touched', async () => {
  const order = [];
  const resultStore = wrapStore(createInMemoryResultStore(), 'resultStore', order);
  const testStore = wrapStore(createInMemoryClashTestStore(), 'testStore', order);
  const engine = createClashTestEngine(base({ testStore, resultStore }));
  for (const id of [undefined, null, 7, '', 'x'.repeat(257)]) {
    await assert.rejects(() => engine.deleteTest(id), InvalidTestDefinitionError);
  }
  assert.deepEqual(order, []);
  await engine.deleteTest('x'.repeat(256));                              // the boundary itself is legal
  assert.deepEqual(order, ['resultStore.tombstoneTest', 'testStore.delete']);
});

test('deleteTest passes the testId to both stores as the same plain string', async () => {
  const seen = [];
  const resultStore = { ...createInMemoryResultStore(), tombstoneTest: async (id) => { seen.push(['result', typeof id, id]); } };
  const testStore = { ...createInMemoryClashTestStore(), delete: async (id) => { seen.push(['test', typeof id, id]); } };
  const engine = createClashTestEngine(base({ testStore, resultStore }));
  await engine.deleteTest('T-9');
  assert.deepEqual(seen, [['result', 'string', 'T-9'], ['test', 'string', 'T-9']]);
});

test('deleteTest after dispose rejects EngineDisposedError and touches neither store', async () => {
  const order = [];
  const engine = createClashTestEngine(base({
    testStore: wrapStore(createInMemoryClashTestStore(), 'testStore', order),
    resultStore: wrapStore(createInMemoryResultStore(), 'resultStore', order),
  }));
  await engine.dispose();
  await assert.rejects(() => engine.deleteTest('T'), EngineDisposedError);
  assert.deepEqual(order, []);
});

// ================================================================================================
// Task P7.4: the run-path arms deferred from P7.3 (R-P7-14 / R-P7-15). §5.5 layer 2 is the ENGINE's
// admission check in the first resolution step: `testStore.isTombstoned(testId)` (the TEST store —
// spec §5.5 item 2, R-P7-5 — not the result store), for every run with `persist !== false` when a
// testStore is configured, whatever the overload. Layer 1 (`ResultStore.put` refusing a new insertion)
// still guards everything the admission check lets through.
// ================================================================================================

/** The phase P6 records on a gap sealed during resolution (Run.js resolveStage stages 'binding'). */
const RESOLUTION_PHASE = 'binding';
const UNAVAILABLE_GAP = [{ phase: RESOLUTION_PHASE, cause: 'test-unavailable' }];

/** A recording executor (every unit clean); an optional `gate` parks each unit until it resolves. */
function recordingExecutor(gate = null) {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  const calls = [];
  let markStarted;
  const started = new Promise((r) => { markStarted = r; });
  const executor = async (request) => {
    calls.push(request.unit.unitId);
    markStarted();
    if (gate) await gate;
    return inner(request);
  };
  return Object.assign(executor, { calls, started });
}

/** Engine config for a RUN test: fake clock, microtask yields, a timer seam that never fires. */
function runBase(extra = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  return base({
    unitExecutor: recordingExecutor(), now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {}, ...extra,
  });
}

/** The fail-closed pre-resolution seal of §5.5 layer 2: nothing planned, nothing executed. */
function assertRefusedBeforeWork(cfg, summary, label) {
  assert.equal(summary.status, 'failed', label);
  assert.deepEqual(summary.resultSet.ledger.planningGaps, UNAVAILABLE_GAP, label);
  assert.equal(summary.resultSet.definition, null, label);
  assert.deepEqual(summary.resultSet.testRef, { testId: TEST_ID, revision: null, semanticDigest: null }, label);
  assert.deepEqual(summary.resultSet.ledger.units, [], label);
  assert.equal(cfg.enumerator.calls.length, 0, `${label}: no planning`);
  assert.equal(cfg.unitExecutor.calls.length, 0, `${label}: no unit executed`);
  assert.equal(cfg.world.calls.length, 0, `${label}: no findClashes call`);
}

test('control: a persisting direct run on a NON-deleted test plans and executes', async () => {
  const cfg = runBase();
  const summary = await createClashTestEngine(cfg).startRun(validDef({ testId: TEST_ID })).done;
  assert.equal(summary.status, 'completed');
  assert.ok(cfg.enumerator.calls.length > 0 && cfg.unitExecutor.calls.length > 0);
});

test('a persisting DIRECT run after deleteTest seals failed / test-unavailable and does no work', async () => {
  const cfg = runBase();
  const engine = createClashTestEngine(cfg);
  await engine.deleteTest(TEST_ID);
  const summary = await engine.startRun(validDef({ testId: TEST_ID })).done;
  assertRefusedBeforeWork(cfg, summary, 'direct after delete');
});

test('the same direct run with persist:false skips the check and completes (it creates no durable identity)', async () => {
  const asked = [];
  const testStore = createInMemoryClashTestStore();
  const original = testStore.isTombstoned;
  testStore.isTombstoned = (id) => { asked.push(id); return original(id); };
  const cfg = runBase({ testStore });
  const engine = createClashTestEngine(cfg);
  await engine.deleteTest(TEST_ID);
  const summary = await engine.startRun(validDef({ testId: TEST_ID }), { persist: false }).done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(asked, [], 'isTombstoned was never consulted');
  assert.equal(summary.persistence.state, 'skipped');
  // ...and layer 1 still refuses it if a host later persists the sealed set itself.
  const resultStore = createInMemoryResultStore();
  await resultStore.tombstoneTest(TEST_ID);
  await assert.rejects(() => resultStore.put(summary.resultSet), TestDeletedError);
});

test('a REJECTING, or non-boolean, isTombstoned fails closed as test-unavailable', async () => {
  for (const [label, isTombstoned] of [
    ['rejects', async () => { throw new Error('store unreachable'); }],
    ['throws synchronously', () => { throw new Error('store unreachable'); }],
    ['answers a non-boolean', async () => 'no'],
    ['answers undefined', async () => undefined],
  ]) {
    const testStore = { ...createInMemoryClashTestStore(), isTombstoned };
    const cfg = runBase({ testStore });
    const summary = await createClashTestEngine(cfg).startRun(validDef({ testId: TEST_ID })).done;
    assertRefusedBeforeWork(cfg, summary, label);
  }
});

test('stored-reference runs against a deleted, archived or missing test seal failed / test-unavailable', async () => {
  const arms = [
    ['deleted', async (engine) => { await engine.saveTest(validDef({ testId: TEST_ID })); await engine.deleteTest(TEST_ID); }, { testId: TEST_ID }],
    ['archived', async (engine) => { await engine.saveTest(validDef({ testId: TEST_ID })); await engine.archiveTest(TEST_ID); }, { testId: TEST_ID }],
    ['missing', async () => {}, { testId: TEST_ID }],
    ['missing revision', async (engine) => { await engine.saveTest(validDef({ testId: TEST_ID })); }, { testId: TEST_ID, revision: 2 }],
    // persist:false skips the tombstone check, but the store's own `deleted` status still refuses it.
    ['deleted, persist:false', async (engine) => { await engine.saveTest(validDef({ testId: TEST_ID })); await engine.deleteTest(TEST_ID); }, { testId: TEST_ID }, { persist: false }],
  ];
  for (const [label, arrange, reference, runOptions] of arms) {
    const cfg = runBase();
    const engine = createClashTestEngine(cfg);
    await arrange(engine);
    const summary = await engine.startRun(reference, runOptions).done;
    assertRefusedBeforeWork(cfg, summary, label);
  }
});

test('a persisting run admitted BEFORE the delete and finishing after it: outcome unchanged, persistence failed, set held', async () => {
  let open;
  const gate = new Promise((r) => { open = r; });
  const unitExecutor = recordingExecutor(gate);
  const core = createEngineCore(runBase({ unitExecutor }));
  const { engine } = core;
  const handle = engine.startRun(validDef({ testId: TEST_ID }));
  await unitExecutor.started;                            // resolved and executing: the admission check passed
  await engine.deleteTest(TEST_ID);
  open();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed', 'the run outcome is unchanged by the later delete');
  assert.notEqual(summary.resultSet.definition, null, 'resolved before the delete');
  const persisted = await handle.persisted;
  assert.equal(persisted.state, 'failed');
  assert.equal(persisted.error.name, 'TestDeletedError');
  const row = engine.retentionReport().sets.find((s) => s.runId === handle.runId);
  assert.equal(row.class, 'held', 'a failed write keeps the set resident and unevictable');
  assert.equal(engine.getRun(handle.runId), handle);
  assert.equal(await core.internals.stores.result.get(handle.runId), null, 'nothing was inserted');
});

test('with only a resultStore configured, the admission check is skipped but layer 1 still refuses the write', async () => {
  const cfg = runBase({ testStore: null });
  const engine = createClashTestEngine(cfg);
  await engine.deleteTest(TEST_ID);                      // tombstones the result store only
  const handle = engine.startRun(validDef({ testId: TEST_ID }));
  const summary = await handle.done;
  assert.equal(summary.status, 'completed', 'no testStore: no admission check (§5.5 residual boundary)');
  const persisted = await handle.persisted;
  assert.equal(persisted.state, 'failed');
  assert.equal(persisted.error.name, 'TestDeletedError');
});
