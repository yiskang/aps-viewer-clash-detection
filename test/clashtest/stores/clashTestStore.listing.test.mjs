// test/clashtest/stores/clashTestStore.listing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { validateTestSummaryPage, captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, deepFreezeDefinition } from '../../../clashtest/definition/normalize.js';
import { makeDefinition } from '../support/definitions.mjs';

const def = (o) => deepFreezeDefinition(normalizeDefinition(captureAndValidate(makeDefinition(o)).captured));

async function seed(ids) {
  const s = createInMemoryClashTestStore();
  for (const testId of ids) await s.put(def({ testId, name: `n-${testId}` }));
  return s;
}

test('list returns closed TestSummary rows in ascending testId code-unit order', async () => {
  const s = await seed(['b', 'A', 'a', 'B']);
  const { summaries, next } = await s.list();
  assert.equal(next, undefined);
  assert.deepEqual(summaries.map((x) => x.testId), ['A', 'B', 'a', 'b']);
  assert.deepEqual(Object.keys(summaries[0]).sort(), ['archived', 'latestRevision', 'name', 'testId']);
  assert.deepEqual(summaries[0], { testId: 'A', latestRevision: 1, archived: false, name: 'n-A' });
});

test('latestRevision and archived track the store state', async () => {
  const s = await seed(['t']);
  await s.put(def({ testId: 't', revision: 2, name: 'n2' }));
  await s.archive('t');
  assert.deepEqual((await s.list()).summaries, [{ testId: 't', latestRevision: 2, archived: true, name: 'n2' }]);
});

test('paging is keyset: every row appears exactly once across inserts and deletes', async () => {
  const s = await seed(['a', 'b', 'c', 'd', 'e']);
  const seen = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const r = await s.list({ limit: 2, cursor });
    seen.push(...r.summaries.map((x) => x.testId));
    if (page === 0) { await s.put(def({ testId: 'a0' })); await s.delete('e'); }  // interleaved mutation
    cursor = r.next;
    if (!cursor) break;
  }
  assert.deepEqual(seen.filter((id) => ['b', 'c', 'd'].includes(id)).sort(), ['b', 'c', 'd']);
  assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  assert.equal(seen.includes('a0'), false, 'a key before the cursor is never revisited');
});

test('limit is bounded and the cursor is opaque and versioned', async () => {
  const s = await seed(['a', 'b']);
  for (const limit of [0, 1001, 1.5, -1, '10', NaN, Infinity]) {
    await assert.rejects(s.list({ limit }), (e) => e.name === 'InvalidOptionsError');
  }
  for (const cursor of ['a', 'v2:a', 7, {}, 'v1:%zz']) {
    await assert.rejects(s.list({ cursor }), (e) => {
      assert.equal(e.name, 'InvalidOptionsError');
      assert.equal(e.reason, 'bad-cursor');            // P0: InvalidOptionsError carries `reason` for a bad cursor
      assert.equal(e.issues[0].code, 'bad-cursor');
      return true;
    });
  }
  const first = await s.list({ limit: 1 });
  assert.equal(typeof first.next, 'string');
  assert.ok(first.next.startsWith('v1:'));
  assert.deepEqual((await s.list({ limit: 1, cursor: first.next })).summaries.map((x) => x.testId), ['b']);
  await assert.rejects(s.list({ unknownKey: 1 }), (e) => e.name === 'InvalidOptionsError');
});

test('resolveForRun returns each of the four statuses', async () => {
  const s = await seed(['live', 'arch']);
  await s.archive('arch');
  await s.delete('gone');
  assert.deepEqual(await s.resolveForRun('nope'), { status: 'missing', definition: null, latestRevision: null });
  assert.deepEqual(await s.resolveForRun('gone'), { status: 'deleted', definition: null, latestRevision: null });
  const live = await s.resolveForRun('live');
  assert.equal(live.status, 'live'); assert.equal(live.latestRevision, 1); assert.equal(live.definition.testId, 'live');
  const arch = await s.resolveForRun('arch');
  assert.equal(arch.status, 'archived'); assert.ok(arch.definition);
  assert.deepEqual(await s.resolveForRun('live', 9), { status: 'missing', definition: null, latestRevision: null });
});

test('validateTestSummaryPage accepts a conforming page and rejects every deviation', () => {
  const ok = { summaries: [{ testId: 't', latestRevision: 1, archived: false, name: 'n' }], next: 'v1:t' };
  assert.deepEqual(validateTestSummaryPage(ok).issues, []);
  assert.deepEqual(validateTestSummaryPage(ok), { issues: [], issuesTruncated: false });
  const bad = [
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: false, name: 'n', extra: 1 }] }, '/summaries/0/extra:unknown-property'],
    [{ summaries: [{ testId: 't', latestRevision: 0, archived: false, name: 'n' }] }, '/summaries/0/latestRevision:out-of-range'],
    [{ summaries: [{ testId: '', latestRevision: 1, archived: false, name: 'n' }] }, '/summaries/0/testId:string-too-short'],
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: 'no', name: 'n' }] }, '/summaries/0/archived:invalid-enum'],
    [{ summaries: [{ testId: 't', latestRevision: 1, archived: false }] }, '/summaries/0/name:missing-required'],
    [{ summaries: {} }, '/summaries:not-an-array'],
    [{ summaries: [], next: 7 }, '/next:not-a-string'],
    [{ summaries: [], other: 1 }, '/other:unknown-property'],
    [null, '/:not-an-object'],
    [{ summaries: [undefined] }, '/summaries/0:not-plain-object'],            // structural, from captureData
  ];
  for (const [page, expected] of bad) {
    const r = validateTestSummaryPage(page);
    assert.deepEqual(r.issues.map((i) => `${i.path}:${i.code}`), [expected], JSON.stringify(page));
    assert.equal(r.issues[0].message, '');       // {path, code} only, no values
  }
});

test('validateTestSummaryPage caps at 20 issues', () => {
  const summaries = Array.from({ length: 40 }, () => ({ testId: 't', latestRevision: 1, archived: false }));
  const r = validateTestSummaryPage({ summaries });
  assert.equal(r.issues.length, 20);
  assert.equal(r.issuesTruncated, true);
});
