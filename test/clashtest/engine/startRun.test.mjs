// test/clashtest/engine/startRun.test.mjs
//
// Task P7.4: the run surface — `startRun` (both overloads, the SYNCHRONOUS error contract, exact
// rollback), `getRun`, `getResultSet`, and the per-engine stored-definition resolver
// (`createStoredDefinitionResolver` / `withStoredDefinitionValidator`, internal named exports of
// `clashtest/engine.js`, never re-exported from `clashtest/index.js`).
//
// Deviations from the brief's excerpt, each pinned where it applies:
//   - RESOLUTION_PHASE (below): the sealed pre-resolution gap row carries the phase P6 actually
//     records, `'binding'` — P6's accepted `resolveStage` stages `setPhase('binding')` BEFORE it calls
//     `resolveDefinition()` (clashtest/run/Run.js, resolveStage), and `settlePlanning` writes
//     `{phase: run.phase, cause}`. The brief wrote `'queued'` (the run STATUS the spec's §8.2 row
//     names); the spec fixes no gap-phase value, so the shipped P6 value wins (scan general rule).
//   - `releaseResultSet` / `getPersistenceState` are P7.5's public methods; these tests reach the
//     residency manager through `createEngineCore(...).internals` instead.
//   - The options test uses capturable bad values (scan A2 P7.4(a)); the non-finite variant is kept
//     separately with the two `bad-shape` paths P0's capture actually reports.
//   - `findClashes` is never called by the scripted executor these tests use (engineWorld.mjs), so
//     "no collision execution" is asserted on the EXECUTOR's own call log, with a control run proving
//     that log is non-empty for a run that does execute.
//
// C-P7-3: nothing here reads `testIdOfInput` as a function. G-EC: nothing reads or asserts
// `provenance.models[].elementCount`. G-CAL: no §17.1 default is written as a literal (limits below
// are named, non-default test constants; defaults are imported); time is a fake clock and timers never
// fire (`scheduleTimeout` seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClashTestEngine, createEngineCore, createStoredDefinitionResolver, withStoredDefinitionValidator,
} from '../../../clashtest/engine.js';
import {
  InvalidTestDefinitionError, InvalidOptionsError, UnsupportedSchemaVersionError, ResultCapacityError,
  RunQueueFullError, EngineDisposedError, StoreNotConfiguredError, CorruptResultSetError,
} from '../../../clashtest/errors.js';
import { resolveEngineLimits, ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
import { captureAndValidate } from '../../../clashtest/definition/validate.js';
import { PLANNING_CAUSES } from '../../../clashtest/planning/ElementEnumerator.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createInMemoryClashTestStore } from '../../../clashtest/stores/InMemoryClashTestStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

/** The phase P6 records on a gap sealed while the definition is being resolved (see header). */
const RESOLUTION_PHASE = 'binding';
/** Named, NON-default limits (G-CAL): a one-slot engine, and a three-slot engine whose queue is lowered. */
const SINGLE_SLOT = 1;
const SLOT_CAP = 3;
const LOW_QUEUE = 1;
const LOW_VALIDATION_ISSUES = 5;

// ---- helpers --------------------------------------------------------------------------------------

/** `assert.throws` returns nothing; this returns the thrown error after asserting its type. */
function thrownBy(fn, Type) {
  let caught;
  assert.throws(() => { try { fn(); } catch (err) { caught = err; throw err; } }, Type);
  return caught;
}

/** A recording scripted executor (every unit evaluates clean); `.calls` lists the unitIds it ran. */
function recordingExecutor() {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  const calls = [];
  const executor = (request) => { calls.push(request.unit.unitId); return inner(request); };
  executor.calls = calls;
  return executor;
}

/** An executor that parks every unit until `release()`; `started` resolves when the first unit arrives. */
function gatedExecutor() {
  const inner = createScriptedExecutor({}, { unscripted: { facts: [] } });
  let markStarted;
  let open;
  const started = new Promise((r) => { markStarted = r; });
  const gate = new Promise((r) => { open = r; });
  const calls = [];
  const executor = async (request) => {
    calls.push(request.unit.unitId);
    markStarted();
    await gate;
    return inner(request);
  };
  Object.assign(executor, { calls, started, release: () => open() });
  return executor;
}

/**
 * The engine config every test starts from: the P7 engine world (registered mA/mB, synthetic
 * enumerator with a `calls` log, execution world with a `calls` log), a recording executor, a fake
 * clock, and a timer seam that never fires. `extra` overrides any key.
 */
function base(extra = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  return createEngineWorld().config({
    unitExecutor: recordingExecutor(),
    now: clock.now,
    yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {},
    ...extra,
  });
}

const validDef = (over = {}) => makeDefinition({ testId: 'T', ...over });

/** A ClashTestStore double whose `resolveForRun` answers `live` with exactly `definition` (untrusted). */
function storeReturning(definition, { status = 'live' } = {}) {
  return {
    resolveForRun: async () => ({ status, definition, latestRevision: definition?.revision ?? null }),
    isTombstoned: async () => false,
  };
}

/**
 * `deepFind(tree, pred)`: true iff any KEY or STRING/NUMBER value of a plain object/array tree
 * satisfies `pred(key, value)`. A substring search over `JSON.stringify` is NOT a legal substitute
 * (a timestamp, runId or digest can legitimately contain any short needle).
 */
function deepFind(tree, pred) {
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    for (const [k, v] of Object.entries(node)) {
      if (pred(Array.isArray(node) ? null : k, v)) return true;   // array indices are not keys
      stack.push(v);
    }
  }
  return false;
}

const SENTINEL = 'zz-offending-value-9f3a1c-must-never-be-persisted';
// Field-level issue detail is exactly these key names (`message` is too generic for a whole tree;
// the sharper guarantee is the closed `{phase, cause}` row check).
const ISSUE_KEYS = new Set(['path', 'code', 'issues', 'issuesTruncated']);

// ================================================================================================
// The synchronous error contract
// ================================================================================================

test('startRun throws InvalidTestDefinitionError SYNCHRONOUSLY for a bad reference-shaped argument', () => {
  const core = createEngineCore(base());
  const err = thrownBy(() => core.engine.startRun({ testId: 42 }), InvalidTestDefinitionError);
  assert.ok(Array.isArray(err.issues) && err.issues.length > 0);
  assert.equal(core.engine.retentionReport().slotsInUse, 0, 'no slot leaked on the throw');
  assert.equal(core.internals.ownRuns.size, 0);
});

test('startRun throws InvalidTestDefinitionError synchronously for a bad direct definition, listing its issues', () => {
  const engine = createClashTestEngine(base());
  const err = thrownBy(() => engine.startRun(validDef({ selectionA: { entries: [] }, mode: 'nope' })),
    InvalidTestDefinitionError);
  assert.deepEqual(err.issues.map((i) => i.path).sort(), ['/mode', '/selectionA/entries']);
  assert.equal(engine.retentionReport().slotsInUse, 0);
});

test('a non-object argument is InvalidTestDefinitionError, thrown, never a rejected promise', () => {
  const engine = createClashTestEngine(base());
  for (const bad of [null, undefined, 'T', 7, [validDef()]]) {
    thrownBy(() => engine.startRun(bad), InvalidTestDefinitionError);
  }
  assert.equal(engine.retentionReport().slotsInUse, 0);
});

test('a direct definition above the engine schemaVersion throws UnsupportedSchemaVersionError synchronously', () => {
  const engine = createClashTestEngine(base());
  const err = thrownBy(() => engine.startRun(validDef({ schemaVersion: 99 })), UnsupportedSchemaVersionError);
  assert.equal(err.type, 'ClashTestDefinition');
  assert.equal(err.schemaVersion, 99, 'the offending version is reported, not dropped');
  assert.equal(engine.retentionReport().slotsInUse, 0);
});

test('startRun throws InvalidOptionsError synchronously and lists every issue', () => {
  const engine = createClashTestEngine(base());
  const err = thrownBy(
    () => engine.startRun(validDef(), { maxUnitsPerRun: 1.5, progressMinIntervalMs: -1, zzz: 1 }),
    InvalidOptionsError,
  );
  assert.deepEqual(err.issues.map((i) => i.path).sort(), ['/maxUnitsPerRun', '/progressMinIntervalMs', '/zzz']);
  // Non-finite numbers fail P0's CAPTURE step, which reports them as `bad-shape` and stops there (scan A2).
  const nonFinite = thrownBy(
    () => engine.startRun(validDef(), { maxUnitsPerRun: Infinity, progressMinIntervalMs: NaN }),
    InvalidOptionsError,
  );
  assert.deepEqual(nonFinite.issues.map((i) => [i.path, i.code]).sort(),
    [['/maxUnitsPerRun', 'bad-shape'], ['/progressMinIntervalMs', 'bad-shape']]);
  assert.equal(engine.retentionReport().slotsInUse, 0, 'options are resolved BEFORE the slot is reserved');
});

test('a stored reference is the two-field shape and an unknown extra key makes it a definition', () => {
  const engine = createClashTestEngine(base());
  // {testId, revision} → reference; {testId, revision, bogus} → definition (§5.3 scope rule (ii))
  const h = engine.startRun({ testId: 'T', revision: 1 });
  assert.equal(typeof h.runId, 'string');
  thrownBy(() => engine.startRun({ testId: 'T', revision: 1, bogus: true }), InvalidTestDefinitionError);
  // A reference-shaped argument with a bad field is a bad REFERENCE, still thrown synchronously.
  const bad = thrownBy(() => engine.startRun({ testId: 'T', revision: 1.5 }), InvalidTestDefinitionError);
  assert.deepEqual(bad.issues.map((i) => i.path), ['/revision']);
  h.cancel();
});

test('a stored reference with no testStore throws StoreNotConfiguredError synchronously, before slot admission', async () => {
  const engine = createClashTestEngine(base({ testStore: null }));
  const err = thrownBy(() => engine.startRun({ testId: 'T' }), StoreNotConfiguredError);
  assert.equal(err.store, 'testStore');
  assert.equal(engine.retentionReport().slotsInUse, 0);
  // A direct definition is unaffected (§5.5 "Missing stores").
  const summary = await engine.startRun(validDef()).done;
  assert.equal(summary.status, 'completed');
});

test('startRun THROWS EngineDisposedError after dispose (it never returns a rejected promise)', async () => {
  const engine = createClashTestEngine(base());
  await engine.dispose();
  thrownBy(() => engine.startRun(validDef()), EngineDisposedError);
  thrownBy(() => engine.startRun({ testId: 'T' }), EngineDisposedError);
});

test('startRun returns the RunHandle synchronously; the run then completes through the engine stack', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const h = engine.startRun(validDef());
  assert.equal(typeof h.then, 'undefined', 'a handle, not a promise');
  assert.equal(engine.getRun(h.runId), h);
  const summary = await h.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.definition.testId, 'T');
  assert.equal(summary.resultSet.derivedFromRunId, null, 'startRun never records a lineage');
  assert.ok(cfg.unitExecutor.calls.length > 0, 'control: this run DID execute units');
});

// ================================================================================================
// Admission: residency slots and the engine's queue limit
// ================================================================================================

test('admission refusal is synchronous and never queues', async () => {
  const core = createEngineCore(base({ resultStore: null, limits: { maxResidentResultSets: SINGLE_SLOT } }));
  const { engine } = core;
  const first = engine.startRun(validDef());
  await first.done;                                        // seals HELD (no store ⇒ never evictable)
  const err = thrownBy(() => engine.startRun(validDef()), ResultCapacityError);
  assert.equal(err.cap, SINGLE_SLOT);
  assert.deepEqual(err.held.map((h) => h.runId), [first.runId]);
  assert.equal(core.internals.ownRuns.size, 1, 'the refused call left no run behind');
  core.internals.residency.releaseResultSet(first.runId, { acknowledgeUnsaved: true });   // P7.5's method
  assert.ok(engine.startRun(validDef()));                 // slot freed
});

test('an explicitly lower maxQueuedRuns refuses with RunQueueFullError, counting waiting runs only', async () => {
  // Slot capacity 3, queue capacity 1: the QUEUE is the binding constraint (R-P7-13).
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({
    unitExecutor, resultStore: null, limits: { maxResidentResultSets: SLOT_CAP, maxQueuedRuns: LOW_QUEUE },
  }));
  const inFlight = engine.startRun(validDef());            // occupies the coordinator's ONE in-flight slot
  await unitExecutor.started;
  const waiting = engine.startRun(validDef());             // queue depth 1
  const err = thrownBy(() => engine.startRun(validDef()), RunQueueFullError);
  assert.equal(err.limit, LOW_QUEUE);
  assert.equal(err.queued, 1, 'the in-flight run is NOT counted');
  assert.equal(engine.retentionReport().slotsInUse, 2, 'the refused call rolled its reservation back');
  for (let i = 0; i < 5; i += 1) thrownBy(() => engine.startRun(validDef()), RunQueueFullError);
  assert.equal(engine.retentionReport().slotsInUse, 2, 'five refusals, zero drift');
  waiting.cancel();
  inFlight.cancel();
  unitExecutor.release();
  await Promise.all([inFlight.done, waiting.done]);
});

test('cancelling a QUEUED run settles done with a pre-resolution cancelled set (R5)', async () => {
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({ unitExecutor, resultStore: null }));
  const inFlight = engine.startRun(validDef());
  await unitExecutor.started;
  const queued = engine.startRun(validDef());              // never reaches the head of the queue
  const summary = await queued.cancel();
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.definition, null, 'cancelled BEFORE resolution');
  assert.equal(summary.resultSet.testRef.semanticDigest, null);
  assert.equal(summary.resultSet.ledger.planExists, false);
  assert.equal(await queued.done, summary, '`done` settles, it does not hang');
  inFlight.cancel();
  unitExecutor.release();
  await inFlight.done;
});

// ================================================================================================
// Stored-reference resolution
// ================================================================================================

test('a live stored reference resolves, plans and executes; no revision means the latest', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  await engine.saveTest(validDef({ revision: 1 }));
  await engine.saveTest(validDef({ revision: 2, name: 'second' }));
  const latest = await engine.startRun({ testId: 'T' }).done;
  assert.equal(latest.status, 'completed');
  assert.equal(latest.resultSet.testRef.testId, 'T');
  assert.equal(latest.resultSet.testRef.revision, 2);
  assert.match(latest.resultSet.testRef.semanticDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(latest.resultSet.definition.name, 'second');
  assert.ok(Object.isFrozen(latest.resultSet.definition));
  const pinned = await engine.startRun({ testId: 'T', revision: 1 }).done;
  assert.equal(pinned.resultSet.testRef.revision, 1);
  // Control arm for every zero-call assertion below: a resolvable reference DOES plan and execute.
  assert.ok(cfg.enumerator.calls.length > 0, 'control: planning enumerated');
  assert.ok(cfg.unitExecutor.calls.length > 0, 'control: units executed');
});

test('an archived stored reference fails ASYNCHRONOUSLY after a successful admission', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ revision: 1 }));
  await engine.archiveTest('T');
  const h = engine.startRun({ testId: 'T' });              // handle IS returned
  const summary = await h.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.definition, null);
  assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause: 'test-unavailable' }]);
  assert.deepEqual(summary.resultSet.testRef, { testId: 'T', revision: null, semanticDigest: null });
});

test('a store answer for a DIFFERENT test or revision is unusable: test-unavailable, never executed', async () => {
  for (const [label, stored, reference] of [
    ['other testId', validDef({ testId: 'OTHER' }), { testId: 'T' }],
    ['other revision', validDef({ revision: 3 }), { testId: 'T', revision: 1 }],
  ]) {
    const cfg = base({ testStore: storeReturning(stored) });
    const summary = await createClashTestEngine(cfg).startRun(reference).done;
    assert.equal(summary.status, 'failed', label);
    assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause: 'test-unavailable' }], label);
    assert.equal(cfg.unitExecutor.calls.length, 0, label);
  }
});

test('a rejecting, throwing or malformed store lookup fails closed as test-unavailable', async () => {
  for (const [label, resolveForRun] of [
    ['rejects', async () => { throw new Error('store down'); }],
    ['throws synchronously', () => { throw new Error('store down'); }],
    ['answers null', async () => null],
    ['answers an unknown status', async () => ({ status: 'toString', definition: validDef(), latestRevision: 1 })],
  ]) {
    const cfg = base({ testStore: { resolveForRun, isTombstoned: async () => false } });
    const summary = await createClashTestEngine(cfg).startRun({ testId: 'T' }).done;
    assert.equal(summary.status, 'failed', label);
    assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause: 'test-unavailable' }], label);
    assert.equal(cfg.enumerator.calls.length, 0, label);
  }
});

// ---- Step 3a: store-returned definitions are untrusted (AC-16, owner disposition A1) ---------------

test('deepFind sees nested keys and values, including inside arrays (so the scans below can fail)', () => {
  assert.equal(deepFind({ a: [{ b: { code: 'x' } }] }, (k) => ISSUE_KEYS.has(k)), true);
  assert.equal(deepFind({ a: [[1, SENTINEL]] }, (k, v) => v === SENTINEL), true);
  assert.equal(deepFind({ a: [{ b: 'fine' }], n: 1 }, (k, v) => ISSUE_KEYS.has(k) || v === SENTINEL), false);
});

test('a store-returned definition that fails validation seals failed with definition: null and no offending value', async () => {
  const observed = [];
  for (const [label, stored, cause] of [
    // `migration-failed` has NO reachable input while DEFINITION_SCHEMA_VERSION === 1 (owner-accepted,
    // non-blocking deferral; no migration seam is added to reach it).
    ['fails validateTest', validDef({ name: SENTINEL, selectionA: { entries: [] } }), 'definition-invalid'],
    ['schemaVersion above the engine', validDef({ schemaVersion: 99, name: SENTINEL }), 'schema-unsupported'],
    // Boundary (P2 V2 / S-P2-3): a non-newer, non-`1` version is `invalid-schema-version`, so it is
    // `definition-invalid` — never `migration-failed` (the older-version window [1, 1) is empty).
    ['schemaVersion 0 is an invalid version, not an older one', validDef({ schemaVersion: 0, name: SENTINEL }), 'definition-invalid'],
  ]) {
    const resultStore = createInMemoryResultStore();
    const cfg = base({ testStore: storeReturning(stored), resultStore });
    const engine = createClashTestEngine(cfg);
    const handle = engine.startRun({ testId: 'T' });        // admission already succeeded: a handle EXISTS
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', label);

    // (a) the EXACT sealed gap — the whole array, so a schema failure that ALSO recorded
    //     `definition-invalid` cannot pass.
    assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause }], label);
    observed.push(cause);

    // (b) FAIL CLOSED before planning or execution
    assert.equal(cfg.enumerator.calls.length, 0, `${label}: no planning — resolveRoots/digestScope never called`);
    assert.equal(cfg.unitExecutor.calls.length, 0, `${label}: no unit ever executed`);
    assert.equal(cfg.world.calls.length, 0, `${label}: no collision execution`);
    assert.equal(summary.resultSet.ledger.planExists, false, `${label}: no plan was ever built`);
    assert.deepEqual(summary.resultSet.ledger.units, [], `${label}: no unit ever existed`);

    // (c) the pre-resolution seal of §13.1
    assert.equal(summary.resultSet.definition, null, label);
    assert.equal(summary.resultSet.testRef.semanticDigest, null, label);
    assert.equal(summary.resultSet.testRef.testId, 'T', `${label}: only the caller's testId is recorded`);
    assert.equal(engine.getRun(summary.runId).runId, summary.runId, `${label}: the admitted slot is an ordinary resident set`);

    // (d) neither the offending value nor field-level issue detail — sealed OR persisted (A1). The
    //     durable copy is proven to exist first, so the scan cannot pass vacuously.
    assert.equal(summary.persistence.state, 'saved', `${label}: the failed set's write succeeded`);
    const persisted = await resultStore.get(summary.runId);
    assert.notEqual(persisted, null, `${label}: a durable copy exists to scan`);
    for (const [where, set] of [['sealed', summary.resultSet], ['persisted', persisted]]) {
      assert.equal(deepFind(set, (k, v) => v === SENTINEL), false, `${label}/${where}: offending value present`);
      assert.equal(deepFind(set, (k) => ISSUE_KEYS.has(k)), false, `${label}/${where}: field-level issue detail present`);
      for (const g of set.ledger.planningGaps) {
        assert.deepEqual(Object.keys(g).sort(), ['cause', 'phase'], `${label}/${where}: PlanningGap widened`);
      }
    }
  }
  // The reachable causes are mutually distinguishable (asserted over what the arms PRODUCED)…
  assert.deepEqual([...new Set(observed)].sort(), ['definition-invalid', 'schema-unsupported']);
  assert.ok(observed.every((c) => PLANNING_CAUSES.includes(c)), 'every produced cause is in P3\'s closed enum');
  // …and the reserved member stays a real, distinct enum row with no reachable producer in this build.
  assert.ok(PLANNING_CAUSES.includes('migration-failed'));
});

test('the engine resolver hands its RESOLVED maxValidationIssues to the definition validator', async () => {
  const limits = resolveEngineLimits({ maxValidationIssues: LOW_VALIDATION_ISSUES });
  const seen = [];
  const validate = (def, opts) => { seen.push(opts); return captureAndValidate(def, opts); };
  const resolver = createStoredDefinitionResolver({ testStore: storeReturning(validDef()), limits, validate });
  const resolved = await resolver.resolveDefinition({ testId: 'T' });
  assert.equal(resolved.testRef.testId, 'T');
  assert.equal(seen.length, 1, 'the resolver validated the store-returned definition exactly once');
  assert.equal(seen[0].limits.maxValidationIssues, LOW_VALIDATION_ISSUES, 'the RESOLVED limit, not the default');
  assert.notEqual(seen[0].limits.maxValidationIssues, ENGINE_LIMIT_DEFAULTS.maxValidationIssues);
  assert.equal(seen[0].limits, limits, 'the very resolved-limits object, not a re-derived one');
});

test('a stored definition with vastly more invalid entries than maxValidationIssues is bounded at the resolver and fails closed', async () => {
  // 1,000 < the maxEntriesPerSelection default ON PURPOSE: over that cap V4 emits one structural
  // `too-many-entries` and never reads the entries, which would prove nothing about the issue bound.
  const entries = Array.from({ length: 1000 }, () => ({ kind: 'nope', modelKey: SENTINEL }));
  assert.ok(entries.length < ENGINE_LIMIT_DEFAULTS.maxEntriesPerSelection);
  const stored = () => validDef({ selectionA: { entries } });

  // (i) the factory with the REAL validator and the RESOLVED limits
  const limits = resolveEngineLimits({ maxValidationIssues: LOW_VALIDATION_ISSUES });
  const resolver = createStoredDefinitionResolver({ testStore: storeReturning(stored()), limits });
  const err = await resolver.resolveDefinition({ testId: 'T' }).then(() => null, (e) => e);
  assert.ok(err instanceof InvalidTestDefinitionError);
  assert.equal(err.issues.length, LOW_VALIDATION_ISSUES);
  assert.equal(err.issuesTruncated, true);
  const cause = resolver.planningCauseOf(err);
  assert.equal(cause, 'definition-invalid');
  assert.equal(typeof cause, 'string', 'a bare enum member crosses into P6: no issues, paths or values');

  // (ii) the engine end to end: the exact sealed gap, still no sentinel, no issue detail
  const summary = await createClashTestEngine(base({
    limits: { maxValidationIssues: LOW_VALIDATION_ISSUES }, testStore: storeReturning(stored()),
  })).startRun({ testId: 'T' }).done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause: 'definition-invalid' }]);
  assert.equal(deepFind(summary.resultSet, (k, v) => v === SENTINEL), false);
  assert.equal(deepFind(summary.resultSet, (k) => ISSUE_KEYS.has(k)), false);
});

test('createClashTestEngine builds its stored-definition resolver with the engine effectiveLimits', async () => {
  const entries = Array.from({ length: 1000 }, () => ({ kind: 'nope', modelKey: SENTINEL }));
  const seen = [];
  const validate = (def, opts) => { seen.push(opts); return captureAndValidate(def, opts); };
  const engine = withStoredDefinitionValidator(validate, () => createClashTestEngine(base({
    limits: { maxValidationIssues: LOW_VALIDATION_ISSUES },
    testStore: storeReturning(validDef({ selectionA: { entries } })),
  })));
  // The override is captured AT CONSTRUCTION: this run starts after it was restored, and still reaches the spy.
  const summary = await engine.startRun({ testId: 'T' }).done;
  assert.equal(seen.length, 1, 'the engine resolved and validated the stored definition exactly once');
  assert.equal(seen[0].limits.maxValidationIssues, LOW_VALIDATION_ISSUES, "the engine's RESOLVED limit reached the validator");
  assert.notEqual(seen[0].limits.maxValidationIssues, ENGINE_LIMIT_DEFAULTS.maxValidationIssues);
  assert.deepEqual(seen[0].limits, resolveEngineLimits({ maxValidationIssues: LOW_VALIDATION_ISSUES }),
    'the FULL resolved set, not a one-field literal');
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: RESOLUTION_PHASE, cause: 'definition-invalid' }]);
});

test('withStoredDefinitionValidator restores the previous validator even when fn throws, and scopes to construction', async () => {
  const seen = [];
  const validate = (def, opts) => { seen.push(opts); return captureAndValidate(def, opts); };
  assert.throws(() => withStoredDefinitionValidator(validate, () => { throw new Error('boom'); }), /boom/);
  // Built OUTSIDE the helper: the default P2 validator, never the spy.
  const summary = await createClashTestEngine(base({ testStore: storeReturning(validDef()) }))
    .startRun({ testId: 'T' }).done;
  assert.equal(summary.status, 'completed');
  assert.equal(seen.length, 0);
});

test('planningCauseOf maps every resolution and planning error to a PLANNING_CAUSES member, failing closed', () => {
  const { planningCauseOf } = createStoredDefinitionResolver({
    testStore: storeReturning(validDef()), limits: resolveEngineLimits(),
  });
  const named = (name) => Object.assign(new Error(name), { name });
  const cases = [
    [new InvalidTestDefinitionError({ issues: [] }), 'definition-invalid'],
    [new UnsupportedSchemaVersionError({ type: 'ClashTestDefinition', schemaVersion: 2, supported: 1 }), 'schema-unsupported'],
    [named('WorldDisposedError'), 'world-disposed'],
    [named('ModelEvictedError'), 'model-not-bound'],
    [named('ObjectTreeUnavailableError'), 'enumeration-failed'],
    [new Error('anything else'), 'enumeration-failed'],
    [null, 'enumeration-failed'],
    ['a string', 'enumeration-failed'],
  ];
  for (const [err, cause] of cases) {
    assert.equal(planningCauseOf(err), cause, String(err?.name ?? err));
    assert.ok(PLANNING_CAUSES.includes(planningCauseOf(err)));
  }
  // A hostile error object (throwing accessors) never escapes the mapping.
  const hostile = new Proxy({}, { get() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); } });
  assert.equal(planningCauseOf(hostile), 'enumeration-failed');
});

// ================================================================================================
// getRun
// ================================================================================================

test('getRun returns the handle while active and while terminal-but-resident, and null once nonresident', async () => {
  const core = createEngineCore(base());
  const { engine } = core;
  const h = engine.startRun(validDef());
  const { runId } = h;
  assert.equal(engine.getRun(runId), h, 'active: the very handle startRun returned');
  await h.done;
  assert.equal(engine.getRun(runId), h, 'terminal and resident');
  core.internals.residency.releaseResultSet(runId);        // saved ⇒ releasable (P7.5 owns the public method)
  assert.equal(engine.getRun(runId), null);
  assert.equal(core.internals.ownRuns.has(runId), false, 'the nonresident entry was pruned');
  assert.equal(core.internals.residency.getPersistenceState(runId), null);
});

test('getRun is null for an unknown or non-string id, and never throws', () => {
  const engine = createClashTestEngine(base());
  for (const id of ['no-such-run', '', undefined, null, 42, {}]) assert.equal(engine.getRun(id), null);
});

test('getRun is null for a run another engine on the same world owns', async () => {
  const world = createEngineWorld();
  const cfg = { scheduleTimeout: () => () => {} };
  const a = createClashTestEngine(world.config(cfg));
  const b = createClashTestEngine(world.config(cfg));
  const h = a.startRun(world.definition());
  assert.equal(b.getRun(h.runId), null);
  await h.done;
});

test('admission prunes terminal, nonresident runs, so the engine keeps no unbounded run history', async () => {
  const core = createEngineCore(base());
  const { engine } = core;
  const first = engine.startRun(validDef());
  await first.done;
  core.internals.residency.releaseResultSet(first.runId);
  const second = engine.startRun(validDef());                // no getRun call in between
  assert.deepEqual([...core.internals.ownRuns.keys()], [second.runId]);
  await second.done;
});

// ================================================================================================
// getResultSet
// ================================================================================================

test('getResultSet returns the RESIDENT set first, and needs no store for it', async () => {
  const engine = createClashTestEngine(base({ resultStore: null }));
  const h = engine.startRun(validDef());
  const summary = await h.done;
  const set = await engine.getResultSet(h.runId);
  assert.equal(set, summary.resultSet, 'the resident copy itself');
  assert.ok(Object.isFrozen(set));
});

test('getResultSet reads through without making the set resident', async () => {
  const resultStore = createInMemoryResultStore();
  const core = createEngineCore(base({ resultStore, limits: { maxResidentResultSets: SINGLE_SLOT } }));
  const { engine } = core;
  const h = engine.startRun(validDef());
  const { runId } = h;
  const summary = await h.done;
  await h.persisted;
  core.internals.residency.releaseResultSet(runId);
  assert.equal(engine.retentionReport().slotsInUse, 0);
  const set = await engine.getResultSet(runId);
  assert.equal(set.runId, runId);
  assert.notEqual(set, summary.resultSet, 'a validated copy read from the store');
  assert.deepEqual(set, summary.resultSet);
  assert.ok(Object.isFrozen(set));
  assert.equal(engine.retentionReport().slotsInUse, 0, 'read-through, not cached');
  assert.equal(engine.getRun(runId), null, 'still nonresident');
  assert.equal(engine.retentionReport().readSlotsInUse, 0, 'the read slot was released');
});

test('getResultSet resolves null when nothing holds the set (no store, or a store without it)', async () => {
  assert.equal(await createClashTestEngine(base({ resultStore: null })).getResultSet('nope'), null);
  assert.equal(await createClashTestEngine(base()).getResultSet('nope'), null);
  assert.equal(await createClashTestEngine(base()).getResultSet(42), null);
});

test('a read-through holds a read slot while the store read is in flight', async () => {
  let answer;
  const resultStore = { ...createInMemoryResultStore(), get: () => new Promise((r) => { answer = r; }) };
  const engine = createClashTestEngine(base({ resultStore }));
  const pending = engine.getResultSet('some-run');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(engine.retentionReport().readSlotsInUse, 1);
  answer(null);
  assert.equal(await pending, null);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a stored set is untrusted: a corrupt one REJECTS CorruptResultSetError and the slot is released', async () => {
  const resultStore = { ...createInMemoryResultStore(), get: async () => ({ schemaVersion: 1, runId: 'r', bogus: SENTINEL }) };
  const engine = createClashTestEngine(base({ resultStore }));
  const p = engine.getResultSet('r');                       // never throws synchronously
  await assert.rejects(p, CorruptResultSetError);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('getResultSet REJECTS EngineDisposedError after dispose', async () => {
  const engine = createClashTestEngine(base());
  await engine.dispose();
  await assert.rejects(engine.getResultSet('x'), EngineDisposedError);
  thrownBy(() => engine.getRun('x'), EngineDisposedError);
});

test('a direct run reads the tombstone through the TEST store with the definition testId (§5.5 layer 2)', async () => {
  const asked = [];
  const testStore = createInMemoryClashTestStore();
  const isTombstoned = testStore.isTombstoned;
  testStore.isTombstoned = (id) => { asked.push(id); return isTombstoned(id); };
  const summary = await createClashTestEngine(base({ testStore })).startRun(validDef({ testId: 'direct-T' })).done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(asked, ['direct-T']);
});
