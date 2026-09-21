// clashtest/planning/steps.js
//
// Runners for the planning stages that are written ONCE as generators ("steps") and consumed two ways (the P2
// `*Sliced` precedent of definition/normalize.js): `runSync` for small inputs and oracles, `runSliced` for planning-sized
// data. A step generator `yield`s a label at every unit of size-dependent work and `return`s its result; the sliced
// runner hands each label to `tick(label)` (undefined when no yield is due, a Promise when one is), so the sync and the
// sliced forms share every line of logic and cannot drift (spec 17.3: a clock check at least every 64 items).

/** Drives a step generator to completion synchronously (labels ignored). */
export function runSync(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Drives a step generator, awaiting `tick(label)` after every step. A throw from `tick` abandons the generator. */
export async function runSliced(steps, tick) {
  try {
    for (let r = steps.next(); ; r = steps.next()) {
      if (r.done) return r.value;
      const pending = tick(r.value);
      if (pending) await pending;
    }
  } finally {
    steps.return?.();   // a cancelled / failed run releases the generator (and whatever it still holds) at once
  }
}
