// test/clashtest/support/resultStoreConformance.mjs
//
// Task P5.7: the `ResultStore` PORT conformance suite every host store implementation must pass
// (spec S13.5). Exercises only the port's own public surface (`put`/`get`/`list`/`delete`/
// `tombstoneTest`/`isTombstoned`) plus the typed errors the port names -- never a store's
// internals -- so the same suite runs unchanged against the in-memory reference store today and
// against a future remote/IndexedDB backend later.
//
// `makeStore` is called fresh for EVERY test (a store must start empty) and is always `await`ed,
// even though today's one real caller (`createInMemoryResultStore`) is synchronous: a future
// server-/IndexedDB-backed test adapter may need to await its own setup, and this way that adapter
// change costs nothing here.
//
// `corruptListing(store)` (required): seeds ONE row into `store` whose derived `ResultSetSummary`
// is invalid. Resolved by codex-advisor consultation (2026-09-22, see the report and
// `InMemoryResultStore.test.mjs`'s own wiring note): `put()` is never the full-schema validation
// boundary (only `readResultSet`'s `validateResultSet` is, at the untrusted-READ path), so seeding
// a genuinely invalid-but-storable row through the store's OWN ordinary `put()` is store-specific
// and must come from the caller, never be invented here or worked around with a production-only
// test hook.
//
// `makeOffsetStore()` / `makeYieldingStore()` / `runKeysetProbe` / `runLinearizabilityProbe` are
// INTERNAL to this file: two deliberately non-conforming fake stores, plus the two probe functions
// that must be able to fail them -- proof the suite's own machinery is falsifiable, not vacuously
// true (the same role P3's `{ignoreCheckpoint: true}` fake enumerator plays for
// `checkEnumeratorConformance`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRunId, sealedSet } from './resultSetFixtures.mjs';
import { CorruptListingError, ResultSetTooLargeError, RunIdConflictError, TestDeletedError } from '../../../clashtest/errors.js';

const KEYSET_IDS = ['r1', 'r3', 'r5', 'r7'];

/**
 * The shared keyset-paging traversal: inserts `KEYSET_IDS`, pages through with `limit: 2`,
 * mutating the store between pages (an unrelated insert of a lexically-earlier id, plus a no-op
 * delete) the way a real concurrent writer would, and requires the exact sequence back with no
 * duplicate and no skip. Throws an Error whose message contains "non-conforming" on any violation
 * (never a bare assertion failure), so a negative test can match on that text regardless of exactly
 * which invariant the store under test breaks.
 */
async function runKeysetProbe(store) {
  for (const id of KEYSET_IDS) await store.put(await withRunId(id, 'positives'));
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const page = await store.list({ limit: 2, cursor });
    seen.push(...page.summaries.map((s) => s.runId));
    cursor = page.next;
    if (cursor) { await store.put(await withRunId('r0', 'positives')); await store.delete('r9'); }
    pages += 1;
    if (pages > KEYSET_IDS.length + 4) throw new Error('runKeysetProbe: non-conforming store (paging never terminated)');
  } while (cursor);
  const ok = seen.length === KEYSET_IDS.length && KEYSET_IDS.every((id, i) => seen[i] === id);
  if (!ok) {
    throw new Error(`runKeysetProbe: non-conforming store (expected ${JSON.stringify(KEYSET_IDS)}, got ${JSON.stringify(seen)})`);
  }
}

/**
 * A deliberately non-conforming OFFSET-paginated fake: `cursor` is a raw numeric offset into a
 * live, mutable, sorted array, so an insert/delete BETWEEN two `list()` calls shifts every later
 * page -- the exact defect keyset pagination (a cursor anchored to the last KEY returned, never a
 * position) exists to avoid. Minimal on purpose: only enough surface for `runKeysetProbe`.
 */
function makeOffsetStore() {
  const runIds = [];
  return {
    async put(set) { if (!runIds.includes(set.runId)) { runIds.push(set.runId); runIds.sort(); } },
    async get() { return null; },
    async list({ limit = 100, cursor } = {}) {
      const offset = cursor ? Number(cursor.slice('offset:'.length)) : 0;
      const page = runIds.slice(offset, offset + limit);
      const next = offset + limit < runIds.length ? `offset:${offset + limit}` : undefined;
      return { summaries: page.map((runId) => ({ runId })), next };
    },
    async delete(runId) { const i = runIds.indexOf(runId); if (i >= 0) runIds.splice(i, 1); },
    async tombstoneTest() {},
    async isTombstoned() { return false; },
  };
}

/**
 * A deliberately non-conforming store whose `put` awaits ONCE between its conflict CHECK and its
 * insert -- a classic TOCTOU gap a callback-based or network-backed backend could introduce by
 * accident. Minimal on purpose: only enough surface for `runLinearizabilityProbe`.
 */
function makeYieldingStore() {
  const sets = new Map();
  return {
    async put(resultSet) {
      const existing = sets.get(resultSet.runId);
      await null;                                               // the gap under test
      if (existing !== undefined) return;                        // never reached by the probe's own races
      sets.set(resultSet.runId, resultSet);
    },
    async get(runId) { const s = sets.get(runId); return s === undefined ? null : structuredClone(s); },
    async list({ limit = 100 } = {}) {
      return { summaries: [...sets.keys()].sort().slice(0, limit).map((runId) => ({ runId })) };
    },
    async delete(runId) { sets.delete(runId); },
    async tombstoneTest() {},
    async isTombstoned() { return false; },
  };
}

/**
 * Runs the three §13.5 linearizability races against a FRESH store from `makeStoreFactory` each
 * time, throwing a "non-conforming" Error (never a bare assertion) on the first violation -- the
 * counterpart to `runKeysetProbe` for the concurrency invariants, and what proves those three races
 * are actually falsifiable rather than vacuously true.
 */
async function runLinearizabilityProbe(makeStoreFactory) {
  const nonConforming = (msg) => { throw new Error(`runLinearizabilityProbe: non-conforming store (${msg})`); };

  { // (a) N concurrent puts of DIFFERENT content, same runId: exactly one must win.
    const store = await makeStoreFactory();
    const KINDS = ['positives', 'completed-clean', 'completed-with-gaps', 'unreachable-positive'];
    const rivals = await Promise.all(KINDS.map((k) => withRunId('run-race-a', k)));
    const settled = await Promise.allSettled(rivals.map((s) => store.put(s)));
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    if (fulfilled.length !== 1) nonConforming(`race (a): expected exactly one winner, saw ${fulfilled.length}`);
  }

  { // (b) N concurrent puts of IDENTICAL content, same runId: all must succeed.
    const store = await makeStoreFactory();
    const set = await withRunId('run-race-b', 'positives');
    const settled = await Promise.allSettled([0, 1, 2, 3, 4].map(() => store.put(structuredClone(set))));
    if (!settled.every((r) => r.status === 'fulfilled')) nonConforming('race (b): identical content must always succeed');
  }

  { // (c) a put racing tombstoneTest: either order is fine, but never a mixed (lost/partial) outcome.
    const store = await makeStoreFactory();
    const set = await withRunId('run-race-c', 'positives');
    const [putResult] = await Promise.allSettled([store.put(set), store.tombstoneTest(set.testRef.testId)]);
    const stored = await store.get(set.runId);
    if (putResult.status === 'fulfilled' && stored === null) nonConforming('race (c): a resolved put must be visible');
    if (putResult.status === 'rejected' && stored !== null) nonConforming('race (c): a rejected put must insert nothing');
  }
}

/** `runResultStoreConformance(makeStore, {label, corruptListing})` -- the port conformance suite
 *  every host `ResultStore` implementation must pass. */
export function runResultStoreConformance(makeStore, { label, corruptListing }) {
  test(`${label}: keyset paging never duplicates or skips an item present throughout`, async () => {
    await runKeysetProbe(await makeStore());
  });

  test(`${label}: an offset-paging store is caught as non-conforming`, async () => {
    await assert.rejects(async () => runKeysetProbe(makeOffsetStore()), /non-conforming/);
  });

  test(`${label}: summaries are header-only, closed and validated`, async () => {
    const store = await makeStore();
    const set = await sealedSet('positives');
    await store.put(set);
    const [s] = (await store.list({})).summaries;
    assert.deepEqual(Object.keys(s).sort(), ['coverage', 'counts', 'digests', 'environmentSensitive', 'finishedAt',
      'integrity', 'models', 'runId', 'serializedBytes', 'startedAt', 'status', 'testRef'].sort());
    assert.ok(Number.isSafeInteger(s.serializedBytes) && s.serializedBytes >= 0);
    assert.equal('results' in s, false);
  });

  test(`${label}: a page with any invalid entry is rejected whole`, async () => {
    const store = await makeStore();
    await corruptListing(store);
    await assert.rejects(store.list({}), CorruptListingError);
  });

  test(`${label}: the byte guard rejects before materializing`, async () => {
    const store = await makeStore();
    const set = await sealedSet('positives');
    await store.put(set);
    const realParse = JSON.parse;
    let parses = 0;
    JSON.parse = (...a) => { parses += 1; return realParse(...a); };
    try {
      await assert.rejects(store.get(set.runId, { maxBytes: 10 }), ResultSetTooLargeError);
      assert.equal(parses, 0);
    } finally { JSON.parse = realParse; }
  });

  test(`${label}: concurrent puts of the same runId linearize to exactly one winner`, async () => {
    const store = await makeStore();
    const KINDS = ['positives', 'completed-clean', 'completed-with-gaps', 'unreachable-positive'];
    const rivals = await Promise.all(KINDS.map((k) => withRunId('run-x', k)));
    const settled = await Promise.allSettled(rivals.map((s) => store.put(s)));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, 'exactly one writer wins');
    assert.ok(settled.filter((r) => r.status === 'rejected')
      .every((r) => r.reason instanceof RunIdConflictError), 'every loser sees RunIdConflictError');
    const stored = await store.get('run-x');
    assert.ok(rivals.some((s) => s.outcome.coverage === stored.outcome.coverage),
      'the stored content is one whole rival, never a blend');
    assert.equal((await store.list({})).summaries.filter((s) => s.runId === 'run-x').length, 1);
  });

  test(`${label}: concurrent identical puts are all idempotent successes`, async () => {
    const store = await makeStore();
    const set = await withRunId('run-y', 'positives');
    const settled = await Promise.allSettled(
      [0, 1, 2, 3, 4].map(() => store.put(structuredClone(set))));
    assert.ok(settled.every((r) => r.status === 'fulfilled'), JSON.stringify(settled));
    assert.equal((await store.list({})).summaries.filter((s) => s.runId === 'run-y').length, 1);
  });

  test(`${label}: a put racing tombstoneTest lands on ONE side, never in between`, async () => {
    // Both interleavings are exercised by issuing them in both orders within one tick.
    for (const tombstoneFirst of [false, true]) {
      const store = await makeStore();
      const set = await withRunId(`run-${tombstoneFirst}`, 'positives');
      const testId = set.testRef.testId;
      const calls = tombstoneFirst
        ? [store.tombstoneTest(testId), store.put(set)]
        : [store.put(set), store.tombstoneTest(testId)];
      const results = await Promise.allSettled(calls);
      const putResult = tombstoneFirst ? results[1] : results[0];

      assert.equal(await store.isTombstoned(testId), true, 'the tombstone always lands');
      const stored = await store.get(set.runId);
      if (putResult.status === 'fulfilled') {
        assert.ok(stored !== null, 'a resolved put must be visible (no lost write)');
      } else {
        assert.ok(putResult.reason instanceof TestDeletedError, String(putResult.reason));
        assert.equal(stored, null, 'a rejected put must have inserted nothing (no partial write)');
      }
      // Whichever way it linearized, a NEW insertion for that testId is refused from now on.
      await assert.rejects(store.put(await withRunId('later-run', 'positives')), TestDeletedError);
    }
  });

  // The reference store passes the three races trivially, because its whole check-and-insert runs
  // before its first `await` -- which is exactly the property under test. So the suite also proves
  // it can FAIL a store that does not have that property, the same way the keyset probe proves it
  // can fail an offset-paging store. Without this, the three races above would be unfalsifiable.
  test(`${label}: a store that awaits between check and insert is caught as non-conforming`, async () => {
    const racy = makeYieldingStore();
    const rivals = await Promise.all([
      withRunId('run-z', 'positives'), withRunId('run-z', 'completed-clean')]);
    const settled = await Promise.allSettled(rivals.map((s) => racy.put(s)));
    assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 2,
      'the double-write is the defect this probe must expose');
    await assert.rejects(async () => runLinearizabilityProbe(makeYieldingStore), /non-conforming/);
  });
}
