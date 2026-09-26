// clashpanel/core/generation.js
// One monotonically increasing generation per displayed run (spec 5.2 "Controller generation"). Every asynchronous
// completion captures `current()` when issued and commits only while `isCurrent(captured)` still holds. `onBump` is an
// additive helper so a consumer (the derivation queue) can abort supported work promptly instead of polling.
export function createGeneration() {
  let n = 0;
  const listeners = new Set();
  return Object.freeze({
    current: () => n,
    bump() {
      n += 1;
      for (const listener of [...listeners]) {
        try { listener(n); } catch { /* a listener must never break a bump or its neighbours */ }
      }
      return n;
    },
    isCurrent: (g) => g === n,
    onBump(listener) {
      if (typeof listener !== 'function') throw new TypeError('generation.onBump: listener must be a function');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  });
}
