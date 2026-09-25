// test/clashtest/engine/residency.test.mjs
//
// Task P7.5: the residency, persistence and retention surface of the engine — `retainResultSet`,
// `releaseResultSet`, `discardRun`, `retryPersist`, `getPersistenceState`, `retentionReport` (spec
// §13.5.1, §13.5.2) — and the `dispose()` contract (§10.2, §13.5.2: signal every owned run, then
// wait; `DisposeSummary {droppedUnsaved, persistenceInFlight}`).
//
// Deviations from the brief's excerpt, each pinned where it applies (preflight scan rows P7.5, S8):
//   - LRU (scan P7.5 (a), §13.5.2): with the cap reached by a RETAINED `a` and a saved, unleased `b`,
//     a third `startRun` EVICTS `b` (the LRU evictable set) instead of refusing; `a` stays resident.
//   - Hung write (scan P7.5 (b)): a run emits non-terminal `'state'` events too (`finalizing`,
//     `cancelling`), so only TERMINAL state events are counted.
//   - Timers (scan P7.5 (c), S8, G-CAL): the `persistTimeoutMs` window is driven through the
//     `scheduleTimeout` seam by `fakeTimers()` below; no real timer ever runs.
//   - A parked in-flight unit is a parked EXECUTOR (`gatedExecutor`), not `world.hold()`: the engine
//     test world runs P6's scripted executor (owner item D-4), which never calls `findClashes`.
//   - `maxResidentResultSets: 4` (the §17.1 default) is the named, non-default `SLOT_CAP` (G-CAL).
//
// C-P7-3 / G-EC: nothing here reads `testIdOfInput` or `provenance.models[].elementCount`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import {
  EngineDisposedError, InvalidOptionsError, ResultCapacityError, ResultNotResidentError,
  ResultSetRetainedError, RunNotTerminalError, UnsavedResultSetError,
} from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

/** Named, NON-default slot caps (G-CAL). */
const TWO_SLOTS = 2;
const SLOT_CAP = 3;
const PERSIST_TIMEOUT_MS = ENGINE_LIMIT_DEFAULTS.persistTimeoutMs;

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets every pending microtask and one macrotask turn run (the engine yields on the fake clock). */
const settle = () => new Promise((r) => setImmediate(r));

/**
 * The `scheduleTimeout` seam (Run.js requires `(fn, ms) => cancel`): nothing fires until `advance`.
 * `advance(ms)` fires every live timer due within `ms` of now and returns how many fired.
 */
function fakeTimers() {
  let elapsed = 0;
  const live = new Set();
  return {
    scheduleTimeout(fn, ms) {
      const timer = { fn, due: elapsed + ms, ms };
      live.add(timer);
      return () => { live.delete(timer); };
    },
    advance(ms) {
      elapsed += ms;
      const due = [...live].filter((t) => t.due <= elapsed);
      for (const t of due) { live.delete(t); t.fn(); }
      return due.length;
    },
    get live() { return [...live]; },
  };
}

/** A scripted executor (every unit clean) that parks each unit until `release()`. */
function gatedExecutor() {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  const started = deferred();
  const gate = deferred();
  const calls = [];
  const executor = async (request) => {
    calls.push(request.unit.unitId);
    started.resolve();
    await gate.promise;
    return inner(request);
  };
  return Object.assign(executor, { calls, started: started.promise, release: () => gate.resolve() });
}

/** Engine config: the P7 engine world, a fake clock, and fake timers (`timers`, returned beside it). */
function base(extra = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const timers = fakeTimers();
  const cfg = createEngineWorld().config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: timers.scheduleTimeout, ...extra,
  });
  return Object.assign(cfg, { timers });
}

const validDef = (over = {}) => makeDefinition({ testId: 'T', ...over });

/** Runs one direct definition to its sealed, SAVED state (in-memory store). */
async function savedRun(engine) {
  const h = engine.startRun(validDef());
  await h.persisted;
  await h.done;
  return h;
}

// ================================================================================================
// retain / release / discard refusals and the persistence snapshot
// ================================================================================================

test('retain/release/discard refusals (no store: every sealed set is held)', async () => {
  const core = createEngineCore(base({ resultStore: null }));
  const { engine } = core;
  const h = engine.startRun(validDef());
  await assert.rejects(engine.discardRun(h.runId), RunNotTerminalError);        // Promise-returning ⇒ rejects (A8)
  const summary = await h.done;
  assert.deepEqual(engine.getPersistenceState(h.runId),
    { state: 'skipped', timedOut: false, attempt: 0, reason: 'no-store' });
  assert.throws(() => engine.retainResultSet(h.runId), UnsavedResultSetError);  // held, never auto-evicted
  assert.throws(() => engine.releaseResultSet(h.runId), UnsavedResultSetError);
  assert.equal(engine.getRun(h.runId), h, 'a refused release changed nothing');
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });               // idempotent no-op
  assert.equal(engine.getPersistenceState(h.runId), null);
  assert.equal(core.internals.ownRuns.has(h.runId), false, 'release drops the engine\'s own handle (§13.5.2)');
  assert.equal(engine.getRun(h.runId), null);
  assert.equal(engine.retentionReport().slotsInUse, 0);
  await assert.rejects(engine.retryPersist(h.runId), ResultNotResidentError);   // Promise-returning ⇒ rejects (A8)
  assert.throws(() => engine.retainResultSet(h.runId), ResultNotResidentError);
  assert.ok(Object.isFrozen(summary.resultSet), 'the caller-held summary is untouched');
});

test('releaseResultSet on a saved set drops the resident copy only, and the engine handle with it', async () => {
  const resultStore = createInMemoryResultStore();
  const core = createEngineCore(base({ resultStore }));
  const { engine } = core;
  const h = await savedRun(engine);
  assert.deepEqual(engine.getPersistenceState(h.runId), { state: 'saved', timedOut: false, attempt: 1 });
  engine.releaseResultSet(h.runId);                          // saved: no acknowledgement needed
  assert.equal(engine.getPersistenceState(h.runId), null);
  assert.equal(core.internals.ownRuns.size, 0, 'pruned by the release itself, not by a later admission');
  assert.notEqual(await resultStore.get(h.runId), null, 'the durable copy is untouched');
});

test('releaseResultSet is refused while a lease is outstanding; a lease releases exactly once', async () => {
  const engine = createClashTestEngine(base());
  const h = await savedRun(engine);
  const lease = engine.retainResultSet(h.runId);
  assert.equal(typeof lease.release, 'function');
  assert.equal(engine.retentionReport().sets.find((s) => s.runId === h.runId).class, 'retained');
  assert.throws(() => engine.releaseResultSet(h.runId), ResultSetRetainedError);
  assert.throws(() => engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true }), ResultSetRetainedError);
  lease.release();
  lease.release();                                           // one-shot token: no second decrement
  assert.equal(engine.retentionReport().sets.find((s) => s.runId === h.runId).class, 'evictable');
  engine.releaseResultSet(h.runId);
  assert.equal(engine.getRun(h.runId), null);
});

test('releaseResultSet reads its options strictly: only a boolean acknowledges unsaved state', async () => {
  const engine = createClashTestEngine(base({ resultStore: null }));
  const h = engine.startRun(validDef());
  await h.done;
  for (const [label, options, path, code] of [
    ['truthy string', { acknowledgeUnsaved: 'yes' }, '/acknowledgeUnsaved', 'bad-shape'],
    ['number', { acknowledgeUnsaved: 1 }, '/acknowledgeUnsaved', 'bad-shape'],
    ['unknown key', { acknowledge: true }, '/acknowledge', 'unknown-key'],
    ['not an object', true, '/', 'bad-shape'],
    ['null', null, '/', 'bad-shape'],
  ]) {
    let caught;
    assert.throws(() => { try { engine.releaseResultSet(h.runId, options); } catch (e) { caught = e; throw e; } },
      InvalidOptionsError, label);
    assert.deepEqual(caught.issues.map((i) => [i.path, i.code]), [[path, code]], label);
    assert.notEqual(engine.getPersistenceState(h.runId), null, `${label}: nothing was released`);
  }
  // A well-formed object that does not acknowledge is still a refusal.
  for (const options of [{}, { acknowledgeUnsaved: false }, { acknowledgeUnsaved: undefined }]) {
    assert.throws(() => engine.releaseResultSet(h.runId, options), UnsavedResultSetError);
  }
  // A getter is read exactly once (no TOCTOU between the check and the release).
  let reads = 0;
  const once = { get acknowledgeUnsaved() { reads += 1; return reads === 1; } };
  engine.releaseResultSet(h.runId, once);
  assert.equal(reads, 1);
  assert.equal(engine.getPersistenceState(h.runId), null);
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: undefined });          // undefined = omitted: a no-op now
});

test('getPersistenceState never throws for an unknown id and returns null for a nonresident one', () => {
  const engine = createClashTestEngine(base());
  for (const id of ['no-such-run', '', undefined, null, 42, {}]) assert.equal(engine.getPersistenceState(id), null);
  engine.releaseResultSet('no-such-run');                     // nonresident: idempotent no-op
  assert.throws(() => engine.retainResultSet('no-such-run'), ResultNotResidentError);
});

// ================================================================================================
// retryPersist
// ================================================================================================

test('retryPersist is legal only from failed: a nonresident id and a non-failed set REJECT', async () => {
  let fail = true;
  const inner = createInMemoryResultStore();
  const resultStore = { ...inner, put: async (s, o) => { if (fail) throw new Error('disk full'); return inner.put(s, o); } };
  const engine = createClashTestEngine(base({ resultStore }));
  const h = engine.startRun(validDef());
  assert.deepEqual(await h.persisted, { state: 'failed', error: { name: 'Error', message: 'disk full' } });
  await h.done;
  assert.equal(engine.retentionReport().sets[0].class, 'held');
  assert.equal(engine.getPersistenceState(h.runId).state, 'failed');
  fail = false;
  const retried = engine.retryPersist(h.runId);
  assert.ok(retried instanceof Promise);
  assert.deepEqual(await retried, { state: 'saved', timedOut: false, attempt: 2 });
  assert.equal(engine.retentionReport().sets[0].class, 'evictable', 'a successful retry makes the set evictable');
  await assert.rejects(engine.retryPersist(h.runId), (err) => err instanceof InvalidOptionsError
    && err.issues.length === 1 && err.issues[0].path === 'runId' && err.issues[0].code === 'not-failed');
  await assert.rejects(engine.retryPersist('no-such-run'), ResultNotResidentError);
  assert.deepEqual(await h.persisted, { state: 'failed', error: { name: 'Error', message: 'disk full' } },
    'persisted stays the FIRST attempt\'s outcome');
});

// ================================================================================================
// LRU eviction and retain leases
// ================================================================================================

test('control: without a lease, admission at the cap evicts the least-recently-used saved set', async () => {
  const engine = createClashTestEngine(base({ limits: { maxResidentResultSets: TWO_SLOTS } }));
  const a = await savedRun(engine);
  const b = await savedRun(engine);
  const c = engine.startRun(validDef());
  assert.equal(engine.getRun(a.runId), null, 'a was the LRU evictable set');
  assert.equal(engine.getRun(b.runId), b);
  await c.done;
});

test('a retained saved set is never the LRU eviction victim', async () => {
  const core = createEngineCore(base({ limits: { maxResidentResultSets: TWO_SLOTS } }));
  const { engine } = core;
  const a = await savedRun(engine);
  const lease = engine.retainResultSet(a.runId);            // a is now the LEAST recently touched set
  const b = await savedRun(engine);
  const c = engine.startRun(validDef());                    // cap reached: b is the only evictable set
  assert.equal(engine.getRun(b.runId), null, 'b (saved, unleased) was evicted');
  assert.equal(engine.getRun(a.runId), a, 'a (retained) stayed resident');
  assert.equal(core.internals.ownRuns.has(b.runId), false);
  lease.release();                                          // c is still active: a is the only evictable set
  const d = engine.startRun(validDef());
  assert.equal(engine.getRun(a.runId), null, 'a is evictable once released');
  await Promise.all([c.done, d.done]);
});

test('every slot retained starves admission with ResultCapacityError naming the retained sets', async () => {
  const engine = createClashTestEngine(base({ limits: { maxResidentResultSets: TWO_SLOTS } }));
  const a = await savedRun(engine);
  const b = await savedRun(engine);
  engine.retainResultSet(a.runId);
  engine.retainResultSet(b.runId);
  let caught;
  assert.throws(() => { try { engine.startRun(validDef()); } catch (e) { caught = e; throw e; } }, ResultCapacityError);
  assert.deepEqual([...caught.retained].sort(), [a.runId, b.runId].sort());
});

test('getResultSet on a RESIDENT set refreshes its LRU position (§13.5.2 "refreshed by getResultSet")', async () => {
  const engine = createClashTestEngine(base({ limits: { maxResidentResultSets: SLOT_CAP } }));
  const runs = [];
  for (let i = 0; i < SLOT_CAP; i += 1) runs.push(await savedRun(engine));
  const [oldest, second] = runs;
  await engine.getResultSet(oldest.runId);                  // oldest becomes the most recently used
  const next = engine.startRun(validDef());
  assert.equal(engine.getRun(second.runId), null, 'the least-recently-used set was evicted');
  assert.equal(engine.getRun(oldest.runId), oldest, 'the set just read stayed resident');
  await next.done;
});

test('retentionReport reports slots, cap, classes and read slots without touching the LRU order', async () => {
  const engine = createClashTestEngine(base({ limits: { maxResidentResultSets: TWO_SLOTS } }));
  const a = await savedRun(engine);
  const b = await savedRun(engine);
  const report = engine.retentionReport();
  assert.deepEqual(report, {
    slotsInUse: TWO_SLOTS, cap: TWO_SLOTS, active: [], readSlotsInUse: 0,
    sets: [
      { runId: a.runId, class: 'evictable', leases: 0, persistence: 'saved' },
      { runId: b.runId, class: 'evictable', leases: 0, persistence: 'saved' },
    ],
  });
  const c = engine.startRun(validDef());                    // the report did not refresh a
  assert.equal(engine.getRun(a.runId), null);
  await c.done;
});

// ================================================================================================
// discardRun
// ================================================================================================

test('discardRun chains the store delete after an in-flight put settles', async () => {
  const gate = deferred();
  const putCalled = deferred();
  const inner = createInMemoryResultStore();
  const seen = [];
  const resultStore = {
    ...inner,
    put: async (s, o) => { putCalled.resolve(o.signal); await gate.promise; return inner.put(s, o); },
    delete: async (id) => { seen.push(id); return inner.delete(id); },
  };
  const cfg = base({ resultStore });
  const core = createEngineCore(cfg);
  const { engine } = core;
  const h = engine.startRun(validDef());
  const signal = await putCalled.promise;
  await settle();
  assert.equal(cfg.timers.advance(PERSIST_TIMEOUT_MS), 1, 'the persistTimeoutMs window was the one timer');
  const done = await h.done;                                // closed by the window, write still pending
  assert.deepEqual(done.persistence, { state: 'pending', timedOut: true, attempt: 1 });
  assert.deepEqual(engine.getPersistenceState(h.runId), { state: 'pending', timedOut: false, attempt: 1 });
  const discarding = engine.discardRun(h.runId);
  await settle();
  assert.deepEqual(seen, [], 'delete NOT issued while the put is in flight');
  assert.equal(signal.aborted, true, 'the put\'s signal was aborted');
  assert.equal(engine.retentionReport().slotsInUse, 1, 'the slot is kept until the write settles');
  gate.resolve();
  await discarding;
  assert.deepEqual(seen, [h.runId]);
  assert.equal(await inner.get(h.runId), null, 'a late write cannot resurrect the discarded set');
  assert.equal(engine.getPersistenceState(h.runId), null);
  assert.equal(engine.retentionReport().slotsInUse, 0);
  assert.equal(core.internals.ownRuns.has(h.runId), false, 'discard drops the engine\'s own handle (§13.5.2)');
  assert.equal(cfg.timers.live.length, 0, 'no timer outlives the run');
});

test('discardRun while the finalize window is still OPEN: done reads saved, then nothing remains', async () => {
  // Carried from the P7.5 review: the put is pending and `done` has NOT resolved (no timer fired).
  const gate = deferred();
  const putCalled = deferred();
  const inner = createInMemoryResultStore();
  const resultStore = { ...inner, put: async (s, o) => { putCalled.resolve(); await gate.promise; return inner.put(s, o); } };
  const cfg = base({ resultStore });
  const core = createEngineCore(cfg);
  const { engine } = core;
  const h = engine.startRun(validDef());
  let doneSettled = false;
  h.done.then(() => { doneSettled = true; });
  await putCalled.promise;
  await settle();
  assert.equal(doneSettled, false, 'the finalize window is open');
  const discarding = engine.discardRun(h.runId);
  gate.resolve();                                           // the write settles inside the window
  const done = await h.done;
  await discarding;
  assert.equal(done.persistence.state, 'saved');
  assert.equal(core.internals.ownRuns.has(h.runId), false, 'discardRun itself pruned ownRuns');   // before getRun, which prunes too
  assert.equal(engine.getRun(h.runId), null);
  assert.equal(await inner.get(h.runId), null, 'no store copy remains');
  assert.equal(engine.retentionReport().slotsInUse, 0);
});

test('discardRun deletes the durable copy of a saved set, and of a nonresident id too', async () => {
  const resultStore = createInMemoryResultStore();
  const core = createEngineCore(base({ resultStore }));
  const { engine } = core;
  const h = await savedRun(engine);
  await engine.discardRun(h.runId);
  assert.equal(await resultStore.get(h.runId), null);
  assert.equal(engine.getRun(h.runId), null);
  assert.equal(core.internals.ownRuns.size, 0);
  // Nonresident: the store delete is still issued (§13.5.2, R11-5).
  const other = await savedRun(engine);
  engine.releaseResultSet(other.runId);
  assert.notEqual(await resultStore.get(other.runId), null);
  await engine.discardRun(other.runId);
  assert.equal(await resultStore.get(other.runId), null);
});

test('discardRun with no store releases a held set; it rejects (never throws) a non-string id', async () => {
  const engine = createClashTestEngine(base({ resultStore: null }));
  const h = engine.startRun(validDef());
  await h.done;
  await engine.discardRun(h.runId);                         // the explicit, acknowledged removal
  assert.equal(engine.getRun(h.runId), null);
  assert.equal(engine.retentionReport().slotsInUse, 0);
  await engine.discardRun('no-such-run');                   // nothing to delete: a no-op
  const deletes = [];
  const withStore = createClashTestEngine(base({ resultStore: { ...createInMemoryResultStore(), delete: async (id) => { deletes.push(id); } } }));
  for (const id of [42, null, undefined, {}]) {
    const p = withStore.discardRun(id);
    assert.ok(p instanceof Promise);
    await assert.rejects(p, (err) => err instanceof InvalidOptionsError
      && err.issues[0].path === 'runId' && err.issues[0].code === 'bad-shape');
  }
  assert.deepEqual(deletes, [], 'a non-string id never reaches the store');
});

// ================================================================================================
// The R1 gate: sync methods THROW, Promise-returning ones REJECT, after dispose
// ================================================================================================

test('after dispose the residency surface throws (sync) or rejects (async) EngineDisposedError', async () => {
  const engine = createClashTestEngine(base());
  const h = await savedRun(engine);
  await engine.dispose();
  for (const call of [
    () => engine.retainResultSet(h.runId), () => engine.releaseResultSet(h.runId),
    () => engine.getPersistenceState(h.runId), () => engine.retentionReport(),
  ]) assert.throws(call, EngineDisposedError);
  await assert.rejects(engine.discardRun(h.runId), EngineDisposedError);
  await assert.rejects(engine.retryPersist(h.runId), EngineDisposedError);
});

// ================================================================================================
// dispose(): signal every owned run, then wait; DisposeSummary
// ================================================================================================

test('dispose hands unsaved sets back and names in-flight writes', async () => {
  const engine = createClashTestEngine(base({ resultStore: null, limits: { maxResidentResultSets: SLOT_CAP } }));
  const runs = [];
  for (let i = 0; i < SLOT_CAP; i += 1) { const h = engine.startRun(validDef()); await h.done; runs.push(h.runId); }
  const summary = await engine.dispose();
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId).sort(), [...runs].sort());
  for (const d of summary.droppedUnsaved) {
    assert.ok(Object.isFrozen(d.resultSet));
    assert.equal(d.resultSet.runId, d.runId);
  }
  assert.deepEqual(summary.persistenceInFlight, []);
});

test('dispose does not hand back a SAVED set (it has a durable copy)', async () => {
  const engine = createClashTestEngine(base());
  await savedRun(engine);
  assert.deepEqual(await engine.dispose(), { droppedUnsaved: [], persistenceInFlight: [] });
});

test('dispose forces a hung write\'s terminal event and done closed exactly once', async () => {
  // Persistence that NEVER settles. `requestDispose()` force-closes the run's open finalize window,
  // so neither `done` nor `dispose()` waits for `persistTimeoutMs`, let alone for the put.
  const putCalled = deferred();
  const resultStore = { ...createInMemoryResultStore(), put: () => { putCalled.resolve(); return new Promise(() => {}); } };
  const cfg = base({ resultStore });
  const engine = createClashTestEngine(cfg);
  const h = engine.startRun(validDef());
  const terminals = [];
  h.subscribe((e) => { if (e.type === 'state' && e.terminal) terminals.push(e); });
  await putCalled.promise;
  await settle();
  assert.equal(h.getSnapshot().phase, 'finalizing', 'sealed, write in flight, window open');
  const summary = engine.dispose();                         // BEFORE persistTimeoutMs elapses
  const done = await h.done;
  assert.equal(done.status, 'completed', 'sealed before the dispose: the status is absorbing');
  assert.equal(terminals.length, 1);
  assert.deepEqual(terminals[0].persistence, { state: 'pending', timedOut: true, attempt: 1 });
  assert.deepEqual(done.persistence, { state: 'pending', timedOut: true, attempt: 1 });
  const s = await summary;
  assert.deepEqual(s, { droppedUnsaved: [], persistenceInFlight: [h.runId] });
  assert.equal(cfg.timers.advance(PERSIST_TIMEOUT_MS * 2), 0, 'the window\'s timer was cancelled');
  await settle();
  assert.equal(terminals.length, 1, 'nothing further is emitted');
});

test('dispose signals first and waits second: a blocked in-flight unit DRAINS, then the run seals', async () => {
  // Spec §10.1-§10.2 (F6: drain, not discard) and P6 open item O9: an in-flight unit has NO abort
  // seam, so `dispose()` legitimately stays pending until it returns. The block is controllable and
  // released here; executor non-return is an accepted limit of an injected port.
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({ unitExecutor, resultStore: null }));
  const h = engine.startRun(validDef());
  await unitExecutor.started;                               // the run is INSIDE the unit loop
  const summary = engine.dispose();                         // signals EVERY owned run before any await
  let disposeSettled = false;
  let doneSettled = false;
  summary.then(() => { disposeSettled = true; });
  h.done.then(() => { doneSettled = true; });
  await settle();
  await settle();
  assert.equal(disposeSettled, false, 'dispose() stays PENDING while the in-flight unit drains');
  assert.equal(doneSettled, false, 'and so does `done`: the unit is drained, not discarded');
  assert.equal(h.getSnapshot().status, 'cancelling', 'the signal reached the run before any wait');
  unitExecutor.release();                                   // the drained unit finally returns
  const s = await summary;
  const done = await h.done;
  assert.equal(done.status, 'cancelled');                   // P6 order B: disposeRequested ⇒ cancelled
  assert.equal(done.resultSet.ledger.units[0].outcome, 'evaluated', 'the drained unit is MERGED (§16.7)');
  assert.equal(unitExecutor.calls.length, 1, 'no further unit started');
  assert.ok(Object.isFrozen(done.resultSet));
  assert.ok(done.resultSet.outcome.reasons.includes('engine-disposed'));
  assert.deepEqual(s.droppedUnsaved.map((d) => d.runId), [h.runId]);   // no store ⇒ handed back
  assert.equal(s.droppedUnsaved[0].resultSet, done.resultSet);
});

test('dispose seals a QUEUED run that never reached the head of the queue', async () => {
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({
    unitExecutor, resultStore: null, limits: { maxResidentResultSets: SLOT_CAP },
  }));
  const inFlight = engine.startRun(validDef());
  const queued = engine.startRun(validDef());               // waits behind it: one in-flight run per world
  await unitExecutor.started;
  assert.equal(engine.retentionReport().slotsInUse, 2);
  const summary = engine.dispose();
  const q = await queued.done;                              // settles WITHOUT ever having run, and
  assert.equal(q.status, 'cancelled');                      // BEFORE the head is released: signal-first
  assert.equal(q.resultSet.definition, null);               // the R5 pre-resolution cancelled-set shape
  assert.equal(q.resultSet.ledger.planExists, false);
  assert.equal(unitExecutor.calls.length, 1, 'only the head ever executed');
  unitExecutor.release();                                   // only now does the head's unit drain
  assert.equal((await inFlight.done).status, 'cancelled');
  const s = await summary;
  assert.deepEqual(s.droppedUnsaved.map((d) => d.runId).sort(),
    [inFlight.runId, queued.runId].sort());                 // BOTH were signalled, not only the in-flight one
});

test('concurrent dispose calls share one promise, one summary and one terminal event per run', async () => {
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({ unitExecutor, resultStore: null }));
  const h = engine.startRun(validDef());
  const terminals = [];
  h.subscribe((e) => { if (e.type === 'state' && e.terminal) terminals.push(e); });
  await unitExecutor.started;
  const a = engine.dispose();
  const b = engine.dispose();
  assert.equal(a, b);                                       // the SAME promise object, not an equal one
  unitExecutor.release();
  const [sa, sb] = await Promise.all([a, b]);
  assert.equal(sa, sb);
  assert.equal(terminals.length, 1);                        // requestDispose is idempotent: one finalize
  assert.equal(await engine.dispose(), sa);                 // and after settling, still the same summary
  assert.throws(() => engine.startRun(validDef()), EngineDisposedError);
});
