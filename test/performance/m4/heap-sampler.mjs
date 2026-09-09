// M4 Task 3.11 (Steps 6-9): Metric H (§15.1): performance.memory.usedJSHeapSize under `gc()`
// (requires the harness's own `--js-flags=--expose-gc` launch flag, task 3.1's RUNTIME_CONFIGS),
// two GC passes separated by two rAF turns, one further turn, median of three readings
// (main-thread target only -- rAF does not exist in a worker realm). UNAVAILABLE (never silently
// zero, never silently substituted with the main-thread figure) when the target lacks the
// required API.
//
// This module is the pure protocol layer only: it drives the given `page`/`worker` channel
// abstraction (`.evaluate()` / `.evaluateInWorker()`) and computes the median. It does NOT define
// or install the in-page `window.__m4HeapSample` function the 'main' branch calls, and it does
// NOT get wired into the live gate harness (run-gate-m4.mjs) -- both of those are Task 3.11's
// Steps 9b/10/11, explicitly deferred to when Phase 3 proper starts.
function median3(a, b, c) {
  return [a, b, c].sort((x, y) => x - y)[1];
}

export async function sampleHeap(target, pageOrWorkerChannel) {
  try {
    if (target === 'main') {
      // Page-side settling: two rAF turns between each gc() call, one further turn before sampling,
      // matching spec's "gc() twice separated by two requestAnimationFrame turns, waits one further
      // turn" protocol -- implemented inside the page.evaluate callback so it runs in-page, not
      // split across Node/page round-trips that would themselves perturb the heap being measured.
      const a = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      const b = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      const c = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      return { available: true, bytes: median3(a, b, c) };
    }
    // Worker target: no requestAnimationFrame in a worker realm (spec §15.1) -- the page drives the
    // settling turns and sends the worker an explicit sample command; the worker calls gc() twice
    // (if available) and returns the median of three usedJSHeapSize readings.
    const bytes = await pageOrWorkerChannel.evaluateInWorker();
    return { available: true, bytes };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
