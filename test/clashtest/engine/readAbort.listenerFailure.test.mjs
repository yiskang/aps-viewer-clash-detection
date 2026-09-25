// test/clashtest/engine/readAbort.listenerFailure.test.mjs
//
// Owner ruling #9 (2026-09-25, adjudication finding M-1): the façade's structural AbortSignal check
// (owner ruling #8) only proves `addEventListener` / `removeEventListener` are callable, so a
// signal-like object whose listener methods THROW passes both public validation sites
// (`readReadOptions`: getResultSet / getFreshness / canClaimNoClashes / assessNoClashClaim /
// listTests / listResults; `readRerunOptions`: rerun). It must fail closed WITHOUT stranding the read
// queue. Before the P5 coordinator hardening, a throwing `removeEventListener` on a queued waiter
// made the unrelated holder's read reject, left the waiter pending forever and leaked the slot
// (`readSlotsInUse` stuck at 1), and a throwing `addEventListener` was correct but unpinned.
//
// Slot limit 1 throughout, so the failing signal's read is always a QUEUED hand-off.
//
// Owner ruling #10 (R-1 = B): the same holds when the signal's `addEventListener` re-enters the engine
// synchronously (a nested read started from inside the registration): the queue never exceeds
// `maxQueuedStoreReads`, FIFO stays well-defined, and no slot leaks (last tests of this file).
//
// G-CAL: limits are named, non-default test constants; time is a fake clock; no wall-clock assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { ReadCapacityError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const ONE_READ = 1;
const QUEUE_DEPTH = 2;

const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const settledSoon = (p) => Promise.race([
  p.then(() => true, () => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 5)),
]);

/** A signal-like object (passes the structural check) whose listener methods throw on invocation. */
function faultySignal({ throwOnAdd = false, throwOnRemove = false } = {}) {
  const calls = { add: 0, remove: 0 };
  const signal = {
    aborted: false,
    addEventListener() { calls.add += 1; if (throwOnAdd) throw new Error('add-boom'); },
    removeEventListener() { calls.remove += 1; if (throwOnRemove) throw new Error('remove-boom'); },
  };
  return { signal, calls };
}

function setup() {
  const world = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const probe = { gate: null, entered: null, gets: 0 };
  const inner = createInMemoryResultStore();
  const resultStore = {
    ...inner,
    async get(...args) {
      probe.gets += 1;
      probe.entered?.resolve();
      if (probe.gate) await probe.gate;
      return inner.get(...args);
    },
  };
  const cfg = world.config({
    resultStore, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH },
  });
  const engine = createClashTestEngine(cfg);
  return { engine, probe };
}

async function savedRun(engine) {
  const h = engine.startRun(makeDefinition({ testId: 'T' }));
  await h.persisted;
  await h.done;
  engine.releaseResultSet(h.runId);                            // by-id reads now go through the store
  return h.runId;
}

/** Every public read shape, each taking the read slot by id (a queued hand-off at limit 1). */
const CALLS = {
  getResultSet: (e, id, o) => e.getResultSet(id, o),
  getFreshness: (e, id, o) => e.getFreshness(id, o),
  canClaimNoClashes: (e, id, o) => e.canClaimNoClashes(id, o),
  assessNoClashClaim: (e, id, o) => e.assessNoClashClaim(id, o),
  listResults: (e, _id, o) => e.listResults({}, o),
  listTests: (e, _id, o) => e.listTests({}, o),
  'rerun (site 2: readRerunOptions)': (e, id, o) => e.rerun(id, o),
};

/** A holds the only slot (parked in a gated store read); B queues with `signal`; then the gate opens. */
async function queuedBehindHolder(name, call, signalOpts) {
  const { engine, probe } = setup();
  const runId = await savedRun(engine);
  const gate = deferred();
  probe.gate = gate.promise;
  probe.entered = deferred();
  const holder = engine.getFreshness(runId).then((v) => ({ ok: v }), (err) => ({ err }));
  await probe.entered.promise;
  const { signal, calls } = faultySignal(signalOpts);
  const b = call(engine, runId, { signal });
  const bOutcome = b.then((v) => ({ ok: v }), (err) => ({ err }));
  assert.equal(await settledSoon(bOutcome), false, `${name}: B is queued behind the held slot`);
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, `${name}: only the holder holds a slot`);
  return { engine, probe, gate, runId, holder, bOutcome, calls };
}

// ================================================================================================
// removeEventListener throws: the queued hand-off
// ================================================================================================

test('M-1: a throwing removeEventListener on a queued waiter (all public reads + rerun): holder unaffected, waiter admitted, no slot leaked, later reads progress', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    const ctx = await queuedBehindHolder(name, call, { throwOnRemove: true });
    ctx.probe.gate = null;
    ctx.gate.resolve();
    const holder = await ctx.holder;
    assert.ok(holder.ok, `${name}: the unrelated holder's read result is intact (got ${holder.err?.message})`);
    assert.deepEqual(holder.ok, { state: 'current', reasons: [] }, name);

    const b = await ctx.bOutcome;
    assert.ok(!b.err, `${name}: the queued read was granted and completed (got ${b.err?.message})`);
    if (name.startsWith('rerun')) await (await ctx.bOutcome).ok.done;
    assert.ok(ctx.calls.remove >= 1, `${name}: cleanup was attempted`);

    assert.equal(ctx.engine.retentionReport().readSlotsInUse, 0, `${name}: no slot leaked`);
    // Later reads still make progress.
    assert.deepEqual(await ctx.engine.getFreshness(ctx.runId), { state: 'current', reasons: [] }, `${name}: later read`);
    assert.equal((await ctx.engine.getResultSet(ctx.runId)).runId, ctx.runId, `${name}: later read (store)`);
    assert.equal(ctx.engine.retentionReport().readSlotsInUse, 0, name);
  }
});

test('M-1: with a throwing removeEventListener the queue keeps its full depth and FIFO order across the failing hand-off', async () => {
  const { engine, probe } = setup();
  const runId = await savedRun(engine);
  const gate = deferred();
  probe.gate = gate.promise;
  probe.entered = deferred();
  const order = [];
  const track = (name, p) => p.then((v) => { order.push(name); return v; });
  const a = track('a', engine.getFreshness(runId));
  await probe.entered.promise;
  const { signal } = faultySignal({ throwOnRemove: true });
  const b = track('b', engine.canClaimNoClashes(runId, { signal }));       // queued (1), failing cleanup
  const c = track('c', engine.getResultSet(runId));                        // queued (2)
  await assert.rejects(engine.assessNoClashClaim(runId), ReadCapacityError, 'the queue is full');
  probe.gate = null;
  gate.resolve();
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  // Full depth is available again.
  const gate2 = deferred();
  probe.gate = gate2.promise;
  probe.entered = deferred();
  const holder = engine.getFreshness(runId);
  await probe.entered.promise;
  const w1 = engine.getFreshness(runId);
  const w2 = engine.getFreshness(runId);
  await assert.rejects(engine.getFreshness(runId), ReadCapacityError, 'exactly QUEUE_DEPTH waiters fit');
  probe.gate = null;
  gate2.resolve();
  await Promise.all([holder, w1, w2]);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ================================================================================================
// addEventListener throws: fail closed, nothing queued
// ================================================================================================

test('M-1: a throwing addEventListener (all public reads + rerun) rejects fail-closed and strands nothing', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    const { engine, probe } = setup();
    const runId = await savedRun(engine);
    const gate = deferred();
    probe.gate = gate.promise;
    probe.entered = deferred();
    const holder = engine.getFreshness(runId).then((v) => ({ ok: v }), (err) => ({ err }));
    await probe.entered.promise;

    const { signal, calls } = faultySignal({ throwOnAdd: true });
    const p = call(engine, runId, { signal });
    assert.ok(p instanceof Promise, `${name}: a rejection, never a synchronous throw`);
    const outcome = await p.then((v) => ({ ok: v }), (err) => ({ err }));
    assert.ok(outcome.err, `${name}: rejects (fail-closed), got ${JSON.stringify(outcome.ok)}`);
    assert.equal(calls.add, 1, `${name}: registration was attempted once`);
    assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, `${name}: only the holder holds a slot`);

    // Nothing was queued: a full depth of real waiters still fits behind the holder.
    const w1 = engine.getResultSet(runId);
    const w2 = engine.getResultSet(runId);
    await assert.rejects(engine.getResultSet(runId), ReadCapacityError, `${name}: the failed call consumed no queue depth`);
    probe.gate = null;
    gate.resolve();
    assert.ok((await holder).ok, `${name}: the holder is unaffected`);
    await Promise.all([w1, w2]);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, `${name}: no slot leaked`);
    assert.deepEqual(await engine.getFreshness(runId), { state: 'current', reasons: [] }, `${name}: later read progresses`);
  }
});

test('M-1: a signal with throwing listener methods is harmless when a slot is free (never invoked) and reads succeed', async () => {
  const { engine } = setup();
  const runId = await savedRun(engine);
  const { signal, calls } = faultySignal({ throwOnAdd: true, throwOnRemove: true });
  assert.deepEqual(await engine.getFreshness(runId, { signal }), { state: 'current', reasons: [] });
  assert.equal(calls.add + calls.remove, 0, 'no listener traffic on the immediate path');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ================================================================================================
// R-1 (owner ruling #10): a nested read started synchronously from addEventListener
// ================================================================================================

test('R-1: a nested read started from addEventListener (all public reads + rerun): no queue overshoot, FIFO kept, no leak, later reads progress', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    const { engine, probe } = setup();
    const runId = await savedRun(engine);
    const gate = deferred();
    probe.gate = gate.promise;
    probe.entered = deferred();
    const holder = engine.getFreshness(runId).then((v) => ({ ok: v }), (err) => ({ err }));
    await probe.entered.promise;

    const order = [];
    let nested = null;
    const signal = {
      aborted: false,
      addEventListener() {
        nested = engine.getResultSet(runId).then((v) => { order.push('nested'); return { ok: v }; }, (err) => ({ err }));
      },
      removeEventListener() {},
    };
    const outer = call(engine, runId, { signal }).then((v) => { order.push('outer'); return { ok: v }; }, (err) => ({ err }));
    assert.ok(nested, `${name}: the registration ran synchronously`);
    // Depth 2: outer + nested fill the queue; a further read is over capacity.
    await assert.rejects(engine.getResultSet(runId), ReadCapacityError, `${name}: exactly QUEUE_DEPTH waiters`);
    probe.gate = null;
    gate.resolve();
    assert.ok((await holder).ok, `${name}: holder unaffected`);
    const o = await outer;
    const n = await nested;
    assert.ok(!o.err, `${name}: outer read completed (${o.err?.message})`);
    assert.ok(!n.err, `${name}: nested read completed (${n.err?.message})`);
    if (name.startsWith('rerun') && o.ok?.done) await o.ok.done;
    assert.deepEqual(order, ['outer', 'nested'], `${name}: FIFO — the outer call was queued first`);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, `${name}: no slot leaked`);
    assert.deepEqual(await engine.getFreshness(runId), { state: 'current', reasons: [] }, `${name}: later read progresses`);
  }
});

test('R-1: with queue depth 1 a nested read from addEventListener is rejected ReadCapacityError, never overshooting the queue', async () => {
  const world = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const probe = { gate: null, entered: null };
  const inner = createInMemoryResultStore();
  const resultStore = {
    ...inner,
    async get(...args) { probe.entered?.resolve(); if (probe.gate) await probe.gate; return inner.get(...args); },
  };
  const engine = createClashTestEngine(world.config({
    resultStore, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: 1 },
  }));
  const runId = await savedRun(engine);
  const gate = deferred();
  probe.gate = gate.promise;
  probe.entered = deferred();
  const holder = engine.getFreshness(runId);
  await probe.entered.promise;
  let nested = null;
  const signal = {
    aborted: false,
    addEventListener() { nested = engine.getResultSet(runId).then((v) => ({ ok: v }), (err) => ({ err })); },
    removeEventListener() {},
  };
  const outer = engine.getFreshness(runId, { signal });
  assert.ok((await nested).err instanceof ReadCapacityError, 'the nested read found the queue already full');
  probe.gate = null;
  gate.resolve();
  await Promise.all([holder, outer]);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('M-1: no listener failure produced an unhandled rejection', async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(unhandled, []);
});
