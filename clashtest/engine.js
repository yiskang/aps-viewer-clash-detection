// clashtest/engine.js
//
// Spec §18 / P7 — `createClashTestEngine`: the only module in the core that knows every other one.
// It wires the ports (world, enumerator, stores, executor), validates the engine limits and the two
// host-supplied provenance strings, joins the world-scoped coordinator (and, through it, the ONE
// ModelRegistry of the world, §4.3), and owns the engine's dispose lifecycle.
//
// Layout, so that later tasks extend this file additively (one section per method group):
//   1. module helpers        — construction-time validation, ids, small pure helpers
//   2. `createEngineCore`    — port wiring, then, in order:
//        run admission        — `buildRunSpec` / `admitAndBegin`, shared by startRun (P7.4) and rerun (P7.7)
//        definition methods   — validateTest / saveTest / getTest / listTests / archiveTest / deleteTest (P7.3)
//        run methods          — startRun / getRun / getResultSet (P7.4)
//        residency methods    — retain / release / discard / retryPersist / persistence state /
//                               retentionReport / dispose (P7.5; retentionReport and dispose land here, P7.2)
//        result-read methods  — freshness and the two no-clash-claim methods (P7.6)
//        rerun + listResults  — (P7.7)
//   3. `createClashTestEngine` — the public factory: `createEngineCore(config).engine`.
//
// `createEngineCore` and `ENGINE_METHODS` are INTERNAL named exports (tests use `internals`); they are
// not re-exported from `clashtest/index.js`, so §18's public surface is unchanged.
//
// Controller ruling R1 is enforced ONCE, here: a synchronous method THROWS `EngineDisposedError`
// after `dispose()`, a Promise-returning one REJECTS with it. Method groups register through
// `defineSync(name, fn)` / `defineAsync(name, fn)`, which add that gate, so no group can forget it.
import {
  EngineDisposedError, InvalidOptionsError, ModelBindingError, RunQueueFullError,
} from './errors.js';
import { resolveEngineLimits } from './options.js';
import { assertRegistryBelongsToWorld } from './identity/ModelRegistry.js';
import { compareModelKeys } from './identity/ids.js';
import { DIGEST_VERSION } from './util/canonical.js';
import { createSlicer, makeYieldToScheduler } from './util/slicer.js';
import { COORDINATOR_PROTOCOL_VERSION, getWorldCoordinator } from './run/coordinator.js';
import { createRun } from './run/Run.js';
import { createInMemoryClashTestStore } from './stores/InMemoryClashTestStore.js';
import { createInMemoryResultStore } from './results/InMemoryResultStore.js';
import { createResidencyManager, createReadCoordinator } from './results/residency.js';
import {
  createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome,
} from './results/resultSet.js';
import { createLocalUnitExecutor } from './execution/LocalUnitExecutor.js';
import { validateUnitOutcome, internalErrorOutcome } from './execution/UnitExecutor.js';
import {
  createDiagnosticAggregator, createStatisticsAccumulator, deriveUnitTaints,
} from './execution/diagnostics.js';
import { createDefinitionOperations } from './definition/operations.js';
import { planRun, materializeUnit, rootsForRanges } from './planning/planner.js';
import { splitUnit } from './planning/splitting.js';
import { createRecordBudget, createLedger } from './planning/ledger.js';
import { checkScopeBracket } from './planning/scopeDigest.js';

// ================================================================================================
// 1. Module helpers
// ================================================================================================

/**
 * The §18 method surface, split by how a disposed engine reports it (R1). `dispose` is neither: it is
 * idempotent and non-throwing. `annotate` and `derivations` are deliberately absent (excluded from
 * this build). Each name is implemented by exactly one task; until then it is a gated stub.
 */
export const ENGINE_METHODS = Object.freeze({
  sync: Object.freeze([
    'validateTest', 'startRun', 'getRun', 'getPersistenceState', 'retainResultSet', 'releaseResultSet',
    'invalidateModelPlacement', 'retentionReport',
  ]),
  async: Object.freeze([
    'saveTest', 'getTest', 'listTests', 'listResults', 'archiveTest', 'deleteTest', 'rerun', 'getResultSet',
    'discardRun', 'retryPersist', 'getFreshness', 'canClaimNoClashes', 'assessNoClashClaim',
  ]),
});

// §18 host-supplied strings recorded in provenance (§13.2, §13.5.2 length caps).
const MAX_LIBRARY_VERSION_UNITS = 256;
const MAX_RECORD_REF_UNITS = 512;

// §15.1: repeatability is contractual per mode — deterministic for these two, time-sensitive for the
// library-declared exceptions (`surface-intersection`, `containment`).
const DETERMINISTIC_MODES = new Set(['volume-overlap', 'clearance']);

const issue = (path, code, message) => ({ path, code, message });

function assertFunction(name, value) {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`createClashTestEngine: \`${name}\` must be a function when supplied`);
  }
}

/** §18 `hierarchyInternalAcceptance` and `libraryVersion`, validated in one pass; every issue is collected. */
function validateProvenanceStrings({ hierarchyInternalAcceptance, libraryVersion }) {
  const issues = [];
  let acceptance = null;

  if (hierarchyInternalAcceptance !== null) {
    const at = '/hierarchyInternalAcceptance';
    const value = hierarchyInternalAcceptance;
    if (typeof value !== 'object' || Array.isArray(value)) {
      issues.push(issue(at, 'bad-shape', 'hierarchyInternalAcceptance must be null or {recordRef}'));
    } else {
      for (const key of Object.keys(value)) {
        if (key !== 'recordRef') {
          const shown = key.slice(0, 64);                 // host data: bounded, and an RFC 6901 pointer segment
          issues.push(issue(`${at}/${shown.replace(/~/g, '~0').replace(/\//g, '~1')}`, 'unknown-key', 'unknown key'));
        }
      }
      const ref = value.recordRef;
      if (typeof ref !== 'string') {
        issues.push(issue(`${at}/recordRef`, 'bad-shape', 'recordRef must be a string'));
      } else if (ref.length === 0) {
        issues.push(issue(`${at}/recordRef`, 'below-minimum', 'recordRef must not be empty'));
      } else if (ref.length > MAX_RECORD_REF_UNITS) {
        issues.push(issue(`${at}/recordRef`, 'above-ceiling',
          `recordRef must be at most ${MAX_RECORD_REF_UNITS} code units`));
      } else if (issues.length === 0) {
        acceptance = Object.freeze({ recordRef: ref });    // a detached copy: the host cannot mutate it later
      }
    }
  }

  if (libraryVersion !== null) {
    if (typeof libraryVersion !== 'string') {
      issues.push(issue('/libraryVersion', 'bad-shape', 'libraryVersion must be a string or null'));
    } else if (libraryVersion.length === 0) {
      issues.push(issue('/libraryVersion', 'below-minimum', 'libraryVersion must not be empty'));
    } else if (libraryVersion.length > MAX_LIBRARY_VERSION_UNITS) {
      issues.push(issue('/libraryVersion', 'above-ceiling',
        `libraryVersion must be at most ${MAX_LIBRARY_VERSION_UNITS} code units`));
    }
  }

  if (issues.length > 0) throw new InvalidOptionsError({ issues });
  return acceptance;
}

const newEngineId = () => `engine-${globalThis.crypto.randomUUID()}`;
const newRunId = () => globalThis.crypto.randomUUID();          // §13.5

const toIso = (ms) => new Date(ms).toISOString();

/** The default host timer seam: `(fn, ms) => cancel` (Run.js requires the cancel function back). */
const defaultScheduleTimeout = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

/** P5 reports each persistence attempt through the run (P6 owns `persisted` and the `'persistence'`
 *  event), so the engine has no sink of its own to feed. */
const ignorePersistenceEvent = () => {};

/** `RunSpec.modelKeysOf`: the distinct modelKeys of both selections, ascending (Run.js: "ascending, distinct"). */
function modelKeysOf(definition) {
  const keys = new Set();
  for (const selection of [definition.selectionA, definition.selectionB]) {
    for (const entry of selection.entries) keys.add(entry.modelKey);
  }
  return [...keys].sort(compareModelKeys);
}

const notImplemented = (name) => new Error(`ClashTestEngine.${name} is not implemented in this build yet`);

// ================================================================================================
// 2. The engine core
// ================================================================================================

/**
 * @returns {{engine: object, internals: object}} `engine` is the public §18 object; `internals` is the
 *   test seam (never re-exported): the wired ports plus the shared run-admission helpers.
 */
export function createEngineCore(config) {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('createClashTestEngine: `config` must be an object');
  }
  const {
    world, enumerator, registry, unitExecutor, testStore, resultStore, limits,
    hierarchyInternalAcceptance = null, libraryVersion = null, spanRecorder,
    now = () => Date.now(), yieldToScheduler, scheduleTimeout = defaultScheduleTimeout,
  } = config;
  // `attributeSource` (annotation) is deliberately not read: `annotate` is excluded from this build.
  // `scheduleTimeout` is an internal host/test seam beside `now`/`yieldToScheduler`, not part of §18.
  if (!world) throw new TypeError('createClashTestEngine: `world` is required');
  if (!enumerator) throw new TypeError('createClashTestEngine: `enumerator` is required');
  assertFunction('unitExecutor', unitExecutor);
  for (const [name, value] of Object.entries({ now, yieldToScheduler, scheduleTimeout, spanRecorder })) {
    assertFunction(name, value);
  }

  // Everything that can refuse the configuration runs BEFORE the coordinator is joined, so a failed
  // construction leaves no trace on the world.
  const effectiveLimits = resolveEngineLimits(limits);                   // throws InvalidOptionsError
  const acceptance = validateProvenanceStrings({ hierarchyInternalAcceptance, libraryVersion });

  const coordinator = getWorldCoordinator(world, { protocolVersion: COORDINATOR_PROTOCOL_VERSION });
  if (registry !== undefined) {
    assertRegistryBelongsToWorld(registry, world);                       // duck type + world identity
    // §4.3: the coordinator owns the world's ONE registry. A second registry for the same world passes
    // the check above, and is still a mismatch.
    if (registry !== coordinator.registry) {
      throw new ModelBindingError({
        reason: 'registry-mismatch', modelKey: null,
        message: 'the world coordinator owns the sole registry for this world',
      });
    }
  }

  const engineId = newEngineId();                    // the key `stopAdmitting` / `queueDepth` are scoped by
  const engineYield = yieldToScheduler ?? makeYieldToScheduler('macrotask');
  const stores = {
    test: testStore === undefined ? createInMemoryClashTestStore() : testStore,       // null = "no store"
    result: resultStore === undefined ? createInMemoryResultStore() : resultStore,
  };
  const executor = unitExecutor || createLocalUnitExecutor({         // the UnitExecutor IS the function
    world, registry: coordinator.registry, enumerator, now, yieldToScheduler: engineYield,
    sliceBudgetMs: effectiveLimits.sliceBudgetMs,
  });
  // One slicer per sliced operation (P0); the label is per call (`tick(label)`), so no argument here.
  const newSlicer = () => createSlicer({ now, yieldToScheduler: engineYield, limits: effectiveLimits, spanRecorder });
  const residency = createResidencyManager({
    limits: effectiveLimits, resultStore: stores.result, now, onPersistence: ignorePersistenceEvent,
  });
  const reads = createReadCoordinator({ limits: effectiveLimits });
  const definitions = createDefinitionOperations({                       // P2 owns §5.5; P7 delegates (N28)
    testStore: stores.test, limits: effectiveLimits, yieldToScheduler: engineYield, now, spanRecorder,
  });

  const plannerPort = Object.freeze({
    planRun, materializeUnit, splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket,
  });
  const resultPort = Object.freeze({
    createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome, residency,
  });

  const ownRuns = new Map();     // runId -> {handle, controller}: THIS engine's runs only (dispose walks it)
  let disposed = false;
  let disposePromise = null;
  const alive = () => { if (disposed) throw new EngineDisposedError(); };

  // --- the R1 gate ------------------------------------------------------------------------------
  const methods = {};
  const defineSync = (name, fn) => {
    methods[name] = (...args) => { alive(); return fn(...args); };
  };
  const defineAsync = (name, fn) => {
    methods[name] = (...args) => {
      try {
        alive();
        return Promise.resolve(fn(...args));            // a native promise is returned as-is
      } catch (err) {
        return Promise.reject(err);
      }
    };
  };

  // ==============================================================================================
  // Run admission — shared by `startRun` (P7.4) and `rerun` (P7.7)
  // ==============================================================================================

  /**
   * P7's one `RunSpec` constructor, so P6's required fields are written in exactly one place.
   * `source` is `{kind: 'definition' | 'reference', value}` — the captured direct definition, or the
   * `{testId, revision?}` reference — and `resolver` is the engine's `{resolveDefinition(source),
   * planningCauseOf(err)}` pair (P7.4); this function wraps the first in the zero-argument per-run
   * closure P6 calls. `options` is the RESOLVED run options.
   */
  function buildRunSpec({ runId, source, options, derivedFromRunId = null, resolver }) {
    if (typeof resolver?.resolveDefinition !== 'function' || typeof resolver.planningCauseOf !== 'function') {
      throw new TypeError('buildRunSpec: `resolver` must provide resolveDefinition and planningCauseOf');
    }
    // C-P7-3: the input's testId is a plain string VALUE, known before resolution (a pre-resolution
    // set carries it), never a closure.
    const testIdOfInput = source?.value?.testId;
    if (typeof testIdOfInput !== 'string') throw new TypeError('buildRunSpec: the run input has no string testId');

    // R-P7-1. `finishedAt` and `determinismClass` are GETTERS: Run.js spreads `provenanceBase` at seal
    // time, which evaluates them then. The mode is recorded by the per-run resolution below; until it
    // resolves (a pre-resolution seal) it is unknown, and the conservative class is `time-sensitive`.
    let resolvedMode = null;
    const provenanceBase = Object.freeze({
      registrySessionId: coordinator.registry.registrySessionId,
      libraryVersion,
      broadPhase: options.broadPhase,
      scopeProof: { method: 'bracketed-digest', digestVersion: DIGEST_VERSION },
      hierarchyInternalAcceptance: acceptance,
      // PROVISIONAL (owner item D-2): informational only — the claim gates read the ledger, not this.
      libraryExclusions: [],
      placementVerified: false,
      startedAt: toIso(now()),
      get finishedAt() { return toIso(now()); },
      get determinismClass() { return DETERMINISTIC_MODES.has(resolvedMode) ? 'deterministic' : 'time-sensitive'; },
    });

    return Object.freeze({
      runId,
      engineId,
      coordinator,
      world,
      testIdOfInput,
      derivedFromRunId: derivedFromRunId ?? null,
      resolveDefinition: () => Promise.resolve(resolver.resolveDefinition(source)).then((resolved) => {
        resolvedMode = resolved?.definition?.mode ?? null;
        return resolved;
      }),
      modelKeysOf,
      planningCauseOf: resolver.planningCauseOf,
      enumerator,
      executor,
      validateUnitOutcome,
      internalErrorOutcome,
      // P4 D3: one aggregator (with its OWN slicer) and one accumulator per run.
      diagnosticAggregator: createDiagnosticAggregator({
        maxRetainedDiagnostics: options.maxRetainedDiagnostics,
        maxDistinctReasons: options.maxDistinctReasons,
        maxUnitIdsPerDiagnostic: options.maxUnitIdsPerDiagnostic,
        slicer: newSlicer(),
      }),
      statisticsAccumulator: createStatisticsAccumulator(),
      deriveUnitTaints,
      plannerPort,
      resultPort,
      runOptions: options,
      limits: effectiveLimits,
      provenanceBase,
      now,
      yieldToScheduler: yieldToScheduler ?? makeYieldToScheduler(options.interUnitYield),
      scheduleTimeout,
    });
  }

  /**
   * §18 / R6: `maxQueuedRuns` is an ENGINE limit (the coordinator enforces none), measured over runs
   * WAITING — the in-flight run is not in `queueDepth`. A run that would start at once (nothing in
   * flight) does not wait, so it is never refused: `maxQueuedRuns: 0` (which is also the derived
   * default of a one-slot engine) must still admit the first run.
   */
  function admitToQueue() {
    if (coordinator.inFlightRunId() === null) return;
    const queued = coordinator.queueDepth(engineId);
    if (queued >= effectiveLimits.maxQueuedRuns) {
      throw new RunQueueFullError({ limit: effectiveLimits.maxQueuedRuns, queued });
    }
  }

  /**
   * The one admission sequence: reserve the residency slot, check the queue limit, create the run,
   * record it, hand it to the coordinator. Synchronous and throwing (R1); any failure after the
   * reservation returns the slot and leaves no map entry, so the reservation and the queue admission
   * succeed or fail together. `ownRuns.set` precedes `begin()`, so a `dispose()` racing the hand-over
   * either has not seen the run (the rollback removes it) or sees it and signals it.
   */
  function admitAndBegin({ source, options, derivedFromRunId = null, resolver }) {
    alive();
    const runId = newRunId();
    residency.reserveRunSlot(runId);                   // ResultCapacityError
    try {
      admitToQueue();                                  // RunQueueFullError
      const { handle, controller, begin } = createRun(
        buildRunSpec({ runId, source, options, derivedFromRunId, resolver }),
      );
      ownRuns.set(runId, { handle, controller });      // `controller` is engine-only (never on the handle)
      begin();
      return handle;
    } catch (err) {
      ownRuns.delete(runId);
      residency.releaseRunSlot(runId);
      throw err;
    }
  }

  // ==============================================================================================
  // Definition methods (P7.3)
  // ==============================================================================================

  // ==============================================================================================
  // Run methods (P7.4)
  // ==============================================================================================

  // ==============================================================================================
  // Residency, retention and lifecycle (P7.5; retentionReport and dispose are P7.2's)
  // ==============================================================================================

  defineSync('retentionReport', () => ({ ...residency.retentionReport(), readSlotsInUse: reads.inUse() }));

  /**
   * SIGNAL every owned run first, WAIT second: one synchronous snapshot of the map is signalled
   * before the first `await`, which bounds every wait the ENGINE owns (a queued run seals without ever
   * reaching the head of the queue, a run in its finalize window force-finalizes instead of waiting
   * for a write that may never settle). It does not abandon a unit already in flight: §10.1 gives that
   * call no abort seam and its disposition is drain, not discard, so this stays pending until the
   * executor returns (P6 open item O9, an accepted injected-port limit).
   */
  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;                                   // set BEFORE the first await: a concurrent call sees it
    disposePromise = (async () => {
      coordinator.stopAdmitting(engineId);             // no further run of THIS engine is admitted (N25)
      const owned = [...ownRuns.values()];
      for (const { controller } of owned) {
        try { controller.requestDispose(); } catch { /* dispose never throws; the rest must still be signalled */ }
      }
      await Promise.all(owned.map(({ handle }) => handle.done.catch(() => {})));
      const summary = residency.drainForDispose();     // IS the DisposeSummary (N23); never waits for a write
      ownRuns.clear();                                 // the engine keeps no run once it is gone
      return summary;
    })();
    return disposePromise;
  }

  // ==============================================================================================
  // Result-read methods (P7.6) and rerun / listResults (P7.7)
  // ==============================================================================================

  // Every §18 name a later task has not implemented yet is a gated stub: it honours the R1 disposal
  // contract today and fails loudly, rather than silently doing nothing, until its task lands.
  for (const name of ENGINE_METHODS.sync) if (!(name in methods)) defineSync(name, () => { throw notImplemented(name); });
  for (const name of ENGINE_METHODS.async) if (!(name in methods)) defineAsync(name, () => { throw notImplemented(name); });

  const engine = Object.freeze({ registry: coordinator.registry, ...methods, dispose });

  return {
    engine,
    internals: {
      engineId, effectiveLimits, hierarchyInternalAcceptance: acceptance, libraryVersion,
      stores, executor, definitions, coordinator, residency, reads, ownRuns, newSlicer,
      buildRunSpec, admitAndBegin,
    },
  };
}

// ================================================================================================
// 3. The public factory
// ================================================================================================

export function createClashTestEngine(config = {}) {
  return createEngineCore(config).engine;
}
