// test/clashtest/support/fakeClock.mjs
//
// Deterministic `now` / `yieldToScheduler` pair (spec 18 test seams; same convention as
// CollisionWorld's constructor). No wall-clock sleeps anywhere in clashtest tests.
//
//   const clock = createFakeClock({ tickMs: 1 });          // every now() read advances 1 ms ("work")
//   const slicer = createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, ... });
//
// `now` and `yieldToScheduler` are closures, so they can be destructured and passed detached.
// `onYield(fn)` runs `fn(yieldCount)` inside every yield: this is how a test mutates a caller-owned
// object "while the engine is yielded mid-slice" (spec 5.3, AC-1) or cancels a run at a yield.

export function createFakeClock({ start = 0, tickMs = 0, yieldAdvanceMs = 0 } = {}) {
  let t = start;
  let yields = 0;
  const hooks = new Set();
  return {
    now() { const v = t; t += tickMs; return v; },
    /** Advance time without reading it (simulates a long synchronous span). */
    advance(ms) { t += ms; },
    /** Current time without the per-read tick. */
    peek() { return t; },
    async yieldToScheduler() {
      yields += 1;
      t += yieldAdvanceMs;
      for (const hook of [...hooks]) await hook(yields);
    },
    get yieldCount() { return yields; },
    onYield(fn) { hooks.add(fn); return () => hooks.delete(fn); },
  };
}
