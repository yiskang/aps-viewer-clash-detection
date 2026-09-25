// test/clashtest/results/InMemoryResultStore.test.mjs
//
// Task P5.7: `InMemoryResultStore` (the reference `ResultStore` port implementation) plus the
// shared conformance suite every host store must pass (`runResultStoreConformance`, in
// `test/clashtest/support/resultStoreConformance.mjs`).
//
// Wiring note (codex-advisor consultation, 2026-09-22): the task brief's own two illustrative code
// blocks disagreed on how the conformance suite's "a page with any invalid entry is rejected
// whole" case reaches the store under test -- the brief's literal `runResultStoreConformance(() =>
// createInMemoryResultStore(), {label})` wiring takes no options, while the suite excerpt called
// `makeStore({ corruptPage: true })`. Resolved (see the advisor's alternatives, all consistent with
// spec S13.5 "listings are untrusted data too"): `put()` is NOT the full-schema validation boundary
// (only `readResultSet`'s `validateResultSet` is, and it runs solely at the untrusted-READ path),
// so a resultSet whose `provenance.models` carries the SAME modelKey twice (at the SAME version, so
// `put`'s identity-conflict check -- which only rejects a modelKey claimed at a DIFFERENT version --
// never fires) is accepted by the ORDINARY public `put()` and only caught by
// `validateResultSetSummary`'s `duplicate-model-key` rule at `list()` time. No test-only
// constructor option is needed on the production store; the conformance suite instead takes an
// explicit `corruptListing(store)` fixture callback supplied by the CALLER (store-specific, since
// "how do I get a store to hold something list() must reject" is not something the port can answer
// in general), which is exactly what is passed below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { runResultStoreConformance } from '../support/resultStoreConformance.mjs';
import { ResultSetTooLargeError, RunIdConflictError, IdentityConflictError, TestDeletedError, InvalidOptionsError } from '../../../clashtest/errors.js';
import { sealedSet, withRunId, withModels } from '../support/resultSetFixtures.mjs';

runResultStoreConformance(() => createInMemoryResultStore(), {
  label: 'InMemoryResultStore',
  corruptListing: async (store) => {
    // A duplicate modelKey (SAME version -> no IdentityConflictError) that `put()` has no reason to
    // reject, but whose derived summary is invalid the moment `list()` re-validates it.
    const bad = structuredClone(await sealedSet('positives'));
    bad.provenance.models.push({ ...bad.provenance.models[0] });
    await store.put(bad);
  },
});

test('put is create-only: identical content is idempotent, different content conflicts', async () => {
  const store = createInMemoryResultStore();
  const set = await sealedSet('positives');
  await store.put(set);
  await store.put(structuredClone(set));                                   // idempotent
  await assert.rejects(store.put(await withRunId(set.runId, 'completed-with-gaps')), RunIdConflictError);
  assert.equal((await store.get(set.runId)).outcome.coverage, set.outcome.coverage);
});

test('the identity index is atomic across runIds and survives delete', async () => {
  const store = createInMemoryResultStore();
  const a = await withModels([['M1', 'v1'], ['M2', 'v1']], 'positives');
  const b = await withModels([['M2', 'v2'], ['M3', 'v1']], 'positives');
  await store.put(a);
  await assert.rejects(store.put(b), IdentityConflictError);
  assert.equal(await store.get(b.runId), null);                            // nothing inserted
  await store.put(await withModels([['M3', 'v1']], 'positives'));          // M3 was never claimed by the failed put
  await store.delete(a.runId);
  await assert.rejects(store.put(await withModels([['M1', 'v9']], 'positives')), IdentityConflictError);
});

test('tombstoneTest blocks new inserts, is idempotent and survives delete', async () => {
  const store = createInMemoryResultStore();
  const first = await sealedSet('positives');
  await store.put(first);
  await store.tombstoneTest(first.testRef.testId);
  await store.tombstoneTest(first.testRef.testId);
  assert.equal(await store.isTombstoned(first.testRef.testId), true);
  await assert.rejects(store.put(await withRunId('run-new', 'positives')), TestDeletedError);
  await store.put(structuredClone(first));                                 // identical re-put still succeeds
  assert.ok(await store.get(first.runId));
  await store.delete(first.runId);
  assert.equal(await store.isTombstoned(first.testRef.testId), true);
});

test('get refuses an oversized set before any object graph exists', async () => {
  const store = createInMemoryResultStore();
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

test('put and get copy in both directions, and the LISTING agrees with get (review Important 3)', async () => {
  const store = createInMemoryResultStore();
  const set = structuredClone(await sealedSet('positives'));
  await store.put(set);

  const before = { get: await store.get(set.runId), list: (await store.list({})).summaries[0] };

  // Mutate every nested field the summary is built from -- the exact reference leak the review
  // found: `testRef` and `digests` were retained by reference, so `list()` would follow the
  // caller's mutation while `get()` kept the stored content.
  set.outcome.coverage = 'full';
  set.testRef.testId = 'HIJACKED';
  set.digests.ledgerDigest = `sha256:${'f'.repeat(64)}`;
  set.provenance.models[0].modelVersion = 'v999';
  set.provenance.models.push({ ...set.provenance.models[0], modelKey: 'INJECTED' });
  set.provenance.startedAt = '1999-01-01T00:00:00.000Z';
  set.provenance.finishedAt = '1999-01-01T00:00:01.000Z';
  set.ledger.pairSpaceTotal = 99_999;
  set.results.push({ resultId: 'injected', flags: {} });

  const afterGet = await store.get(set.runId);
  const afterList = (await store.list({})).summaries[0];
  assert.deepEqual(afterGet, before.get, 'get must not follow the caller');
  assert.deepEqual(afterList, before.list, 'and list must not either');
  assert.equal(afterList.testRef.testId, before.get.testRef.testId, 'the two views agree');
  assert.equal(afterList.digests.ledgerDigest, afterGet.digests.ledgerDigest);
  assert.equal(afterList.counts.results, afterGet.results.length);
  assert.equal(afterList.models.length, afterGet.provenance.models.length);

  // ...and mutating what the store HANDS BACK changes nothing either, in both directions.
  afterGet.outcome.coverage = 'full';
  afterGet.testRef.testId = 'HIJACKED';
  afterList.digests.ledgerDigest = `sha256:${'0'.repeat(64)}`;
  afterList.models.push({ modelKey: 'X', modelVersion: 'v1' });
  assert.deepEqual(await store.get(set.runId), before.get);
  assert.deepEqual((await store.list({})).summaries[0], before.list);
});

test('a throw while building the summary (malformed set) claims no identity and stores nothing', async () => {
  // codex-review finding (2026-09-22, Important, confirmed): the summary was originally built
  // AFTER the identity claims were committed, so a set whose shape breaks `summarize()` (here: no
  // `outcome` at all -- `canonicalJson` tolerates a merely ABSENT key, but `summarize()` reads
  // `resultSet.outcome.status` unconditionally) rejected `put()` while leaving its model keys
  // permanently claimed, poisoning every later legitimate write that reuses one of them.
  const store = createInMemoryResultStore();
  const bad = structuredClone(await sealedSet('positives'));
  const { modelKey } = bad.provenance.models[0];
  delete bad.outcome;
  await assert.rejects(store.put(bad));
  assert.equal(await store.get(bad.runId), null);
  // the model key `bad` would have claimed must remain UNCLAIMED: a later set can take it at ANY version.
  await store.put(await withModels([[modelKey, 'totally-different-version']], 'positives'));
});

test('conflicting versions of the SAME modelKey within one set are rejected, claiming nothing', async () => {
  // codex-review finding (2026-09-22, Important, confirmed): the conflict pass only compared each
  // incoming model against the GLOBAL index, never against an EARLIER row of the same incoming
  // set, so `[[M, 'vA'], [M, 'vB']]` passed both individual checks (M unclaimed either time) and
  // the second claim silently overwrote the first.
  const store = createInMemoryResultStore();
  const bad = await withModels([['M', 'vA'], ['M', 'vB']], 'positives');
  await assert.rejects(store.put(bad), IdentityConflictError);
  assert.equal(await store.get(bad.runId), null);
  await store.put(await withModels([['M', 'vA']], 'positives'));   // M was never actually claimed
});

test('list rejects bad options', async () => {
  const store = createInMemoryResultStore();
  for (const bad of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { cursor: 'nope' }, { cursor: 'v9:x' }, { unknown: 1 }]) {
    await assert.rejects(store.list(bad), InvalidOptionsError);
  }
});
