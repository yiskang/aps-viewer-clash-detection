// test/clashtest/results/readCoordinator.listenerFailure.test.mjs
//
// Owner ruling #9 (2026-09-25, adjudication finding M-1): the P7 façade accepts a structurally
// AbortSignal-compatible object (owner ruling #8), whose `addEventListener` / `removeEventListener`
// are only known to be functions. A listener call that THROWS must never corrupt the coordinator's
// waiter/slot bookkeeping:
//   - `removeEventListener` throws during the queued hand-off (`release()` -> `detach()`): the waiter
//     was already shifted out of the FIFO, so the failure must not lose it, leak the slot, or
//     reject the (unrelated) holder's `release()`. Cleanup failure is swallowed; the waiter is granted.
//   - `addEventListener` throws while registering: the call rejects fail-closed with a normal
//     rejection, and nothing was queued (no ghost waiter, no slot, no queue depth consumed).
// Genuine `AbortSignal` behaviour (already-aborted, abort-while-queued, FIFO, one-shot release,
// ReadCapacityError) is unchanged — pinned by readCoordinator.abort.test.mjs and residency.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadCoordinator } from '../../../clashtest/results/residency.js';
import { ReadAbortedError, ReadCapacityError } from '../../../clashtest/errors.js';

const ONE_READ = 1;
const QUEUE_DEPTH = 2;
const coordinator = () => createReadCoordinator({
  limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH },
});
const settledSoon = (p) => Promise.race([
  p.then(() => true, () => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 0)),
]);

/** A signal-like object with a controllable failing member. */
function faultySignal({ throwOnAdd = false, throwOnRemove = false } = {}) {
  const calls = { add: 0, remove: 0 };
  const listeners = [];
  const signal = {
    aborted: false,
    addEventListener(type, fn) {
      calls.add += 1;
      if (throwOnAdd) throw new Error('add-boom');
      listeners.push(fn);
    },
    removeEventListener() {
      calls.remove += 1;
      if (throwOnRemove) throw new Error('remove-boom');
    },
  };
  return { signal, calls, listeners };
}

test('a throwing removeEventListener during the queued hand-off: holder release does not throw, the waiter is granted, no slot leaks', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const { signal, calls } = faultySignal({ throwOnRemove: true });
  const queued = c.acquire({ signal });
  assert.equal(await settledSoon(queued), false, 'queued behind the held slot');

  assert.doesNotThrow(() => held.release(), 'the holder\'s release is not poisoned by the waiter\'s listener cleanup');
  assert.equal(calls.remove, 1, 'cleanup was attempted');
  const slot = await queued;                                  // granted, not lost
  assert.equal(c.inUse(), ONE_READ, 'the slot passed straight to the waiter');
  slot.release();
  assert.equal(c.inUse(), 0, 'no slot leaked');

  // Later reads make progress.
  const later = await c.acquire();
  assert.equal(c.inUse(), ONE_READ);
  later.release();
  assert.equal(c.inUse(), 0);
});

test('a throwing removeEventListener with a full queue: FIFO order kept, every waiter granted in turn', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const order = [];
  const { signal } = faultySignal({ throwOnRemove: true });
  const first = c.acquire({ signal }).then((s) => { order.push('first'); return s; });
  const second = c.acquire().then((s) => { order.push('second'); return s; });
  await assert.rejects(c.acquire(), ReadCapacityError, 'queue is full with two real waiters');
  held.release();
  (await first).release();
  (await second).release();
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(c.inUse(), 0);
  // The queue is empty again: a full depth of new waiters fits.
  const h2 = await c.acquire();
  const w1 = c.acquire(); const w2 = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError);
  h2.release(); (await w1).release(); (await w2).release();
  assert.equal(c.inUse(), 0);
});

test('a throwing removeEventListener does not consume the one-shot release of the slot handed on', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const { signal } = faultySignal({ throwOnRemove: true });
  const queued = c.acquire({ signal });
  held.release();
  held.release();                                             // one-shot: a second call is inert
  const slot = await queued;
  assert.equal(c.inUse(), ONE_READ);
  slot.release();
  slot.release();
  assert.equal(c.inUse(), 0);
});

test('a throwing addEventListener rejects fail-closed and queues nothing (no ghost waiter, no slot, no depth consumed)', async () => {
  const c = coordinator();
  const held = await c.acquire();
  const { signal, calls } = faultySignal({ throwOnAdd: true });
  const p = c.acquire({ signal });
  assert.ok(p instanceof Promise, 'a rejection, never a synchronous throw');
  await assert.rejects(p, (e) => e instanceof Error && e.message === 'add-boom');
  assert.equal(calls.add, 1);
  assert.equal(c.inUse(), ONE_READ, 'only the real holder holds a slot');
  // The failed attempt consumed no queue depth: QUEUE_DEPTH real waiters still fit.
  const q1 = c.acquire();
  const q2 = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError);
  held.release();
  (await q1).release();
  (await q2).release();
  assert.equal(c.inUse(), 0);
});

test('a throwing addEventListener when a slot is FREE is never invoked (granted straight away), and does not disturb later reads', async () => {
  const c = coordinator();
  const { signal, calls } = faultySignal({ throwOnAdd: true, throwOnRemove: true });
  const slot = await c.acquire({ signal });
  assert.equal(calls.add + calls.remove, 0, 'no listener traffic on the immediate path');
  slot.release();
  assert.equal(c.inUse(), 0);
});

test('an abort of a queued waiter whose removeEventListener throws still removes it and rejects ReadAbortedError', async () => {
  // Genuine abort path: the waiter leaves the FIFO in the abort handler (no detach is called there).
  const c = coordinator();
  const held = await c.acquire();
  const { signal, listeners } = faultySignal({ throwOnRemove: true });
  const queued = c.acquire({ signal });
  const settled = queued.then(() => 'granted', (e) => e);
  assert.equal(listeners.length, 1);
  listeners[0]({ type: 'abort' });
  assert.ok((await settled) instanceof ReadAbortedError);
  const q1 = c.acquire(); const q2 = c.acquire();
  await assert.rejects(c.acquire(), ReadCapacityError, 'the aborted waiter left the FIFO');
  held.release(); (await q1).release(); (await q2).release();
  assert.equal(c.inUse(), 0);
});
