// clashtest/run/Run.js
//
// P6.3: states, handle, snapshot. P6.4: resolution, planning, run-start leases, the pre-resolution
// and queued-withdrawal seals, the permanent seal core (`buildAndAdmitResultSet`), and the unit loop
// pulled forward VERBATIM from the P6.5 brief (P6.5 adds its own coverage against it).
// P6.6: the live boundary scan, the unit-scoped live-participant scan (P4 H1 carry-forward) and
// seal-time freshness. P6.8: the real persistence attempt and the `finalizing` window (§13.5.1), the
// R10 terminal internal-error fallback with the I8 double-admission recovery, the cancellation
// matrix and the engine-only `requestDispose()` (C3).
import { createEmitter as createDefaultEmitter } from './emitter.js';
import { bindingsEquivalent } from '../identity/ModelRegistry.js';
import {
  UNIT_PRECEDENCE, classifyUnitSettlement, resolveRunStatus, collectReasons,
} from './settlement.js';
import { EnumerationCancelledError } from '../errors.js';
import { createSlicer } from '../util/slicer.js';

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
 * boundaries and state changes from committed state only"). Mutating counters live in `run.pending`
 * (a FLAT property directly on the run object — not nested under `run.progress`, per the plan-wide
 * shape every later task's own pseudocode reads/writes: P6.4, P6.5 and P6.8 all address it as
 * `run.pending.X`) and are copied into `run.progress.committed` by `commit()`, which is the single
 * place `seq` advances.
 */
function createInitialPending(runId) {
  return {
    runId, status: 'queued', phase: 'queued', seq: 0,
    unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
    pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0,
    resultsFound: 0, caveatCount: 0, caveatUnclassified: 0,
    currentUnitId: null, startedAtMs: 0,
  };
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
 * Copies `run.pending` into a new frozen `run.progress.committed`, incrementing `seq`. This is the
 * single place a snapshot's `seq` advances (§9.2 rule 4). `run.pending.seq` is kept IN SYNC with
 * `committed.seq` here (not left stale at 0) so a future caller that reads `run.pending.seq`
 * between commits — or that increments it directly the way P6.8's own terminal-commit snippet does
 * (`run.pending.seq += 1; run.progress.committed = Object.freeze({ ...run.pending });`) — observes
 * the same number `getSnapshot()` just reported, instead of silently regressing it on the next
 * commit through this function. Every publication point goes through it: the seed commit in
 * `createRun` (so `getSnapshot()` never reads a `null` committed state), `commitAndEmit` (plan
 * adoption, unit boundaries) and `commitTerminal` (the one terminal commit, P6.4).
 */
function commit(run) {
  const nextSeq = (run.progress.committed?.seq ?? -1) + 1;
  run.pending.seq = nextSeq;
  run.progress.committed = Object.freeze({ ...run.pending });
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

// ================================================================================================
// State-machine mutators (P6.4, controller ruling 2)
// ================================================================================================

/**
 * `transition` / `setPhase` STAGE a status or phase: they validate it, set `run.status`/`run.phase`
 * and keep the flat `run.pending` working state in step, and they NEVER commit a snapshot or emit an
 * event. Publication happens only at explicit commit points (`run.commit(type)` at plan adoption and
 * at unit boundaries, and `commitTerminal` exactly once, after the seal succeeded). Two reasons:
 *
 *  - Terminal status SELECTION and terminal PUBLICATION are different moments (ruling 2): `sealAs`
 *    selects the status before it has built, sealed or admitted anything, and the terminal snapshot
 *    must not be visible — nor the terminal event emitted — until that work succeeded (I9).
 *  - §9.2 / the adoption-idempotence test: no event may carry a pre-adoption snapshot (every event a
 *    listener sees already counts the preplanned gap weight), so the `queued -> planning` and
 *    `binding -> enumerating` changes are staged silently and ride on the adoption commit.
 *
 * Task P6.8's commit points for its own observable states (`cancelling` right after a cancel of a
 * running run, `finalizing` once the set is sealed and admitted) are explicit commits too, not
 * published by these setters.
 *
 * Terminal states are ABSORBING: a `transition()` on an already-terminal run is a NO-OP that
 * returns `false` (it does not throw — a late caller on a settle path must never turn a finished run
 * into a crash). Phases may skip forward freely (e.g. `binding` straight to `finalizing` on an early
 * cancel); no adjacency chain is enforced.
 */
function transition(run, status) {
  if (!RUN_STATES.includes(status)) throw new TypeError(`unknown run status: ${String(status)}`);
  if (isTerminalStatus(run.status)) return false;
  run.status = status;
  run.pending.status = status;
  return true;
}

function setPhase(run, phase) {
  if (!RUN_PHASES.includes(phase)) throw new TypeError(`unknown run phase: ${String(phase)}`);
  run.phase = phase;
  run.pending.phase = phase;
}

/** A non-terminal publication point: commit `run.pending`, then announce it as a `type` event. */
function commitAndEmit(run, type) {
  const committed = commit(run);
  run.emitter.emit(type, { seq: committed.seq, status: committed.status, phase: committed.phase });
  return committed;
}

/**
 * `commitTerminal` — the single terminal commit (I9). It is `commit()` with two differences: it
 * **never emits** (its caller emits the one terminal `state` event immediately afterwards —
 * `openFinalizeWindow`'s `close()` and `finishTerminalInternalError`, the two ways a run ends — so
 * both share this one commit without duplicating the emission, and committing plus emitting in one
 * call could neither be reordered nor reused by a path that must add `cause` to the payload), and it
 * is called only once `run.summary` — which carries the final `persistence` — already exists.
 * §9.1's `RunProgress` is a **closed** shape with no persistence field, so the final persistence
 * state is committed where the spec puts it: on `RunSummary` (`done`) and on the terminal `state`
 * event's payload. "The complete terminal snapshot before the event" therefore means: `status` and
 * `phase` in the committed progress state, `persistence` in the summary and the payload, all of it
 * established before any listener runs. (P6.8 reconciliation: P6.4's version emitted in here; the
 * split is the brief's, and `run.seq()` then reads back the seq this commit produced.)
 */
function commitTerminal(run, { status, persistence }) {
  /* c8 ignore next */ if (run.summary === undefined) throw new Error('commitTerminal: summary must exist first');
  run.status = status;                                     // the settle path's own final word
  run.pending.status = status;
  setPhase(run, 'terminal');
  run.pending.currentUnitId = null;
  commit(run);
  run.terminalPersistence = persistence;                   // reachable through `done`/the event
}

// ================================================================================================
// Resolution and planning (P6.4 brief Step 3, verbatim except where marked)
// ================================================================================================

const CANCELLED = Symbol('cancelled-before-resolution');

/**
 * Stage 1+2, RACED against cancellation (R5, review C2). `resolveDefinition` may be a store read
 * that never settles; awaiting it unconditionally would make `cancel()` and `done` unbounded and
 * would wedge `dispose()`. The loser of the race is ABANDONED — never awaited again, never
 * committed — and its eventual settlement is swallowed so a late rejection cannot surface as an
 * unhandled rejection or reject `done` (§13.5.1 item 1). There is no cancellation *signal* on the
 * port: `resolveDefinition` is a host-supplied lookup and the spec gives it no abort contract.
 */
async function resolveStage(run) {
  run.setPhase('binding');
  // P6.4 fix (task review): the lookup is invoked INSIDE a promise executor, so a host lookup that
  // throws SYNCHRONOUSLY is the same rejected lookup as an async one — it reaches `planningCauseOf`
  // and seals the §13.1 pre-resolution shape with its one planning gap, instead of escaping to
  // `driveRun`'s catch-all. (A try/catch, not `new Promise(r => r(lookup()))`: resolving a promise
  // with a thenable adds microtask hops, which would let a same-slice cancel overtake an
  // already-rejected lookup and change which fact order B sees.)
  let lookup;                                              // Promise<{definition, testRef}>
  try {
    lookup = run.spec.resolveDefinition();
  } catch (error) {
    lookup = Promise.reject(error);
  }
  const settled = Promise.resolve(lookup).then(
    (value) => ({ kind: 'resolved', value }),
    (error) => ({ kind: 'rejected', error }),
  );
  const outcome = await Promise.race([settled, run.cancellationSignal().then(() => ({ kind: 'cancelled' }))]);
  if (outcome.kind === 'cancelled') {
    void settled;                                         // abandoned; already has both handlers
    return CANCELLED;
  }
  if (outcome.kind === 'rejected') {
    return run.failPlanning(run.spec.planningCauseOf(outcome.error));
  }
  if (run.cancelRequested !== null) return CANCELLED;     // observed before we committed it
  run.resolution = outcome.value;                         // committed: from here on, post-resolution
  return outcome.value;
}

/** P5's accumulator ctx takes `Map<modelKey, Set<dbId>>` built from PLAN data. The ledger's
 *  `unreachablePopulation` rows are that plan data in their persisted shape.
 *
 *  D-B (owner-authorized P6 fix, 2026-09-24): a row's `ownerDbIds` lists EVERY owner with a
 *  tree-unreachable fragment, MIXED owners included (§6.2: mixed = in `unreachable.ownerDbIds` AND
 *  some root's `ownerDbIds`, recorded as `mixedOwnerDbIds`). `flags.unreachableOwner` is reserved for
 *  *unreachable-only* owners (§11.1), so `'unreachable-only'` is `ownerDbIds` minus
 *  `mixedOwnerDbIds`; `'mixed'` is `mixedOwnerDbIds` as recorded. */
function ownerSetsFromLedger(ledger, ownerClass) {
  const out = new Map();
  for (const row of ledger.toLedgerRecord().unreachablePopulation) {
    const mixed = new Set(row.mixedOwnerDbIds);
    const owners = ownerClass === 'mixed' ? mixed : new Set(row.ownerDbIds.filter((dbId) => !mixed.has(dbId)));
    if (owners.size > 0) out.set(row.modelKey, owners);
  }
  return out;
}

async function planStage(run) {
  run.transition('planning');
  const registry = run.spec.coordinator.registry;
  const keys = run.spec.modelKeysOf(run.resolution.definition);   // ascending, distinct
  // R7 / review I2: ONE snapshot; its frozen bindings already carry valid cached leases (P1
  // decision 2). No second admitModel loop, and nothing is written back onto a frozen binding.
  run.snapshotKeys = keys;
  run.snapshot = registry.snapshotBindings(keys);         // {registryRevision, bindings}
  if (run.snapshot.bindings.some((b) => b === null)) {    // null = dead | unregistered | lease-invalid (N10)
    return run.failPlanning('model-not-bound');
  }
  // §13.2: the admission baseline is read at the moment the leases are held, i.e. now.
  run.admissionBaseline = keys.map((modelKey, i) => ({
    modelKey,
    epochInstanceCount: run.spec.world.getEpochCollisionInstanceCount(run.snapshot.bindings[i].lease.epoch),
  }));
  if (run.cancelRequested !== null) return run.cancelPlanning();

  run.setPhase('enumerating');
  // A6/N15 + A17: P6 owns the budget and the ledger, and hands the ledger to the planner so
  // planning gaps, unit records and runtime taints all land in ONE object.
  // P6.4 DEVIATION from the brief's literal `run.limits`: P3's budget and ledger read
  // `maxPlanReferences`/`maxLedgerRecords`/`maxUnitsPerRun`/`maxElementTaintsPerUnit`, which are
  // RESOLVED RUN OPTIONS (options.js RUN_OPTION_SPECS; P3 ledger.js JSDoc), not engine limits —
  // and `run.limits` stays the engine limits P6.8 reads `persistTimeoutMs` from.
  run.budget = run.spec.plannerPort.createRecordBudget(run.runOptions);
  run.ledger = run.spec.plannerPort.createLedger({ limits: run.runOptions, budget: run.budget });
  let result;
  try {
    result = await run.spec.plannerPort.planRun({
      definition: run.resolution.definition,
      snapshot: run.snapshot,                             // P3's argument name, and the whole result
      enumerator: run.spec.enumerator,
      options: run.runOptions,                            // resolved run options
      checkpoint: run.enumerationCheckpoint(),            // §6.2 context checkpoint; throws
      ledger: run.ledger,                                 //   EnumerationCancelledError on cancel
    });
  } catch (err) {
    if (err.name === 'EnumerationCancelledError') return run.cancelPlanning();
    // planningCauseOf maps an enumeration/bind error to the EXHAUSTIVE §6.6.2 planning-cause enum:
    //   WorldDisposedError -> 'world-disposed'; ObjectTreeUnavailableError -> 'enumeration-failed';
    //   ModelEvictedError / dead lease -> 'model-not-bound'; a planner cap refusal -> 'plan-too-large';
    //   anything else -> 'enumeration-failed' (fail closed: an unknown planning error is never silent).
    return run.failPlanning(run.spec.planningCauseOf(err));
  }
  // N15: `planRun` returns the WRAPPER. The plan is one level down and may be null.
  if (result.status !== 'planned' || result.planningGaps.length > 0) {
    // Q2: EVERY gap is recorded as a reason; ONE of them decides the status. A non-`cancelled`
    // gap outranks a `cancelled` one (order B: failed > cancelled), so the primary is the first
    // non-`cancelled` cause if there is one — picking `planningGaps[0]` blindly would seal a run
    // `cancelled` that actually failed to enumerate.
    const causes = result.planningGaps.map((g) => g.cause);
    for (const cause of causes) run.settlementState.planningGapCauses.push(cause);
    const primary = causes.find((c) => c !== 'cancelled') ?? causes[0] ?? 'enumeration-failed';
    return primary === 'cancelled' ? run.cancelPlanning() : run.failPlanning(primary);
  }
  if (run.cancelRequested !== null) {
    // D-D (owner-authorized P6 fix, 2026-09-24). A cancel that landed during the planner's FINAL
    // yield (its `plan:built` checkpoint checks for cancellation before its slicer tick yields) is
    // first seen here, AFTER `commitPlanned` wrote the plan's unit records (all `outcome: null`) into
    // the ledger. The plan is never adopted, so it is a cancel during enumeration/planning and AC-7 /
    // §13.1 give it ONE shape: planning gap `cancelled` and NO unit ledger. Seal it from a fresh
    // ledger over the same budget -- exactly the ledger `planRun` would have left had its checkpoint
    // thrown `EnumerationCancelledError` (P3: "fully planned or exactly as the caller handed it
    // over") -- never from the committed one, whose null-outcome units no reader accepts (R21-2).
    run.ledger = run.spec.plannerPort.createLedger({ limits: run.runOptions, budget: run.budget });
    return run.cancelPlanning();
  }

  run.plan = result.plan;
  // I6: seed the plan-order oracle with the INITIAL units. Runtime split children are added to it
  // by `executeStage` as each split is admitted, so a child never falls back to the unranked
  // sentinel (see "Plan order over runtime descendants" in Task P6.5).
  run.unitOrder.seed(run.plan.units.map((u) => u.unitId));
  // A12: the run's result accumulator is created HERE, because its `ctx` needs the plan. P5 owns
  // the merge rules; P6 owns the context they read (P5 *Accumulator context*). Until this point
  // `run.results` is the inert `EMPTY_RESULTS` holder from `createRun` (C2), never `undefined`.
  run.results = run.spec.resultPort.createResultAccumulator({
    mode: run.resolution.definition.mode,
    testId: run.resolution.testRef.testId,
    semanticDigest: run.resolution.testRef.semanticDigest,
    maxResultsPerRun: run.runOptions.maxResultsPerRun,
    // §11.4 rule 2's explicit plan order. P5 accepts a `Map` **or any `{get(unitId) → number}`**
    // (P5 summary), and the oracle is the second form because its ranks are re-derived on every
    // admitted split — a `Map` snapshot taken here would freeze the plan before its descendants
    // existed and rank every one of them `Number.MAX_SAFE_INTEGER` (I6).
    unitPlanRank: run.unitOrder,
    // Built from PLAN data, never from a unit (P5's rule): Map<modelKey, Set<dbId>>.
    unreachableOwners: ownerSetsFromLedger(run.ledger, 'unreachable-only'),
    mixedOwners: ownerSetsFromLedger(run.ledger, 'mixed'),
  });
  adoptPlanIntoProgress(run, result);
  run.transition('running');
  run.setPhase('executing');
  return run.plan;
}

/**
 * R11 / review I3 — plan completion is where P3's PREPLANNED gaps join progress accounting.
 * `sizeUnits` turns an over-cap target entry into a `not-run:target-too-large` ledger record with
 * a real `pairSpaceWeight` and NO executable unit (P3 Task P3.7), and that weight is part of the
 * required pair space (AC-18(b): "`pairSpaceTotal` includes its weight as a gap"). Initializing
 * progress from `plan.units` alone would seal a `completed` run at `fractionProcessed < 1`.
 * Such a record is already terminal, so it is adopted ONCE, here, and never revisited by the loop.
 */
function adoptPlanIntoProgress(run, planResult) {
  const executable = new Set(run.plan.units.map((u) => u.unitId));
  const preTerminalGaps = run.ledger.toLedgerRecord().units
    .filter((u) => u.kind !== 'split' && !executable.has(u.unitId) && u.outcome === 'not-run');

  run.pending.unitsTotal = run.plan.units.length + preTerminalGaps.length;
  run.pending.pairSpaceTotal = run.plan.pairSpaceTotal;   // already includes the gap weights
  // R11: the WEIGHT comes from P3's accessor, not from re-summing the records here. The record
  // scan above still runs, because P6 needs each gap's `cause` for §16.7 and the unit COUNT for
  // `unitsTotal` — neither of which the scalar carries — but the arithmetic that has to agree
  // with `pairSpaceTotal` is P3's own, and the assertion below is the standing guard.
  run.pending.pairSpaceProcessed += planResult.preTerminalGapWeight;   // processed, never evaluated
  for (const gap of preTerminalGaps) {
    run.pending.unitsFailedOrSkipped += 1;
    run.settlementState.unitCauses.push(gap.cause);          // §16.7 collects it like any other fact
  }
  run.commit('state');
}

/**
 * D-C (owner-authorized P6 fix, 2026-09-24; owner ruling: PRESERVE AC-21 (ii)). §16.7 B applies at
 * "every boundary (including planning slices)", and rule 1 makes a disposed world outrank a cancel
 * requested in the same slice. The CollisionWorld surface has no disposal query — disposal is
 * observable only as a `WorldDisposedError` thrown by a world call — and an enumerator need not call
 * the world at all, so a planning cancel could never see a disposal that happened after the admission
 * baseline was read. This is the NARROW observation point: when planning settles on a cancel after
 * the run-start snapshot exists (i.e. the run holds epochs to ask about), probe the world ONCE with
 * the same read-only O(1) call that baseline already makes. ONLY `WorldDisposedError` (by name, as
 * `planningCauseOf` maps it) counts; any other probe error, or a world double without the method,
 * leaves the cancel's classification unchanged — the probe can surface disposal, never invent a
 * failure. A pre-resolution / pre-snapshot cancel has no epoch to probe and is left as it was.
 */
function worldDisposedAtPlanningBoundary(run) {
  const world = run.spec.world;
  const binding = run.snapshot?.bindings?.find((b) => b !== null);
  if (binding === undefined || typeof world?.getEpochCollisionInstanceCount !== 'function') return false;
  try {
    world.getEpochCollisionInstanceCount(binding.lease.epoch);
    return false;
  } catch (err) {
    return err?.name === 'WorldDisposedError';
  }
}

/** `failPlanning(cause)` and `cancelPlanning()` both funnel here so §16.7 order B is applied once. */
function settlePlanning(run, cause) {
  if (cause === 'cancelled' && worldDisposedAtPlanningBoundary(run)) cause = 'world-disposed';
  run.settlementState.planningCause = cause;
  // Q2: a cause P6 detected itself (a cancel, a rejected lookup, `model-not-bound`) is a gap too,
  // and `collectReasons` reads the gap list — not `planningCause` alone — for the reasons.
  if (!run.settlementState.planningGapCauses.includes(cause)) {
    run.settlementState.planningGapCauses.push(cause);
  }
  const status = resolveRunStatus(run.settlementState);   // 'failed' for anything but 'cancelled'
  // A17: the gap goes on P3's ledger (P5 has no such call), as the {phase, cause} row §6.6.2 and
  // P5's pinned `Ledger.planningGaps` both use. A run that never planned still has a ledger.
  // NOTE `recordPlanningGap` — NOT `recordGap`, which records a *unit* gap and would put a unit
  // record in a ledger this path must leave at `units: []`.
  // (P6.4: `run.runOptions`, not the brief's literal `run.limits` — see planStage.)
  run.ledger ??= run.spec.plannerPort.createLedger({
    limits: run.runOptions,
    budget: run.spec.plannerPort.createRecordBudget(run.runOptions),
  });
  run.ledger.recordPlanningGap({ phase: run.phase, cause });
  return run.sealAs(status);                              // zero units, coverage 'partial'
}

/**
 * The queued-withdrawal path (R5, review C2). A run cancelled while still queued has never had its
 * job function invoked, so no loop boundary exists to settle it; the withdrawal winner must seal it
 * directly. `withdraw()` is synchronous and returns `true` to exactly one caller, which makes this a
 * race with one winner and no double seal.
 */
function cancelWhileQueued(run) {
  // TRUE  => we removed it from the queue; its `run` function will never be called, so WE owe it
  //          the pre-resolution cancelled seal and the conversion of its reserved slot.
  // FALSE => it had already started; its own next boundary observes `cancelRequested` and seals.
  if (run.spec.coordinator.cancelQueued(run.runId) !== true) return;
  void settlePlanning(run, 'cancelled');                  // zero units, definition null (§13.1)
}

/** The `buildResultSet` parts, in the PRE-resolution shape when the run never resolved (§13.1).
 *  `override` (P6.8, the R10 fallback only) supplies the ledger and results so the fallback never
 *  touches the records whose assembly may just have failed. */
function resultParts(run, outcome, diagnostics, override = null) {
  const resolved = run.resolution !== undefined;
  const ledger = override?.ledger ?? run.ledger.toLedgerRecord();
  return {
    runId: run.runId,
    testRef: resolved
      ? run.resolution.testRef
      : { testId: run.spec.testIdOfInput, revision: null, semanticDigest: null },
    definition: resolved ? run.resolution.definition : null,
    // I7: validated and normalized once, in `createRun`. Reading it off the run (not off the raw
    // spec, and with no `?? null` rescue here) is what makes a missing field a loud construction
    // error instead of a silently dropped rerun lineage.
    derivedFromRunId: run.derivedFromRunId,
    outcome,
    // provenanceBase + models + admissionBaseline (the R10 fallback may supply its own, see there).
    // M1: `libraryExclusions` comes from THIS set's ledger, so both are read from the one record.
    provenance: override?.provenance ?? run.provenance({ ledger }),
    ledger,                                               // A17: arrays-only, P5's pinned shape
    // C2: ALWAYS defined — `EMPTY_RESULTS` before planning, P5's accumulator after it. This is the
    // one call every pre-resolution path makes, and the reason the holder exists at all.
    results: override?.results ?? run.results.toArray(),       // A12: the accumulator
    diagnostics,                                          // A11: aggregator snapshot()
    statistics: run.spec.statisticsAccumulator.snapshot(),
  };
}

// ================================================================================================
// The unit loop — pulled forward VERBATIM from the P6.5 brief (controller ruling 4)
// ================================================================================================

// §6.4: only the two PER-CALL budget kinds scale with source count, so only they are splittable.
const SPLITTABLE_CAPACITY_KINDS = new Set(['tlas-candidate-budget', 'clearance-narrow-phase-budget']);
// R8: how a split refusal maps onto a §16.7 fact. `unsplittable` is NOT a cap refusal — the
// unit's own capacity failure stands (§6.4 item 4 "and is a gap").
const SPLIT_REFUSAL_FACT = Object.freeze({
  unsplittable: null,                                     // keep the capacity-exceeded settlement
  'unit-cap': 'unit-cap',
  'ledger-cap': 'unit-cap',
});

async function executeStage(run) {
  const queue = [...run.plan.units];                      // leaf work list, grows on a split
  let first = true;
  while (queue.length > 0) {
    if (!first) await run.interUnitYield();               // §7.3: animation-frame-aligned or macrotask
    first = false;

    // --- BOUNDARY: collect facts from committed state BEFORE choosing anything (§16.7) ---
    const boundary = run.collectBoundaryFacts();
    const boundaryStatus = resolveRunStatus(boundary);
    if (boundaryStatus !== null && boundaryStatus !== 'completed') {
      run.markRemainingNotRun(queue, boundaryStatus === 'cancelled' ? 'cancelled' : 'run-failed');
      return run.sealAs(boundaryStatus);
    }

    const unit = queue.shift();
    run.pending.currentUnitId = unit.unitId;
    const result = await runUnitWithRetries(run, unit);

    if (result.split !== undefined) {                     // §6.4: the parent is superseded by 2 leaves
      queue.unshift(...result.split.children);            // the split was ALREADY admitted (R8)
      // I6: the rank oracle learns the descendants at the same instant the queue does, so a child
      // is ranked BEFORE it can ever settle a result. §11.4 rule 2 reads this through `ctx`.
      run.unitOrder.split(unit.unitId, result.split.children.map((c) => c.unitId));
      run.pending.unitsTotal += 1;                        // +1 LEAF per split; weight is CONSERVED
      run.ledger.recordOutcome(unit.unitId, {
        outcome: 'split', cause: null,
        children: result.split.children.map((c) => c.unitId),
      });
      run.commit('unit');
      continue;
    }

    await run.applyUnitResult(unit, result);              // merges iff result.settlement.merges
    run.commit('unit');
  }
  run.pending.currentUnitId = null;
  // §16.3.3 — the end-of-plan check IS a boundary.
  const endState = run.collectBoundaryFacts({ allLeafUnitsTerminal: true });
  return run.sealAs(resolveRunStatus(endState) ?? 'completed');
}

async function runUnitWithRetries(run, unit) {
  const maxAttempts = run.runOptions.maxPlacementRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A7/N16: `materializeUnit` returns {sourceDbIds, targets, scopeExpect}. The third field IS
    // the §16.3.2 bracket expectation including R20-1; P6 passes it through and builds none.
    const materialized = run.spec.plannerPort.materializeUnit(run.plan, unit);
    const request = Object.freeze({
      unit,
      materialized: Object.freeze({ ...materialized }),
      runId: run.runId,
      attempt,
      mode: run.resolution.definition.mode,
      ...(run.resolution.definition.mode === 'clearance'
        ? { clearance: run.resolution.definition.clearance } : {}),
      broadPhase: run.runOptions.broadPhase,
      snapshot: run.snapshotFor(unit),
      limits: Object.freeze({
        maxPairsPerOutcome: run.runOptions.maxPairsPerOutcome,
        maxDiagnosticsPerOutcome: run.runOptions.maxDiagnosticsPerOutcome,
        maxDistinctReasons: run.runOptions.maxDistinctReasons,
      }),
    });

    let outcome;
    let facts = [];
    let phase = 'post';
    try {
      outcome = await run.spec.executor(request);         // A9: the executor IS the function
    } catch (err) {
      // An executor that THROWS is a defect of the executor, not a library signal: the port
      // returns outcomes (§7.1). Fail fast, with P4's canonical substitute (A10).
      const issues = [{ code: 'executor-threw', path: '', detail: String(err?.name ?? err) }];
      return run.unitResult(unit, classifyUnitSettlement(['internal-error'], 'call'),
        run.spec.internalErrorOutcome(request, issues), attempt);
    }
    // A10/N8: ALWAYS two fields, and `issues` are {code, path, detail} OBJECTS. On `ok:false` the
    // substitute is P4's `internalErrorOutcome`, never a hand-built one — hand-building it would
    // stringify structured issues into the ledger as "[object Object]".
    const valid = run.spec.validateUnitOutcome(request, outcome);
    if (valid.ok !== true) {
      // P6.8 (controller Ruling A, after P6.5): P4's `pairs-over-cap` issue is the per-outcome result
      // cap of §17.1 (`maxPairsPerOutcome`), not an executor defect, so it is the `result-cap` FACT —
      // the same fact the accumulator's whole-unit `maxResultsPerRun` refusal in `applyUnitResult`
      // settles with. Any OTHER issue is still `internal-error`; when both occur, both facts are
      // observed and table A picks `internal-error` (rank 2 over rank 3), so a genuinely malformed
      // outcome can never be softened into a cap. The outcome itself is untrusted either way, so the
      // unit is recorded from P4's canonical substitute (no pairs, no diagnostics, no statistics) and
      // `merges` is false: the whole unit is refused, exactly as a result-cap refusal is.
      const overCap = valid.issues.some((i) => i.code === 'pairs-over-cap');
      const otherIssues = valid.issues.some((i) => i.code !== 'pairs-over-cap');
      const facts = [...(overCap ? ['result-cap'] : []), ...(otherIssues ? ['internal-error'] : [])];
      return run.unitResult(unit, classifyUnitSettlement(facts, 'call'),
        run.spec.internalErrorOutcome(request, valid.issues), attempt);
    }
    ({ facts, phase } = run.factsFromOutcome(request, outcome));

    // §7.5 row 2 — C1. Eligibility is read off P4's ACTUAL outcome, never off an invented fact:
    //   (1) the producer classified it as `stale-placement` and declared it `retryable: true`
    //       (P4 `classifyLibraryError`: that pair happens only for `ModelPlacementChangedError`
    //       with the engine generation unchanged);
    //   (2) P6's own generation comparison agrees — the run's snapshot generation for every model
    //       the unit touches is unmoved, and P4's two bracketing reads agree with each other, so
    //       nothing changed placement under the attempt either;
    //   (3) nothing else was observed. Any other fact outranks `stale-placement` in table A
    //       (ranks 1-7) or ties at rank 8, and a unit with a second fact must SETTLE, not retry.
    // Retrying anything else would re-issue a unit whose inputs are already known to have moved.
    //
    // P6.5 fix (task review): the brief's own pseudocode called `isRetryablePlacement` for the
    // retry DECISION only and, once it returned false because the generation had moved (as opposed
    // to false for any of the OTHER three reasons), fell straight into `classifyUnitSettlement(facts,
    // phase)` with `facts` still `['stale-placement']` — sealing the unit `failed:stale-placement`
    // and the run merely `completed` with `environmentSensitiveCauses: ['placement-contention']`,
    // exactly the ENGINE-DETECTED-nothing-else-changed shape (§7.5 row 2 / the "retries exhausted"
    // test), even when P6's OWN generation comparison is the thing that caught a real placement
    // change. §7.5 row 3 is unambiguous that a placement change is `input-changed`/`invalidated`
    // — the executor's own `retryable: true` must never talk P6 into treating a caught change as a
    // mere capacity-style gap. `isEligibleStalePlacementShape` isolates conditions (1)-(3) so the
    // generation check (`placementGenerationsSteady`) is computed once and read for BOTH the retry
    // decision and this reclassification, instead of two call sites risking different answers.
    if (isEligibleStalePlacementShape(outcome, facts)) {
      if (placementGenerationsSteady(run, unit, outcome.generations)) {
        if (attempt < maxAttempts) continue;
        // exhausted, generation never moved: falls through to the normal `stale-placement` settle.
      } else {
        const moved = classifyUnitSettlement(['input-changed'], phase);
        return run.unitResult(unit, moved, outcome, attempt, { capacityKind: null });
      }
    }
    const settlement = classifyUnitSettlement(facts, phase);

    // §6.4: a splittable capacity failure is a split DECISION, made by the engine — but the
    // ADMISSION is P3's (R8, review C5). P6 no longer guards with `run.plan.units.length`, which
    // never changes as runtime children are created and therefore bounded nothing.
    if (settlement.cause === 'capacity-exceeded'
        && SPLITTABLE_CAPACITY_KINDS.has(outcome.failure?.capacityKind)) {
      // A8/N17: takes the WorkUnit, never `(unitId, capacityKind)`; returns a wrapper, never null.
      const split = run.spec.plannerPort.splitUnit(run.plan, unit);
      if ('children' in split) {                          // the ONLY successful shape
        return { split, settlement: null, outcome: null, attempt };
      }
      // Test the REASON. `{reason:'unsplittable'}` is truthy, so `split !== null` would have
      // queued two `undefined` children and corrupted the ledger instead of throwing.
      const fact = SPLIT_REFUSAL_FACT[split.reason];
      if (fact === null) {                                // unsplittable: the capacity gap stands
        return run.unitResult(unit, settlement, outcome, attempt,
          { capacityKind: outcome.failure.capacityKind });
      }
      return run.unitResult(unit, classifyUnitSettlement([fact], 'call'), outcome, attempt,
        { capacityKind: outcome.failure.capacityKind, capDetail: split.capDetail ?? null });
    }
    return run.unitResult(unit, settlement, outcome, attempt,
      { capacityKind: outcome.failure?.capacityKind ?? null });
  }
  /* c8 ignore next */ throw new Error('unreachable: retry loop always returns');
}

/**
 * C1 — the SHAPE half of the retry-eligibility rule (conditions (1)-(3) of the comment above this
 * call site), split from the generation check so `runUnitWithRetries` can read `placementGenerationsSteady`
 * once and use it for both the retry decision and the input-changed reclassification (P6.5 fix).
 */
function isEligibleStalePlacementShape(outcome, facts) {
  if (outcome.outcome !== 'failed') return false;
  if (outcome.failure === null || outcome.failure.code !== 'stale-placement') return false;
  if (outcome.failure.retryable !== true) return false;
  if (facts.length !== 1 || facts[0] !== 'stale-placement') return false;   // (3): nothing else
  return true;
}

/** (2): the engine's OWN placement generation for this unit's models, across all three reads. */
function placementGenerationsSteady(run, unit, generations) {
  const atSnapshot = run.snapshotGenerationsFor(unit);       // Map<modelKey, placementGeneration>
  const bySide = (side) => new Map(generations[side].map((g) => [g.modelKey, g.placementGeneration]));
  const [start, end] = [bySide('start'), bySide('end')];
  for (const [modelKey, generation] of atSnapshot) {
    if (start.get(modelKey) !== generation) return false;    // moved before the attempt
    if (end.get(modelKey) !== generation) return false;      // moved during the attempt
  }
  return true;
}

/** Progress commit — the single place counters move, so monotonicity is structural rather than asserted. */
async function applyUnitResult(run, unit, { settlement, outcome, attempt, extra }) {
  const weight = unit.pairSpaceWeight;

  // A DISCARDED or SKIPPED unit contributes NOTHING — not its results and not its diagnostics
  // (§16.3 item 3): merging a drifted unit's evidence is exactly what invariant I-scope forbids.
  //
  // C4 — THE COMMIT IS TRANSACTIONAL, AND THE ADMISSION GATE RUNS FIRST.
  // P5's accumulator exposes only a mutating `addUnit` that ANSWERS with a refusal (A12/N21:
  // `{accepted, reason?, added?}`), and that refusal is whole-unit: on `{accepted:false}` the
  // accumulator added nothing (P5 *whole-unit `maxResultsPerRun` boundary rule*; cross-file need
  // C-P5-2 below pins it as a requirement rather than an observation). There is no non-mutating
  // projection to consult, so ORDER is the transaction: ask the only refusing collaborator first,
  // and touch the irreversible ones — diagnostics, statistics, taints, progress counters — only
  // after it has accepted. The old order aggregated first and could not roll back, so a refused
  // unit still moved `caveatCount`, the statistics totals, the taint ledger, and through them
  // `integrity` and `environmentSensitive` — for a unit the plan says merged nothing.
  let unitTaints = [];
  if (settlement.merges) {
    const merge = run.results.addUnit(outcome);           // (1) the ONLY step that can refuse
    if (merge.accepted === false) {                       // reason === 'result-cap'
      // Nothing above this line mutated anything, so the re-classification starts from a clean
      // state: it re-enters with `merges: false`, skipping this whole block.
      return applyUnitResult(run, unit, {
        settlement: classifyUnitSettlement(['result-cap'], 'post'), outcome, attempt, extra,
      });
    }
    // (2) committed: from here the unit IS merged.
  }

  // P6 whole-branch review I2 — the ledger record is written IMMEDIATELY after the accumulator's
  // decision, before any other collaborator runs. The results and the record that justifies them are
  // one commit: `validateResultSet` (R21-4) requires every result's `unitId` to name an `evaluated`
  // leaf, and the stage-failure handler (`settleStageFailure`) closes every STILL-NULL record as
  // `not-run:run-failed`. Recording after the diagnostic aggregator / statistics accumulator (the old
  // order) meant a throw from either left merged results under a `not-run:run-failed` record — a sealed
  // set its own reader rejects as `result-unit-invalid`. Now a throw there leaves an `evaluated`
  // record with its results (still sealed `failed:internal-error` by the stage-failure path), and the
  // null-record sweep only ever closes units that merged nothing.
  // ACCEPTED RESIDUAL (internal fault only): the SIDECARS are not transactional with the merge. An
  // aggregator that throws after partly absorbing this unit's diagnostics, or a statistics throw
  // after the aggregator committed, seals this `evaluated` unit with partial diagnostics / statistics
  // / taints. That set still validates, and it is `failed` with `unit:internal-error`, so it is never
  // claimable; a prepare/commit protocol across P4's collaborators is out of P6's scope.
  // A17: the ledger is P3's. `recordOutcome` writes INLINE fixed-size fields only, so it can never
  // be refused by the budget (§6.5.1) — which is what makes a gap recordable when the pool is full.
  run.ledger.recordOutcome(unit.unitId, {
    outcome: settlement.outcome,
    cause: settlement.cause,
    secondaryCauses: settlement.secondaryCauses,          // deterministic by R4; see the digest note
    capacityKind: extra?.capacityKind ?? null,
    capDetail: extra?.capDetail ?? null,
    scopeProof: outcome?.scopeProof ?? 'not-checked',
    attempts: attempt,
    durationMs: outcome?.durationMs ?? 0,
  });
  // The progress counters move with the record (same I2 commit), so a later collaborator throw can
  // never leave an `evaluated` record whose weight `settleStageFailure` (null records only) never counts.
  if (settlement.merges) {
    run.pending.unitsEvaluated += 1;
    run.pending.pairSpaceEvaluated += weight;
    run.pending.resultsFound = run.results.size();
  } else {
    run.pending.unitsFailedOrSkipped += 1;
  }
  run.pending.pairSpaceProcessed += weight;               // evaluated + gaps: always advances

  if (settlement.merges) {
    // A11/N20 + D3: ONE stateful aggregator per run, awaited per settled unit; it returns the
    // extra unit-wide taints this unit earned. There is no `aggregateDiagnostics(...)` pair.
    ({ unitTaints } = await run.spec.diagnosticAggregator.addUnit(unit.unitId, outcome));
    run.spec.statisticsAccumulator.add(outcome.statistics, outcome.durationMs);
  }
  // N9: `deriveUnitTaints` gets the NON-charging capacity peek; `ledger.addTaint` does the one
  // real, charging admission and owns the taint-overflow collapse (A11, A17).
  const derived = settlement.merges
    ? run.spec.deriveUnitTaints(outcome.diagnostics, {
        maxElementTaintsPerUnit: run.runOptions.maxElementTaintsPerUnit,
        admit: (n) => run.budget.discretionaryRemaining >= n,
      }).taints
    : [];
  for (const taint of [...derived, ...unitTaints]) run.ledger.addTaint(unit.unitId, taint);

  const diagnostics = run.spec.diagnosticAggregator.snapshot();
  run.pending.caveatCount = diagnostics.completenessAffectingCount;
  run.pending.caveatUnclassified = diagnostics.unclassifiedOccurrences;
  // I5: U9 has NO fact and NO cause (§16.7 table A, and `classifyUnitSettlement` returns
  // `cause: null` for it). `?? 'evaluated'` invented one, and `collectReasons` turned it into
  // `unit:evaluated` on every clean run — a fabricated caveat inside `RunOutcome.reasons`, which
  // is digested into the sealed set and read by consumers as "something went wrong here".
  // `observedCauses` is EMPTY for U9, so I5 is structural here: no null, no placeholder.
  //
  // A7 / §22 AC-21 — push EVERY observed cause, not just the primary. The unit record's
  // `secondaryCauses` truncates at 8; `RunOutcome.reasons` must not. Pushing the whole set here is
  // what keeps the run-level record complete, and it provably cannot change `resolveRunStatus`:
  // the primary always has equal or higher PRECEDENCE (numerically equal or lower rank) than any secondary fact, so an observed failing fact
  // (rank 1-3) implies a failing primary and an observed invalidating fact (rank 4-5) implies a
  // primary of rank 1-4 — failing or invalidating either way. Order B's answer is unchanged.
  for (const c of settlement.observedCauses) run.settlementState.unitCauses.push(c);
}

// --- Pulled forward from the P6.6 brief (Step 3), with the two fixes P6.4 needs to make it run ---

const SCOPE_PROOF_FACT = Object.freeze({
  drift: 'scope-drift',
  unverifiable: 'scope-unverifiable',
  equal: null,
  'not-checked': null,                                    // only legal on a non-evaluated outcome
});
// The §16.7 fact vocabulary. The P6.6 sketch reads `UNIT_FACTS` without defining it; it is exactly
// table A's real facts, so a P4 cause that is not a fact (`cancelled`, `run-failed`) never becomes one.
const UNIT_FACTS = new Set(UNIT_PRECEDENCE.map((row) => row.fact).filter((f) => f !== null));

/**
 * Facts for ONE settled attempt, collected from committed state before anything is decided
 * (§16.7). The scope answer is one of them; it is never applied on its own.
 *
 * P6.4 fix vs. the P6.6 sketch (carry-forward CF4): the outcome KIND is `outcome.outcome` (P4's
 * §11.2 field); the sketch's `outcome.kind` is always `undefined`, so a `skipped` outcome would have
 * been classified in the `call`/`post` column instead of `pre`.
 *
 * P6.6 — P4 H1 carry-forward (owner ruling; controller ruling for this task). The executor's own
 * `failure.code` carries ONE thrown cause and `scopeProof` ONE bracket answer, so a participant that
 * died during a call which ALSO threw `capacity-exceeded` reaches P6 as capacity + `unverifiable`
 * and nothing else — and settled U7 `scope-unverifiable` where table A says U6 `model-evicted`.
 * P6 therefore detects the death ITSELF, with `scanUnitParticipants`, and adds the fact here, before
 * `classifyUnitSettlement` ever sees the list:
 *   - `model-evicted` when one of THIS unit's participants is dead / unregistered / lease-invalid
 *     (`null`, N10) or re-bound (its binding identity moved) since the run-start snapshot;
 *   - `input-changed` when one of THIS unit's participants' `placementGeneration` moved — this is
 *     what the P6.4 `placementChangedSince` stand-in stood for — EXCEPT on the §7.5-row-2 retry
 *     shape (`isEligibleStalePlacementShape`): there the retry protocol already makes the SAME
 *     generation comparison (`placementGenerationsSteady`) and turns a moved generation into
 *     `input-changed` itself, and adding the fact here would both duplicate that decision and
 *     disqualify the shape before the protocol could run it.
 * Only the COARSE fact enters the list. The model KEY that died goes to `run.deadModelKeys` /
 * `run.staleReasons` (seal-time freshness only) and never into the fact list, `secondaryCauses` or
 * `RunOutcome.reasons` — so AC-21's digest still depends only on WHICH coarse facts were observed.
 * `world-disposed` needs no live read: see the `worldDisposed` comment in `installRunMethods`.
 */
function factsFromOutcome(run, request, outcome) {
  const facts = [];
  const phase = outcome.outcome === 'skipped' ? 'pre' : (outcome.failure !== null ? 'call' : 'post');
  const scopeFact = SCOPE_PROOF_FACT[outcome.scopeProof];
  if (scopeFact !== null) facts.push(scopeFact);
  if (outcome.failure !== null && UNIT_FACTS.has(outcome.failure.code)) facts.push(outcome.failure.code);
  // P6.8 fix round 2 (re-review, Critical): §7.1/§17.1 — over-cap is "whether `pairs.length` exceeds
  // it OR the executor reports `pairsOverflowLength > limits.maxPairsPerOutcome` with `pairs: []`".
  // The oversized-array half is the `pairs-over-cap` validation issue (`runUnitWithRetries`); this
  // is the marker half, and it is the one P4's real `LocalUnitExecutor.projectPairs` always uses. A
  // marker only reaches here after `validateUnitOutcome` accepted it (safe integer > the cap, empty
  // `pairs`, `evaluated` outcome — `checkOverflowMarker`), so it is the same `result-cap` FACT, with
  // the same whole-unit refusal (`merges: false`) and the same table-A precedence against every
  // other fact collected here. Without it the unit settled `evaluated` with zero pairs: a false clean.
  // (`diagnosticOverflowLength` is deliberately NOT read here: bounded diagnostic overflow is H7.2's
  // accepted, tainted path in the diagnostic aggregator, not a result cap.)
  if (outcome.pairsOverflowLength !== undefined) facts.push('result-cap');
  const live = scanUnitParticipants(run, request.unit);
  if (live.evicted && !facts.includes('model-evicted')) facts.push('model-evicted');
  if (live.placementMoved && !isEligibleStalePlacementShape(outcome, facts)) facts.push('input-changed');
  if (run.worldDisposed) facts.push('world-disposed');
  // P6 whole-branch review C2 — FAIL CLOSED on a self-reported non-evaluated outcome that yielded no
  // fact. P4's invariant (`validateUnitOutcome` step 3) is `outcome !== 'evaluated' ⇔ failure !== null`,
  // and every §8.3 cause in `UNIT_CAUSES` IS a table-A fact EXCEPT `cancelled` and `run-failed`: those
  // two are engine-side ledger CONSEQUENCES (`not-run:cancelled` / `not-run:run-failed`, written by
  // `markRemainingNotRun` / `settleStageFailure`), never an executor's own cause — P4's reference
  // executor emits neither. So the ONLY way to reach here with an empty list on a non-evaluated outcome
  // is `failure.code ∈ {cancelled, run-failed}` with `scopeProof` `equal`/`not-checked` and a clean live
  // scan — which table A would otherwise classify U9 (`evaluated`, `merges: true`) and MERGE: a unit the
  // executor itself reported `failed`/`skipped`/`discarded` sealed as a clean result. It is an executor
  // contract violation, i.e. `internal-error`. Every legitimate non-evaluated outcome already carries at
  // least one fact (its own table-A `failure.code`, or its drift/unverifiable `scopeProof`), so this
  // guard cannot fire on one; and an `evaluated` outcome (`failure === null`) is never touched.
  if (outcome.outcome !== 'evaluated' && facts.length === 0) facts.push('internal-error');
  return { facts, phase };
}

/**
 * The UNIT-SCOPED live-participant scan (P6.6, P4 H1). Reads ONLY `unitModelKeys(unit)` — a death
 * among the run's other models is never this unit's fact — in ONE `snapshotBindings` call, and
 * compares each current binding with the one the run-start snapshot froze (`bindingInSnapshot`).
 * N10: there is no `dead` flag; `null` covers dead, unregistered and lease-invalid.
 *   - `null`                              -> evicted (dead)            -> run.deadModelKeys
 * Otherwise the checks are INDEPENDENT, never an if/else-if chain (P6.6 task-review fix): P1's
 * registry keeps `placementGeneration` across a re-registration, so a reload followed by a placement
 * change moves BOTH generations, and §16.7 settles on the whole fact SET — an exclusive chain
 * reported only `model-evicted` (rank 6) and hid `input-changed` (rank 4), getting both the cause
 * and the outcome kind wrong.
 *   - `bindingGeneration` moved           -> evicted (reload/re-bind)  -> run.staleReasons
 *   - `placementGeneration` moved         -> placementMoved (input-changed)
 *   - neither moved, yet not `bindingsEquivalent` (different model object/version: never produced
 *     by a conforming registry)           -> evicted, FAIL CLOSED      -> run.staleReasons
 * The per-model detail it records uses the same vocabulary `collectBoundaryFacts` does, so
 * `sealTimeFreshness` reads one set of reasons whichever of the two observed the change first.
 */
function scanUnitParticipants(run, unit) {
  const keys = unitModelKeys(unit);
  const now = run.spec.coordinator.registry.snapshotBindings(keys);
  let evicted = false;
  let placementMoved = false;
  keys.forEach((modelKey, i) => {
    const was = bindingInSnapshot(run, modelKey);
    const is = now.bindings[i];
    if (is === null) {
      evicted = true;
      run.deadModelKeys.add(modelKey);
      return;
    }
    const bindingMoved = is.bindingGeneration !== was.bindingGeneration;
    const placementMovedHere = is.placementGeneration !== was.placementGeneration;
    if (placementMovedHere) {
      placementMoved = true;
      run.staleReasons.add(`placement-changed:${modelKey}`);
    }
    if (bindingMoved || (!placementMovedHere && !bindingsEquivalent(is, was))) {
      evicted = true;
      run.staleReasons.add(`model-reloaded:${modelKey}`);
    }
  });
  return { evicted, placementMoved };
}

// ================================================================================================
// Loop helpers the pulled-forward loop calls that no brief defines (P6.4 stand-ins / real versions)
// ================================================================================================

/**
 * §16.2/§16.3: the run compares the CURRENT binding against the one its run-start snapshot froze,
 * through P1's `bindingsEquivalent` — there is no `dead` flag to test (N10), and `null` already
 * covers dead, unregistered and lease-invalid. `placementGeneration` moving is `input-changed`
 * at the unit level and `placementChangedVsSnapshot` at the run level (§16.7 order B ⇒ invalidated);
 * `bindingGeneration` moving alone is deliberately NOT an input-change signal (§16.1 vs §16.3,
 * settled in the spec's own R-list) — it surfaces as a `model-evicted` gap and a `stale` seal.
 *
 * This is the RUN-level scan (every snapshot model; order B + freshness). The per-UNIT settlement
 * fact is `scanUnitParticipants`'s job (P4 H1), which reads only the unit's own participants.
 * (P6.6: the brief's Step 4 body, with ONE task-review alignment: the placement check and the
 * reload check are independent, exactly as in `scanUnitParticipants`, so a participant that was
 * re-bound AND moved records both freshness reasons. Order B is unchanged — only the placement move
 * sets `placementChangedVsSnapshot`; `model-reloaded` feeds seal-time freshness alone.)
 */
function collectBoundaryFacts(run, extra = {}) {
  const now = run.spec.coordinator.registry.snapshotBindings(run.snapshotKeys);
  run.snapshot.bindings.forEach((was, i) => {
    const is = now.bindings[i];
    if (is === null) { run.deadModelKeys.add(was.modelKey); return; }
    const placementMoved = is.placementGeneration !== was.placementGeneration;
    if (placementMoved) {
      run.settlementState.placementChangedVsSnapshot = true;
      run.staleReasons.add(`placement-changed:${was.modelKey}`);
    }
    if (is.bindingGeneration !== was.bindingGeneration || (!placementMoved && !bindingsEquivalent(is, was))) {
      run.staleReasons.add(`model-reloaded:${was.modelKey}`);
    }
  });
  return { ...run.settlementState, ...extra };
}

/**
 * §16.4 bullet 3: at seal, `outcome.freshness = 'stale'` if any binding died, any generation moved,
 * or any unit ended `scope-drift`; else `'current'`. Computed INDEPENDENTLY of which status won
 * (§16.7 closing paragraph), from the ledger P3 owns and the reasons the boundaries (and the
 * unit-scoped scan) already committed. Only `.state` reaches `RunOutcome.freshness` (§8.3, C1);
 * `.reasons` are per-model, read-time data that must never enter the digested `RunOutcome.reasons`
 * (brief Step 5, "Where the detailed reasons go"; AC-21). (P6.6: the brief's Step 5 body, verbatim.)
 */
function sealTimeFreshness(run) {
  const reasons = new Set(run.staleReasons);              // committed at each boundary, above
  for (const record of run.ledger.toLedgerRecord().units) {
    if (record.cause === 'scope-drift' || record.cause === 'model-evicted') {
      reasons.add(`${record.cause}:${record.sourceModelKey}`);
    }
  }
  for (const modelKey of run.deadModelKeys) reasons.add(`model-evicted:${modelKey}`);
  return Object.freeze({
    state: reasons.size === 0 ? 'current' : 'stale',
    reasons: Object.freeze([...reasons].sort()),
  });
}

/**
 * Every unit still queued when a boundary stops the loop is recorded as a TERMINAL, never-attempted
 * ledger outcome: `not-run:<cause>` (`cancelled` or `run-failed`, P4's §8.3 cause vocabulary) through
 * `recordOutcome` — the inline, budget-free writer — on the record the planner already made for it.
 * (`recordGap` would CREATE a record, and these units already have one.) The causes are CONSEQUENCES
 * of the run-level fact that stopped the loop, not §16.7 facts, so nothing is pushed onto
 * `settlementState.unitCauses`. Progress: `unitsTotal` already counts these units (adoption, or the
 * +1 of the split that produced them), so each one moves `unitsFailedOrSkipped` and adds its weight to
 * `pairSpaceProcessed` — it is a terminal gap, and "processed = evaluated + gaps" (AC-18). The
 * terminal commit that follows publishes the counters; no separate event is emitted here.
 */
function markRemainingNotRun(run, queue, cause) {
  for (const unit of queue.splice(0)) {
    run.ledger.recordOutcome(unit.unitId, { outcome: 'not-run', cause });
    run.pending.unitsFailedOrSkipped += 1;
    run.pending.pairSpaceProcessed += unit.pairSpaceWeight;
  }
  run.pending.currentUnitId = null;
}

/** The per-unit request snapshot: one entry per model the unit touches (source first, then targets). */
function unitModelKeys(unit) {
  return [...new Set([unit.sourceModelKey, ...unit.targets.map((t) => t.modelKey)])];
}

function bindingInSnapshot(run, modelKey) {
  const i = run.snapshotKeys.indexOf(modelKey);
  const binding = i < 0 ? null : run.snapshot.bindings[i];
  if (binding === null) throw new Error(`internal-error: unit model ${modelKey} is not in the run snapshot`);
  return binding;
}

function snapshotFor(run, unit) {
  return Object.freeze(unitModelKeys(unit).map((modelKey) => {
    const b = bindingInSnapshot(run, modelKey);
    return Object.freeze({
      modelKey, modelVersion: b.modelVersion,
      bindingGeneration: b.bindingGeneration, placementGeneration: b.placementGeneration,
    });
  }));
}

function snapshotGenerationsFor(run, unit) {
  return new Map(unitModelKeys(unit).map((k) => [k, bindingInSnapshot(run, k).placementGeneration]));
}

/**
 * §13.2 provenance: `provenanceBase` + the resolved run options + one `ProvenanceModel` row per
 * PLANNED snapshot model + the admission baseline.
 *
 * P6 whole-branch review C1: a row is P5's COMPLETE `ProvenanceModel` (resultSetSchema.js) — the
 * snapshot half (`modelVersion`, `bindingGeneration`, `placementGeneration`, a plain copy: a binding
 * itself is never embedded, because the seal deep-freezes the draft) AND the plan half, read off
 * P3's per-model plan record (`modelOf(plan, modelKey)`, planner.js / rootResolution.js step 9):
 *   - `scopeKinds`   — the distinct selection kinds the plan recorded for the model's two roles
 *                      (`{A, B}`, null where a role does not name it), ascending;
 *   - `scopeDigests` — the plan-time `{population, roots}` evidence, verbatim (§6.2.1): it is exactly
 *                      what `sealedScopeExpect` projects for read-time freshness (§16.4);
 *   - `elementCount` — the number of fragment-owning elements in the model's planned scope: the sum
 *                      of `ownerDbIds` over the model's `rootOwners` rows. Roots are a subtree-disjoint
 *                      antichain (rootResolution.js step 2's antichain check) and an owner lies in the
 *                      subtree of the root that holds its fragments, so the per-root lists are disjoint
 *                      and the sum is a distinct count. No other layer computes a per-model element count
 *                      (the root count is already `scopeDigests.roots.length`, and `population.count` is a
 *                      FRAGMENT count that exists for whole-model scopes only), so this is the one
 *                      non-redundant element count the plan can state. The tree-unreachable population
 *                      is a declared exclusion (§6.2) and is not in scope, so it is not counted.
 * Rows exist only once a plan exists: before it (pre-resolution, a planning failure, or a cancel
 * during enumeration) there is no plan-time scope evidence to record, and inventing an empty digest
 * set or a zero element count would be a fabricated provenance claim — so `models` is empty, exactly
 * as it always was before the snapshot. A plan that lacks a record for a snapshot model is a P3
 * contract violation and THROWS (fail closed), never a partial row: the seal then takes the R10
 * fallback, which seals its unit-free set with `planRows: false` (no model rows) so the broken plan
 * cannot also defeat the fallback.
 */
function provenanceOf(run, { planRows = true, ledger = undefined } = {}) {
  const models = [];
  if (planRows && run.snapshot !== undefined && run.plan !== undefined) {
    run.snapshotKeys.forEach((modelKey, i) => {
      const b = run.snapshot.bindings[i];
      if (b === null) return;
      models.push({
        modelKey, modelVersion: b.modelVersion,
        ...planProvenanceOf(run.plan, modelKey),
        bindingGeneration: b.bindingGeneration, placementGeneration: b.placementGeneration,
      });
    });
  }
  // Owner ruling M1 (P7 independent-review adjudication): `libraryExclusions` is carried from the ledger
  // the set actually SEALS — the single source of truth — never recomputed and never the engine's static
  // placeholder. The caller passes the very ledger record it is about to seal (`resultParts`; the R10
  // fallback passes `emptyLedgerRecord`, whose exclusions are `[]`); only a caller that has none falls
  // back to the run's own ledger, which exists on every seal path. Order is the ledger's (code-unit
  // sorted, ledger.js); the copy keeps the sealed provenance from aliasing the ledger's array.
  const sealedLedger = ledger ?? run.ledger?.toLedgerRecord();
  return {
    ...run.spec.provenanceBase,
    libraryExclusions: [...(sealedLedger?.exclusions ?? [])],
    runOptions: run.runOptions,
    models,
    admissionBaseline: run.admissionBaseline ?? [],
  };
}

const SCOPE_KIND_ORDER = Object.freeze(['elements', 'model']);   // ascending, P5's enum

/** The plan half of one `ProvenanceModel` row (C1), as plain detached data. P3's `Plan.models` is a
 *  `Map` (the same `Map`-or-record lookup rule as P3's own `modelOf`, planner.js). */
function planProvenanceOf(plan, modelKey) {
  const models = plan.models;
  const entry = models instanceof Map ? models.get(modelKey)
    : models !== null && typeof models === 'object' && Object.hasOwn(models, modelKey)
      ? models[modelKey] : undefined;
  if (entry === undefined) {
    throw new Error(`internal-error: the plan holds no model record for snapshot model ${modelKey}`);
  }
  const kinds = new Set([entry.scopeKinds.A, entry.scopeKinds.B]);
  const { population, roots } = entry.scopeDigests;
  return {
    scopeKinds: SCOPE_KIND_ORDER.filter((k) => kinds.has(k)),
    elementCount: entry.rootOwners.reduce((n, row) => n + row.ownerDbIds.length, 0),
    scopeDigests: {
      population: population === null ? null : { count: population.count, digest: population.digest },
      roots: roots.map(({ dbId, subtreeDigest }) => ({ dbId, subtreeDigest })),
    },
  };
}

/** The §6.2 enumeration-context checkpoint: throws `EnumerationCancelledError` once a cancel is
 *  requested, otherwise ticks the run's slicer (A2) and yields when the slice budget is spent. */
function enumerationCheckpoint(run) {
  const slicer = run.slicer();
  return (label) => {
    if (run.cancelRequested !== null) throw new EnumerationCancelledError({ reason: 'cancelled' });
    return slicer.tick(label);
  };
}

// ================================================================================================
// Sealing (P6.4 permanent core; P6.8 finalize window, R10 fallback, I8 recovery)
// ================================================================================================

/**
 * PERMANENT (P6.4's core, kept as-is by P6.8 — it is exactly the build half of the brief's `sealAs`):
 * derive the outcome, assemble the draft, seal it, and convert the slot P7 reserved at admission
 * into an ordinary resident set (§13.1). Returns the sealed set; throws on any failure (the caller
 * settles through `terminalInternalError`). `run.sealed` is set ONLY once the final set exists (R10).
 */
async function buildAndAdmitResultSet(run, status) {
  const freshness = run.sealFreshnessState();            // computed regardless of which status won
  const diagnostics = run.spec.diagnosticAggregator.snapshot();          // A11
  // A13: P5 derives coverage / integrity / environmentSensitive(+Causes); P6 supplies only the
  // three fields §16.7 and §16.4 make its own, and `freshness` is the BARE state (§8.3, C1).
  const outcome = run.spec.resultPort.deriveRunOutcome({
    status,
    freshness,
    reasons: collectReasons(run.settlementState),
    ledger: run.ledger.toLedgerRecord(),                   // A17
    diagnostics,
    results: run.results.toArray(),                        // A12
  });
  // A12/N21 then A13/N22: `sealResultSet` takes ONLY `{slicer}` — outcome and diagnostics are
  // already inside the draft by construction.
  const draft = run.spec.resultPort.buildResultSet(resultParts(run, outcome, diagnostics));
  const resultSet = await run.spec.resultPort.sealResultSet(draft, { slicer: run.slicer() });
  // A14/N23 (+ I8: atomic and exception-safe, cross-file need C-P5-1; P6's recovery assumes NOTHING
  // beyond that and re-reads residency rather than guessing).
  run.spec.resultPort.residency.admitSealedSet(run.runId, resultSet);
  run.reservationSettled = true;                           // the reservation is now a resident set
  run.sealed = true;                                       // ONLY now: the final set exists
  return resultSet;
}

/**
 * §8.1: "Terminal states are absorbing; a Result Set is sealed EXACTLY ONCE."
 *
 * R10 / review I4 — two flags, not one. `sealStarted` is the re-entrancy guard (a second caller —
 * the queued-withdrawal winner, a boundary, a late cancel — gets the same `done` promise, never a
 * half-built `run.summary`). `run.sealed` — "this run is finished and immutable" — is set only once
 * the final immutable set actually exists. Between them lies asynchronous work that CAN throw
 * (`buildResultSet`, `sealResultSet`, `admitSealedSet`), and §13.5.1 item 1 says `done` "resolves
 * exactly once and never rejects for any run or persistence outcome" — so every one of those
 * failures still settles, through `terminalInternalError`.
 *
 * Status SELECTION happens here (`transition`, silently); status PUBLICATION happens only once the
 * set exists (ruling 2): the `finalizing` commit right after admission (§13.5.1 item 6: "from seal
 * until `done` resolves, `getSnapshot()` reports the terminal status with phase `finalizing`"), then
 * the one terminal commit when the window closes.
 */
function sealAs(run, status) {
  if (run.sealStarted) return run.donePromise;             // terminal is ABSORBING; first seal wins
  run.sealStarted = true;
  run.transition(status);                                  // staged: nothing is published yet
  run.setPhase('finalizing');
  return (async () => {
    let resultSet;
    try {
      resultSet = await buildAndAdmitResultSet(run, status);
    } catch (error) {
      return terminalInternalError(run, error);
    }
    return persistAndFinalize(run, resultSet);
  })();
}

/**
 * The shared tail of every path that ends with an ADMITTED set — the normal seal, and the R10
 * fallback when it produced or adopted one: publish `finalizing`, start the one persistence attempt,
 * and hold the finalize window. `cause` (R10 only) rides on the terminal event.
 */
async function persistAndFinalize(run, resultSet, { cause = null } = {}) {
  run.commit('state');                                     // sealed: `finalizing` is now observable

  // Persistence starts AFTER the seal and never alters the outcome (§13.5). A15/N24: driven
  // through the residency manager, which already holds the store; it is specified never to
  // reject, and the defensive handler below keeps `done`/`persisted` settling even if it did.
  const attempt = beginPersistAttempt(run);
  attempt.then(
    (snapshot) => {
      run.resolvePersisted(toPersistenceOutcome(snapshot));
      run.emit('persistence', { ...snapshot, seq: run.bumpSeq() });
    },
    (error) => {
      run.persistError = error;
      run.resolvePersisted(Object.freeze({ state: 'failed', error: describePersistError(error) }));
    },
  );
  await openFinalizeWindow(run, attempt, resultSet, { cause });
  return run.summary;
}

/** `residency.beginPersist`, with a synchronous throw turned into the same rejected attempt. */
function beginPersistAttempt(run) {
  try {
    return Promise.resolve(run.spec.resultPort.residency.beginPersist(run.runId, {
      persist: run.runOptions.persist,
    }));
  } catch (error) {
    return Promise.reject(error);
  }
}

const describePersistError = (error) => ({
  name: String(error?.name ?? 'Error'), message: String(error?.message ?? error),
});

/**
 * §13.5.1 item 2: `persisted` resolves a `PersistenceOutcome` — `{state:'saved'}`,
 * `{state:'failed', error}` or `{state:'skipped', reason}` — never the `PersistenceSnapshot` P5's
 * `beginPersist` returns (that one, with `timedOut`/`attempt`, is what `done` and the events carry).
 */
function toPersistenceOutcome(snapshot) {
  if (snapshot.state === 'failed') return Object.freeze({ state: 'failed', error: snapshot.error });
  if (snapshot.state === 'skipped') return Object.freeze({ state: 'skipped', reason: snapshot.reason });
  return Object.freeze({ state: snapshot.state });
}

/**
 * R10 — the terminal fallback. Reached only when sealing itself failed, which means the run has no
 * trustworthy Result Set. It settles `done` ONCE with `failed` / `internal-error`, releases the
 * reserved residency slot when nothing was admitted, and emits the terminal event first, exactly
 * like the normal path.
 *
 * It makes ONE attempt at a minimal, unit-free set so callers still get a readable artifact; if
 * that also throws, the summary carries `resultSet: null`. That is a deliberate, documented
 * deviation from `RunSummary.resultSet` always being a set (§13.5.1): the only alternative is
 * rejecting `done`, which the same sentence forbids outright. Recorded as open item O7.
 *
 * P6.8 self-review deviation from the brief (codex-advisor finding): a set that IS resident — the
 * fallback set just admitted, or the set adopted through I8 — goes through the SAME persistence
 * attempt and finalize window as a normal seal (`persistAndFinalize`, status `failed`). The brief
 * settled it `skipped`/`seal-failed` at once, which left residency reporting that set `pending`
 * attempt 0 forever (held, never persisted, never evictable), made `done`, `persisted` and
 * `getPersistenceState` disagree, and put a reason outside §13.5.1's closed
 * `'no-store' | 'persist-false'` union on `persisted`. Only the no-set case (O7) settles without an
 * attempt, since there is nothing to persist.
 */
async function terminalInternalError(run, error) {
  run.sealError = error;                                   // kept for diagnosis
  run.settlementState.unitCauses.push('internal-error');
  // I8, FIRST: the failure that brought us here may have been `admitSealedSet` itself, and an
  // admission can still throw AFTER converting the reservation (an observer hook, a report
  // callback). Building a second set and admitting it under the SAME runId would be a double
  // admission; releasing the slot would free a live resident set. So ask residency what it holds,
  // and if it already holds this run's set, adopt it and stop.
  const resident = run.spec.resultPort.residency.getResident(run.runId);
  if (resident !== null) {
    run.reservationSettled = true;
    run.sealed = true;
    return finishWithResidentSet(run, resident);
  }
  let resultSet = null;
  try {
    const diagnostics = emptyDiagnosticsSummary();
    const ledger = emptyLedgerRecord(run);
    const outcome = run.spec.resultPort.deriveRunOutcome({
      status: 'failed',
      freshness: 'unverifiable',
      reasons: collectReasons(run.settlementState),
      ledger,
      diagnostics,
      results: [],
    });
    // Whole-branch review C1 follow-up (codex-advisor): `provenanceOf` THROWS on a plan with no record
    // for a snapshot model, and that throw is one of the ways a seal reaches this fallback. Re-reading
    // the same broken plan here would throw again and lose the minimal set (O7). The fallback set is
    // unit-free and result-free, so it needs no plan-time model rows: it keeps the full provenance when
    // that can be built and otherwise drops only the `models` rows — never fabricates them.
    let provenance;
    // M1: the fallback set seals `ledger` (exclusions `[]`), so its provenance states the same, not the
    // live run ledger's exclusions.
    try { provenance = provenanceOf(run, { ledger }); } catch { provenance = provenanceOf(run, { planRows: false, ledger }); }
    const draft = run.spec.resultPort.buildResultSet(
      resultParts(run, outcome, diagnostics, { ledger, results: [], provenance }));
    resultSet = await run.spec.resultPort.sealResultSet(draft, { slicer: run.slicer() });
    run.spec.resultPort.residency.admitSealedSet(run.runId, resultSet);
    run.reservationSettled = true;
    run.sealed = true;
  } catch {
    resultSet = releaseIfStillReserved(run);               // I8: never leak, never double-free
  }
  return resultSet === null ? finishTerminalInternalError(run, null) : finishWithResidentSet(run, resultSet);
}

/** R10 with a resident set (built here, or adopted through I8): the normal persistence tail, as
 *  `failed`. The status is set directly — `transition` refuses once a terminal status was staged. */
function finishWithResidentSet(run, resultSet) {
  run.status = 'failed';
  run.pending.status = 'failed';
  return persistAndFinalize(run, resultSet, { cause: 'internal-error' });
}

/** The terminal commit of the fallback when NO set exists (O7): nothing to persist, so `done` and
 *  `persisted` settle at once, `persisted` with `{state:'skipped', reason:'seal-failed'}`. */
function finishTerminalInternalError(run, resultSet) {
  run.status = 'failed';
  const persistence = Object.freeze(
    { state: 'skipped', reason: 'seal-failed', timedOut: false, attempt: 0 });
  run.summary = Object.freeze({ runId: run.runId, status: 'failed', resultSet, persistence });
  // I9: the terminal snapshot is COMMITTED before the event that announces it, so a listener that
  // reads `getSnapshot()` synchronously sees `phase: 'terminal'`, not `'finalizing'`.
  commitTerminal(run, { status: 'failed', persistence });
  run.emit('state', {
    seq: run.seq(), status: 'failed', phase: 'terminal', terminal: true, cause: 'internal-error', persistence,
  });
  run.resolvePersisted(Object.freeze({ state: 'skipped', reason: 'seal-failed' }));
  run.resolveDone(run.summary);                            // AFTER the terminal event, always
  return run.summary;
}

/**
 * I8 — the ONLY assumption P6's recovery makes about a throwing `admitSealedSet` is the one
 * C-P5-1 requires of P5: the call is atomic, so residency either converted the reservation or did
 * not. P6 does not guess which; it ASKS, through the query P5 already exports.
 *
 * `getResident(runId)` returns the resident set for an admitted run and `null` otherwise (A14). A
 * non-null answer after a throw means the conversion completed and something *after* it threw;
 * releasing the slot then would free a live resident set, and re-admitting under the same id would
 * be a second admission. A `null` answer means the reservation is untouched and must be released
 * exactly once. `reservationSettled` is the idempotence guard that makes "exactly once" true even
 * if two paths reach here.
 */
function releaseIfStillReserved(run) {
  if (run.reservationSettled) return run.spec.resultPort.residency.getResident(run.runId);
  const resident = run.spec.resultPort.residency.getResident(run.runId);
  run.reservationSettled = true;
  if (resident !== null) return resident;                  // admitted after all: adopt it, keep it
  run.spec.resultPort.residency.releaseRunSlot(run.runId); // A14: never leak the reservation
  return null;
}

/**
 * The two minimal inputs the fallback needs, built without touching the records that just failed.
 *
 * H1 fix (P6 independent review + adjudication, 2026-09-24): `planExists` is unconditionally
 * `false` here, never `run.plan !== undefined`. This record NEVER carries real plan facts --
 * `rootOwners`/`pairSpaceTotal`/`units` are always empty stand-ins, regardless of whether a real
 * plan technically exists on `run` -- so it must not claim one does. A `planExists: true` row with
 * an empty `rootOwners` is durably rejected by `validateResultSet`'s `reconcileEvaluatedCoverageSteps`
 * (`coverage-model-mismatch`), which gates entirely on `ledger.planExists === true`; `false` here
 * skips that whole check, exactly matching what this record actually contains.
 */
const emptyLedgerRecord = (run) => Object.freeze({
  planExists: false, pairSpaceTotal: 0, emptyOperand: false, units: [],
  rootOwners: [], unresolvedSelections: [], unreachablePopulation: [], hierarchyInternal: [],
  planningGaps: [{ phase: run.phase, cause: 'internal-error' }], exclusions: [], warnings: [],
  budgetExhausted: false, firstRefusalUnitId: null,
});
const emptyDiagnosticsSummary = () => Object.freeze({
  diagnostics: [], truncated: false, total: 0, completenessAffectingCount: 0,
  unclassifiedOccurrences: 0, completenessAffectingUpperBound: 0, countsByReason: [],
  omittedReasonOccurrences: 0, geometryReadinessOccurrences: 0,
});

/**
 * §13.5.1 item 1: `done` resolves at the FIRST of (a) the first attempt settling, (b)
 * `persistTimeoutMs` since seal, (c) a forced close by `engine.dispose()` (C3, through
 * `requestDispose`) — and in every case only AFTER the terminal `state` event has been emitted.
 *
 * `timedOut` is a statement about OUR wait, not about the write (§13.5.1): it is `true` only when
 * the window closed by (b) or (c) while residency still reports the write `pending`. A forced close
 * whose write has already settled carries that final state with `timedOut: false` (§10.2: "or the
 * final state if the write has already settled").
 */
function openFinalizeWindow(run, attempt, resultSet, { cause = null } = {}) {
  return new Promise((resolve) => {
    let closed = false;
    let cancelTimer = () => {};
    const close = (why) => {
      if (closed) return;
      closed = true;
      cancelTimer();
      // A15/N24: the state is read BY ID from the residency manager — there is no `snapshot()`
      // closure on a returned attempt object.
      const state = run.spec.resultPort.residency.getPersistenceState(run.runId)
        ?? { state: 'skipped', timedOut: false, attempt: 0 };
      const timedOut = why !== 'settled' && state.state === 'pending';
      const persistence = Object.freeze({ ...state, timedOut });
      run.summary = Object.freeze({ runId: run.runId, status: run.status, resultSet, persistence });
      // I9 — COMMIT, then announce (see `commitTerminal`): a listener that calls `getSnapshot()`
      // synchronously from the terminal event observes `phase: 'terminal'` and `seq === ev.seq`.
      commitTerminal(run, { status: run.status, persistence });
      run.emit('state', {
        seq: run.seq(), status: run.status, phase: 'terminal', terminal: true,
        ...(cause === null ? {} : { cause }), persistence,
      });
      run.resolveDone(run.summary);                        // AFTER the terminal event, always
      resolve();
    };
    cancelTimer = run.spec.scheduleTimeout(() => close('timeout'), run.limits.persistTimeoutMs);  // (b), O3
    attempt.then(() => close('settled'), () => close('settled'));                          // (a)
    run.forceFinalize = () => close('forced');                                             // (c)
    // C3 — a dispose that arrived BEFORE this window existed must still close it at once:
    //  - while the set was being BUILT or SEALED, `requestCancel` found no `forceFinalize` and left
    //    `disposeRequestedDuringSeal`;
    //  - before the seal began (queued / planning / executing), the dispose is a committed fact
    //    (`settlementState.disposeRequested`) — the boundary already sealed the run `cancelled` (or
    //    per §16.7) because of it, and the engine waiting on this run is `dispose()` itself, which
    //    must not then wait `persistTimeoutMs` (or forever, on a hung store) for the write.
    if (run.disposeRequestedDuringSeal || run.settlementState.disposeRequested) close('forced');
  });
}

// ================================================================================================
// Cancellation and disposal (P6.8) and the run driver
// ================================================================================================

/**
 * `cancel()` and `dispose()` both mark committed state and let a boundary decide — never a direct
 * terminal transition. First reason wins; a second call changes nothing and returns the same `done`
 * promise (§13.5.1 item 5: same value/timing as `done`).
 *
 * Order, deliberately: the flag is set BEFORE the withdrawal is tried, so a queued-withdrawal seal
 * also records `cancel-requested` (and `engine-disposed`) in its reasons. Exactly one path seals:
 * `cancelWhileQueued` seals only if IT won `withdraw()`; otherwise the run is already started and
 * its own boundary — the `resolveStage` race (woken by the cancellation signal), a `planStage`
 * check, the enumeration checkpoint or the loop boundary — observes `cancelRequested`. Both go
 * through `sealAs`'s single-winner guard regardless.
 *
 * No explicit loop wake-up is needed (verified, P6.8): `executeStage` re-reads
 * `collectBoundaryFacts` → `resolveRunStatus` at the top of EVERY iteration, right after
 * `interUnitYield()`, and that yield always resolves on its own (a macrotask or animation frame,
 * §7.3); an in-flight unit is drained, never interrupted (§10.1). So the next boundary is reached
 * within one yield of the request, and a dedicated `wakeBoundary()` signal would change nothing.
 */
function requestCancel(run, reason, { dispose = false } = {}) {
  if (run.sealStarted) {
    // C3 — "sealing" and "terminal" are not the same state, and a dispose must not be dropped in
    // between. If the finalize window is open, force it closed now; if the seal is still building
    // (before `forceFinalize` exists), leave the flag the window checks the moment it opens.
    // The settlement state is deliberately NOT touched: §16.7 resolves from facts committed
    // BEFORE the seal began, and mutating it mid-seal would race `collectReasons` inside the seal
    // and make the sealed reasons depend on timing. A dispose arriving now changes nothing about
    // the run's status — it only stops the engine waiting on the write.
    if (dispose) {
      if (run.forceFinalize !== undefined) run.forceFinalize();
      else run.disposeRequestedDuringSeal = true;
    }
    return run.donePromise;                                // terminal (or sealing): absorbed
  }
  if (run.cancelRequested === null) {
    run.cancelRequested = Object.freeze({ reason: dispose ? 'engine-disposed' : (reason ?? null) });
  }
  if (dispose) run.settlementState.disposeRequested = true;
  run.settlementState.cancelRequested = run.cancelRequested;   // ONE source of truth for §16.7
  if (run.status === 'running') {
    // An observable state change (§9.2): `cancelling` is committed and announced at once. Only a
    // RUNNING run has one — a planning run's first event must still be the adoption commit.
    run.transition('cancelling');
    run.commit('state');
  }
  // R5 / review C2 — a still-QUEUED run has no boundary of its own: withdrawing it means its run
  // function is never invoked, so whoever wins the withdrawal owes it the seal.
  if (run.status === 'queued') cancelWhileQueued(run);
  run.resolveCancellationSignal();                         // frees a stalled resolveDefinition race
  return run.donePromise;
}

/**
 * C3 — the engine-only control surface `createRun` returns beside the handle. This is the ONE
 * published way `engine.dispose()` reaches a live run, and it is deliberately not on `RunHandle`:
 * `getRun(runId)` hands that handle to application code, which must never be able to dispose the
 * engine's runs.
 *
 * It is `requestCancel(..., {dispose:true})` — the same committed-fact path as a user cancel, so a
 * dispose is resolved by §16.7 order B exactly like any other fact (`disposeRequested` ⇒
 * `cancelled`, unless a failing or invalidating fact outranks it) — plus the force-close of a run
 * that is already past its seal. Idempotent: a second call returns the same `done` promise.
 * An in-flight unit is DRAINED first (§10.1, F6), so this is bounded by every wait the engine owns
 * and unbounded only by an executor that never returns (open item O9, accepted).
 */
function requestDispose(run) {
  return requestCancel(run, 'engine-disposed', { dispose: true });
}

/**
 * The coordinator job: resolve -> plan -> execute. It NEVER rejects: an unexpected stage error is
 * settled through `settleStageFailure`, so the coordinator's `finished` promise cannot reject
 * unobserved while `done` stays pending.
 */
async function driveRun(run) {
  try {
    const resolved = await resolveStage(run);
    if (run.sealStarted) return await run.donePromise;
    if (resolved === CANCELLED) return await settlePlanning(run, 'cancelled');   // pre-resolution
    await planStage(run);
    if (run.sealStarted) return await run.donePromise;
    return await executeStage(run);
  } catch (error) {
    run.stageError = error;
    if (run.sealStarted) return run.donePromise;
    return settleStageFailure(run);
  }
}

/**
 * An unexpected throw from a STAGE (not from the seal — that is P6.8's R10 `terminalInternalError`). The sealed set must still be one `validateResultSet` accepts (R21-2), so the failure is
 * settled in the ledger shape of the stage it interrupted (task review, P6.4):
 *
 *  - BEFORE a plan exists (resolution, snapshot, planRun, accumulator construction): a planning
 *    failure, through `settlePlanning` with cause `internal-error` — ONE `{phase, cause}` planning
 *    gap and no unit records, the same convention as P6.8's `terminalInternalError`
 *    (`planningGaps: [{phase, cause: 'internal-error'}]`). A still-unresolved run therefore seals the
 *    §13.1 pre-resolution shape, which requires exactly one planning gap.
 *  - DURING execution: a unit-level `internal-error` fact (order B: `failed`), and every unit record
 *    whose outcome is still unsettled (`null`: the unit being settled when the throw hit, if its
 *    `recordOutcome` had not run yet, and every unit still queued) is closed as
 *    `not-run:run-failed` — the same consequence `markRemainingNotRun` records when a boundary stops
 *    the loop — so no `outcome: null` record reaches the sealed ledger.
 */
function settleStageFailure(run) {
  if (run.plan === undefined) return settlePlanning(run, 'internal-error');
  run.settlementState.unitCauses.push('internal-error');
  for (const record of run.ledger.toLedgerRecord().units) {
    if (record.kind !== 'leaf' || record.outcome !== null) continue;
    run.ledger.recordOutcome(record.unitId, { outcome: 'not-run', cause: 'run-failed' });
    run.pending.unitsFailedOrSkipped += 1;
    run.pending.pairSpaceProcessed += record.pairSpaceWeight;
  }
  run.pending.currentUnitId = null;
  return sealAs(run, 'failed');
}

function beginRun(run) {
  if (run.begun) throw new Error('begin() may be called once');
  run.begun = true;
  run.spec.coordinator.enqueue({
    runId: run.runId,
    engineId: run.spec.engineId,
    run: () => driveRun(run),
    // An INTERNAL, engine-side capability, NOT part of the §18 surface: the coordinator ignores it
    // (it destructures only runId/engineId/run). It exists so a coordinator-level observer — the
    // test fixture's `cancelAt: 'job-started'` — can issue the same cancel `handle.cancel` issues
    // at the exact moment the job starts, without widening the frozen six-member `RunHandle` or
    // the pinned `RunSpec` (codex-advisor, P6.4).
    control: Object.freeze({ requestCancel: (reason) => requestCancel(run, reason) }),
  });
}

/** Binds the brief's `run.x(...)` call sites to the module functions above. */
function installRunMethods(run) {
  Object.assign(run, {
    transition: (status) => transition(run, status),
    setPhase: (phase) => setPhase(run, phase),
    commit: (type) => commitAndEmit(run, type),
    cancellationSignal: () => run.cancellationPromise,
    failPlanning: (cause) => settlePlanning(run, cause),
    cancelPlanning: () => settlePlanning(run, 'cancelled'),
    sealAs: (status) => sealAs(run, status),
    // P6.6: the seal-time freshness from committed state. `run.ledger` exists on every seal path
    // (`settlePlanning` creates one before sealing a run that never planned).
    sealFreshnessState: () => sealTimeFreshness(run).state,
    // ONE slicer per run (A2), shared by the enumeration checkpoint and the seal's sliced freeze, so
    // the run's slice budget is a single account rather than restarting per consumer.
    slicer: () => {
      run.slicerInstance ??= createSlicer({
        now: run.spec.now, yieldToScheduler: run.spec.yieldToScheduler, limits: run.limits,
      });
      return run.slicerInstance;
    },
    // P6.8: `emit` is the emitter's own isolated delivery; `seq()` reads the COMMITTED snapshot's
    // seq without advancing it (the terminal event carries exactly the seq `getSnapshot()` reads
    // back, I9); `bumpSeq()` advances it through a real commit, so an event that is not a state
    // change of its own — the late `'persistence'` event — still carries a seq no earlier event or
    // snapshot had, and `getSnapshot().seq` never lags an emitted event (§9.2 rule 1, monotone).
    emit: (type, payload) => run.emitter.emit(type, payload),
    seq: () => run.progress.committed.seq,
    bumpSeq: () => commit(run).seq,
    provenance: (options) => provenanceOf(run, options),
    enumerationCheckpoint: () => enumerationCheckpoint(run),
    interUnitYield: () => run.spec.yieldToScheduler(),
    collectBoundaryFacts: (extra) => collectBoundaryFacts(run, extra),
    markRemainingNotRun: (queue, cause) => markRemainingNotRun(run, queue, cause),
    applyUnitResult: (unit, result) => applyUnitResult(run, unit, result),
    unitResult: (unit, settlement, outcome, attempt, extra) => ({ settlement, outcome, attempt, extra }),
    factsFromOutcome: (request, outcome) => factsFromOutcome(run, request, outcome),
    snapshotFor: (unit) => snapshotFor(run, unit),
    snapshotGenerationsFor: (unit) => snapshotGenerationsFor(run, unit),
    // P6.6: `placementChangedSince` (the P6.4 stand-in) is gone — the live placement observation is
    // `scanUnitParticipants`, called from `factsFromOutcome`, which also reports participant death.
    //
    // DOCUMENTED STAND-IN, deliberately kept `false`: the CollisionWorld surface exposes NO
    // disposal query (no `isDisposed`, no property, no registry method or event — disposal surfaces
    // only as a `WorldDisposedError` thrown by a world call, spec M2 §"Throws WorldDisposedError").
    // P4's executor already classifies that throw as `failure.code: 'world-disposed'`, which
    // `factsFromOutcome` reads through `UNIT_FACTS`, so a disposed world DOES reach table A (U1) on
    // the attempt that observed it. A run-level flag would need new world machinery the spec does
    // not define; P6.8's dispose path (`disposeRequested`) is the engine-side signal.
    worldDisposed: false,
  });
}

export function createRun(spec) {
  const run = {
    spec, runId: spec.runId,
    derivedFromRunId: normalizeDerivedFromRunId(spec.derivedFromRunId),
    // A1: the RESOLVED run options (sizing caps, budget/ledger limits, retries, ...) and the resolved
    // ENGINE limits (slicer budget, persistTimeoutMs) are two different objects; P6 reads each from
    // its own field.
    runOptions: spec.runOptions,
    limits: spec.limits,
    status: 'queued',
    phase: 'queued',
    cancelRequested: null,                                 // null until the first cancel: {reason}
    results: EMPTY_RESULTS,                                // C2: replaced at plan completion
    unitOrder: createUnitOrder(),                          // I6: the rank oracle, empty until planning
    settlementState: {
      unitCauses: [], planningCause: null, planningGapCauses: [],
      placementChangedVsSnapshot: false, cancelRequested: null,
      disposeRequested: false, allLeafUnitsTerminal: false,
    },
    // P6.6: per-model freshness detail, read ONLY by `sealTimeFreshness` (never digested).
    deadModelKeys: new Set(),                              // snapshot models observed `null`
    staleReasons: new Set(),                               // 'placement-changed:<k>' | 'model-reloaded:<k>'
    // `spec.createEmitter` is a P6-local TEST seam beside `scheduleTimeout` (O3), not a §18 field: a
    // fixture wraps the real emitter to observe delivery order (P6.8's dispose test). Absent, the
    // real one is used.
    emitter: (spec.createEmitter ?? createDefaultEmitter)({
      now: spec.now, progressMinIntervalMs: spec.runOptions.progressMinIntervalMs,
    }),
    // `run.pending` is FLAT on the run object (not nested under `run.progress`) — this is the
    // shape every later task's own pseudocode reads/writes directly (P6.4, P6.5's seven call
    // sites, P6.8's terminal-commit snippet). `run.progress` holds ONLY the committed snapshot.
    pending: createInitialPending(spec.runId),
    progress: { committed: null },
    begun: false,
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
  run.pending.startedAtMs = spec.now();
  commit(run);                                             // seed `committed` so getSnapshot never reads null

  run.donePromise = new Promise((resolve) => { run.resolveDone = resolve; });
  run.persistedPromise = new Promise((resolve) => { run.resolvePersisted = resolve; });
  run.cancellationPromise = new Promise((resolve) => { run.resolveCancellationSignal = resolve; });
  installRunMethods(run);

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
