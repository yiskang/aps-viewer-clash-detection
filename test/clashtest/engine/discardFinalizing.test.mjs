// test/clashtest/engine/discardFinalizing.test.mjs
//
// Owner ruling L1 / D-5 (Option B), P7 independent-review adjudication
// (docs/reviews/2026-09-25-federated-clash-test-core-p7-independent-review-adjudication.md,
// "Bounded adjudication — L1 / D-5"): `finalizing` counts as terminal for the lifecycle contract, but
// an `engine.discardRun` invoked while the run's sealed set is admitted and `done` has not resolved
// yet WAITS for the run's terminal completion before discarding, instead of racing the seal and the
// first persistence attempt. Every §13.5.1 observable (`done.persistence`, `persisted`,
// `getPersistenceState`, the `'persistence'` event, the terminal `state` event) must then agree
// (§13.5.1 item 3, "all consistent"; item 2, `skipped` only for `no-store` | `persist-false`), and
// the store sees `put` then `delete` (§13.5.2, "chained after any in-flight put").
//
// Variants (the adjudication's V-table): V1 sync `finalizing` listener (memory store / no store /
// `persist:false`), V9 a discard landing between admission and the `finalizing` commit, V5 from the
// `'persistence'` listener, V10/hung store, and the regressions that were already consistent
// (V4 microtask from the `finalizing` listener, V6 terminal `state` listener, V7 after `done`).
// Dispose intervening while a deferred discard waits: the discard REJECTS `EngineDisposedError`
// and deletes nothing (§10.2: after `dispose()` "every other method now fails with
// EngineDisposedError … delivered as a rejection from the Promise-returning ones", and dispose
// "does not touch persisted results" and hands unsaved sets back rather than destroying them).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createEngineCore } from '../../../clashtest/engine.js';
import { EngineDisposedError, RunNotTerminalError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const PERSIST_TIMEOUT_MS = ENGINE_LIMIT_DEFAULTS.persistTimeoutMs;

// Every test in this file must leave no unhandled rejection behind (a deferred discard is a promise
// the engine creates on the caller's behalf).
const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };
process.on('unhandledRejection', onUnhandled);
after(() => { process.off('unhandledRejection', onUnhandled); });

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = () => new Promise((r) => setImmediate(r));

/** The `scheduleTimeout` seam: nothing fires until `advance`. */
function fakeTimers() {
  let elapsed = 0;
  const live = new Set();
  return {
    scheduleTimeout(fn, ms) {
      const timer = { fn, due: elapsed + ms };
      live.add(timer);
      return () => { live.delete(timer); };
    },
    advance(ms) {
      elapsed += ms;
      const due = [...live].filter((t) => t.due <= elapsed);
      for (const t of due) { live.delete(t); t.fn(); }
      return due.length;
    },
  };
}

/** A scripted executor (every unit clean) that parks each unit until `release()`. */
function gatedExecutor() {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  const started = deferred();
  const gate = deferred();
  const executor = async (request) => {
    started.resolve();
    await gate.promise;
    return inner(request);
  };
  return Object.assign(executor, { started: started.promise, release: () => gate.resolve() });
}

/**
 * A result store that logs `put`/`delete` in order over a real in-memory store. `gate` (optional)
 * parks every `put` until it resolves; `putCalled` resolves with the put's signal.
 */
function loggingStore({ gate = null } = {}) {
  const inner = createInMemoryResultStore();
  const ops = [];
  const putCalled = deferred();
  const store = {
    ...inner,
    put: async (s, o) => {
      ops.push('put');
      putCalled.resolve(o.signal);
      if (gate) await gate;
      return inner.put(s, o);
    },
    delete: async (id) => { ops.push('delete'); return inner.delete(id); },
  };
  return { store, inner, ops, putCalled: putCalled.promise };
}

/**
 * Engine config. `nowHook` (optional) runs on every `now()` read AFTER it is armed (`cfg.arm(fn)`) —
 * the residency manager stamps `sealedAt` through the same `now`, which is how the V9 test lands a
 * microtask between admission and the `finalizing` commit without any production seam.
 */
function base(extra = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const timers = fakeTimers();
  let hook = null;
  const now = () => { const t = clock.now(); if (hook) hook(); return t; };
  const cfg = createEngineWorld().config({
    now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: timers.scheduleTimeout, ...extra,
  });
  return Object.assign(cfg, { timers, arm: (fn) => { hook = fn; } });
}

const validDef = (over = {}) => makeDefinition({ testId: 'T', ...over });

/** Records every event of a handle, and the settle ORDER of `done` against the discard promise. */
function observe(h) {
  const events = [];
  const order = [];
  h.subscribe((e) => { events.push(e); });
  h.done.then(() => order.push('done'));
  return {
    events,
    order,
    persistenceEvents: () => events.filter((e) => e.type === 'persistence'),
    terminal: () => events.filter((e) => e.type === 'state' && e.terminal),
  };
}

/** Asserts every §13.5.1 observable agrees on ONE saved first attempt, and nothing remains after. */
async function assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner }) {
  discarding.then(() => obs.order.push('discard'), () => obs.order.push('discard-rejected'));
  const done = await h.done;
  await discarding;
  assert.deepEqual(done.persistence, { state: 'saved', timedOut: false, attempt: 1 }, 'done: the attempt ran');
  assert.deepEqual(await h.persisted, { state: 'saved' });
  assert.deepEqual(obs.persistenceEvents().map(({ state, attempt }) => ({ state, attempt })),
    [{ state: 'saved', attempt: 1 }], 'one \'persistence\' event, saved');
  assert.equal(obs.terminal().length, 1);
  assert.deepEqual(obs.terminal()[0].persistence, done.persistence, 'the terminal event agrees with done');
  assert.deepEqual(ops, ['put', 'delete'], 'put, THEN delete');
  assert.equal(await inner.get(h.runId), null, 'no durable copy remains');
  assert.deepEqual(obs.order, ['done', 'discard'], 'the discard resolves only after done');
  assert.equal(core.engine.getPersistenceState(h.runId), null);
  assert.equal(core.engine.retentionReport().slotsInUse, 0);
  assert.equal(core.internals.ownRuns.has(h.runId), false);
}

/** Subscribes `fn` to the FIRST `finalizing` state event (synchronously, inside the emit). */
function onFinalizing(h, fn) {
  let fired = false;
  h.subscribe((e) => {
    if (!fired && e.type === 'state' && e.phase === 'finalizing') { fired = true; fn(e); }
  });
}

// ================================================================================================
// (a) V1 — discard from a SYNCHRONOUS `finalizing` listener
// ================================================================================================

test('V1: discard from a sync finalizing listener (memory store) waits for done; all observables agree', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  let listenerReturned = false;
  onFinalizing(h, () => {
    discarding = core.engine.discardRun(h.runId);          // returns a promise at once, no wait here
    listenerReturned = true;
  });
  await settle();
  assert.ok(discarding instanceof Promise, 'the listener ran and got a promise');
  assert.equal(listenerReturned, true);
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

test('V2: discard from a sync finalizing listener with NO store: skipped/no-store everywhere', async () => {
  const core = createEngineCore(base({ resultStore: null }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  onFinalizing(h, () => { discarding = core.engine.discardRun(h.runId); });
  const done = await h.done;
  await discarding;
  assert.deepEqual(done.persistence, { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' });
  assert.deepEqual(await h.persisted, { state: 'skipped', reason: 'no-store' });
  assert.deepEqual(obs.persistenceEvents().map(({ state, reason }) => ({ state, reason })),
    [{ state: 'skipped', reason: 'no-store' }]);
  assert.deepEqual(obs.terminal()[0].persistence, done.persistence);
  assert.equal(core.engine.getPersistenceState(h.runId), null, 'the resident copy was released');
  assert.equal(core.engine.retentionReport().slotsInUse, 0);
  assert.equal(core.internals.ownRuns.has(h.runId), false);
});

test('V3: discard from a sync finalizing listener with persist:false: skipped/persist-false everywhere', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef(), { persist: false });
  const obs = observe(h);
  let discarding = null;
  onFinalizing(h, () => { discarding = core.engine.discardRun(h.runId); });
  const done = await h.done;
  await discarding;
  assert.deepEqual(done.persistence, { state: 'skipped', timedOut: false, attempt: 0, reason: 'persist-false' });
  assert.deepEqual(await h.persisted, { state: 'skipped', reason: 'persist-false' });
  assert.deepEqual(obs.persistenceEvents().map(({ state, reason }) => ({ state, reason })),
    [{ state: 'skipped', reason: 'persist-false' }]);
  assert.deepEqual(obs.terminal()[0].persistence, done.persistence);
  assert.deepEqual(ops, ['delete'], 'never put; the (idempotent) durable delete still runs');
  assert.equal(await inner.get(h.runId), null);
  assert.equal(core.engine.retentionReport().slotsInUse, 0);
});

// ================================================================================================
// (b) V9 — discard racing the seal: after admission, BEFORE the `finalizing` commit
// ================================================================================================

test('V9: a discard landing between admission and the finalizing commit waits for done; all agree', async () => {
  const { store, inner, ops } = loggingStore();
  const cfg = base({ resultStore: store });
  const core = createEngineCore(cfg);
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  let phaseAtDiscard = null;
  // Every `now()` read queues a microtask; the first one that finds the set RESIDENT runs right after
  // `admitSealedSet` returns and before Run.js resumes into `persistAndFinalize`'s `finalizing` commit.
  cfg.arm(() => queueMicrotask(() => {
    if (discarding !== null || core.internals.residency.getPersistenceState(h.runId) === null) return;
    phaseAtDiscard = h.getSnapshot().phase;
    discarding = core.engine.discardRun(h.runId);
  }));
  await settle();
  assert.ok(discarding, 'the hook fired');
  assert.notEqual(phaseAtDiscard, 'finalizing', 'the V9 window: admitted, but finalizing not yet committed');
  assert.notEqual(phaseAtDiscard, 'terminal');
  cfg.arm(null);
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

test('a genuinely executing run (not sealed, reservation held) still rejects RunNotTerminalError', async () => {
  const unitExecutor = gatedExecutor();
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store, unitExecutor }));
  const h = core.engine.startRun(validDef());
  await unitExecutor.started;
  assert.ok(!['finalizing', 'terminal'].includes(h.getSnapshot().phase), 'a unit is in flight');
  assert.equal(core.internals.residency.reservationHeld(h.runId), true, 'not sealed: still a reservation');
  await assert.rejects(core.engine.discardRun(h.runId), RunNotTerminalError);
  unitExecutor.release();
  const done = await h.done;
  assert.deepEqual(done.persistence, { state: 'saved', timedOut: false, attempt: 1 }, 'the refusal changed nothing');
  assert.deepEqual(ops, ['put']);
  assert.notEqual(await inner.get(h.runId), null);
});

// ================================================================================================
// (c) V5 — discard from the `'persistence'` event listener
// ================================================================================================

test('V5: discard from the persistence listener: done and the terminal event read saved, not skipped', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  h.subscribe((e) => { if (e.type === 'persistence' && discarding === null) discarding = core.engine.discardRun(h.runId); });
  await settle();
  assert.ok(discarding, 'the persistence listener ran');
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

// ================================================================================================
// (d) dispose intervening while the deferred discard waits
// ================================================================================================

test('dispose while a deferred discard waits on a hung write: the discard rejects EngineDisposedError, deletes nothing', async () => {
  const gate = deferred();
  const { store, inner, ops, putCalled } = loggingStore({ gate: gate.promise });
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  let discarding = null;
  onFinalizing(h, () => { discarding = core.engine.discardRun(h.runId); });
  await putCalled;
  await settle();
  assert.equal(h.getSnapshot().phase, 'finalizing');
  const disposing = core.engine.dispose();
  const rejected = assert.rejects(discarding, EngineDisposedError);
  const done = await h.done;
  assert.deepEqual(done.persistence, { state: 'pending', timedOut: true, attempt: 1 }, '§10.2 forced close');
  await rejected;
  assert.deepEqual(await disposing, { droppedUnsaved: [], persistenceInFlight: [h.runId] },
    'dispose, not the discard, accounts for the set');
  gate.resolve();                                           // the detached write completes
  await settle();
  assert.deepEqual(ops, ['put'], 'no store delete was issued for a discard disposal prevented');
  assert.notEqual(await inner.get(h.runId), null, 'dispose does not touch persisted results');
});

test('dispose called from the same finalizing listener right after discard: rejects, no delete, unsaved set handed back', async () => {
  const core = createEngineCore(base({ resultStore: null }));
  const h = core.engine.startRun(validDef());
  let discarding = null;
  let disposing = null;
  onFinalizing(h, () => {
    discarding = core.engine.discardRun(h.runId);
    disposing = core.engine.dispose();
  });
  await settle();
  await assert.rejects(discarding, EngineDisposedError);
  const summary = await disposing;
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId), [h.runId],
    'the discard did not happen, so dispose hands the unsaved set back (§13.5.2)');
  assert.deepEqual(summary.persistenceInFlight, []);
});

// ================================================================================================
// (e) idempotent double discard, (f) hung store
// ================================================================================================

test('two discards while the first waits: both settle, ONE delete, no unhandled rejection', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let first = null;
  let second = null;
  onFinalizing(h, () => {
    first = core.engine.discardRun(h.runId);
    second = core.engine.discardRun(h.runId);
  });
  await settle();
  assert.ok(first && second);
  assert.equal(second, first, 'the second call shares the deferred discard');
  await second;
  await assertSavedThenDiscarded({ core, h, obs, discarding: first, ops, inner });
});

test('hung store: a deferred discard resolves only after the write settles; the slot is kept meanwhile', async () => {
  const gate = deferred();
  const { store, inner, ops, putCalled } = loggingStore({ gate: gate.promise });
  const cfg = base({ resultStore: store });
  const core = createEngineCore(cfg);
  const h = core.engine.startRun(validDef());
  let discarding = null;
  onFinalizing(h, () => { discarding = core.engine.discardRun(h.runId); });
  const signal = await putCalled;
  await settle();
  let discardSettled = false;
  discarding.then(() => { discardSettled = true; });
  assert.equal(signal.aborted, false, 'the deferred discard does not abort the first attempt inside the window');
  assert.equal(cfg.timers.advance(PERSIST_TIMEOUT_MS), 1);
  const done = await h.done;
  assert.deepEqual(done.persistence, { state: 'pending', timedOut: true, attempt: 1 });
  await settle();
  assert.equal(discardSettled, false, 'still waiting on the write');
  assert.equal(signal.aborted, true, 'once done resolved, the discard aborts the write (§13.5.2)');
  assert.equal(core.engine.retentionReport().slotsInUse, 1, 'the slot is kept until the write settles');
  assert.deepEqual(ops, ['put']);
  gate.resolve();
  await discarding;
  assert.deepEqual(ops, ['put', 'delete']);
  assert.equal(await inner.get(h.runId), null, 'a late write cannot resurrect the set');
  assert.equal(core.engine.retentionReport().slotsInUse, 0);
});

// ================================================================================================
// (g) variants that were already consistent stay so: V4, V6, V7
// ================================================================================================

test('V4: discard from a microtask queued by the finalizing listener stays consistent', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  onFinalizing(h, () => queueMicrotask(() => { discarding = core.engine.discardRun(h.runId); }));
  await settle();
  assert.ok(discarding);
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

test('V6: discard from the terminal state listener is immediate and consistent', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  let discarding = null;
  h.subscribe((e) => { if (e.type === 'state' && e.terminal && discarding === null) discarding = core.engine.discardRun(h.runId); });
  await settle();
  assert.ok(discarding);
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

test('V7: discard after done resolved is unchanged', async () => {
  const { store, inner, ops } = loggingStore();
  const core = createEngineCore(base({ resultStore: store }));
  const h = core.engine.startRun(validDef());
  const obs = observe(h);
  await h.done;
  const discarding = core.engine.discardRun(h.runId);
  await assertSavedThenDiscarded({ core, h, obs, discarding, ops, inner });
});

test('no unhandled rejection was raised by any test in this file', async () => {
  await settle();
  await settle();
  assert.deepEqual(unhandled, []);
});
