// test/clashtest/stores/InMemoryClashTestStore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { normalizeDefinition, deepFreezeDefinition } from '../../../clashtest/definition/normalize.js';
import { makeDefinition } from '../support/definitions.mjs';

const def = (o) => deepFreezeDefinition(normalizeDefinition(captureAndValidate(makeDefinition(o)).captured));
const rejects = (p, name) => assert.rejects(p, (e) => e.name === name);

test('put accepts revision 1 for a new test, then latest + 1', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.put(def({ revision: 2 }));
  assert.equal((await s.get('T1')).revision, 2);
  assert.equal((await s.get('T1', 1)).revision, 1);
  assert.equal(await s.get('T1', 9), null);
});

test('put rejects duplicates, gaps and out-of-order saves without overwriting', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1, name: 'first' }));
  for (const bad of [1, 3]) {   // duplicate, then a gap (an out-of-order save is the same refusal)
    await assert.rejects(s.put(def({ revision: bad, name: 'second' })), (e) => {
      assert.equal(e.name, 'RevisionConflictError');
      assert.equal(e.testId, 'T1'); assert.equal(e.latest, 1);
      return true;
    });
  }
  assert.equal((await s.get('T1')).name, 'first');
  assert.equal((await s.get('T1')).revision, 1);
});

test('a first put with revision != 1 is a RevisionConflictError with latest null', async () => {
  const s = createInMemoryClashTestStore();
  await assert.rejects(s.put(def({ revision: 2 })), (e) => e.name === 'RevisionConflictError' && e.latest === null && e.offered === 2);
  assert.equal(await s.get('T1'), null);
});

test('archive is one-way, covers all revisions, and blocks new revisions', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.put(def({ revision: 2 }));
  await s.archive('T1');
  await s.archive('T1');                                    // idempotent
  assert.equal((await s.get('T1')).revision, 2);            // still readable, latest returned
  assert.equal((await s.get('T1', 1)).revision, 1);
  await rejects(s.put(def({ revision: 3 })), 'TestArchivedError');
  await rejects(s.put(def({ revision: 1 })), 'TestArchivedError');   // archive outranks revision
  assert.equal(await s.isTombstoned('T1'), false);
});

test('delete tombstones the testId permanently', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  await s.delete('T1');
  await s.delete('T1');                                     // idempotent
  assert.equal(await s.isTombstoned('T1'), true);
  assert.equal(await s.get('T1'), null);
  assert.equal(await s.get('T1', 1), null);
  await rejects(s.put(def({ revision: 1 })), 'TestDeletedError');   // recreate at revision 1 refused
  await rejects(s.put(def({ revision: 2 })), 'TestDeletedError');
  const page = await s.list();
  assert.equal(page.summaries.length, 0);                   // a tombstoned id is not listed
});

test('a never-seen id is not tombstoned; deleting it still tombstones it', async () => {
  const s = createInMemoryClashTestStore();
  assert.equal(await s.isTombstoned('ghost'), false);
  await s.delete('ghost');
  assert.equal(await s.isTombstoned('ghost'), true);
  await rejects(s.put(def({ testId: 'ghost', revision: 1 })), 'TestDeletedError');
});

test('operations are linearizable per testId under interleaving', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  // Fire without awaiting between them: each must take effect at one point, in issue order.
  const results = await Promise.allSettled([
    s.put(def({ revision: 2 })),
    s.archive('T1'),
    s.put(def({ revision: 3 })),
    s.resolveForRun('T1'),
    s.delete('T1'),
    s.put(def({ revision: 1 })),
    s.isTombstoned('T1'),
  ]);
  assert.equal(results[0].status, 'fulfilled');                       // put r2 before archive
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].reason.name, 'TestArchivedError');          // put r3 after archive
  assert.equal(results[3].value.status, 'archived');                  // revision AND state from one point
  assert.equal(results[3].value.latestRevision, 2);
  assert.equal(results[3].value.definition.revision, 2);
  assert.equal(results[4].status, 'fulfilled');
  assert.equal(results[5].reason.name, 'TestDeletedError');           // put after delete
  assert.equal(results[6].value, true);
});

test('a delete racing a put never leaves neither the live test nor the tombstone', async () => {
  const s = createInMemoryClashTestStore();
  await s.put(def({ revision: 1 }));
  const observations = [];
  const deleting = s.delete('T1').then(() => observations.push('deleted'));
  const putting = s.put(def({ revision: 2 })).then(
    () => observations.push('put-ok'),
    (e) => observations.push(`put-${e.name}`),
  );
  await Promise.all([deleting, putting]);
  assert.deepEqual(observations.sort(), ['deleted', 'put-TestDeletedError'].sort());
  assert.equal(await s.isTombstoned('T1'), true);
  assert.equal(await s.get('T1'), null);
});

test('the store hands back frozen definitions', async () => {
  const s = createInMemoryClashTestStore();
  const saved = def({ revision: 1 });
  await s.put(saved);
  const got = await s.get('T1');
  assert.ok(Object.isFrozen(got));
  assert.throws(() => { got.name = 'x'; }, TypeError);
});
