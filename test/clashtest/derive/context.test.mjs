import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDerivationContext, createContextInternal } from '../../../clashtest/derive/context.js';
import { drive } from '../../../clashtest/derive/steps.js';
import { isAbortSignal } from '../../../clashtest/derive/validate.js';
import { InvalidOptionsError, DerivationBusyError, DerivationAbortedError, EngineDisposedError } from '../../../clashtest/errors.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

const many = (n) => makeResultSet({ units: [U1], results: Array.from({ length: n }, (_, i) => ({ pair: [['M', 100], ['M', 200 + i]] })) });
// A runner that sweeps every result through the gate, so slicing/abort/slots are observable.
const sweep = { optionKeys: ['signal'], prepare: () => ({}),
  async run(_p, [set], { gate }) { let n = 0; for (const _ of set.results) { const p = gate.tick(); if (p) await p; n += 1; } return n; } };
const ctxWith = (limits, h, hooks = {}) => createContextInternal({ limits: { aggregationSliceMaxItems: 2, ...limits }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() },
  { runners: { summarize: sweep, groupBy: sweep, filter: sweep, compare: sweep }, ...hooks });

test('closed options: unknown keys are InvalidOptionsError at every level', async () => {
  assert.throws(() => createDerivationContext({ bogus: 1 }), InvalidOptionsError);
  assert.throws(() => createDerivationContext({ limits: { maxResidentResultSets: 4 } }), InvalidOptionsError); // an engine limit, but not a derivation limit
  assert.throws(() => createDerivationContext({ limits: { maxConcurrentDerivations: 0 } }), InvalidOptionsError); // §17.1.1 validation via P0
  await assert.rejects(ctxWith({}, makeHarness()).summarize(many(1), { nope: true }), InvalidOptionsError);
  await assert.rejects(ctxWith({}, makeHarness()).summarize(many(1), { signal: {} }), InvalidOptionsError);
});

test('the context exposes exactly the four derivations', () => {
  assert.deepEqual(Object.keys(createDerivationContext()).sort(), ['compareResultSets', 'filter', 'groupBy', 'summarize']);
  // (that `derive/index.js` and `clashtest/index.js` export no free-standing derivation is asserted in P8.8)
});

test('sliced execution with a fake scheduler: yields between slices of aggregationSliceMaxItems', async () => {
  const h = makeHarness(); const ctx = ctxWith({}, h);
  assert.equal(await ctx.summarize(many(10)), 10);
  assert.ok(h.yields >= 4 && h.yields <= 10, `yields=${h.yields}`); // 10 items / 2 per slice
});

test('sliced execution honours the time budget on an injected clock', async () => {
  const h = makeHarness({ tickMs: 5 }); // every now() read advances 5 ms > sliceBudgetMs (4)
  const ctx = createContextInternal({ limits: { aggregationSliceMaxItems: 100000 }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, { runners: { summarize: sweep, groupBy: sweep, filter: sweep, compare: sweep } });
  await ctx.summarize(many(200));
  assert.ok(h.yields >= 1, 'a time-exhausted slice must yield');
});

test('DerivationBusyError is immediate, never queues; slot is per context; freed on completion', async () => {
  const h = makeHarness(); const a = ctxWith({ maxConcurrentDerivations: 1 }, h); const b = ctxWith({ maxConcurrentDerivations: 8 }, h);
  h.hold();
  const first = a.summarize(many(10));
  await assert.rejects(a.summarize(many(1)), (e) => e instanceof DerivationBusyError && e.limit === 1);
  const others = Array.from({ length: 8 }, () => b.summarize(many(10)));      // eighth on the other context is fine
  await assert.rejects(b.summarize(many(1)), DerivationBusyError);            // the ninth is not
  h.releaseAll(); await Promise.all([first, ...others]);
  assert.equal(await a.summarize(many(1)), 1);                                // slot was released
});

test('R21-3: the slot is taken BEFORE capture; a busy context never captures', async () => {
  const h = makeHarness(); let captures = 0;
  const ctx = ctxWith({ maxConcurrentDerivations: 1 }, h, { capture: (raw) => { captures += 1; return structuredClone(raw); } });
  h.hold(); const first = ctx.summarize(many(10)); assert.equal(captures, 1);
  await assert.rejects(ctx.summarize(many(10)), DerivationBusyError); assert.equal(captures, 1);
  h.releaseAll(); await first;
});

test('capture-first: mutating the caller object right after the call cannot change the result', async () => {
  const h = makeHarness(); const set = many(6); const p = ctxWith({}, h).summarize(set);
  set.results.length = 0;                       // synchronous mutation after the call, before any await resumes
  assert.equal(await p, 6);
});

test('abort mid-derivation: DerivationAbortedError, stops within a slice, frees the slot', async () => {
  const h = makeHarness(); const ac = new AbortController(); const ctx = ctxWith({ maxConcurrentDerivations: 1 }, h);
  h.onYield = (n) => { if (n === 2) ac.abort(); };
  await assert.rejects(ctx.summarize(many(100), { signal: ac.signal }), DerivationAbortedError);
  assert.ok(h.yields <= 3, `stopped promptly, yields=${h.yields}`);
  h.onYield = null; assert.equal(await ctx.summarize(many(2)), 2);
});

test('an already-aborted signal rejects before taking a slot or capturing', async () => {
  let captures = 0; const ac = new AbortController(); ac.abort();
  const ctx = ctxWith({}, makeHarness(), { capture: (r) => { captures += 1; return r; } });
  await assert.rejects(ctx.summarize(many(1), { signal: ac.signal }), DerivationAbortedError); assert.equal(captures, 0);
});

test('assertOpen hook (engine binding): a disposed engine rejects EngineDisposedError', async () => {
  const ctx = ctxWith({}, makeHarness(), { assertOpen: () => { throw new EngineDisposedError({}); } });
  await assert.rejects(ctx.summarize(many(1)), EngineDisposedError);
});

test('drive(): a generator step that yields to the gate can be aborted', async () => {
  const ac = new AbortController(); const gate = { check() { if (ac.signal.aborted) throw new DerivationAbortedError({}); }, tick() { ac.abort(); this.check(); } };
  await assert.rejects(drive((function* () { yield; yield; })(), gate), DerivationAbortedError);
});

test('a non-function `now` / `yieldToScheduler` is InvalidOptionsError at construction (never a raw TypeError at call time)', () => {
  for (const bad of [1, 'x', {}, null]) {
    assert.throws(() => createDerivationContext({ now: bad }), InvalidOptionsError);
    assert.throws(() => createDerivationContext({ yieldToScheduler: bad }), InvalidOptionsError);
  }
  assert.doesNotThrow(() => createDerivationContext({ now: () => 0, yieldToScheduler: () => Promise.resolve() }));
});

test('isAbortSignal is fail-closed: a hostile getter is not a signal, and the option is InvalidOptionsError', async () => {
  const hostile = { get aborted() { throw new Error('boom'); }, addEventListener() {} };
  assert.equal(isAbortSignal(hostile), false);
  assert.equal(isAbortSignal(new Proxy({}, { get() { throw new Error('trap'); } })), false);
  assert.equal(isAbortSignal(new AbortController().signal), true);
  await assert.rejects(ctxWith({}, makeHarness()).summarize(many(1), { signal: hostile }), InvalidOptionsError);
});
