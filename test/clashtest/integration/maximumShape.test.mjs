// test/clashtest/integration/maximumShape.test.mjs
//
// Task P7.9 — AC-12 MAXIMUM-SHAPE round trip (produce → persist → evict → read → validate → rerun) at
// CONFIGURABLE ceilings, the §13.6 producer/reader arithmetic, and the reader-limit boundaries. The
// AC-12(a) slicing STRUCTURE of every engine-observable sliced span lives in the sibling
// maximumShape.slicing.test.mjs (split out only so the two halves run in parallel under `npm test`).
//
// Deviations from the brief's excerpt (preflight scan rows for P7.9; controller rulings):
//   - (a) "evict" is never vacuous. The brief's `resultStore.put` + `releaseResultSet` evicts nothing
//     (the set was never resident). Here a set is made RESIDENT first and then evicted by a REAL run
//     needing its slot (P5 LRU, `maxResidentResultSets: 1`), witnessed by `getPersistenceState` going
//     `saved` → `null` while the store read-through still returns it:
//       * the ENGINE-PRODUCED leg: a real engine run seals and persists the set, `getRun` is the run's
//         handle before and `null` after the eviction;
//       * the MAXIMUM-SHAPE legs: `maximumShapeSet` is admitted and persisted through the engine's own
//         residency port exactly as Run.js's finalize does (`reserveRunSlot` → `admitSealedSet` →
//         `beginPersist`, `createEngineCore().internals`, R-P7-11), because no scripted run can seal
//         a set of an arbitrary ledger/diagnostic shape. `getRun` is not asserted there: that set was
//         never an owned run, so `null` would be vacuous.
//   - (b) `maximumShapeSet` is built through P5 `buildResultSet` + `sealResultSet` over the
//     resultSetFixtures.mjs row helpers (support/maximumShape.mjs), so its digests are P5's own.
//   - (c) / R-P7-8: the plan's span labels (`plan`, `merge`, `digest`, `seal`, `validate-result-set`)
//     do not exist, and Run.js builds its slicer WITHOUT the engine's `spanRecorder`, so run-internal
//     spans never reach it. The asserted labels are the ones the ENGINE's recorder can observe: the
//     read path (`validate:shape|cross-field|linkage|order|digest`, `freeze`) and definition
//     preparation (`normalize`, `semanticDigest`). No wall-clock budget is asserted anywhere
//     (not even `frameBudgetMs`, which is not a §17.1 key in options.js at all); durations are
//     RECORDED (emitted as `[AC-12]` diagnostics when `CLASHTEST_AC12_LOG` is set) and compared to nothing.
//   - (d) G-CAL: every §17.1 value is imported (`RUN_OPTION_DEFAULTS`, `RUN_OPTION_CEILINGS`,
//     `ENGINE_LIMIT_DEFAULTS`, `ENGINE_LIMIT_CEILINGS`); non-default test values are named constants.
//   - Tiers: `scaled` runs in the committed suite; the `ledger` / `results` tiers (default: a fifth of the
//     provisional `maxLedgerRecords`, and `maxResultsPerRun` itself) take ~20 s each and are opt-in:
//     `CLASHTEST_AC12_TIERS=all` (or a tier name list), or any `CLASHTEST_MAX_*` override.
//   - Step 5's "set above SCHEMA_MAX_NODES" cannot be allocated in a unit test (~2.6e8 nodes); the
//     corrupt/too-large dividing line is pinned through P5's pure `nodeCeilingError` at the engine's
//     own ceiling instead (its doc comment: "testable without allocating a 16-million-node object").
//
// C-P7-3: no RunSpec is built here. G-EC: `provenance.models[].elementCount` is never read or asserted
// (sets are compared by canonical content / digests). Time: a fake clock or a read-only real clock for
// RECORDED spans; yields go through the fake scheduler and `scheduleTimeout` never fires — no real timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_OPTION_DEFAULTS, RUN_OPTION_CEILINGS, ENGINE_LIMIT_DEFAULTS, ENGINE_LIMIT_CEILINGS, SCHEMA_MAX_NODES,
  BYTES_PER_NODE, worstCaseCapturedNodes, producerReaderIssues, resolveRunOptions, resolveEngineLimits,
} from '../../../clashtest/options.js';
import { createClashTestEngine, createEngineCore } from '../../../clashtest/engine.js';
import { CorruptResultSetError, InvalidOptionsError, ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { validateResultSet, nodeCeilingError } from '../../../clashtest/results/validateResultSet.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';
import { isDeepFrozen } from '../../../clashtest/util/capture.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import {
  maximumShapeSet, measuredNodes, ledgerRecordsOf, PROVISIONAL_SHAPES, tenthOf, runOptionsFor, engineLimitsFor,
  SHAPE_MODEL_A, SHAPE_MODEL_B, recordAc12, summarizeSpans,
} from '../support/maximumShape.mjs';

// ---- named NON-default test values (G-CAL) --------------------------------------------------------------

const SINGLE_SLOT = 1;
/** A byte guard below any maximum-shape set's serialized size. */
const TINY_STORED_BYTES = 1_024;
/** The boundary tests probe limits, not size: a hundredth of the scaled tier keeps them fast. */
const BOUNDARY_SHAPE = tenthOf(tenthOf(PROVISIONAL_SHAPES.scaled));
/** Large enough (> the formula's 65,536-node slack) that some run options fit a reader one node short of it. */
const READER_LIMIT_SHAPE = Object.freeze({ ...PROVISIONAL_SHAPES.scaled, ledgerRecordCount: PROVISIONAL_SHAPES.scaled.resultCount });
/** Rerun options a ~1e5-node reader can honour (the §17.1.1 cross-field minimum for the ledger). */
const FEW_RESULTS = 1;
const NO_DIAGNOSTICS = 0;
const TINY_UNITS = 1;
const TINY_PLAN_REFERENCES = 1;
const TINY_RUN_OPTIONS = Object.freeze({
  maxResultsPerRun: FEW_RESULTS, maxRetainedDiagnostics: NO_DIAGNOSTICS, maxUnitsPerRun: TINY_UNITS, maxPlanReferences: TINY_PLAN_REFERENCES,
  maxLedgerRecords: TINY_PLAN_REFERENCES + 2 * TINY_UNITS,
});

const EPOCH = Date.UTC(2026, 8, 24);

// ---- tiers ----------------------------------------------------------------------------------------------

function activeTiers() {
  const wanted = (process.env.CLASHTEST_AC12_TIERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const overridden = ['CLASHTEST_MAX_LEDGER', 'CLASHTEST_MAX_RESULTS', 'CLASHTEST_MAX_DIAGNOSTICS']
    .some((k) => (process.env[k] ?? '') !== '');
  return Object.keys(PROVISIONAL_SHAPES).filter((name) => name === 'scaled' || overridden
    || wanted.includes('all') || wanted.includes(name));
}

// ---- helpers --------------------------------------------------------------------------------------------

/** Records every `get(runId, {maxBytes})` the engine issues, delegating to a real in-memory store. */
function spyStore(inner = createInMemoryResultStore()) {
  const gets = [];
  return Object.assign(Object.create(null), {
    ...inner,
    get(runId, opts) { gets.push({ runId, maxBytes: opts?.maxBytes }); return inner.get(runId, opts); },
    gets,
  });
}

/** A clock for RECORDED durations only: real, read-only, absolute (ISO timestamps stay sane). */
const realNow = () => performance.timeOrigin + performance.now();

/**
 * One round-trip engine on the P7 engine world (mA/mB bound at 'v1', the scripted clean executor):
 * real clock for the recorded spans, the fake scheduler for every yield, `scheduleTimeout` inert.
 */
function roundTripEngine({ limits = {}, resultStore, spans, worldOptions, unitExecutor } = {}) {
  const clock = createFakeClock({ start: EPOCH });
  const world = createEngineWorld(worldOptions);
  const core = createEngineCore(world.config({
    now: realNow, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {},
    spanRecorder: (label, ms) => spans.push({ label, ms }),
    resultStore, limits: { maxResidentResultSets: SINGLE_SLOT, ...limits },
    ...(unitExecutor ? { unitExecutor } : {}),
  }));
  return { ...core, world, clock };
}

/** Run.js's finalize protocol on the engine's own residency port: reserve → admit → persist. */
async function admitAndPersist(internals, set) {
  internals.residency.reserveRunSlot(set.runId);
  internals.residency.admitSealedSet(set.runId, set);
  return internals.residency.beginPersist(set.runId, { persist: true });
}

/** The engine world's other test id: a real run whose admission needs the (single) slot. */
const evictorDefinition = () => makeDefinition({ testId: 'T-evictor' });

/**
 * P7.7's ledger-consistent pairing executor (rerun.test.mjs), plus one non-completeness-affecting
 * `witness-unavailable` diagnostic per source element, so a REAL run seals results AND diagnostics that
 * read back valid: one volume-overlap pair per source root against its first target's first root.
 */
function pairingExecutor(rootsOf) {
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
    const diagnostics = request.materialized.sourceDbIds.map((dbId) => ({ reason: 'witness-unavailable', dbId }));
    return createScriptedExecutor({}, { unscripted: { facts: [], pairs, diagnostics } })(request);
  };
}

/** An engine-world model spec: `rootCount` flat roots, each owning itself and one fragment. */
function flatModel(modelKey, firstDbId, rootCount, firstFragId) {
  const roots = [];
  for (let i = 0; i < rootCount; i += 1) {
    const dbId = firstDbId + i;
    roots.push({ dbId, owners: [dbId], fragments: [{ fragId: firstFragId + i, ownerDbId: dbId, geometryId: 1 }] });
  }
  return { modelKey, roots };
}

// ================================================================================================
// Step 1: the §13.6 producer/reader arithmetic (pure, no run)
// ================================================================================================

test('the shipped defaults satisfy the producer/reader invariant (§13.6)', () => {
  // The formula lives in P0 (single-defaults rule): the harness never restates its factors.
  const nodes = worstCaseCapturedNodes(RUN_OPTION_DEFAULTS);
  assert.ok(nodes <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes, `${nodes} > ${ENGINE_LIMIT_DEFAULTS.maxCapturedNodes}`);
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes * BYTES_PER_NODE <= ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes);
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes <= SCHEMA_MAX_NODES);
  assert.deepEqual(producerReaderIssues(RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS), []);
  // Spec §17.1.1 note / plan: "15,685,536 <= 16,000,000" (erratum A11; was 14,585,536 under factor 24) and "512,000,000 <= 536,870,912" at the
  // provisional values. Pinned through the imports (the numbers are derived, never written as defaults),
  // so a G-CAL change to any factor or default re-derives both sides here.
  assert.equal(RUN_OPTION_DEFAULTS.maxPairsPerOutcome, RUN_OPTION_DEFAULTS.maxResultsPerRun);
  assert.equal(ENGINE_LIMIT_CEILINGS.maxCapturedNodes, SCHEMA_MAX_NODES, 'the operational reader limit is capped by the schema ceiling');
});

test('the hard ceilings are jointly unreachable: options at the ceilings are refused as result-unreadable at startRun', () => {
  const engine = createClashTestEngine(createEngineWorld().config({
    now: createFakeClock({ start: EPOCH }).now, scheduleTimeout: () => () => {},
  }));
  const atCeilings = {
    maxResultsPerRun: RUN_OPTION_CEILINGS.maxResultsPerRun,
    maxLedgerRecords: RUN_OPTION_CEILINGS.maxLedgerRecords,
    maxPlanReferences: RUN_OPTION_CEILINGS.maxPlanReferences,
    maxUnitsPerRun: RUN_OPTION_CEILINGS.maxUnitsPerRun,
  };
  let caught = null;
  try { engine.startRun(makeDefinition(), atCeilings); } catch (err) { caught = err; }
  assert.ok(caught instanceof InvalidOptionsError, `synchronous InvalidOptionsError, got ${caught}`);
  // `result-unreadable` is the error's REASON; the issue codes are the two P0 spellings.
  assert.equal(caught.reason, 'result-unreadable');
  assert.ok(caught.issues.some((i) => i.code === 'result-unreadable-nodes' || i.code === 'result-unreadable-bytes'));
  assert.equal(engine.retentionReport().slotsInUse, 0, 'the refusal holds no slot');
  // Even at the engine-limit ceilings the worst case cannot be read: the §17.1.1 "jointly unreachable" note.
  const atLimitCeilings = resolveEngineLimits({
    maxCapturedNodes: ENGINE_LIMIT_CEILINGS.maxCapturedNodes, maxStoredResultBytes: ENGINE_LIMIT_CEILINGS.maxStoredResultBytes,
  });
  assert.throws(() => resolveRunOptions(atCeilings, atLimitCeilings),
    (err) => err instanceof InvalidOptionsError && err.reason === 'result-unreadable');
});

// ================================================================================================
// Step 3: the round trip — engine-produced leg, then one maximum-shape leg per active tier
// ================================================================================================

test('engine-produced round trip: produce → persist → evict (LRU) → read → validate → rerun', async (t) => {
  const { resultCount } = PROVISIONAL_SHAPES.scaled;
  const modelSpecs = [flatModel(SHAPE_MODEL_A, 1, resultCount, 0), flatModel(SHAPE_MODEL_B, resultCount + 1, 1, resultCount)];
  const spans = [];
  const store = spyStore();
  const { engine } = roundTripEngine({
    resultStore: store, spans, worldOptions: { modelSpecs },
    unitExecutor: pairingExecutor({ [SHAPE_MODEL_A]: [1], [SHAPE_MODEL_B]: [resultCount + 1] }),
  });
  const wholeModels = makeDefinition({
    testId: 'T-produced',
    selectionA: { entries: [{ kind: 'model', modelKey: SHAPE_MODEL_A }] },
    selectionB: { entries: [{ kind: 'model', modelKey: SHAPE_MODEL_B }] },
  });

  // produce + persist: a real run seals and persists the set (§13.5.1).
  const produced = engine.startRun(wholeModels);
  const done = await produced.done;
  assert.equal(done.status, 'completed');
  assert.equal(done.persistence.state, 'saved');
  const set = done.resultSet;
  assert.equal(set.results.length, resultCount, 'one result per mA root');
  assert.equal(set.diagnostics.diagnostics.length, resultCount, 'one retained diagnostic per mA root');
  assert.equal(engine.getRun(produced.runId), produced, 'resident: the run is still this engine\'s');

  // evict: a second REAL run needs the only slot; P5's LRU drops the saved set.
  const evictor = engine.startRun(evictorDefinition());
  assert.equal(engine.getRun(produced.runId), null, 'evicted: no longer an owned run');
  assert.equal(engine.getPersistenceState(produced.runId), null, 'evicted: no longer resident');
  await evictor.done;

  // read + validate: a store read-through (capture → version → validate → freeze) at the SAME limits.
  const t0 = performance.now();
  const read = await engine.getResultSet(produced.runId);
  const readMs = performance.now() - t0;
  assert.notEqual(read, set, 'a detached copy from the store, not the evicted object');
  assert.equal(canonicalJson(read), canonicalJson(set), 'the producer\'s set reads back unchanged (§13.6 R21-2)');
  assert.ok(isDeepFrozen(read));
  assert.deepEqual(validateResultSet(read, { limits: ENGINE_LIMIT_DEFAULTS }), { ok: true, issues: [] });
  assert.equal(engine.getPersistenceState(produced.runId), null, 'a read-through never makes a set resident');
  assert.deepEqual(store.gets.at(-1), { runId: produced.runId, maxBytes: ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes });

  // rerun by id: predicate (ii) at the rerun's own resolved options (R-P7-21), then a fresh run.
  const rerun = await engine.rerun(produced.runId);
  const again = await rerun.done;
  assert.equal(again.status, 'completed');
  assert.equal(again.resultSet.derivedFromRunId, produced.runId);
  assert.equal(again.resultSet.digests.pairSetDigest, set.digests.pairSetDigest, 'deterministic mode reproduces the pair set');

  recordAc12(t, 'engine-produced', {
    results: set.results.length, diagnostics: set.diagnostics.diagnostics.length, units: set.ledger.units.length,
    nodes: measuredNodes(read), readMs, spans: summarizeSpans(spans),
  });
});

for (const tier of activeTiers()) {
  test(`maximum-shape round trip: ${tier}`, async (t) => {
    const shape = PROVISIONAL_SHAPES[tier];
    const runOptions = runOptionsFor(shape);
    const spans = [];
    const store = spyStore();
    const { engine, internals } = roundTripEngine({ limits: engineLimitsFor(runOptions), resultStore: store, spans });
    const limits = internals.effectiveLimits;

    // produce — P5's producer pipeline; the harness really built the shape it claims, within the reader limit.
    let t0 = performance.now();
    const set = await maximumShapeSet(shape, { runId: `run-ac12-${tier}` });
    const produceMs = performance.now() - t0;
    assert.equal(set.results.length, shape.resultCount);
    assert.equal(ledgerRecordsOf(set), shape.ledgerRecordCount);
    assert.equal(set.diagnostics.diagnostics.length, shape.diagnosticCount);
    assert.deepEqual(set.provenance.runOptions, runOptions);
    assert.deepEqual(producerReaderIssues(runOptions, limits), [], 'producible under options this engine accepts');
    assert.deepEqual(validateResultSet(set, { limits }), { ok: true, issues: [] });
    const nodes = measuredNodes(set);
    assert.ok(nodes <= limits.maxCapturedNodes, `${nodes} > ${limits.maxCapturedNodes}`);

    // persist — through the engine's residency port and ITS store (Run.js's finalize order).
    t0 = performance.now();
    const persisted = await admitAndPersist(internals, set);
    const persistMs = performance.now() - t0;
    assert.equal(persisted.state, 'saved');
    assert.equal(engine.getPersistenceState(set.runId).state, 'saved', 'resident and saved: evictable');

    // evict — a real run needs the only slot.
    const evictor = engine.startRun(evictorDefinition());
    assert.equal(engine.getPersistenceState(set.runId), null, 'the maximum-shape set was evicted (LRU)');
    await evictor.done;

    // read + validate — a store read-through at the engine's limits: capture, validate, freeze.
    spans.length = 0;
    t0 = performance.now();
    const read = await engine.getResultSet(set.runId);
    const readMs = performance.now() - t0;
    const readSpans = summarizeSpans(spans);
    assert.notEqual(read, set);
    assert.deepEqual(read.digests, set.digests);
    assert.equal(canonicalJson(read), canonicalJson(set), 'the maximum-shape set reads back unchanged');
    assert.ok(Object.isFrozen(read) && isDeepFrozen(read));
    assert.deepEqual(validateResultSet(read, { limits }), { ok: true, issues: [] });
    assert.equal(engine.getPersistenceState(set.runId), null, 'the read-through did not make it resident');
    assert.deepEqual(store.gets.at(-1), { runId: set.runId, maxBytes: limits.maxStoredResultBytes });

    // rerun — by id: read-through again, predicate (ii) against the rerun's own resolved options.
    t0 = performance.now();
    const handle = await engine.rerun(set.runId, { runOptions });
    const rerunAdmitMs = performance.now() - t0;
    const again = await handle.done;
    assert.equal(again.resultSet.derivedFromRunId, set.runId);
    assert.equal(again.status, 'completed', 'the embedded definition re-plans against the bound mA/mB');
    assert.equal(again.resultSet.testRef.semanticDigest, set.testRef.semanticDigest);

    recordAc12(t, `maximum-shape ${tier}`, {
      shape, nodes, bytes: canonicalJson(set).length, produceMs, persistMs, readMs, rerunAdmitMs, readSpans,
    });
  });
}

// ================================================================================================
// Step 5: reader-limit and corruption boundaries
// ================================================================================================

test('a valid set read by an engine with a smaller maxCapturedNodes is ResultSetTooLargeError, never corrupt', async () => {
  const set = await maximumShapeSet(READER_LIMIT_SHAPE, { runId: 'run-ac12-boundary' });
  const nodes = measuredNodes(set);
  assert.ok(worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...TINY_RUN_OPTIONS }) < nodes, 'control: the tiny options fit the small reader');
  const store = createInMemoryResultStore();
  await store.put(set);
  const engineAt = (maxCapturedNodes) => createClashTestEngine(createEngineWorld().config({
    now: createFakeClock({ start: EPOCH }).now, scheduleTimeout: () => () => {}, resultStore: store,
    limits: { maxCapturedNodes },
  }));

  const small = engineAt(nodes - 1);                     // one node short of this set
  await assert.rejects(small.getResultSet(set.runId), (err) => err instanceof ResultSetTooLargeError
    && !(err instanceof CorruptResultSetError) && err.runId === set.runId);
  // A rerun at the DEFAULT options is refused before any read (their worst case exceeds this small reader:
  // result-unreadable); at options this reader can honour, the by-id read-through itself is too large.
  await assert.rejects(small.rerun(set.runId), (err) => err instanceof InvalidOptionsError && err.reason === 'result-unreadable');
  await assert.rejects(small.rerun(set.runId, { runOptions: TINY_RUN_OPTIONS }), (err) => err instanceof ResultSetTooLargeError
    && !(err instanceof CorruptResultSetError));
  await assert.rejects(small.getFreshness(set.runId), ResultSetTooLargeError, 'and every by-id read');

  const exact = engineAt(nodes);                         // the boundary itself reads
  assert.equal(canonicalJson(await exact.getResultSet(set.runId)), canonicalJson(set));
});

test('SCHEMA_MAX_NODES divides corrupt from too-large: at the ceiling a node overflow is corrupt', () => {
  const issues = [{ path: '', code: 'too-many-nodes' }];
  // The engine's own resolved limits at the maxCapturedNodes ceiling ARE the schema ceiling ...
  const atCeiling = resolveEngineLimits({ maxCapturedNodes: ENGINE_LIMIT_CEILINGS.maxCapturedNodes });
  assert.equal(atCeiling.maxCapturedNodes, SCHEMA_MAX_NODES);
  // ... where overflowing means "no conforming writer produced this" (corrupt) ...
  assert.ok(nodeCeilingError(atCeiling, 'r', issues) instanceof CorruptResultSetError);
  // ... while one node below it, or at the provisional default, it is only this reader being small.
  for (const limits of [resolveEngineLimits({ maxCapturedNodes: SCHEMA_MAX_NODES - 1 }), ENGINE_LIMIT_DEFAULTS]) {
    const err = nodeCeilingError(limits, 'r', issues);
    assert.ok(err instanceof ResultSetTooLargeError && !(err instanceof CorruptResultSetError));
  }
});

test('every store read is byte-guarded with the engine\'s maxStoredResultBytes', async () => {
  const set = await maximumShapeSet(BOUNDARY_SHAPE, { runId: 'run-ac12-bytes' });
  const inner = createInMemoryResultStore();
  await inner.put(set);
  const serialized = canonicalJson(set).length;
  for (const maxStoredResultBytes of [ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes, serialized, TINY_STORED_BYTES]) {
    const store = spyStore(inner);
    const engine = createClashTestEngine(createEngineWorld().config({
      now: createFakeClock({ start: EPOCH }).now, scheduleTimeout: () => () => {}, resultStore: store,
      limits: { maxStoredResultBytes },
    }));
    const outcome = await engine.getResultSet(set.runId).then(() => 'read', (err) => err);
    assert.deepEqual(store.gets, [{ runId: set.runId, maxBytes: maxStoredResultBytes }]);
    if (maxStoredResultBytes >= serialized) assert.equal(outcome, 'read');
    else assert.ok(outcome instanceof ResultSetTooLargeError, `${maxStoredResultBytes}: ${outcome}`);
  }
});

// ================================================================================================
// D-8 regression (erratum A11, spec §13.6/§25): the closed-shape bound is "one ClashResult <= 35 nodes"
// (P0 `SCHEMA_NODE_FACTORS.result`, options.js). It was 24, below what P0's own capture meter charges
// (a volume-overlap result WITH a witness measures 26; a clearance result with every flag, 35), so
// `resolveRunOptions` accepted results-heavy, tiny-ledger options whose sets the SAME engine then
// refused as `ResultSetTooLargeError` — an R21-2 violation ("an engine never produces a set it cannot
// read"). Evidence: docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md.
// Exercised here at the WORST-case result shape (35 nodes per result), not the ordinary one.
// ================================================================================================

/** A results-heavy option set: many results, few units, so the per-result factor dominates. */
const GAP_RESULTS = 50_000;
const GAP_UNITS = GAP_RESULTS / 100;             // 100 pairs per unit (well inside the per-unit caps)
/** Sized so the set's plan-table records fit (about 2,700: 501 root-table rows, 501 root owners, 100 unreachable
 *  owners, 500 unit records, 1,000 unit ranges, 2 scope digests), so the set is plausibly producible under them. */
const GAP_PLAN_REFERENCES = 3_000;

test('R21-2 (D-8): options this engine accepts yield sets it can read back, at the worst-case 35-node ClashResult', async () => {
  const options = {
    maxResultsPerRun: GAP_RESULTS, maxRetainedDiagnostics: NO_DIAGNOSTICS, maxUnitsPerRun: GAP_UNITS,
    maxPlanReferences: GAP_PLAN_REFERENCES, maxLedgerRecords: GAP_PLAN_REFERENCES + 2 * GAP_UNITS,
  };
  const limits = resolveEngineLimits({ maxCapturedNodes: worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...options }) });
  const runOptions = resolveRunOptions(options, limits);           // ACCEPTED: the invariant says readable
  const set = await maximumShapeSet({ resultCount: GAP_RESULTS, ledgerRecordCount: GAP_UNITS, diagnosticCount: NO_DIAGNOSTICS },
    { runId: 'run-ac12-gap', runOptions, resultShape: 'worst' });
  assert.equal(set.results.length, GAP_RESULTS);
  // Every result is the worst-case shape (clearance evidence + all four flags); one of them is metered.
  assert.ok(set.results.every((r) => r.mode === 'clearance' && Object.keys(r.flags).length === 4), 'worst-case shape throughout');
  assert.equal(measuredNodes(set.results[0]), 35);
  assert.ok(set.ledger.units.length <= runOptions.maxUnitsPerRun && ledgerRecordsOf(set) <= runOptions.maxLedgerRecords);
  const store = createInMemoryResultStore();
  await store.put(set);
  const engine = createClashTestEngine(createEngineWorld().config({
    now: createFakeClock({ start: EPOCH }).now, scheduleTimeout: () => () => {}, resultStore: store, limits,
  }));
  const measured = measuredNodes(set);
  assert.ok(measured <= limits.maxCapturedNodes, `measured ${measured} > formula ${limits.maxCapturedNodes}`);
  assert.equal(canonicalJson(await engine.getResultSet(set.runId)), canonicalJson(set),
    `measured ${measured} nodes vs the formula's ${limits.maxCapturedNodes}`);
});
