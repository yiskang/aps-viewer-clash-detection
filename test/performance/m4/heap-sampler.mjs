// M4 Task 3.11 (Steps 6-9): Metric H (§15.1): performance.memory.usedJSHeapSize under `gc()`
// (requires the harness's own `--js-flags=--expose-gc` launch flag, task 3.1's RUNTIME_CONFIGS),
// two GC passes separated by two rAF turns, one further turn, median of three readings
// (main-thread target only -- rAF does not exist in a worker realm). UNAVAILABLE (never silently
// zero, never silently substituted with the main-thread figure) when the target genuinely lacks
// the required API.
//
// This module is the pure protocol layer only: it drives the given `page`/`worker` channel
// abstraction (`.evaluate()` / `.evaluateInWorker()`) and computes the median. It does NOT define
// or install the in-page `window.__m4HeapSample` function the 'main' branch calls, and it does
// NOT get wired into the live gate harness (run-gate-m4.mjs) -- both of those are Task 3.11's
// Steps 9b/10/11, explicitly deferred to when Phase 3 proper starts.
//
// Post-review hardening (codex-review `code`, medium, round 2): a genuine feature-unavailability
// signal (missing gc()/performance.memory, missing requestAnimationFrame in a worker realm) is the
// ONLY thing this module converts into {available:false}. Anything else -- a page crash, a missing
// channel method, an uninstalled window.__m4HeapSample, a non-Error rejection, or an invalid
// (non-finite/negative) reading -- is a harness/protocol defect, not a capability absence, and must
// propagate (reject) so it fails the gate loudly instead of masquerading as a plausible-looking
// UNAVAILABLE result.
function median3(a, b, c) {
  return [a, b, c].sort((x, y) => x - y)[1];
}

function toErrorMessage(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return String(err);
  } catch {
    return 'non-Error rejection value';
  }
}

// Recognized feature-unavailability signatures: only errors whose message matches one of these
// are legitimate "this runtime lacks the capability" signals per spec §15.1 (missing gc()/
// performance.memory on main, missing requestAnimationFrame in a worker realm). Everything else is
// treated as an unexpected operational failure and rethrown rather than silently downgraded.
const UNAVAILABLE_SIGNATURE = /\bgc\b|performance\.memory|requestAnimationFrame|\brAF\b/i;

function isRecognizedUnavailability(message) {
  return typeof message === 'string' && UNAVAILABLE_SIGNATURE.test(message);
}

function assertValidReading(value, target) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `sampleHeap(${target}): received an invalid heap reading (${String(value)}) -- treating as a protocol defect, not a valid sample`
    );
  }
  return value;
}

export async function sampleHeap(target, pageOrWorkerChannel) {
  if (target !== 'main' && target !== 'worker') {
    throw new Error(`sampleHeap: unknown target "${target}" -- expected 'main' or 'worker'`);
  }
  try {
    if (target === 'main') {
      // Page-side settling: two rAF turns between each gc() call, one further turn before sampling,
      // matching spec's "gc() twice separated by two requestAnimationFrame turns, waits one further
      // turn" protocol -- implemented inside the page.evaluate callback so it runs in-page, not
      // split across Node/page round-trips that would themselves perturb the heap being measured.
      const a = assertValidReading(await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample()), target);
      const b = assertValidReading(await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample()), target);
      const c = assertValidReading(await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample()), target);
      return { available: true, bytes: median3(a, b, c) };
    }
    // Worker target: no requestAnimationFrame in a worker realm (spec §15.1) -- the page drives the
    // settling turns and sends the worker an explicit sample command; the worker calls gc() twice
    // (if available) and returns the median of three usedJSHeapSize readings.
    const bytes = assertValidReading(await pageOrWorkerChannel.evaluateInWorker(), target);
    return { available: true, bytes };
  } catch (err) {
    const message = toErrorMessage(err);
    if (isRecognizedUnavailability(message)) {
      return { available: false, reason: message };
    }
    // Not a recognized feature-unavailability signal: propagate as a real Error (never a raw
    // non-Error rejection value like `null`, which would otherwise surface as a confusing
    // secondary TypeError to whoever awaits this promise).
    throw err instanceof Error ? err : new Error(message);
  }
}
