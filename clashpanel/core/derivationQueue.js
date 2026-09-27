// clashpanel/core/derivationQueue.js
// Single-flight sequential queue for Core derivations (spec 5.2 "Derivation scheduling"). One job in flight, lowest
// priority number first, generation-aware: a bump aborts the running job and drops queued ones. DerivationBusyError
// (detected by name; the class is never imported) is retried through the injected scheduler, bounded.
import { DERIVATION_BUSY_MAX_RETRIES, DERIVATION_BUSY_RETRY_MS } from './constants.js';
import { assertScheduler } from './scheduler.js';

const SUPERSEDED = Object.freeze({ status: 'superseded' });

function isBusy(error) {
  try { return error !== null && typeof error === 'object' && error.name === 'DerivationBusyError'; } catch { return false; }
}

export function createDerivationQueue({ scheduler, generation } = {}) {
  assertScheduler(scheduler);
  for (const name of ['current', 'isCurrent']) {
    if (typeof generation?.[name] !== 'function') throw new TypeError(`createDerivationQueue: generation.${name} is required`);
  }
  const entries = new Map();     // `${generation}\0${key}` -> entry (pending, running, or a cached ok)
  const pending = [];
  let running = null;
  let disposed = false;
  let order = 0;
  let pumpScheduled = false;

  const forget = (entry) => { if (entries.get(entry.cacheKey) === entry) entries.delete(entry.cacheKey); };
  function settle(entry, result) {
    if (entry.settled) return;
    entry.settled = true;
    entry.resolve(result);
    if (result.status !== 'ok') forget(entry);        // an error or a supersession is never served from the cache
  }
  function supersede(entry) {
    entry.superseded = true;
    const at = pending.indexOf(entry);
    if (at >= 0) pending.splice(at, 1);
    if (entry.controller !== null) { try { entry.controller.abort(); } catch { /* an abort listener must not break the queue */ } }
    if (entry.backoff !== null) {
      const { handle, wake } = entry.backoff;
      entry.backoff = null;
      scheduler.clearTimeout(handle);
      wake();
    }
    settle(entry, SUPERSEDED);
  }
  function sweepStale() {
    for (const [key, entry] of [...entries]) {
      if (generation.isCurrent(entry.generation)) continue;
      if (entry.settled) entries.delete(key); else supersede(entry);
    }
  }

  async function run(entry) {
    entry.controller = new AbortController();
    let outcome = SUPERSEDED;
    try {
      for (;;) {
        if (entry.superseded || disposed) { outcome = SUPERSEDED; break; }
        let attempt;
        try { attempt = { ok: true, value: await entry.job(entry.controller.signal) }; } catch (error) { attempt = { ok: false, error }; }
        if (entry.superseded || disposed || !generation.isCurrent(entry.generation)) { outcome = SUPERSEDED; break; }
        if (attempt.ok) { outcome = { status: 'ok', value: attempt.value }; break; }
        if (isBusy(attempt.error) && entry.retries < DERIVATION_BUSY_MAX_RETRIES) {
          entry.retries += 1;
          await new Promise((wake) => {
            entry.backoff = { wake, handle: scheduler.setTimeout(() => { entry.backoff = null; wake(); }, DERIVATION_BUSY_RETRY_MS) };
          });
          continue;
        }
        outcome = { status: 'error', error: attempt.error };
        break;
      }
    } catch (error) {
      outcome = { status: 'error', error };            // e.g. the scheduler itself threw while arming the backoff
    } finally {
      entry.backoff = null;
      running = null;
      settle(entry, outcome);
      pump();
    }
  }

  function pump() {
    if (running !== null || disposed) return;
    sweepStale();
    if (pending.length === 0) return;
    let best = 0;
    for (let i = 1; i < pending.length; i += 1) {
      const a = pending[i];
      const b = pending[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
    }
    [running] = pending.splice(best, 1);
    void run(running);
  }
  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => { pumpScheduled = false; pump(); });
  }

  function submit({ key, priority, job } = {}) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('derivationQueue.submit: key must be a non-empty string');
    if (typeof priority !== 'number' || Number.isNaN(priority)) throw new TypeError('derivationQueue.submit: priority must be a number');
    if (typeof job !== 'function') throw new TypeError('derivationQueue.submit: job must be a function');
    if (disposed) return Promise.resolve(SUPERSEDED);
    sweepStale();
    const g = generation.current();
    const cacheKey = `${g}\u0000${key}`;
    const existing = entries.get(cacheKey);
    if (existing !== undefined) {
      if (pending.includes(existing) && priority < existing.priority) existing.priority = priority;
      return existing.promise;
    }
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    order += 1;
    const entry = {
      cacheKey, key, generation: g, priority, order, job, promise, resolve,
      settled: false, superseded: false, controller: null, backoff: null, retries: 0,
    };
    entries.set(cacheKey, entry);
    pending.push(entry);
    schedulePump();
    return promise;
  }

  const unsubscribe = typeof generation.onBump === 'function' ? generation.onBump(() => sweepStale()) : () => {};

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    for (const entry of [...entries.values()]) if (!entry.settled) supersede(entry);
    entries.clear();
    pending.length = 0;
  }

  return Object.freeze({ submit, dispose, stats: () => ({ pending: pending.length, running: running !== null, cached: entries.size }) });
}
