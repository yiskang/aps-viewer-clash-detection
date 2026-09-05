// test/performance/checkpoint-recorder.mjs
//
// Criterion 1 (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:4660-4685):
// no single synchronous task may exceed 24.8ms (frameBudgetMs=8 + 16.8ms weld), with the three named
// exclusions and two provisional exceptions recorded there. This module is the measurement mechanism,
// not the pass/fail judgement -- Task 24 applies the 24.8ms line against what this records.
//
// This is the Node-side sink for `collision/scheduler.js`'s `setSpanRecorder`/`clearSpanRecorder`
// hook (Task 23): wire `recorder.asSpanRecorder()` into `setSpanRecorder` before running a real
// query/build, then read back `recorder.spans` (or `longestSpan()`/`spansByLabel()`) afterwards.
//
// NOTE: this file is duplicated verbatim (not imported) inside test/performance/browser-probes.mjs
// -- that file is injected into a live Viewer page via Playwright's `page.addScriptTag({ path })`,
// which inlines the file's text as a plain (non-module) inline <script>. A same-repo relative
// `import` inside that inlined text would resolve against the PAGE's URL, not the local
// filesystem, and this app's server only exposes the `collision/` and top-level `wwwroot/`
// directories (server.js), so `/test/performance/checkpoint-recorder.mjs` would 404. Keep the two
// copies in sync by hand; this file is the single source of truth for the Node-side harness (see
// measure-geometry-phases.mjs) and the class both copies must match.
//
// Why the manual `performance.now()` bracketing path -- not the Long Tasks PerformanceObserver --
// is what actually proves criterion 1: in a real Chromium build the Long Tasks API only reports
// tasks at or above roughly 50ms, which is ABOVE the 24.8ms bound this criterion enforces. Relying
// on it as the primary signal would let a genuine 30-40ms violation pass completely unrecorded.
// Every manual span below is therefore recorded UNCONDITIONALLY, never gated on whether a Long
// Tasks observer also happens to be present -- gating on that would silently disable the very
// bracketing this criterion depends on in the default, common case of a real Chromium browser.

export class CheckpointRecorder {
  constructor() {
    this.spans = []; // { label, ms, source: 'manual' | 'longtask' }
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this._observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // Long Tasks entries arrive asynchronously and carry no caller-supplied label -- do not
            // guess an attribution; record them as an unattributed cross-check signal only. A
            // genuine entry here, above ~50ms, is itself a criterion-1 finding regardless of which
            // manual span it happened to overlap (see this file's header).
            this.spans.push({ label: '(unattributed longtask)', ms: entry.duration, source: 'longtask' });
          }
        });
        this._observer.observe({ entryTypes: ['longtask'] });
      } catch {
        this._observer = null; // Long Tasks API unavailable (Node, or a locked-down browser).
      }
    }
  }

  /** Bracket one synchronous span by label; call `end()` on the returned handle exactly once.
   *  Safe to nest/overlap -- each call closes over its own start time, never shared mutable state. */
  start(label) {
    const t0 = performance.now();
    return {
      end: () => {
        const ms = performance.now() - t0;
        this.spans.push({ label, ms, source: 'manual' });
        return ms;
      },
    };
  }

  /** Convenience: bracket a sync or async function, return [ms, result]. */
  async around(label, fn) {
    const h = this.start(label);
    const result = await fn();
    const ms = h.end();
    return [ms, result];
  }

  /** The span-recorder function to hand to collision/scheduler.js's setSpanRecorder. */
  asSpanRecorder() {
    return (label, ms) => this.spans.push({ label, ms, source: 'manual' });
  }

  longestSpan(filterLabel) {
    const pool = filterLabel ? this.spans.filter((s) => s.label === filterLabel) : this.spans;
    return pool.reduce((max, s) => (s.ms > (max?.ms ?? -1) ? s : max), null);
  }

  spansByLabel(label) {
    return this.spans.filter((s) => s.label === label);
  }

  report() {
    console.log('\n  label                                    | ms      | source');
    console.log('  ' + '-'.repeat(60));
    for (const s of this.spans) {
      console.log(`  ${s.label.padEnd(40)} | ${s.ms.toFixed(2).padStart(7)} | ${s.source}`);
    }
  }

  dispose() {
    this._observer?.disconnect();
  }
}

if (typeof window !== 'undefined') window.__CheckpointRecorder = CheckpointRecorder;
