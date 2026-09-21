// test/clashtest/util/slicer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlicer, makeYieldToScheduler } from '../../../clashtest/util/slicer.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { createFakeClock } from '../support/index.mjs';

const mk = (clock, extra = {}) => createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, ...extra });

test('tick() is synchronous (returns undefined) until a yield is due, then returns a Promise', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  assert.equal(s.tick(), undefined);
  clock.advance(3); assert.equal(s.tick(), undefined);        // 3 ms < 4 ms budget
  clock.advance(1);
  const p = s.tick();
  assert.ok(p instanceof Promise);
  await p;
  assert.equal(clock.yieldCount, 1);
});

test('the clock is only read every checkEvery items (default 64), not on every tick', () => {
  let reads = 0;
  const s = createSlicer({ now: () => { reads++; return 0; }, yieldToScheduler: async () => {}, sliceBudgetMs: 4, maxItemsPerSlice: 1_000_000 });
  const afterConstruction = reads;
  for (let i = 0; i < 63; i++) s.tick();
  assert.equal(reads, afterConstruction);                     // no clock read within the first 63 items
  s.tick();
  assert.equal(reads, afterConstruction + 1);                 // the 64th tick reads it once
});

test('a slice yields once the budget elapsed and the next slice starts fresh', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  let yieldsSeen = 0;
  for (let i = 0; i < 20; i++) {
    clock.advance(1);                                         // each item costs 1 ms
    const p = s.tick('work'); if (p) { await p; yieldsSeen++; }
  }
  assert.equal(yieldsSeen, 5);                                // every 4th item
  assert.equal(clock.yieldCount, 5);
  assert.deepEqual(s.stats(), { ticks: 20, yields: 5 });
});

test('aggregationSliceMaxItems is a secondary ceiling: it yields even when the clock says there is time', async () => {
  const clock = createFakeClock();                            // time never advances
  const s = mk(clock, { sliceBudgetMs: 1_000_000, checkEvery: 1_000_000, maxItemsPerSlice: 10 });
  for (let i = 0; i < 25; i++) { const p = s.tick(); if (p) await p; }
  assert.equal(clock.yieldCount, 2);                          // at item 10 and 20
});

test('defaults come from the resolved engine limits (options.js), overridable per option', () => {
  const clock = createFakeClock();
  const s = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, checkEvery: 1 });
  for (let i = 0; i < ENGINE_LIMIT_DEFAULTS.aggregationSliceMaxItems - 1; i++) assert.equal(s.tick(), undefined);
  assert.ok(s.tick() instanceof Promise);
  assert.throws(() => createSlicer({ sliceBudgetMs: 0 }), TypeError);
  assert.throws(() => createSlicer({ maxItemsPerSlice: 1.5 }), TypeError);
});

test('reset() restarts the current slice without yielding and leaves stats() alone (a reused slicer must not yield at once after non-sliced time)', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 3 });
  s.tick(); s.tick();                                         // 2 of 3 items used in this slice
  clock.advance(100);                                         // a long NON-sliced span (e.g. awaiting findClashes)
  assert.equal(s.reset(), undefined);
  assert.equal(clock.yieldCount, 0);                          // reset never yields
  assert.equal(s.tick(), undefined);                          // fresh slice: 0 ms elapsed, item 1
  assert.equal(s.tick(), undefined);                          // item 2
  assert.deepEqual(s.stats(), { ticks: 4, yields: 0 });
  const third = s.tick();                                     // item 3 reaches maxItemsPerSlice of the FRESH slice
  assert.ok(third instanceof Promise);
  await third;
  // control: without reset() the stale slice start makes the very next tick yield
  const clock2 = createFakeClock();
  const t = mk(clock2, { sliceBudgetMs: 4, checkEvery: 1, maxItemsPerSlice: 1_000 });
  t.tick(); clock2.advance(100);
  assert.ok(t.tick() instanceof Promise);
});

test('spanRecorder receives (label, ms) for every yielded slice; a throwing recorder never breaks the slicer', async () => {
  const clock = createFakeClock();
  const spans = [];
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1, spanRecorder: (label, ms) => spans.push([label, ms]) });
  clock.advance(5); await s.tick('digest');
  clock.advance(7); await s.tick('sort');
  assert.deepEqual(spans, [['digest', 5], ['sort', 7]]);
  const s2 = mk(clock, { sliceBudgetMs: 1, checkEvery: 1, spanRecorder: () => { throw new Error('host bug'); } });
  clock.advance(2); await s2.tick('x');                       // must not throw
});

test('afterYield runs after every yield and may abort the sliced work by throwing (cancellation seam)', async () => {
  const clock = createFakeClock();
  let n = 0;
  const s = mk(clock, { sliceBudgetMs: 1, checkEvery: 1, afterYield: () => { if (++n === 2) throw new Error('cancelled'); } });
  clock.advance(2); await s.tick();
  clock.advance(2);
  await assert.rejects(async () => { await s.tick(); }, /cancelled/);
});

test('forEach visits every item in order (sync and async callbacks) and yields between slices', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1 });
  const seen = [];
  await s.forEach([1, 2, 3, 4, 5, 6, 7, 8], (x, i) => { clock.advance(1); seen.push([x, i]); });
  assert.deepEqual(seen.map((p) => p[0]), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(clock.yieldCount, 2);
  const seen2 = [];
  await s.forEach(['a', 'b'], async (x) => { await null; seen2.push(x); });
  assert.deepEqual(seen2, ['a', 'b']);
});

test('caller mutation while the engine is yielded mid-slice cannot affect a captured copy (the yield hook seam)', async () => {
  const clock = createFakeClock();
  const s = mk(clock, { sliceBudgetMs: 1, checkEvery: 1 });
  const caller = { ids: [3, 1, 2] };
  const copy = { ids: [...caller.ids] };
  clock.onYield(() => { caller.ids.push(999); caller.ids[0] = -1; });
  clock.advance(2); await s.tick();
  assert.deepEqual(copy.ids, [3, 1, 2]);
  assert.deepEqual(caller.ids, [-1, 1, 2, 999]);
});

test('sortSliced: stable, does not mutate its input, agrees with Array#sort on random data, and slices', async () => {
  const clock = createFakeClock({ tickMs: 1 });
  const s = mk(clock, { sliceBudgetMs: 4, checkEvery: 1 });
  const rnd = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const data = Array.from({ length: 300 }, (_, i) => ({ k: Math.floor(rnd() * 20), i }));
  const frozen = data.map((d) => ({ ...d }));
  const out = await s.sortSliced(data, (a, b) => a.k - b.k);
  assert.deepEqual(data, frozen);                                              // input untouched
  assert.deepEqual(out, [...data].sort((a, b) => a.k - b.k));                  // Array#sort is stable in Node >= 12
  assert.ok(clock.yieldCount > 0, 'a 300-item sort with a 4-tick budget must have yielded');
  assert.deepEqual(await s.sortSliced([], (a, b) => a - b), []);
  assert.deepEqual(await s.sortSliced([2], (a, b) => a - b), [2]);
  assert.deepEqual(await s.sortSliced([3, 1, 2], (a, b) => a - b), [1, 2, 3]);
});

test('makeYieldToScheduler: animation-frame uses requestAnimationFrame when present, else degrades to a macrotask', async () => {
  let frames = 0;
  const raf = (cb) => { frames++; queueMicrotask(cb); };
  await makeYieldToScheduler('animation-frame', { requestAnimationFrame: raf })();
  assert.equal(frames, 1);
  await makeYieldToScheduler('animation-frame', { requestAnimationFrame: undefined })(); // degrade: resolves via setTimeout(0)
  await makeYieldToScheduler('macrotask', { requestAnimationFrame: raf })();
  assert.equal(frames, 1);                                                    // 'macrotask' never touches rAF
});
