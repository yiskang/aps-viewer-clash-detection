// clashtest/util/slicer.js
//
// Deadline-aware sliced work (spec 17.3). Every engine-controlled synchronous span that is not
// validation/capture runs through a slicer: it checks the injected `now` at least every
// `checkEvery` (64) items and yields once `sliceBudgetMs` has elapsed, with
// `maxItemsPerSlice` (= engine limit `aggregationSliceMaxItems`) as a secondary ceiling. The 8 ms
// figure is a design target measured in AC-12, not a guarantee (spec 17.3).
//
// Same calling convention as collision/scheduler.js's checkpoint: `tick()` returns `undefined` on
// the not-due fast path and a Promise only when a yield is due, so a hot loop never pays a
// microtask per item:   const p = slicer.tick('label'); if (p) await p;

import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

const defaultNow = () => performance.now();
const macrotaskYield = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The scheduler seam for `interUnitYield` (spec 7.3): 'animation-frame' where
 * requestAnimationFrame exists, else it degrades to a macrotask; 'macrotask' forces the latter.
 */
export function makeYieldToScheduler(kind = 'macrotask', { requestAnimationFrame = globalThis.requestAnimationFrame } = {}) {
  if (kind === 'animation-frame' && typeof requestAnimationFrame === 'function') {
    return () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return macrotaskYield;
}

const positiveInt = (name, v) => {
  if (!Number.isSafeInteger(v) || v < 1) throw new TypeError(`createSlicer: ${name} must be a positive integer (got ${v})`);
  return v;
};

/**
 * @param {object} [o]
 * @param {() => number} [o.now]
 * @param {() => (void | Promise<void>)} [o.yieldToScheduler]
 * @param {{ sliceBudgetMs: number, aggregationSliceMaxItems: number }} [o.limits] resolved engine limits
 * @param {number} [o.sliceBudgetMs]      overrides limits.sliceBudgetMs
 * @param {number} [o.maxItemsPerSlice]   overrides limits.aggregationSliceMaxItems
 * @param {number} [o.checkEvery=64]      clock-check cadence in items
 * @param {(label: string, ms: number) => void} [o.spanRecorder]  labelled slice spans (spec 17.3 `spanRecorder`)
 * @param {() => (void | Promise<void>)} [o.afterYield] runs after every yield; may throw (cancellation / lease checks)
 */
export function createSlicer({
  now = defaultNow, yieldToScheduler = macrotaskYield, limits = ENGINE_LIMIT_DEFAULTS,
  sliceBudgetMs = limits.sliceBudgetMs, maxItemsPerSlice = limits.aggregationSliceMaxItems,
  checkEvery = 64, spanRecorder = null, afterYield = null,
} = {}) {
  positiveInt('sliceBudgetMs', sliceBudgetMs);
  positiveInt('maxItemsPerSlice', maxItemsPerSlice);
  positiveInt('checkEvery', checkEvery);

  let sliceStart = now();
  let items = 0;
  let sinceCheck = 0;
  let yields = 0;
  let ticks = 0;

  async function yieldNow(label = 'slice') {
    const spent = now() - sliceStart;
    if (spanRecorder) { try { spanRecorder(label, spent); } catch { /* a host callback must never break the engine */ } }
    yields += 1;
    await yieldToScheduler();
    items = 0;
    sinceCheck = 0;
    if (afterYield) await afterYield();
    sliceStart = now();
  }

  function tick(label = 'slice') {
    ticks += 1;
    items += 1;
    sinceCheck += 1;
    if (items >= maxItemsPerSlice) return yieldNow(label);
    if (sinceCheck >= checkEvery) {
      sinceCheck = 0;
      if (now() - sliceStart >= sliceBudgetMs) return yieldNow(label);
    }
    return undefined;
  }

  /** Sliced `for` over an array; `fn` may be sync or async. */
  async function forEach(list, fn, { label = 'forEach' } = {}) {
    for (let i = 0; i < list.length; i++) {
      const r = fn(list[i], i);
      if (r && typeof r.then === 'function') await r;
      const p = tick(label);
      if (p) await p;
    }
  }

  /** Stable, sliced bottom-up merge sort; returns a NEW array (input untouched). `compare` as Array#sort. */
  async function sortSliced(list, compare, { label = 'sort' } = {}) {
    let src = list.slice();
    const n = src.length;
    if (n < 2) return src;
    let dst = new Array(n);
    for (let width = 1; width < n; width *= 2) {
      for (let lo = 0; lo < n; lo += 2 * width) {
        const mid = Math.min(lo + width, n);
        const hi = Math.min(lo + 2 * width, n);
        let i = lo; let j = mid; let k = lo;
        while (k < hi) {
          // take the right run's head only when it is STRICTLY smaller: keeps the sort stable
          dst[k++] = (i < mid && (j >= hi || !(compare(src[j], src[i]) < 0))) ? src[i++] : src[j++];
          const p = tick(label);
          if (p) await p;
        }
      }
      [src, dst] = [dst, src];
    }
    return src;
  }

  /** Restart the current slice (clock and item counters) WITHOUT yielding; stats() is untouched. For a caller
   *  that reuses one slicer across sequential operations separated by non-sliced time (P4 projectDiagnostics). */
  function reset() {
    sliceStart = now();
    items = 0;
    sinceCheck = 0;
  }

  return { tick, yieldNow, reset, forEach, sortSliced, stats: () => ({ ticks, yields }) };
}
