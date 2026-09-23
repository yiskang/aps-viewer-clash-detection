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
//   splits                (Task P6.5) `{parentUnitId: [{unitId, weight}, {unitId, weight}]}`, routed
//                         to `createFakePlannerPort`'s own `splitUnit` (§6.4 real split admission).
//   limits.maxLedgerRecords: 'exhausted'  (Task P6.5) a FIXTURE SENTINEL, never a real option value:
//                         pre-spends the discretionary ledger budget down to 1 record on the first
//                         split attempt, so that split is refused on the ledger-records cap.
//   beforeUnit            (Task P6.5) `{unitId: () => void}`, fired at most once per unit, immediately
//                         before that unit's first attempt — models a one-time host-side mutation
//                         (e.g. `registry.notifyPlacementChanged(...)`) landing before the engine's
//                         first call for that unit.
//
// Task P6.6 additionally exposes: `afterUnit(unitId, fn) -> Promise` — `fn` runs ONCE, synchronously,
// at the first `spec.yieldToScheduler` call after the executor call for `unitId` returned (i.e. after
// that unit's attempt settled and committed, and BEFORE the next unit boundary reads the registry —
// the loop's inter-unit yield is the only such call between two units). The promise resolves with
// `fn`'s return value once it ran. A unit that is the LAST to settle has no following inter-unit
// yield, so `afterUnit` must name a unit that is followed by another. `diagnosticAggregator.unitsAdded`
// is the same list as `addUnitCalls` (the unitIds the run handed the aggregator).
//
// `realSealing: true` hands the run P5's bare `buildResultSet`/`sealResultSet`/`deriveRunOutcome`
// with NO wrapper at all. The default ALSO uses the real functions, wrapped only to record calls, so
// no P6 test ever seals through a hand-built stand-in of P5's assembly.
//
// `createRunFixture.sharedWorld()` returns `{world, registry, coordinator}` for several fixtures to
// share (one world => one coordinator => one FIFO queue and one in-flight slot, §7.3).
//
// Task P6.5 additionally exposes on the returned fixture: `plannerCalls` (= `plannerPort.calls`),
// `limits` (the resolved engine limits), `yields.interUnit` (calls through `spec.yieldToScheduler`),
// `ledger.halfRecordedSplits` (independent atomicity check on a refused split), `substitutedOutcomes`
// / `lastValidationIssues` (every `internalErrorOutcome` substitution and the issues that drove it).
// `spec.executor` runs through a live-generations wrapper (`beforeUnit` + real registry-bracketed
// `outcome.generations`); the returned `executor` field stays the INNER, unwrapped instance so its
// own tracking (`requests`, `attemptsFor`, `maxConcurrent`, `startedUnits`) is unaffected.

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

/**
 * Task P6.5 (C5 "a ledger-record refusal" test): `limits.maxLedgerRecords: 'exhausted'` is a fixture
 * SENTINEL, never a real option value (`resolveRunOptions` would reject the string outright) --
 * pulled out here before the real limits are resolved, so `maxLedgerRecords` itself still resolves to
 * its ordinary default. `createFakePlannerPort`'s own `preExhaustLedger` flag spends the run's
 * discretionary ledger budget down to 1 remaining record on the FIRST split attempt (i.e. once
 * planning's own `reserveUnitSlots()` has already succeeded), so a small, otherwise-unremarkable
 * split is refused on the ledger-records cap specifically, never the unit-records one.
 */
function extractPreExhaustLedger(limits) {
  if (limits?.maxLedgerRecords !== 'exhausted') return { limits, preExhaustLedger: false };
  const { maxLedgerRecords: _drop, ...rest } = limits;
  return { limits: rest, preExhaustLedger: true };
}

/**
 * Task P6.5 (C1 "a placement generation that MOVED" test): wraps an executor (default or test-
 * supplied) so `outcome.generations.start`/`.end` are LIVE registry reads bracketing the call, exactly
 * as P4's own executor brackets a real library call (Task P4.8) — never the frozen run-start
 * `request.snapshot` a fake executor would otherwise have no other source for. Without this, a test's
 * `registry.notifyPlacementChanged(...)` would be invisible to `isRetryablePlacement`'s generation
 * comparison, because `request.snapshot` never changes once the run has started. `beforeUnit[unitId]`
 * (a fixture option, not part of the §7.1 executor contract) fires at most ONCE per unit, immediately
 * before that unit's FIRST attempt is dispatched — modelling a single host-side mutation that lands
 * before the engine ever calls out for this unit, not a per-attempt hook.
 */
function wrapExecutorWithLiveGenerations(innerExecutor, { registry, beforeUnit = {}, onReturned = () => {} }) {
  const fired = new Set();
  // Task P6.6 fix: one entry per request-snapshot participant, ALWAYS — exactly P4's own
  // `readGenerations` (LocalUnitExecutor.js), which falls back to the request's snapshot entry when
  // a participant has no live binding. The P6.5 version DROPPED a dead participant, which P4's
  // `validateUnitOutcome` rejects (`generations-missing-participant`), so any test whose participant
  // died during a call was silently turned into `internal-error`.
  const liveGenerationsFor = (request) => request.snapshot.map((s) => {
    const source = registry.bindingFor(s.modelKey) ?? s;
    return { modelKey: s.modelKey, bindingGeneration: source.bindingGeneration, placementGeneration: source.placementGeneration };
  });
  return async function executorWithLiveGenerations(request) {
    const { unitId } = request.unit;
    if (!fired.has(unitId) && typeof beforeUnit[unitId] === 'function') {
      fired.add(unitId);
      beforeUnit[unitId]();
    }
    const start = liveGenerationsFor(request);
    const outcome = await innerExecutor(request);
    const end = liveGenerationsFor(request);
    onReturned(unitId);                                    // Task P6.6: arms `afterUnit(unitId, ...)`
    if (outcome === null || typeof outcome !== 'object') return outcome;   // let validation reject it
    return { ...outcome, generations: { start, end } };
  };
}

/** Task P6.5: `createLedger` wrapped so a refused `tryRecordSplit` can be independently VERIFIED
 *  atomic (`fx.ledger.halfRecordedSplits`) -- neither child landed and the record count is unchanged
 *  -- without duplicating P3's own admission logic. A Proxy (not a spread) so every OTHER member,
 *  including the live getters (`unitRecordCount`, `budgetExhausted`, ...), stays bound to the real,
 *  live ledger instead of a value snapshot taken at wrap time. */
function wrapCreateLedgerForFixture(realCreateLedger, onHalfRecordedSplit) {
  return (ledgerOpts) => {
    const target = realCreateLedger(ledgerOpts);
    return new Proxy(target, {
      get(t, prop) {
        if (prop === 'tryRecordSplit') {
          return (unitId, children) => {
            const before = t.unitRecordCount;
            const result = t.tryRecordSplit(unitId, children);
            if (result.ok === false) {
              const partial = t.unitRecordCount !== before
                || children.some((c) => t.unitRecord(c.unitId) !== null);
              if (partial) onHalfRecordedSplit();
            }
            return result;
          };
        }
        const value = Reflect.get(t, prop, t);
        return typeof value === 'function' ? value.bind(t) : value;
      },
    });
  };
}

export function createRunFixture(opts = {}) {
  const clock = createFakeClock(opts.clockOptions);
  // `Object.hasOwn` (not `??`) so an explicit `plan: null` (P6.4 models failed/absent planning
  // with it) is preserved instead of being silently replaced by an empty successful plan
  // (codex-advisor review, P6.3).
  const plan = Object.hasOwn(opts, 'plan') ? opts.plan : createFakePlan([]);
  const shared = opts.shared ?? null;
  const milestones = createMilestones();

  const { limits: limitsInput, preExhaustLedger } = extractPreExhaustLedger(opts.limits);
  const { engine: engineInput, run: runInputFromLimits } = splitLimits(limitsInput);
  const limits = resolveEngineLimits(engineInput);
  const runOptions = resolveRunOptions({ ...runInputFromLimits, ...opts.runOptions }, limits);

  // Task P6.5: counts every call through `spec.yieldToScheduler` (the ONLY yield source in a plan
  // with no slicer-triggered yields of its own -- see `wrapExecutorWithLiveGenerations`'s sibling
  // comment): `run.interUnitYield()` is the sole caller in every one of this task's own fixtures.
  const yields = { interUnit: 0 };
  // Task P6.6: `afterUnit` hooks. `returned` is filled by the executor wrapper; a hook fires at the
  // next yield once its unit has returned — synchronously, before the yield itself is awaited.
  const afterUnitHooks = new Map();                        // unitId -> {fn, resolve, reject, fired}
  const returnedUnits = new Set();
  const fireAfterUnitHooks = () => {
    for (const [unitId, hook] of afterUnitHooks) {
      if (hook.fired || !returnedUnits.has(unitId)) continue;
      hook.fired = true;
      try { hook.resolve(hook.fn()); } catch (error) { hook.reject(error); }
    }
  };
  const afterUnit = (unitId, fn) => new Promise((resolve, reject) => {
    if (afterUnitHooks.has(unitId)) throw new Error(`afterUnit: a hook for ${unitId} already exists`);
    afterUnitHooks.set(unitId, { fn, resolve, reject, fired: false });
  });
  const yieldToScheduler = async () => {
    yields.interUnit += 1;
    fireAfterUnitHooks();
    await clock.yieldToScheduler();
  };

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
    get unitsAdded() { return addUnitCalls; },            // Task P6.6: the brief's name for it
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
    splits: opts.splits ?? {},
    preExhaustLedger,
  });
  // Task P6.5 (C5 ledger-record refusal test): wraps the REAL `createLedger` (a Proxy, so every live
  // getter -- `unitRecordCount`, `budgetExhausted`, ... -- stays bound to the actual instance) so a
  // refused split can be independently verified atomic.
  const ledgerState = { halfRecordedSplits: 0 };
  plannerPort.createLedger = wrapCreateLedgerForFixture(
    plannerPort.createLedger, () => { ledgerState.halfRecordedSplits += 1; },
  );

  const runId = opts.runId ?? (shared === null ? 'run-1' : shared.nextRunId());
  const executor = opts.executor ?? createScriptedExecutor({}, { unscripted: { facts: [] } });
  // Task P6.5: `spec.executor` runs THROUGH the live-generations wrapper (`beforeUnit` + real
  // registry bracketing); `fx.executor` below stays the INNER, unwrapped instance so its own
  // tracking (`requests`, `attemptsFor`, `maxConcurrent`, `startedUnits`) keeps working unchanged --
  // the wrapper only ever delegates to it.
  const specExecutor = wrapExecutorWithLiveGenerations(executor, {
    registry, beforeUnit: opts.beforeUnit ?? {}, onReturned: (unitId) => returnedUnits.add(unitId),
  });

  // Task P6.5 (the malformed-outcome test): records every substitution and the issues that drove it,
  // without changing either function's own behaviour or signature.
  const substitutedOutcomes = [];
  const lastValidationIssues = [];
  const wrappedValidateUnitOutcome = (request, outcome) => {
    const result = validateUnitOutcome(request, outcome);
    if (result.ok !== true) { lastValidationIssues.length = 0; lastValidationIssues.push(...result.issues); }
    return result;
  };
  const wrappedInternalErrorOutcome = (request, issues) => {
    const outcome = internalErrorOutcome(request, issues);
    substitutedOutcomes.push({ source: 'internalErrorOutcome', request, issues, outcome });
    return outcome;
  };

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
    executor: specExecutor,
    validateUnitOutcome: wrappedValidateUnitOutcome,
    internalErrorOutcome: wrappedInternalErrorOutcome,
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
    yieldToScheduler,
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
    plannerCalls: plannerPort.calls,
    diagnosticAggregator,
    statisticsAccumulator,
    engineId: spec.engineId,
    testId,
    testRef,
    definition,
    semanticDigest,
    limits,
    yields,
    ledger: ledgerState,
    substitutedOutcomes,
    lastValidationIssues,
    /** Resolves once the run has reached `name`: 'job-started', 'planning' (the run-start
     *  snapshot was taken) or 'enumerating' (planRun was invoked). */
    reached: (name) => milestones.reached(name),
    afterUnit,                                             // Task P6.6
  };
}

createRunFixture.sharedWorld = createSharedWorld;
