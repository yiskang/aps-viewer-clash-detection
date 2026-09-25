// test/clashtest/results/readCoordinator.abort.test.mjs
//
// Owner ruling M3 / D-7 (2026-09-25, spec §25 A17): P5's read coordinator gains an ADDITIVE
// `acquire({signal})`, so a by-id read that is aborted while it waits in the FIFO is REMOVED from the
// queue (it stops counting against `maxQueuedStoreReads` and never receives a slot) and rejects
// `ReadAbortedError`. Everything else — FIFO order, one-shot release, `ReadCapacityError` for a
// non-aborted caller beyond the queue — is exactly the pre-ruling behaviour (residency.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadCoordinator } from '../../../clashtest/results/residency.js';
import { ReadAbortedError, ReadCapacityError } from '../../../clashtest/errors.js';

const ONE_READ = 1;
const QUEUE_DEPTH = 2;
const coordinator = () => createReadCoordinator({
  limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH },
});
/** Resolves true when `p` has settled by the next macrotask, false when it is still pending. */
const settledSoon = (p) => Promise.race([
  p.then(() => true, () => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 0)),
]);

test('acquire({signal}) with an already-aborted signal rejects ReadAbortedError and takes nothing', async () => {
  const c = coordinator();
  const ac = new AbortController();
  ac.abort();
  const p = c.acquire({ signal: ac.signal });
  assert.ok(p instanceof Promise, 'a rejection, never a synchronous throw');
  await assert.rejects(p, (e) => e instanceof ReadAbortedError && e.name === 'ReadAbortedError');
  assert.equal(c.inUse(), 0, 'no slot was taken');
  // Also when the slots are full: the abort wins over queueing, so no queue entry is made either.
  const held = await c.acquire();
  await assert.rejects(c.acquire({ signal: ac.signal }), ReadAbortedError);
  const q1 = c.acquire();
  const q2 = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError, 'the queue holds exactly QUEUE_DEPTH real waiters');
  held.release();
  (await q1).release();
  (await q2).release();
  assert.equal(c.inUse(), 0);
});

test('an abort while QUEUED removes the waiter: no ghost, the next caller is admitted, FIFO kept', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const order = [];
  const acB = new AbortController();
  const a = c.acquire().then((s) => { order.push('a'); return s; });
  const b = c.acquire({ signal: acB.signal });
  // The queue is full now (QUEUE_DEPTH = 2): a third caller would be refused.
  await assert.rejects(c.acquire(), ReadCapacityError);
  acB.abort();
  await assert.rejects(b, ReadAbortedError);
  // The aborted waiter no longer counts against the queue: the next caller queues, not refused.
  const d = c.acquire().then((s) => { order.push('d'); return s; });
  assert.equal(c.inUse(), ONE_READ, 'the aborted waiter never held a slot');
  held.release();                                           // hands the slot to `a`, never to `b`
  const sa = await a;
  assert.equal(await settledSoon(d), false, 'd waits behind a');
  sa.release();
  const sd = await d;
  assert.deepEqual(order, ['a', 'd'], 'FIFO order of the remaining waiters is preserved');
  sd.release();
  assert.equal(c.inUse(), 0, 'every slot came back');
});

test('aborting the HEAD waiter hands the next release to the waiter behind it', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const ac = new AbortController();
  const first = c.acquire({ signal: ac.signal });
  const second = c.acquire();
  ac.abort();
  await assert.rejects(first, ReadAbortedError);
  held.release();
  (await second).release();
  assert.equal(c.inUse(), 0);
});

test('an abort AFTER the grant is a no-op for acquire: the slot stays held until released', async () => {
  const c = coordinator();
  const ac = new AbortController();
  const slot = await c.acquire({ signal: ac.signal });      // immediate grant
  ac.abort();
  assert.equal(c.inUse(), ONE_READ);
  slot.release();
  assert.equal(c.inUse(), 0);

  const held = await c.acquire();
  const ac2 = new AbortController();
  const queued = c.acquire({ signal: ac2.signal });
  held.release();                                           // granted from the queue
  const got = await queued;
  ac2.abort();                                              // after the grant: nothing happens
  assert.equal(c.inUse(), ONE_READ);
  got.release();
  got.release();                                            // one-shot, unchanged
  assert.equal(c.inUse(), 0);
});

test('the abort listener is removed once a queued waiter is granted (no leak)', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const ac = new AbortController();
  let added = 0;
  let removed = 0;
  const { signal } = ac;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { added += 1; return add(...args); };
  signal.removeEventListener = (...args) => { removed += 1; return remove(...args); };
  const queued = c.acquire({ signal });
  assert.equal(added, 1, 'a queued waiter listens for the abort');
  held.release();
  (await queued).release();
  assert.equal(removed, 1, 'the grant removed that listener');
  // An immediate grant never registers one.
  const direct = await c.acquire({ signal });
  assert.equal(added, 1);
  direct.release();
});

test('acquire() with no argument or no signal behaves exactly as before', async () => {
  const c = coordinator();
  const a = await c.acquire();
  const b = c.acquire({});
  const d = c.acquire({ signal: undefined });
  await assert.rejects(c.acquire(), ReadCapacityError);
  a.release();
  (await b).release();
  (await d).release();
  assert.equal(c.inUse(), 0);
});
