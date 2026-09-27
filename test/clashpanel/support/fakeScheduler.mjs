// test/clashpanel/support/fakeScheduler.mjs
// Deterministic Scheduler (core/scheduler.js contract). No wall-clock time: virtual time only moves in `advance`.
// `yield()` is microtask-only and counted; `yieldHook(n)` runs at every yield (a test can bump a generation or throw at
// a chosen yield point); `holdYields()` makes yields wait until `release()`.
/** One real macrotask turn: every already-queued microtask (promise continuation) has run when it resolves. */
export const flush = () => new Promise((resolve) => { setImmediate(resolve); });

export function createFakeScheduler({ start = 0 } = {}) {
  let time = start;
  let nextId = 1;
  let order = 0;
  let yields = 0;
  let held = null;
  const timers = new Map();
  const delays = [];
  const scheduler = {
    yieldHook: null,
    delays,
    now: () => time,
    setTimeout(fn, ms) {
      if (typeof fn !== 'function') throw new TypeError('fake scheduler: setTimeout needs a function');
      const id = nextId;
      nextId += 1;
      const delay = Math.max(0, Number(ms) || 0);
      delays.push(delay);
      order += 1;
      timers.set(id, { at: time + delay, order, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async yield() {
      yields += 1;
      if (scheduler.yieldHook !== null) await scheduler.yieldHook(yields);
      if (held !== null) await held.promise;
    },
    holdYields() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      held = { promise };
      return { release() { held = null; release(); } };
    },
    /** Fire every timer due within `ms` of virtual time (including timers scheduled by fired timers), oldest first. */
    async advance(ms) {
      if (!(ms >= 0)) throw new RangeError('fake scheduler: advance needs ms >= 0');
      const target = time + ms;
      for (;;) {
        let nextKey = null;
        let next = null;
        for (const [key, t] of timers) {
          if (t.at <= target && (next === null || t.at < next.at || (t.at === next.at && t.order < next.order))) { next = t; nextKey = key; }
        }
        if (next === null) break;
        timers.delete(nextKey);
        time = Math.max(time, next.at);
        next.fn();
        await flush();
      }
      time = target;
      await flush();
    },
    pendingTimers: () => timers.size,
    get yieldCount() { return yields; },
  };
  return scheduler;
}
