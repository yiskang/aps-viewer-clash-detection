// collision/scheduler.js
//
// The checkpoint/scheduler PORT: the single interruption/revalidation primitive every
// yield point in this design shares (spec:2830-2837 "entry order: disposed first";
// spec:1392-1397 "same conditional, shared-frameBudgetMs-accumulator check every
// checkpoint in this design uses"). `GeometryRegistry` (Task 13) depends on this port
// via constructor injection; `CollisionWorld` (Task 17) is the real implementation
// and must expose its lifecycle state through this same shape.
//
// Deliberately ONE operation, not separate `isDisposed()`/`isEpochLive()` polls -- see
// this task's write-up for the full ordering/resume-safety rationale. Also deliberately
// NOT always-`async`: `checkpoint()` returns `undefined` synchronously on the "not due"
// fast path and only returns a real Promise when a yield is actually due (codex-advisor
// finding, this task: an always-`async` function that callers unconditionally `await`
// forces a microtask-queue suspension on EVERY call -- pure overhead, not real
// frame-budget relief, at the broad-phase scan's up-to-1,000,000-checkpoint scale,
// spec:3032-3034, 2014). Callers MUST use `const pending = checkpoint(...); if (pending)
// await pending;`, never a bare `await checkpoint(...)`.

import { WorldDisposedError, ModelEvictedError } from './errors.js';
import { frameBudgetMs } from './constants.js';

// ---- Optional diagnostic span-recorder hook (Task 23) -----------------------------------------
// No-op by default; zero cost when unset (a single null-check per checkpoint evaluation). This is
// the load-bearing fix for the performance gate's criterion 1: an external harness cannot
// otherwise observe internal synchronous spans between this library's own yield points, since a
// wrapper around one outer `await world.findClashes(...)` call measures total wall-clock across
// every internal `await`, not the uninterrupted synchronous span between two of them.
//
// `setSpanRecorder`/`clearSpanRecorder` are module-level, not per-port -- Task 23/24's harness
// wires ONE recorder for the whole measured run (potentially spanning several findClashes calls
// and/or GeometryRegistry builds, each of which owns its own checkpoint port instance). See
// test/performance/checkpoint-recorder.mjs (the sink this hook reports into) and
// test/performance/README.md for the full instrumentation-surface writeup.
let _spanRecorder = null;
// Bumped on every `setSpanRecorder`/`clearSpanRecorder` call (install, clear, OR a direct
// replacement of one recorder with another) -- the recorder-lifecycle fix for a gap a second-
// opinion review (codex-advisor) found in this module's own `lastSpanAt` baseline (Batch-5 final
// review, finding I-5 follow-up): without this, a port's `lastSpanAt` timestamp could survive a
// recorder being cleared-then-reinstalled or swapped for a different one, so the NEXT span
// reported after that change would silently include the entire untracked gap in between,
// attributed to the NEW recorder as if it were real synchronous work. Every `createCheckpointPort`
// port compares its own last-seen generation against this counter on every checkpoint call and
// discards (resets to `null`) any baseline that predates the current generation -- see
// `createCheckpointPort` below for the full mechanism.
let _spanRecorderGeneration = 0;
export function setSpanRecorder(fn) { _spanRecorder = fn; _spanRecorderGeneration++; }
export function clearSpanRecorder() { _spanRecorder = null; _spanRecorderGeneration++; }
// Reports one labeled span directly, bypassing the checkpoint helper entirely -- for the one call
// site (CollisionWorld.admitCollisionInstances's capacity-admission recompute-and-commit) that has
// nothing to checkpoint against (it is deliberately 100% synchronous, zero awaits) but still needs
// to report a labeled span for criterion 8.
export function reportSpan(label, ms) {
  _spanRecorder?.(label, ms);
}

// ---- Optional yield-instrumentation hook (Task 1.1) --------------------------------------------
// Same class of addition as setSpanRecorder above: module-level singleton, zero cost when unset.
// Generation-isolated exactly like _spanRecorderGeneration (scheduler.js's own existing mechanism)
// -- a yield whose recorder installation changed (cleared, reinstalled, or replaced) WHILE the
// yield was in flight reports to nobody, never to whichever recorder happens to be active at
// resume time. Without this, a yield started under recorder A but resolving after B replaces A
// would silently report as B's own first yield.
let _yieldRecorder = null;
let _yieldCount = 0;
let _yieldRecorderGeneration = 0;
export function setYieldRecorder(fn) { _yieldRecorder = fn; _yieldCount = 0; _yieldRecorderGeneration++; }
export function clearYieldRecorder() { _yieldRecorder = null; _yieldCount = 0; _yieldRecorderGeneration++; }
export function reportYield(resumeLatencyMs) {
  _yieldCount++;
  _yieldRecorder?.(resumeLatencyMs, _yieldCount);
}

function yieldAndRecordResume(yieldToScheduler) {
  if (!_yieldRecorder) return yieldToScheduler();
  const generationAtYieldStart = _yieldRecorderGeneration;
  const yieldStartedAt = performance.now();
  return Promise.resolve(yieldToScheduler()).then(() => {
    if (_yieldRecorder && _yieldRecorderGeneration === generationAtYieldStart) {
      reportYield(performance.now() - yieldStartedAt);
    }
  });
}

/**
 * A per-SCOPE elapsed-time accumulator, where "scope" is decided by whoever
 * constructs the port (spec:3106: each findClashes call owns its own accumulator;
 * spec:1392-1397: every checkpoint sharing one build/composition uses the SAME
 * accumulator instance). This module makes no assumption about how long a scope lasts
 * -- only that the caller passes ONE accumulator instance to every checkpoint() call
 * within one scope, and constructs a fresh accumulator (via this factory) for a new
 * scope. `ProperCrossingQuery`/`SurfaceIntersectionQuery` deliberately do NOT use this
 * accumulator at all (spec:1932-1957, 2065-2067) -- they own a private,
 * traversal-local clock instead; that exception lives in those later tasks, not here.
 */
export function createFrameBudgetAccumulator({ now = () => performance.now(), budgetMs = frameBudgetMs } = {}) {
  let lastCheckpointAt = now();
  return {
    isDue() {
      return now() - lastCheckpointAt >= budgetMs;
    },
    markCheckpointed() {
      lastCheckpointAt = now();
    },
  };
}

/**
 * Default real scheduling yield: one macrotask turn. `setTimeout(0)` (rather than a
 * microtask) is deliberate -- it actually lets the event loop run other queued work
 * before resuming, which is the point of yielding for frame-budget purposes.
 */
function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds a real CheckpointPort, scoped to whatever accumulator/lifecycle-state
 * callbacks it is given -- construct a FRESH one per findClashes call (or per
 * call-scoped checkpoint threaded into a triggered GeometryRegistry build), never as
 * one long-lived, world-scoped singleton (spec:3106 per-call accumulator ownership).
 * `isDisposed`/`isEpochLive` are supplied by the owning CollisionWorld (Task 17) --
 * this module owns only the ordering/yield/synchronicity contract, never the
 * lifecycle state itself (that state is CollisionWorld's, per spec:3420-3470; Task 17
 * needs a `liveEpochs: Set<number>` alongside its `modelLifecycle` WeakMap to answer
 * `isEpochLive`, since a WeakMap keyed by Model object cannot be reverse-looked-up by
 * loadEpoch -- see this task's write-up).
 *
 * @param {Object} deps
 * @param {() => boolean} deps.isDisposed
 * @param {(loadEpoch: number) => boolean} deps.isEpochLive
 * @param {ReturnType<typeof createFrameBudgetAccumulator>} deps.accumulator
 * @param {() => Promise<void>} [deps.yieldToScheduler]
 * @returns {{ checkpoint: (ctx: { loadEpoch: number, modelIdHint?: (number|string), label?: string }) => (undefined | Promise<void>) }}
 *   `label`, when supplied, is a stable, distinct string identifying this call site -- used only to
 *   bracket a Task-23 labeled span (see `setSpanRecorder` above); it has no effect on checkpoint
 *   semantics and callers that never pass one behave exactly as before.
 */
export function createCheckpointPort({ isDisposed, isEpochLive, accumulator, yieldToScheduler = defaultYield }) {
  function validate(loadEpoch, modelIdHint) {
    if (isDisposed()) {
      throw new WorldDisposedError();
    }
    if (!isEpochLive(loadEpoch)) {
      throw new ModelEvictedError(modelIdHint ?? loadEpoch);
    }
  }

  // Baseline for this port's own labeled-span bracketing (Task 23; recorder-lifecycle fix, Batch-5
  // final review finding I-5). Two invariants, both load-bearing:
  //
  //   1. ZERO COST WHEN UNSET: if no span recorder is installed for this port's entire life, this
  //      port's `checkpoint()` never calls `performance.now()` or writes `lastSpanAt` at all --
  //      gated behind `if (_spanRecorder)` below, restoring this module's own documented "zero
  //      cost when unset (a single null-check per checkpoint evaluation)" guarantee (an earlier
  //      version read `performance.now()` and wrote `lastSpanAt` UNCONDITIONALLY on every
  //      checkpoint, which finding I-5 caught).
  //   2. A SPAN NEVER SPANS ACROSS A RECORDER CHANGE: `lastSpanAt`'s validity is tied to
  //      `_spanRecorderGeneration` (bumped by every `setSpanRecorder`/`clearSpanRecorder` call). If
  //      the active recorder changed since this port last checked -- installed for the first time,
  //      cleared then reinstalled, or swapped for a different recorder entirely, including while a
  //      due checkpoint's own yield was still in flight -- any previously-tracked `lastSpanAt`
  //      belongs to a DIFFERENT recorder's timeline (or no recorder at all) and must not leak into
  //      the new one's first reported span. `lastSeenGeneration` starts at a value that can never
  //      equal a real generation (`-1`; the counter only ever holds non-negative values), so the
  //      very first checkpoint on a fresh port always re-evaluates against whatever is active then.
  //
  // One deliberate exception to "lazy, only-on-first-checkpoint" baselining: if a recorder is
  // ALREADY installed at the moment this port is constructed (the common real-usage pattern --
  // `setSpanRecorder(...)` is called once before `findClashes`, which then constructs this port
  // internally), the baseline is captured right here, at construction, rather than deferred to the
  // first `checkpoint()` call. Without this, the very first span this port would ever report
  // reduces to a meaningless `0` (no prior checkpoint to measure from), discarding the real
  // construction-to-first-checkpoint synchronous span for the overwhelmingly common case. This one
  // conditional `performance.now()` read happens at most once per port construction (i.e. once per
  // `findClashes` call), never per checkpoint -- utterly unlike the up-to-1,000,000-checkpoint cost
  // finding I-5 was about, and only paid at all when a recorder is already active (when unset,
  // invariant 1 above still holds exactly: zero `performance.now()` calls of any kind).
  let lastSpanAt = _spanRecorder ? performance.now() : null;
  let lastSeenGeneration = _spanRecorder ? _spanRecorderGeneration : -1;

  return {
    checkpoint({ loadEpoch, modelIdHint, label } = {}) {
      // Entry validation is ALWAYS synchronous, whether or not a yield follows -- an
      // invalid entry must reject before any yield is even attempted.
      validate(loadEpoch, modelIdHint);
      if (_spanRecorder) {
        if (lastSeenGeneration !== _spanRecorderGeneration) {
          // The active recorder changed since this port last saw it (or this is the very first
          // checkpoint on a port that had no recorder at construction time) -- discard whatever
          // baseline this port was carrying; it does not belong to the CURRENT recorder's timeline.
          lastSpanAt = null;
          lastSeenGeneration = _spanRecorderGeneration;
        }
        const nowMs = performance.now();
        if (label !== undefined) {
          reportSpan(label, lastSpanAt === null ? 0 : nowMs - lastSpanAt);
        }
        if (!accumulator.isDue()) {
          lastSpanAt = nowMs; // fast path -- no yield to account for, reset right here
          return undefined; // synchronous fast path -- no Promise, no microtask forced
        }
        return (async () => {
          await yieldAndRecordResume(yieldToScheduler);
          accumulator.markCheckpointed();
          validate(loadEpoch, modelIdHint);
          // Reset AFTER the real yield completes, not before -- otherwise the next span would
          // wrongly count this yield's own paused duration as synchronous work. The recorder may
          // have been cleared (or swapped) WHILE this yield was in flight -- re-check rather than
          // assuming the pre-yield state still holds: if unset now, there is nothing to track and
          // no clock read to spend on it (the next checkpoint's own generation check reconciles
          // whatever recorder turns out to be active by then).
          if (_spanRecorder) {
            lastSpanAt = performance.now();
            lastSeenGeneration = _spanRecorderGeneration;
          } else {
            lastSpanAt = null;
          }
        })();
      }
      // No recorder installed: skip performance.now()/lastSpanAt bookkeeping entirely (the actual
      // zero-cost path the module's own doc comment promises).
      if (!accumulator.isDue()) {
        return undefined; // synchronous fast path -- no Promise, no microtask forced
      }
      return (async () => {
        await yieldAndRecordResume(yieldToScheduler);
        accumulator.markCheckpointed();
        validate(loadEpoch, modelIdHint);
      })();
    },
  };
}

// ---- Optional structured diagnostic-event recorder (Task 1.2) ----------------------------------
// MECHANISM ONLY: no production call site reports through this yet (Task 1.4 wires the real call
// sites). isDiagnosticEventRecorderActive() lets a call site in a DIFFERENT module (none of which
// can see this module's private state) gate its own payload construction behind one cheap boolean
// check, so "zero cost when unused" holds at every call site, not only in here.
let _diagnosticEventRecorder = null;
export function setDiagnosticEventRecorder(fn) { _diagnosticEventRecorder = fn; }
export function clearDiagnosticEventRecorder() { _diagnosticEventRecorder = null; }
export function reportDiagnosticEvent(kind, payload) {
  _diagnosticEventRecorder?.(kind, payload);
}
export function isDiagnosticEventRecorderActive() {
  return _diagnosticEventRecorder !== null;
}

// ---- Optional S7' stage-input capture hook (Task 1.3) -------------------------------------------
// Benchmark-only, disabled by default. `buildPayload` is a THUNK -- a capture payload can require
// copying a potentially large typed array, so the payload is only ever constructed when a capture
// fn is installed. isSpikeInputCaptureActive() additionally lets a CALL SITE avoid allocating the
// thunk closure itself when inactive (not merely avoid invoking it) -- an independent review's
// finding on an earlier draft, which called reportSpikeInput(kind, () => {...}) unconditionally.
let _spikeInputCapture = null;
export function setSpikeInputCapture(fn) { _spikeInputCapture = fn; }
export function clearSpikeInputCapture() { _spikeInputCapture = null; }
export function isSpikeInputCaptureActive() { return _spikeInputCapture !== null; }
export function reportSpikeInput(kind, buildPayload) {
  if (!_spikeInputCapture) return;
  _spikeInputCapture(kind, buildPayload());
}
