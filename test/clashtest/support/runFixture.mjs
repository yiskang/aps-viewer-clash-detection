// test/clashtest/support/runFixture.mjs
//
// `createRunFixture(opts) -> {spec, clock, plan, ...}` — a COMPLETE `RunSpec` over P6's fakes and
// the real pure collaborators, so `createRun(fx.spec)` can be begun, cancelled and sealed.
//
// Task P6.3 created this with a constructor-only spec (collaborators `null`). Task P6.4 wires every
// collaborator, per this directory's extension rules (support/index.mjs): the signature and every
// P6.3 option keep their meaning, and every new behaviour is an option or a new returned field.
//
// What is REAL here: the world coordinator (P6.2, `getWorldCoordinator`), P3's record budget and
// ledger, P4's `validateUnitOutcome` / `internalErrorOutcome` / diagnostic aggregator / statistics
// accumulator / `deriveUnitTaints`, P5's `createResultAccumulator` / `deriveRunOutcome` /
// `buildResultSet` / `sealResultSet` and P5's residency manager (wrapped to RECORD `admitted`,
// `released` and `beginPersistCalls`). What is FAKE: the world, the registry (support/
// placementRegistry.mjs), the planner half of P3 (support/fakePlanner.mjs) and the executor
// (support/scriptedExecutor.mjs).
//
// The fixture models P7's synchronous admission prefix: it RESERVES the run's residency slot
// (`reserveRunSlot(runId)`) before handing back the spec, so the run's seal converts a real
// reservation (`admitSealedSet`) exactly as in the engine.
//
// Options (all optional):
//   plan                 a createFakePlan(...) result, or `null` (no plan: a planning gap). Default: empty plan.
//   planningGaps         PlanningGap[] the fake planRun reports (P3's wrapper, Q2).
//   planningGap          ONE §6.6.2 cause. Modelled as a REJECTED definition lookup whose error
//                        `planningCauseOf` maps to that cause — the one path on which a planning
//                        gap is observed before a same-slice cancel (codex-advisor, P6.4: the
//                        resolved-lookup path rightly returns CANCELLED once the cancel is seen).
//   resolveDefinition    overrides the lookup (racing tests).
//   models               the definition's model keys (default: every key the plan's units touch,
//                        or ['mk-a'] when there are none).
//   unbindKeys           model keys NOT registered (the run-start snapshot reads them as `null`).
//   stallAt              'enumerating' — planRun loops on its checkpoint until cancelled.
//   cancelAt             'job-started' — cancels through the job's internal control capability at
//                        the instant the coordinator starts the job (after `withdraw()` can succeed).
//   executor             a UnitExecutor (default: a scripted executor that evaluates every unit clean).
//   derivedFromRunId, runId, engineId, runOptions (RunOptions input), limits (engine limits input,
//   plus any run-option key, routed to runOptions), realSealing, shared, clockOptions, specOverrides.
//
// `realSealing: true` hands the run P5's bare `buildResultSet`/`sealResultSet`/`deriveRunOutcome`
// with NO wrapper at all. The default ALSO uses the real functions, wrapped only to record calls, so
// no P6 test ever seals through a hand-built stand-in of P5's assembly.
//
// `createRunFixture.sharedWorld()` returns `{world, registry, coordinator}` for several fixtures to
// share (one world => one coordinator => one FIFO queue and one in-flight slot, §7.3).

import { createFakeClock } from './fakeClock.mjs';
import { createFakePlan, createFakePlannerPort, modelKeysOfPlan } from './fakePlanner.mjs';
import { createPlacementRegistry } from './placementRegistry.mjs';
import { createScriptedExecutor } from './scriptedExecutor.mjs';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import {
  resolveRunOptions, resolveEngineLimits, ENGINE_LIMIT_KEYS, RUN_OPTION_KEYS,
} from '../../../clashtest/options.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import {
  validateUnitOutcome, internalErrorOutcome,
} from '../../../clashtest/execution/UnitExecutor.js';
import {
  createDiagnosticAggregator, createStatisticsAccumulator, deriveUnitTaints,
} from '../../../clashtest/execution/diagnostics.js';
import {
  createResultAccumulator, deriveRunOutcome, buildResultSet, sealResultSet,
} from '../../../clashtest/results/resultSet.js';
import { createResidencyManager } from '../../../clashtest/results/residency.js';

/** A fake CollisionWorld for the run: counts `admitModel` (P6 must never call it, R7). */
function createRunWorld() {
  const calls = { admitModel: 0 };
  return {
    calls,
    destructiveCalls: [],                                  // evictModel / dispose / invalidate: never called
    admitModel() { calls.admitModel += 1; return Object.freeze({ leaseId: 'world-lease' }); },
    isLeaseValid() { return true; },
    getEpochCollisionInstanceCount() { return 1; },
  };
}

function createSharedWorld() {
  const world = createRunWorld();
  const registry = createPlacementRegistry({ labelSnapshot: () => null });
  const coordinator = getWorldCoordinator(world, { createRegistry: () => registry });
  let nextRun = 0;
  return { world, registry, coordinator, nextRunId: () => { nextRun += 1; return `run-${nextRun}`; } };
}

// §6.6.2 planning causes, by the error name `planningCauseOf` maps (the brief's documented table).
const CAUSE_BY_ERROR_NAME = Object.freeze({
  WorldDisposedError: 'world-disposed',
  ObjectTreeUnavailableError: 'enumeration-failed',
  ModelEvictedError: 'model-not-bound',
});
const planningCauseOf = (error) => error?.planningCause ?? CAUSE_BY_ERROR_NAME[error?.name] ?? 'enumeration-failed';

function planningGapError(cause) {
  const err = new Error(`fixture planning gap: ${cause}`);
  err.planningCause = cause;
  return err;
}

/** One promise per named point; `mark` resolves it, `reached` waits for it. */
function createMilestones() {
  const points = new Map();
  const entry = (name) => {
    if (!points.has(name)) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      points.set(name, { promise, resolve, hit: false });
    }
    return points.get(name);
  };
  return {
    mark(name) { const e = entry(name); e.hit = true; e.resolve(); },
    hit: (name) => entry(name).hit,
    reached: (name) => entry(name).promise,
  };
}

function splitLimits(input = {}) {
  const engine = {};
  const run = {};
  for (const [key, value] of Object.entries(input)) {
    if (ENGINE_LIMIT_KEYS.includes(key)) engine[key] = value;
    else if (RUN_OPTION_KEYS.includes(key)) run[key] = value;
    else throw new TypeError(`createRunFixture: unknown limit ${key}`);
  }
  return { engine, run };
}

export function createRunFixture(opts = {}) {
  const clock = createFakeClock(opts.clockOptions);
  // `Object.hasOwn` (not `??`) so an explicit `plan: null` (P6.4 models failed/absent planning
  // with it) is preserved instead of being silently replaced by an empty successful plan
  // (codex-advisor review, P6.3).
  const plan = Object.hasOwn(opts, 'plan') ? opts.plan : createFakePlan([]);
  const shared = opts.shared ?? null;
  const milestones = createMilestones();

  const { engine: engineInput, run: runInputFromLimits } = splitLimits(opts.limits);
  const limits = resolveEngineLimits(engineInput);
  const runOptions = resolveRunOptions({ ...runInputFromLimits, ...opts.runOptions }, limits);

  // --- world, registry, coordinator ---
  const world = shared?.world ?? createRunWorld();
  const registry = shared?.registry ?? createPlacementRegistry({
    // A snapshot taken before planRun was ever invoked is the queued->planning snapshot, and the
    // first one is `reached('planning')`. (A shared registry labels nothing: `at: null`.)
    labelSnapshot: () => (milestones.hit('enumerating') ? 'boundary' : 'queued->planning'),
    onSnapshot: () => milestones.mark('planning'),
  });
  const realCoordinator = shared?.coordinator ?? getWorldCoordinator(world, { createRegistry: () => registry });
  const cancelAt = opts.cancelAt ?? null;
  // The run's view of the coordinator: the real one, with `enqueue` observed (job start / cancelAt).
  const coordinator = Object.freeze({
    world: realCoordinator.world,
    protocolVersion: realCoordinator.protocolVersion,
    registry: realCoordinator.registry,
    enqueue(job) {
      return realCoordinator.enqueue({
        ...job,
        run: () => {
          milestones.mark('job-started');
          if (cancelAt === 'job-started') job.control.requestCancel('user');
          return job.run();
        },
      });
    },
    cancelQueued: (runId) => realCoordinator.cancelQueued(runId),
    stopAdmitting: (engineId) => realCoordinator.stopAdmitting(engineId),
    queueDepth: (engineId) => realCoordinator.queueDepth(engineId),
    inFlightRunId: () => realCoordinator.inFlightRunId(),
  });

  // --- the definition and its models ---
  const modelKeys = [...new Set(opts.models ?? (modelKeysOfPlan(plan).length > 0 ? modelKeysOfPlan(plan) : ['mk-a']))].sort();
  const unbound = new Set(opts.unbindKeys ?? []);
  for (const key of modelKeys) {
    if (!unbound.has(key) && !registry.has(key)) registry.register(key, { fakeModel: key }, { modelVersion: 'v1' });
  }
  const testId = 'test-1';
  const semanticDigest = `sha256:${'5'.repeat(64)}`;
  const definition = {
    schemaVersion: 1,
    testId,
    revision: 1,
    name: 'fixture clash test',
    mode: 'volume-overlap',
    selectionA: { entries: modelKeys.map((modelKey) => ({ kind: 'model', modelKey })) },
    selectionB: { entries: modelKeys.map((modelKey) => ({ kind: 'model', modelKey })) },
  };
  const testRef = { testId, revision: 1, semanticDigest };
  const modelKeysOf = (def) => [...new Set([...def.selectionA.entries, ...def.selectionB.entries]
    .map((e) => e.modelKey))].sort();

  let resolveDefinition = opts.resolveDefinition ?? (() => Promise.resolve({ definition, testRef }));
  if (opts.planningGap !== undefined) {
    resolveDefinition = () => Promise.reject(planningGapError(opts.planningGap));
  }

  // --- P4's doubles-over-real: record what was (and was not) handed to them (C4) ---
  const slicer = () => createSlicer({ now: clock.now, yieldToScheduler: clock.yieldToScheduler, limits });
  const realAggregator = createDiagnosticAggregator({
    maxRetainedDiagnostics: runOptions.maxRetainedDiagnostics,
    maxDistinctReasons: runOptions.maxDistinctReasons,
    maxUnitIdsPerDiagnostic: runOptions.maxUnitIdsPerDiagnostic,
    slicer: slicer(),
  });
  const addUnitCalls = [];
  const diagnosticAggregator = {
    addUnitCalls,
    addUnit(unitId, outcome) { addUnitCalls.push(unitId); return realAggregator.addUnit(unitId, outcome); },
    snapshot: () => realAggregator.snapshot(),
  };
  const realStatistics = createStatisticsAccumulator();
  const addCalls = [];
  const statisticsAccumulator = {
    addCalls,
    add(statistics, durationMs) { addCalls.push({ statistics, durationMs }); realStatistics.add(statistics, durationMs); },
    snapshot: () => realStatistics.snapshot(),
  };

  // --- P5: residency (recording) and the result port ---
  const realResidency = createResidencyManager({ limits, resultStore: null, now: clock.now, onPersistence: () => {} });
  const admitted = [];
  const released = [];
  const beginPersistCalls = [];
  const residency = {
    ...realResidency,
    admitted,
    released,
    beginPersistCalls,
    admitSealedSet(runId, resultSet) {
      realResidency.admitSealedSet(runId, resultSet);
      admitted.push(runId);
    },
    releaseRunSlot(runId) {
      released.push(runId);
      realResidency.releaseRunSlot(runId);
    },
    beginPersist(runId, options) {
      beginPersistCalls.push({ runId, persist: options.persist });
      return realResidency.beginPersist(runId, options);
    },
  };
  const sealCalls = { buildResultSet: 0, sealResultSet: 0, deriveRunOutcome: 0 };
  const resultPort = {
    lastAccumulatorCtx: null,
    sealCalls,
    createResultAccumulator(ctx) { resultPort.lastAccumulatorCtx = ctx; return createResultAccumulator(ctx); },
    buildResultSet: opts.realSealing ? buildResultSet
      : (parts) => { sealCalls.buildResultSet += 1; return buildResultSet(parts); },
    sealResultSet: opts.realSealing ? sealResultSet
      : (draft, o) => { sealCalls.sealResultSet += 1; return sealResultSet(draft, o); },
    deriveRunOutcome: opts.realSealing ? deriveRunOutcome
      : (input) => { sealCalls.deriveRunOutcome += 1; return deriveRunOutcome(input); },
    residency,
  };

  const plannerPort = createFakePlannerPort({
    plan,
    planningGaps: opts.planningGaps ?? null,
    stallAt: opts.stallAt ?? null,
    onPlanRun: () => milestones.mark('enumerating'),
    yieldToScheduler: clock.yieldToScheduler,
  });

  const runId = opts.runId ?? (shared === null ? 'run-1' : shared.nextRunId());
  const executor = opts.executor ?? createScriptedExecutor({}, { unscripted: { facts: [] } });

  const spec = {
    runId,
    engineId: opts.engineId ?? 'engine-1',
    coordinator,
    world,
    // The testId of the run's INPUT (a stored reference's id, or the direct definition's), known
    // before resolution — what a PRE-resolution set's `testRef.testId` carries (§13.1). A value.
    testIdOfInput: testId,
    derivedFromRunId: opts.derivedFromRunId ?? null,
    resolveDefinition,
    modelKeysOf,
    planningCauseOf,
    enumerator: { resolveRoots() { throw new Error('the fake planner never enumerates'); } },
    executor,
    validateUnitOutcome,
    internalErrorOutcome,
    diagnosticAggregator,
    statisticsAccumulator,
    deriveUnitTaints,
    plannerPort,
    resultPort,
    runOptions,
    limits,
    provenanceBase: {
      registrySessionId: registry.registrySessionId,
      libraryVersion: null,
      broadPhase: runOptions.broadPhase,
      determinismClass: 'deterministic',
      scopeProof: { method: 'bracketed-digest', digestVersion: DIGEST_VERSION },
      hierarchyInternalAcceptance: null,
      libraryExclusions: [],
      placementVerified: false,
      startedAt: '2026-09-23T00:00:00.000Z',
      finishedAt: '2026-09-23T00:00:01.000Z',
    },
    now: clock.now,
    yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {},
    ...opts.specOverrides,
  };

  // P7's synchronous admission prefix reserves the run's slot before the run can exist (A14, R6).
  realResidency.reserveRunSlot(spec.runId);

  return {
    spec,
    clock,
    plan,
    world,
    registry,
    coordinator,
    executor,
    residency,
    resultPort,
    plannerPort,
    diagnosticAggregator,
    statisticsAccumulator,
    engineId: spec.engineId,
    testId,
    testRef,
    definition,
    semanticDigest,
    /** Resolves once the run has reached `name`: 'job-started', 'planning' (the run-start
     *  snapshot was taken) or 'enumerating' (planRun was invoked). */
    reached: (name) => milestones.reached(name),
  };
}

createRunFixture.sharedWorld = createSharedWorld;
