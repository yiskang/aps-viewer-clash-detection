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
// `createEngineCore`, `ENGINE_METHODS`, `createStoredDefinitionResolver` and `withStoredDefinitionValidator`
// are INTERNAL named exports (tests use them and `internals`); none is re-exported from `clashtest/index.js`,
// so §18's public surface is unchanged.
//
// Controller ruling R1 is enforced ONCE, here: a synchronous method THROWS `EngineDisposedError`
// after `dispose()`, a Promise-returning one REJECTS with it. Method groups register through
// `defineSync(name, fn)` / `defineAsync(name, fn)`, which add that gate, so no group can forget it.
import {
  EngineDisposedError, InvalidOptionsError, ModelBindingError, RunQueueFullError,
  StoreNotConfiguredError, CorruptListingError, InvalidTestDefinitionError, UnsupportedSchemaVersionError,
  ResultNotResidentError,
} from './errors.js';
import { resolveEngineLimits, resolveRunOptions, ENGINE_LIMIT_CEILINGS } from './options.js';
import { assertRegistryBelongsToWorld } from './identity/ModelRegistry.js';
import { compareModelKeys } from './identity/ids.js';
import { DIGEST_VERSION } from './util/canonical.js';
import { captureData, deepFreeze } from './util/capture.js';
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
import { createDefinitionOperations, RESOLVE_STATUS_TO_PLANNING_CAUSE } from './definition/operations.js';
import {
  validateReference, toDefinitionError, LIST_LIMIT, captureAndValidate, classifyStartRunArgument,
} from './definition/validate.js';
import { prepareDefinition } from './definition/normalize.js';
import { validateResultSetSummary, readResultSet, captureResultSet } from './results/validateResultSet.js';
import { assessNoClashClaim as assessClaim, canClaimNoClashes as canClaim } from './results/claim.js';
// P6's read-time freshness, aliased so it cannot shadow the engine method of the same name.
import { getFreshness as readTimeFreshness } from './run/freshness.js';
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

// ---- §13.5 listing calls: option capture (caller side) and page validation (store side) -------------

const MAX_LISTING_ISSUES = 20;               // §13.5 R15-6: CorruptListingError carries the first 20 {path, code}
const MAX_LISTING_STRING_UNITS = 1024;       // §13.5.2 string caps (modelKey/modelVersion 1,024; cursor 1,024)
const MAX_TEST_ID_UNITS = 256;               // §5.3 R2
// `models` of a ResultSetSummary: 2 x the maxEntriesPerSelection ceiling (§13.5), the same rule the P5 row validator applies.
const SUMMARY_MAX_MODELS = 2 * ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection;

const isPlainRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bareIssue = ({ path, code }) => ({ path, code });      // no message, never a value (§16)

/**
 * The options of a listing call, captured in the caller's turn as one detached plain copy (so a getter is
 * never invoked and a later mutation changes nothing), then checked against the §13.5 listing contract:
 * `limit` an integer 1..1,000; `cursor` is OPAQUE and versioned, so its content is the STORE's to judge
 * (`bad-cursor`), the engine only bounds its size; `testId` (listResults only) a §5.3 R2 id.
 * @throws {InvalidOptionsError}
 */
function captureListOptions(page, allowedKeys) {
  const fail = (issues) => { throw new InvalidOptionsError({ issues: issues.slice(0, MAX_LISTING_ISSUES).map(bareIssue) }); };
  // `{limit: undefined}` is how a host says "no limit"; it is not plain DATA to `captureData`, so an
  // undefined-valued own key is dropped first, reading each descriptor exactly once (a getter is never invoked).
  let input = page;
  if (isPlainRecord(page)) {
    try {
      const proto = Object.getPrototypeOf(page);
      if (proto === Object.prototype || proto === null) {                  // any other prototype: `captureData` refuses it
        const own = Object.getOwnPropertyDescriptors(page);
        input = {};
        for (const key of Reflect.ownKeys(own)) {
          const d = own[key];
          if (!('value' in d) || d.value !== undefined) Object.defineProperty(input, key, d);
        }
      }
    } catch {
      return fail([{ path: '/', code: 'unreadable' }]);                    // a throwing Proxy trap
    }
  }
  const cap = captureData(input, { maxNodes: 16, maxIssues: MAX_LISTING_ISSUES, maxStringLength: MAX_LISTING_STRING_UNITS });
  if (!cap.ok) return fail(cap.issues);
  const copy = cap.value;
  if (!isPlainRecord(copy)) return fail([{ path: '/', code: 'not-an-object' }]);
  const issues = [];
  for (const key of Object.keys(copy)) {
    if (!allowedKeys.includes(key)) issues.push({ path: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, code: 'unknown-property' });
  }
  const { limit, testId } = copy;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= LIST_LIMIT.max)) {
    issues.push({ path: '/limit', code: 'out-of-range' });
  }
  if (testId !== undefined && !(typeof testId === 'string' && testId.length >= 1 && testId.length <= MAX_TEST_ID_UNITS)) {
    issues.push({ path: '/testId', code: 'bad-test-id' });
  }
  if (issues.length > 0) return fail(issues);
  return copy;
}

/**
 * §13.5 R15-6: a `ResultStore.list` page is untrusted data. It is captured as ONE detached copy (no getter
 * is invoked), the copy is validated -- page shape, then every row through P5's closed `ResultSetSummary`
 * validator -- and THAT copy is what the caller receives, deep-frozen. One bad row rejects the whole page:
 * `CorruptListingError` with the first 20 `{path, code}` and never a value.
 * @throws {CorruptListingError}
 */
function validatedResultPage(page, limits) {
  const corrupt = (issues) => { throw new CorruptListingError({ issues: issues.slice(0, MAX_LISTING_ISSUES).map(bareIssue) }); };
  const cap = captureData(page, {
    maxNodes: limits.maxCapturedNodes, maxIssues: MAX_LISTING_ISSUES, maxStringLength: MAX_LISTING_STRING_UNITS,
    maxArrayLength: LIST_LIMIT.max,
    arrayLimitFor: (pointer) => (/^\/summaries\/\d+\/models$/.test(pointer) ? SUMMARY_MAX_MODELS : undefined),
  });
  if (!cap.ok) return corrupt(cap.issues);
  const copy = cap.value;
  if (!isPlainRecord(copy)) return corrupt([{ path: '/', code: 'not-an-object' }]);
  const issues = [];
  for (const key of Object.keys(copy)) {
    if (key !== 'summaries' && key !== 'next') issues.push({ path: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, code: 'unknown-property' });
  }
  if (Object.hasOwn(copy, 'next') && typeof copy.next !== 'string') issues.push({ path: '/next', code: 'not-a-string' });
  if (!Object.hasOwn(copy, 'summaries')) issues.push({ path: '/summaries', code: 'missing-required' });
  else if (!Array.isArray(copy.summaries)) issues.push({ path: '/summaries', code: 'not-an-array' });
  else {
    for (let i = 0; i < copy.summaries.length && issues.length < MAX_LISTING_ISSUES; i += 1) {
      const row = copy.summaries[i];
      if (!isPlainRecord(row)) { issues.push({ path: `/summaries/${i}`, code: 'not-an-object' }); continue; }
      for (const found of validateResultSetSummary(row, {}).issues) {
        issues.push({ path: `/summaries/${i}${found.path}`, code: found.code });
      }
    }
  }
  if (issues.length > 0) return corrupt(issues);
  return deepFreeze(copy);
}

const notImplemented = (name) => new Error(`ClashTestEngine.${name} is not implemented in this build yet`);

// ---- the per-engine stored-definition resolver (P7.4 Step 3a; spec §5.5) ----------------------------

/**
 * A lookup that cannot produce a usable test (§5.5: `test-not-found` / `test-archived` / `test-deleted`
 * / `test-lookup-failed`) is tagged with this module-private symbol, so `planningCauseOf` maps it to
 * the ONE sealed cause `test-unavailable` (R-P7-4) without a new error class or new vocabulary. The
 * detail rides only on the in-memory error; the sealed `PlanningGap` is the closed `{phase, cause}` (A1).
 */
const TEST_UNAVAILABLE = Symbol('clashtest.engine.testUnavailable');

function testUnavailable(detail, cause) {
  const err = new Error(`stored test unavailable (${detail})`, cause === undefined ? undefined : { cause });
  err[TEST_UNAVAILABLE] = detail;
  return err;
}

/** A status other than `live`, through P2's §5.5 status table (used ONLY to pick the detail). */
const unavailableDetailOf = (status) => (
  typeof status === 'string' && status !== 'live' && Object.hasOwn(RESOLVE_STATUS_TO_PLANNING_CAUSE, status)
    ? RESOLVE_STATUS_TO_PLANNING_CAUSE[status]
    : 'test-lookup-failed');

/** The test-only validator override of `withStoredDefinitionValidator` (null = P2's `captureAndValidate`). */
let storedDefinitionValidatorOverride = null;

/**
 * INTERNAL (never re-exported from `clashtest/index.js`). Test-only construction seam: engines built
 * SYNCHRONOUSLY inside `fn` get `validate` as their stored-definition validator, captured at
 * construction (the engine never re-reads this slot at run time). The previous value is restored in a
 * `finally`, so a throw inside `fn` cannot leak the override. Not a host option; not a migration seam.
 */
export function withStoredDefinitionValidator(validate, fn) {
  if (typeof validate !== 'function' || typeof fn !== 'function') {
    throw new TypeError('withStoredDefinitionValidator(validate, fn): both must be functions');
  }
  const previous = storedDefinitionValidatorOverride;
  storedDefinitionValidatorOverride = validate;
  try {
    return fn();
  } finally {
    storedDefinitionValidatorOverride = previous;
  }
}

/**
 * INTERNAL (never re-exported from `clashtest/index.js`). The per-engine factory of the two closures
 * P6's `RunSpec` needs over `stores.test` (P7.4 Step 3a, support obligation 3):
 *
 *   resolveDefinition(input, {kind = 'reference', persist = true})
 *        → Promise<{definition (prepared, deep-frozen), testRef: {testId, revision, semanticDigest}}>
 *     In order, every step before any planning:
 *     1. §5.5 layer 2 — for a run with `persist !== false` when a testStore is configured, whatever
 *        the overload: `testStore.isTombstoned(testId)`. Only a literal `false` passes; `true` is
 *        `test-deleted`, a rejection or any other answer is `test-lookup-failed` (FAIL CLOSED).
 *     2. `kind: 'definition'` — `input` is the CAPTURED, already-validated direct definition (the
 *        synchronous prefix of `startRun` validated it): it is only prepared.
 *     3. `kind: 'reference'` — `testStore.resolveForRun(testId, revision?)`; any status but `live`, a
 *        rejection or an unreadable answer is `test-unavailable`. The returned definition is
 *        UNTRUSTED (§5.3 (iv)): it is captured and validated by `validate` AT THE RESOLVED ENGINE
 *        LIMITS (which bound the issue list), a non-empty result becomes P2's `toDefinitionError`
 *        (`InvalidTestDefinitionError` / `UnsupportedSchemaVersionError`), and a definition for a
 *        different test or revision than the one asked for is unusable (`test-lookup-failed`) —
 *        `ResultId` is derived from `testRef.testId`, so it must be the caller's.
 *     4. P2's `prepareDefinition` (normalize → `semanticDigest` → deep freeze, sliced).
 *
 *   planningCauseOf(err) → a `PLANNING_CAUSES` member. P6 also hands it planner/enumeration throws, so
 *     it maps, in order: test-unavailable tag → `test-unavailable`; `InvalidTestDefinitionError` →
 *     `definition-invalid`; `UnsupportedSchemaVersionError{type:'ClashTestDefinition'}` →
 *     `schema-unsupported`; `WorldDisposedError` → `world-disposed`; `ModelEvictedError` →
 *     `model-not-bound`; anything else (and an error it cannot even read) → `enumeration-failed`
 *     (fail closed). Only the bare string crosses into P6, so no issue detail can reach the seal (A1).
 *     `migration-failed` stays a reserved cause with no producer (DEFINITION_SCHEMA_VERSION is 1).
 *
 * `validate` is a TEST-ONLY default-argument seam (default: the `withStoredDefinitionValidator`
 * override if one is active at this call, else P2's `captureAndValidate`).
 */
export function createStoredDefinitionResolver({
  testStore = null, limits, validate = storedDefinitionValidatorOverride ?? captureAndValidate,
  now, yieldToScheduler, spanRecorder,
} = {}) {
  if (typeof validate !== 'function') throw new TypeError('createStoredDefinitionResolver: `validate` must be a function');
  const slice = { now, yieldToScheduler, limits, spanRecorder };

  async function assertNotTombstoned(testId) {
    let answer;
    try {
      answer = await testStore.isTombstoned(testId);
    } catch (err) {
      throw testUnavailable('test-lookup-failed', err);
    }
    if (answer !== false) throw testUnavailable(answer === true ? 'test-deleted' : 'test-lookup-failed');
  }

  async function prepared(captured) {
    const { definition, semanticDigest } = await prepareDefinition(captured, slice);
    return { definition, testRef: { testId: definition.testId, revision: definition.revision, semanticDigest } };
  }

  async function lookUp(testId, revision) {
    try {
      const found = await testStore.resolveForRun(testId, revision ?? undefined);   // absent revision = latest
      return { status: found.status, stored: found.definition };
    } catch (err) {
      throw testUnavailable('test-lookup-failed', err);
    }
  }

  async function resolveDefinition(input, { kind = 'reference', persist = true } = {}) {
    const { testId } = input;
    if (persist !== false && testStore) await assertNotTombstoned(testId);
    if (kind === 'definition') return prepared(input);
    if (!testStore) throw testUnavailable('test-lookup-failed');   // startRun refuses this synchronously
    const { status, stored } = await lookUp(testId, input.revision);
    if (status !== 'live') throw testUnavailable(unavailableDetailOf(status));
    const checked = validate(stored, { limits });
    if (checked.issues.length > 0) throw toDefinitionError(checked);
    const captured = checked.captured;
    const wantedRevision = input.revision ?? null;
    if (captured.testId !== testId || (wantedRevision !== null && captured.revision !== wantedRevision)) {
      throw testUnavailable('test-lookup-failed');
    }
    return prepared(captured);
  }

  function planningCauseOf(err) {
    try {
      if (err !== null && typeof err === 'object') {
        if (err[TEST_UNAVAILABLE] !== undefined) return 'test-unavailable';
        if (err instanceof InvalidTestDefinitionError) return 'definition-invalid';
        if (err instanceof UnsupportedSchemaVersionError && err.type === 'ClashTestDefinition') return 'schema-unsupported';
        if (err.name === 'WorldDisposedError') return 'world-disposed';
        if (err.name === 'ModelEvictedError') return 'model-not-bound';
      }
    } catch {
      // an error object with throwing accessors / traps: fail closed below
    }
    return 'enumeration-failed';
  }

  return { resolveDefinition, planningCauseOf };
}

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
  // P7.4 Step 3a: the ONE stored-definition resolver of this engine, built with the RESOLVED engine
  // limits (the observable `maxValidationIssues` hand-down). Its `validate` default is read HERE, once,
  // so a `withStoredDefinitionValidator` override is captured at construction time.
  const storedResolver = createStoredDefinitionResolver({
    testStore: stores.test, limits: effectiveLimits, now, yieldToScheduler: engineYield, spanRecorder,
  });
  // The shape `buildRunSpec` consumes (`resolveDefinition(source, {persist})`), over that resolver;
  // shared by `startRun` and (P7.7) `rerun`.
  const runResolver = Object.freeze({
    resolveDefinition: (source, { persist } = {}) => storedResolver.resolveDefinition(source.value, { kind: source.kind, persist }),
    planningCauseOf: storedResolver.planningCauseOf,
  });

  const plannerPort = Object.freeze({
    planRun, materializeUnit, splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket,
  });
  const ownRuns = new Map();     // runId -> {handle, controller, sealedSet?}: THIS engine's runs only (dispose walks it)

  // The residency port P6 drives, with ONE addition: the sealed set a run admits is also recorded on
  // that run's own `ownRuns` entry, so a claim/freshness read can reach a resident set WITHOUT
  // refreshing its LRU position (P5's `getResident` touches; see `peekResident`). No extra memory:
  // the entry's `handle.done` already resolves with (and so holds) this very set.
  const runResidency = Object.freeze({
    ...residency,
    admitSealedSet(runId, resultSet) {
      residency.admitSealedSet(runId, resultSet);      // P5's rules; a throw records nothing
      const own = ownRuns.get(runId);
      if (own !== undefined) own.sealedSet = resultSet;
    },
  });
  const resultPort = Object.freeze({
    createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome, residency: runResidency,
  });

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

  /** A run's slot is live while it holds a reservation (not yet sealed) or its sealed set is resident.
   *  Both reads are NON-touching (they never change the LRU order). */
  const holdsSlot = (runId) => residency.reservationHeld(runId) || residency.getPersistenceState(runId) !== null;

  /**
   * Drops every `ownRuns` entry whose run is TERMINAL and no longer holds a slot (released, evicted or
   * discarded): the engine keeps no run history (§13.5.2, no history cache). A non-terminal entry is
   * always kept, so `dispose()` can still signal it. After a prune the map holds at most the slot cap
   * of entries plus any still-settling run, so it is bounded by the resident bound.
   */
  function pruneOwnRuns() {
    for (const [runId, { handle }] of ownRuns) {
      if (!holdsSlot(runId) && handle.getSnapshot().phase === 'terminal') ownRuns.delete(runId);
    }
  }

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
      // `persist` rides along because §5.5 layer 2 (the tombstone admission check) applies only to a
      // run whose set may be persisted.
      resolveDefinition: () => Promise.resolve(resolver.resolveDefinition(source, { persist: options.persist })).then((resolved) => {
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
   * §18 / R6 / R-P7-13: `maxQueuedRuns` is an ENGINE limit (the coordinator enforces none) that can
   * only LOWER the bound slot accounting already imposes (§7.3, §18: "RunQueueFullError only when a
   * configured maxQueuedRuns lower than slot capacity is reached; otherwise ResultCapacityError").
   * `RunQueueFullError` is therefore thrown iff ALL of:
   *   (a) `maxQueuedRuns` is below the slot-implied bound `maxResidentResultSets - 1` — at or above it
   *       this check is a no-op and `reserveRunSlot` alone governs;
   *   (b) the run would actually have to WAIT: something is in flight in the world coordinator (this
   *       engine's run or ANOTHER engine's), otherwise it starts at once — so `maxQueuedRuns: 0`, also
   *       the derived default of a one-slot engine, still admits the first run;
   *   (c) THIS engine's waiting-run count (`queueDepth(engineId)`, in-flight not counted) has reached
   *       `maxQueuedRuns`.
   */
  function admitToQueue() {
    const { maxQueuedRuns, maxResidentResultSets } = effectiveLimits;
    if (maxQueuedRuns >= maxResidentResultSets - 1) return;              // (a)
    if (coordinator.inFlightRunId() === null) return;                    // (b)
    const queued = coordinator.queueDepth(engineId);
    if (queued >= maxQueuedRuns) throw new RunQueueFullError({ limit: maxQueuedRuns, queued });   // (c)
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
    pruneOwnRuns();                                    // keeps `ownRuns` bounded by the slot cap
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
  //
  // P2's `createDefinitionOperations` owns §5.3 / §5.5 for validate / save / get / list / archive (capture in
  // the caller's turn, untrusted store reads, the `put` refusal precedence); these methods add only what P7
  // alone owns: the R1 gate (via `defineSync`/`defineAsync`), the §13.5.2 read slots, the `ResultStore`
  // listing, and `deleteTest` (only P7 holds both stores and so the two-layer order).

  /** `StoreNotConfiguredError{store}` for the named store, else the store. */
  const requireStore = (name) => {
    const store = name === 'testStore' ? stores.test : stores.result;
    if (!store) throw new StoreNotConfiguredError({ store: name });
    return store;
  };

  /** Runs `fn` holding one read slot (§13.5.2, FIFO, `ReadCapacityError` beyond the queue); released on every exit. */
  async function withReadSlot(fn) {
    const slot = await reads.acquire();
    try {
      return await fn();
    } finally {
      slot.release();
    }
  }

  /**
   * Archive and delete are irreversible, so their argument is checked before ANY store sees it: a `testId`
   * is the §5.3 R2 id (a string of 1-256 code units), else `InvalidTestDefinitionError` (the error a
   * malformed reference raises everywhere else). Returns the captured plain string.
   */
  function captureTestId(testId) {
    const checked = validateReference({ testId }, { limits: effectiveLimits });
    if (checked.issues.length > 0) {
      throw toDefinitionError({ issues: checked.issues, issuesTruncated: checked.issuesTruncated });
    }
    return checked.captured.testId;
  }

  defineSync('validateTest', (def) => definitions.validateTest(def));
  defineAsync('saveTest', (def) => definitions.saveTest(def));               // captures before it returns its promise
  defineAsync('getTest', (testId, revision) => definitions.getTest(testId, revision));

  defineAsync('listTests', (page = {}) => {
    requireStore('testStore');
    const options = captureListOptions(page, ['limit', 'cursor']);
    return withReadSlot(() => definitions.listTests(options));
  });

  defineAsync('listResults', (page = {}) => {
    const resultStore = requireStore('resultStore');
    const options = captureListOptions(page, ['testId', 'limit', 'cursor']);
    return withReadSlot(async () => validatedResultPage(await resultStore.list(options), effectiveLimits));
  });

  defineAsync('archiveTest', async (testId) => {
    requireStore('testStore');
    const id = captureTestId(testId);
    await definitions.archiveTest(id);
  });

  /**
   * §5.5: the only supported delete, fail-closed. (i) `resultStore.tombstoneTest` FIRST (the durable
   * `ResultId` guarantee), THEN (ii) `testStore.delete`. Both are idempotent; if (i) succeeds and (ii)
   * fails the promise rejects, the reservation STAYS and a retry completes. Each configured step is
   * performed; only "neither store" is `StoreNotConfiguredError` (§5.5, R15 Q3).
   */
  defineAsync('deleteTest', async (testId) => {
    if (!stores.test && !stores.result) throw new StoreNotConfiguredError({ store: 'testStore' });
    const id = captureTestId(testId);
    if (stores.result) await stores.result.tombstoneTest(id);
    if (stores.test) await stores.test.delete(id);
  });

  // ==============================================================================================
  // Run methods (P7.4)
  // ==============================================================================================

  /**
   * §18 `startRun(defOrRef, runOptions?) → RunHandle`. SYNCHRONOUS and throwing (R1): every refusal —
   * `InvalidTestDefinitionError{issues}` / `UnsupportedSchemaVersionError`, `StoreNotConfiguredError`
   * (a reference with no testStore, §5.5), `InvalidOptionsError{issues}`, `ResultCapacityError`,
   * `RunQueueFullError`, `EngineDisposedError` — is thrown before a handle exists, and none leaves a
   * slot or a map entry behind (validation and options come BEFORE the reservation; `admitAndBegin`
   * rolls its own reservation back). Once admitted, a handle is always returned; a stored reference
   * can then only fail asynchronously, sealed by P6 with one planning gap (§5.5).
   */
  function startRun(input, runOptions) {
    // (1) Discriminate through P2 (§5.3 scope rule (ii), R21-I3), then capture-and-validate the argument
    //     in THIS turn. A non-reference goes through P2's full pass, which also reports an uncapturable
    //     argument (and the schemaVersion gate) with the complete, bounded issue list.
    const kind = classifyStartRunArgument(input, { limits: effectiveLimits }).kind;
    const checked = kind === 'reference'
      ? validateReference(input, { limits: effectiveLimits })
      : captureAndValidate(input, { limits: effectiveLimits });
    if (checked.issues.length > 0) throw toDefinitionError(checked);
    if (checked.captured === null) throw new TypeError('startRun: validation produced no captured value');   // engine bug guard
    if (kind === 'reference') requireStore('testStore');   // §5.5 "Missing stores": thrown, before slot admission

    // (2) Resolve the options against the RESOLVED engine limits (N31). The frozen result is itself the
    //     detached copy of the caller's options object (§13.6).
    const options = resolveRunOptions(runOptions, effectiveLimits);

    // (3) Admission (reserve → queue limit → createRun → ownRuns → begin, with exact rollback).
    return admitAndBegin({
      source: { kind: kind === 'reference' ? 'reference' : 'definition', value: checked.captured },
      options,
      resolver: runResolver,
      // no `derivedFromRunId`: buildRunSpec writes `null`. Only `rerun` passes one (P7.7).
    });
  }

  /**
   * §18 `getRun(runId) → RunHandle | null`: this engine's run while it holds a slot — queued, active, or
   * terminal with its set still resident — else `null` (never throws for an unknown id, §13.5.2). A
   * terminal entry that no longer holds a slot is pruned here too.
   */
  function getRun(runId) {
    if (typeof runId !== 'string') return null;
    const own = ownRuns.get(runId);
    if (own === undefined) return null;
    if (holdsSlot(runId)) return own.handle;
    if (own.handle.getSnapshot().phase === 'terminal') ownRuns.delete(runId);
    return null;
  }

  /**
   * The by-id read path (§13.5.2), resident FIRST (R-P7-9): the resident set if there is one (and the
   * read refreshes its LRU position, "refreshed by getResultSet"); otherwise a read-through of the
   * result store under a read slot, WITHOUT making the set resident. A stored set is untrusted
   * (§13.6 R12-3): it is fetched under the byte guard, then captured, validated and deep-frozen by
   * P5's `readResultSet` (`CorruptResultSetError` / `ResultSetTooLargeError` reject). Resolves `null`
   * when neither holds it (or there is no store). `runId` is passed as the diagnostic id only; it is
   * never read off the untrusted value. P7.6/P7.7 build their by-id reads on this helper.
   */
  async function readSetById(runId) {
    const resident = residency.getResident(runId);
    if (resident !== null) return resident;
    if (!stores.result) return null;
    return withReadSlot(() => readStoredSet(runId));
  }

  /**
   * One store read-through, for a caller that ALREADY holds a read slot: `get` under the byte guard,
   * then P5's `readResultSet` (capture → version → migrate → validate → freeze). `null` when the store
   * holds no such set. `runId` is the diagnostic id only, never read off the untrusted value.
   */
  async function readStoredSet(runId) {
    const raw = await stores.result.get(runId, { maxBytes: effectiveLimits.maxStoredResultBytes });
    if (raw === null || raw === undefined) return null;
    return readResultSet(raw, { limits: effectiveLimits, slicer: newSlicer(), runId });
  }

  defineSync('startRun', startRun);
  defineSync('getRun', getRun);
  defineAsync('getResultSet', (runId) => (typeof runId === 'string' ? readSetById(runId) : null));

  // ==============================================================================================
  // Residency, retention and lifecycle (P7.5; §13.5.1, §13.5.2)
  // ==============================================================================================
  //
  // P5's residency manager owns every rule (classes, LRU, one-shot leases, the persistence attempt
  // machine, "a set whose put is in flight keeps its slot until that write settles"); these methods
  // add only the R1 gate, the §13.5.2 "the engine drops its own references on release" (every path
  // that can drop a resident set prunes `ownRuns`), and the argument checks of the two DESTRUCTIVE
  // calls. Sync vs async follows §18/A8: retain/release/getPersistenceState/retentionReport throw,
  // discardRun/retryPersist reject.

  /**
   * `releaseResultSet`'s options, read ONCE (a getter cannot answer the check and the release
   * differently): `undefined`, or a plain object whose only key is `acknowledgeUnsaved`, a boolean.
   * Only a literal `true` acknowledges — dropping a `held` set may drop the only copy (§13.5.2), so a
   * truthy non-boolean is refused rather than read as consent.
   * @throws {InvalidOptionsError}
   */
  function readReleaseOptions(options) {
    if (options === undefined) return { acknowledgeUnsaved: false };
    if (!isPlainRecord(options)) {
      throw new InvalidOptionsError({ issues: [issue('/', 'bad-shape', 'options must be an object')] });
    }
    const issues = [];
    for (const key of Object.keys(options)) {
      if (key !== 'acknowledgeUnsaved') {
        issues.push(issue(`/${key.slice(0, 64).replace(/~/g, '~0').replace(/\//g, '~1')}`, 'unknown-key', 'unknown key'));
      }
    }
    const acknowledgeUnsaved = options.acknowledgeUnsaved;
    if (acknowledgeUnsaved !== undefined && typeof acknowledgeUnsaved !== 'boolean') {
      issues.push(issue('/acknowledgeUnsaved', 'bad-shape', 'acknowledgeUnsaved must be a boolean'));
    }
    if (issues.length > 0) throw new InvalidOptionsError({ issues });
    return { acknowledgeUnsaved: acknowledgeUnsaved === true };
  }

  defineSync('getPersistenceState', (runId) => residency.getPersistenceState(runId));   // null when nonresident
  defineSync('retainResultSet', (runId) => residency.retainResultSet(runId));
  defineSync('releaseResultSet', (runId, options) => {
    residency.releaseResultSet(runId, readReleaseOptions(options));
    pruneOwnRuns();
  });
  defineAsync('retryPersist', (runId) => residency.retryPersist(runId));
  /** A non-string id is never a runId, so it never reaches `resultStore.delete` (it rejects instead). */
  defineAsync('discardRun', async (runId) => {
    if (typeof runId !== 'string') {
      throw new InvalidOptionsError({ issues: [issue('runId', 'bad-shape', 'runId must be a string')] });
    }
    await residency.discardRun(runId);
    pruneOwnRuns();
  });

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
  // Result-read methods (P7.6): freshness, the two claim methods, the placement call
  // ==============================================================================================
  //
  // P6's `getFreshness` owns §16.4 and P5's `claim.js` owns §8.3 (including the digest-version
  // conjunct); these methods own only the ENTRY rules (`withReadSet`) and the binding to this
  // engine's registry and enumerator. They add no claim rule of their own.

  /**
   * The resident set for `runId`, WITHOUT refreshing its LRU position, else `null`. §13.5.2 names
   * `getResultSet` as the one read that refreshes a set ("LRU by seal time, refreshed by
   * getResultSet"); a claim or freshness read is a check, not a use, and a host that polls it (a
   * staleness badge) must not pin whatever it looked at last — the reason P5's `retentionReport`
   * never touches either. `getPersistenceState` is P5's non-touching residency test; a resident set
   * always has its `ownRuns` entry (pruning requires the slot to be gone), which `runResidency`
   * filled at admission. The `getResident` fallback (it touches) is unreachable by that invariant.
   */
  function peekResident(runId) {
    if (residency.getPersistenceState(runId) === null) return null;
    return ownRuns.get(runId)?.sealedSet ?? residency.getResident(runId);
  }

  /**
   * The ONE entry path of every `runIdOrResultSet` read (§18): `getFreshness`, `canClaimNoClashes`,
   * `assessNoClashClaim`, and (P7.7) `rerun`. Returns a Promise that NEVER throws synchronously:
   * everything that can refuse in the synchronous prefix becomes a rejection. `fn(set)` receives a
   * validated, deep-frozen set, or `null` for a by-id miss (the caller decides what a miss means).
   *
   *   by id (a string) — resident FIRST (non-touching, `peekResident`; no store and no slot needed),
   *     else a store read-through under a read slot taken from the FIFO (`acquire` is called in this
   *     turn, so queue order is call order; `ReadCapacityError` beyond `maxQueuedStoreReads`), else
   *     `fn(null)` (no store, or the store holds none).
   *   raw set (anything else) — §13.6 capture first: a read slot is RESERVED synchronously (raw sets
   *     are never queued: `ReadCapacityError` at once), then P5's `captureResultSet` takes the one
   *     detached copy in this same turn, before the returned Promise's first `await`, so a caller's
   *     later mutation cannot reach it. `readResultSet` then validates and freezes that copy.
   *
   * A slot, once held, is kept until `fn` settles (its freshness passes included) and released on
   * every exit.
   */
  function withReadSet(input, fn) {
    try {
      alive();
      if (typeof input === 'string') return readByIdFor(input, fn);
      const slot = reads.reserveSync();
      let detached;
      try {
        detached = captureResultSet(input, { limits: effectiveLimits });
      } catch (err) {
        slot.release();
        throw err;
      }
      return (async () => {
        try {
          return await fn(await readResultSet(detached, { limits: effectiveLimits, slicer: newSlicer() }));
        } finally {
          slot.release();
        }
      })();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** `withReadSet`'s by-id half. Runs synchronously up to `reads.acquire()` inside `withReadSlot`. */
  async function readByIdFor(runId, fn) {
    const resident = peekResident(runId);
    if (resident !== null) return fn(resident);
    if (!stores.result) return fn(null);
    return withReadSlot(async () => fn(await readStoredSet(runId)));
  }

  /** A by-id miss has no freshness to compute and no claim to judge (§13.5.2 nonresident table): a
   *  `false`/`unverifiable` answer would be indistinguishable from a real negative. */
  const requireSet = (input, set) => {
    if (set === null) throw new ResultNotResidentError({ runId: input });
    return set;
  };

  /** §16.4, against the live registry of this world and this engine's enumerator: P6's frozen
   *  `Freshness` object `{state, reasons}`, never reduced to its state (R3, N19). */
  const liveFreshness = (set) => readTimeFreshness(set, { registry: coordinator.registry, enumerator });

  defineAsync('getFreshness', (input) => withReadSet(input, (set) => liveFreshness(requireSet(input, set))));
  // Both claim methods recompute freshness and hand P5 the Freshness OBJECT straight through, so a
  // `stale`/`unverifiable` refusal carries §16.4's reasons as qualifiers. `canClaimNoClashes` is true
  // only when the assessment is `unqualified` (P5).
  defineAsync('canClaimNoClashes', (input) => withReadSet(input, async (set) => {
    const checked = requireSet(input, set);
    return canClaim(checked, await liveFreshness(checked));
  }));
  defineAsync('assessNoClashClaim', (input) => withReadSet(input, async (set) => {
    const checked = requireSet(input, set);
    return assessClaim(checked, await liveFreshness(checked));
  }));

  /** §16.2's recommended single call: P1 bumps `placementGeneration`, then invalidates the world's placement. */
  defineSync('invalidateModelPlacement', (modelKey) => { coordinator.registry.invalidateModelPlacement(modelKey); });

  // ==============================================================================================
  // rerun / listResults (P7.7)
  // ==============================================================================================

  // Every §18 name a later task has not implemented yet is a gated stub: it honours the R1 disposal
  // contract today and fails loudly, rather than silently doing nothing, until its task lands.
  for (const name of ENGINE_METHODS.sync) if (!(name in methods)) defineSync(name, () => { throw notImplemented(name); });
  for (const name of ENGINE_METHODS.async) if (!(name in methods)) defineAsync(name, () => { throw notImplemented(name); });

  const engine = Object.freeze({ registry: coordinator.registry, ...methods, dispose });

  return {
    engine,
    // `residency` is the port the runs seal into (`runResidency`: P5's manager plus the `sealedSet`
    // record); every P5 method on it is P5's own function.
    internals: {
      engineId, effectiveLimits, hierarchyInternalAcceptance: acceptance, libraryVersion,
      stores, executor, definitions, coordinator, residency: runResidency, reads, ownRuns, newSlicer,
      buildRunSpec, admitAndBegin, runResolver, readSetById, withReadSet,
    },
  };
}

// ================================================================================================
// 3. The public factory
// ================================================================================================

export function createClashTestEngine(config = {}) {
  return createEngineCore(config).engine;
}
