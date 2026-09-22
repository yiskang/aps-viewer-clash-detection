// test/clashtest/results/residency.test.mjs
//
// Task P5.8. Verbatim from the plan's brief (docs/superpowers/plans/federated-clash-test-core/
// p5-result-set.md Task P5.8, Step 1), with ONE deliberate correction: the "throwing observer"
// test below was rewritten (codex-advisor, 2026-09-22, cross-checked against spec S13.5.1) because
// the brief's own literal Step 1 code was internally self-contradictory -- one test required
// `admitSealedSet` to invoke `onPersistence` (checking `thrown.length > 0` immediately after
// admission, before `beginPersist` is ever called) while another required it to invoke
// `onPersistence` zero times (`seen` must deepEqual a ONE-element array after admission +
// beginPersist together). Spec S13.5.1 settles this: "`done`, `persisted`, `getPersistenceState`
// and the `'persistence'` event observe only the settled outcome" of a persistence ATTEMPT, and
// admission is not an attempt (there is no attempt 0) -- so `admitSealedSet` must not notify at
// all, and the observer-isolation guarantee is exercised on the persistence-attempt path only
// (`beginPersist`/`retryPersist`, inside `attempt()`). The rewritten test checks exactly that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResidencyManager, createReadCoordinator } from '../../../clashtest/results/residency.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import {
  ResultCapacityError, ResultSetRetainedError, UnsavedResultSetError, ResultNotResidentError,
  ReadCapacityError, PersistenceOutcomeUnknownError, RunNotTerminalError, InvalidOptionsError,
} from '../../../clashtest/errors.js';
import { withRunId } from '../support/resultSetFixtures.mjs';

const mgr = (over = {}) => createResidencyManager({
  limits: { maxResidentResultSets: 2, maxQueuedRuns: 1, maxConcurrentStoreReads: 1, maxQueuedStoreReads: 2 },
  resultStore: createInMemoryResultStore(), now: () => Date.now(), onPersistence: () => {}, ...over });

test('slots count active runs plus resident sets and refuse rather than queue', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.reserveRunSlot('b');
  assert.throws(() => m.reserveRunSlot('c'), ResultCapacityError);
  const e = (() => { try { m.reserveRunSlot('c'); } catch (err) { return err; } })();
  assert.deepEqual(e.active, ['a', 'b']);
  assert.equal(e.cap, 2);
  m.admitSealedSet('a', await withRunId('a', 'positives'));           // sealing never needs a NEW slot
  assert.equal(m.retentionReport().slotsInUse, 2);
});

test('a saved set is evictable LRU; held and retained sets never are', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  assert.equal(m.getPersistenceState('a').state, 'saved');
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });                       // skipped ⇒ held
  m.reserveRunSlot('c');                                               // evicts 'a', the only evictable set
  assert.equal(m.getResident('a'), null);
  assert.equal(m.getPersistenceState('a'), null);                      // nonresident ⇒ null, never a throw
  assert.equal(m.getResident('b') !== null, true);
});

test('eviction is by last TOUCH, not by seal order: a touched older set survives', async () => {
  const clock = { t: 0, now() { return this.t; } };
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => clock.now(), onPersistence: () => {} });
  for (const id of ['old', 'new']) {
    clock.t += 10;
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });                 // both saved ⇒ both evictable
  }
  clock.t += 10;
  m.touch('old');                                                // 'old' sealed first but is used often
  m.reserveRunSlot('third');                                     // needs room for one
  assert.equal(m.getResident('old') !== null, true, 'the touched set survived');
  assert.equal(m.getResident('new'), null, 'the least recently touched one went');
});

test('a stopped clock still gives a total eviction order (sequence tie-break)', async () => {
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1, onPersistence: () => {} });  // time never moves
  for (const id of ['a', 'b']) {
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });
  }
  m.touch('a');
  m.reserveRunSlot('c');
  assert.equal(m.getResident('a') !== null, true);
  assert.equal(m.getResident('b'), null);
});

test('reporting never changes eviction order', async () => {
  const m = createResidencyManager({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1, onPersistence: () => {} });
  for (const id of ['a', 'b']) {
    m.reserveRunSlot(id);
    m.admitSealedSet(id, await withRunId(id, 'positives'));
    await m.beginPersist(id, { persist: true });
  }
  m.retentionReport(); m.getPersistenceState('a');               // must NOT pin 'a'
  m.reserveRunSlot('c');
  assert.equal(m.getResident('a'), null, "'a' was still the least recently touched");
});

test('retain/release/discard are the only ways a set leaves', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const lease = m.retainResultSet('a');
  assert.throws(() => m.releaseResultSet('a', {}), ResultSetRetainedError);
  lease.release();
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });
  assert.throws(() => m.releaseResultSet('b', {}), UnsavedResultSetError);
  m.releaseResultSet('b', { acknowledgeUnsaved: true });
  assert.equal(m.getResident('b'), null);
  m.releaseResultSet('b', { acknowledgeUnsaved: true });                // idempotent no-op
  assert.throws(() => m.retainResultSet('b'), ResultNotResidentError);
});

// NOTE (codex-advisor cross-check, 2026-09-22, in response to a codex-review finding that flagged
// this as a gap): settling `failed`/`ambiguous` IMMEDIATELY, with no reconciliation read, is the
// deliberate master-S1.2/G-REMOTE narrowing this phase was scoped to, not a defect -- the single
// reconciliation read, `reconcileTimeoutMs` and detached-remote disposal are an explicitly excluded,
// separately-gated follow-up package (docs/superpowers/plans/federated-clash-test-core/
// p5-result-set.md, "Narrowing recorded (per the brief, master S1.2)"). Do not "fix" this by adding
// reconciliation without a milestone-owner-authorized scope change.
test('an ambiguous store outcome settles failed/ambiguous and retryPersist is idempotent', async () => {
  const store = createInMemoryResultStore();
  const set = await withRunId('a', 'positives');
  let first = true;
  const flaky = { ...store, async put(s, o) { await store.put(s, o); if (first) { first = false; throw new PersistenceOutcomeUnknownError(); } } };
  const m = mgr({ resultStore: flaky });
  m.reserveRunSlot('a'); m.admitSealedSet('a', set);
  const outcome = await m.beginPersist('a', { persist: true });
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.error.ambiguous, true);
  assert.equal(m.getPersistenceState('a').state, 'failed');             // held: never auto-evicted
  const retry = await m.retryPersist('a');                              // the set already committed
  assert.equal(retry.state, 'saved');                                   // idempotent create-only put
  assert.equal(m.getPersistenceState('a').attempt, 2);
});

test('persistence state never changes the sealed set and is reported once per attempt', async () => {
  const seen = [];
  const m = mgr({ onPersistence: (e) => seen.push(e) });
  m.reserveRunSlot('a');
  const set = await withRunId('a', 'positives');
  m.admitSealedSet('a', set);
  await m.beginPersist('a', { persist: true });
  assert.deepEqual(seen.map((e) => [e.runId, e.state, e.attempt]), [['a', 'saved', 1]]);
  assert.equal(Object.isFrozen(m.getResident('a')), true);
  assert.equal('persistence' in m.getResident('a'), false);
});

// --- review Important 4: lease tokens are one-shot --------------------------------------------
test('a double release decrements once: the set stays retained and unevictable', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const clientA = m.retainResultSet('a');
  const clientB = m.retainResultSet('a');            // two INDEPENDENT leases on one set
  clientA.release();
  clientA.release();                                 // the naive counter would now read 0
  clientA.release();
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').leases, 1, 'exactly one decrement');
  assert.throws(() => m.releaseResultSet('a', {}), ResultSetRetainedError, "B's lease is still live");
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').class, 'retained');

  // The eviction path agrees: 'a' must NOT be the victim while B holds it. 'b' is deliberately
  // HELD (`persist: false`), because a SAVED 'b' would simply be evicted and prove nothing --
  // the refusal only exercises the retained set when NOTHING is evictable.
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: false });     // skipped ⇒ held ⇒ never auto-evictable
  assert.throws(() => m.reserveRunSlot('c'), ResultCapacityError, 'nothing evictable: refuse');
  assert.equal(m.getResident('a') !== null, true, 'the retained set survived');
  assert.equal(m.getResident('b') !== null, true, 'and the held set was never dropped');

  clientB.release();                                 // now, and only now, 'a' is evictable
  assert.equal(m.retentionReport().sets.find((s) => s.runId === 'a').class, 'evictable');
});

test('eviction between releases, and a release after explicit removal, are both safe', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  const lease = m.retainResultSet('a');
  lease.release();                                   // 'a' becomes evictable …
  m.reserveRunSlot('b'); m.admitSealedSet('b', await withRunId('b', 'positives'));
  await m.beginPersist('b', { persist: true });
  m.reserveRunSlot('c');                             // … and is evicted here
  assert.equal(m.getResident('a'), null);
  lease.release();                                   // a spent token on an evicted entry: no-op
  assert.equal(m.getResident('b') !== null, true, 'the surviving set is untouched');

  // A release after an EXPLICIT removal is equally inert, and cannot corrupt a re-admitted runId.
  const m2 = mgr();
  m2.reserveRunSlot('x'); m2.admitSealedSet('x', await withRunId('x', 'positives'));
  await m2.beginPersist('x', { persist: true });
  const stale = m2.retainResultSet('x');
  stale.release();
  m2.releaseResultSet('x', {});
  assert.equal(m2.getResident('x'), null);
  m2.reserveRunSlot('x'); m2.admitSealedSet('x', await withRunId('x', 'positives'));
  await m2.beginPersist('x', { persist: true });
  stale.release();                                   // the OLD token, against a NEW entry
  assert.equal(m2.retentionReport().sets.find((s) => s.runId === 'x').class, 'evictable',
    'the stale token did not drive the new entry negative');
  const fresh = m2.retainResultSet('x');
  assert.equal(m2.retentionReport().sets.find((s) => s.runId === 'x').class, 'retained');
  fresh.release();
});

// --- P6 re-verification finding 8 (P5-owned): admitSealedSet is atomic and exception-safe -------
test('admitSealedSet either converts the reservation fully or changes nothing', async () => {
  const set = await withRunId('a', 'positives');

  // (1) failure BEFORE any mutation — no reservation at all.
  const m1 = mgr();
  assert.throws(() => m1.admitSealedSet('a', set), ResultNotResidentError);
  assert.equal(m1.reservationHeld('a'), false);
  assert.equal(m1.getResident('a'), null);
  assert.equal(m1.retentionReport().slotsInUse, 0, 'no slot was consumed by the failure');

  // (2) failure before mutation WITH a reservation held — the reservation must survive intact.
  const m2 = mgr();
  m2.reserveRunSlot('a');
  assert.equal(m2.reservationHeld('a'), true);
  for (const bad of [null, undefined, {}, { sealed: false }, 'set']) {
    assert.throws(() => m2.admitSealedSet('a', bad),
      (e) => e instanceof TypeError && e.code === 'ERR_RESULT_SET_NOT_SEALED', String(bad));
    assert.equal(m2.reservationHeld('a'), true, `${String(bad)}: reservation still held`);
    assert.equal(m2.getResident('a'), null);
    assert.equal(m2.retentionReport().slotsInUse, 1, 'exactly one slot, still the reservation');
  }
  m2.admitSealedSet('a', set);                       // and it still works afterwards
  assert.equal(m2.reservationHeld('a'), false, 'converted: no longer a reservation');
  assert.equal(m2.getResident('a') !== null, true);
  assert.equal(m2.retentionReport().slotsInUse, 1, 'the slot was CONVERTED, never doubled');

  // (3) failure AFTER the internal mutation is impossible by construction — a second admission of
  // an already-resident id is refused in the validation phase and leaves the resident entry alone.
  assert.throws(() => m2.admitSealedSet('a', set), ResultNotResidentError);
  assert.equal(m2.getResident('a') !== null, true, 'the resident entry is untouched');
  assert.equal(m2.retentionReport().slotsInUse, 1);
});

// NOTE (codex-advisor, 2026-09-22): rewritten from the brief's literal draft. The brief's own draft
// checked `thrown.length > 0` immediately after `admitSealedSet` -- which only holds if admission
// itself calls `onPersistence`. Spec S13.5.1 is explicit that `done`/`persisted`/
// `getPersistenceState`/the `'persistence'` event observe only a SETTLED persistence ATTEMPT, and
// admission is not an attempt, so `admitSealedSet` must not notify at all (see residency.js). The
// observer-isolation guarantee is therefore exercised here on the actual persistence-attempt path.
test('a throwing observer never turns a completed persistence attempt into a failure', async () => {
  const thrown = [];
  const m = createResidencyManager({
    limits: { maxResidentResultSets: 2, maxQueuedRuns: 1 },
    resultStore: createInMemoryResultStore(), now: () => 1,
    onPersistence: (e) => { thrown.push(e); throw new Error('observer exploded'); },
  });
  m.reserveRunSlot('a');
  m.admitSealedSet('a', await withRunId('a', 'positives'));   // must NOT throw
  assert.equal(m.getResident('a') !== null, true, 'the set is resident');
  assert.equal(m.reservationHeld('a'), false, 'and the reservation was converted');
  assert.equal(thrown.length, 0, 'admission is not a persistence attempt: no observer call yet');

  // The isolation on the persistence path: the attempt still settles and is still reported, even
  // though the observer throws.
  const outcome = await m.beginPersist('a', { persist: true });   // must NOT reject
  assert.equal(outcome.state, 'saved');
  assert.equal(m.getPersistenceState('a').state, 'saved');
  assert.ok(thrown.length > 0, 'the observer really did run and really did throw');
});

test('reservationHeld answers P6 recovery without guessing, and never throws', async () => {
  const m = mgr();
  assert.equal(m.reservationHeld('unknown'), false);
  m.reserveRunSlot('a');
  assert.equal(m.reservationHeld('a'), true);
  m.releaseRunSlot('a');
  assert.equal(m.reservationHeld('a'), false, 'released ⇒ false');
  m.reserveRunSlot('b');
  m.admitSealedSet('b', await withRunId('b', 'positives'));
  assert.equal(m.reservationHeld('b'), false, 'resident ⇒ false, not a reservation any more');
});

test('read slots: raw-set reservations reject immediately, by-id reads queue FIFO', async () => {
  const c = createReadCoordinator({ limits: { maxConcurrentStoreReads: 1, maxQueuedStoreReads: 1 } });
  const held = c.reserveSync();
  assert.throws(() => c.reserveSync(), ReadCapacityError);
  const queued = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError);                 // queue depth 1 exceeded
  held.release();
  (await queued).release();
  assert.equal(c.inUse(), 0);
});

// =================================================================================================
// The tests below are NOT in the plan's brief (its literal Step 1 covers 14; this file has 14 plus
// these). `discardRun` and `drainForDispose` are named, load-bearing members of the
// `ResidencyManager` surface (consumed by P6/P7 and by spec AC-16) with zero coverage in the
// brief's own test list, and this module is explicitly safety-critical (resident-slot accounting,
// the persistence attempt state machine). Added as part of self-review, not requested by the brief.
// =================================================================================================

test('beginPersist and retryPersist reject ResultNotResidentError for a nonresident id', async () => {
  const m = mgr();
  await assert.rejects(m.beginPersist('ghost', { persist: true }), ResultNotResidentError);
  await assert.rejects(m.retryPersist('ghost'), ResultNotResidentError);
});

test('retryPersist rejects InvalidOptionsError when the resident set is not failed', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });               // settles 'saved', not 'failed'
  await assert.rejects(m.retryPersist('a'), InvalidOptionsError);
});

test('discardRun rejects for a non-terminal (active-only) run, and is the terminal removal path otherwise', async () => {
  const store = createInMemoryResultStore();
  const m = mgr({ resultStore: store });

  m.reserveRunSlot('a');
  await assert.rejects(m.discardRun('a'), RunNotTerminalError, 'a bare reservation is not terminal');

  // A nonresident/unknown id still issues the store delete (S13.5.2 nonresident-id rules) and is
  // otherwise a no-op -- it never throws or rejects for "never heard of this id".
  await store.put(await withRunId('ghost', 'positives'));
  assert.notEqual(await store.get('ghost'), null);
  await m.discardRun('ghost');
  assert.equal(await store.get('ghost'), null);

  // A resident, saved set: discardRun removes both the resident copy and the durable one.
  m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: true });
  assert.notEqual(await store.get('a'), null);
  await m.discardRun('a');
  assert.equal(m.getResident('a'), null);
  assert.equal(await store.get('a'), null);
});

test('discardRun awaits an in-flight write and raises its abort signal, never abandoning it', async () => {
  let resolvePut;
  let aborted = false;
  const store = {
    async put(_s, { signal } = {}) {
      signal?.addEventListener('abort', () => { aborted = true; });
      await new Promise((resolve) => { resolvePut = resolve; });
    },
    async delete() {},
  };
  const m = mgr({ resultStore: store });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  const persisting = m.beginPersist('a', { persist: true });     // suspended inside `put`
  const discarding = m.discardRun('a');                          // must not free the slot yet
  assert.equal(aborted, true, 'discardRun raised the abort signal for a cooperating store');
  assert.equal(m.getResident('a') !== null, true, 'the slot is held until the write settles');
  resolvePut();
  await persisting;
  await discarding;
  assert.equal(m.getResident('a'), null, 'freed only once the write actually settled');
});

// --- codex-review findings, 2026-09-22 (pending-write lifecycle races) -------------------------
test('an acknowledged release during an unresolved write keeps the slot until the write settles', async () => {
  let resolvePut;
  const store = {
    async put() { await new Promise((resolve) => { resolvePut = resolve; }); },
    async delete() {},
  };
  const m = createResidencyManager({
    limits: { maxResidentResultSets: 1, maxQueuedRuns: 0, maxConcurrentStoreReads: 1, maxQueuedStoreReads: 1 },
    resultStore: store, now: () => Date.now(), onPersistence: () => {},
  });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  const persisting = m.beginPersist('a', { persist: true });         // never settles until resolvePut()
  m.releaseResultSet('a', { acknowledgeUnsaved: true });             // acknowledged, but still in flight
  assert.equal(m.retentionReport().slotsInUse, 1, 'the slot is still occupied: the write has not settled');
  assert.throws(() => m.reserveRunSlot('b'), ResultCapacityError, 'the hard cap of 1 is not silently exceeded');
  resolvePut();
  await persisting;
  assert.equal(m.retentionReport().slotsInUse, 0, 'freed only once the write actually settled');
  m.reserveRunSlot('b');                                             // now succeeds
});

test('a re-entrant observer that swaps in a new entry for the same runId survives the deferred-release cleanup', async () => {
  // codex-advisor follow-up finding, 2026-09-22: the first version of the Fix-1 deferred-release
  // (`removeOnSettle`) deleted by `runId` alone once the write settled. `notify()` runs arbitrary
  // observer code synchronously BEFORE that deletion, and that code can itself evict the
  // now-`saved`-and-evictable old entry and admit a brand-new one for the SAME `runId` -- the old
  // attempt's unconditional `resident.delete(runId)` would then delete the wrong (new) entry.
  const newSet = await withRunId('a', 'positives');           // pre-built: the observer must act SYNCHRONOUSLY
  let resolvePut;
  const store = {
    async put() { await new Promise((resolve) => { resolvePut = resolve; }); },
    async delete() {},
  };
  let reentered = false;
  const m = createResidencyManager({
    limits: { maxResidentResultSets: 1, maxQueuedRuns: 0, maxConcurrentStoreReads: 1, maxQueuedStoreReads: 1 },
    resultStore: store, now: () => Date.now(),
    onPersistence: (e) => {
      if (e.runId === 'a' && e.state === 'saved' && !reentered) {
        reentered = true;
        m.reserveRunSlot('a');            // evicts the settling (now-evictable) old entry -- cap is 1
        m.admitSealedSet('a', newSet);    // installs a brand-new entry for the SAME runId
      }
    },
  });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  const persisting = m.beginPersist('a', { persist: true });   // suspended inside `put`
  m.releaseResultSet('a', { acknowledgeUnsaved: true });       // marks removeOnSettle while still in flight
  resolvePut();
  await persisting;
  assert.equal(reentered, true, 'the observer really did re-enter and swap the entry');
  assert.equal(m.getResident('a'), newSet,
    'the NEW entry installed during settlement must survive the old attempt\'s deferred cleanup');
});

test('beginPersist refuses a concurrent second call for the same run', async () => {
  let resolvePut;
  const store = {
    async put() { await new Promise((resolve) => { resolvePut = resolve; }); },
    async delete() {},
  };
  const m = mgr({ resultStore: store });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  const first = m.beginPersist('a', { persist: true });
  await assert.rejects(m.beginPersist('a', { persist: true }), InvalidOptionsError,
    'a second concurrent attempt on the same run is refused, never silently overlapped');
  resolvePut();
  await first;
});

test('beginPersist refuses a second call after the first already settled', async () => {
  const m = mgr();
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  await m.beginPersist('a', { persist: false });                    // settles 'skipped'
  await assert.rejects(m.beginPersist('a', { persist: true }), InvalidOptionsError);
});

test('a non-Error store rejection still settles failed, never leaving the attempt unsettled', async () => {
  const store = { async put() { return Promise.reject(null); }, async delete() {} };
  const m = mgr({ resultStore: store });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  const outcome = await m.beginPersist('a', { persist: true });      // must NOT reject
  assert.equal(outcome.state, 'failed');
  assert.equal(m.getPersistenceState('a').state, 'failed');
});

test('drainForDispose aborts an in-flight write, letting a cooperating store settle promptly', async () => {
  let signalSeen;
  const store = {
    async put(_s, { signal } = {}) { signalSeen = signal; await new Promise(() => {}); },  // never settles on its own
    async delete() {},
  };
  const m = mgr({ resultStore: store });
  m.reserveRunSlot('a'); m.admitSealedSet('a', await withRunId('a', 'positives'));
  m.beginPersist('a', { persist: true });                           // fire-and-forget: never settles
  const { persistenceInFlight } = m.drainForDispose();
  assert.deepEqual(persistenceInFlight, ['a']);
  assert.equal(signalSeen.aborted, true, 'drainForDispose raised the abort signal for the cooperating store');
});

test('drainForDispose reports unsaved sets, leaves an in-flight write alone, and clears residency', async () => {
  let resolveInflight;
  const store = {
    async put(s) {
      if (s.runId === 'inflight') { await new Promise((resolve) => { resolveInflight = resolve; }); }
    },
    async delete() {},
  };
  const m = createResidencyManager({
    limits: { maxResidentResultSets: 3, maxQueuedRuns: 2, maxConcurrentStoreReads: 1, maxQueuedStoreReads: 2 },
    resultStore: store, now: () => Date.now(), onPersistence: () => {},
  });

  m.reserveRunSlot('saved'); m.admitSealedSet('saved', await withRunId('saved', 'positives'));
  await m.beginPersist('saved', { persist: true });

  m.reserveRunSlot('held'); m.admitSealedSet('held', await withRunId('held', 'positives'));
  await m.beginPersist('held', { persist: false });

  m.reserveRunSlot('inflight'); m.admitSealedSet('inflight', await withRunId('inflight', 'positives'));
  const persisting = m.beginPersist('inflight', { persist: true });   // never settles until resolveInflight()

  const { droppedUnsaved, persistenceInFlight } = m.drainForDispose();
  assert.deepEqual(persistenceInFlight, ['inflight']);
  assert.deepEqual(droppedUnsaved.map((d) => d.runId), ['held']);
  assert.equal(droppedUnsaved[0].resultSet.runId, 'held');
  assert.equal(m.getResident('saved'), null, 'a saved set is not "unsaved" -- drain still forgets it, but never reports it');
  assert.equal(m.retentionReport().slotsInUse, 0, 'drain clears residency bookkeeping entirely');

  resolveInflight();
  await persisting;                 // let the detached write settle so nothing is left dangling
});
