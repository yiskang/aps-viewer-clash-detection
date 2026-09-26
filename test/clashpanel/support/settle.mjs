// test/clashpanel/support/settle.mjs
// Deterministic settling for controller tests: alternates macrotask turns (setImmediate — lets promise chains and
// real-engine timers progress) with `scheduler.advance(0)` (releases fake-scheduler work due "now", e.g. a yield
// that the fake implements as a 0 ms timer). Never advances fake time beyond 0 and asserts nothing about
// wall-clock duration.
const turn = () => new Promise((resolve) => setImmediate(resolve));

export async function settle(scheduler, rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await turn();
    if (scheduler && typeof scheduler.advance === 'function') await scheduler.advance(0);
  }
}

/** Settles until `promise` resolves (or rejects); throws if it is still pending after `maxRounds`. */
export async function drain(scheduler, promise, maxRounds = 20000) {
  let state = 'pending';
  let value;
  let error;
  promise.then((v) => { state = 'fulfilled'; value = v; }, (e) => { state = 'rejected'; error = e; });
  for (let i = 0; i < maxRounds && state === 'pending'; i += 1) await settle(scheduler, 1);
  if (state === 'pending') throw new Error(`drain: promise still pending after ${maxRounds} rounds`);
  if (state === 'rejected') throw error;
  return value;
}

/** Settles until `predicate()` is truthy; throws after `maxRounds` (a bounded ROUND count, not a time limit). */
export async function until(scheduler, predicate, maxRounds = 20000) {
  for (let i = 0; i < maxRounds; i += 1) {
    if (predicate()) return;
    await settle(scheduler, 1);
  }
  throw new Error(`until: condition not met after ${maxRounds} rounds`);
}
