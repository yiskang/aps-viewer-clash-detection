// test/clashtest/engine/rerun.test.mjs
//
// Task P7.7: `engine.rerun(runIdOrResultSet, {definitionRevision?, runOptions?}) → Promise<RunHandle>`
// (spec §15.3, §13.6, §18, AC-11 "rerun contract (R21-1)").
//
// Deviations from the brief's excerpt, each pinned where it applies (preflight scan / rulings):
//   - Fixtures: every arm that needs a COMPLETED clean base runs on the P7 engine world
//     (support/engineWorld.mjs, scan S3 / R-P7-2) with P6's scripted executor (owner item D-4).
//     `corruptSet` / `futureSchemaSet` / `validSetClone` / `slowDef` are built here from a real sealed
//     set (a queued-then-cancelled run is the brief's "seals before resolution").
//   - `rerun` = `withReadSet(input, fn)` + `admitAndBegin` (scan rows P7.4⇄P7.7, P7.6⇄P7.7): one read
//     prefix, one admission sequence, ONE `buildRunSpec` input shape.
//   - Spec §13.6 predicate (ii) (controller ruling R-P7-21): a set read BY ID for `rerun` whose result,
//     ledger-record or retained-diagnostic count exceeds the rerun's effective `maxResultsPerRun` /
//     `maxLedgerRecords` / `maxRetainedDiagnostics` rejects `ResultSetTooLargeError` (never
//     `CorruptResultSetError`); a RAW set is not covered by the predicate ("read by-id"), and neither is
//     `getFreshness` (spec erratum A16: predicate (ii) is a `rerun`-only admission check).
//   - `runOptions` issues are reported under `/runOptions/...`, because `rerun`'s option bag has two
//     members and `/zzz` would not say which one was wrong.
//
// C-P7-3: nothing here reads `testIdOfInput`. G-EC: nothing reads or asserts
// `provenance.models[].elementCount` (sets are compared through their digests/definition only).
// G-CAL: no §17.1 default is written as a literal (limits are named, non-default test constants);
// time is a fake clock and timers never fire (`scheduleTimeout` seam); no wall-clock assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import {
  CorruptResultSetError, EngineDisposedError, InvalidOptionsError, ReadCapacityError, ResultCapacityError,
  ResultNotResidentError, ResultSetTooLargeError, RunQueueFullError, StoreNotConfiguredError,
  UnsupportedSchemaVersionError,
} from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { SCHEMA_VERSION } from '../../../clashtest/results/resultSet.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';

/** Named, NON-default limits (G-CAL). */
const SINGLE_SLOT = 1;
const SLOT_CAP = 3;
const NO_QUEUE = 0;
/** Small run options for predicate (ii): each is below what the base set below carries. */
const FEW_RESULTS = 1;
const NO_DIAGNOSTICS = 0;
const TINY_UNITS = 1;
const TINY_PLAN_REFERENCES = 1;
const TINY_LEDGER = TINY_PLAN_REFERENCES + 2 * TINY_UNITS;       // the §17.1.1 cross-field minimum

// ---- helpers --------------------------------------------------------------------------------------

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const clean = () => createScriptedExecutor({}, { unscripted: { facts: [] } });

/**
 * A scripted executor whose positives are LEDGER-CONSISTENT and deterministic: one volume-overlap
 * pair per source root of the unit, against the first root of its first target (every root of the
 * fixtures below owns exactly itself). The numeric `pairs: n` form of the scripted executor draws
 * fresh dbIds from a module counter, so its sets neither read back (owners outside `rootOwners`)
 * nor repeat across runs; this one does both. `extra` is merged into every unit's descriptor.
 */
function pairingExecutor(rootsOf, extra = {}) {
  return (request) => {
    const { sourceModelKey } = request.unit;
    const target = request.materialized.targets[0];
    const targetDbId = target.dbIds?.[0] ?? rootsOf[target.modelKey][0];
    const pairs = request.materialized.sourceDbIds.map((dbId) => ({
      source: { modelKey: sourceModelKey, dbId },
      target: { modelKey: target.modelKey, dbId: targetDbId },
      type: 'volume-overlap',
      witness: null,
    }));
    return createScriptedExecutor({}, { unscripted: { facts: [], pairs, ...extra } })(request);
  };
}

/** An executor that parks every unit until `release()`; `started` resolves when the first unit arrives. */
function gatedExecutor() {
  const inner = clean();
  let markStarted;
  let open;
  const started = new Promise((r) => { markStarted = r; });
  const gate = new Promise((r) => { open = r; });
  const executor = async (request) => { markStarted(); await gate; return inner(request); };
  return Object.assign(executor, { started, release: () => open() });
}

function base(extra = {}, worldOptions = {}) {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  return createEngineWorld(worldOptions).config({
    unitExecutor: clean(),
    now: clock.now,
    yieldToScheduler: clock.yieldToScheduler,
    scheduleTimeout: () => () => {},
    ...extra,
  });
}

const cleanDef = (over = {}) => makeDefinition({ testId: 'T', ...over });

/** The canonical-JSON STRING of a set's content: equal before and after proves the set was never mutated. */
const fingerprint = (set) => JSON.stringify(set);

/** A pre-resolution sealed set (`definition: null`): a queued run cancelled before it resolves. */
async function preResolutionSet(extra = {}) {
  const unitExecutor = gatedExecutor();
  const engine = createClashTestEngine(base({ unitExecutor, ...extra }));
  const inFlight = engine.startRun(cleanDef());
  await unitExecutor.started;
  const queued = engine.startRun(cleanDef());
  const { resultSet } = await queued.cancel();
  inFlight.cancel();
  unitExecutor.release();
  await inFlight.done;
  return { engine, resultSet };
}

// ================================================================================================
// The happy path and lineage
// ================================================================================================

test('rerun resolves to a live handle only after capture, validation AND admission', async () => {
  const engine = createClashTestEngine(base());
  const base0 = await engine.startRun(cleanDef()).done;
  const before = fingerprint(base0.resultSet);
  const p = engine.rerun(base0.runId, {});
  assert.ok(p instanceof Promise);
  const h = await p;
  assert.notEqual(h.runId, base0.runId);
  assert.equal(engine.getRun(h.runId), h, 'the rerun is an owned run of this engine');
  const s = await h.done;
  assert.equal(s.status, 'completed');
  assert.equal(s.resultSet.derivedFromRunId, base0.runId);
  assert.equal(s.resultSet.testRef.semanticDigest, base0.resultSet.testRef.semanticDigest);
  assert.deepEqual(s.resultSet.definition, base0.resultSet.definition);
  assert.equal(fingerprint(base0.resultSet), before, 'the base set is never mutated (§15.3)');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('rerun lineage survives the RunSpec: the sealed set carries the BASE runId, startRun seals null', async () => {
  const engine = createClashTestEngine(base());
  const first = await engine.startRun(cleanDef()).done;
  assert.equal(first.resultSet.derivedFromRunId, null, 'a run that derives from nothing seals null');

  const second = await (await engine.rerun(first.runId, {})).done;
  assert.equal(second.resultSet.derivedFromRunId, first.runId);

  // A rerun OF a rerun names its immediate base, not the root of the chain.
  const third = await (await engine.rerun(second.resultSet, {})).done;
  assert.equal(third.resultSet.derivedFromRunId, second.runId);

  // Lineage is a record, not a liveness claim: discarding the base does not retract it.
  engine.releaseResultSet(second.runId, { acknowledgeUnsaved: true });
  assert.equal(engine.getRun(second.runId), null);
  assert.equal(third.resultSet.derivedFromRunId, second.runId);
});

test('options are optional: rerun(x) with no option bag runs the embedded definition', async () => {
  const engine = createClashTestEngine(base());
  const first = await engine.startRun(cleanDef()).done;
  const s = await (await engine.rerun(first.resultSet)).done;
  assert.equal(s.resultSet.derivedFromRunId, first.runId);
  assert.equal(s.resultSet.testRef.semanticDigest, first.resultSet.testRef.semanticDigest);
});

test('§15.1: a deterministic, non-environment-sensitive rerun reproduces the pair set and ledger digests', async () => {
  const engine = createClashTestEngine(base({ unitExecutor: pairingExecutor({ mA: [1, 2], mB: [10] }) }));
  const first = await engine.startRun(cleanDef()).done;
  assert.equal(first.resultSet.provenance.determinismClass, 'deterministic');
  assert.equal(first.resultSet.outcome.environmentSensitive, false);
  assert.ok(first.resultSet.results.length > 0, 'control: the base has results to reproduce');
  const again = await (await engine.rerun(first.runId, {})).done;
  assert.equal(again.resultSet.outcome.environmentSensitive, false);
  assert.equal(again.resultSet.digests.pairSetDigest, first.resultSet.digests.pairSetDigest);
  assert.equal(again.resultSet.digests.ledgerDigest, first.resultSet.digests.ledgerDigest);
});

test('the rerun runs under ITS runOptions, not the base set\'s recorded ones', async () => {
  const engine = createClashTestEngine(base());
  const first = await engine.startRun(cleanDef(), { broadPhase: 'linear' }).done;
  assert.equal(first.resultSet.provenance.broadPhase, 'linear');
  const s = await (await engine.rerun(first.runId, { runOptions: { broadPhase: 'tlas' } })).done;
  assert.equal(s.resultSet.provenance.broadPhase, 'tlas');
});

// ================================================================================================
// Every failure REJECTS (R21-1) and leaves nothing behind
// ================================================================================================

test('every failure class REJECTS and leaves no run, no queue entry and no held slot', async () => {
  const cfg = base({ limits: { maxResidentResultSets: SLOT_CAP } });
  const { engine, internals } = createEngineCore(cfg);
  const good = (await engine.startRun(cleanDef()).done).resultSet;
  const corrupt = structuredClone(good);
  corrupt.ledger.pairSpaceTotal += 1;                               // digest/linkage no longer hold
  const cyclic = structuredClone(good);
  cyclic.ledger.self = cyclic;
  const future = { ...structuredClone(good), schemaVersion: SCHEMA_VERSION + 1 };
  const slotsBefore = engine.retentionReport().slotsInUse;
  const runsBefore = internals.ownRuns.size;

  const isIssue = (path, code) => (e) => e instanceof InvalidOptionsError
    && e.issues.some((i) => i.path === path && i.code === code);
  for (const [label, input, opts, check] of [
    ['corrupt set', corrupt, {}, CorruptResultSetError],
    ['cyclic set', cyclic, {}, CorruptResultSetError],
    ['not a set', 42, {}, CorruptResultSetError],
    ['future schema', future, {}, UnsupportedSchemaVersionError],
    ['unknown run option', structuredClone(good), { runOptions: { zzz: 1 } }, isIssue('/runOptions/zzz', 'unknown-key')],
    ['bad run option value', structuredClone(good), { runOptions: { broadPhase: 'bvh' } }, isIssue('/runOptions/broadPhase', 'bad-enum')],
    ['unknown option-bag key', structuredClone(good), { zzz: 1 }, isIssue('/zzz', 'unknown-key')],
    ['option bag not an object', structuredClone(good), 7, isIssue('', 'bad-shape')],
    ['fractional definitionRevision', structuredClone(good), { definitionRevision: 1.5 }, isIssue('/definitionRevision', 'not-an-integer')],
    ['zero definitionRevision', structuredClone(good), { definitionRevision: 0 }, isIssue('/definitionRevision', 'below-minimum')],
    ['unknown runId', 'no-such-run', {}, ResultNotResidentError],
  ]) {
    let p;
    assert.doesNotThrow(() => { p = engine.rerun(input, opts); }, `${label}: never a synchronous throw`);
    assert.ok(p instanceof Promise, label);
    await assert.rejects(p, check, label);
    assert.equal(engine.retentionReport().slotsInUse, slotsBefore, `${label}: no run slot held`);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, `${label}: no read slot held`);
    assert.equal(internals.ownRuns.size, runsBefore, `${label}: no run exists`);
    assert.equal(internals.coordinator.queueDepth(internals.engineId), 0, `${label}: nothing queued`);
  }
});

test('an option-bag getter is never invoked, and is refused', async () => {
  const engine = createClashTestEngine(base());
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  let invoked = 0;
  const opts = { get runOptions() { invoked += 1; return {}; } };
  await assert.rejects(engine.rerun(set, opts),
    (e) => e instanceof InvalidOptionsError && e.issues.some((i) => i.path === '/runOptions' && i.code === 'bad-shape'));
  assert.equal(invoked, 0);
});

test('a definitionRevision with no testStore rejects StoreNotConfiguredError before any read', async () => {
  const engine = createClashTestEngine(base({ testStore: null }));
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  const p = engine.rerun(set, { definitionRevision: 1 });
  assert.equal(engine.retentionReport().readSlotsInUse, 0, 'refused before the read slot is reserved');
  await assert.rejects(p, (e) => e instanceof StoreNotConfiguredError && e.store === 'testStore');
});

test('a ResultCapacityError at admission rejects the rerun promise (it does not throw)', async () => {
  const engine = createClashTestEngine(base({ resultStore: null, limits: { maxResidentResultSets: SINGLE_SLOT } }));
  const first = await engine.startRun(cleanDef()).done;
  let p;
  assert.doesNotThrow(() => { p = engine.rerun(first.resultSet, {}); });
  assert.ok(p instanceof Promise);
  await assert.rejects(p, ResultCapacityError);
  assert.equal(engine.retentionReport().slotsInUse, 1, 'only the base holds a slot');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a RunQueueFullError at admission rejects and returns the reserved run slot', async () => {
  const unitExecutor = gatedExecutor();
  const { engine, internals } = createEngineCore(base({
    unitExecutor, limits: { maxResidentResultSets: SLOT_CAP, maxQueuedRuns: NO_QUEUE },
  }));
  const first = await createClashTestEngine(base()).startRun(cleanDef()).done;   // a base from elsewhere
  const inFlight = engine.startRun(cleanDef());
  await unitExecutor.started;
  const slots = engine.retentionReport().slotsInUse;
  await assert.rejects(engine.rerun(first.resultSet, {}), RunQueueFullError);
  assert.equal(engine.retentionReport().slotsInUse, slots, 'the reservation was rolled back');
  assert.equal(internals.ownRuns.size, 1);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  inFlight.cancel();
  unitExecutor.release();
  await inFlight.done;
});

test('a raw-set rerun while every read slot is busy rejects ReadCapacityError at once (never queued)', async () => {
  const cfg = base();
  const engine = createClashTestEngine(cfg);
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  // Hold the one read slot with a raw freshness read parked inside the enumerator.
  const hold = deferred();
  const entered = deferred();
  const inner = cfg.enumerator.digestScope;
  cfg.enumerator.digestScope = async (...args) => { entered.resolve(); await hold.promise; return inner(...args); };
  const busy = engine.getFreshness(structuredClone(set));
  await entered.promise;
  await assert.rejects(engine.rerun(structuredClone(set), {}), ReadCapacityError);
  hold.resolve();
  await busy;
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('after dispose() rerun rejects EngineDisposedError; a dispose during the read rejects and starts no run', async () => {
  const store = createInMemoryResultStore();
  const gate = deferred();
  const entered = deferred();
  const gatedStore = {
    ...store,
    async get(...args) { entered.resolve(); await gate.promise; return store.get(...args); },
  };
  const { engine, internals } = createEngineCore(base({ resultStore: gatedStore }));
  const first = await engine.startRun(cleanDef()).done;
  engine.releaseResultSet(first.runId);                         // saved: now only the store holds it
  const pending = engine.rerun(first.runId, {});
  await entered.promise;
  const disposing = engine.dispose();
  gate.resolve();
  await assert.rejects(pending, EngineDisposedError);
  await disposing;
  assert.equal(internals.ownRuns.size, 0);
  let p;
  assert.doesNotThrow(() => { p = engine.rerun(first.runId, {}); });
  await assert.rejects(p, EngineDisposedError);
});

// ================================================================================================
// §13.6 capture first
// ================================================================================================

test('capture is synchronous: a caller mutating the raw set right after the call gets the control run', async () => {
  const engine = createClashTestEngine(base());
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  const mutable = structuredClone(set);
  const opts = { runOptions: { broadPhase: 'linear' } };
  const p = engine.rerun(mutable, opts);
  mutable.definition.selectionA = [];            // synchronous, post-call
  opts.runOptions.broadPhase = 'tlas';           // the options object is captured in the same step
  opts.definitionRevision = 1;
  const s = await (await p).done;
  assert.equal(s.resultSet.provenance.broadPhase, 'linear');
  assert.deepEqual(s.resultSet.definition, set.definition);
  assert.equal(s.resultSet.testRef.semanticDigest, set.testRef.semanticDigest);
});

// ================================================================================================
// definitionRevision and the pre-resolution base
// ================================================================================================

test('a pre-resolution set has nothing to rerun without a definitionRevision', async () => {
  const { engine, resultSet } = await preResolutionSet();
  assert.equal(resultSet.definition, null);
  const p = engine.rerun(resultSet, {});
  assert.ok(p instanceof Promise);
  await assert.rejects(p, (e) => e instanceof InvalidOptionsError
    && e.reason === 'no-embedded-definition'
    && e.issues.length === 1 && e.issues[0].code === 'no-embedded-definition'
    && e.issues[0].path === '/definitionRevision');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  await engine.saveTest(cleanDef({ testId: resultSet.testRef.testId, revision: 1 }));
  const h2 = await engine.rerun(resultSet, { definitionRevision: 1 });   // stored-reference lookup
  const s = await h2.done;
  assert.equal(s.status, 'completed');
  assert.equal(s.resultSet.testRef.revision, 1);
  assert.equal(s.resultSet.derivedFromRunId, resultSet.runId);
});

test('definitionRevision reruns the base test at THAT stored revision (a newer definition)', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(cleanDef({ revision: 1 }));
  const first = await engine.startRun({ testId: 'T', revision: 1 }).done;
  await engine.saveTest(cleanDef({ revision: 2, name: 'second' }));
  const s = await (await engine.rerun(first.runId, { definitionRevision: 2 })).done;
  assert.equal(s.resultSet.testRef.testId, 'T');
  assert.equal(s.resultSet.testRef.revision, 2);
  assert.equal(s.resultSet.definition.name, 'second');
  assert.equal(s.resultSet.derivedFromRunId, first.runId);
  assert.equal(first.resultSet.definition.name, makeDefinition().name, 'the base is untouched');
});

test('§5.5 NH3: an embedded-definition rerun of a DELETED test seals test-unavailable without planning', async () => {
  const unitExecutor = clean();
  const cfg = base({ unitExecutor });
  // Spies on every path by which a run could reach the library: the executor (the effective
  // findClashes-call proxy here, since a scripted executor never touches the world), the world's own
  // recorded `findClashes` calls (zero by construction under a scripted executor; kept as the literal
  // AC-11(a) wording and live if the executor is ever swapped), and the planner's enumerator.
  const enumeratorCalls = [];
  for (const method of ['resolveRoots', 'digestScope']) {
    const inner = cfg.enumerator[method].bind(cfg.enumerator);
    cfg.enumerator[method] = (...args) => { enumeratorCalls.push(method); return inner(...args); };
  }
  const engine = createClashTestEngine(cfg);
  await engine.saveTest(cleanDef());
  const first = await engine.startRun(cleanDef()).done;
  assert.ok(unitExecutor.requests.length > 0, 'the base run did execute units (the spy is live)');
  assert.ok(enumeratorCalls.length > 0, 'the base run did enumerate (the spy is live)');
  const executed = unitExecutor.requests.length;
  const findClashesCalls = cfg.world.calls.length;
  const enumerated = enumeratorCalls.length;
  await engine.deleteTest('T');
  const s = await (await engine.rerun(first.resultSet, {})).done;
  // AC-11(a): zero `findClashes` calls, and no planning, for a rerun that seals test-unavailable.
  assert.equal(unitExecutor.requests.length, executed, 'the rerun issued no unit to the executor');
  assert.equal(cfg.world.calls.length, findClashesCalls, 'the rerun made zero findClashes calls');
  assert.equal(enumeratorCalls.length, enumerated, 'the rerun did not plan (no enumeration)');
  assert.equal(s.status, 'failed');
  assert.deepEqual(s.resultSet.ledger.planningGaps.map((g) => g.cause), ['test-unavailable']);
  assert.equal(s.resultSet.derivedFromRunId, first.runId);
});

// ================================================================================================
// By-id reads: resident first, then a read-through that never makes the base resident
// ================================================================================================

test('a by-id rerun of a saved, released base reads it through the store and leaves it nonresident', async () => {
  const engine = createClashTestEngine(base());
  const first = await engine.startRun(cleanDef()).done;
  engine.releaseResultSet(first.runId);                         // saved: the store holds the only copy
  assert.equal(engine.getPersistenceState(first.runId), null);
  const s = await (await engine.rerun(first.runId, {})).done;
  assert.equal(s.resultSet.derivedFromRunId, first.runId);
  assert.equal(s.resultSet.testRef.semanticDigest, first.resultSet.testRef.semanticDigest);
  assert.equal(engine.getPersistenceState(first.runId), null, 'the base did not become resident');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

test('a by-id rerun of a stored set that fails validation rejects CorruptResultSetError', async () => {
  const store = createInMemoryResultStore();
  const good = (await createClashTestEngine(base()).startRun(cleanDef()).done).resultSet;
  const tampered = structuredClone(good);
  tampered.ledger.pairSpaceTotal += 1;
  const engine = createClashTestEngine(base({
    resultStore: { ...store, get: async (runId) => (runId === good.runId ? structuredClone(tampered) : null) },
  }));
  await assert.rejects(engine.rerun(good.runId, {}), CorruptResultSetError);
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
});

// ================================================================================================
// Spec §13.6 predicate (ii): a valid set read BY ID for rerun beyond the rerun's effective counts
// ================================================================================================

/** A completed base with one result per mA root, a retained diagnostic and 4 unit records (4 single-fragment roots). */
async function largeBase(extra = {}) {
  const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
  const modelSpecs = [
    { modelKey: 'mA', roots: [1, 2, 3, 4].map((dbId, i) => ({ dbId, owners: [dbId], fragments: [frag(i, dbId)] })) },
    { modelKey: 'mB', roots: [{ dbId: 10, owners: [10], fragments: [frag(9, 10)] }] },
  ];
  const unitExecutor = pairingExecutor({ mA: [1, 2, 3, 4], mB: [10] }, {
    diagnostics: [{ reason: 'fragment-bounds-empty', modelKey: 'mA', dbId: 1 }],
  });
  const { engine, internals } = createEngineCore(base({ unitExecutor, ...extra }, { modelSpecs }));
  const def = cleanDef({ selectionA: { entries: [{ kind: 'model', modelKey: 'mA' }] } });
  const summary = await engine.startRun(def, { maxSourceFragmentsPerUnit: 1 }).done;
  return { engine, internals, set: summary.resultSet };
}

test('predicate (ii): a by-id rerun of a valid set over the rerun\'s count options rejects ResultSetTooLargeError', async () => {
  const { engine, set } = await largeBase();
  assert.equal(set.outcome.status, 'completed');
  assert.ok(set.results.length > FEW_RESULTS, 'fixture: more results than FEW_RESULTS');
  assert.ok(set.diagnostics.diagnostics.length > NO_DIAGNOSTICS, 'fixture: a retained diagnostic');
  assert.ok(set.ledger.units.length > TINY_LEDGER, 'fixture: more unit records than TINY_LEDGER');
  const tiny = { maxUnitsPerRun: TINY_UNITS, maxPlanReferences: TINY_PLAN_REFERENCES, maxLedgerRecords: TINY_LEDGER };

  for (const [label, runOptions] of [
    ['results', { maxResultsPerRun: FEW_RESULTS }],
    ['retained diagnostics', { maxRetainedDiagnostics: NO_DIAGNOSTICS }],
    ['ledger records', tiny],
  ]) {
    // Resident base, by id.
    await assert.rejects(engine.rerun(set.runId, { runOptions }),
      (e) => e instanceof ResultSetTooLargeError && !(e instanceof CorruptResultSetError) && e.runId === set.runId,
      `${label}: resident`);
    assert.equal(engine.retentionReport().readSlotsInUse, 0, label);
  }
  // Control: the same by-id rerun under the base's own (default) counts is admitted.
  const ok = await engine.rerun(set.runId, {});
  assert.equal((await ok.done).resultSet.derivedFromRunId, set.runId);
});

test('predicate (ii) also governs the store read-through, and never marks the set corrupt', async () => {
  const { engine, set } = await largeBase();
  engine.releaseResultSet(set.runId);                           // saved: read-through only
  const slots = engine.retentionReport().slotsInUse;
  await assert.rejects(engine.rerun(set.runId, { runOptions: { maxResultsPerRun: FEW_RESULTS } }),
    (e) => e instanceof ResultSetTooLargeError && e.runId === set.runId);
  assert.equal(engine.retentionReport().slotsInUse, slots, 'no run slot reserved');
  assert.equal(engine.retentionReport().readSlotsInUse, 0);
  // The same set is still READABLE through getResultSet: valid, not corrupt (§13.6 R13-5b).
  const read = await engine.getResultSet(set.runId);
  assert.equal(read.digests.pairSetDigest, set.digests.pairSetDigest);
});

test('predicate (ii) is by-id only: a RAW set over the same counts is admitted (spec §13.6 "read by-id")', async () => {
  const { engine, set } = await largeBase();
  const h = await engine.rerun(structuredClone(set), { runOptions: { maxResultsPerRun: FEW_RESULTS } });
  const s = await h.done;
  assert.equal(s.resultSet.derivedFromRunId, set.runId);
  // …and getFreshness by id is not governed by it either (spec erratum A16: (ii) is a `rerun`-only admission check; see sizePredicate.contract.test.mjs).
  assert.equal((await engine.getFreshness(set.runId)).state, 'current');
});

test('predicate (ii) boundary: counts EQUAL to the rerun\'s options are admitted, one below each is refused', async () => {
  const { engine, set } = await largeBase();
  // The ledger-record count predicate (ii) uses: unit records plus per-unit taint entries (a sound
  // lower bound of the producer's §6.5.1 budget count; see engine.js `assertRerunReadable`).
  const ledgerRecords = set.ledger.units.reduce((n, u) => n + 1 + u.taints.length, 0);
  const results = set.results.length;
  const diagnostics = set.diagnostics.diagnostics.length;
  const tiny = { maxUnitsPerRun: TINY_UNITS, maxPlanReferences: TINY_PLAN_REFERENCES };
  assert.ok(ledgerRecords - 1 >= TINY_LEDGER, 'fixture: one below the count still passes option validation');
  const exact = { ...tiny, maxResultsPerRun: results, maxRetainedDiagnostics: diagnostics, maxLedgerRecords: ledgerRecords };
  const admitted = await engine.rerun(set.runId, { runOptions: exact });
  assert.equal((await admitted.done).resultSet.derivedFromRunId, set.runId);
  for (const [label, key, value] of [
    ['results', 'maxResultsPerRun', results - 1],
    ['retained diagnostics', 'maxRetainedDiagnostics', diagnostics - 1],
    ['ledger records', 'maxLedgerRecords', ledgerRecords - 1],
  ]) {
    await assert.rejects(engine.rerun(set.runId, { runOptions: { ...exact, [key]: value } }), ResultSetTooLargeError, label);
  }
});
