// test/clashtest/derive/support/makeResultSet.mjs
const rid = (testId, digest, a, b) => JSON.stringify([testId, digest, a[0], a[1], b[0], b[1]]); // spec §4.4 form
const refCmp = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
const asc = (xs) => [...xs].sort((x, y) => x - y);
// input target forms: {modelKey, whole:true} | {modelKey, roots:[dbId]}  ->  P5 UnitRecord.targets[]
const scopeOf = (t) => (t.whole ? { modelKey: t.modelKey, scope: 'model' } : { modelKey: t.modelKey, scope: 'roots', rootDbIds: asc(t.roots) });

/** models: [{modelKey, modelVersion, cls?, roots:[{dbId, ownerDbIds, cls?}]}]
 *          `cls` is the per-ROOT class marker persisted on the ledger's rootOwners rows ('A'|'B'|'C', default 'A' — P3's ROOT_CLASS literals, R2);
 *          a model-level `cls` is only a default for its roots.
 *  units:  [{unitId, outcome?, cause?, source:{modelKey, roots:[dbId]}, targets:[{modelKey, whole:true}|{modelKey, roots:[dbId]}],
 *            taints?, pairSpaceWeight?, scopeProof?}]      outcome:'split' => kind:'split' (superseded parent)
 *  results:[{pair:[[mk,db],[mk,db]], unitId, evidence?, flags?}]  (sorted into canonical order here)
 *  keepPairOrder: ordered-mode (containment) sets only — keep each result pair's given (contained, container)
 *          orientation instead of sorting it ascending, so a converse ordered pair (y,x) is expressible;
 *          the result LIST is still sorted into canonical PairId order. Default false (unchanged behavior). */
export function makeResultSet(spec = {}) {
  const {
    runId = 'run-1', testId = 't1', semanticDigest = 'sha256:aaa', mode = 'volume-overlap', clearance,
    models = [{ modelKey: 'M', modelVersion: 'v1', roots: [{ dbId: 100, ownerDbIds: [100, 105] }, { dbId: 200, ownerDbIds: [200] }, { dbId: 300, ownerDbIds: [300] }] }],
    units = [], results = [], unreachable = [], freshness = 'current', status = 'completed', coverage = 'full', integrity = 'clean',
    keepPairOrder = false, environmentSensitive = false, determinismClass = 'deterministic', registrySessionId = 'sess-1', placementGeneration = 0,
    libraryVersion = '1.0.0', diagnostics = {}, scopeDigests = {}, planningGaps = [], definitionOverrides = {},
  } = spec;
  const rootOwners = models.map((m) => ({ modelKey: m.modelKey,
    owners: m.roots.map((r) => ({ rootDbId: r.dbId, ownerDbIds: asc(r.ownerDbIds), cls: r.cls ?? m.cls ?? 'A' })) }));
  const hierarchyInternal = rootOwners.flatMap((row) => {
    const hier = row.owners.filter((o) => o.cls === 'C' && o.ownerDbIds.length >= 2);
    return hier.length === 0 ? [] : [{ modelKey: row.modelKey, rootCount: hier.length, ownerCount: hier.reduce((n, o) => n + o.ownerDbIds.length, 0),
      examples: hier.slice(0, 20).map((o) => ({ rootDbId: o.rootDbId, ownerDbIds: o.ownerDbIds.slice(0, 8) })) }]; // bounded, exactly as P3 emits it
  });
  const ledgerUnits = units.map((u) => {
    const outcome = u.outcome ?? 'evaluated';
    return { unitId: u.unitId, kind: outcome === 'split' ? 'split' : 'leaf', parentUnitId: null,
      sourceModelKey: u.source.modelKey, sourceRootDbIds: asc(u.source.roots), targets: u.targets.map(scopeOf),
      outcome, cause: u.cause ?? null, secondaryCauses: [], capacityKind: null, capDetail: null,
      scopeProof: u.scopeProof ?? 'equal', pairSpaceWeight: u.pairSpaceWeight ?? 1,
      taints: (u.taints ?? []).map((t) => ({ modelKey: null, dbId: null, ...t })), attempts: 1, durationMs: 0 };
  });
  const clashResults = results
    .map((r) => {
      const [a, b] = keepPairOrder ? r.pair : [...r.pair].sort(refCmp);
      return { resultId: rid(testId, semanticDigest, a, b), pair: { first: { modelKey: a[0], dbId: a[1] }, second: { modelKey: b[0], dbId: b[1] } },
        mode, evaluatedAs: { source: { modelKey: a[0], dbId: a[1] }, target: { modelKey: b[0], dbId: b[1] } },
        evidence: r.evidence ?? (mode === 'clearance' ? { distance: 0.04, clearance: clearance ?? 0.05, closestPoints: { first: [0, 0, 0], second: [0.04, 0, 0] } }
          : mode === 'volume-overlap' ? { witness: { kind: 'surface-crossing', point: [1, 2, 3] } } : {}),
        flags: r.flags ?? {}, unitId: r.unitId ?? units[0]?.unitId ?? 'u0' };
    })
    .sort((x, y) => refCmp([x.pair.first.modelKey, x.pair.first.dbId], [y.pair.first.modelKey, y.pair.first.dbId])
      || refCmp([x.pair.second.modelKey, x.pair.second.dbId], [y.pair.second.modelKey, y.pair.second.dbId]));
  return {
    schemaVersion: 1, runId, testRef: { testId, revision: 1, semanticDigest },
    definition: { schemaVersion: 1, testId, revision: 1, name: 'n', mode, ...(mode === 'clearance' ? { clearance } : {}),
      selectionA: { entries: [{ kind: 'model', modelKey: models[0].modelKey }] }, selectionB: { entries: [{ kind: 'model', modelKey: models[0].modelKey }] }, ...definitionOverrides },
    derivedFromRunId: null,
    outcome: { status, environmentSensitive, environmentSensitiveCauses: [], coverage, integrity, freshness, reasons: [] }, // freshness = the BARE state (§8.3)
    provenance: { registrySessionId, libraryVersion, determinismClass, placementVerified: false,
      models: models.map((m) => ({ modelKey: m.modelKey, modelVersion: m.modelVersion, placementGeneration, scopeDigests: scopeDigests[m.modelKey] ?? { population: null, roots: [] } })) },
    ledger: { planExists: true, pairSpaceTotal: ledgerUnits.filter((u) => u.kind === 'leaf').reduce((n, u) => n + u.pairSpaceWeight, 0), emptyOperand: false,
      units: ledgerUnits, rootOwners, unresolvedSelections: [], unreachablePopulation: unreachable.map((u) => ({ ...u })), hierarchyInternal,
      planningGaps, exclusions: [], warnings: [], budgetExhausted: false, firstRefusalUnitId: null },
    results: clashResults,
    diagnostics: { total: 0, countsByReason: [], completenessAffectingUpperBound: 0, omittedReasonOccurrences: 0, unclassifiedOccurrences: 0, ...diagnostics },
    statistics: {}, digests: { digestVersion: 1, pairSetDigest: 'sha256:p', ledgerDigest: 'sha256:l' }, sealed: true,
  };
}

/** Convenience: one evaluated unit u1 (source root 100 vs targets 200,300) over the default model M. */
export const U1 = { unitId: '1.0', source: { modelKey: 'M', roots: [100] }, targets: [{ modelKey: 'M', roots: [200, 300] }] };
