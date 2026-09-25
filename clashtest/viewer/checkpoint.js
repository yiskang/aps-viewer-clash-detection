// clashtest/viewer/checkpoint.js
// Same cadence convention as clashtest/planning/rootResolution.js (CHECK_EVERY = 64). Provisional (G-CAL).
export const CHECK_EVERY = 64;

/**
 * Conditionally-synchronous checkpoint (collision/scheduler.js convention). Deliberately NOT `async`: it returns
 * `undefined` synchronously on the not-due fast path and a Promise only when a yield is due, so a caller can
 * `const p = checkpointNow(ctx); if (p) await p;` and keep "checkpoint validated liveness" and the following model
 * read in the SAME tick (ViewerModelAdapter "Item D"). A bare `await checkpointNow(ctx)` is forbidden.
 */
export function checkpointNow(ctx) {
  const pending = ctx.checkpoint();
  return pending ? pending : undefined;
}
