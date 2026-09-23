// clashtest/run/Run.js
//
// P6.3: states, handle, snapshot. P6.4: resolution, planning, run-start leases, the pre-resolution
// and queued-withdrawal seals, minimal real cancellation, the permanent seal core
// (`buildAndAdmitResultSet`) with a TEMPORARY finisher (`finishP64Seal`, replaced by P6.8), and the
// unit loop pulled forward VERBATIM from the P6.5 brief (P6.5 adds its own coverage against it).
// Still to come: P6.6 (live boundary scan, seal-time freshness), P6.8 (R10 recovery, finalize
// window, dispose).
import { createEmitter } from './emitter.js';
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
 * Task P6.8 adds the commit points its own observable states need (`cancelling` right after a
 * cancel, `finalizing` during the persistence window) — as explicit commits, not by making these
 * setters publish.
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
 * The ONE terminal publication (ruling 2, I9): the terminal status and `phase: 'terminal'` are
 * committed into the snapshot FIRST, and only then is the single terminal `state` event emitted —
 * so a listener that reads `getSnapshot()` from inside that event already sees the terminal
 * snapshot, and `ev.seq === getSnapshot().seq`. Called only once `run.summary` exists (it carries
 * the final `persistence`, which rides on the event; §9.1's `RunProgress` has no persistence field).
 * The payload shape `{seq, status, terminal: true, persistence}` (+ `phase`) is the one the P6.8
 * tests read (`ev.type === 'state' && ev.terminal`, `ev.status`, `ev.persistence`, `ev.seq`).
 */
function commitTerminal(run, { status, persistence }) {
  /* c8 ignore next */ if (run.summary === undefined) throw new Error('commitTerminal: summary must exist first');
  run.status = status;                                     // the settle path's own final word
  run.pending.status = status;
  setPhase(run, 'terminal');
  run.pending.currentUnitId = null;
  const committed = commit(run);
  run.emitter.emit('state', {
    seq: committed.seq, status, phase: 'terminal', terminal: true, persistence,
  });
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
  const lookup = run.spec.resolveDefinition();            // Promise<{definition, testRef}>
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
 *  `unreachablePopulation` rows are that plan data in their persisted shape. */
function ownerSetsFromLedger(ledger, field) {
  const out = new Map();
  for (const row of ledger.toLedgerRecord().unreachablePopulation) {
    if (row[field].length > 0) out.set(row.modelKey, new Set(row[field]));
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
    epochInstanceCount: run.spec.world.getEpochCollisionInstanceCount(run.snapshot.bindings[i].lease),
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
  if (run.cancelRequested !== null) return run.cancelPlanning();

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
    unreachableOwners: ownerSetsFromLedger(run.ledger, 'ownerDbIds'),
    mixedOwners: ownerSetsFromLedger(run.ledger, 'mixedOwnerDbIds'),
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

/** `failPlanning(cause)` and `cancelPlanning()` both funnel here so §16.7 order B is applied once. */
function settlePlanning(run, cause) {
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

/** The `buildResultSet` parts, in the PRE-resolution shape when the run never resolved (§13.1). */
function resultParts(run, outcome, diagnostics) {
  const resolved = run.resolution !== undefined;
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
    provenance: run.provenance(),                         // provenanceBase + models + admissionBaseline
    ledger: run.ledger.toLedgerRecord(),                  // A17: arrays-only, P5's pinned shape
    // C2: ALWAYS defined — `EMPTY_RESULTS` before planning, P5's accumulator after it. This is the
    // one call every pre-resolution path makes, and the reason the holder exists at all.
    results: run.results.toArray(),                       // A12: the accumulator
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
      return run.unitResult(unit, classifyUnitSettlement(['internal-error'], 'call'),
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
    if (isRetryablePlacement(run, unit, outcome, facts) && attempt < maxAttempts) continue;
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
 * C1 — the whole retry-eligibility rule, in one pure-ish predicate so the protocol lives in exactly
 * one place and the tests can state it directly.
 *
 * `outcome.generations` is P4's `{start: [{modelKey, placementGeneration, bindingGeneration}],
 * end: [...]}` — the two reads that bracket the call (P4 Task P4.8). Comparing them catches a
 * placement change that landed DURING the attempt but that P4's own ctx flag did not see; comparing
 * `start` against the run-start snapshot catches one that landed between the snapshot and the
 * attempt. A run whose generation moved is `input-changed` at the unit and `invalidated` at the run
 * (§16.7 order B) — the opposite of a retry.
 */
function isRetryablePlacement(run, unit, outcome, facts) {
  if (outcome.outcome !== 'failed') return false;
  if (outcome.failure === null || outcome.failure.code !== 'stale-placement') return false;
  if (outcome.failure.retryable !== true) return false;
  if (facts.length !== 1 || facts[0] !== 'stale-placement') return false;   // (3): nothing else
  return placementGenerationsSteady(run, unit, outcome.generations);
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
    // (2) committed: from here the unit IS merged, and every remaining step is total.
    // A11/N20 + D3: ONE stateful aggregator per run, awaited per settled unit; it returns the
    // extra unit-wide taints this unit earned. There is no `aggregateDiagnostics(...)` pair.
    ({ unitTaints } = await run.spec.diagnosticAggregator.addUnit(unit.unitId, outcome));
    run.spec.statisticsAccumulator.add(outcome.statistics, outcome.durationMs);
    run.pending.unitsEvaluated += 1;
    run.pending.pairSpaceEvaluated += weight;
    run.pending.resultsFound = run.results.size();
  } else {
    run.pending.unitsFailedOrSkipped += 1;
  }

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
  // N9: `deriveUnitTaints` gets the NON-charging capacity peek; `ledger.addTaint` does the one
  // real, charging admission and owns the taint-overflow collapse (A11, A17).
  const derived = settlement.merges
    ? run.spec.deriveUnitTaints(outcome.diagnostics, {
        maxElementTaintsPerUnit: run.runOptions.maxElementTaintsPerUnit,
        admit: (n) => run.budget.discretionaryRemaining >= n,
      }).taints
    : [];
  for (const taint of [...derived, ...unitTaints]) run.ledger.addTaint(unit.unitId, taint);

  run.pending.pairSpaceProcessed += weight;               // evaluated + gaps: always advances
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
 */
function factsFromOutcome(run, request, outcome) {
  const facts = [];
  const phase = outcome.outcome === 'skipped' ? 'pre' : (outcome.failure !== null ? 'call' : 'post');
  const scopeFact = SCOPE_PROOF_FACT[outcome.scopeProof];
  if (scopeFact !== null) facts.push(scopeFact);
  if (outcome.failure !== null && UNIT_FACTS.has(outcome.failure.code)) facts.push(outcome.failure.code);
  if (run.placementChangedSince(request.unit)) facts.push('input-changed');
  if (run.worldDisposed) facts.push('world-disposed');
  return { facts, phase };
}

// ================================================================================================
// Loop helpers the pulled-forward loop calls that no brief defines (P6.4 stand-ins / real versions)
// ================================================================================================

/**
 * STAND-IN (controller ruling 4). Task P6.6 replaces the BODY with the live registry comparison
 * (`snapshotBindings(run.snapshotKeys)` vs `run.snapshot`, placement/binding generations, dead
 * models), keeping this exact signature. Until then a boundary reads only the committed facts.
 */
function collectBoundaryFacts(run, extra = {}) {
  return { ...run.settlementState, ...extra };
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
 * §13.2 provenance: `provenanceBase` + the resolved run options + one row per SNAPSHOT binding (a
 * plain copy — a binding itself is never embedded, because the seal deep-freezes the draft) + the
 * admission baseline. Before the snapshot (pre-resolution, or a planning failure before it) both
 * lists are empty. The plan-derived `scopeKinds`/`elementCount`/`scopeDigests` columns of P5's
 * `ProvenanceModel` are NOT projected yet — P6.6/P6.7 own that projection (the read-time freshness
 * bracket runs over it).
 */
function provenanceOf(run) {
  const models = [];
  if (run.snapshot !== undefined) {
    run.snapshotKeys.forEach((modelKey, i) => {
      const b = run.snapshot.bindings[i];
      if (b === null) return;
      models.push({
        modelKey, modelVersion: b.modelVersion,
        bindingGeneration: b.bindingGeneration, placementGeneration: b.placementGeneration,
      });
    });
  }
  return {
    ...run.spec.provenanceBase,
    runOptions: run.runOptions,
    models,
    admissionBaseline: run.admissionBaseline ?? [],
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
// Sealing (P6.4 permanent core + TEMPORARY finisher, controller ruling 1)
// ================================================================================================

/**
 * PERMANENT (P6.8 keeps it): derive the outcome, assemble the draft, seal it, and convert the slot
 * P7 reserved at admission into an ordinary resident set (§13.1). Returns the sealed set; throws on
 * any failure (the caller settles). `run.sealed` is set ONLY once the final set exists (R10).
 */
async function buildAndAdmitResultSet(run, status) {
  const freshness = run.sealFreshnessState();
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
  // A14/N23 (+ I8: atomic and exception-safe, cross-file need C-P5-1).
  run.spec.resultPort.residency.admitSealedSet(run.runId, resultSet);
  run.reservationSettled = true;                           // the reservation is now a resident set
  run.sealed = true;                                       // ONLY now: the final set exists
  return resultSet;
}

/**
 * TEMPORARY — Task P6.8 REPLACES this function entirely with the real run-option-driven persist
 * attempt (`{persist: run.runOptions.persist}`) and the finalize window (`persistTimeoutMs`,
 * `forceFinalize`). Here: one real, state-consistent `beginPersist(runId, {persist: false})` (it
 * settles residency's persistence state as `skipped`, rather than leaving it `pending` forever),
 * which settles `persisted`; then the ONE terminal commit + event; then `done`.
 */
async function finishP64Seal(run, status, resultSet) {
  let persistence;
  try {
    persistence = Object.freeze({
      ...(await run.spec.resultPort.residency.beginPersist(run.runId, { persist: false })),
    });
  } catch (error) {                                        // beginPersist is specified never to reject
    run.persistError = error;
    persistence = Object.freeze({ state: 'skipped', reason: 'persist-unavailable', timedOut: false, attempt: 0 });
  }
  run.resolvePersisted(persistence);
  run.summary = Object.freeze({ runId: run.runId, status, resultSet, persistence });
  commitTerminal(run, { status, persistence });            // committed BEFORE the event (I9)
  run.resolveDone(run.summary);                            // AFTER the terminal event, always
  return run.summary;
}

/**
 * P6.4's settle for a seal that THREW. NOT the R10 recovery — `terminalInternalError`, the
 * `getResident` double-admission check, the minimal fallback set and the slot release are Task
 * P6.8's. This only guarantees `done`/`persisted` settle exactly once (§13.5.1 item 1) with a
 * loud, unmistakable `resultSet: null` and the error kept on `run.sealError` for diagnosis.
 */
function settleSealFailure(run, error) {
  run.sealError = error;
  const persistence = Object.freeze({ state: 'skipped', reason: 'seal-failed', timedOut: false, attempt: 0 });
  run.summary = Object.freeze({ runId: run.runId, status: 'failed', resultSet: null, persistence });
  commitTerminal(run, { status: 'failed', persistence });
  run.resolvePersisted(persistence);
  run.resolveDone(run.summary);
  return run.summary;
}

/**
 * §8.1: "Terminal states are absorbing; a Result Set is sealed EXACTLY ONCE." `sealStarted` is the
 * re-entrancy guard (a second caller — the queued-withdrawal winner, a boundary, a late cancel — gets
 * the same `done` promise). Status SELECTION happens here (`transition`, silently); status
 * PUBLICATION happens only in `commitTerminal`, after the seal succeeded (ruling 2).
 */
function sealAs(run, status) {
  if (run.sealStarted) return run.donePromise;
  run.sealStarted = true;
  run.transition(status);
  run.setPhase('finalizing');
  return (async () => {
    let resultSet;
    try {
      resultSet = await buildAndAdmitResultSet(run, status);
    } catch (error) {
      return settleSealFailure(run, error);
    }
    return finishP64Seal(run, status, resultSet);
  })();
}

// ================================================================================================
// Cancellation (P6.4 minimal real version, controller ruling 3) and the run driver
// ================================================================================================

/**
 * `cancel(reason)` marks committed state and lets a boundary decide — it never transitions the run
 * itself. First reason wins; a second call changes nothing and returns the same `done` promise. A
 * cancel arriving once the seal has started is ABSORBED (it must not mutate the settlement state the
 * seal is reading, §16.7).
 *
 * Order (P6.8's final `requestCancel` order, deliberately): the flag is set BEFORE the withdrawal is
 * tried, so a queued-withdrawal seal also records `cancel-requested` in its reasons. Exactly one path
 * seals: `cancelWhileQueued` seals only if IT won `withdraw()` (the job's function is then never
 * invoked); otherwise the run is already started and its own boundary — the `resolveStage` race, a
 * `planStage` check, the enumeration checkpoint or the loop boundary — observes `cancelRequested`.
 * Both paths go through `sealAs`'s single-winner guard regardless.
 */
function requestCancel(run, reason) {
  if (run.sealStarted) return run.donePromise;
  if (run.cancelRequested === null) {
    run.cancelRequested = Object.freeze({ reason: reason ?? null });
    run.settlementState.cancelRequested = run.cancelRequested;   // ONE source of truth for §16.7
    run.resolveCancellationSignal();
  }
  if (run.status === 'queued') cancelWhileQueued(run);
  return run.donePromise;
}

// eslint-disable-next-line no-unused-vars
function requestDispose(run) {
  // P6.8 fills this in: requestCancel(run, 'engine-disposed', { dispose: true }) plus the
  // force-finalize behaviour documented in the plan's RunController row. Fail-fast until then.
  throw new Error('requestDispose is not implemented until Task P6.8');
}

/**
 * The coordinator job: resolve -> plan -> execute. It NEVER rejects — an unexpected stage error
 * becomes a `failed` seal with an `internal-error` fact (P6.8's R10 path refines this), so the
 * coordinator's `finished` promise cannot reject unobserved while `done` stays pending.
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
    if (!run.sealStarted) {
      run.settlementState.unitCauses.push('internal-error');
      run.ledger ??= run.spec.plannerPort.createLedger({
        limits: run.runOptions,
        budget: run.spec.plannerPort.createRecordBudget(run.runOptions),
      });
      return sealAs(run, 'failed');
    }
    return run.donePromise;
  }
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
    // Task P6.6 replaces this seam with `() => sealTimeFreshness(run).state`. `'current'` is safe
    // until then: P5 passes freshness through unchanged, and no P6.4 path is freshness-sensitive.
    sealFreshnessState: () => 'current',
    slicer: () => createSlicer({
      now: run.spec.now, yieldToScheduler: run.spec.yieldToScheduler, limits: run.limits,
    }),
    provenance: () => provenanceOf(run),
    enumerationCheckpoint: () => enumerationCheckpoint(run),
    interUnitYield: () => run.spec.yieldToScheduler(),
    collectBoundaryFacts: (extra) => collectBoundaryFacts(run, extra),
    markRemainingNotRun: (queue, cause) => markRemainingNotRun(run, queue, cause),
    applyUnitResult: (unit, result) => applyUnitResult(run, unit, result),
    unitResult: (unit, settlement, outcome, attempt, extra) => ({ settlement, outcome, attempt, extra }),
    factsFromOutcome: (request, outcome) => factsFromOutcome(run, request, outcome),
    snapshotFor: (unit) => snapshotFor(run, unit),
    snapshotGenerationsFor: (unit) => snapshotGenerationsFor(run, unit),
    // STAND-INS until Task P6.6 wires the live placement observation (`placementChangedSince`) and
    // the world-disposal fact (`worldDisposed`). Neither is exercised by a P6.4 path.
    placementChangedSince: () => false,
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
    emitter: createEmitter({ now: spec.now, progressMinIntervalMs: spec.runOptions.progressMinIntervalMs }),
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
