// clashtest/run/emitter.js
//
// Spec §9.2 rules 4-5 and §16.6. Delivery is isolated: a subscriber exception is caught and counted
// and never reaches the run; the subscriber list is COPIED before a pass so subscribing or
// unsubscribing during delivery cannot corrupt it.

const NEVER_THROTTLED = new Set(['state', 'unit', 'persistence']);

export function createEmitter({ now, progressMinIntervalMs }) {
  const listeners = new Set();
  let listenerErrors = 0;
  let lastProgressAt = null;

  return {
    get listenerErrors() { return listenerErrors; },
    get listenerCount() { return listeners.size; },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const box = { listener };                          // boxed so identical functions unsubscribe 1:1
      listeners.add(box);
      return () => { listeners.delete(box); };
    },
    emit(type, payload) {
      if (!NEVER_THROTTLED.has(type)) {
        const t = now();
        if (lastProgressAt !== null && t - lastProgressAt < progressMinIntervalMs) return false;
        lastProgressAt = t;
      }
      const event = Object.freeze({ type, ...payload });
      for (const box of [...listeners]) {                 // copy: safe against mutation mid-pass
        if (!listeners.has(box)) continue;                // unsubscribed during THIS pass
        try { box.listener(event); } catch { listenerErrors += 1; }
      }
      return true;
    },
  };
}
