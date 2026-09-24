// test/clashtest/integration/nodeFactor.test.mjs
//
// D-8 permanent regression (erratum A11, spec §13.6 / §17.1.1 / §25; evidence and applied record:
// docs/reviews/2026-09-24-federated-clash-test-core-p7-d8-node-factor-evidence.md). It MEASURES what P0's capture meter
// (`captureData`, clashtest/util/capture.js: every object, array and primitive is ONE node; keys are free) charges for a
// ClashResult and pins that the §13.6 producer/reader formula (`worstCaseCapturedNodes`, `SCHEMA_NODE_FACTORS.result`)
// covers it: the factor is 35 (was 24), the schema/validator-accepted maximum, and the `maxResultsPerRun` hard ceiling is
// 956,824 (was 1,000,000), the largest value some engine configuration can accept under the byte half of R21-2.
//
// The (d) tests are NOT part of the erratum: they pin the still-open D-8b (ledger) and D-8c (diagnostic) findings and are
// marked `// OPEN GATE D-8b|D-8c: flips only if that gate closes` (see the evidence record's gate definitions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_NODE_FACTORS, SCHEMA_MAX_NODES, RUN_OPTION_CEILINGS, RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS,
  worstCaseCapturedNodes, resolveEngineLimits, resolveRunOptions, ENGINE_LIMIT_CEILINGS, BYTES_PER_NODE,
} from '../../../clashtest/options.js';
import { captureData } from '../../../clashtest/util/capture.js';
import { projectUnitPairs, createResultAccumulator } from '../../../clashtest/results/resultSet.js';
import { checkShapeAndUnknownFields } from '../../../clashtest/results/resultSetSchema.js';
import { validateResultSet } from '../../../clashtest/results/validateResultSet.js';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { ResultSetTooLargeError } from '../../../clashtest/errors.js';
import { createInMemoryResultStore } from '../../../clashtest/results/InMemoryResultStore.js';
import { createEngineWorld } from '../support/engineWorld.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { sealedSet, resealed, unit } from '../support/resultSetFixtures.mjs';
import { maximumShapeSet, ledgerRecordsOf } from '../support/maximumShape.mjs';
import { canonicalJson } from '../../../clashtest/util/canonical.js';

/** P0's own meter on one value (the same traversal `captureResultSet` charges against `maxCapturedNodes`). */
const nodesOf = (value) => {
  const cap = captureData(value, { maxNodes: SCHEMA_MAX_NODES });
  assert.ok(cap.ok, `capture refused: ${JSON.stringify(cap.issues)}`);
  return cap.nodes;
};

const DIGEST = `sha256:${'a'.repeat(64)}`;
const A = 'mA';
const B = 'mB';
const refA = (dbId) => ({ modelKey: A, dbId });
const refB = (dbId) => ({ modelKey: B, dbId });
const ctxFor = (mode, { flagged = false } = {}) => ({
  mode, testId: 'T-D8', semanticDigest: DIGEST, maxResultsPerRun: 10,
  unreachableOwners: flagged ? new Map([[A, new Set([1])]]) : new Map(),
  mixedOwners: flagged ? new Map([[B, new Set([2])]]) : new Map(),
  unitPlanRank: new Map([['u1', 0], ['u2', 1]]),
});
const volumePair = (witness) => ({ source: refA(1), target: refB(2), witness });
const clearancePair = (distance) => ({
  source: refA(1), target: refB(2), distance, clearance: 0.5,
  witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] },
});
const project = (mode, pair, opts) => {
  const [r] = projectUnitPairs({ unitId: 'u1', pairs: [pair] }, ctxFor(mode, opts));
  return r;
};
/** The REAL reconcile path (createResultAccumulator): two units report the same pair with disagreeing evidence, so
 *  the kept result carries `duplicateEvidenceConflict` on top of the plan-derived owner flags. */
const reconciled = (mode, pairA, pairB) => {
  const acc = createResultAccumulator(ctxFor(mode, { flagged: true }));
  acc.addUnit({ unitId: 'u1', pairs: [pairA] });
  acc.addUnit({ unitId: 'u2', pairs: [pairB] });
  const [r] = acc.toArray();
  return r;
};
const SURFACE = { source: refA(1), target: refB(2) };

// ---- (a) the field-by-field charge, measured on the REAL P5 producer --------------------------------------

test('D-8 (a): the fixed 18-node ClashResult frame (resultId, pair, mode, evaluatedAs, unitId, the object itself)', () => {
  const r = project('containment', SURFACE);
  const frame = nodesOf(r) - nodesOf(r.evidence) - nodesOf(r.flags);
  assert.equal(nodesOf(r.pair), 7);          // {first:{modelKey,dbId}, second:{...}} = 1 + 2 x 3
  assert.equal(nodesOf(r.evaluatedAs), 7);   // same shape
  assert.equal(frame, 18);                   // 1 object + resultId + pair(7) + mode + evaluatedAs(7) + unitId
});

test('D-8 (a): per-mode producer charge — min 20, producer max 34, shape-dependent', () => {
  const measured = {
    'containment, no flags': nodesOf(project('containment', SURFACE)),
    'surface-intersection, no flags': nodesOf(project('surface-intersection', SURFACE)),
    'volume-overlap, witness null (+witnessUnavailable)': nodesOf(project('volume-overlap', volumePair(null))),
    'volume-overlap, witness': nodesOf(project('volume-overlap', volumePair({ kind: 'vertex', point: [0, 0, 0] }))),
    'clearance, no flags': nodesOf(project('clearance', clearancePair(0.25))),
    'containment, all producer flags': nodesOf(reconciled('containment', SURFACE, SURFACE)),
    'volume-overlap null, all producer flags': nodesOf(reconciled('volume-overlap', volumePair(null),
      volumePair({ kind: 'vertex', point: [0, 0, 0] }))),
    'volume-overlap witness, all producer flags': nodesOf(reconciled('volume-overlap',
      volumePair({ kind: 'vertex', point: [0, 0, 0] }), volumePair({ kind: 'edge', point: [0, 0, 0] }))),
    'clearance, all producer flags': nodesOf(reconciled('clearance', clearancePair(0.25), clearancePair(0.75))),
  };
  assert.deepEqual(measured, {
    'containment, no flags': 20,
    'surface-intersection, no flags': 20,
    'volume-overlap, witness null (+witnessUnavailable)': 22,
    'volume-overlap, witness': 26,
    'clearance, no flags': 31,
    // containment/surface: unreachableOwner + mixedOwnerProvenance only (evidence always agrees -> no conflict flag)
    'containment, all producer flags': 22,
    'volume-overlap null, all producer flags': 25,
    'volume-overlap witness, all producer flags': 29,
    'clearance, all producer flags': 34,
  });
  // A11: every producer shape is within the corrected factor (it was 24: the ordinary volume result, 26, exceeded it).
  for (const [shape, nodes] of Object.entries(measured)) assert.ok(nodes <= SCHEMA_NODE_FACTORS.result, `${shape}: ${nodes}`);
});

test('D-8 (a): schema-legal maximum is 35 (clearance + all four flags) and the ClashResult shape is CLOSED', async () => {
  const base = structuredClone(await sealedSet('positives'));
  const max = reconciled('clearance', clearancePair(0.25), clearancePair(0.75));
  const legalMax = { ...max, flags: { ...max.flags, witnessUnavailable: true } };   // schema: 4 optional literal-true flags
  assert.equal(nodesOf(legalMax), 35);
  const structural = (result) => {
    const set = structuredClone(base);
    set.results = [result];
    const issues = [];
    checkShapeAndUnknownFields(set, (path, code) => issues.push({ path, code }), {});
    return issues;
  };
  assert.deepEqual(structural(legalMax), [], 'the 35-node result is structurally legal under TYPES.ClashResult');
  // Closure: no extra field anywhere inside a ClashResult is admitted, so 35 is the maximum.
  assert.deepEqual(structural({ ...legalMax, extra: 1 }).map((i) => i.code), ['unknown-field-closed-type']);
  assert.deepEqual(structural({ ...legalMax, flags: { ...legalMax.flags, other: true } }).map((i) => i.code),
    ['unknown-field-closed-type']);
  assert.deepEqual(structural({ ...legalMax, evidence: { ...legalMax.evidence, extra: 1 } }).map((i) => i.code),
    ['unknown-field-closed-type']);
  assert.deepEqual(structural({ ...legalMax, evidence: { ...legalMax.evidence,
    closestPoints: { first: [0, 0, 0, 0], second: [1, 1, 1] } } }).map((i) => i.code), ['array-length-invalid']);
  // A11: the factor IS the attained schema maximum (tight: no shortfall, no slack).
  assert.equal(SCHEMA_NODE_FACTORS.result, 35);
  assert.equal(nodesOf(legalMax), SCHEMA_NODE_FACTORS.result);
});

test('D-8 (a): a FULL validateResultSet-clean sealed set carries a 35-node ClashResult (reader cannot tell writers apart)', async () => {
  // P5's own clearance corpus (every result `validateResultSet`-clean), resealed with all four flags on the result that
  // already carries `unreachableOwner`. `witnessUnavailable` on a clearance result is never set by THIS producer but is
  // admitted by the schema AND by every cross-invariant of validateResultSet, so a conforming writer may emit it.
  const set = await resealed((d) => {
    for (const r of d.results) {
      if (r.flags.unreachableOwner) {
        Object.assign(r.flags, { witnessUnavailable: true, mixedOwnerProvenance: true, duplicateEvidenceConflict: true });
      }
    }
  }, 'schema-corpus');
  assert.deepEqual(validateResultSet(set, { limits: resolveEngineLimits(undefined) }), { ok: true, issues: [] });
  const charges = set.results.map((r) => nodesOf(r));
  assert.equal(Math.max(...charges), 35);
  // A11: the reader-side maximum is covered by the factor.
  assert.ok(Math.max(...charges) <= SCHEMA_NODE_FACTORS.result);
});

// ---- (b) the worst-case arithmetic at the schema ceilings, and the reconciled maxResultsPerRun ceiling ------------

test('D-8 (b): SCHEMA_MAX_NODES and the provisional-default worst case under factor 35', () => {
  const R = RUN_OPTION_CEILINGS.maxResultsPerRun;
  assert.equal(R, 956_824);
  assert.equal(SCHEMA_NODE_FACTORS.result * R, 33_488_840);
  assert.equal(SCHEMA_MAX_NODES, 35 * 956_824 + 12 * 20_000_000 + 12 * 100_000 + 65_536);
  assert.equal(SCHEMA_MAX_NODES, 274_754_376);
  const defaultsWorst = worstCaseCapturedNodes(RUN_OPTION_DEFAULTS);
  assert.equal(defaultsWorst, 15_685_536);
  assert.ok(defaultsWorst <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes, 'the defaults still satisfy R21-2 under 35');
});

test('D-8 (b): the maxResultsPerRun ceiling is exactly the largest value any engine configuration can accept', () => {
  // The byte half of R21-2 caps every engine at maxCapturedNodes <= floor(maxStoredResultBytes ceiling / BYTES_PER_NODE).
  const byteCap = Math.floor(ENGINE_LIMIT_CEILINGS.maxStoredResultBytes / BYTES_PER_NODE);
  assert.equal(byteCap, 33_554_432);
  // The smallest legal ledger (maxLedgerRecords >= maxPlanReferences + 2 x maxUnitsPerRun = 1 + 2) and no diagnostics.
  const smallest = { maxUnitsPerRun: 1, maxPlanReferences: 1, maxLedgerRecords: 3, maxRetainedDiagnostics: 0 };
  const derived = Math.floor((byteCap - SCHEMA_NODE_FACTORS.ledger * 3 - SCHEMA_NODE_FACTORS.slack) / SCHEMA_NODE_FACTORS.result);
  assert.equal(derived, 956_824);
  assert.equal(RUN_OPTION_CEILINGS.maxResultsPerRun, derived);
  // Reachable: options AT the ceiling are accepted by an engine configured at the byte cap.
  const limits = resolveEngineLimits({ maxCapturedNodes: byteCap, maxStoredResultBytes: ENGINE_LIMIT_CEILINGS.maxStoredResultBytes });
  const atCeiling = { ...smallest, maxResultsPerRun: RUN_OPTION_CEILINGS.maxResultsPerRun };
  assert.equal(worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...atCeiling }), 33_554_412);
  assert.equal(resolveRunOptions(atCeiling, limits).maxResultsPerRun, RUN_OPTION_CEILINGS.maxResultsPerRun);
  // Maximal: one more result could never be readable (and is refused as above-ceiling anyway).
  assert.ok(worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...atCeiling, maxResultsPerRun: derived + 1 }) > byteCap);
  assert.throws(() => resolveRunOptions({ ...atCeiling, maxResultsPerRun: derived + 1 }, limits),
    (err) => err.issues?.some((i) => i.path === '/maxResultsPerRun' && i.code === 'above-ceiling'));
  // The former 1,000,000 ceiling is unreachable under factor 35 by every engine configuration.
  assert.ok(worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...smallest, maxResultsPerRun: 1_000_000 }) > byteCap);
});

// ---- (c) the former contradiction, now closed: accepted options, readable read-back -------------------------

/** A results-heavy option set sized so the set's plan-table records fit `maxPlanReferences` (100 source roots + 1
 *  target root, 100 + 400 owners, 100 unit records, 200 unit ranges ~= 900 < 1,000). */
const GAP = Object.freeze({ results: 40_000, units: 100 });
const GAP_OPTIONS = Object.freeze({
  maxResultsPerRun: GAP.results, maxUnitsPerRun: GAP.units, maxPlanReferences: 1_000,
  maxLedgerRecords: 1_000 + 2 * GAP.units, maxRetainedDiagnostics: 0,
});

test('D-8 (c): options resolveRunOptions accepts yield a legal set the same engine reads back (R21-2 holds)', async () => {
  const worst = worstCaseCapturedNodes({ ...RUN_OPTION_DEFAULTS, ...GAP_OPTIONS });
  assert.equal(worst, 35 * 40_000 + 12 * 1_200 + 12 * 0 + 65_536);   // 1,479,936 (was 1,039,936 under 24)
  const limits = resolveEngineLimits({ maxCapturedNodes: worst });
  const runOptions = resolveRunOptions(GAP_OPTIONS, limits);          // ACCEPTED: the invariant says "readable"
  const set = await maximumShapeSet({ resultCount: GAP.results, ledgerRecordCount: GAP.units, diagnosticCount: 0 },
    { runId: 'run-d8-gap', runOptions });
  // Every count the formula is keyed on is within the accepted options.
  assert.equal(set.results.length, runOptions.maxResultsPerRun);
  assert.equal(set.ledger.units.length, runOptions.maxUnitsPerRun);
  assert.ok(ledgerRecordsOf(set) <= runOptions.maxLedgerRecords);
  assert.equal(set.diagnostics.diagnostics.length, runOptions.maxRetainedDiagnostics);
  // A VALID set (producer-shaped by the P7.9 synthesizer, not the output of an executed run): every cross-invariant holds.
  assert.deepEqual(validateResultSet(set, { limits: resolveEngineLimits(undefined) }), { ok: true, issues: [] });
  const measured = nodesOf(set);
  assert.equal(nodesOf(set.results[0]), 26);                          // the ordinary volume-overlap-with-witness shape
  assert.equal(measured, 1_043_336);
  assert.ok(measured <= worst, `measured ${measured} <= formula ${worst}`);
  // The real reader refuses it: the engine's by-id read path (store get -> P5 captureResultSet -> node ceiling).
  const store = createInMemoryResultStore();
  await store.put(set);
  const engine = createClashTestEngine(createEngineWorld().config({
    now: createFakeClock({ start: Date.UTC(2026, 8, 24) }).now, scheduleTimeout: () => () => {}, resultStore: store, limits,
  }));
  const outcome = await engine.getResultSet(set.runId).then((read) => read, (err) => err);
  assert.ok(!(outcome instanceof ResultSetTooLargeError), String(outcome));
  assert.equal(canonicalJson(outcome), canonicalJson(set));
});

// ---- (d) the other two factors: single-record counterexamples (OPEN gates D-8b / D-8c; findings, not fixes) ---

test('D-8 (d): one retained diagnostic can exceed 12 nodes (diagnostic factor finding)', () => {
  const frag = (fragId, role) => ({ modelKey: A, dbId: 1, fragId, role });
  const pairDiag = (unitIds) => ({
    scope: 'pair', reason: 'r', completenessAffecting: true, attribution: 'element',
    fragments: { first: frag(1, 'source'), second: frag(2, 'target') }, ambiguousModelId: true,
    occurrences: 1, unitIds,
  });
  const ids = (n) => Array.from({ length: n }, (_, i) => `u${i}`);
  assert.equal(nodesOf(pairDiag(ids(1))), 20);
  assert.equal(nodesOf(pairDiag(ids(RUN_OPTION_DEFAULTS.maxUnitIdsPerDiagnostic))), 27);
  assert.equal(nodesOf(pairDiag(ids(RUN_OPTION_CEILINGS.maxUnitIdsPerDiagnostic))), 83);
  // OPEN GATE D-8c: flips only if that gate closes (the A11 erratum deliberately left the diagnostic factor at 12).
  assert.ok(nodesOf(pairDiag(ids(1))) > SCHEMA_NODE_FACTORS.diagnostic);
});

test('D-8 (d): one unit record expands its ranges into ids, so nodes are not bounded by 12 x records (ledger finding)', () => {
  // planning/sizing.js `unitRecordFields`: sourceRootDbIds / targets[].rootDbIds are EXPANDED from range records, and
  // the budget charges `unit-record` 1 + `unit-range` (one per range), not one per id.
  const S = RUN_OPTION_DEFAULTS.maxSourceDbIdsPerUnit;               // 500 contiguous roots = ONE source range
  const rec = unit('u0', 'evaluated', {
    kind: 'leaf', parentUnitId: null, sourceModelKey: A,
    sourceRootDbIds: Array.from({ length: S }, (_, i) => i + 1),
    targets: [{ modelKey: B, scope: 'model' }],
  });
  const budgetRecords = 1 /* unit-record */ + 2 /* source range + whole-model target entry */ + 1 /* overflow reserve */;
  assert.equal(nodesOf(rec), 17 + S + 3);
  // OPEN GATE D-8b: flips only if that gate closes (the A11 erratum deliberately left the ledger factor at 12).
  assert.ok(nodesOf(rec) > SCHEMA_NODE_FACTORS.ledger * budgetRecords);
});
