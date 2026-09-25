// clashtest/derive/steps.js
import { CorruptResultSetError } from '../errors.js';
import { comparePairIds } from '../identity/ids.js';
/** Async driver: one gate tick per yielded step (a step is one work item). Drives P5's `buildStatusReaderSteps` (one `yield` per record) as well as P8's own step generators. */
export async function drive(it, gate) {
  for (;;) { const r = it.next(); if (r.done) return r.value; const p = gate.tick(); if (p !== undefined) await p; }
}
/** §13.1/§11.3: results are strictly ascending by PairId. A raw (unvalidated) set that is not is refused, never reordered. */
export function* assertCanonicalResultOrder(results, runId) {
  for (let i = 1; i < results.length; i++) {
    if (comparePairIds(results[i - 1].pair, results[i].pair) >= 0) throw new CorruptResultSetError({ runId, issues: [{ path: `results[${i}]`, code: 'order' }] });
    yield;
  }
}
