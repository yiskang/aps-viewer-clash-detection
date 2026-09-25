// test/clashtest/engine/readAbort.ownerRuling8.test.mjs
//
// Owner ruling #8 (2026-09-25) — two Low follow-ups to the A17 read-cancellation surface, both
// raised by the focused independent re-review of `62395b2` and its targeted adjudication:
//
//  N1. `liveFreshness`: when the supplied signal is aborted at the moment the freshness pass's error
//      is observed, the public read rejects `ReadAbortedError` REGARDLESS of the underlying error's
//      type (previously only `EnumerationCancelledError` was mapped). When the signal is NOT
//      aborted, the original error is preserved exactly.
//
//  X1. Cross-realm `AbortSignal` is SUPPORTED. The read-options validation (`readReadOptions`) and
//      `rerun`'s option-bag validation (`readRerunOptions`) no longer use `instanceof AbortSignal`;
//      they check only the surface the engine and the P5 read coordinator use — a boolean
//      `aborted`, `addEventListener` and `removeEventListener` functions — and stay fail-closed for
//      anything malformed (including an object whose members throw).
//
// G-CAL: limits are named, non-default test constants; time is a fake clock; no wall-clock assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { InvalidOptionsError, ReadAbortedError, ReadCapacityError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

const ONE_READ = 1;
const QUEUE_DEPTH = 2;

const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const isAbort = (e) => e instanceof ReadAbortedError && e.name === 'ReadAbortedError';
const cleanDef = () => makeDefinition({ testId: 'T' });
const READS = ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim'];

/**
 * A signal from ANOTHER REALM: created inside a fresh `vm` context, so it shares no prototype with
 * this realm (`instanceof AbortSignal` and `instanceof Object` are both false — asserted). It
 * implements only the standard surface: `aborted`, `addEventListener` (honouring `{once}`), `removeEventListener`.
 * `listenerCount()` is a test-only probe of leaked listeners.
 */
function foreignSignal() {
  const context = vm.createContext({});
  const controller = vm.runInContext(`(() => {
    const listeners = [];
    let aborted = false;
    const signal = {
      get aborted() { return aborted; },
      addEventListener(type, fn, options) { if (type === 'abort') listeners.push({ fn, once: options?.once === true }); },
      removeEventListener(type, fn) { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    };
    return {
      signal,
      abort() {
        if (aborted) return;
        aborted = true;
        for (const l of [...listeners]) {
          if (l.once) signal.removeEventListener('abort', l.fn);      // standard once:true semantics
          l.fn({ type: 'abort' });
        }
      },
      listenerCount() { return listeners.length; },
    };
  })()`, context);
  assert.equal(controller.signal instanceof AbortSignal, false, 'a foreign signal is not an AbortSignal of this realm');
  assert.equal(controller.signal instanceof Object, false, 'a foreign signal shares no prototype with this realm');
  return controller;
}

/** The engine world with a gated/spying result store and a hookable enumerator. */
function base({ limits } = {}) {
  const world = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const probe = { gets: 0, gate: null, entered: null, digestHook: null };
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
  const innerEnum = world.enumerator;
  const enumerator = {
    ...innerEnum,
    async digestScope(binding, scope, ctx) {
      if (probe.digestHook) return probe.digestHook(() => innerEnum.digestScope(binding, scope, ctx), ctx);
      return innerEnum.digestScope(binding, scope, ctx);
    },
  };
  const cfg = world.config({
    enumerator, resultStore, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    ...(limits ? { limits } : {}),
  });
  return Object.assign(cfg, { probe });
}

async function savedRun(engine, { release = false } = {}) {
  const h = engine.startRun(cleanDef());
  await h.persisted;
  const { resultSet } = await h.done;
  if (release) engine.releaseResultSet(h.runId);
  return { runId: h.runId, set: resultSet };
}

// ================================================================================================
// N1: an aborted signal wins over any underlying freshness error
// ================================================================================================

/** An observation whose `kind` accessor throws: read by `compareScopeExpectation`, OUTSIDE the bracket's enumerator-error catch. */
const hostileObservation = (error) => ({ get kind() { throw error; } });

test('N1: a NON-EnumerationCancelledError freshness failure racing with an abort rejects ReadAbortedError', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const resident = await savedRun(engine);
  const stored = await savedRun(engine, { release: true });
  const inputs = { 'resident by id': () => resident.runId, 'stored by id': () => stored.runId, raw: () => structuredClone(resident.set) };
  for (const m of READS) {
    for (const [kind, input] of Object.entries(inputs)) {
      const ac = new AbortController();
      const failure = new Error('malformed-observation');
      cfg.probe.digestHook = async () => { ac.abort(); return hostileObservation(failure); };
      let outcome;
      await engine[m](input(), { signal: ac.signal }).then((v) => { outcome = { resolved: v }; }, (e) => { outcome = { rejected: e }; });
      cfg.probe.digestHook = null;
      const label = `${m} ${kind}`;
      assert.ok(outcome.rejected, `${label}: must reject, got ${JSON.stringify(outcome.resolved)}`);
      assert.ok(isAbort(outcome.rejected), `${label}: got ${outcome.rejected?.name}: ${outcome.rejected?.message}`);
      assert.notEqual(outcome.rejected, failure, `${label}: the underlying error does not leak in place of ReadAbortedError`);
      assert.equal(engine.retentionReport().readSlotsInUse, 0, `${label}: slot released`);
    }
  }
});

test('N1: the same race with a different error type (TypeError thrown by the accessor) is also ReadAbortedError', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine);
  const ac = new AbortController();
  cfg.probe.digestHook = async () => { ac.abort(); return hostileObservation(new TypeError('boom')); };
  await assert.rejects(engine.getFreshness(runId, { signal: ac.signal }), isAbort);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('N1: when the signal is NOT aborted the original error is preserved exactly (signalled and unsignalled)', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine);
  const failure = new Error('malformed-observation');
  cfg.probe.digestHook = async () => hostileObservation(failure);
  const signal = new AbortController().signal;
  await assert.rejects(engine.getFreshness(runId, { signal }), (e) => e === failure, 'signalled, not aborted');
  await assert.rejects(engine.getFreshness(runId), (e) => e === failure, 'no signal at all');
  cfg.probe.digestHook = null;
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ================================================================================================
// X1: cross-realm AbortSignal is supported (both validation sites)
// ================================================================================================

test('X1: a same-realm AbortSignal is accepted by every read and by rerun (control)', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId, set } = await savedRun(engine);
  const signal = new AbortController().signal;
  assert.equal((await engine.getResultSet(runId, { signal })).runId, runId);
  for (const m of READS) assert.ok(await engine[m](runId, { signal }), m);
  assert.ok(await engine.listTests({}, { signal }));
  assert.ok(await engine.listResults({}, { signal }));
  assert.equal((await (await engine.rerun(runId, { signal })).done).resultSet.derivedFromRunId, runId);
  assert.ok(await engine.assessNoClashClaim(structuredClone(set), { signal }));
});

test('X1: a cross-realm-compatible signal is accepted at BOTH sites and changes nothing while un-aborted', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const resident = await savedRun(engine);
  const stored = await savedRun(engine, { release: true });
  const { signal, listenerCount } = foreignSignal();
  // Site 1: readReadOptions.
  assert.deepEqual(await engine.getResultSet(stored.runId, { signal }), await engine.getResultSet(stored.runId));
  assert.equal(await engine.getResultSet(resident.runId, { signal }), resident.set);
  for (const m of READS) {
    for (const input of [resident.runId, stored.runId]) {
      assert.deepEqual(await engine[m](input, { signal }), await engine[m](input), `${m} ${input}`);
    }
    assert.deepEqual(await engine[m](structuredClone(resident.set), { signal }), await engine[m](structuredClone(resident.set)), `${m} raw`);
  }
  assert.deepEqual(await engine.listTests({}, { signal }), await engine.listTests({}));
  assert.deepEqual(await engine.listResults({}, { signal }), await engine.listResults({}));
  // Site 2: readRerunOptions.
  const h = await engine.rerun(resident.runId, { signal });
  assert.equal((await h.done).resultSet.derivedFromRunId, resident.runId);
  const h2 = await engine.rerun(stored.runId, { signal });
  assert.equal((await h2.done).resultSet.derivedFromRunId, stored.runId);
  assert.equal(listenerCount(), 0, 'no abort listener is left registered on the foreign signal');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('X1: an ALREADY-aborted cross-realm signal rejects ReadAbortedError before any slot, capture or store call', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const resident = await savedRun(engine);
  const stored = await savedRun(engine, { release: true });
  const foreign = foreignSignal();
  foreign.abort();
  cfg.probe.gets = 0;
  const calls = [
    ['getResultSet stored', () => engine.getResultSet(stored.runId, { signal: foreign.signal })],
    ['getResultSet resident', () => engine.getResultSet(resident.runId, { signal: foreign.signal })],
    ['listTests', () => engine.listTests({}, { signal: foreign.signal })],
    ['listResults', () => engine.listResults({}, { signal: foreign.signal })],
    ['rerun stored', () => engine.rerun(stored.runId, { signal: foreign.signal })],
    ['rerun resident', () => engine.rerun(resident.runId, { signal: foreign.signal })],
  ];
  for (const m of READS) {
    calls.push([`${m} stored`, () => engine[m](stored.runId, { signal: foreign.signal })]);
    calls.push([`${m} resident`, () => engine[m](resident.runId, { signal: foreign.signal })]);
    calls.push([`${m} raw`, () => engine[m](structuredClone(resident.set), { signal: foreign.signal })]);
  }
  const runsBefore = engine.retentionReport().slotsInUse;
  for (const [name, call] of calls) {
    await assert.rejects(call(), isAbort, name);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, name);
  }
  assert.equal(cfg.probe.gets, 0, 'no store.get');
  assert.equal(engine.retentionReport().slotsInUse, runsBefore, 'no run slot taken');
  assert.equal(foreign.listenerCount(), 0);
});

test('X1: a cross-realm signal aborted WHILE QUEUED removes the waiter, releases its listener, and keeps FIFO', async () => {
  const cfg = base({ limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH } });
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine, { release: true });
  const gate = deferred();
  cfg.probe.gate = gate.promise;
  cfg.probe.entered = deferred();
  cfg.probe.gets = 0;
  const order = [];
  const track = (name, p) => p.then((v) => { order.push(name); return v; });

  const a = track('a', engine.getFreshness(runId));                         // holds the slot, parked in get
  await cfg.probe.entered.promise;
  const foreign = foreignSignal();
  const b = engine.canClaimNoClashes(runId, { signal: foreign.signal });    // queued (1)
  const c = track('c', engine.getResultSet(runId));                         // queued (2): the queue is full
  await assert.rejects(engine.assessNoClashClaim(runId), ReadCapacityError, 'full before the abort');
  assert.equal(foreign.listenerCount(), 1, 'the queued waiter listens on the foreign signal');
  foreign.abort();
  await assert.rejects(b, isAbort);
  assert.equal(foreign.listenerCount(), 0, 'the listener is released with the waiter');
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, 'the aborted waiter never held a slot');
  const d = track('d', engine.assessNoClashClaim(runId));                   // takes the freed queue place
  cfg.probe.gate = null;
  gate.resolve();
  const [fa, sc, ad] = await Promise.all([a, c, d]);
  assert.deepEqual(fa, { state: 'current', reasons: [] });
  assert.equal(sc.runId, runId);
  assert.equal(ad.allowed, true);
  assert.deepEqual(order, ['a', 'c', 'd'], 'FIFO order of the remaining waiters');
  assert.equal(cfg.probe.gets, 3, 'the aborted waiter never reached the store');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('X1: an abort of a cross-realm signal during a pending store.get holds the slot until it settles, then rejects', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine, { release: true });
  const gate = deferred();
  cfg.probe.gate = gate.promise;
  cfg.probe.entered = deferred();
  const foreign = foreignSignal();
  const p = engine.getFreshness(runId, { signal: foreign.signal });
  await cfg.probe.entered.promise;
  foreign.abort();
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, 'held until the get settles');
  cfg.probe.gate = null;
  gate.resolve();
  await assert.rejects(p, isAbort);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('X1: malformed signal-like values are rejected fail-closed at BOTH sites', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine);
  let memberCalls = 0;
  const noop = () => { memberCalls += 1; };
  const bad = {
    'aborted only': { aborted: false },
    'no removeEventListener': { aborted: false, addEventListener: noop },
    'no addEventListener': { aborted: false, removeEventListener: noop },
    'non-boolean aborted': { aborted: 'no', addEventListener: noop, removeEventListener: noop },
    'undefined aborted': { addEventListener: noop, removeEventListener: noop },
    'non-function listeners': { aborted: false, addEventListener: 1, removeEventListener: 2 },
    'string': 'abort',
    number: 7,
    null: null,
    'function with the members': Object.assign(() => {}, { aborted: false, addEventListener: noop, removeEventListener: noop }),
    'throwing aborted getter': { get aborted() { throw new Error('hostile'); }, addEventListener: noop, removeEventListener: noop },
    'throwing proxy': new Proxy({}, { get() { throw new Error('hostile'); }, has() { throw new Error('hostile'); } }),
  };
  for (const [name, signal] of Object.entries(bad)) {
    const check = (e) => e instanceof InvalidOptionsError && e.issues.some((i) => i.path === '/signal' && i.code === 'bad-shape');
    await assert.rejects(engine.getResultSet(runId, { signal }), check, `getResultSet: ${name}`);
    await assert.rejects(engine.getFreshness(runId, { signal }), check, `getFreshness: ${name}`);
    await assert.rejects(engine.listResults({}, { signal }), check, `listResults: ${name}`);
    await assert.rejects(engine.rerun(runId, { signal }), check, `rerun: ${name}`);
  }
  assert.equal(memberCalls, 0, 'a malformed value\'s members are never invoked');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('X1: a signal-like object with a throwing member never surfaces the hostile error (InvalidOptionsError only)', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine);
  const hostile = new Error('hostile-member');
  const signal = { get aborted() { throw hostile; }, addEventListener() {}, removeEventListener() {} };
  const outcome = await engine.getFreshness(runId, { signal }).then(() => null, (e) => e);
  assert.ok(outcome instanceof InvalidOptionsError, `got ${outcome?.name}`);
  assert.notEqual(outcome, hostile);
});

test('X1: no read produced an unhandled rejection', async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(unhandled, []);
});
