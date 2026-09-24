// test/clashtest/engine/deleteTest.tombstone.test.mjs
//
// Task P7.3: `engine.deleteTest` -- the two-layer, fail-closed delete of spec §5.5 -- and the engine-level
// NH3 bypass matrix for every path reachable WITHOUT `startRun`'s resolver:
//   (i) `resultStore.tombstoneTest(testId)` FIRST (if a result store is configured), (ii) THEN
//   `testStore.delete(testId)` (if a test store is configured); both idempotent; (i) done + (ii) failed
//   => the promise rejects, the reservation STAYS, a retry completes; the reverse order is never used;
//   `StoreNotConfiguredError` only when NEITHER store is configured.
//
// DEFERRED TO P7.4 (they need the run-resolution path, whose resolver P7.4 owns; controller ruling R-P7-14):
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
import { createClashTestEngine } from '../../../clashtest/engine.js';
import {
  StoreNotConfiguredError, TestDeletedError, InvalidTestDefinitionError, EngineDisposedError,
} from '../../../clashtest/errors.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import { withRunId } from '../support/resultSetFixtures.mjs';

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
