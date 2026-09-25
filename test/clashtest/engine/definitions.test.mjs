// test/clashtest/engine/definitions.test.mjs
//
// Task P7.3: the engine's definition surface -- validateTest / saveTest / getTest / listTests / archiveTest /
// listResults -- and its StoreNotConfiguredError raisers. P2's `createDefinitionOperations` owns the §5.3 /
// §5.5 rules (capture-before-the-promise, untrusted store reads, the `put` refusal precedence); these tests
// pin that the ENGINE exposes exactly that behaviour through its R1 gate, and pin what only the engine owns:
// the read slots (§13.5.2), the listing-page validation of the result store (§13.5, R15-6), the option
// capture of a listing call, and the irreversible-call testId guard.
//
// Every engine here runs over `createEngineWorld()` (a world with the full lease + findClashes surface, so the
// registry constructor accepts it). No run is started: `startRun` is P7.4's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import {
  InvalidTestDefinitionError, InvalidOptionsError, StoreNotConfiguredError, CorruptListingError,
  RevisionConflictError, TestArchivedError, ReadCapacityError, EngineDisposedError,
} from '../../../clashtest/errors.js';
import { LIST_LIMIT } from '../../../clashtest/definition/validate.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { isDeepFrozen } from '../../../clashtest/util/capture.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import { withRunId, sealedSet } from '../support/resultSetFixtures.mjs';

const base = (extra = {}) => createEngineWorld().config(extra);
const validDef = (over = {}) => makeDefinition(over);

/** A promise that settles only when the test says so. */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

// ---- validateTest ---------------------------------------------------------------------------------

test('validateTest is pure and never throws for data errors', () => {
  const engine = createClashTestEngine(base());
  const r = engine.validateTest({ testId: 42, revision: 1.5, selectionA: null });
  assert.equal(r.issuesTruncated, false);
  assert.ok(r.issues.length >= 3);
  assert.ok(r.issues.every((i) => typeof i.path === 'string' && typeof i.code === 'string'));
  assert.ok(r.issues.every((i) => !('value' in i)));               // §16: no offending value is recorded
  assert.deepEqual(engine.validateTest(validDef()), { issues: [], issuesTruncated: false });
  for (const junk of [undefined, null, 7, 'x', [], Symbol('s')]) {
    assert.ok(engine.validateTest(junk).issues.length >= 1);         // still a result, never an escape
  }
});

test('validateTest needs no store and reports the SAME issues saveTest rejects with', async () => {
  const engine = createClashTestEngine(base({ testStore: null, resultStore: null }));
  assert.equal(engine.validateTest(validDef()).issues.length, 0);
  const engine2 = createClashTestEngine(base());
  const def = { testId: 42, revision: 1.5 };
  const expected = engine2.validateTest(def);
  await assert.rejects(() => engine2.saveTest(def), (err) => {
    assert.ok(err instanceof InvalidTestDefinitionError);
    assert.deepEqual(err.issues, expected.issues);
    assert.equal(err.issuesTruncated, expected.issuesTruncated);
    return true;
  });
});

// ---- saveTest / getTest -----------------------------------------------------------------------------

test('saveTest stores the definition; getTest reads the latest, or an exact revision, as frozen data', async () => {
  const engine = createClashTestEngine(base());
  const saved = await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  assert.equal(saved.testId, 'T');
  await engine.saveTest(validDef({ testId: 'T', revision: 2, name: 'second' }));
  assert.equal((await engine.getTest('T')).revision, 2);               // no revision => latest
  assert.equal((await engine.getTest('T', 1)).revision, 1);
  assert.equal(await engine.getTest('T', 3), null);
  assert.equal(await engine.getTest('never-saved'), null);
  const read = await engine.getTest('T');
  assert.equal(isDeepFrozen(read), true);
  assert.equal(read.name, 'second');
});

test('saveTest captures the definition in the CALLER\'s turn: a later mutation cannot change what is stored (§5.3)', async () => {
  const engine = createClashTestEngine(base());
  const def = validDef({ testId: 'T', revision: 1 });
  const pending = engine.saveTest(def);
  def.testId = 'MUTATED';                                             // the very next statement after the call
  def.selectionA.entries.push({ kind: 'model', modelKey: 'mZ' });
  const stored = await pending;
  assert.equal(stored.testId, 'T');
  assert.equal(stored.selectionA.entries.length, 1);
  assert.equal((await engine.getTest('T')).selectionA.entries.length, 1);
  assert.equal(await engine.getTest('MUTATED'), null);
});

test('saveTest rejects a definition with an accessor without ever invoking the getter', async () => {
  const engine = createClashTestEngine(base());
  let touched = 0;
  const def = validDef();
  Object.defineProperty(def, 'name', { enumerable: true, get() { touched += 1; return 'x'; } });
  await assert.rejects(() => engine.saveTest(def), InvalidTestDefinitionError);
  assert.equal(touched, 0);
});

test('saveTest never overwrites: a duplicate or out-of-order revision is a RevisionConflictError', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await assert.rejects(() => engine.saveTest(validDef({ testId: 'T', revision: 1, name: 'again' })), RevisionConflictError);
  await assert.rejects(() => engine.saveTest(validDef({ testId: 'T', revision: 3 })), RevisionConflictError);
  assert.equal((await engine.getTest('T')).name, 'structure vs mep');
});

test('getTest treats the store\'s answer as untrusted: a stored value that fails validation is rejected', async () => {
  const testStore = createInMemoryClashTestStore();
  const lying = { ...testStore, get: async () => ({ testId: 'T', revision: 'one' }) };
  const engine = createClashTestEngine(base({ testStore: lying }));
  await assert.rejects(() => engine.getTest('T'), InvalidTestDefinitionError);
});

// ---- store-not-configured raisers -------------------------------------------------------------------

test('store-requiring methods reject StoreNotConfiguredError when the store is explicitly null', async () => {
  const engine = createClashTestEngine(base({ testStore: null, resultStore: null }));
  for (const call of [
    () => engine.saveTest(validDef()), () => engine.getTest('t'), () => engine.listTests({}),
    () => engine.archiveTest('t'), () => engine.deleteTest('t'),
  ]) {
    await assert.rejects(call, (e) => e instanceof StoreNotConfiguredError && e.store === 'testStore');
  }
  await assert.rejects(() => engine.listResults({}),
    (e) => e instanceof StoreNotConfiguredError && e.store === 'resultStore');
  assert.equal(engine.validateTest(validDef()).issues.length, 0);      // validateTest needs no store
});

test('the not-configured check precedes argument validation (an invalid argument to an unconfigured surface is still the store error)', async () => {
  const engine = createClashTestEngine(base({ testStore: null, resultStore: null }));
  await assert.rejects(() => engine.saveTest({ testId: 42 }), StoreNotConfiguredError);
  await assert.rejects(() => engine.archiveTest(42), StoreNotConfiguredError);
  await assert.rejects(() => engine.listTests({ limit: 0 }), StoreNotConfiguredError);
  await assert.rejects(() => engine.listResults({ limit: 0 }), StoreNotConfiguredError);
});

test('an omitted store is the in-memory reference store, not "no store"', async () => {
  const engine = createClashTestEngine(base());                        // testStore/resultStore left undefined
  await engine.saveTest(validDef());
  assert.deepEqual((await engine.listResults({})).summaries, []);
});

// ---- listTests ---------------------------------------------------------------------------------------

test('listTests pages by keyset in testId order and reports archived', async () => {
  const engine = createClashTestEngine(base());
  for (const id of ['c', 'a', 'b']) await engine.saveTest(validDef({ testId: id, revision: 1, name: `n-${id}` }));
  await engine.archiveTest('b');
  const first = await engine.listTests({ limit: 2 });
  assert.deepEqual(first.summaries.map((s) => s.testId), ['a', 'b']);
  assert.equal(first.summaries[1].archived, true);
  assert.equal(typeof first.next, 'string');
  const second = await engine.listTests({ limit: 2, cursor: first.next });
  assert.deepEqual(second.summaries.map((s) => s.testId), ['c']);
  assert.equal('next' in second, false);
  assert.deepEqual((await engine.listTests()).summaries.map((s) => s.testId), ['a', 'b', 'c']);   // page omitted
});

test('listTests/listResults reject a malformed cursor and an out-of-range limit', async () => {
  const engine = createClashTestEngine(base());
  for (const list of [(p) => engine.listTests(p), (p) => engine.listResults(p)]) {
    await assert.rejects(() => list({ limit: 0 }), InvalidOptionsError);
    await assert.rejects(() => list({ limit: LIST_LIMIT.max + 1 }), InvalidOptionsError);
    await assert.rejects(() => list({ limit: 1.5 }), InvalidOptionsError);
    await assert.rejects(() => list({ limit: '5' }), InvalidOptionsError);
    await assert.rejects(() => list({ cursor: 'v9:zzz' }),
      (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'bad-cursor');
    await assert.rejects(() => list({ cursor: 7 }),
      (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'bad-cursor');
    await assert.rejects(() => list({ nope: 1 }), InvalidOptionsError);
    await assert.rejects(() => list(null), InvalidOptionsError);
    await assert.rejects(() => list([]), InvalidOptionsError);
  }
  await assert.rejects(() => engine.listTests({ testId: 'T' }), InvalidOptionsError);   // a listResults-only filter
});

test('a listing call captures its options in the caller\'s turn and never reads a getter', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'a' }));
  await engine.saveTest(validDef({ testId: 'b' }));
  const opts = { limit: 1 };
  const pending = engine.listTests(opts);
  opts.limit = 1000;                                                   // after the call: must not matter
  assert.equal((await pending).summaries.length, 1);
  let touched = 0;
  const trap = {};
  Object.defineProperty(trap, 'limit', { enumerable: true, get() { touched += 1; return 1; } });
  await assert.rejects(() => engine.listTests(trap), InvalidOptionsError);
  await assert.rejects(() => engine.listResults(trap), InvalidOptionsError);
  assert.equal(touched, 0);
});

test('a listing option a host leaves undefined is "absent"; a non-plain options object is refused', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'a' }));
  assert.equal((await engine.listTests({ limit: undefined, cursor: undefined })).summaries.length, 1);
  assert.equal((await engine.listResults({ testId: undefined, limit: undefined })).summaries.length, 0);
  await assert.rejects(() => engine.listTests(new Map()), InvalidOptionsError);
  await assert.rejects(() => engine.listTests(new (class Opts { get limit() { return 1; } })()), InvalidOptionsError);
  await assert.rejects(() => engine.listTests(new Proxy({}, { ownKeys() { throw new Error('trap'); } })), InvalidOptionsError);
  await assert.rejects(() => engine.listTests({ [Symbol('k')]: 1 }), InvalidOptionsError);
});

test('a corrupt store page rejects the whole listing (CorruptListingError) and returns a detached frozen copy otherwise', async () => {
  const good = { summaries: [{ testId: 'a', latestRevision: 1, archived: false, name: 'A' }] };
  const engine = createClashTestEngine(base({ testStore: { ...createInMemoryClashTestStore(), list: async () => good } }));
  const page = await engine.listTests({});
  good.summaries[0].name = 'MUTATED';                                  // the store's own object keeps changing
  assert.equal(page.summaries[0].name, 'A');
  assert.equal(isDeepFrozen(page), true);

  const bad = { summaries: [{ testId: 'a', latestRevision: 0, archived: 'no', name: 'A', extra: 1 }] };
  const broken = createClashTestEngine(base({ testStore: { ...createInMemoryClashTestStore(), list: async () => bad } }));
  await assert.rejects(() => broken.listTests({}), (e) => {
    assert.ok(e instanceof CorruptListingError);
    assert.ok(e.issues.length >= 1);
    assert.ok(e.issues.every((i) => typeof i.path === 'string' && typeof i.code === 'string' && !('value' in i)));
    return true;
  });
});

// ---- read slots (§13.5.2: both listings take them) ---------------------------------------------------

test('listTests and listResults each hold a read slot for the whole store call, and release it on every exit', async () => {
  const hold = gate();
  const testStore = { ...createInMemoryClashTestStore(), list: async () => { await hold.promise; return { summaries: [] }; } };
  const resultStore = { ...createInMemoryResultStore(), list: async () => { await hold.promise; return { summaries: [] }; } };
  const engine = createClashTestEngine(base({
    testStore, resultStore, limits: { maxConcurrentStoreReads: 2, maxQueuedStoreReads: 0 },
  }));
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  const a = engine.listTests({});
  const b = engine.listResults({});
  assert.equal(engine.retentionReport().readSlotsInUse, 2);
  // Slots exhausted and no queue: a third read is refused at once, without touching either store.
  await assert.rejects(() => engine.listTests({}), ReadCapacityError);
  await assert.rejects(() => engine.listResults({}), ReadCapacityError);
  hold.open();
  await Promise.all([a, b]);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a rejecting listing releases its read slot (no leak on the failure path)', async () => {
  const boom = new Error('backend down');
  const testStore = { ...createInMemoryClashTestStore(), list: async () => { throw boom; } };
  const resultStore = { ...createInMemoryResultStore(), list: async () => { throw boom; } };
  const engine = createClashTestEngine(base({ testStore, resultStore, limits: { maxConcurrentStoreReads: 1, maxQueuedStoreReads: 0 } }));
  for (let i = 0; i < 3; i += 1) {                                     // would be ReadCapacityError from call 2 on if leaked
    await assert.rejects(() => engine.listTests({}), (e) => e === boom);
    await assert.rejects(() => engine.listResults({}), (e) => e === boom);
  }
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ---- listResults -------------------------------------------------------------------------------------

test('listResults returns the store\'s summaries, filtered by testId, paged by runId', async () => {
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine(base({ resultStore }));
  for (const id of ['run-b', 'run-a', 'run-c']) await resultStore.put(await withRunId(id));
  const all = await engine.listResults({});
  assert.deepEqual(all.summaries.map((s) => s.runId), ['run-a', 'run-b', 'run-c']);
  const first = await engine.listResults({ limit: 2 });
  assert.deepEqual(first.summaries.map((s) => s.runId), ['run-a', 'run-b']);
  const second = await engine.listResults({ limit: 2, cursor: first.next });
  assert.deepEqual(second.summaries.map((s) => s.runId), ['run-c']);
  assert.equal((await engine.listResults({ testId: 'T1' })).summaries.length, 3);
  assert.equal((await engine.listResults({ testId: 'other' })).summaries.length, 0);
  assert.equal(isDeepFrozen(all), true);
});

test('listResults treats the store page as untrusted: an invalid row rejects the WHOLE page, values never recorded', async () => {
  const resultStore = createInMemoryResultStore();
  await resultStore.put(await sealedSet('positives'));
  const { summaries } = await resultStore.list({});
  const row = summaries[0];
  const pageOf = (rows) => ({ ...createInMemoryResultStore(), list: async () => ({ summaries: rows }) });

  const cases = {
    'a missing field': (r) => { delete r.serializedBytes; return r; },
    'an unknown field': (r) => ({ ...r, secret: 'leak-me' }),
    'a wrong-type count': (r) => ({ ...r, counts: { ...r.counts, results: -1 } }),
    'a non-object row': () => 'not-a-row',
    'a duplicate modelKey': (r) => ({ ...r, models: [...r.models, ...r.models] }),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const engine = createClashTestEngine(base({ resultStore: pageOf([structuredClone(row), mutate(structuredClone(row))]) }));
    await assert.rejects(() => engine.listResults({}), (e) => {
      assert.ok(e instanceof CorruptListingError, label);
      assert.ok(e.issues.length >= 1 && e.issues.length <= 20, label);
      assert.ok(e.issues.every((i) => /^\/summaries\/1(\/|$)/.test(i.path)), `${label}: ${JSON.stringify(e.issues)}`);   // row 0 was fine
      assert.ok(!JSON.stringify(e.issues).includes('leak-me'), label);
      assert.ok(e.issues.every((i) => !('value' in i)), label);
      return true;
    });
  }
  // page-level shape
  for (const page of [null, [], { summaries: 'x' }, { next: 'v1:x' }, { summaries: [], next: 7 }, { summaries: [], extra: 1 }]) {
    const engine = createClashTestEngine(base({ resultStore: { ...createInMemoryResultStore(), list: async () => page } }));
    await assert.rejects(() => engine.listResults({}), CorruptListingError, JSON.stringify(page));
  }
});

test('listResults never invokes a getter on the store page, and returns a detached copy', async () => {
  const resultStore = createInMemoryResultStore();
  await resultStore.put(await sealedSet('positives'));
  const real = await resultStore.list({});
  let touched = 0;
  const trapped = { summaries: real.summaries };
  Object.defineProperty(trapped, 'next', { enumerable: true, get() { touched += 1; return 'v1:x'; } });
  const evil = createClashTestEngine(base({ resultStore: { ...createInMemoryResultStore(), list: async () => trapped } }));
  await assert.rejects(() => evil.listResults({}), CorruptListingError);
  assert.equal(touched, 0);

  const live = { summaries: structuredClone(real.summaries) };
  const engine = createClashTestEngine(base({ resultStore: { ...createInMemoryResultStore(), list: async () => live } }));
  const page = await engine.listResults({});
  live.summaries[0].status = 'MUTATED';
  live.summaries.length = 0;
  assert.equal(page.summaries.length, 1);
  assert.notEqual(page.summaries[0].status, 'MUTATED');
});

// ---- archiveTest -------------------------------------------------------------------------------------

test('archiveTest is soft, idempotent and covers the test as a whole: readable, listed archived, no new revisions', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  assert.equal(await engine.archiveTest('T'), undefined);
  assert.equal(await engine.archiveTest('T'), undefined);              // idempotent
  assert.equal(await engine.archiveTest('never-saved'), undefined);    // unknown id: a no-op, not an error
  assert.equal((await engine.getTest('T')).revision, 1);               // still readable
  assert.equal((await engine.listTests({})).summaries[0].archived, true);
  await assert.rejects(() => engine.saveTest(validDef({ testId: 'T', revision: 2 })), TestArchivedError);
});

test('archiveTest and deleteTest reject an unusable testId before any store is touched (irreversible calls)', async () => {
  let calls = 0;
  const spy = (store) => new Proxy(store, { get: (t, k) => (typeof t[k] === 'function' ? (...a) => { calls += 1; return t[k](...a); } : t[k]) });
  const engine = createClashTestEngine(base({
    testStore: spy(createInMemoryClashTestStore()), resultStore: spy(createInMemoryResultStore()),
  }));
  for (const id of [undefined, null, 42, '', 'x'.repeat(257), {}, ['T']]) {
    await assert.rejects(() => engine.archiveTest(id), InvalidTestDefinitionError, `archive ${String(id).slice(0, 8)}`);
    await assert.rejects(() => engine.deleteTest(id), InvalidTestDefinitionError, `delete ${String(id).slice(0, 8)}`);
  }
  assert.equal(calls, 0);
});

// ---- the R1 gate on the real methods -----------------------------------------------------------------

test('after dispose: validateTest throws and every Promise-returning definition method rejects EngineDisposedError', async () => {
  const engine = createClashTestEngine(base());
  await engine.dispose();
  assert.throws(() => engine.validateTest(validDef()), EngineDisposedError);
  for (const call of [
    () => engine.saveTest(validDef()), () => engine.getTest('T'), () => engine.listTests({}),
    () => engine.listResults({}), () => engine.archiveTest('T'), () => engine.deleteTest('T'),
  ]) {
    const p = call();
    assert.ok(p instanceof Promise);
    await assert.rejects(p, EngineDisposedError);
  }
});

test('the Promise-returning definition methods never throw synchronously, whatever the argument', async () => {
  const engine = createClashTestEngine(base());
  const junk = [undefined, null, 7, 'x', [], {}, Symbol('s'), () => {}];
  for (const arg of junk) {
    for (const name of ['saveTest', 'getTest', 'listTests', 'listResults', 'archiveTest', 'deleteTest']) {
      let p;
      assert.doesNotThrow(() => { p = engine[name](arg); }, `${name}(${String(typeof arg)})`);
      assert.ok(p instanceof Promise);
      await p.catch(() => {});                                          // resolve or reject: both are fine
    }
  }
});
