// test/clashpanel/support/resultFixtures.mjs
// Hand-built SEALED result sets for controller/filter/list tests. They follow the REAL shapes (catalog 1, verified from
// clashtest/results/*): deep-frozen plain data; `resultId` a JSON string (opaque to the Panel); `pair` in canonical order
// (modelKey code-unit order, then dbId); `evaluatedAs`; `flags` present only when true; provenance and ledger rows built
// from the real clashtest fixture helpers so their shapes cannot drift. They need NOT pass validateResultSet (only a fake
// engine reads them); a real-engine contract test (Task 20) uses real sealed sets instead.
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/index.js';
import {
  baseProvenance, emptyDiagnostics, ledgerWith, provenanceModel, unit,
} from '../../clashtest/support/resultSetFixtures.mjs';

export const MODEL_A = 'urn:test:model-a';
export const MODEL_B = 'urn:test:model-b';
export const MODEL_C = 'urn:test:model-c';
export const DIGEST = `sha256:${'a'.repeat(64)}`;

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const refCmp = (x, y) => cmp(x.modelKey, y.modelKey) || (x.dbId - y.dbId);
const pairCmp = (x, y) => refCmp(x.pair.first, y.pair.first) || refCmp(x.pair.second, y.pair.second);
const ref = (r) => ({ modelKey: r.modelKey, dbId: r.dbId });

export const resultIdOf = (testId, digest, first, second) => JSON.stringify([testId, digest, first.modelKey, first.dbId, second.modelKey, second.dbId]);
/** The real `element` facet group id (clashtest/derive): JSON of ['element', {}, {dbId, modelKey}] with sorted keys. */
export const groupIdOf = (r) => JSON.stringify(['element', {}, { dbId: r.dbId, modelKey: r.modelKey }]);

/** A hard (volume-overlap) positive. `witness: null` yields the real `witnessUnavailable` flag. */
export function hardResult(a, b, { testId = 'T-1', digest = DIGEST, witness = { kind: 'vertex', point: [0, 0, 0] }, unitId = 'u1', flags = {} } = {}) {
  const [first, second] = refCmp(a, b) <= 0 ? [ref(a), ref(b)] : [ref(b), ref(a)];
  return {
    resultId: resultIdOf(testId, digest, first, second), pair: { first, second }, mode: 'volume-overlap',
    evaluatedAs: { source: ref(first), target: ref(second) }, evidence: { witness },
    flags: { ...(witness === null ? { witnessUnavailable: true } : {}), ...flags }, unitId,
  };
}

/** A soft (clearance) result with a real `distance` and closest points. */
export function softResult(a, b, { distance = 0.05, clearance = 0.25, testId = 'T-1', digest = DIGEST, unitId = 'u1', closestPoints, flags = {} } = {}) {
  const [first, second] = refCmp(a, b) <= 0 ? [ref(a), ref(b)] : [ref(b), ref(a)];
  return {
    resultId: resultIdOf(testId, digest, first, second), pair: { first, second }, mode: 'clearance',
    evaluatedAs: { source: ref(first), target: ref(second) },
    evidence: { distance, clearance, closestPoints: closestPoints ?? { first: [0, 0, 0], second: [distance, 0, 0] } }, flags, unitId,
  };
}

/** `n` distinct hard results between MODEL_A dbIds 1..n and MODEL_B dbIds 100001..100000+n, in canonical order. */
export function manyResults(n, { modelA = MODEL_A, modelB = MODEL_B, testId = 'T-1' } = {}) {
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = hardResult({ modelKey: modelA, dbId: i + 1 }, { modelKey: modelB, dbId: 100001 + i }, { testId });
  return out.sort(pairCmp);
}

const leafUnit = (id, outcome, over = {}) => ({
  ...unit(id, outcome, over), kind: 'leaf', parentUnitId: null, sourceModelKey: MODEL_A, sourceRootDbIds: [10],
  targets: [{ modelKey: MODEL_B, scope: 'model' }],
});

/**
 * @param {object} [o]
 * @param {object[]} [o.results]        ClashResult records (sorted canonically here)
 * @param {'volume-overlap'|'clearance'} [o.mode]
 * @param {number|null} [o.clearance]   definition clearance for a soft set
 * @param {object|null} [o.definition]  undefined = derived; null = a pre-plan seal (definition and testRef.revision null)
 * @param {object} [o.outcome]          overrides on {status:'completed', coverage:'full', integrity:'clean', freshness:'current', ...}
 * @param {object} [o.ledger]           overrides on the real ledger defaults (planningGaps, units, hierarchyInternal, ...)
 * @param {Array<{modelKey:string, modelVersion?:string, bindingGeneration?:number, placementGeneration?:number}>|null} [o.provenanceModels]
 *        default [MODEL_A, MODEL_B] with modelVersion 'v1', bindingGeneration 0. `[]` models an empty (pre-plan) seal.
 * @param {number} [o.maxResultsPerRun] recorded in provenance.runOptions (spec 13 result-cap wording)
 */
export function makeSealedSet({
  results = [], mode = 'volume-overlap', clearance = null, runId = 'run-1', testId = 'T-1', revision = 1, name = 'Clash test 1',
  definition, outcome = {}, ledger = {}, provenanceModels = null, provenance = {}, diagnostics = {}, maxResultsPerRun,
} = {}) {
  const models = (provenanceModels ?? [{ modelKey: MODEL_A }, { modelKey: MODEL_B }]).map(({ modelKey, ...over }) => provenanceModel(modelKey, over));
  const def = definition === undefined ? {
    schemaVersion: 1, testId, revision, name,
    selectionA: { entries: [{ kind: 'model', modelKey: MODEL_A }] }, selectionB: { entries: [{ kind: 'model', modelKey: MODEL_B }] },
    mode, ...(mode === 'clearance' ? { clearance: clearance ?? 0.25 } : {}),
  } : definition;
  const runOptions = { ...RUN_OPTION_DEFAULTS, ...(maxResultsPerRun === undefined ? {} : { maxResultsPerRun }) };
  return deepFreeze({
    schemaVersion: 1, runId,
    testRef: { testId, revision: def === null ? null : revision, semanticDigest: def === null ? null : DIGEST },
    definition: def, derivedFromRunId: null,
    outcome: {
      status: 'completed', coverage: 'full', integrity: 'clean', freshness: 'current', environmentSensitive: false,
      environmentSensitiveCauses: [], reasons: [], ...outcome,
    },
    provenance: baseProvenance({ models, runOptions, ...provenance }),
    ledger: ledgerWith({ pairSpaceTotal: Math.max(results.length, 1), units: [leafUnit('u1', 'evaluated')], ...ledger }),
    results: [...results].sort(pairCmp),
    diagnostics: { ...emptyDiagnostics(), ...diagnostics }, statistics: {},
    digests: { digestVersion: 1, pairSetDigest: DIGEST, ledgerDigest: DIGEST }, sealed: true,
  });
}

/** n hard positives (MODEL_A 100+i vs MODEL_B 200+i); `unlocated` = indexes whose witness is unavailable. */
export function hardSet(n = 3, { unlocated = [], ...over } = {}) {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    results.push(hardResult({ modelKey: MODEL_A, dbId: 100 + i }, { modelKey: MODEL_B, dbId: 200 + i }, {
      witness: unlocated.includes(i) ? null : { kind: 'vertex', point: [i, i + 1, i + 2] },
    }));
  }
  return makeSealedSet({ results, ...over });
}

/** One soft result per distance (MODEL_A 100+i vs MODEL_B 200+i) with the real clearance evidence. */
export function softSet(distances = [0.01, 0.05, 0.2], { clearance = 0.25, ...over } = {}) {
  const results = distances.map((distance, i) => softResult({ modelKey: MODEL_A, dbId: 100 + i }, { modelKey: MODEL_B, dbId: 200 + i }, { distance, clearance }));
  return makeSealedSet({ results, mode: 'clearance', clearance, ...over });
}

/** completed / full / clean / current with zero results: the one shape from which a no-clash claim can be allowed. */
export const emptyCompletedClean = (over = {}) => makeSealedSet({ results: [], ...over });

/** completed but partial: a second unit failed (capacity), like the real 'positives' fixture. */
export function partialSet(n = 2, over = {}) {
  const base = hardSet(n);
  return makeSealedSet({
    results: [...base.results], outcome: { coverage: 'partial' },
    ledger: { units: [leafUnit('u1', 'evaluated'), leafUnit('u2', 'failed', { cause: 'capacity-exceeded', capacityKind: 'bucket-capacity', scopeProof: 'not-checked', pairSpaceWeight: 5 })] },
    ...over,
  });
}

/** A failed seal, e.g. failedSet({ reasons: ['result-cap'], maxResultsPerRun: 5 }) or a planning failure with no results. */
export function failedSet({ reasons = ['internal-error'], resultCount = 0, planningGaps = [], ...over } = {}) {
  const base = hardSet(resultCount);
  return makeSealedSet({
    results: [...base.results], outcome: { status: 'failed', coverage: 'partial', reasons }, ledger: { planningGaps }, ...over,
  });
}

/** The real `derivations.groupBy(set, ['element'])` response for a set (multi-valued: each result lists under both elements). */
export function elementGroupsFor(set) {
  const groups = new Map();
  for (const r of set.results) {
    for (const side of [r.pair.first, r.pair.second]) {
      const id = groupIdOf(side);
      if (!groups.has(id)) groups.set(id, { groupId: id, path: [id], facetId: 'element', params: {}, value: ref(side), count: 0, members: [] });
      const g = groups.get(id);
      g.members.push(r.resultId);
      g.count += 1;
    }
  }
  return {
    facets: [{ facetId: 'element', params: {}, multiValued: true }], unavailable: [], total: set.results.length,
    memberships: set.results.length * 2, groups: [...groups.values()].sort((x, y) => refCmp(x.value, y.value)),
  };
}

/** The real `derivations.filter(set, [{facet:'caveated', op:'eq', value:true}])` response for the given caveated ids. */
export function caveatedFilterFor(set, caveatedIds = []) {
  const wanted = new Set(caveatedIds);
  const matches = set.results.filter((r) => wanted.has(r.resultId)).map((r) => r.resultId);
  return { matches, count: matches.length, total: set.results.length, unavailable: [] };
}

/**
 * The real `derivations.summarize(set)` response for a hand-built set, mirroring clashtest/derive/summarize.js.
 * ONLY the fields the Panel reads are supported: runId, status, environmentSensitive, axes, totalResults, unitOutcomes,
 * planningGaps (cause-keyed `{cause, count}` rows) and gapWeight. It deliberately omits `resultsByMode`,
 * `resultsByPairModels`, `resultsByCrossModel`, `resultsCaveated` and `caveats`; the agreement test compares only these keys.
 */
export function summaryFor(set) {
  const sortedRows = (map) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
  const bump = (map, key, seed) => { const e = map.get(key); if (e) e.count += 1; else map.set(key, { ...seed, count: 1 }); };
  const outcomes = new Map();
  let gapWeight = 0;
  for (const u of set.ledger.units) {
    if (u.outcome === 'split') continue;
    bump(outcomes, `${u.outcome}\u0000${u.cause ?? ''}`, { outcome: u.outcome, cause: u.cause ?? null });
    if (u.outcome !== 'evaluated') gapWeight += u.pairSpaceWeight ?? 0;
  }
  const gaps = new Map();
  for (const g of set.ledger.planningGaps ?? []) bump(gaps, g.cause, { cause: g.cause });
  return {
    runId: set.runId, status: set.outcome.status, environmentSensitive: !!set.outcome.environmentSensitive,
    axes: { coverage: set.outcome.coverage, integrity: set.outcome.integrity, freshness: set.outcome.freshness, freshnessAtSeal: true },
    totalResults: set.results.length, unitOutcomes: sortedRows(outcomes), planningGaps: sortedRows(gaps), gapWeight,
  };
}
