// test/clashtest/integration/nodeFactor.ledgerDiagnostic.test.mjs
//
// D-8b (ledger node factor) and D-8c (diagnostic node factor): the bounded evidence checks of owner ruling D-8b/D-8c
// (evidence record docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md §11). Same technique
// as nodeFactor.test.mjs: every charge is MEASURED with P0's own capture meter (`captureData`: every object, array and
// primitive is ONE node; keys are free) on records built by the REAL writers (P3 sizing/ledger, P4 projection and
// aggregation), and each contradiction is reproduced END TO END through the real engine (plan -> execute -> seal ->
// persist -> a fresh engine's by-id read).
//
//   D-8c (diagnostic): APPLIED as spec erratum A13. One retained NormalizedDiagnostic costs at most
//         24 + maxUnitIdsPerDiagnostic nodes (the schema/validator maximum); `worstCaseCapturedNodes` now charges
//         (SCHEMA_NODE_FACTORS.diagnostic + maxUnitIdsPerDiagnostic) per retained diagnostic, diagnostic factor 24
//         (was a flat 12). The reproducer below is a passing worst-case regression.
//   D-8b (ledger): APPLIED as spec erratum A14 (owner ruling #5, "Proposed form" 1 of the evidence record §11.2). Unit
//         records persist EXPANDED root ids, so the record budget now charges class `unit-range` one record per
//         expanded id (every source root id, every explicit target root id) plus one per whole-model target sentinel,
//         for initial units, target-too-large gaps and split children alike (`sizing.js` `rangeRecordCount`). One unit
//         record then costs at most 12 nodes per charged record, and `plan-too-large` refuses a plan BEFORE its
//         persisted ledger could outgrow 12 x maxLedgerRecords. The former whole-set reproducer is now a passing R21-2
//         regression: its old options are refused at plan time, and the re-derived exact-boundary options read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_NODE_FACTORS, SCHEMA_MAX_NODES, RUN_OPTION_CEILINGS, RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS,
  ENGINE_LIMIT_CEILINGS, BYTES_PER_NODE, worstCaseCapturedNodes, resolveEngineLimits, resolveRunOptions,
} from '../../../clashtest/options.js';
import { captureData } from '../../../clashtest/util/capture.js';
import { createRecordBudget, createLedger, rootOwnerRowsOf, MAX_SECONDARY_CAUSES } from '../../../clashtest/planning/ledger.js';
import { buildRootTables } from '../../../clashtest/planning/planTables.js';
import { sizeUnits, unitRecordFields, rangeRecordCount, sourceRootCount, targetEntryRootCount } from '../../../clashtest/planning/sizing.js';
import {
  createUnitBindingTable, projectDiagnostic, createDiagnosticAggregator, isCompletenessAffecting,
} from '../../../clashtest/execution/diagnostics.js';
import { checkShapeAndUnknownFields } from '../../../clashtest/results/resultSetSchema.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { makeDefinition } from '../support/definitions.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { makeSizingFixture, makeSyntheticEnumerator, defOf, snapshotOf } from '../support/syntheticModels.mjs';
import { createPlan } from '../../../clashtest/planning/planner.js';
import { resealed, fakeSlicer } from '../support/resultSetFixtures.mjs';

/** P0's own meter on one value (the same traversal `captureResultSet` charges against `maxCapturedNodes`). */
const nodesOf = (value) => {
  const cap = captureData(value, { maxNodes: SCHEMA_MAX_NODES });
  assert.ok(cap.ok, `capture refused: ${JSON.stringify(cap.issues)}`);
  return cap.nodes;
};
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const readerLimits = () => resolveEngineLimits(undefined);

// ---- the end-to-end harness: a real run, persisted, then read by a FRESH engine ---------------------------------

const frag = (fragId, ownerDbId) => ({ fragId, ownerDbId, geometryId: 1 });
/** mA: `sources` one-fragment roots 1..n; mB: `targets` one-fragment roots from 100,000. */
function flatModels(sources, targets) {
  let fragId = 0;
  const roots = (ids) => ids.map((dbId) => ({ dbId, owners: [dbId], fragments: [frag(fragId++, dbId)] }));
  return [{ modelKey: 'mA', roots: roots(range(sources)) }, { modelKey: 'mB', roots: roots(range(targets, 100_000)) }];
}

/**
 * Size the reader EXACTLY to the §13.6 formula for `options` (the tightest engine R21-2 lets accept them), run the
 * definition on the real engine with a persisting store, and read the sealed set back through a fresh engine.
 */
async function runAtFormula({ modelSpecs, definition, options, unitExecutor }) {
  const worst = worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...options });
  const limits = resolveEngineLimits({ maxCapturedNodes: worst });
  const runOptions = resolveRunOptions(options, limits);            // ACCEPTED: the invariant says "readable"
  const store = createInMemoryResultStore();
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24) });
  const cfg = (extra) => createEngineWorld({ modelSpecs }).config({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: () => () => {}, resultStore: store, limits, ...extra,
  });
  const summary = await createClashTestEngine(cfg(unitExecutor ? { unitExecutor } : {})).startRun(definition, options).done;
  const set = await store.get(summary.runId);
  const read = await createClashTestEngine(cfg({})).getResultSet(summary.runId).then((v) => v, (err) => err);
  return { worst, runOptions, summary, set, read };
}

// ================================================================================================================
// D-8b — the ledger term
// ================================================================================================================

/** One planned unit record exactly as the real writer persists it (sizing -> unitRecordFields -> ledger). */
function persistedUnit({ sourceWeights, targets, options = RUN_OPTION_DEFAULTS, patch, taints }) {
  const { cells, plan } = makeSizingFixture({ sourceWeights, targets });
  const [unit] = sizeUnits({ cells, plan, options }).units;
  const budget = createRecordBudget(RUN_OPTION_DEFAULTS);
  const ledger = createLedger({ limits: RUN_OPTION_DEFAULTS, budget });
  const fields = unitRecordFields(plan, unit);
  assert.ok(budget.admitPlanBlock([['unit-record', 1], ['unit-range', fields.ranges]]));
  assert.ok(budget.reserveUnitSlots());
  ledger.recordUnit(fields);
  if (patch) ledger.recordOutcome(unit.unitId, patch);
  if (taints) ledger.addTaint(unit.unitId, taints);
  return { record: ledger.unitRecord(unit.unitId), ranges: fields.ranges };
}

test('D-8b (a): a persisted UnitRecord costs 17 + expanded source ids + per target (3 | 4 + ids) + secondary causes + 6 per taint', () => {
  const at = (args) => nodesOf(persistedUnit(args).record);
  // model-scope target: the whole-model sentinel is persisted as {modelKey, scope:'model'} (3 nodes)
  assert.equal(at({ sourceWeights: [1], targets: [{ modelKey: 'mB', whole: true, roots: 1 }] }), 17 + 1 + 3);   // 21
  // explicit target with one root: {modelKey, scope:'roots', rootDbIds:[id]} (4 + 1)
  assert.equal(at({ sourceWeights: [1], targets: [{ modelKey: 'mB', roots: 1 }] }), 17 + 1 + 5);                  // 23
  // 500 contiguous source roots (ONE range) x 2,000 contiguous target roots (ONE range): nodes 2,521, and (A14) the
  // unit-range charge is the 2,500 expanded ids, not the 2 ranges
  const wide = persistedUnit({ sourceWeights: Array(500).fill(1), options: { ...RUN_OPTION_DEFAULTS, maxSourceFragmentsPerUnit: 500 },
    targets: [{ modelKey: 'mB', roots: 2_000 }] });
  assert.equal(wide.ranges, 500 + 2_000);
  assert.equal(nodesOf(wide.record), 17 + 500 + 4 + 2_000);
  // inline fields the budget never charges: up to 8 secondary causes; each taint entry is 6 nodes for 1 record
  const causes = range(MAX_SECONDARY_CAUSES + 3).map((i) => `c${String(i).padStart(2, '0')}`);
  assert.equal(at({ sourceWeights: [1], targets: [{ modelKey: 'mB', whole: true, roots: 1 }], patch: { secondaryCauses: causes } }), 21 + 8);
  assert.equal(at({ sourceWeights: [1], targets: [{ modelKey: 'mB', whole: true, roots: 1 }],
    taints: [{ kind: 'element', modelKey: 'mA', dbId: 1, reason: 'r1' }, { kind: 'unit', reason: 'r2' }] }), 21 + 2 * 6);
});

test('D-8b (a): the other ledger/plan record kinds are within 12 nodes per charged record (producer shapes)', () => {
  // rootOwners (charged: 1 root-table record per root + 1 root-owner record per owner id): 3-node per-model wrapper
  // (uncharged) + a {rootDbId, ownerDbIds, cls} row of 4 + |ownerDbIds|.
  const rows = rootOwnerRowsOf(new Map([['mA', { rootOwners: [
    { rootDbId: 1, ownerDbIds: [1], cls: 'A' }, { rootDbId: 2, ownerDbIds: [2, 3, 4], cls: 'A' }] }]]));
  assert.equal(nodesOf(rows[0]), 3 + (4 + 1) + (4 + 3));
  // everything recorded through the real ledger's planning sections, measured one row at a time
  const ledger = createLedger({ limits: RUN_OPTION_DEFAULTS, budget: createRecordBudget(RUN_OPTION_DEFAULTS) });
  ledger.recordPlanning({
    unresolvedSelections: [{ selectionRole: 'A', modelKey: 'mA', cause: 'no-fragments', dbIds: [5, 6] }],
    unreachablePopulation: [{ modelKey: 'mA', count: 3, ownerDbIds: [7, 8], mixedOwnerDbIds: [8],
      unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }],
    hierarchyInternal: [{ modelKey: 'mA', rootCount: 1, ownerCount: 9,
      examples: [{ rootDbId: 9, ownerDbIds: range(8, 10) }] }],     // rootResolution.js MAX_EXAMPLE_OWNERS = 8
    warnings: [{ code: 'empty-operand' }],
  });
  ledger.recordPlanningGap({ phase: 'planning', cause: 'plan-too-large' });
  const l = ledger.toLedgerRecord();
  assert.equal(nodesOf(l.unresolvedSelections[0]), 5 + 2);                   // charged 1 + |dbIds| = 3
  assert.equal(nodesOf(l.unreachablePopulation[0]), 8 + 2 + 1);              // charged 1 + |owners| + |mixed| = 4
  assert.equal(nodesOf(l.hierarchyInternal[0]) - nodesOf(l.hierarchyInternal[0].examples[0]), 5);
  assert.equal(nodesOf(l.hierarchyInternal[0].examples[0]), 3 + 8);          // 11 <= 12 per example record
  assert.equal(nodesOf(l.warnings[0]), 2);                                   // charged as 'planning-gap'
  assert.equal(nodesOf(l.planningGaps[0]), 3);                               // uncharged, closed-enum de-duplicated
  // provenance scope digests (charged 'scope-digest'): RootDigest and population are 3 nodes each
  assert.equal(nodesOf({ dbId: 1, subtreeDigest: `sha256:${'a'.repeat(64)}` }), 3);
  assert.equal(nodesOf({ count: 1, digest: `sha256:${'a'.repeat(64)}` }), 3);
});

test('D-8b (b): under A14 a unit record costs <= 12 nodes per charged record (1 unit-record + 1 per expanded id / sentinel)', () => {
  // Charged WITHOUT the reserved overflow slot (that slot is kept for the unit's taint-overflow entry, 6 nodes), and
  // with the producer's maximum 8 secondary causes: 17 + 8 + s + sum(3 | 4 + n) <= 12 x (1 + s + m + sum n).
  const causes = range(MAX_SECONDARY_CAUSES).map((i) => `c${String(i).padStart(2, '0')}`);
  for (const [S, targets] of [
    [1, [{ modelKey: 'mB', whole: true, roots: 1 }]],                             // the tightest shape: 29 <= 36
    [1, [{ modelKey: 'mB', roots: 1 }]],
    [1, [{ modelKey: 'mB', roots: 2_000 }]],
    [500, [{ modelKey: 'mB', roots: 2_000 }]],                                    // the former 2-range, 2,521-node unit
    [3, [{ modelKey: 'mB', roots: 2 }, { modelKey: 'mC', roots: 1 }]],             // two explicit target entries, one unit
  ]) {
    const { record, ranges } = persistedUnit({ sourceWeights: Array(S).fill(1), options: { ...RUN_OPTION_DEFAULTS, maxSourceFragmentsPerUnit: S },
      targets, patch: { secondaryCauses: causes } });
    const explicitIds = targets.reduce((n, t) => n + (t.whole ? 0 : t.roots), 0);
    const sentinels = targets.filter((t) => t.whole).length;
    assert.equal(ranges, S + explicitIds + sentinels);                              // per expanded id, not per range
    const nodes = nodesOf(record);
    assert.equal(nodes, 17 + MAX_SECONDARY_CAUSES + S + 3 * sentinels + targets.filter((t) => !t.whole).reduce((n, t) => n + 4 + t.roots, 0));
    assert.ok(nodes <= SCHEMA_NODE_FACTORS.ledger * (1 + ranges), `${S} x ${JSON.stringify(targets)}: ${nodes} <= 12 x ${1 + ranges}`);
  }
});

test('D-8b (c): at the PROVISIONAL DEFAULTS the real sizer and record budget now REFUSE (plan-too-large) the plan whose ledger alone would be ~100M nodes (A14)', () => {
  // Selection A: 10,000 whole-model roots of 101 fragments (each exceeds half of maxSourceFragmentsPerUnit = 200, so
  // each root is a source chunk of its own); selection B: 10,000 explicit one-fragment roots (= the default
  // maxExplicitElementsPerSelection, <= the schema's 10,000 roots per model). Every value is a §17.1 default.
  const O = RUN_OPTION_DEFAULTS;
  const N = 10_000;
  const row = (dbId, fragmentCount) => ({ dbId, fragmentCount, ownerDbIds: [dbId], subtreeDigest: `sha256:${dbId}` });
  const budget = createRecordBudget(O);
  // scope digests exactly as rootResolution.js step 9 charges them (A: population + one row per root; B explicit: rows)
  assert.ok(budget.admitPlanBlock([['scope-digest', 1 + N + N]]));
  const built = buildRootTables({ budget, models: [
    { modelKey: 'mA', classes: { "A'": range(N).map((id) => row(id, 101)) } },
    { modelKey: 'mB', classes: { "B'": range(N, 100_000).map((id) => row(id, 1)) } },
  ] });
  assert.ok(built.ok);
  const plan = { ...built, models: new Map() };
  const cells = [{ cell: '1', sourceModelKey: 'mA', sourceRanges: [plan.rangeOfClass('mA', "A'")],
    targets: [{ modelKey: 'mB', scope: { ranges: [plan.rangeOfClass('mB', "B'")] } }], orientationRole: 'A->B' }];
  const sized = sizeUnits({ cells, plan, options: O, limit: O.maxUnitsPerRun });
  assert.equal(sized.exceeded, false);
  assert.equal(sized.units.length, O.maxUnitsPerRun);                         // 10,000 units: one per source root
  const rangeTotal = sized.units.reduce((n, u) => n + rangeRecordCount(u), 0);
  // A14: one unit-range record per expanded id (1 source + 10,000 target ids per unit), not the 2 ranges per unit
  // (2 x N = 20,000 in total) the budget charged before
  assert.equal(rangeTotal, N * (1 + N));
  // the planner's admission (planner.js step 4) is refused under the DEFAULT budget: plan-too-large on `unit-range`,
  // and nothing is charged for the refused block
  const before = budget.planRecords;
  assert.equal(before, 3 * 2 * N + 1);                                          // scope digests, root tables, root owners
  assert.equal(budget.admitPlanBlock([['unit-record', sized.units.length], ['unit-range', rangeTotal], ['planning-gap', 0]]), false);
  assert.equal(budget.planOverflowClass, 'unit-range');
  assert.equal(budget.planRecords, before);
  // the refused ledger would have been over 6 x the defaults' formula and the byte cap: every unit carries 1 source id
  // and the SAME 10,000 target ids; measure two in full, count the rest by ids
  for (const u of sized.units) assert.equal(sourceRootCount(u.sourceRanges) + targetEntryRootCount(plan, u.targets[0]), 1 + N);
  const ledger = createLedger({ limits: O, budget: createRecordBudget(O) });
  const perUnit = [sized.units[0], sized.units[N - 1]].map((u) => {
    const fields = unitRecordFields(plan, u);
    ledger.recordUnit(fields);
    return nodesOf(ledger.unitRecord(u.unitId));
  });
  assert.deepEqual(perUnit, [17 + 1 + 4 + N, 17 + 1 + 4 + N]);
  const unitNodes = N * perUnit[0];
  assert.equal(unitNodes, 100_220_000);
  assert.equal(worstCaseCapturedNodes(O), 15_885_536);                         // the defaults' formula value (A13)
  assert.ok(unitNodes > ENGINE_LIMIT_DEFAULTS.maxCapturedNodes);
  assert.ok(unitNodes > worstCaseCapturedNodes(O));
  assert.ok(unitNodes > Math.floor(ENGINE_LIMIT_CEILINGS.maxStoredResultBytes / BYTES_PER_NODE));
  // ... while what A14 lets the defaults admit is bounded by the formula's own ledger term
  assert.ok(unitNodes > SCHEMA_NODE_FACTORS.ledger * O.maxLedgerRecords);
});

test('D-8b (e): 500 source ids x 2,000 target ids in TWO input ranges: the real planner charges 2,500 unit-range records, exact boundary admitted, one below refused (A14)', async () => {
  const S = 500;
  const T = 2_000;
  const modelSpecs = flatModels(S, T);
  const definition = defOf({
    A: [{ kind: 'elements', modelKey: 'mA', dbIds: modelSpecs[0].roots.map((r) => r.dbId) }],
    B: [{ kind: 'elements', modelKey: 'mB', dbIds: modelSpecs[1].roots.map((r) => r.dbId) }],
  });
  // one unit: the 500 sources pack into one chunk (maxSourceDbIdsPerUnit 500, fragments 500), the 2,000 targets one slice
  const base = { ...RUN_OPTION_DEFAULTS, maxSourceFragmentsPerUnit: S, maxUnitsPerRun: 1 };
  const planWith = async (maxPlanReferences) => {
    const { enumerator, binding } = makeSyntheticEnumerator(modelSpecs);
    return createPlan({ definition, snapshot: snapshotOf(binding, ['mA', 'mB']), enumerator, checkpoint: () => {},
      options: { ...base, maxPlanReferences, maxLedgerRecords: maxPlanReferences + 2 } });
  };
  // Exact plan cost: scope-digest + root-table + root-owner 1 per root each (3 x 2,500), unit-record 1, unit-range
  // 500 + 2,000 = 2,500 (A14; it was 2 -- one source range + one target range -- so the old total was 7,503).
  const cost = 3 * (S + T) + 1 + (S + T);
  assert.equal(cost, 10_001);
  const exact = await planWith(cost);
  assert.equal(exact.status, 'planned');
  assert.equal(exact.plan.units.length, 1);
  assert.equal(exact.plan.units[0].sourceRanges.length, 1);
  assert.equal(exact.plan.units[0].targets[0].scope.ranges.length, 1);         // 2 input ranges hold 2,500 ids
  assert.equal(exact.plan.planRecords, cost);
  assert.equal(exact.ledger.budget.used, cost + 1);                             // + the 1 reserved overflow slot
  // the persisted unit record is within 12 nodes per charged record
  const [unit] = exact.ledger.toLedgerRecord().units;
  assert.equal(nodesOf(unit), 17 + S + 4 + T);
  assert.ok(nodesOf(unit) <= SCHEMA_NODE_FACTORS.ledger * (1 + S + T));
  // one record short: plan-too-large on the unit-range block, and nothing recorded
  const over = await planWith(cost - 1);
  assert.equal(over.status, 'failed');
  assert.deepEqual(over.planningGaps.map((g) => [g.cause, g.detail?.overflowClass]), [['plan-too-large', 'unit-range']]);
  assert.equal(over.ledger.unitRecordCount, 0);
  // the old range-count total (7,503) is now refused as well
  assert.equal((await planWith(3 * (S + T) + 1 + 2)).status, 'failed');
});

/** The D-8b whole-set reproducer: 100 units (maxSourceDbIdsPerUnit 1) all targeting the same 2,000 explicit roots. */
const LEDGER_HEAVY = Object.freeze({ units: 100, targets: 2_000 });
// Plan records the planner charges under A14: scope-digest, root-table and root-owner 1 per root each (3 x 2,100 =
// 6,300), unit-record 100, unit-range 100 x (1 source id + 2,000 target ids) = 200,100 -- 206,500 in total, the exact
// minimum. Before A14 unit-range was 200 (one source range + one explicit target range per unit), total 6,600, and the
// options below (6,600) were ACCEPTED with a formula of 147,171 while the set measured 221,236 (ResultSetTooLargeError).
const LEDGER_HEAVY_COST = 3 * (LEDGER_HEAVY.units + LEDGER_HEAVY.targets) + LEDGER_HEAVY.units
  + LEDGER_HEAVY.units * (1 + LEDGER_HEAVY.targets);
/** maxLedgerRecords is the cross-field minimum maxPlanReferences + 2 x maxUnitsPerRun. */
const ledgerHeavyOptions = (maxPlanReferences) => Object.freeze({
  maxSourceDbIdsPerUnit: 1, maxUnitsPerRun: LEDGER_HEAVY.units, maxPlanReferences,
  maxLedgerRecords: maxPlanReferences + 2 * LEDGER_HEAVY.units, maxResultsPerRun: 1, maxRetainedDiagnostics: 0,
});
const ledgerHeavy = (maxPlanReferences) => {
  const modelSpecs = flatModels(LEDGER_HEAVY.units, LEDGER_HEAVY.targets);
  return runAtFormula({ modelSpecs, options: ledgerHeavyOptions(maxPlanReferences), definition: makeDefinition({
    testId: 'T-D8b',
    selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: modelSpecs[0].roots.map((r) => r.dbId) }] },
    selectionB: { entries: [{ kind: 'elements', modelKey: 'mB', dbIds: modelSpecs[1].roots.map((r) => r.dbId) }] },
  }) });
};

/** A refused plan: the run seals a plan-less set carrying the plan-too-large planning gap, and it reads back. */
async function assertRefusedPlanTooLarge(maxPlanReferences) {
  const { worst, summary, set, read } = await ledgerHeavy(maxPlanReferences);
  assert.notEqual(summary.status, 'completed');
  assert.ok(set.ledger.planningGaps.length > 0 && set.ledger.planningGaps.every((g) => g.cause === 'plan-too-large'));
  assert.ok(set.ledger.planningGaps.some((g) => g.phase === 'planning'));
  assert.equal(set.ledger.planExists, false);
  assert.equal(set.ledger.units.length, 0);
  assert.ok(nodesOf(set) <= worst, `measured ${nodesOf(set)} <= formula ${worst}`);
  assert.ok(!(read instanceof Error), String(read));
}

test('D-8b (d): the former reproducer options (maxPlanReferences 6,600) are now refused plan-too-large (A14)', async () => {
  assert.equal(LEDGER_HEAVY_COST, 206_500);
  await assertRefusedPlanTooLarge(6_600);
});

// The former standing R21-2 `test.todo` (precedent R-P7-24), promoted: at the exact A14 boundary the options are
// accepted, the run completes, and the sealed set is within the formula and read back by the same engine.
test('D-8b R21-2: ledger-heavy options at the exact A14 plan-cost boundary yield a set the same engine reads back', async () => {
  const { worst, runOptions, summary, set, read } = await ledgerHeavy(LEDGER_HEAVY_COST);
  assert.equal(runOptions.maxPlanReferences, 206_500);
  assert.equal(runOptions.maxLedgerRecords, 206_700);
  assert.equal(worst, 35 * 1 + 12 * 206_700 + (SCHEMA_NODE_FACTORS.diagnostic + RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic) * 0 + 65_536);
  assert.equal(worst, 2_545_971);
  assert.equal(summary.status, 'completed');
  assert.equal(set.ledger.units.length, LEDGER_HEAVY.units);
  assert.equal(set.ledger.planningGaps.length, 0);
  assert.deepEqual(validateResultSet(structuredClone(set), { limits: readerLimits() }), { ok: true, issues: [] });
  for (const u of set.ledger.units) assert.equal(nodesOf(u), 17 + 1 + 4 + LEDGER_HEAVY.targets);   // 2,022 each
  const measured = nodesOf(set);
  assert.equal(measured, 221_236);                                                // the same set as before A14
  assert.ok(measured <= worst, `measured ${measured} <= formula ${worst}`);
  assert.ok(!(read instanceof Error), String(read));
  assert.equal(read.runId, set.runId);
});

test('D-8b (d): one record below the exact A14 plan cost (maxPlanReferences 206,499) is refused plan-too-large', async () => {
  await assertRefusedPlanTooLarge(LEDGER_HEAVY_COST - 1);
});

// ================================================================================================================
// D-8c — the diagnostic term (erratum A13)
// ================================================================================================================

const PLAIN = createUnitBindingTable([{ modelKey: 'mA', modelId: 1 }, { modelKey: 'mB', modelId: 2 }]);
const AMBIGUOUS = createUnitBindingTable([{ modelKey: 'mA', modelId: 1 }, { modelKey: 'mB', modelId: 1 }]);
const libFragment = ({ role, modelId = 1 } = {}) => ({ scope: 'fragment', reason: 'inconclusive-crossing',
  fragment: { modelId, dbId: 5, fragId: 7 }, ...(role ? { role } : {}) });
const libPair = () => ({ scope: 'pair', reason: 'inconclusive-crossing',
  sourceFragment: { modelId: 1, dbId: 5, fragId: 7 }, targetFragment: { modelId: 2, dbId: 6, fragId: 8 } });

/** The retained NormalizedDiagnostic the REAL P4 aggregator keeps after `units` units reported `raw`. */
async function retained(raw, table, { units, maxUnitIdsPerDiagnostic }) {
  const p = projectDiagnostic(raw, table);
  assert.ok(p.ok, JSON.stringify(p.issue));
  const agg = createDiagnosticAggregator({ maxRetainedDiagnostics: 10, maxDistinctReasons: 64, maxUnitIdsPerDiagnostic, slicer: fakeSlicer() });
  for (let i = 0; i < units; i += 1) await agg.addUnit(`u${i}`, { diagnostics: [p.diagnostic] });
  const [d] = agg.snapshot().diagnostics;
  return d;
}

test('D-8c (a): producer charge per retained diagnostic — fragment 11 + u .. 14, pair 16 + u (u = unitIds <= maxUnitIdsPerDiagnostic)', async () => {
  const at = async (raw, table, u, cap = u) => nodesOf(await retained(raw, table, { units: u, maxUnitIdsPerDiagnostic: cap }));
  assert.equal(await at(libFragment(), PLAIN, 1), 12);                            // the minimum: fragment, no role
  assert.equal(await at(libFragment({ role: 'target' }), PLAIN, 1), 13);
  assert.equal(await at(libFragment({ role: 'target' }), AMBIGUOUS, 1), 14);    // + ambiguousModelId
  assert.equal(await at(libFragment({ role: 'target' }), PLAIN, 8), 12 + 8);
  assert.equal(await at(libPair(), PLAIN, 1), 17);
  assert.equal(await at(libPair(), AMBIGUOUS, 1), 18);
  // an ambiguous operand has a null modelKey, so §12.4 never merges it across units: its unitIds stay [unitId]
  assert.equal(await at(libPair(), AMBIGUOUS, 8), 18);
  assert.equal(await at(libPair(), PLAIN, 8), 16 + 8);                            // at the default cap
  // the aggregator caps unitIds at the RUN OPTION: 100 contributing units, 64 kept
  const atCeiling = await retained(libPair(), PLAIN, { units: 100, maxUnitIdsPerDiagnostic: RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic });
  assert.equal(atCeiling.unitIds.length, 64);
  assert.equal(nodesOf(atCeiling), 80);                                          // producer maximum 16 + 64
  // shape-dependent in scope/role/ambiguity, and linear in u: every one is within the A13 bound 24 + u
  assert.ok(nodesOf(atCeiling) <= SCHEMA_NODE_FACTORS.diagnostic + RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic);
});

/** The schema/validator-maximal diagnostic: `fragment` AND `fragments`, `role` on all three operands, ambiguousModelId. */
const legalMaxDiagnostic = (u) => {
  const op = (fragId, role) => ({ modelKey: 'mA', dbId: 1, fragId, role });
  return { scope: 'pair', reason: 'witness-unavailable', completenessAffecting: false, attribution: 'element',
    fragment: op(1, 'source'), fragments: { first: op(2, 'source'), second: op(3, 'target') }, ambiguousModelId: true,
    occurrences: 1, unitIds: range(u).map((i) => `u${i}`) };
};

test('D-8c (b): schema/validator maximum is 24 + u (88 at the ceiling 64), the type is CLOSED, and a full validateResultSet accepts it', async () => {
  assert.equal(nodesOf(legalMaxDiagnostic(1)), 25);
  assert.equal(nodesOf(legalMaxDiagnostic(8)), 32);
  assert.equal(nodesOf(legalMaxDiagnostic(64)), 88);
  const withDiagnostic = (d) => resealed((draft) => { draft.diagnostics.diagnostics = [d]; }, 'positives');
  const set = await withDiagnostic(legalMaxDiagnostic(64));
  assert.deepEqual(validateResultSet(set, { limits: readerLimits() }), { ok: true, issues: [] });
  const structural = (d) => {
    const s = structuredClone(set);
    s.diagnostics.diagnostics = [d];
    const issues = [];
    checkShapeAndUnknownFields(s, (path, code) => issues.push({ path, code }), {});
    return issues.map((i) => i.code);
  };
  assert.deepEqual(structural(legalMaxDiagnostic(64)), []);
  assert.deepEqual(structural({ ...legalMaxDiagnostic(64), extra: 1 }), ['unknown-field-closed-type']);
  assert.deepEqual(structural({ ...legalMaxDiagnostic(64), fragment: { ...legalMaxDiagnostic(1).fragment, extra: 1 } }),
    ['unknown-field-closed-type']);
  assert.deepEqual(structural(legalMaxDiagnostic(65)), ['array-too-long']);
  // A13: the per-diagnostic bound IS the attained maximum for every u (tight: no shortfall, no slack)
  assert.equal(SCHEMA_NODE_FACTORS.diagnostic, 24);
  for (const u of [1, 8, 64]) assert.equal(nodesOf(legalMaxDiagnostic(u)), SCHEMA_NODE_FACTORS.diagnostic + u);
});

test('D-8c (c): SCHEMA_MAX_NODES, the defaults and the ceilings under erratum A13', () => {
  const C = RUN_OPTION_CEILINGS;
  assert.equal(SCHEMA_MAX_NODES, 35 * C.maxResultsPerRun + 12 * C.maxLedgerRecords + (24 + 64) * C.maxRetainedDiagnostics + 65_536);
  assert.equal(SCHEMA_MAX_NODES, 282_354_376);
  const O = RUN_OPTION_DEFAULTS;
  assert.equal(worstCaseCapturedNodes(O), 35 * 100_000 + 12 * 1_000_000 + (24 + 8) * 10_000 + 65_536);
  assert.equal(worstCaseCapturedNodes(O), 15_885_536);
  assert.ok(worstCaseCapturedNodes(O) <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes, 'the defaults still satisfy R21-2 (margin 114,464)');
  // the rejected flat alternative (a constant 88 per diagnostic) would have pushed the defaults over 16,000,000
  assert.equal(worstCaseCapturedNodes(O) - 32 * O.maxRetainedDiagnostics + 88 * O.maxRetainedDiagnostics, 16_445_536);
  // the maxResultsPerRun ceiling derivation (no diagnostics) is unchanged, and maxRetainedDiagnostics' ceiling stays reachable
  const byteCap = Math.floor(ENGINE_LIMIT_CEILINGS.maxStoredResultBytes / BYTES_PER_NODE);
  const limits = resolveEngineLimits({ maxCapturedNodes: byteCap, maxStoredResultBytes: ENGINE_LIMIT_CEILINGS.maxStoredResultBytes });
  const small = { maxUnitsPerRun: 1, maxPlanReferences: 1, maxLedgerRecords: 3 };
  assert.equal(resolveRunOptions({ ...small, maxResultsPerRun: C.maxResultsPerRun, maxRetainedDiagnostics: 0 }, limits).maxResultsPerRun, 956_824);
  const diagHeavy = { ...small, maxResultsPerRun: 1, maxRetainedDiagnostics: C.maxRetainedDiagnostics, maxUnitIdsPerDiagnostic: C.maxUnitIdsPerDiagnostic };
  assert.equal(resolveRunOptions(diagHeavy, limits).maxRetainedDiagnostics, C.maxRetainedDiagnostics);
});

/** The D-8c whole-set reproducer: 64 units each report the SAME 1,500 pair diagnostics, so every retained diagnostic
 *  carries 64 unit ids (16 + 64 = 80 nodes) against the former flat allowance of 12. */
const DIAG_HEAVY = Object.freeze({ units: 64, diagnostics: 1_500 });
// Plan records: scope-digest 64 + 1 + population 1, root-table 65, root-owner 65, unit-record 64, unit-range 128 = 388.
const DIAG_HEAVY_OPTIONS = Object.freeze({
  maxSourceDbIdsPerUnit: 1, maxUnitsPerRun: DIAG_HEAVY.units, maxPlanReferences: 388, maxLedgerRecords: 388 + 2 * DIAG_HEAVY.units,
  maxResultsPerRun: 1, maxRetainedDiagnostics: DIAG_HEAVY.diagnostics, maxUnitIdsPerDiagnostic: RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic,
});

test('D-8c (d): diagnostic-heavy options the formula accepts now read back (A13); under the former flat 12 they did not', async () => {
  const modelSpecs = flatModels(DIAG_HEAVY.units, 1);
  const reason = 'inconclusive-crossing';
  const diagnostics = range(DIAG_HEAVY.diagnostics, 0).map((k) => ({
    scope: 'pair', reason, completenessAffecting: isCompletenessAffecting(reason), attribution: 'element',
    fragments: { first: { modelKey: 'mA', dbId: 1, fragId: 1_000_000 + k }, second: { modelKey: 'mB', dbId: 100_000, fragId: 2_000_000 + k } },
  }));
  const { worst, summary, set, read } = await runAtFormula({ modelSpecs, options: DIAG_HEAVY_OPTIONS,
    unitExecutor: createScriptedExecutor({}, { unscripted: { facts: [], diagnostics } }),
    definition: makeDefinition({ testId: 'T-D8c',
      selectionA: { entries: [{ kind: 'elements', modelKey: 'mA', dbIds: modelSpecs[0].roots.map((r) => r.dbId) }] },
      selectionB: { entries: [{ kind: 'model', modelKey: 'mB' }] } }) });
  assert.equal(summary.status, 'completed');
  const retainedList = set.diagnostics.diagnostics;
  assert.equal(retainedList.length, DIAG_HEAVY.diagnostics);
  for (const d of retainedList) {
    assert.equal(d.unitIds.length, 64);
    assert.equal(nodesOf(d), 80);
  }
  assert.deepEqual(validateResultSet(structuredClone(set), { limits: readerLimits() }), { ok: true, issues: [] });
  const measured = nodesOf(set);
  assert.equal(measured, 122_645);
  // The former formula (flat 12 per diagnostic) accepted these options with a reader of 89,763 nodes: 32,882 short.
  const formerWorst = 35 * 1 + 12 * DIAG_HEAVY_OPTIONS.maxLedgerRecords + 12 * DIAG_HEAVY.diagnostics + 65_536;
  assert.equal(formerWorst, 89_763);
  assert.ok(measured > formerWorst);
  // A13: (24 + 64) per retained diagnostic; the same engine now reads its own set back.
  assert.equal(worst, 35 * 1 + 12 * 516 + (24 + 64) * DIAG_HEAVY.diagnostics + 65_536);
  assert.ok(measured <= worst, `measured ${measured} <= formula ${worst}`);
  assert.ok(!(read instanceof Error), String(read));
  assert.equal(read.runId, set.runId);
});
