// test/clashtest/definition/operations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefinitionOperations, RESOLVE_STATUS_TO_PLANNING_CAUSE } from '../../../clashtest/definition/operations.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createFakeClock } from '../support/index.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const seams = () => { const c = createFakeClock(); return { now: c.now, yieldToScheduler: c.yieldToScheduler, limits: {} }; };
const ops = (testStore) => createDefinitionOperations({ testStore, ...seams() });

test('saveTest validates, normalizes, freezes and stores', async () => {
  const store = createInMemoryClashTestStore();
  const saved = await ops(store).saveTest(makeDefinition());
  assert.deepEqual(saved.selectionA.entries[0].dbIds, [1, 2]);   // normalized (input was [2,1])
  assert.ok(Object.isFrozen(saved));
  assert.deepEqual(await store.get('T1'), saved);
});

test('saveTest captures synchronously: a mutation right after the call is inert', async () => {
  const store = createInMemoryClashTestStore();
  const def = makeDefinition();
  const promise = ops(store).saveTest(def);
  def.name = 'HIJACKED';
  def.selectionA.entries[0].dbIds.push(999);
  const saved = await promise;
  assert.equal(saved.name, 'structure vs mep');
  assert.deepEqual(saved.selectionA.entries[0].dbIds, [1, 2]);
});

test('saveTest rejects an invalid definition and never touches the store', async () => {
  let puts = 0;
  const store = { ...createInMemoryClashTestStore(), put: async (d) => { puts += 1; return d; } };
  await assert.rejects(ops(store).saveTest(makeDefinition({ mode: 'nope' })),
    (e) => e.name === 'InvalidTestDefinitionError' && e.issues.length === 1);
  await assert.rejects(ops(store).saveTest(makeDefinition({ schemaVersion: 7 })),
    (e) => e.name === 'UnsupportedSchemaVersionError');
  assert.equal(puts, 0);
});

test('saveTest neither assigns nor rewrites revisions', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition({ revision: 1 }));
  await assert.rejects(o.saveTest(makeDefinition({ revision: 1 })), (e) => e.name === 'RevisionConflictError');
  await o.saveTest(makeDefinition({ revision: 2 }));
  assert.equal((await store.get('T1')).revision, 2);
});

test('the store receives the normalized, deep-frozen copy with the caller-supplied revision', async () => {
  const seen = [];
  const store = { ...createInMemoryClashTestStore(), put: async (d) => { seen.push(d); return d; } };
  const saved = await ops(store).saveTest(makeDefinition({ revision: 5 }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0], saved);                        // the same object the store got is what resolves
  assert.equal(seen[0].revision, 5);                   // not assigned, not rewritten
  assert.deepEqual(seen[0].selectionA.entries[0].dbIds, [1, 2]);
  assert.ok(Object.isFrozen(seen[0]) && Object.isFrozen(seen[0].selectionA.entries[0].dbIds));
});

test('every definition operation rejects StoreNotConfiguredError with no testStore', async () => {
  const o = createDefinitionOperations({ testStore: null, ...seams() });
  for (const call of [o.saveTest(makeDefinition()), o.getTest('T1'), o.listTests(), o.archiveTest('T1')]) {
    await assert.rejects(call, (e) => e.name === 'StoreNotConfiguredError' && e.store === 'testStore');
  }
  assert.deepEqual(o.validateTest(makeDefinition()), { issues: [], issuesTruncated: false }); // unaffected
});

test('an omitted testStore behaves like null', async () => {
  const o = createDefinitionOperations({ ...seams() });
  await assert.rejects(o.getTest('T1'), (e) => e.name === 'StoreNotConfiguredError');
});

test('validateTest and saveTest accept and reject identically', async () => {
  const hostile = makeDefinition();
  Object.defineProperty(hostile, 'name', { get() { throw new Error('getter invoked'); }, enumerable: true });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const cases = [
    makeDefinition(),
    makeDefinition({ mode: 'nope' }),
    makeDefinition({ schemaVersion: 7 }),
    makeDefinition({ schemaVersion: 0 }),
    makeDefinition({ name: '' }),
    makeDefinition({ extra: 1 }),
    makeDefinition({ selectionA: { entries: [] } }),
    makeDefinition({ mode: 'clearance' }),                        // clearance missing
    hostile, revoked.proxy, null, undefined, 42, 'text', [],
  ];
  for (const input of cases) {
    const store = createInMemoryClashTestStore();
    const o = ops(store);
    const verdict = o.validateTest(input);
    let outcome;
    try { await o.saveTest(input); outcome = { ok: true }; } catch (e) { outcome = { ok: false, e }; }
    if (verdict.issues.length === 0) {
      assert.equal(outcome.ok, true, 'validateTest accepted, saveTest must accept');
    } else {
      assert.equal(outcome.ok, false, `validateTest rejected (${JSON.stringify(verdict.issues[0])}), saveTest must reject`);
      const known = outcome.e.name === 'UnsupportedSchemaVersionError' || outcome.e.name === 'InvalidTestDefinitionError';
      assert.ok(known, `unexpected error ${outcome.e && outcome.e.name}`);
      if (outcome.e.name === 'InvalidTestDefinitionError') {
        assert.deepEqual(outcome.e.issues, verdict.issues);
        assert.equal(outcome.e.issuesTruncated, verdict.issuesTruncated);
      }
    }
  }
});

test('validateTest and saveTest honour the same resolved limits', async () => {
  const c = createFakeClock();
  const o = createDefinitionOperations({ testStore: createInMemoryClashTestStore(), now: c.now,
    yieldToScheduler: c.yieldToScheduler, limits: { maxValidationIssues: 1 } });
  const bad = makeDefinition({ mode: 'nope', name: '' });
  const v = o.validateTest(bad);
  assert.equal(v.issues.length, 1);
  assert.equal(v.issuesTruncated, true);
  await assert.rejects(o.saveTest(bad), (e) => e.name === 'InvalidTestDefinitionError' && e.issues.length === 1 && e.issuesTruncated === true);
});

test('saveTest never throws synchronously, even for a hostile argument', () => {
  const store = createInMemoryClashTestStore();
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const input of [revoked.proxy, null, undefined, makeDefinition({ mode: 'nope' })]) {
    let p;
    assert.doesNotThrow(() => { p = ops(store).saveTest(input); });
    assert.ok(p instanceof Promise);
    p.catch(() => {});
  }
});

test('getTest treats a store definition as untrusted and re-validates it', async () => {
  const bad = { ...makeDefinition(), mode: 'nope' };
  const store = { ...createInMemoryClashTestStore(), get: async () => bad };
  await assert.rejects(ops(store).getTest('T1'), (e) => e.name === 'InvalidTestDefinitionError');

  const newer = { ...makeDefinition(), schemaVersion: 9 };
  const store2 = { ...createInMemoryClashTestStore(), get: async () => newer };
  await assert.rejects(ops(store2).getTest('T1'), (e) => e.name === 'UnsupportedSchemaVersionError');
});

test('getTest never invokes a getter on a hostile stored definition', async () => {
  let calls = 0;
  const hostile = makeDefinition();
  Object.defineProperty(hostile, 'name', { get() { calls += 1; return 'x'; }, enumerable: true });
  const store = { ...createInMemoryClashTestStore(), get: async () => hostile };
  await assert.rejects(ops(store).getTest('T1'), (e) => e.name === 'InvalidTestDefinitionError');
  assert.equal(calls, 0);
});

test('a store definition mutated after it is returned cannot affect the caller', async () => {
  const mutable = makeDefinition();
  const store = { ...createInMemoryClashTestStore(), get: async () => mutable };
  const got = await ops(store).getTest('T1');
  mutable.name = 'HIJACKED';
  mutable.selectionA.entries[0].dbIds.push(999);
  assert.equal(got.name, 'structure vs mep');
  assert.deepEqual(got.selectionA.entries[0].dbIds, [1, 2]);
  assert.ok(Object.isFrozen(got));
});

test('getTest resolves null for a missing test and forwards the revision', async () => {
  assert.equal(await ops(createInMemoryClashTestStore()).getTest('nope'), null);
  const args = [];
  const store = { ...createInMemoryClashTestStore(), get: async (...a) => { args.push(a); return null; } };
  await ops(store).getTest('T1', 3);
  assert.deepEqual(args, [['T1', 3]]);
});

test('getTest returns a stored, valid definition as a frozen normalized copy', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  const saved = await o.saveTest(makeDefinition());
  const got = await o.getTest('T1');
  assert.deepEqual(got, saved);
  assert.ok(Object.isFrozen(got));
});

test('listTests rejects a corrupt page whole, never per entry', async () => {
  const store = {
    ...createInMemoryClashTestStore(),
    list: async () => ({ summaries: [
      { testId: 'a', latestRevision: 1, archived: false, name: 'n' },
      { testId: 'b', latestRevision: 0, archived: false, name: 'n' },
    ] }),
  };
  await assert.rejects(ops(store).listTests(), (e) => {
    assert.equal(e.name, 'CorruptListingError');
    assert.deepEqual(e.issues, [{ path: '/summaries/1/latestRevision', code: 'out-of-range' }]);
    return true;
  });
});

test('a corrupt listing yields CorruptListingError carrying no values, whatever the corruption', async () => {
  const SECRET = 'SECRET-VALUE-42';
  const pages = [
    null,
    'a string page',
    { summaries: 'nope' },
    { summaries: [{ testId: SECRET, latestRevision: 'x', archived: SECRET, name: 7, extra: 1 }] },
    { summaries: [{ testId: 'a', latestRevision: 1, archived: false, name: SECRET.repeat(500) }] },
    { summaries: [], next: 5 },
    { summaries: [], other: SECRET },
  ];
  for (const page of pages) {
    const store = { ...createInMemoryClashTestStore(), list: async () => page };
    await assert.rejects(ops(store).listTests(), (e) => {
      assert.equal(e.name, 'CorruptListingError');
      assert.ok(e.issues.length >= 1 && e.issues.length <= 20);
      for (const i of e.issues) assert.deepEqual(Object.keys(i).sort(), ['code', 'path']);
      assert.ok(!(JSON.stringify(e.issues) + e.message).includes(SECRET), 'no listing value may appear in the error');
      return true;
    });
  }
});

test('a listing with a hostile getter is rejected without invoking it', async () => {
  let calls = 0;
  const row = { testId: 'a', latestRevision: 1, archived: false };
  Object.defineProperty(row, 'name', { get() { calls += 1; return 'n'; }, enumerable: true });
  const store = { ...createInMemoryClashTestStore(), list: async () => ({ summaries: [row] }) };
  await assert.rejects(ops(store).listTests(), (e) => e.name === 'CorruptListingError');
  assert.equal(calls, 0);
});

test('listTests forwards options and returns a valid page', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition({ testId: 'A' }));
  await o.saveTest(makeDefinition({ testId: 'B' }));
  const page = await o.listTests({ limit: 1 });
  assert.deepEqual(page.summaries.map((s) => s.testId), ['A']);
  assert.equal(typeof page.next, 'string');
  const rest = await o.listTests({ limit: 1, cursor: page.next });
  assert.deepEqual(rest.summaries.map((s) => s.testId), ['B']);
});

test('archiveTest delegates and then blocks stored-reference revisions', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition());
  await o.archiveTest('T1');
  assert.equal((await store.resolveForRun('T1')).status, 'archived');
  await assert.rejects(o.saveTest(makeDefinition({ revision: 2 })), (e) => e.name === 'TestArchivedError');
});

test('the surface is exactly the five 18 operations (deleteTest is wired in P7)', () => {
  const o = ops(createInMemoryClashTestStore());
  assert.deepEqual(Object.keys(o).sort(), ['archiveTest', 'getTest', 'listTests', 'saveTest', 'validateTest']);
});

test('RESOLVE_STATUS_TO_PLANNING_CAUSE maps the four resolveForRun statuses (5.5)', () => {
  assert.deepEqual(RESOLVE_STATUS_TO_PLANNING_CAUSE, {
    live: null, archived: 'test-archived', deleted: 'test-deleted', missing: 'test-not-found',
  });
  assert.ok(Object.isFrozen(RESOLVE_STATUS_TO_PLANNING_CAUSE));
  assert.equal(Object.keys(RESOLVE_STATUS_TO_PLANNING_CAUSE).length, 4);
});

test('the table covers every status the in-memory store can return', async () => {
  const store = createInMemoryClashTestStore();
  const o = ops(store);
  await o.saveTest(makeDefinition({ testId: 'L' }));
  await o.saveTest(makeDefinition({ testId: 'R' }));
  await o.archiveTest('R');
  await o.saveTest(makeDefinition({ testId: 'D' }));
  await store.delete('D');
  const statuses = new Set();
  for (const id of ['L', 'R', 'D', 'nope']) statuses.add((await store.resolveForRun(id)).status);
  assert.deepEqual([...statuses].sort(), Object.keys(RESOLVE_STATUS_TO_PLANNING_CAUSE).sort());
});

// ---- P2 review remediation: listTests returns the validated detached copy, not the store's page ---------

const livePage = () => ({
  summaries: [
    { testId: 'a', latestRevision: 1, archived: false, name: 'first' },
    { testId: 'b', latestRevision: 2, archived: true, name: 'second' },
  ],
  next: 'v1:b',
});

test('listTests returns a frozen detached copy: not the store object, unaffected by later store mutation', async () => {
  const stored = livePage();
  const store = { ...createInMemoryClashTestStore(), list: async () => stored };
  const page = await ops(store).listTests();
  const snapshot = JSON.stringify(page);
  assert.notEqual(page, stored);
  assert.notEqual(page.summaries, stored.summaries);
  assert.notEqual(page.summaries[0], stored.summaries[0]);
  assert.deepEqual(page, livePage());
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.summaries) && Object.isFrozen(page.summaries[0]));
  assert.throws(() => { page.summaries.push({}); }, TypeError);
  // the store keeps mutating its own page and rows after the call returned
  stored.summaries[0].name = 'HIJACKED';
  stored.summaries[1].archived = 'nope';
  stored.summaries.push({ testId: 'c' });
  stored.next = 42;
  delete stored.summaries[0].testId;
  assert.equal(JSON.stringify(page), snapshot);
});

test('listTests validates and returns ONE capture: a store page that changes on the second read cannot slip through', async () => {
  const stored = livePage();
  let reads = 0;
  const flipping = new Proxy(stored, {
    ownKeys(t) { reads += 1; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) {
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      if (reads > 1 && d && k === 'next') d.value = 42;       // would be invalid, but only after the first read
      return d;
    },
  });
  const store = { ...createInMemoryClashTestStore(), list: async () => flipping };
  const page = await ops(store).listTests();
  assert.equal(reads, 1);
  assert.equal(page.next, 'v1:b');
});

test('getTest shares no structure with the stored object', async () => {
  const stored = makeDefinition();
  const store = { ...createInMemoryClashTestStore(), get: async () => stored };
  const got = await ops(store).getTest('T1');
  assert.notEqual(got, stored);
  assert.notEqual(got.selectionA, stored.selectionA);
  assert.notEqual(got.selectionA.entries, stored.selectionA.entries);
  assert.notEqual(got.selectionA.entries[0], stored.selectionA.entries[0]);
  assert.notEqual(got.selectionA.entries[0].dbIds, stored.selectionA.entries[0].dbIds);
  assert.notEqual(got.selectionB.entries[0], stored.selectionB.entries[0]);
});

// ---- P2 review remediation H3: createDefinitionOperations forwards spanRecorder (saveTest and store definitions) ----

const SPAN_LIMITS = { maxEntriesPerSelection: 1_000, aggregationSliceMaxItems: 64 };
// >64 chunks of 8 KiB of canonical text, so the digest phase itself yields at 64 items per slice.
const spanDef = () => makeDefinition({
  selectionA: { entries: Array.from({ length: 700 }, (_, i) => ({ kind: 'model', modelKey: `${String(i).padStart(4, '0')}${'k'.repeat(1_000)}` })) },
});
const recordingOps = (testStore) => {
  const c = createFakeClock();
  const spans = [];
  const operations = createDefinitionOperations({
    testStore, now: c.now, yieldToScheduler: c.yieldToScheduler, limits: SPAN_LIMITS, spanRecorder: (label, ms) => spans.push([label, ms]),
  });
  return { operations, spans, labels: () => new Set(spans.map(([label]) => label)) };
};

test('saveTest records normalize and semanticDigest spans through the injected spanRecorder', async () => {
  const { operations, spans, labels } = recordingOps(createInMemoryClashTestStore());
  await operations.saveTest(spanDef());
  assert.ok(spans.length > 0);
  assert.ok(labels().has('normalize'), `labels: ${[...labels()]}`);
  assert.ok(labels().has('semanticDigest'), `labels: ${[...labels()]}`);
  assert.ok(!labels().has('digest'));
});

test('a store-returned definition prepared by getTest records spans through the same spanRecorder', async () => {
  const store = createInMemoryClashTestStore();
  await ops(store).saveTest(spanDef());                            // seed the store without a recorder
  const { operations, spans, labels } = recordingOps(store);
  const got = await operations.getTest('T1');
  assert.equal(got.testId, 'T1');
  assert.ok(spans.length > 0, 'getTest must forward the recorder to prepareDefinition');
  assert.ok(labels().has('normalize') && labels().has('semanticDigest'), `labels: ${[...labels()]}`);
});

test('operations without a spanRecorder (absent or undefined) still save and get', async () => {
  const store = createInMemoryClashTestStore();
  const c = createFakeClock();
  const plain = createDefinitionOperations({ testStore: store, now: c.now, yieldToScheduler: c.yieldToScheduler, spanRecorder: undefined });
  await plain.saveTest(makeDefinition());
  assert.equal((await plain.getTest('T1')).testId, 'T1');
});
