// test/clashtest/support/maximumShape.mjs
//
// Task P7.9 (AC-12, §13.6 producer/reader invariant): the maximum-shape Result Set and its node meter.
//
//   maximumShapeSet({resultCount, ledgerRecordCount, diagnosticCount}, {runId?, resultShape?}) -> Promise<ResultSet>
//   measuredNodes(set) -> number      // P0 captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes
//
// Built through P5's OWN producer pipeline (`buildResultSet` + `sealResultSet`, preflight ruling (b)):
// a set whose digests P5 computed itself, so `readResultSet`'s digest recomputation and every other
// read-time invariant hold by construction rather than by hand-maintained hashes. The row helpers
// (`unit`, `ledgerWith`, `emptyDiagnostics`, `baseProvenance`, `provenanceModel`, `fakeSlicer`) are
// resultSetFixtures.mjs's, so this family cannot drift from the P5 fixtures; only the COUNTS are new.
//
// Shape (validator-clean at any count the schema admits):
//   - `U = min(ledgerRecordCount, UNIT_CAP)` leaf units `u0..u{U-1}`; unit i owns ONE source root of
//     model mA (cls A) against the ONE target root of mB (cls B) — the exact-cover layout of
//     `widePlan` (P5-REM9), so `coverage: 'full'` is the true derived value.
//   - `ledgerRecordCount` counts what the engine's rerun predicate (ii) counts (P7.7, R-P7-21):
//     unit records plus per-unit taint entries. The `ledgerRecordCount - U` taints are spread
//     round-robin, one distinct extra owner of the unit's source root each (so every taint names a
//     real, distinct element). They are SHAPE rows: schema- and validator-valid, not a semantically
//     derived taint set (P7.9 measures size, not taint semantics).
//   - `resultCount` pairs `(a_i, b_j)`: unit i's first source owner against the mB root's owners,
//     `ceil(resultCount / U)` of them, filled unit by unit in canonical order.
//   - `resultShape` (D-8 erratum A11): `'ordinary'` (default) is the volume-overlap-with-witness result
//     (26 captured nodes); `'worst'` is the §13.6 WORST-CASE ClashResult the schema and validator admit
//     (35 nodes): a `clearance` definition, `ClearanceEvidence`, and all four flags. `unreachableOwner`
//     needs a pair owner outside every root's owners, so in that shape mB's pair owners move from its
//     root's `ownerDbIds` to `ledger.unreachablePopulation` (the mB root then owns only itself), and
//     `duplicateEvidenceConflict` makes `integrity: 'caveated'` the derived value.
//   - `diagnosticCount` retained, NON-completeness-affecting `witness-unavailable` fragment
//     diagnostics (occurrences 1, distinct fragIds), so `integrity: 'clean'` stays the derived value
//     and the P4 counter invariants (Σ, upper bound, retained sum) hold exactly.
//   - modelKeys are the engine world's `mA`/`mB` (support/engineWorld.mjs, both at `modelVersion`
//     'v1'), so a `rerun` of the read set re-plans against a world that binds them.
//   - `provenance.runOptions` = `runOptionsFor(shape)`: the §17.1 defaults, raised only where a
//     calibration override pushes a count past its default (the set must have been producible).
//
// G-EC: `provenance.models[].elementCount` is whatever `provenanceModel` writes (an opaque pass-through);
// nothing here or in P7.9 reads or asserts it. G-CAL: no §17.1 default is restated — every default is
// imported from options.js, and the tier sizes below are named TEST values, overridable from the
// environment so a calibrated run needs no code edit.
import { captureData } from '../../../clashtest/util/capture.js';
import {
  RUN_OPTION_DEFAULTS, RUN_OPTION_CEILINGS, ENGINE_LIMIT_DEFAULTS, ENGINE_LIMIT_CEILINGS, SCHEMA_MAX_NODES,
  BYTES_PER_NODE, worstCaseCapturedNodes,
} from '../../../clashtest/options.js';
import { buildResultSet, sealResultSet, compareResults } from '../../../clashtest/results/resultSet.js';
import { makeResultId, makePairId } from '../../../clashtest/identity/ids.js';
import { computeSemanticDigest } from '../../../clashtest/definition/normalize.js';
import { attributionOf } from '../../../clashtest/execution/diagnostics.js';
import {
  unit, ledgerWith, emptyDiagnostics, baseProvenance, provenanceModel, fakeSlicer,
} from './resultSetFixtures.mjs';

// ---- the tier table (G-CAL input; every entry overridable) -------------------------------------------

const envCount = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`maximumShape: ${name} must be a non-negative integer (got ${raw})`);
  return n;
};

/** Named TEST sizes (not §17.1 defaults): the committed suite's scaled tier, and the ledger tier's
 *  default record count (a fifth of the provisional `maxLedgerRecords`, so the default suite stays fast). */
const SCALED = Object.freeze({ resultCount: 2_000, ledgerRecordCount: 20_000, diagnosticCount: 2_000 });
const LEDGER_TIER_RECORDS = RUN_OPTION_DEFAULTS.maxLedgerRecords / 5;
const MINOR_COUNT = 100;
const RESULTS_TIER_LEDGER = 1_000;

/**
 * A shape is "maximum" for ONE dimension (spec §17.1.1 note: the hard ceilings are jointly
 * unreachable, so the maximum shape is the largest invariant-satisfying configuration per axis).
 * `scaled` runs in the committed suite; `ledger`/`results` default to the provisional
 * `maxLedgerRecords`-derived tier and to `maxResultsPerRun` itself, and a calibration run raises them
 * through `CLASHTEST_MAX_LEDGER` / `CLASHTEST_MAX_RESULTS` (and `CLASHTEST_MAX_DIAGNOSTICS`).
 */
export const PROVISIONAL_SHAPES = Object.freeze({
  scaled: SCALED,
  ledger: Object.freeze({
    resultCount: MINOR_COUNT,
    ledgerRecordCount: envCount('CLASHTEST_MAX_LEDGER', LEDGER_TIER_RECORDS),
    diagnosticCount: MINOR_COUNT,
  }),
  results: Object.freeze({
    resultCount: envCount('CLASHTEST_MAX_RESULTS', RUN_OPTION_DEFAULTS.maxResultsPerRun),
    ledgerRecordCount: RESULTS_TIER_LEDGER,
    diagnosticCount: envCount('CLASHTEST_MAX_DIAGNOSTICS', MINOR_COUNT),
  }),
});

/** One tenth of a shape's counts (at least 1 each): the "deliberately small" twin AC-12(a)'s
 *  size-dependence check compares against. */
export const tenthOf = (shape) => Object.freeze(Object.fromEntries(
  Object.entries(shape).map(([k, v]) => [k, Math.max(1, Math.floor(v / 10))])));

// ---- run options / engine limits a shape was produced under ------------------------------------------

/** The run options a set of this shape is producible under: the §17.1 defaults, with a count raised
 *  only when the shape exceeds its default (a calibration override). At the committed tiers this is
 *  exactly `RUN_OPTION_DEFAULTS`. */
export function runOptionsFor({ resultCount, ledgerRecordCount, diagnosticCount }) {
  return {
    ...RUN_OPTION_DEFAULTS,
    maxResultsPerRun: Math.max(RUN_OPTION_DEFAULTS.maxResultsPerRun, resultCount),
    maxLedgerRecords: Math.max(RUN_OPTION_DEFAULTS.maxLedgerRecords, ledgerRecordCount),
    maxRetainedDiagnostics: Math.max(RUN_OPTION_DEFAULTS.maxRetainedDiagnostics, diagnosticCount),
  };
}

/**
 * The engine `limits` under which `runOptions` satisfy the §13.6 producer/reader invariant: `{}` (the
 * provisional defaults) when they already do, else `maxCapturedNodes` raised to the worst case and
 * `maxStoredResultBytes` to its byte image. Throws when even the hard ceilings cannot hold it — the
 * §17.1.1 note's "jointly unreachable" region, which no conforming engine can be configured for.
 */
export function engineLimitsFor(runOptions) {
  const worst = worstCaseCapturedNodes(runOptions);
  if (worst <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes) return {};
  const bytes = worst * BYTES_PER_NODE;
  if (worst > ENGINE_LIMIT_CEILINGS.maxCapturedNodes || bytes > ENGINE_LIMIT_CEILINGS.maxStoredResultBytes) {
    throw new RangeError(`maximumShape: worst case ${worst} nodes / ${bytes} bytes exceeds the engine-limit ceilings `
      + '(spec §17.1.1: the hard ceilings are jointly unreachable)');
  }
  return {
    maxCapturedNodes: worst,
    maxStoredResultBytes: Math.max(ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes, bytes),
  };
}

// ---- the set ------------------------------------------------------------------------------------------

export const SHAPE_MODEL_A = 'mA';
export const SHAPE_MODEL_B = 'mB';
/** Units are capped by the provisional `maxUnitsPerRun` and by the schema's roots-per-model ceiling
 *  (`RootOwners.owners`: `maxEntriesPerSelection`'s ceiling), whichever is lower. */
export const UNIT_CAP = Math.min(RUN_OPTION_DEFAULTS.maxUnitsPerRun, ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection);
const TARGET_ROOT = 1;                     // mB's one root; its owners start right after it
const SOURCE_BASE = 1_000_000;             // mA dbIds, far from any mB id (distinct models anyway)
const DIAGNOSTIC_REASON = 'witness-unavailable';     // P4: the one NON-completeness-affecting reason

const ref = (modelKey, dbId) => ({ modelKey, dbId });
const count = (name, v, min) => {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`maximumShapeSet: ${name} must be an integer >= ${min} (got ${v})`);
  return v;
};

/**
 * @param {{resultCount: number, ledgerRecordCount: number, diagnosticCount: number}} shape
 * @param {{runId?: string, testId?: string, runOptions?: object}} [options]  `runOptions`: the options the set
 *   records as produced under (default `runOptionsFor(shape)`); only `provenance.runOptions` and the ledger
 *   digest's sizing projection read it.
 * @returns {Promise<object>} a sealed, deep-frozen, `validateResultSet`-clean ResultSet
 */
export async function maximumShapeSet({ resultCount, ledgerRecordCount, diagnosticCount }, { runId, testId = 'T-AC12', runOptions: recorded, resultShape = 'ordinary' } = {}) {
  if (resultShape !== 'ordinary' && resultShape !== 'worst') throw new RangeError(`maximumShapeSet: unknown resultShape ${resultShape}`);
  const worst = resultShape === 'worst';
  const mode = worst ? 'clearance' : 'volume-overlap';
  count('resultCount', resultCount, 0);
  count('ledgerRecordCount', ledgerRecordCount, 1);
  count('diagnosticCount', diagnosticCount, 0);
  if (resultCount > RUN_OPTION_CEILINGS.maxResultsPerRun || ledgerRecordCount > RUN_OPTION_CEILINGS.maxLedgerRecords
      || diagnosticCount > RUN_OPTION_CEILINGS.maxRetainedDiagnostics) {
    throw new RangeError('maximumShapeSet: a count exceeds its §17.1.1 hard ceiling');
  }
  const runOptions = recorded ?? runOptionsFor({ resultCount, ledgerRecordCount, diagnosticCount });

  const unitCount = Math.min(ledgerRecordCount, UNIT_CAP);
  const taintCount = ledgerRecordCount - unitCount;
  const pairsPerUnit = Math.ceil(resultCount / unitCount);

  const definition = {
    schemaVersion: 1, testId, revision: 1, name: 'ac-12 maximum shape',
    selectionA: { entries: [{ kind: 'model', modelKey: SHAPE_MODEL_A }] },
    selectionB: { entries: [{ kind: 'model', modelKey: SHAPE_MODEL_B }] },
    mode,
    ...(worst ? { clearance: 5 } : {}),
  };
  const semanticDigest = computeSemanticDigest(definition);

  // mB: one root owning `max(1, pairsPerUnit)` elements.
  const targetOwners = [];
  for (let j = 0; j < Math.max(1, pairsPerUnit); j += 1) targetOwners.push(TARGET_ROOT + 1 + j);

  // mA: one root per unit; its owners are the pair owner plus one distinct owner per taint.
  const units = [];
  const ownersA = [];
  const pairOwnerOf = [];
  let nextDbId = SOURCE_BASE;
  for (let i = 0; i < unitCount; i += 1) {
    const taintsHere = Math.floor(taintCount / unitCount) + (i < taintCount % unitCount ? 1 : 0);
    const rootDbId = nextDbId;
    const owners = [];
    for (let k = 0; k <= taintsHere; k += 1) owners.push(nextDbId++);
    const taints = owners.slice(1).map((dbId) => ({
      kind: 'element', modelKey: SHAPE_MODEL_A, dbId, reason: DIAGNOSTIC_REASON, occurrences: 1,
    }));
    units.push(unit(`u${i}`, 'evaluated', {
      kind: 'leaf', parentUnitId: null, sourceModelKey: SHAPE_MODEL_A, sourceRootDbIds: [rootDbId],
      targets: [{ modelKey: SHAPE_MODEL_B, scope: 'roots', rootDbIds: [TARGET_ROOT] }],
      pairSpaceWeight: 1, taints,
    }));
    ownersA.push({ rootDbId, ownerDbIds: owners, cls: 'A' });
    pairOwnerOf.push(owners[0]);
  }

  const results = [];
  for (let i = 0; i < unitCount && results.length < resultCount; i += 1) {
    for (let j = 0; j < pairsPerUnit && results.length < resultCount; j += 1) {
      const source = ref(SHAPE_MODEL_A, pairOwnerOf[i]);
      const target = ref(SHAPE_MODEL_B, targetOwners[j]);
      // `pair` and `evaluatedAs` are built from INDEPENDENT ref objects: a shared object would be
      // captured as `cyclic` (see resultSetFixtures.mjs's `ref` note).
      const pair = makePairId(mode, ref(SHAPE_MODEL_A, pairOwnerOf[i]), ref(SHAPE_MODEL_B, targetOwners[j]));
      results.push({
        resultId: makeResultId(testId, semanticDigest, pair), pair, mode,
        evaluatedAs: { source, target },
        ...(worst
          ? {
            evidence: { distance: 1.5, clearance: 5, closestPoints: { first: [0, 0, 0], second: [1, 0, 0] } },
            flags: { witnessUnavailable: true, duplicateEvidenceConflict: true, unreachableOwner: true, mixedOwnerProvenance: true },
          }
          : { evidence: { witness: { kind: 'vertex', point: [0, 0, 0] } }, flags: {} }),
        unitId: `u${i}`,
      });
    }
  }
  results.sort(compareResults);

  const diagnostics = emptyDiagnostics();
  for (let d = 0; d < diagnosticCount; d += 1) {
    const i = d % unitCount;
    const projected = {
      scope: 'fragment', reason: DIAGNOSTIC_REASON, completenessAffecting: false,
      fragment: { modelKey: SHAPE_MODEL_A, dbId: pairOwnerOf[i], fragId: d },
    };
    projected.attribution = attributionOf(projected);
    diagnostics.diagnostics.push({ ...projected, occurrences: 1, unitIds: [`u${i}`] });
  }
  diagnostics.total = diagnosticCount;
  if (diagnosticCount > 0) diagnostics.countsByReason = [{ scope: 'fragment', reason: DIAGNOSTIC_REASON, count: diagnosticCount }];

  const parts = {
    runId: runId ?? `run-ac12-${resultCount}-${ledgerRecordCount}-${diagnosticCount}`,
    testRef: { testId, revision: 1, semanticDigest },
    definition,
    derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: worst ? 'caveated' : 'clean', freshness: 'current',
      environmentSensitive: false, environmentSensitiveCauses: [], reasons: [],
    },
    provenance: baseProvenance({
      runOptions,
      broadPhase: runOptions.broadPhase,
      models: [provenanceModel(SHAPE_MODEL_A), provenanceModel(SHAPE_MODEL_B)],
    }),
    ledger: ledgerWith({
      pairSpaceTotal: unitCount,
      units,
      rootOwners: [
        { modelKey: SHAPE_MODEL_A, owners: ownersA },
        { modelKey: SHAPE_MODEL_B, owners: [{ rootDbId: TARGET_ROOT, ownerDbIds: worst ? [TARGET_ROOT] : targetOwners, cls: 'B' }] },
      ],
      ...(worst ? { unreachablePopulation: [{ modelKey: SHAPE_MODEL_B, count: targetOwners.length, ownerDbIds: targetOwners, mixedOwnerDbIds: [],
        unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }] } : {}),
    }),
    results,
    diagnostics,
    statistics: {},
  };
  return sealResultSet(buildResultSet(parts), { slicer: fakeSlicer() });
}

/**
 * The MEASURED captured-node count of a concrete set: P0's own meter, `captureData(set, {maxNodes:
 * SCHEMA_MAX_NODES}).nodes` (P0 ships no per-set counter; the §13.6 worst-case FORMULA is P0's
 * `worstCaseCapturedNodes`). Throws when the capture itself refuses the value (e.g. a live set whose
 * `pair.first` and `evaluatedAs.source` are one shared object reads as `cyclic`): a partial count
 * must never pass for a measurement. Measure a store read-back copy in that case.
 */
export function measuredNodes(set) {
  const cap = captureData(set, { maxNodes: SCHEMA_MAX_NODES });
  if (!cap.ok) throw new Error(`measuredNodes: capture refused the value (${cap.issues.map((i) => i.code).join(', ')})`);
  return cap.nodes;
}

/** The ledger-record count the rerun predicate (ii) charges (P7.7): unit records + their taints. */
export function ledgerRecordsOf(set) {
  let n = set.ledger.units.length;
  for (const u of set.ledger.units) n += u.taints.length;
  return n;
}

// ---- AC-12(b) records: recorded, never gated -------------------------------------------------------------

/** Span summary per label, `{count, totalMs, maxMs}` — G-CAL input, compared to nothing. */
export function summarizeSpans(spans) {
  const out = {};
  for (const { label, ms } of spans) {
    const s = (out[label] ??= { count: 0, totalMs: 0, maxMs: 0 });
    s.count += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
  }
  return out;
}

/** One `[AC-12] <label> <json>` record. Always BUILT (a record that cannot serialize fails the test);
 *  EMITTED through the test's diagnostic channel only when `CLASHTEST_AC12_LOG` is set, so the committed
 *  suite's output stays pristine while a calibration run captures every figure. */
export function recordAc12(t, label, payload) {
  const line = `[AC-12] ${label} ${JSON.stringify(payload)}`;
  if ((process.env.CLASHTEST_AC12_LOG ?? '') !== '') t.diagnostic(line);
  return line;
}
