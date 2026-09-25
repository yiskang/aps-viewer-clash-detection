// test/clashtest/engine/readAbort.test.mjs
//
// Owner ruling M3 / D-7 (2026-09-25, spec §25 A17): P7 owns read cancellation on its public read
// surface. Every public read that can wait on a read slot or a store read-through takes ONE closed
// read-options shape `{signal?}` as its trailing argument — `getResultSet(runId, opts)`,
// `getFreshness(input, opts)`, `canClaimNoClashes(input, opts)`, `assessNoClashClaim(input, opts)`,
// `listTests(page, opts)`, `listResults(page, opts)` — and `rerun`'s option bag gains a `signal` key
// (read phase only; after admission the caller uses `handle.cancel`). An abort REJECTS
// `ReadAbortedError` (spec §13.5.2, AC-13) and releases the slot:
//   - already aborted: before any slot, capture or store call;
//   - while queued for a slot: the waiter leaves P5's FIFO (additive `acquire({signal})`);
//   - during validation / freeze: at the next slice boundary (a signal-aware slicer);
//   - during an in-flight `ResultStore.get`: the get itself cannot be aborted (the port has no
//     signal), so the slot is held until it settles, then the read rejects;
//   - during freshness: the engine's `ctx.checkpoint` throws `EnumerationCancelledError`, which the
//     bracket propagates, and the engine maps it to `ReadAbortedError` — NEVER a resolved
//     `{state:'unverifiable'}`.
//
// G-CAL: limits are named, non-default test constants; time is a fake clock; no wall-clock assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import {
  InvalidOptionsError, ReadAbortedError, ReadCapacityError,
} from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

/** Named, NON-default limits (G-CAL). */
const ONE_READ = 1;
const QUEUE_DEPTH = 2;
const EVERY_ITEM = 1;                 // aggregationSliceMaxItems: every slicer tick is a slice boundary

const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const abortedSignal = () => { const ac = new AbortController(); ac.abort(); return ac.signal; };
const isAbort = (e) => e instanceof ReadAbortedError && e.name === 'ReadAbortedError';
const cleanDef = () => makeDefinition({ testId: 'T' });
/** true when `p` is still pending after a macrotask. */
const stillPending = (p) => Promise.race([
  p.then(() => false, () => false),
  new Promise((resolve) => setTimeout(() => resolve(true), 0)),
]);

/**
 * The engine world with a fake clock, a spying/gated result store and test store, a spying enumerator
 * (`probe.onDigest(ctx)` runs before each digest; `probe.ignoreCheckpoint` hands the inner enumerator
 * a no-op ctx, i.e. a NON-cooperating enumerator), and a spanRecorder hook (`probe.onSpan(label)`).
 */
function base({ limits, ...extra } = {}) {
  const world = createEngineWorld();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 25) });
  const probe = {
    gets: 0, lists: 0, testLists: 0, digests: 0, gate: null, entered: null,
    onDigest: null, ignoreCheckpoint: false, onSpan: null, labels: [],
  };
  const inner = createInMemoryResultStore();
  const resultStore = {
    ...inner,
    async get(...args) {
      probe.gets += 1;
      probe.entered?.resolve();
      if (probe.gate) await probe.gate;
      return inner.get(...args);
    },
    async list(...args) {
      probe.lists += 1;
      probe.entered?.resolve();
      if (probe.gate) await probe.gate;
      return inner.list(...args);
    },
  };
  const innerTests = createInMemoryClashTestStore();
  const testStore = {
    ...innerTests,
    async list(...args) { probe.testLists += 1; return innerTests.list(...args); },
  };
  const innerEnum = world.enumerator;
  const enumerator = {
    ...innerEnum,
    async digestScope(binding, scope, ctx) {
      probe.digests += 1;
      if (probe.onDigest) probe.onDigest(ctx);
      return innerEnum.digestScope(binding, scope, probe.ignoreCheckpoint ? { checkpoint() {} } : ctx);
    },
  };
  const cfg = world.config({
    enumerator, resultStore, testStore, now: clock.now, yieldToScheduler: clock.yieldToScheduler,
    spanRecorder: (label) => { probe.labels.push(label); if (probe.onSpan) probe.onSpan(label); },
    ...(limits ? { limits } : {}),
    ...extra,
  });
  return Object.assign(cfg, { probe });
}

/** A completed, saved run; `release` drops the resident copy so by-id reads go through the store. */
async function savedRun(engine, { release = false } = {}) {
  const h = engine.startRun(cleanDef());
  await h.persisted;
  const { resultSet } = await h.done;
  if (release) engine.releaseResultSet(h.runId);
  return { runId: h.runId, set: resultSet };
}

/** A raw set behind a Proxy that counts every trap: capture has not started iff `traps()` is 0. */
function countingProxy(value) {
  let traps = 0;
  const handler = {};
  for (const trap of ['get', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf']) {
    handler[trap] = (...args) => { traps += 1; return Reflect[trap](...args); };
  }
  return { proxy: new Proxy(value, handler), traps: () => traps };
}

const READS = ['getFreshness', 'canClaimNoClashes', 'assessNoClashClaim'];

// ================================================================================================
// Already aborted: nothing is reserved, captured or read
// ================================================================================================

test('listTests/listResults: an already-aborted signal wins over a trapping page (no capture of `page` first)', async () => {
  const cfg = base();
  const { engine } = createEngineCore(cfg);
  const signal = abortedSignal();
  let trapped = 0;
  const trappingPage = () => new Proxy({}, {
    get() { trapped += 1; throw new Error('page was captured before the abort check'); },
    ownKeys() { trapped += 1; throw new Error('page was captured before the abort check'); },
    getPrototypeOf() { trapped += 1; throw new Error('page was captured before the abort check'); },
  });
  for (const m of ['listTests', 'listResults']) {
    await assert.rejects(engine[m](trappingPage(), { signal }), isAbort, m);
  }
  assert.equal(trapped, 0, 'no trap of the page proxy ran');
});

test('an already-aborted signal rejects ReadAbortedError before any slot, capture or store call', async () => {
  const cfg = base();
  const { engine, internals } = createEngineCore(cfg);
  const resident = await savedRun(engine);
  const stored = await savedRun(engine, { release: true });
  const runsBefore = internals.ownRuns.size;
  const slotsBefore = engine.retentionReport().slotsInUse;
  cfg.probe.gets = 0; cfg.probe.lists = 0; cfg.probe.testLists = 0; cfg.probe.digests = 0;

  const signal = abortedSignal();
  const calls = [
    ['getResultSet stored', () => engine.getResultSet(stored.runId, { signal })],
    ['getResultSet resident', () => engine.getResultSet(resident.runId, { signal })],
    ['listTests', () => engine.listTests({}, { signal })],
    ['listResults', () => engine.listResults({}, { signal })],
    ['rerun stored', () => engine.rerun(stored.runId, { signal })],
    ['rerun resident', () => engine.rerun(resident.runId, { signal })],
  ];
  for (const m of READS) {
    calls.push([`${m} stored`, () => engine[m](stored.runId, { signal })]);
    calls.push([`${m} resident`, () => engine[m](resident.runId, { signal })]);   // R-P7-20: no slot, still honoured
  }
  for (const [name, call] of calls) {
    const p = call();
    assert.ok(p instanceof Promise, `${name}: a rejection, never a synchronous throw`);
    await assert.rejects(p, isAbort, name);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, name);
  }
  // Raw sets: the capture never began (no trap of the proxy ran) and no slot was reserved.
  for (const call of [...READS.map((m) => (x) => engine[m](x, { signal })), (x) => engine.rerun(x, { signal })]) {
    const { proxy, traps } = countingProxy(structuredClone(resident.set));
    await assert.rejects(call(proxy), isAbort);
    assert.equal(traps(), 0, 'capture never started');
  }
  assert.equal(cfg.probe.gets, 0, 'no store.get');
  assert.equal(cfg.probe.lists + cfg.probe.testLists, 0, 'no store.list');
  assert.equal(cfg.probe.digests, 0, 'no freshness pass');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  assert.equal(internals.ownRuns.size, runsBefore, 'no rerun started');
  assert.equal(engine.retentionReport().slotsInUse, slotsBefore, 'no run slot taken');
});

// ================================================================================================
// Aborted while queued behind a held slot: the waiter leaves the FIFO
// ================================================================================================

test('an abort while QUEUED removes the waiter: slots and queue depth return, the next caller is admitted, FIFO kept', async () => {
  const cfg = base({ limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: QUEUE_DEPTH } });
  const engine = createClashTestEngine(cfg);
  const { runId } = await savedRun(engine, { release: true });
  const gate = deferred();
  cfg.probe.gate = gate.promise;
  cfg.probe.entered = deferred();
  cfg.probe.gets = 0;
  const order = [];
  const track = (name, p) => p.then((v) => { order.push(name); return v; });

  const a = track('a', engine.getFreshness(runId));                          // holds the slot, parked in get
  await cfg.probe.entered.promise;
  const ac = new AbortController();
  const b = engine.canClaimNoClashes(runId, { signal: ac.signal });          // queued (1)
  const c = track('c', engine.getResultSet(runId));                          // queued (2): the queue is full
  await assert.rejects(engine.assessNoClashClaim(runId), ReadCapacityError, 'full before the abort');
  ac.abort();
  await assert.rejects(b, isAbort);
  assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, 'the aborted waiter never held a slot');
  const d = track('d', engine.assessNoClashClaim(runId));                    // takes the freed queue place
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

test('listTests / listResults: an abort while queued removes the waiter too', async () => {
  const cfg = base({ limits: { maxConcurrentStoreReads: ONE_READ, maxQueuedStoreReads: ONE_READ } });
  const engine = createClashTestEngine(cfg);
  await savedRun(engine);
  const gate = deferred();
  cfg.probe.gate = gate.promise;
  cfg.probe.entered = deferred();
  const first = engine.listResults({});
  await cfg.probe.entered.promise;
  for (const call of [(o) => engine.listTests({}, o), (o) => engine.listResults({}, o)]) {
    const ac = new AbortController();
    const queued = call({ signal: ac.signal });
    await assert.rejects(engine.listTests({}), ReadCapacityError, 'the queue (depth 1) is full');
    ac.abort();
    await assert.rejects(queued, isAbort);
  }
  cfg.probe.gate = null;
  gate.resolve();
  assert.equal((await first).summaries.length, 1);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ================================================================================================
// Aborted during an in-flight store read: the slot is held until the get settles
// ================================================================================================

test('an abort during a pending store.get keeps the slot until the get settles, then rejects and releases it', async () => {
  const methods = {
    getResultSet: (e, id, o) => e.getResultSet(id, o),
    getFreshness: (e, id, o) => e.getFreshness(id, o),
    canClaimNoClashes: (e, id, o) => e.canClaimNoClashes(id, o),
    assessNoClashClaim: (e, id, o) => e.assessNoClashClaim(id, o),
    listResults: (e, _id, o) => e.listResults({}, o),
  };
  for (const [name, call] of Object.entries(methods)) {
    const cfg = base();
    const engine = createClashTestEngine(cfg);
    const { runId } = await savedRun(engine, { release: true });
    const gate = deferred();
    cfg.probe.gate = gate.promise;
    cfg.probe.entered = deferred();
    cfg.probe.digests = 0;
    const ac = new AbortController();
    const p = call(engine, runId, { signal: ac.signal });
    await cfg.probe.entered.promise;
    ac.abort();
    assert.equal(await stillPending(p), true, `${name}: the in-flight get is not abandoned`);
    assert.equal(engine.retentionReport().readSlotsInUse, ONE_READ, `${name}: the slot is held until the get settles`);
    cfg.probe.gate = null;
    gate.resolve();
    await assert.rejects(p, isAbort, name);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, `${name}: released`);
    assert.equal(cfg.probe.digests, 0, `${name}: no freshness pass after the abort`);
  }
});

test('a by-id rerun aborted during its read phase starts no run and holds no run slot', async () => {
  const cfg = base();
  const { engine, internals } = createEngineCore(cfg);
  const { runId } = await savedRun(engine, { release: true });
  const gate = deferred();
  cfg.probe.gate = gate.promise;
  cfg.probe.entered = deferred();
  const runsBefore = internals.ownRuns.size;
  const slotsBefore = engine.retentionReport().slotsInUse;
  const ac = new AbortController();
  const p = engine.rerun(runId, { signal: ac.signal });
  await cfg.probe.entered.promise;
  ac.abort();
  cfg.probe.gate = null;
  gate.resolve();
  await assert.rejects(p, isAbort);
  assert.equal(internals.ownRuns.size, runsBefore, 'no run handle');
  assert.equal(engine.retentionReport().slotsInUse, slotsBefore, 'no run slot');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  // After admission the signal no longer applies: the handle is cancelled with handle.cancel.
  const ac2 = new AbortController();
  const h = await engine.rerun(runId, { signal: ac2.signal });
  ac2.abort();
  const summary = await h.done;
  assert.equal(summary.resultSet.derivedFromRunId, runId);
  assert.notEqual(summary.resultSet.outcome.status, 'cancelled', 'a post-admission abort does not touch the run');
});

// ================================================================================================
// Aborted mid-validation / mid-freeze: at the next slice boundary
// ================================================================================================

test('an abort during validation or freeze rejects at the next slice boundary and releases the slot', async () => {
  for (const phase of ['validate:', 'freeze']) {
    const cases = {
      'getFreshness raw': (e, x, o) => e.getFreshness(structuredClone(x.set), o),
      'canClaimNoClashes raw': (e, x, o) => e.canClaimNoClashes(structuredClone(x.set), o),
      'assessNoClashClaim raw': (e, x, o) => e.assessNoClashClaim(structuredClone(x.set), o),
      'rerun raw': (e, x, o) => e.rerun(structuredClone(x.set), o),
      'getResultSet by id': (e, x, o) => e.getResultSet(x.runId, o),
      'getFreshness by id': (e, x, o) => e.getFreshness(x.runId, o),
      'rerun by id': (e, x, o) => e.rerun(x.runId, o),
    };
    for (const [name, call] of Object.entries(cases)) {
      const cfg = base({ limits: { aggregationSliceMaxItems: EVERY_ITEM } });
      const { engine, internals } = createEngineCore(cfg);
      const saved = await savedRun(engine, { release: true });
      const runsBefore = internals.ownRuns.size;
      cfg.probe.digests = 0;
      cfg.probe.labels.length = 0;
      const ac = new AbortController();
      let spansAfterAbort = 0;
      cfg.probe.onSpan = (label) => {
        if (ac.signal.aborted) spansAfterAbort += 1;
        else if (label.startsWith(phase)) ac.abort();              // the abort lands during this yield
      };
      const p = call(engine, saved, { signal: ac.signal });
      await assert.rejects(p, isAbort, `${phase} ${name}`);
      cfg.probe.onSpan = null;
      assert.equal(ac.signal.aborted, true, `${phase} ${name}: the phase was reached`);
      assert.equal(spansAfterAbort, 0, `${phase} ${name}: no further slice ran after the abort`);
      assert.equal(cfg.probe.digests, 0, `${phase} ${name}: no freshness pass`);
      assert.equal(engine.retentionReport().readSlotsInUse, 0, `${phase} ${name}: slot released`);
      assert.equal(internals.ownRuns.size, runsBefore, `${phase} ${name}: no run started`);
    }
  }
});

// ================================================================================================
// Aborted mid-freshness: ReadAbortedError, never a resolved `unverifiable`
// ================================================================================================

test('an abort during the freshness pass rejects ReadAbortedError, never a resolved unverifiable', async () => {
  for (const cooperative of [true, false]) {
    const cfg = base();
    const engine = createClashTestEngine(cfg);
    const resident = await savedRun(engine);
    const stored = await savedRun(engine, { release: true });
    cfg.probe.ignoreCheckpoint = !cooperative;
    const inputs = {
      'resident by id': resident.runId,
      'stored by id': stored.runId,
      raw: null,
    };
    for (const m of READS) {
      for (const [kind, input] of Object.entries(inputs)) {
        const ac = new AbortController();
        let digestsAfterAbort = 0;
        cfg.probe.onDigest = () => {
          if (ac.signal.aborted) digestsAfterAbort += 1;
          else ac.abort();                                         // abort inside the first digest
        };
        const p = engine[m](input ?? structuredClone(resident.set), { signal: ac.signal });
        let outcome;
        await p.then((v) => { outcome = { resolved: v }; }, (e) => { outcome = { rejected: e }; });
        cfg.probe.onDigest = null;
        const label = `${m} ${kind} (cooperative enumerator: ${cooperative})`;
        assert.ok(outcome.rejected, `${label}: must reject, got ${JSON.stringify(outcome.resolved)}`);
        assert.ok(isAbort(outcome.rejected), `${label}: ${outcome.rejected?.name}`);
        if (cooperative) assert.equal(digestsAfterAbort, 0, `${label}: the checkpoint stopped the pass`);
        assert.equal(engine.retentionReport().readSlotsInUse, 0, label);
      }
    }
  }
});

// ================================================================================================
// The closed read-options shape
// ================================================================================================

test('read options are closed: unknown keys, a non-AbortSignal signal and non-objects reject InvalidOptionsError', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const { runId, set } = await savedRun(engine);
  cfg.probe.gets = 0;
  const methods = {
    getResultSet: (o) => engine.getResultSet(runId, o),
    getFreshness: (o) => engine.getFreshness(runId, o),
    canClaimNoClashes: (o) => engine.canClaimNoClashes(runId, o),
    assessNoClashClaim: (o) => engine.assessNoClashClaim(structuredClone(set), o),
    listTests: (o) => engine.listTests({}, o),
    listResults: (o) => engine.listResults({}, o),
  };
  let getterCalls = 0;
  const bad = [
    [{ zzz: 1 }, '/zzz', 'unknown-key'],
    [{ signal: { aborted: false } }, '/signal', 'bad-shape'],
    [{ signal: 'abort' }, '/signal', 'bad-shape'],
    [{ signal: null }, '/signal', 'bad-shape'],
    [{ get signal() { getterCalls += 1; return new AbortController().signal; } }, '/signal', 'bad-shape'],
    [null, '', 'bad-shape'],
    [42, '', 'bad-shape'],
    [[], '', 'bad-shape'],
  ];
  for (const [name, call] of Object.entries(methods)) {
    for (const [index, [opts, path, code]] of bad.entries()) {
      const p = call(opts);
      assert.ok(p instanceof Promise, name);
      await assert.rejects(p, (e) => e instanceof InvalidOptionsError
        && e.issues.some((i) => i.path === path && i.code === code), `${name} bad[${index}]`);
    }
  }
  // rerun's bag: `signal` is now a member, with the same type rule.
  for (const [opts, path, code] of [[{ signal: 'abort' }, '/signal', 'bad-shape'], [{ zzz: 1 }, '/zzz', 'unknown-key']]) {
    await assert.rejects(engine.rerun(runId, opts), (e) => e instanceof InvalidOptionsError
      && e.issues.some((i) => i.path === path && i.code === code));
  }
  assert.equal(getterCalls, 0, 'a getter is refused, never invoked');
  assert.equal(cfg.probe.gets, 0);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('an un-aborted signal changes nothing: every result equals the no-signal result', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const resident = await savedRun(engine);
  const stored = await savedRun(engine, { release: true });
  const signal = new AbortController().signal;
  for (const m of READS) {
    for (const input of [resident.runId, stored.runId]) {
      assert.deepEqual(await engine[m](input, { signal }), await engine[m](input), `${m} ${input}`);
      assert.deepEqual(await engine[m](input, {}), await engine[m](input), `${m} {}`);
      assert.deepEqual(await engine[m](input, undefined), await engine[m](input), `${m} undefined`);
    }
    assert.deepEqual(await engine[m](structuredClone(resident.set), { signal }), await engine[m](structuredClone(resident.set)), `${m} raw`);
  }
  assert.deepEqual(await engine.getResultSet(stored.runId, { signal }), await engine.getResultSet(stored.runId));
  assert.equal(await engine.getResultSet(resident.runId, { signal }), resident.set);
  assert.equal(await engine.getResultSet(42, { signal }), null, 'a non-string id keeps its null contract');
  assert.deepEqual(await engine.listTests({}, { signal }), await engine.listTests({}));
  assert.deepEqual(await engine.listResults({}, { signal }), await engine.listResults({}));
  const h = await engine.rerun(resident.runId, { signal });
  assert.equal((await h.done).resultSet.derivedFromRunId, resident.runId);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('no read abort produced an unhandled rejection', async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(unhandled, []);
});
