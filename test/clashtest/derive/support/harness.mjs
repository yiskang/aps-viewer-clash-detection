// test/clashtest/derive/support/harness.mjs  — fake clock + scheduler spy (P8-local; P0's createFakeClock has no hold()/releaseAll())
export function makeHarness({ tickMs = 0 } = {}) {
  let t = 0; let holding = false; const waiters = [];
  const h = {
    yields: 0, onYield: null,
    now: () => (t += tickMs),
    yieldToScheduler() {
      h.yields += 1; h.onYield?.(h.yields);
      return holding ? new Promise((r) => waiters.push(r)) : Promise.resolve();
    },
    hold() { holding = true; },
    releaseAll() { holding = false; for (const r of waiters.splice(0)) r(); },
  };
  return h;
}
