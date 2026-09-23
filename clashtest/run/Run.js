// clashtest/run/Run.js  (P6.3 slice: states, handle, snapshot; the resolution/planning/unit loop
// lands in P6.4/P6.5, sealing/dispose in P6.8)
import { createEmitter } from './emitter.js';

export const RUN_STATES = Object.freeze(
  ['queued', 'planning', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'invalidated'],
);
export const RUN_PHASES = Object.freeze(
  ['queued', 'binding', 'enumerating', 'planning', 'executing', 'finalizing', 'terminal'],
);
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'invalidated']);

export const isTerminalStatus = (status) => TERMINAL.has(status);

/**
 * `committed` is the ONLY state a snapshot is built from (§9.2 rule 4: "never torn, built at unit
 * boundaries and state changes from committed state only"). Mutating counters live in `pending` and
 * are copied into `committed` by `commit()`, which is the single place `seq` advances.
 */
function createProgressState(runId) {
  const zero = {
    runId, status: 'queued', phase: 'queued', seq: 0,
    unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
    pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0,
    resultsFound: 0, caveatCount: 0, caveatUnclassified: 0,
    currentUnitId: null, startedAtMs: 0,
  };
  return { pending: { ...zero }, committed: null };
}

function snapshotOf(committed, now) {
  const total = committed.pairSpaceTotal;
  const frac = (n) => (total === 0 ? null : n / total);
  return Object.freeze({
    runId: committed.runId,
    status: committed.status,
    phase: committed.phase,
    seq: committed.seq,
    unitsTotal: committed.unitsTotal,
    unitsEvaluated: committed.unitsEvaluated,
    unitsFailedOrSkipped: committed.unitsFailedOrSkipped,
    pairSpaceTotal: total,
    pairSpaceEvaluated: committed.pairSpaceEvaluated,
    pairSpaceProcessed: committed.pairSpaceProcessed,
    fractionEvaluated: frac(committed.pairSpaceEvaluated),
    fractionProcessed: frac(committed.pairSpaceProcessed),
    resultsFound: committed.resultsFound,
    caveatCount: committed.caveatCount,
    caveatUnclassified: committed.caveatUnclassified,
    currentUnitId: committed.currentUnitId,
    elapsedMs: now() - committed.startedAtMs,             // NOT part of any digest
  });
}

/**
 * Copies `pending` into a new frozen `committed`, incrementing `seq`. This is the single place a
 * snapshot's `seq` advances (§9.2 rule 4). `pending.seq` is kept IN SYNC with `committed.seq` here
 * (not left stale at 0) so a future caller that reads `run.progress.pending.seq` between commits —
 * or that increments it directly the way the plan's later terminal-commit sketch does — observes
 * the same number `getSnapshot()` just reported, instead of silently regressing it on the next
 * commit through this function. Nothing calls this again in THIS task's own test — the unit loop
 * that mutates `pending` and commits at boundaries is P6.4/P6.5 — but the seed commit below (so
 * `getSnapshot()` never reads a `null` committed state) and any future caller both go through this
 * one function.
 */
function commit(run) {
  const nextSeq = (run.progress.committed?.seq ?? -1) + 1;
  run.progress.pending.seq = nextSeq;
  run.progress.committed = Object.freeze({ ...run.progress.pending });
  return run.progress.committed;
}

function comparePlanPaths(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;                             // a parent precedes its descendants
}

// I6 — the rank oracle (§11.4 rule 2). `seed` establishes the initial plan-order ranks; `split`
// re-ranks in place when a runtime split admits children (P6.5 wires the call; this task only
// builds the function and installs an empty instance on the run, per the P6.5 brief's own verbatim
// text so the two tasks never diverge or duplicate this implementation).
function createUnitOrder() {
  const paths = new Map();                                // unitId -> number[]
  const ranks = new Map();                                // unitId -> consecutive integer
  const renumber = () => {
    ranks.clear();
    const ordered = [...paths.entries()].sort((x, y) => comparePlanPaths(x[1], y[1]));
    ordered.forEach(([unitId], i) => ranks.set(unitId, i));
  };
  return {
    seed(unitIds) { paths.clear(); unitIds.forEach((id, i) => paths.set(id, [i])); renumber(); },
    split(parentId, childIds) {
      const parent = paths.get(parentId);
      /* c8 ignore next */ if (parent === undefined) throw new Error(`unranked split parent ${parentId}`);
      childIds.forEach((id, k) => paths.set(id, [...parent, k]));
      renumber();
    },
    get(unitId) { return ranks.get(unitId); },            // undefined ⇒ P5 ranks it last, by contract
  };
}

/**
 * C2 — the plan-independent results holder.
 *
 * `run.results` is read by `resultParts` and by `sealAs`, both of which run on the
 * **pre-resolution** paths (a cancel while `resolveDefinition` is pending, a lookup failure, a
 * `model-not-bound` planning gap) — i.e. long before `planStage` can build P5's accumulator, which
 * needs `unitPlanRank` and therefore needs a plan (A12). Leaving the field `undefined` until then
 * makes `run.results.toArray()` throw inside the seal, which the fallback cannot recover from
 * because the fallback calls `resultParts` too: the required pre-resolution set (§13.1) would come
 * out `null`.
 *
 * So the run starts with a REAL, inert holder implementing the same three-method surface. It is
 * frozen and shared: it owns no state, so one instance serves every run.
 */
const EMPTY_RESULTS = Object.freeze({
  addUnit() { return Object.freeze({ accepted: false, reason: 'no-plan' }); },
  size() { return 0; },
  toArray() { return []; },
});

/**
 * I7 — `derivedFromRunId` is part of the authoritative `RunSpec`, so it is validated where every
 * other structural expectation of the spec is: synchronously, in `createRun`, before the run can
 * be queued. A bad value is an engine bug (P7 built the spec), never user data, so it is a
 * `TypeError` and not a §18 error class.
 */
function normalizeDerivedFromRunId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('RunSpec.derivedFromRunId must be a non-empty string or null');
  }
  return value;
}

// Stubs below intentionally do nothing (or throw fail-fast) — this task's own test never calls
// `begin()`, `handle.cancel()`, or `controller.requestDispose()`. Real behaviour arrives in later
// tasks: `beginRun` (queueing/resolution/planning) is P6.4; `requestCancel`/`requestDispose`
// (cancellation, sealing, the finalize window) are P6.8.

// Fail-fast, not silent: an unresolved-promise stub would let an accidental `begin()`/`cancel()`/
// `requestDispose()` call in a later task's WIP test hang forever with no clue which slice is
// missing (codex-advisor review, P6.3). Real behaviour arrives in later tasks and REPLACES these
// function bodies entirely — nothing in this file depends on the throw.

// eslint-disable-next-line no-unused-vars
function beginRun(run) {
  // P6.4 fills this in: hand the run to spec.coordinator, drive resolveStage/planStage.
  throw new Error('beginRun is not implemented until Task P6.4');
}

// eslint-disable-next-line no-unused-vars
function requestCancel(run, reason) {
  // P6.8 fills this in: mark cancelRequested on settlementState, resolve run.donePromise per the
  // §13.5.1 state table.
  throw new Error('requestCancel is not implemented until Task P6.8');
}

// eslint-disable-next-line no-unused-vars
function requestDispose(run) {
  // P6.8 fills this in: requestCancel(run, 'engine-disposed', { dispose: true }) plus the
  // force-finalize behaviour documented in the plan's RunController row.
  throw new Error('requestDispose is not implemented until Task P6.8');
}

export function createRun(spec) {
  const run = {
    spec, runId: spec.runId,
    derivedFromRunId: normalizeDerivedFromRunId(spec.derivedFromRunId),
    results: EMPTY_RESULTS,                                // C2: replaced at plan completion
    unitOrder: createUnitOrder(),                          // I6: the rank oracle, empty until planning
    settlementState: {
      unitCauses: [], planningCause: null, planningGapCauses: [],
      placementChangedVsSnapshot: false, cancelRequested: null,
      disposeRequested: false, allLeafUnitsTerminal: false,
    },
    emitter: createEmitter({ now: spec.now, progressMinIntervalMs: spec.runOptions.progressMinIntervalMs }),
    // NOTE for P6.4/P6.5/P6.8: this task's brief spelled the field `run.progress = { pending,
    // committed }`, but later sections of the master plan's own pseudocode read/write `run.pending`
    // directly (flat, no `.progress`). Reconcile that naming before copying a plan snippet verbatim
    // — either alias `run.pending = run.progress.pending`, or adjust the snippet to
    // `run.progress.pending` (codex-advisor review, P6.3).
    progress: createProgressState(spec.runId),
    // Flags nothing in THIS task's test exercises yet, but later tasks (P6.4-P6.8) read/set them:
    sealStarted: false,
    sealed: false,
    reservationSettled: false,
    // `forceFinalize` is DELIBERATELY ABSENT (not `false`) until P6.8 installs it as a callback
    // (`run.forceFinalize = close`) once the finalize window opens — the plan's own dispose path
    // tests `run.forceFinalize !== undefined` and calls it as a function when that check passes
    // (codex-advisor review, P6.3: `false` would satisfy `!== undefined` and then be invoked as
    // `false()`, throwing). Do not initialize this key here.
    disposeRequestedDuringSeal: false,
  };
  run.progress.pending.startedAtMs = spec.now();
  commit(run);                                             // seed `committed` so getSnapshot never reads null

  run.donePromise = new Promise((resolve) => { run.resolveDone = resolve; });
  run.persistedPromise = new Promise((resolve) => { run.resolvePersisted = resolve; });

  // C3: the public handle carries EXACTLY the §18 members. Disposal control is a separate object
  // handed to the engine, so `getRun(id)` — which returns the handle — cannot leak it to a caller.
  const handle = Object.freeze({
    runId: run.runId,
    getSnapshot: () => snapshotOf(run.progress.committed, run.spec.now),
    subscribe: (listener) => run.emitter.subscribe(listener),
    cancel: (reason) => requestCancel(run, reason),
    done: run.donePromise,
    persisted: run.persistedPromise,
  });
  const controller = Object.freeze({ requestDispose: () => requestDispose(run) });
  return Object.freeze({ handle, controller, begin: () => beginRun(run) });
}
