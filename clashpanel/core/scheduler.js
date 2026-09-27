// clashpanel/core/scheduler.js
// The injected timer/yield port (spec 5.2). Every debounce, backoff, timeout and chunked pass in the Panel core goes
// through a Scheduler so tests never depend on wall-clock time. The default is the only place a global timer is read.
/** @typedef {{ now(): number, setTimeout(fn: () => void, ms: number): unknown, clearTimeout(h: unknown): void, yield(): Promise<void> }} Scheduler */

/** @returns {Scheduler} */
export function createDefaultScheduler() {
  return Object.freeze({
    now: () => globalThis.performance.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    yield: () => new Promise((resolve) => { globalThis.setTimeout(resolve, 0); }),
  });
}

export function assertScheduler(scheduler) {
  for (const name of ['now', 'setTimeout', 'clearTimeout', 'yield']) {
    if (typeof scheduler?.[name] !== 'function') throw new TypeError(`scheduler.${name} is required`);
  }
  return scheduler;
}
